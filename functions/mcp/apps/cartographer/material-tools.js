'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const catalog = require('../../../loom-canon/materials');
const { worldId } = require('./schemas');
const { relay } = require('./studio-tools');

// The look of a map's data (planning/maps-from-data.md RD1, RD3, OB1; L-925 /
// #729), in the Cartographer connector:
//
//   list_materials     the built-in materials for floors, walls, doors and
//                      windows (fixed: none can be added over MCP)
//   list_object_kinds  the catalog's object kinds, with a world's own, and
//                      where each one's art comes from
//   set_object_art     a world's own art for an object kind, or for a single
//                      object: a library image of kind "object" (a
//                      transparent PNG), through the studio's assigner
//
// An object is drawn with its own art, else its world's art for its kind,
// else the catalog's, else a box with a question mark.

const imageId = z
  .string()
  .regex(/^img_[0-9a-f]{16}$/, 'an image id, like img_0123456789abcdef')
  .describe('The library image (kind object, a transparent PNG), from studio_find.');
const kindId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,60}$/, 'letters, digits, - and _')
  .describe('The object kind: a catalog kind (see list_object_kinds) or one of the world’s own.');
const readOnly = { readOnlyHint: true, openWorldHint: false };

const compact = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function materialTools({ studio, writer, worldFor }) {
  const tools = [
    {
      name: 'list_materials',
      title: 'List materials',
      description:
        'The built-in materials every floor, wall, door and window of a map is made of, each ' +
        'drawn with its own art: ground (floors and terrain, water included), line (rivers and ' +
        'roads), wall, door and window. The set is fixed: a world can’t add one. Name one in ' +
        'a shape’s `material`; any other is refused. A see-through one (glass, bars, a gate) ' +
        'lets sight through but is not walked through; water takes a depth.',
      inputSchema: {
        kind: z
          .enum(catalog.KINDS)
          .optional()
          .describe('Only this kind: ground, line, wall, door or window.'),
      },
      annotations: readOnly,
      handler: (ctx, args) => {
        const list = args.kind ? catalog.materialsOf(args.kind) : catalog.MATERIALS;
        return {
          count: list.length,
          materials: list.map((m) =>
            compact({
              kind: m.kind,
              id: m.id,
              name: m.name,
              seeThrough: m.seeThrough || undefined,
              water: m.water || undefined,
            })
          ),
        };
      },
    },
    {
      name: 'list_object_kinds',
      title: 'List object kinds',
      description:
        'The catalog’s object kinds (chests, tables, barrels, altars, levers…) with their ' +
        'default size in feet. With worldId, the world’s own kinds too (made by set_object_art ' +
        'with a kind of your own), and for each kind where its art comes from in that world: ' +
        '"world" (art given with set_object_art), "catalog" or "unknown" (a box with a ' +
        'question mark). An object’s own art, if it has any, comes before its kind’s.',
      inputSchema: {
        worldId: worldId.optional(),
        group: z.string().max(40).optional().describe('Only this group, like "furniture".'),
      },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const worldKinds = args.worldId ? (await worldFor(args.worldId)).world.objectKinds : null;
        const own = worldKinds || {};
        const ids = [
          ...catalog.OBJECT_KINDS.map((k) => k.id),
          ...Object.keys(own).filter((id) => !catalog.objectKind(id)),
        ];
        const kinds = ids.map((id) => {
          const known = catalog.objectKind(id);
          const mine = own[id] || {};
          return compact({
            id,
            name: mine.name || (known && known.name) || id,
            group: known ? known.group : 'the world’s own',
            size: catalog.sizeFor(id, own),
            blocksMove: known ? known.blocksMove !== false : undefined,
            blocksSight: known ? known.blocksSight === true : undefined,
            ...(args.worldId ? { art: catalog.artFor({ kind: id }, own).from } : {}),
            ownKind: args.worldId && !known ? true : undefined,
          });
        });
        const shown = args.group ? kinds.filter((k) => k.group === args.group) : kinds;
        return {
          count: shown.length,
          objectKinds: shown,
          ...(args.worldId ? { worldId: args.worldId } : {}),
        };
      },
    },
  ];

  if (studio) {
    tools.push({
      name: 'set_object_art',
      title: 'Give an object its own art',
      description:
        'Give a world’s own art to an object kind (every object of that kind in this world, a ' +
        'catalog kind like "chest" or a kind of your own like "ship-wheel") or to a single ' +
        'object on a map (mapId and objectId). The art is a library image of kind "object": a ' +
        'transparent PNG seen from above, made with studio_generate or uploaded. An object is ' +
        'drawn with its own art, else its kind’s from here, else the catalog’s, else a box ' +
        'with a question mark. imageId null takes the art away. For a kind you can also set ' +
        'its name and its default size in feet, which is how a kind of your own is made. ' +
        'Warns when the image’s shape isn’t the object’s.',
      inputSchema: {
        worldId,
        kind: kindId.optional(),
        mapId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,120}$/)
          .optional()
          .describe('With objectId: the map the object is on (a template’s, not its copies).'),
        objectId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,60}$/)
          .optional()
          .describe('With mapId: the object’s id in the map’s geometry.'),
        imageId: imageId
          .nullable()
          .optional()
          .describe('The image, or null to take the art away. Left out, the art is kept.'),
        name: z.string().trim().min(1).max(60).optional().describe('For a kind: its name.'),
        size: z
          .array(z.number().positive().max(100))
          .length(2)
          .optional()
          .describe('For a kind: its default size in feet, [width, depth].'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) =>
        relay(async () => {
          const byKind = args.kind !== undefined;
          const byObject = args.mapId !== undefined || args.objectId !== undefined;
          if (byKind === byObject) {
            throw new ToolError(
              'Give a kind (every object of it in this world) or a mapId and objectId (one object).'
            );
          }
          if (byObject && (!args.mapId || !args.objectId)) {
            throw new ToolError('An object is named by both mapId and objectId.');
          }
          const describes = args.name !== undefined || args.size !== undefined;
          if (byObject && describes) throw new ToolError('name and size are for a kind.');
          if (args.imageId === undefined && !describes) {
            throw new ToolError('Give an imageId (null takes the art away).');
          }
          const target = byKind ? 'objectKind' : 'object';
          const id = byKind ? args.kind : `${args.mapId}/${args.objectId}`;
          const assigned =
            args.imageId === undefined
              ? null
              : await studio.assign(ctx.uid, {
                  worldId: args.worldId,
                  target,
                  id,
                  imageId: args.imageId,
                });
          if (byKind && describes) {
            await writer.edit(args.worldId, ctx.uid, (e) => {
              e.updateWorld(
                compact({
                  [`objectKinds.${id}.name`]: args.name,
                  [`objectKinds.${id}.size`]: args.size,
                })
              );
              return {};
            });
          }
          const warnings = (assigned && assigned.warnings) || [];
          return {
            worldId: args.worldId,
            ...(byKind ? { kind: id } : { object: { mapId: args.mapId, objectId: args.objectId } }),
            name: assigned ? assigned.name : args.name,
            ...(assigned
              ? {
                  art: assigned.image,
                  ...(assigned.previous ? { previous: assigned.previous } : {}),
                }
              : {}),
            ...(describes ? { updated: compact({ name: args.name, size: args.size }) } : {}),
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    });
  }
  return tools;
}

module.exports = { materialTools };
