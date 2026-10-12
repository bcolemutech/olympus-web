'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { worldId, entityId } = require('./schemas');

// The image studio's tools in the Cartographer connector (planning/the-image-
// studio.md §4.4, §4.7; T3: a studio_ prefix). This file starts with
// assigning (L-704 / #540): a world uses library images, by reference, for
// its map, its cover, a town's art and a battle map's art. Finding and
// managing images come in L-703.
//
// The work is the studio's assigner (functions/studio/assign.js), through the
// Cartographer's service, so the page and Claude change worlds the same way.

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
const targetId = entityId('settlement or battle map', 'find_locations or list_battle_maps')
  .optional()
  .describe('The settlement (town) or battle map (battleMap). Not for map or cover.');

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

module.exports = { studioTools };
