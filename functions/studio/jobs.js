'use strict';

const crypto = require('crypto');
const { setTimeout: sleep } = require('timers/promises');
const { TIERS, MODELS, ASPECT_RATIOS, MAX_REFERENCES } = require('./config');
const { KINDS, normalizeLabels, LibraryError } = require('./library');
const { readImage } = require('./formats');
const { priceOf, CostError } = require('./costs');

/**
 * Generation jobs (planning/the-image-studio.md §4.3; L-707 / #543).
 *
 *   studio_jobs/{jobId}
 *     kind: 'generate', request: { prompt, kind, tier, model, size,
 *     aspectRatio, references[], from, title, labels }, state: 'queued' |
 *     'running' | 'done' | 'failed', imageId, cost (dollars), usage, error,
 *     note (the model's words, if any), createdBy, via ('page' | 'mcp'),
 *     createdAt, startedAt, finishedAt
 *
 * start() checks the request, writes the job and hands it to the queue
 * (`enqueue`, a Cloud Tasks queue running at most MAX_RUNNING at once), then
 * returns at once (T1). run() does the work when the queue dispatches it:
 *
 *   1. the request: the `from` thing's data (M7), then the prompt as given;
 *      the reference images (M3), each library image's current version;
 *   2. one call to the model for the tier, or the model named (M1, M5);
 *   3. the image into the library, its cost recorded (no image is made
 *      without its cost recorded), and the job marked done.
 *
 * A call that brings no image back (refused, blocked) fails the job with the
 * model's reason, and is still charged for the tokens the provider reports.
 * A call that fails outright isn't charged. A job is run once: one already
 * running when dispatched again (a retry after a crash) is marked failed
 * rather than run twice, so it is never charged twice.
 */

const MAX_PROMPT = 4000;
const MAX_TITLE = 120;
const FROM_KINDS = ['location', 'town', 'battleMap', 'character'];
// Reference formats the model reads; SVG is drawn to PNG first.
const READABLE = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

class JobError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const invalid = (message) => new JobError('invalid-argument', message);

// The nearest shape the models make to a width and height.
function nearestRatio(width, height) {
  const want = Math.log(width / height);
  let best = '1:1';
  let gap = Infinity;
  for (const ratio of ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const d = Math.abs(Math.log(w / h) - want);
    if (d < gap) {
      gap = d;
      best = ratio;
    }
  }
  return best;
}

const clip = (text, n) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : text || '');

/**
 * What the `from` thing adds to the prompt (M7): its data, plainly, and the
 * shape it wants. Returns { text, aspectRatio, kind, name }.
 */
function fromData(world, from, { placesOf }) {
  const named = (collection, id) => ((world[collection] || {})[id] || {}).name;
  if (from.kind === 'location' || from.kind === 'town') {
    const place = (world.locations || {})[from.id];
    if (!place || place.retired) throw new JobError('not-found', `No place "${from.id}".`);
    const geo = place.geo || {};
    const lines = [
      `${place.name}: ${geo.kind || 'a place'}` +
        (geo.population ? `, population ${geo.population}` : '') +
        (geo.capital ? ', a capital' : '') +
        (named('regions', geo.regionId) ? `, in ${named('regions', geo.regionId)}` : '') +
        '.',
      clip(place.description, 1200),
    ];
    if (from.kind === 'town') {
      if (geo.kind !== 'settlement') {
        throw new JobError('failed-precondition', `${place.name} isn't a settlement.`);
      }
      const places = placesOf(world, place.id).slice(0, 30);
      if (places.length) {
        lines.push(
          'In town: ' +
            places
              .map((p) => p.name + (p.description ? ` (${clip(p.description, 120)})` : ''))
              .join('; ') +
            '.'
        );
      }
      lines.push(
        'Draw the town seen from straight above, as a map, so its places can be pinned on it.'
      );
    }
    return {
      text: lines.filter(Boolean).join('\n'),
      aspectRatio: from.kind === 'town' ? '1:1' : null,
      kind: from.kind === 'town' ? 'town' : null,
      name: place.name,
    };
  }
  if (from.kind === 'battleMap') {
    const map = (world.battleMaps || {})[from.id];
    if (!map || map.retired) throw new JobError('not-found', `No battle map "${from.id}".`);
    const list = (items) =>
      (items || [])
        .map((i) => i.name)
        .filter(Boolean)
        .join(', ');
    const lines = [
      `${map.name}: a battle map ${map.width} by ${map.height} squares, seen from straight above, ` +
        'with no grid drawn (the grid is laid over it).',
      list(map.features) && `Features: ${list(map.features)}.`,
      list(map.exits) && `Ways out: ${list(map.exits)}.`,
      map.description && clip(map.description, 800),
    ];
    return {
      text: lines.filter(Boolean).join('\n'),
      aspectRatio: nearestRatio(map.width, map.height),
      kind: 'battleMap',
      name: map.name,
    };
  }
  const person = (world.characters || {})[from.id];
  if (!person || person.retired) throw new JobError('not-found', `No character "${from.id}".`);
  return {
    text: [
      `${person.name}` +
        (named('locations', person.locationId)
          ? `, of ${named('locations', person.locationId)}`
          : '') +
        (named('factions', person.factionId) ? `, ${named('factions', person.factionId)}` : '') +
        '.',
      clip(person.description, 1200),
    ]
      .filter(Boolean)
      .join('\n'),
    aspectRatio: null,
    kind: 'portrait',
    name: person.name,
  };
}

