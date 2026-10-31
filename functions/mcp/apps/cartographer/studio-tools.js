'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { worldId, entityId } = require('./schemas');
const { KINDS, summary, normalizeLabels } = require('../../../studio/library');
const { viewLibraryImage } = require('./images');
const { TIERS, MODELS, ASPECT_RATIOS, MAX_REFERENCES } = require('../../../studio/config');
const { FROM_KINDS } = require('../../../studio/jobs');
const { MAX_NAME, MAX_STYLE_PROMPT, MAX_STYLE_REFERENCES } = require('../../../studio/styles');

// The image studio's tools in the Cartographer connector (planning/the-image-
// studio.md §4.4, §4.7; T3: a studio_ prefix):
//
// - Assigning (L-704 / #540): a world uses library images, by reference, for
//   its map, its cover, a town's art and a battle map's art. The work is the
//   studio's assigner (functions/studio/assign.js), through the
//   Cartographer's service, so the page and Claude change worlds the same way.
// - The library (L-703 / #539): finding images, looking at one, changing its
//   title, kind, labels or current version, the labels in use, and deleting
//   an unused image (functions/studio/library.js).
// - Costs (L-706 / #542): studio_costs, and the cost line on every studio
//   tool's result (functions/studio/costs.js).
// - Generation (L-707 / #543): studio_generate starts a job and returns at
//   once; studio_jobs collects jobs, waiting briefly if asked, with finished
//   images to look at (functions/studio/jobs.js).
// - Editing (L-708 / #544): studio_edit starts an edit job, naming the worlds
//   that will change; the edit becomes the image's next version.
// - Styles (L-709 / #545): studio_styles and studio_set_style; a style named
//   in studio_generate or studio_edit, or a world's default style
//   (functions/studio/styles.js).

const TARGET = z
  .enum(['map', 'cover', 'town', 'battleMap'])
  .describe(
    'What the image is for: the world map (a worldMap image), the cover shown on the Loom’s ' +
      'world list (a cover image), a settlement’s town art (a town image), or a battle map’s ' +
      'art (a battleMap image).'
  );
const imageId = z
  .string()
  .regex(/^img_[0-9a-f]{16}$/, 'an image id, like img_0123456789abcdef')
  .describe('The library image, from studio_find.');
const KIND = z
  .enum(KINDS)
  .describe(
    'What the image is: worldMap, regionMap, town, battleMap, cover, portrait, token, item, ' +
      'scene, interface or other. Assigning checks it fits.'
  );
const LABELS = z
  .array(z.string().max(40))
  .max(20)
  .describe('Labels: free words, kept lower-case. See studio_labels for those in use.');
const DATE = z
  .string()
  .refine((s) => Number.isFinite(Date.parse(s)), 'a date, like 2026-10-01')
  .describe('A date (ISO 8601, like 2026-10-01).');
const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
const dated = (row) => ({ ...row, createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) });

// An image's record for Claude: everything but where its files are kept.
function detail(record) {
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    labels: record.labels || [],
    link: record.link,
    current: record.current,
    versions: (record.versions || []).map((v) => ({
      n: v.n,
      width: v.width,
      height: v.height,
      format: v.format,
      bytes: v.bytes,
      createdAt: iso(v.createdAt),
      createdBy: v.createdBy,
      via: v.via,
      instruction: v.instruction || null,
      cost: v.cost === undefined ? null : v.cost,
    })),
    usedIn: record.usedIn || [],
    prompt: record.prompt || null,
    model: record.model || null,
    tier: record.tier || null,
    styleId: record.styleId || null,
    from: record.from || null,
    references: record.references || [],
    parentId: record.parentId || null,
    createdBy: record.createdBy,
    via: record.via,
    source: record.source
      ? Object.fromEntries(Object.entries(record.source).filter(([key]) => key !== 'path'))
      : null,
    createdAt: iso(record.createdAt),
    updatedAt: iso(record.updatedAt),
  };
}

const targetId = entityId('settlement or battle map', 'find_locations or list_battle_maps')
  .optional()
  .describe('The settlement (town) or battle map (battleMap). Not for map or cover.');

const readOnly = { readOnlyHint: true, openWorldHint: false };

