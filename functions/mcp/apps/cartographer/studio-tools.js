'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { worldId, entityId } = require('./schemas');
const { KINDS, summary, normalizeLabels } = require('../../../studio/library');
const { viewLibraryImage } = require('./images');

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

function studioTools({ studio }) {
  const tools = [
    ...assignTools({ studio }),
    ...(studio.library ? libraryTools({ studio }) : []),
    ...(studio.costs ? costTools({ studio }) : []),
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
        'doesn’t fit a battle map’s grid or a town’s square; check it with view_image.',
      inputSchema: { worldId, imageId, target: TARGET, id: targetId },
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

module.exports = { studioTools };