/** The prompt sent: the world's data first, then what was asked. */
function buildPrompt(prompt, from) {
  return from ? `About what to draw:\n${from.text}\n\nThe image:\n${prompt}` : prompt;
}

function createJobs({
  db,
  library,
  costs,
  model,
  enqueue,
  loadWorld,
  placesOf,
  rasterize,
  load,
  now = () => Date.now(),
}) {
  const jobs = () => db.collection('studio_jobs');

  // Checks a request and fills in what it leaves out.
  async function checkRequest(input) {
    const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
    if (!prompt) throw invalid('Say what to draw (prompt).');
    if (prompt.length > MAX_PROMPT) throw invalid(`A prompt is at most ${MAX_PROMPT} characters.`);
    if (input.tier !== undefined && !TIERS[input.tier]) {
      throw invalid(`The tier is ${Object.keys(TIERS).join(' or ')}.`);
    }
    if (input.model !== undefined && !MODELS[input.model]) {
      throw invalid(`The model is one of: ${Object.keys(MODELS).join(', ')}.`);
    }
    const tier = input.model ? null : input.tier || 'draft';
    const modelName = input.model || TIERS[tier].model;
    const size = input.size || (tier ? TIERS[tier].size : MODELS[modelName].sizes[0]);
    if (!MODELS[modelName].sizes.includes(size)) {
      throw invalid(`${modelName} makes ${MODELS[modelName].sizes.join(', ')} images.`);
    }
    if (input.aspectRatio !== undefined && !ASPECT_RATIOS.includes(input.aspectRatio)) {
      throw invalid(`The shape (aspectRatio) is one of ${ASPECT_RATIOS.join(', ')}.`);
    }
    // It can be charged for (L-706): a model without a price isn't run.
    priceOf({ model: modelName, size });

    const references = input.references || [];
    if (!Array.isArray(references) || references.length > MAX_REFERENCES) {
      throw invalid(`At most ${MAX_REFERENCES} reference images.`);
    }
    for (const id of references) await library.getImage(id); // each must exist

    let from = null;
    let fromInfo = null;
    if (input.from) {
      const { worldId, kind, id } = input.from;
      if (!FROM_KINDS.includes(kind)) {
        throw invalid(`from.kind is one of ${FROM_KINDS.join(', ')}.`);
      }
      const world = await loadWorld(worldId);
      if (!world) throw new JobError('not-found', `No world "${worldId}".`);
      fromInfo = fromData(world, { kind, id }, { placesOf });
      from = { worldId, kind, id };
    }

    const kind = input.kind || (fromInfo && fromInfo.kind) || null;
    if (!KINDS.includes(kind)) throw invalid(`Say what kind of image it is: ${KINDS.join(', ')}.`);
    const title =
      typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : clip((fromInfo && fromInfo.name ? `${fromInfo.name}: ` : '') + prompt, MAX_TITLE);
    if (title.length > MAX_TITLE) throw invalid(`A title is at most ${MAX_TITLE} characters.`);
    return {
      prompt,
      kind,
      tier,
      model: modelName,
      size,
      aspectRatio: input.aspectRatio || (fromInfo && fromInfo.aspectRatio) || null,
      references,
      from,
      title,
      labels: normalizeLabels(input.labels),
    };
  }

  /**
   * Starts a job (T1): checks it, writes it queued and hands it to the queue.
   * Returns the job at once.
   */
  async function start(uid, input = {}, via = 'mcp') {
    let request;
    try {
      request = await checkRequest(input);
    } catch (err) {
      if (err instanceof LibraryError || err instanceof CostError) {
        throw new JobError(err.code, err.message);
      }
      throw err;
    }
    const id = `job_${crypto.randomBytes(8).toString('hex')}`;
    const job = {
      id,
      kind: 'generate',
      request,
      state: 'queued',
      imageId: null,
      cost: null,
      usage: null,
      error: null,
      note: null,
      createdBy: uid,
      via,
      createdAt: now(),
      startedAt: null,
      finishedAt: null,
    };
    await jobs().doc(id).set(job);
    try {
      await enqueue({ jobId: id });
    } catch (err) {
      await jobs()
        .doc(id)
        .update({ state: 'failed', error: 'The job could not be queued.', finishedAt: now() });
      throw err;
    }
    return job;
  }

  // A reference image as the model reads it.
  async function referenceOf(imageId) {
    const record = await library.getImage(imageId);
    const version = record.versions.find((v) => v.n === record.current);
    let bytes = await load(version.path);
    let mimeType = READABLE[version.format];
    if (version.format === 'svg') {
      bytes = rasterize(bytes);
      mimeType = 'image/png';
    }
    return { bytes, mimeType };
  }

  /** Runs a job, once, when the queue dispatches it. */
  async function run(jobId) {
    const ref = jobs().doc(jobId);
    const job = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      const data = snap.data();
      if (data.state === 'running') {
        // Dispatched again after a crash: never run (and charge) twice.
        tx.update(ref, {
          state: 'failed',
          error: 'The job stopped partway; start it again.',
          finishedAt: now(),
        });
        return null;
      }
      if (data.state !== 'queued') return null;
      tx.update(ref, { state: 'running', startedAt: now() });
      return data;
    });
    if (!job) return null;

    const request = job.request;
    let result;
    try {
      let from = null;
      if (request.from) {
        const world = await loadWorld(request.from.worldId);
        if (!world) throw new JobError('not-found', 'Its world is gone.');
        from = fromData(world, request.from, { placesOf });
      }
      const references = [];
      for (const id of request.references) references.push(await referenceOf(id));
      result = await model.generate({
        model: request.model,
        prompt: buildPrompt(request.prompt, from),
        references,
        size: request.size,
        aspectRatio: request.aspectRatio,
      });
    } catch (err) {
      // Not charged: the call never came back with anything.
      console.error(`studio job ${jobId} failed:`, err);
      await ref.update({
        state: 'failed',
        error: String((err && err.message) || err).slice(0, 1000),
        finishedAt: now(),
      });
      return { state: 'failed' };
    }

    const charge = (extra) =>
      costs.record({
        jobId,
        model: request.model,
        tier: request.tier,
        kind: request.kind,
        size: request.size,
        ...(result.usage ? { tokens: result.usage } : {}),
        createdBy: job.createdBy,
        via: job.via,
        ...extra,
      });

    if (!result.image) {
      // Refused or blocked: charged for what the provider reports using.
      const { entry } = result.usage ? await charge({ failed: true }) : { entry: { usd: 0 } };
      await ref.update({
        state: 'failed',
        error:
          `No image came back${result.finishReason ? ` (${result.finishReason})` : ''}` +
          (result.text ? `: ${clip(result.text, 500)}` : '.'),
        cost: entry.usd,
        usage: result.usage,
        finishedAt: now(),
      });
      return { state: 'failed' };
    }

    let file;
    try {
      file = readImage(result.image.bytes);
    } catch (err) {
      const { entry } = await charge({ failed: true });
      await ref.update({
        state: 'failed',
        error: `The model's image can't be read: ${err.message}.`,
        cost: entry.usd,
        usage: result.usage,
        finishedAt: now(),
      });
      return { state: 'failed' };
    }
    const price = result.usage
      ? priceOf({ model: request.model, tokens: result.usage })
      : priceOf({ model: request.model, size: request.size });
    const record = await library.addImage({
      title: request.title,
      kind: request.kind,
      labels: request.labels,
      prompt: request.prompt,
      model: request.model,
      tier: request.tier,
      from: request.from,
      references: request.references,
      file,
      createdBy: job.createdBy,
      via: job.via,
      cost: price,
      source: { jobId },
    });
    const { entry } = await charge({ imageId: record.id, usd: price });
    await ref.update({
      state: 'done',
      imageId: record.id,
      cost: entry.usd,
      usage: result.usage,
      note: result.text ? clip(result.text, 500) : null,
      finishedAt: now(),
    });
    return { state: 'done', imageId: record.id };
  }

  async function getJob(jobId) {
    const snap = await jobs().doc(String(jobId)).get();
    if (!snap.exists) throw new JobError('not-found', `No job "${jobId}".`);
    return snap.data();
  }

  /**
   * Jobs by id, or the latest (newest first). With `wait` (seconds), waits
   * until any unfinished one among them finishes, or the time is up.
   */
  async function list({ ids, recent = 10, wait = 0, poll = 1000 } = {}) {
    const read = async () => {
      if (ids && ids.length) return Promise.all(ids.map(getJob));
      const snap = await jobs()
        .orderBy('createdAt', 'desc')
        .limit(Math.min(Math.max(recent, 1), 50))
        .get();
      return snap.docs.map((doc) => doc.data());
    };
    const open = (list) =>
      list.filter((j) => j.state === 'queued' || j.state === 'running').map((j) => j.id);
    let found = await read();
    const waiting = open(found);
    const until = now() + Math.min(Math.max(wait, 0), 45) * 1000;
    while (waiting.length && now() < until) {
      await sleep(poll);
      found = await read();
      const still = open(found);
      if (still.length < waiting.length || waiting.some((id) => !still.includes(id))) break;
    }
    return found;
  }

  return { start, run, getJob, list };
}

module.exports = {
  createJobs,
  fromData,
  buildPrompt,
  nearestRatio,
  JobError,
  FROM_KINDS,
};