// The studio's refusals, as tool errors.
async function relay(run) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ToolError) throw err;
    if (err && typeof err.code === 'string' && err.message) throw new ToolError(err.message);
    throw err;
  }
}

function studioTools({ studio, reader, writer }) {
  const tools = [
    ...assignTools({ studio }),
    ...(studio.library ? libraryTools({ studio }) : []),
    ...(studio.costs ? costTools({ studio }) : []),
    ...(studio.jobs ? generateTools({ studio }) : []),
    ...(studio.styles ? styleTools({ studio, reader, writer }) : []),
  ];
  return studio.costs ? tools.map((tool) => withCost(tool, studio.costs)) : tools;
}

// Every studio tool's result carries the cost line (§4.5, C3): what the call
// cost, the month's total so far against the figure, and a plain warning once
// the month has passed it. A tool that made nothing cost nothing; one that
// charged (generation, L-707) returns its own `cost`, which is kept.
function withCost(tool, costs) {
  return {
    ...tool,
    handler: async (ctx, args) => {
      const result = await tool.handler(ctx, args);
      if (!result || typeof result !== 'object') return result;
      if (Array.isArray(result.content)) {
        const body = result.structuredContent || {};
        if (body.cost) return result;
        const withLine = { ...body, cost: await costs().line() };
        return {
          ...result,
          content: result.content.map((item) =>
            item.type === 'text' ? { ...item, text: JSON.stringify(withLine, null, 2) } : item
          ),
          structuredContent: withLine,
        };
      }
      if (result.cost) return result;
      return { ...result, cost: await costs().line() };
    },
  };
}

function costTools({ studio }) {
  return [
    {
      name: 'studio_costs',
      title: 'What the studio has spent',
      description:
        'The image studio’s spending for a month (this one by default): the total against the ' +
        '$50 warning figure, by day, by model, and by who asked (each editor, through the page ' +
        'or Claude), with the latest charges. There is no spending limit, so check this before ' +
        'making many images. Days and months are UTC.',
      inputSchema: {
        month: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'a month, like 2026-10')
          .optional()
          .describe('The month (yyyy-mm). This month by default.'),
        recent: z
          .number()
          .int()
          .min(0)
          .max(100)
          .optional()
          .describe('How many of the latest charges to list (10).'),
      },
      annotations: readOnly,
      handler: (ctx, args) =>
        relay(async () => {
          const totals = await studio
            .costs()
            .totals({ month: args.month, recent: args.recent ?? 10 });
          return { ...totals, cost: await studio.costs().line() };
        }),
    },
  ];
}

function assignTools({ studio }) {
  return [
    {
      name: 'studio_assign',
      title: 'Use a library image',
      description:
        'Use an image from the studio’s library for a world’s map, its cover (shown to players ' +
        'on the Loom’s world list), a town’s art or a battle map’s art. The image’s kind must ' +
        'fit: worldMap, cover, town or battleMap. The world refers to the image, so a new ' +
        'version of it shows wherever it is used. Replaces any art there. Warns when its shape ' +
        'doesn’t fit a battle map’s grid or a town’s square, unless fit says what to do; check ' +
        'it with view_image.',
      inputSchema: {
        worldId,
        imageId,
        target: TARGET,
        id: targetId,
        fit: z
          .enum(['crop', 'pad', 'stretch'])
          .optional()
          .describe(
            'For a battle map or a town (L-396): crop to its shape (the middle, edges lost), ' +
              'pad to it (see-through margins) or stretch (as before). Crop and pad make a ' +
              'fitted version and keep the original; an image used elsewhere is copied instead.'
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const { warnings, ...result } = await studio.assign(ctx.uid, args);
          return {
            ...result,
            ...(warnings && warnings.length ? { warnings } : {}),
            ...(args.target === 'cover' ? {} : { next: 'Check it with view_image.' }),
          };
        }),
    },
    {
      name: 'studio_unassign',
      title: 'Stop using an image',
      description:
        'Take the art away from a world’s map, its cover, a town or a battle map. The image ' +
        'stays in the library; once nothing uses it, it can be deleted.',
      inputSchema: { worldId, target: TARGET, id: targetId },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const result = await studio.assign(ctx.uid, { ...args, imageId: null });
          return {
            worldId: result.worldId,
            target: result.target,
            id: result.id,
            name: result.name,
            removed: result.previous,
          };
        }),
    },
  ];
}

