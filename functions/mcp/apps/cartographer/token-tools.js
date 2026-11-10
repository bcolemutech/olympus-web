'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { worldId } = require('./schemas');
const tokens = require('../../../loom-canon/tokens');
const statBlocks = require('../../../loom-canon/stat-blocks');
const { tokenFromTool, queueUse } = require('../../../studio/token-use');

// Token pictures in the Cartographer connector (planning/tokens.md §4.1; L-931
// / #789): the picture a person shows on a battle map, in a circular frame.
// set_token gives one to a character, a named stat block or a group of
// figures through the studio's assigner; `tokenInput` is the `token` the
// character, stat block and figure tools take, and `writeToken` keeps it and
// the image's "in use" in the same edit.

const imageId = z
  .string()
  .regex(/^img_[0-9a-f]{16}$/, 'an image id, like img_0123456789abcdef')
  .describe('A library image of kind token or portrait, from studio_find.');

const crop = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    zoom: z.number().optional(),
  })
  .strict()
  .describe(
    'Where the circle sits on the image: x and y its centre (0–1 across and down; 0.5 the ' +
      `middle), zoom how far in (1 fits the circle to the image, up to ${tokens.MAX_ZOOM}). ` +
      'Left out: centred and fitted. Frame a portrait on its face.'
  );

const tokenInput = z
  .strictObject({ image: imageId, crop: crop.optional() })
  .nullable()
  .describe(
    'Their token picture (L-931): { image, crop? }, a library image of kind token or portrait ' +
      'shown in a circular frame on battle maps; null takes it away. A figure shows its ' +
      'group’s, else its character’s, else its stat block’s, else its initials.'
  );

const fail = (message) => new ToolError(message);

/**
 * Keeps a token given to a tool (`given`: { image, crop? }, null, or
 * undefined to leave it) on `holder`, whose stored token is `previous`, inside
 * a writer's edit: returns the token to keep (null to clear it, undefined to
 * leave it), queuing the image's "in use" for `use`.
 */
async function writeToken(e, given, previous, use, where = 'token') {
  if (given === undefined) return undefined;
  const token = await tokenFromTool(e, given, previous, { where, fail });
  queueUse(
    { update: (ref, fields) => e.update(ref, fields), imageRef: e.image },
    use,
    previous,
    token
  );
  return token;
}

/** A token as a tool shows it: the image, its link and its crop. */
function tokenRow(token) {
  return tokens.isToken(token)
    ? { imageId: token.imageId, link: token.link, crop: tokens.cropOf(token) }
    : null;
}

function tokenTools({ studio, worldFor }) {
  if (!studio) return [];
  return [
    {
      name: 'set_token',
      title: 'Give a token picture',
      description:
        'Give a character, a named stat block or a group of placed figures the picture they ' +
        'show on battle maps (L-931): a library image of kind token or portrait, drawn in a ' +
        'circular frame, with a crop to frame the face. A person shows their own (a group’s, ' +
        'or a named character’s), else their stat block’s, so one stat block’s picture is ' +
        'shared by every figure and character that names it. image null takes it away; ' +
        'giving only crop moves the circle on the image it has.',
      inputSchema: {
        worldId,
        target: z
          .enum(['character', 'statBlock', 'figure'])
          .describe('What it is for: a character, a named stat block, or a group of figures.'),
        id: z
          .string()
          .regex(/^[A-Za-z0-9_/-]{1,170}$/)
          .describe(
            'The character’s id, the stat block’s id, or for figures "<mapId>/<groupId>" (the ' +
              'battle map and the group’s id from place_figures).'
          ),
        image: imageId.nullable().optional().describe('The image, or null to take it away.'),
        crop: crop.nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: async (ctx, args) => {
        if (args.image === undefined && args.crop === undefined) {
          throw new ToolError('Give an image (null takes it away), a crop, or both.');
        }
        let image = args.image;
        if (image === undefined) {
          // Only the crop: on the picture it has.
          const { world } = await worldFor(args.worldId);
          const holder = holderToken(world, args.target, args.id);
          if (!holder) throw new ToolError('It has no token yet: give an image with the crop.');
          image = holder.imageId;
        }
        if (image === null && args.crop) throw new ToolError('A crop goes with an image.');
        let done;
        try {
          done = await studio.assign(ctx.uid, {
            worldId: args.worldId,
            target: args.target,
            id: args.id,
            imageId: image,
            ...(args.crop !== undefined ? { crop: args.crop } : {}),
          });
        } catch (err) {
          if (err && typeof err.code === 'string' && err.message) {
            throw new ToolError(err.message);
          }
          throw err;
        }
        const out = {
          worldId: args.worldId,
          target: args.target,
          id: done.id,
          name: done.name,
          token: done.image ? { imageId: done.image.imageId, crop: done.image.crop } : null,
          ...(done.previous && done.previous.imageId
            ? { previous: { imageId: done.previous.imageId } }
            : {}),
        };
        if (args.target === 'statBlock') {
          // Who it reaches: everyone naming the block without a picture of their own.
          const { world } = await worldFor(args.worldId);
          const users = statBlocks.usersOf(world, args.id);
          out.usedBy = {
            characters: users.characters.length,
            groups: users.groups.length,
          };
        }
        return out;
      },
    },
  ];
}

// The token a target holds now, or null.
function holderToken(world, target, id) {
  if (target === 'character') return ((world.characters || {})[id] || {}).token || null;
  if (target === 'statBlock') return ((world.statBlocks || {})[id] || {}).token || null;
  const [mapId, groupId] = String(id).split('/');
  const map = (world.battleMaps || {})[mapId];
  const group = map && (map.figures || []).find((g) => g && g.id === groupId);
  return (group && group.token) || null;
}

module.exports = { tokenTools, tokenInput, writeToken, tokenRow };
