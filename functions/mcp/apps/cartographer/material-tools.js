'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const catalog = require('../../../loom-canon/materials');
const levels = require('../../../loom-canon/levels');
const wildEvents = require('../../../loom-modules/wilds/events');
const artSets = require('../../../loom-canon/art-sets');
const { worldId, entityId, wildEncounters } = require('./schemas');
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
//   set_wilds          how a world's ground is crossed off the road (L-361 /
//                      #835; off-road-travel.md §4.1): speed, danger and
//                      impassable per ground material, over the defaults
//   set_encounters     the events that can happen on the way across country
//                      (L-364 / #838; off-road-travel.md §4.5): a table on a
//                      region, a region map or the world
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

// A value as JSON with its keys in order (Firestore keeps maps' in its own), to compare.
const canon = (v) =>
  JSON.stringify(v, (k, x) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((key) => [key, x[key]])
        )
      : x
  );

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
        'through but is not walked through; water takes a depth. Each ground has `wild`: how it ' +
        'is crossed off the road (speed, a factor on the pace; danger, 0.5 calm to 2 deadly; ' +
        'impassable), with the world’s changes (set_wilds) when worldId is given.',
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
            ? (await worldFor(args.worldId)).world.materials || []
            : [];
        const world = args.worldId ? (await worldFor(args.worldId)).world : null;
        // How each ground is crossed off the road (L-361), with the world's
        // overrides (set_wilds).
        const wildOf = (id) => catalog.wildOf(id, world && world.materials, world && world.wilds);
        const rows = list.map((m) =>
          compact({
            kind: m.kind,
            id: m.id,
            name: m.name,
            seeThrough: m.seeThrough || undefined,
            water: m.water || undefined,
            wild: m.kind === 'ground' ? wildOf(m.id) : undefined,
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
              wild: wildOf(m.id),
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

  tools.push({
    name: 'set_wilds',
    title: 'Set how a world’s ground is crossed',
    description:
      'Change how the world’s ground is crossed off the road (L-361; off-road travel): for any ' +
      'ground material, built-in or the world’s own, its `speed` (a factor on the travel pace: ' +
      'grassland 1, forest 0.5, hills 0.6, swamp 0.4, mountains 0.3; above 0, at most 2), its ' +
      '`danger` (0.5 calm to 2 deadly, 1 by default; it raises the odds of trouble on the way) ' +
      'and `impassable` (true: never crossed; ocean, lake, deep water and lava are by default). ' +
      'list_materials with worldId shows each ground’s values as they stand. A world’s own ' +
      'material takes its `like`’s values, and a change to its `like`, unless given its own ' +
      'here. `set` merges by material and key (null takes a key, or a whole material, back to ' +
      'the default). A ground item’s own `cost` slows it further, and cost "never" closes it.',
    inputSchema: {
      worldId,
      set: z
        .record(
          z.string().max(40),
          z
            .object({
              speed: z.number().positive().max(catalog.WILD_SPEED_MAX).nullable().optional(),
              danger: z
                .number()
                .min(catalog.DANGER_MIN)
                .max(catalog.DANGER_MAX)
                .nullable()
                .optional(),
              impassable: z.boolean().nullable().optional(),
            })
            .strict()
            .nullable()
        )
        .describe('By ground material id: { speed?, danger?, impassable? }, or null to reset it.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: (ctx, args) =>
      relay(async () => {
        const ids = Object.keys(args.set || {});
        if (!ids.length) throw new ToolError('Give a material to set.');
        const result = await writer.edit(args.worldId, ctx.uid, (e) => {
          const world = e.world;
          const had = (world.wilds && world.wilds.materials) || {};
          const next = {};
          for (const [id, entry] of Object.entries(had)) next[id] = { ...entry };
          for (const id of ids) {
            const change = args.set[id];
            if (change === null) {
              delete next[id];
              continue;
            }
            const entry = { ...(next[id] || {}) };
            for (const [key, value] of Object.entries(change)) {
              if (value === undefined) continue;
              if (value === null) delete entry[key];
              else entry[key] = value;
            }
            if (Object.keys(entry).length) next[id] = entry;
            else delete next[id];
          }
          const problems = catalog.checkWilds(next, world.materials);
          if (problems.length) throw new ToolError(problems.join(' '));
          e.updateWorld({ wilds: { ...(world.wilds || {}), materials: next } });
          return {
            materials: Object.fromEntries(
              ids.map((id) => [id, catalog.wildOf(id, world.materials, { materials: next })])
            ),
          };
        });
        return {
          worldId: args.worldId,
          materials: result.materials,
          next: 'list_materials with worldId shows every ground’s values.',
        };
      }),
  });

  tools.push({
    name: 'set_encounters',
    title: 'Set the events on the way',
    description:
      'Write the table of events that can happen on the way across country (L-364): after each ' +
      'day’s travel a roll decides whether something happens at the camp (more likely in ' +
      'dangerous ground and regions, and far less likely on a route than off the road), and ' +
      'the event is picked by weight from the ' +
      'first of these with a row that fits the camp’s ground: the camp’s region’s table, ' +
      'then its map’s, then the world’s, then the built-in events. Give exactly one of ' +
      'regionId, mapId (a region map) or world: true. Each row is { what?, text?, kind?, ' +
      'terrain?, path?, count?, weight?, narrated? }: `what` a stat block of the world (figures to ' +
      'meet; list_stat_blocks) and/or `text` what happens, `kind` travellers, creatures, ' +
      'hazard, weather or find (needed with text and no what), `terrain` the ground ' +
      'materials it fits (list_materials; any if left out), `path` the paths it fits ("wild", ' +
      'off the road, or route kinds such as "road", "trail", "sea"; any if left out), `weight` ' +
      'how likely it is. ' +
      'Replaces the whole table; rows [] removes it. A place’s own table is set with ' +
      'update_place and is for its map’s spawns, not these.',
    inputSchema: {
      worldId,
      regionId: entityId('region', 'get_world').optional().describe('Set this region’s table.'),
      mapId: entityId('map', 'list_maps').optional().describe('Set this region map’s table.'),
      world: z.literal(true).optional().describe('Set the world’s table, the fallback.'),
      rows: wildEncounters,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    handler: (ctx, args) =>
      relay(async () => {
        const targets = [args.regionId, args.mapId, args.world].filter((t) => t !== undefined);
        if (targets.length !== 1) {
          throw new ToolError('Give exactly one of regionId, mapId or world: true.');
        }
        const result = await writer.edit(args.worldId, ctx.uid, (e) => {
          const world = e.world;
          const problems = wildEvents.validateRows(world, args.rows);
          if (problems.length) {
            throw new ToolError('Those events won’t do:\n- ' + problems.join('\n- '));
          }
          const rows = args.rows.map((row) => ({ ...row }));
          // Nothing is written when the table is already as given.
          const changes = (next, was) =>
            next.length ? canon(next) !== canon(was) : Boolean(was && was.length);
          const value = rows.length ? rows : FieldValue.delete();
          let on;
          let had;
          if (args.regionId) {
            const region = (world.regions || {})[args.regionId];
            if (!region || region.retired) {
              throw new ToolError(`No region "${args.regionId}". get_world lists them.`);
            }
            on = { regionId: region.id, name: region.name };
            had = region.encounters;
            if (changes(rows, had)) e.update(e.ref('regions', region.id), { encounters: value });
          } else if (args.mapId) {
            const map = levels.mapOf(world, args.mapId);
            if (!map || map.retired || map.kind !== 'region') {
              throw new ToolError(`"${args.mapId}" isn’t a region map. list_maps shows them.`);
            }
            on = { mapId: args.mapId, name: map.name || args.mapId };
            had = map.encounters;
            if (changes(rows, had)) e.update(e.ref('maps', args.mapId), { encounters: value });
          } else {
            on = { world: true };
            had = world.encounters && world.encounters.length ? world.encounters : null;
            if (changes(rows, had)) e.updateWorld({ encounters: value });
          }
          return { on, rows: rows.length, removed: !rows.length && Boolean(had && had.length) };
        });
        return {
          worldId: args.worldId,
          on: result.on,
          rows: result.rows,
          ...(result.removed ? { removed: true } : {}),
          next:
            'A journey across country rolls for an event after each day off the road. ' +
            'get_region, get_map and get_world show the tables.',
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