function libraryTools({ studio }) {
  const library = () => studio.library();
  return [
    {
      name: 'studio_find',
      title: 'Find library images',
      description:
        'Search the image studio’s library, newest first. Every word must appear in an image’s ' +
        'title, prompt or labels; the filters narrow it further (kind, labels it carries, a ' +
        'world it is used in, style, who made it, made after or before a date). Returns short ' +
        'records with each image’s link, not the images: look at one with studio_get.',
      inputSchema: {
        words: z.string().max(200).optional().describe('Words to match, e.g. "harbour night".'),
        kind: KIND.optional(),
        labels: LABELS.optional().describe('Only images carrying every one of these labels.'),
        worldId: worldId.optional().describe('Only images a world uses, from list_worlds.'),
        styleId: z.string().max(80).optional().describe('Only images made in this style.'),
        createdBy: z.string().max(128).optional().describe('Only images this editor made.'),
        after: DATE.optional().describe('Only images made on or after this date.'),
        before: DATE.optional().describe('Only images made before this date.'),
        limit: z.number().int().min(1).max(200).optional().describe('At most this many (50).'),
        offset: z.number().int().min(0).optional().describe('Skip this many (nextOffset).'),
      },
      annotations: readOnly,
      handler: (ctx, args) =>
        relay(async () => {
          const result = await library().search({
            ...args,
            after: args.after ? Date.parse(args.after) : undefined,
            before: args.before ? Date.parse(args.before) : undefined,
          });
          return { ...result, images: result.images.map(dated) };
        }),
    },
    {
      name: 'studio_get',
      title: 'Look at a library image',
      description:
        'One image from the library: its record (title, kind, labels, prompt, versions, the ' +
        'worlds and targets using it) and its stable link, which always serves the current ' +
        'version and can be embedded anywhere, plus the image to look at (scaled to at most ' +
        '1568 px on the long side). Give a version to look at an earlier one.',
      inputSchema: {
        imageId,
        version: z.number().int().min(1).optional().describe('A version to look at (current).'),
      },
      annotations: readOnly,
      handler: (ctx, args) =>
        relay(async () => {
          const record = await library().getImage(args.imageId);
          const n = args.version || record.current;
          const version = record.versions.find((v) => v.n === n);
          if (!version) {
            throw new ToolError(
              `"${record.title}" has no version ${n}; it has ` +
                `${record.versions.map((v) => v.n).join(', ')}.`
            );
          }
          const body = { ...detail(record), showing: n };
          let view = null;
          try {
            view = viewLibraryImage(await studio.load(version.path), version.format, version);
          } catch (err) {
            body.view = err.tooLarge
              ? `It can't be shown here (${err.message}); open its link to see it.`
              : `It can't be shown: ${err.message}.`;
          }
          return {
            content: [
              ...(view
                ? [{ type: 'image', data: view.data.toString('base64'), mimeType: view.mimeType }]
                : []),
              { type: 'text', text: JSON.stringify(body, null, 2) },
            ],
            structuredContent: body,
          };
        }),
    },
    {
      name: 'studio_update',
      title: 'Change a library image',
      description:
        'Change an image’s title, kind or labels, or make an earlier version current. Labels ' +
        'can be given whole (labels) or added and removed (addLabels, removeLabels); reuse ' +
        'labels from studio_labels rather than coining near-duplicates. A kind can’t change ' +
        'while a world uses the image. Making another version current changes the image ' +
        'everywhere it is used, and its link serves that version within minutes; the result ' +
        'names those uses, so check them with view_image.',
      inputSchema: {
        imageId,
        title: z.string().min(1).max(120).optional().describe('A new title.'),
        kind: KIND.optional(),
        labels: LABELS.optional().describe('The labels, replacing all it has.'),
        addLabels: LABELS.optional().describe('Labels to add.'),
        removeLabels: LABELS.optional().describe('Labels to take off.'),
        current: z.number().int().min(1).optional().describe('The version to make current.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const fields = ['title', 'kind', 'labels', 'addLabels', 'removeLabels', 'current'];
          if (!fields.some((key) => args[key] !== undefined)) {
            throw new ToolError(`Say what to change: ${fields.join(', ')}.`);
          }
          if (args.labels && (args.addLabels || args.removeLabels)) {
            throw new ToolError('Give labels whole, or add and remove them, not both.');
          }
          let record = await library().getImage(args.imageId);
          let labels = args.labels;
          if (args.addLabels || args.removeLabels) {
            const removing = normalizeLabels(args.removeLabels);
            labels = (record.labels || [])
              .concat(normalizeLabels(args.addLabels))
              .filter((label) => !removing.includes(label));
          }
          if (args.current !== undefined && !record.versions.some((v) => v.n === args.current)) {
            throw new ToolError(
              `"${record.title}" has no version ${args.current}; it has ` +
                `${record.versions.map((v) => v.n).join(', ')}.`
            );
          }
          record = await library().updateImage(args.imageId, {
            title: args.title,
            kind: args.kind,
            labels,
          });
          const result = {};
          if (args.current !== undefined && args.current !== record.current) {
            record = await library().setCurrent(record.id, args.current);
            // Worlds hold the current version's size: refresh it where the image
            // is used (assigning the same image again changes nothing else).
            const changed = [];
            const warnings = [];
            for (const use of record.usedIn || []) {
              const done = await studio.assign(ctx.uid, { ...use, imageId: record.id });
              changed.push({ ...use, name: done.name });
              warnings.push(...(done.warnings || []).map((w) => `${done.name}: ${w}`));
            }
            result.changed = changed;
            if (warnings.length) result.warnings = warnings;
            if (changed.length) result.next = 'Check each with view_image.';
          }
          return { image: dated(summary(record.id, record)), ...result };
        }),
    },
    {
      name: 'studio_labels',
      title: 'Labels in use',
      description:
        'The labels on library images, with how many images carry each, most used first. ' +
        'Reuse these when labelling, so search finds images together.',
      inputSchema: {},
      annotations: readOnly,
      handler: () => relay(async () => ({ labels: await library().labels() })),
    },
    {
      name: 'studio_delete',
      title: 'Delete a library image',
      description:
        'Delete an image from the library for good, with every version and its link. Only an ' +
        'image no world uses: unassign it first (studio_unassign). Its cost records are kept.',
      inputSchema: { imageId },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      handler: (ctx, args) =>
        relay(async () => ({ deleted: await library().deleteImage(args.imageId) })),
    },
  ];
}

