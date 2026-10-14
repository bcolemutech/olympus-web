'use strict';

const crypto = require('crypto');
const { setTimeout: sleep } = require('timers/promises');
const { TIERS, MODELS, ASPECT_RATIOS, DEFAULT_RATIOS, MAX_REFERENCES } = require('./config');
const { KINDS, normalizeLabels, LibraryError } = require('./library');
const { readImage } = require('./formats');
const { priceOf, CostError } = require('./costs');

/**
 * Generation jobs (planning/the-image-studio.md §4.3; L-707 / #543).
 *
 *   studio_jobs/{jobId}
 *     kind: 'generate' | 'edit',
 *     request (generate): { prompt, kind, tier, model, size, aspectRatio,
 *       references[], from, title, labels }
 *     request (edit, L-708): { imageId, baseVersion, instruction, kind, tier,
 *       model, size, aspectRatio, references[] }
 *     state: 'queued' |
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
 * An edit (L-708, E1–E3) sends the image's version as the first reference
 * with the instruction, and stores what comes back as the image's next
 * version, made current (E2): its link serves it, and the worlds using it are
 * refreshed (their reference's size) so they show it on their next turn.
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

/** An edit's prompt: the change asked for, and everything else kept. */
function editPrompt(instruction, extraReferences) {
  return (
    `Edit the first image: ${instruction}\n` +
    'Keep everything else as it is: the layout, the composition, the style and the colours.' +
    (extraReferences ? ' Use the other images as references for the change.' : '')
  );
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
  // Refreshes the worlds using an image after its current version changes
  // (their reference holds its size): (record, uid) → uses refreshed.
  refreshUses = async () => [],
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
      // Asked for, else from what it's of, else its kind's usual shape.
      aspectRatio:
        input.aspectRatio || (fromInfo && fromInfo.aspectRatio) || DEFAULT_RATIOS[kind] || null,
      references,
      from,
      title,
      labels: normalizeLabels(input.labels),
    };
  }

  // Writes a job queued and hands it to the queue; returns it at once (T1).
  async function queue(uid, kind, request, via) {
    const id = `job_${crypto.randomBytes(8).toString('hex')}`;
    const job = {
      id,
      kind,
      request,
      state: 'queued',
      imageId: kind === 'edit' ? request.imageId : null,
      version: null,
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
      // The queue's own reason (often a missing permission), on the job and
      // to whoever asked, so it can be fixed without reading the logs.
      console.error(`studio job ${id} could not be queued:`, err);
      const reason = String((err && err.message) || err).slice(0, 500);
      const error = `The job could not be queued: ${reason}`;
      await jobs().doc(id).update({ state: 'failed', error, finishedAt: now() });
      throw new JobError('unavailable', error);
    }
    return job;
  }

  const asJobError = (err) =>
    err instanceof LibraryError || err instanceof CostError
      ? new JobError(err.code, err.message)
      : err;

  /** Starts making an image (L-707). Returns the job at once. */
  async function start(uid, input = {}, via = 'mcp') {
    let request;
    try {
      request = await checkRequest(input);
    } catch (err) {
      throw asJobError(err);
    }
    return queue(uid, 'generate', request, via);
  }

  // Checks an edit and fills in what it leaves out (L-708).
  async function checkEdit(input) {
    const instruction = typeof input.instruction === 'string' ? input.instruction.trim() : '';
    if (!instruction) throw invalid('Say what to change (instruction).');
    if (instruction.length > MAX_PROMPT) {
      throw invalid(`An instruction is at most ${MAX_PROMPT} characters.`);
    }
    const record = await library.getImage(input.imageId);
    const version = record.versions.find((v) => v.n === record.current);
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
    priceOf({ model: modelName, size });
    // The image itself is the first reference, so one fewer may be added.
    const references = input.references || [];
    if (!Array.isArray(references) || references.length > MAX_REFERENCES - 1) {
      throw invalid(`At most ${MAX_REFERENCES - 1} more reference images with an edit.`);
    }
    for (const id of references) await library.getImage(id);
    return {
      request: {
        imageId: record.id,
        baseVersion: record.current,
        instruction,
        kind: record.kind,
        tier,
        model: modelName,
        size,
        // An edit keeps the image's shape unless asked otherwise.
        aspectRatio: input.aspectRatio || nearestRatio(version.width, version.height),
        references,
        title: record.title,
      },
      record,
    };
  }

  /**
   * Starts an edit of an image by instruction (L-708). Returns the job at
   * once, and where the image is used: every one of those changes when the
   * edit is done (E2).
   */
  async function startEdit(uid, input = {}, via = 'mcp') {
    let checked;
    try {
      checked = await checkEdit(input);
    } catch (err) {
      throw asJobError(err);
    }
    const job = await queue(uid, 'edit', checked.request, via);
    return { job, usedIn: checked.record.usedIn || [] };
  }

  // A reference image as the model reads it.
  async function referenceOf(imageId, n) {
    const record = await library.getImage(imageId);
    const version =
      record.versions.find((v) => v.n === (n || record.current)) ||
      record.versions.find((v) => v.n === record.current);
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
      let prompt;
      const references = [];
      if (job.kind === 'edit') {
        // The image as it was when the edit was asked for, then any others.
        references.push(await referenceOf(request.imageId, request.baseVersion));
        prompt = editPrompt(request.instruction, request.references.length > 0);
      } else {
        let from = null;
        if (request.from) {
          const world = await loadWorld(request.from.worldId);
          if (!world) throw new JobError('not-found', 'Its world is gone.');
          from = fromData(world, request.from, { placesOf });
        }
        prompt = buildPrompt(request.prompt, from);
      }
      for (const id of request.references) references.push(await referenceOf(id));
      result = await model.generate({
        model: request.model,
        prompt,
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
    if (job.kind === 'edit') return finishEdit(job, ref, file, price, charge, result);
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
      version: 1,
      cost: entry.usd,
      usage: result.usage,
      note: result.text ? clip(result.text, 500) : null,
      finishedAt: now(),
    });
    return { state: 'done', imageId: record.id };
  }

  // An edit's image becomes the image's next version, made current (E2), and
  // the worlds using it are refreshed to show it.
  async function finishEdit(job, ref, file, price, charge, result) {
    const request = job.request;
    let record;
    try {
      record = await library.addVersion(request.imageId, {
        file,
        createdBy: job.createdBy,
        via: job.via,
        instruction: request.instruction,
        cost: price,
      });
    } catch (err) {
      // Deleted while it was being edited: the call was still charged.
      const { entry } = await charge({ imageId: request.imageId, usd: price, failed: true });
      await ref.update({
        state: 'failed',
        error: `The edit couldn't be kept: ${err.message}`,
        cost: entry.usd,
        usage: result.usage,
        finishedAt: now(),
      });
      return { state: 'failed' };
    }
    const { entry } = await charge({ imageId: record.id, usd: price });
    let refreshed = null;
    try {
      refreshed = await refreshUses(record, job.createdBy);
    } catch (err) {
      console.error(`studio edit ${job.id}: worlds not refreshed:`, err);
    }
    const notes = [
      result.text ? clip(result.text, 500) : null,
      refreshed === null && (record.usedIn || []).length
        ? 'The worlds using it may show the old size until it is assigned again.'
        : null,
    ].filter(Boolean);
    await ref.update({
      state: 'done',
      imageId: record.id,
      version: record.current,
      cost: entry.usd,
      usage: result.usage,
      note: notes.length ? notes.join(' ') : null,
      finishedAt: now(),
    });
    return { state: 'done', imageId: record.id, version: record.current };
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

  return { start, startEdit, run, getJob, list };
}

module.exports = {
  createJobs,
  fromData,
  buildPrompt,
  editPrompt,
  nearestRatio,
  JobError,
  FROM_KINDS,
};
