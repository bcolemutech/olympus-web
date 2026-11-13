'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const catalog = require('../../../loom-canon/materials');
const artSets = require('../../../loom-canon/art-sets');
const { worldId } = require('./schemas');
const { relay } = require('./studio-tools');

// The look of a map's data (planning/maps-from-data.md RD1, RD3, OB1; L-925 /
// #729), in the Cartographer connector:
//
//   list_materials     the built-in materials for floors, walls, doors and
//                      windows, and with a world its own ground
//   set_world_materials a world's own ground materials (L-713 / #818; worlds-
//                      without-azgaar.md R2): an id, a name, the built-in
//                      ground it behaves as and art of its own, through the
//                      studio's assigner (target `material`)
//   list_object_kinds  the catalog's object kinds, with a world's own, and
//                      where each one's art comes from
//   list_art_sets      the art sets a world's maps can be drawn with (L-944)
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
        'roads), wall, door and window. The built-in set is fixed, but a world can add ground ' +
        'of its own (set_world_materials): give worldId and its own come with the built-in ' +
        'ground, each marked `own` with the built-in one it is `like`. Name one in a shape’s ' +
        '`material`; any other is refused. A see-through one (glass, bars, a gate) lets sight ' +
        'through but is not walked through; water takes a depth.',
      inputSchema: {
        worldId: worldId.optional().describe('Also this world’s own ground materials.'),
        kind: z
          .enum(catalog.KINDS)
          .optional()
          .describe('Only this kind: ground, line, wall, door or window.'),
      },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const list = args.kind ? catalog.materialsOf(args.kind) : catalog.MATERIALS;
        const mine =
          args.worldId && (!args.kind || args.kind === 'ground')
            ? (await worldFor(args.worldId)).world.materials
            : [];
        const rows = list.map((m) =>
          compact({
            kind: m.kind,
            id: m.id,
            name: m.name,
            seeThrough: m.seeThrough || undefined,
            water: m.water || undefined,
          })
        );
        for (const m of mine) {
          const like = catalog.materialOf('ground', m.like);
          rows.push(
            compact({
              kind: 'ground',
              id: m.id,
              name: m.name,
              water: (like && like.water) || undefined,
              own: true,
              like: m.like,
              art: m.art && m.art.imageId ? m.art.imageId : undefined,
            })
          );
        }
        return {
          count: rows.length,
          materials: rows,
          ...(args.worldId ? { worldId: args.worldId } : {}),
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
        'question mark). An object’s own art, if it has any, comes before its kind’s. The ' +
        'decor group (rubble, bones, candles, cobwebs, sacks, a pile of crates, a tapestry, a ' +
        'banner, a plant, books, bottles, straw, a puddle, chains; L-945) only dresses a room: ' +
        'no click menu, never noticed or searched, and blocking movement only when over 2.5 ft ' +
        'both ways (blocksMove false: never, a flat one like straw); onWall ones hang on a ' +
        'wall. dress_room fills a zone with them.',
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
            // Decor only dresses a room (L-945): its blocksMove is for big pieces only.
            decor: known && known.decor ? true : undefined,
            onWall: known && known.onWall ? true : undefined,
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
    {
      name: 'list_art_sets',
      title: 'List art sets',
      description:
        'The art sets a world’s maps can be drawn with (L-944): each a set of painted ' +
        'pictures for the built-in materials and object kinds, in a three-quarter view: ' +
        'floors and their variants, wall tops and faces, doors, windows, lines, and objects ' +
        'standing. "classic" is the built-in one and the default; anything a set lacks is ' +
        'drawn with the built-in art. Each set says how much it paints. With worldId, which ' +
        'set that world uses. Choose one with update_world (art.set).',
      inputSchema: { worldId: worldId.optional() },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const out = { sets: artSets.listSets() };
        if (args.worldId) {
          const { meta } = await worldFor(args.worldId);
          const art = artSets.setFor(meta);
          out.worldId = args.worldId;
          out.world = { set: art.name, ...(art.warning ? { warning: art.warning } : {}) };
        }
        return out;
      },
    },
  ];

  tools.push({
    name: 'set_world_materials',
    title: 'Set a world’s own ground materials',
    description:
      'Add ground of the world’s own to the built-in set (L-713), like an "ashwaste" the list ' +
      'lacks: { id, name, like, imageId? }. `like` is the built-in ground material it behaves ' +
      'as (list_materials kind ground: its water, its cost on a map) and is drawn as when it has ' +
      'no art of its own; `imageId` is its art, a library image of kind "other" (a seamless ' +
      'tile made with studio_generate or uploaded; null takes the art away, left out keeps it). ' +
      'Once set, name its id in a ground item’s `material` (set_ground). The id is lower-case ' +
      'letters, digits and -, and can’t be a built-in ground’s; a `like` that isn’t a built-in ' +
      'ground is refused. `set` adds or changes (by id); `remove` takes materials away, refused ' +
      'while any map’s ground still uses one.',
    inputSchema: {
      worldId,
      set: z
        .array(
          z.object({
            id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'lower-case letters, digits and -'),
            name: z.string().trim().min(1).max(60).optional(),
            like: z.string().max(40).optional(),
            imageId: imageId.nullable().optional(),
          })
        )
        .max(50)
        .optional()
        .describe('The materials to add or change.'),
      remove: z.array(z.string().max(40)).max(50).optional().describe('Ids to take away.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    handler: (ctx, args) =>
      relay(async () => {
        const set = args.set || [];
        const remove = args.remove || [];
        if (!set.length && !remove.length) throw new ToolError('Give something to set or remove.');
        const { world } = await worldFor(args.worldId);
        const mine = world.materials || [];
        const byId = new Map(mine.map((m) => [m.id, m]));
        for (const id of remove) {
          if (!byId.has(id)) throw new ToolError(`No material "${id}" of this world’s own.`);
          if (set.some((m) => m.id === id)) throw new ToolError(`"${id}" is set and removed.`);
        }
        // Material in use can't go.
        const homes = [
          ...Object.entries(world.maps || {}),
          ...Object.entries(world.battleMaps || {}),
        ];
        for (const id of remove) {
          const user = homes.find(
            ([, doc]) =>
              doc &&
              !doc.retired &&
              ((doc.geometry || {}).ground || []).some((g) => g && g.material === id)
          );
          if (user) {
            throw new ToolError(
              `"${id}" is still the ground of ${user[1].name || user[0]}: change that ground first (set_ground).`
            );
          }
        }
        const next = [];
        for (const m of mine) if (!remove.includes(m.id)) next.push(m);
        for (const m of set) {
          const at = next.findIndex((n) => n.id === m.id);
          const was = at >= 0 ? next[at] : null;
          const name = m.name || (was && was.name);
          const like = m.like || (was && was.like);
          if (!name || !like) {
            throw new ToolError(`A new material ("${m.id}") needs a name and a like.`);
          }
          const entry = { ...(was || {}), id: m.id, name, like };
          if (at >= 0) next[at] = entry;
          else next.push(entry);
        }
        const problems = catalog.checkOwn(next);
        if (problems.length) throw new ToolError(problems.join(' '));
        // Art that goes with a material goes from the image's uses first.
        if (studio) {
          for (const id of remove) {
            if (byId.get(id).art && byId.get(id).art.imageId) {
              await studio.assign(ctx.uid, {
                worldId: args.worldId,
                target: 'material',
                id,
                imageId: null,
              });
            }
          }
        }
        await writer.edit(args.worldId, ctx.uid, (e) => {
          e.updateWorld({ materials: next });
          return {};
        });
        const warnings = [];
        for (const m of set) {
          if (m.imageId === undefined) continue;
          if (!studio) continue;
          const done = await studio.assign(ctx.uid, {
            worldId: args.worldId,
            target: 'material',
            id: m.id,
            imageId: m.imageId,
          });
          warnings.push(...(done.warnings || []));
        }
        const after = (await worldFor(args.worldId)).world.materials || [];
        return {
          worldId: args.worldId,
          count: after.length,
          materials: after.map((m) =>
            compact({
              id: m.id,
              name: m.name,
              like: m.like,
              art: m.art && m.art.imageId ? m.art.imageId : undefined,
            })
          ),
          ...(remove.length ? { removed: remove } : {}),
          ...(warnings.length ? { warnings } : {}),
        };
      }),
  });

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