const MAX_SHOWN = 4; // finished images shown in one studio_jobs result

const STYLE_ID = z
  .string()
  .regex(/^sty_[0-9a-f]{16}$/, 'a style id, like sty_0123456789abcdef')
  .describe('The style, from studio_styles.');
const STYLE_CHOICE = z.union([STYLE_ID, z.literal('none')]).optional();

function jobView(job, image) {
  const r = job.request || {};
  const clip200 = (text) => (text && text.length > 200 ? `${text.slice(0, 199)}…` : text);
  return {
    id: job.id,
    kind: job.kind || 'generate',
    state: job.state,
    ...(job.kind === 'edit'
      ? { imageId: r.imageId, fromVersion: r.baseVersion, version: job.version || null }
      : {}),
    request: {
      ...(job.kind === 'edit'
        ? { instruction: clip200(r.instruction) }
        : { prompt: clip200(r.prompt) }),
      kind: r.kind,
      tier: r.tier,
      model: r.model,
      size: r.size,
      aspectRatio: r.aspectRatio,
      references: r.references,
      from: r.from,
      title: r.title,
      style: r.style ? { id: r.style.id, name: r.style.name } : null,
    },
    ...(image ? { image } : {}),
    ...(job.cost !== null && job.cost !== undefined ? { cost: job.cost } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(job.note ? { note: job.note } : {}),
    // Tried again after the model was busy (L-396): which try, and when next.
    ...(job.tries > 1 ? { tries: job.tries } : {}),
    ...(job.state === 'queued' && job.retryAt ? { retryAt: iso(job.retryAt) } : {}),
    createdBy: job.createdBy,
    via: job.via,
    createdAt: iso(job.createdAt),
    finishedAt: iso(job.finishedAt),
    ...(job.startedAt && job.finishedAt
      ? { seconds: Math.round((job.finishedAt - job.startedAt) / 100) / 10 }
      : {}),
  };
}

function generateTools({ studio }) {
  const jobs = () => studio.jobs();
  return [
    {
      name: 'studio_generate',
      title: 'Make an image',
      description:
        'Start making one image with a Gemini image model; it returns a job at once, so ' +
        'several can run side by side (8 at a time, more wait their turn). Collect them with ' +
        'studio_jobs (wait up to 45 seconds; an image takes about 10–60). Every image is ' +
        'charged (draft about $0.07, final about $0.13; see studio_costs), and kept in the ' +
        'library with its prompt. Give the kind; the tier (draft, the default, or final) or a ' +
        'model; optionally a size and shape; library images as references (style, layout or ' +
        'subject to follow); and `from`, a place, town, battle map or character in a world, ' +
        'whose data is added to the prompt (a town is drawn square from above, a battle map ' +
        'in its grid’s shape). Then label it, and assign it with studio_assign.',
      inputSchema: {
        prompt: z.string().min(1).max(4000).describe('What to draw, in words.'),
        kind: KIND.optional().describe(
          'What the image is (worldMap, town, battleMap, cover, portrait, …). Optional with from.'
        ),
        tier: z
          .enum(Object.keys(TIERS))
          .optional()
          .describe(
            `draft (${TIERS.draft.model}, ${TIERS.draft.size}) or final (${TIERS.final.model}, ` +
              `${TIERS.final.size}). Default draft.`
          ),
        model: z
          .enum(Object.keys(MODELS))
          .optional()
          .describe('A model by name, instead of a tier.'),
        size: z
          .enum(['512', '1K', '2K', '4K'])
          .optional()
          .describe('The output size, if the model makes it (4K costs more).'),
        aspectRatio: z.enum(ASPECT_RATIOS).optional().describe('The shape, e.g. 16:9.'),
        references: z
          .array(imageId)
          .max(MAX_REFERENCES)
          .optional()
          .describe('Library images to follow (style, layout, subject).'),
        from: z
          .object({
            worldId,
            kind: z.enum(FROM_KINDS),
            id: entityId('place, battle map or character', 'find_locations, list_battle_maps'),
          })
          .optional()
          .describe('A thing in a world whose data is added to the prompt.'),
        title: z.string().min(1).max(120).optional().describe('Its title in the library.'),
        labels: LABELS.optional(),
        styleId: STYLE_CHOICE.describe(
          'A style from studio_styles: its text and reference images are added. With `from`, ' +
            'the world’s default style is used unless another is named, or "none".'
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const job = await jobs().start(ctx.uid, args, 'mcp');
          return {
            job: jobView(job),
            next: `Collect it with studio_jobs (ids: ["${job.id}"], wait: 45).`,
          };
        }),
    },
    {
      name: 'studio_edit',
      title: 'Edit an image',
      description:
        'Change a library image by instruction ("make it night", "add a ruined tower on the ' +
        'hill"): the model redraws it with the change and keeps the rest. The result is a new ' +
        'version of the same image, made current, so every world using it changes too (the ' +
        'result names them: check each with view_image). Earlier versions are kept; bring one ' +
        'back with studio_update (current). Returns a job at once: collect it with studio_jobs. ' +
        'Charged like studio_generate (draft about $0.07, final about $0.13). The shape stays ' +
        "the image's unless asked otherwise. Extra references (style or detail to follow) are " +
        'optional.',
      inputSchema: {
        imageId,
        instruction: z.string().min(1).max(4000).describe('The change, in words.'),
        tier: z
          .enum(Object.keys(TIERS))
          .optional()
          .describe(`draft (${TIERS.draft.model}) or final (${TIERS.final.model}). Default draft.`),
        model: z
          .enum(Object.keys(MODELS))
          .optional()
          .describe('A model by name, instead of a tier.'),
        size: z
          .enum(['512', '1K', '2K', '4K'])
          .optional()
          .describe('The output size, if the model makes it.'),
        aspectRatio: z
          .enum(ASPECT_RATIOS)
          .optional()
          .describe("A new shape; the image's own by default."),
        references: z
          .array(imageId)
          .max(MAX_REFERENCES - 1)
          .optional()
          .describe('Other library images to follow for the change.'),
        styleId: STYLE_CHOICE.describe(
          'A style from studio_styles to redraw it in. None by default: an edit keeps the ' +
            'image’s own look.'
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const { job, usedIn } = await jobs().startEdit(ctx.uid, args, 'mcp');
          return {
            job: jobView(job),
            ...(usedIn.length
              ? {
                  inUse: usedIn,
                  notice:
                    `It is in use in ${usedIn.length} place${usedIn.length === 1 ? '' : 's'}: ` +
                    usedIn.map((u) => `${u.worldId} (${u.target} ${u.id})`).join(', ') +
                    '. Each will show the edit once it is done; check them with view_image. ' +
                    'To undo, make the earlier version current with studio_update.',
                }
              : {}),
            next: `Collect it with studio_jobs (ids: ["${job.id}"], wait: 45).`,
          };
        }),
    },
    {
      name: 'studio_jobs',
      title: 'Collect images being made',
      description:
        'Jobs from studio_generate and studio_edit: by id, or the latest. Give `wait` (seconds, ' +
        'up to 45) to ' +
        'wait until one of them finishes. Finished jobs come with their image to look at ' +
        `(up to ${MAX_SHOWN}), its library id and link, and what it cost; failed ones say why.`,
      inputSchema: {
        ids: z
          .array(z.string().regex(/^job_[0-9a-f]{16}$/, 'a job id, like job_0123456789abcdef'))
          .max(20)
          .optional()
          .describe('The jobs (from studio_generate or studio_edit). The latest if not given.'),
        recent: z.number().int().min(1).max(50).optional().describe('How many of the latest (10).'),
        wait: z
          .number()
          .min(0)
          .max(45)
          .optional()
          .describe('Seconds to wait for an unfinished job to finish (0).'),
      },
      annotations: readOnly,
      handler: (ctx, args) =>
        relay(async () => {
          const found = await jobs().list({
            ids: args.ids,
            recent: args.recent,
            wait: args.wait,
          });
          const content = [];
          const views = [];
          let micros = 0;
          for (const job of found) {
            let image = null;
            if (job.state === 'done' && job.imageId) {
              try {
                const record = await studio.library().getImage(job.imageId);
                image = dated(summary(record.id, record));
                if (content.length < MAX_SHOWN) {
                  // The version this job made (an edit's), else the current one.
                  const version =
                    record.versions.find((v) => v.n === job.version) ||
                    record.versions.find((v) => v.n === record.current);
                  const view = viewLibraryImage(
                    await studio.load(version.path),
                    version.format,
                    version
                  );
                  content.push({
                    type: 'image',
                    data: view.data.toString('base64'),
                    mimeType: view.mimeType,
                  });
                  image.shown = content.length;
                }
              } catch {
                image = { id: job.imageId, missing: 'It is no longer in the library.' };
              }
            }
            if (job.cost) micros += Math.round(job.cost * 1e6);
            views.push(jobView(job, image));
          }
          const body = {
            jobs: views,
            ...(views.some((j) => j.state === 'queued' || j.state === 'running')
              ? { next: 'Some are still being made: call again with wait.' }
              : {}),
            cost: await studio.costs().line(micros),
          };
          content.push({ type: 'text', text: JSON.stringify(body, null, 2) });
          return { content, structuredContent: body };
        }),
    },
  ];
}

// A style for Claude: what it is, and its images' links.
async function styleView(style, library) {
  const references = [];
  for (const id of style.references || []) {
    try {
      const record = await library.getImage(id);
      references.push({ id, title: record.title, link: record.link });
    } catch {
      references.push({ id, missing: 'It is no longer in the library.' });
    }
  }
  return {
    id: style.id,
    name: style.name,
    prompt: style.prompt,
    references,
    createdBy: style.createdBy,
    createdAt: iso(style.createdAt),
    updatedAt: iso(style.updatedAt),
  };
}

function styleTools({ studio, reader, writer }) {
  const styles = () => studio.styles();
  // Sets or clears a world's default style (world.studio.styleId).
  const setDefault = (uid, worldId, styleId) =>
    writer.edit(worldId, uid, ({ world, updateWorld }) => {
      const was = (world.studio && world.studio.styleId) || null;
      if (was === styleId) return { defaultStyle: styleId };
      const { FieldValue } = require('firebase-admin/firestore');
      updateWorld({ 'studio.styleId': styleId || FieldValue.delete() });
      return { defaultStyle: styleId, previous: was };
    });
  return [
    {
      name: 'studio_styles',
      title: 'Styles',
      description:
        'The image studio’s named styles: each is prompt text plus up to ' +
        `${MAX_STYLE_REFERENCES} reference images, so a world’s art keeps one look. Name one ` +
        'in studio_generate or studio_edit (styleId). Give a worldId to see that world’s ' +
        'default style, used when studio_generate is about the world (from). Find the images ' +
        'made in a style with studio_find (styleId).',
      inputSchema: {
        worldId: worldId.optional().describe('A world whose default style to show.'),
      },
      annotations: readOnly,
      handler: (ctx, args) =>
        relay(async () => {
          const list = await styles().list();
          const library = studio.library();
          const body = { styles: [] };
          for (const style of list) body.styles.push(await styleView(style, library));
          if (args.worldId) {
            const found = await reader.loadWorld(args.worldId);
            if (!found) throw new ToolError('World not found. Use list_worlds to see world ids.');
            body.worldId = args.worldId;
            body.defaultStyle = (found.meta.studio && found.meta.studio.styleId) || null;
          }
          return body;
        }),
    },
    {
      name: 'studio_set_style',
      title: 'Make or change a style',
      description:
        'Make a style (name and prompt, optionally reference images), or change one ' +
        '(styleId, and the name, prompt or references to replace). The prompt says how ' +
        'images in the style look ("ink and watercolour on parchment, muted earth tones, ' +
        'hand-lettered names"); the references show it. Give a worldId to make the style ' +
        'that world’s default, or worldId and clearDefault to clear it. Changing a style ' +
        'changes what later images get, not images already made.',
      inputSchema: {
        styleId: STYLE_ID.optional().describe('The style to change, or set as a default.'),
        name: z.string().min(1).max(MAX_NAME).optional().describe('Its name.'),
        prompt: z
          .string()
          .min(1)
          .max(MAX_STYLE_PROMPT)
          .optional()
          .describe('How images in the style look, in words.'),
        references: z
          .array(imageId)
          .max(MAX_STYLE_REFERENCES)
          .optional()
          .describe('Library images that show the style, replacing any it has.'),
        worldId: worldId.optional().describe('A world to make this style the default of.'),
        clearDefault: z
          .boolean()
          .optional()
          .describe('With worldId alone: the world has no default style any more.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: (ctx, args) =>
        relay(async () => {
          const changing = ['name', 'prompt', 'references'].some((k) => args[k] !== undefined);
          if (args.clearDefault) {
            if (!args.worldId) throw new ToolError('Say which world (worldId) to clear.');
            if (changing || args.styleId) {
              throw new ToolError('Clear a world’s default on its own, without a style.');
            }
            const done = await setDefault(ctx.uid, args.worldId, null);
            return { worldId: args.worldId, defaultStyle: null, cleared: done.previous || null };
          }
          const style =
            args.styleId && !changing
              ? await styles().get(args.styleId)
              : await styles().set(ctx.uid, {
                  styleId: args.styleId,
                  name: args.name,
                  prompt: args.prompt,
                  references: args.references,
                });
          const body = {
            style: await styleView(style, studio.library()),
            ...(args.styleId ? {} : { created: true }),
          };
          if (args.worldId) {
            const done = await setDefault(ctx.uid, args.worldId, style.id);
            body.worldId = args.worldId;
            body.defaultStyle = style.id;
            if (done.previous) body.previousDefault = done.previous;
          }
          return body;
        }),
    },
  ];
}

module.exports = { studioTools };
