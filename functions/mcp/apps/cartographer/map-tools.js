'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const maps = require('../../../loom-canon/maps');
const { worldId, entityId } = require('./schemas');
const { helpers } = require('./write-tools');
const views = require('./views');

// The Cartographer's MCP battle-map tools (planning/the-loom-layered-worlds.md
// §9; L-352 / #401): Claude draws the grids that points of interest and places
// in town are walked on (loom-canon/maps.js), and assigns them. They run
// through the same validated, versioned edits as the world tools (writer.js).
//
//   - A map has at least one entry and one exit, every cell it names is on its
//     grid, no two exits share a cell, and no feature sits on an exit (stepping
//     onto an exit leaves by it).
//   - An exit to another map names a live map, and an entry on it that exists;
//     changing a map can't remove an entry another map's exit leads to.
//   - Points of interest and places in town take maps; settlements have towns.
//
// Images can't be sent over MCP: they are uploaded on the Cartographer page.
// Removing a map is retire_entity (type battleMap), in write-tools.js.

const { live, newId, changedFields } = helpers;

const coord = z
  .number()
  .int()
  .min(0)
  .max(maps.MAX_SIDE - 1);
const cellId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'ids are lowercase letters, digits and dashes')
  .describe('Unique on this map, e.g. "front-door". Typed moves name it.');
const label = z.string().trim().min(1).max(60);
const entry = z.strictObject({ id: cellId, x: coord, y: coord });
const feature = z.strictObject({
  id: cellId,
  name: label.describe('As players would say it: "the bar".'),
  x: coord,
  y: coord,
});
const exit = z.strictObject({
  id: cellId,
  name: label.describe('As players would say it: "the front door".'),
  x: coord,
  y: coord,
  to: z
    .union([
      z.literal('out'),
      z.strictObject({
        map: entityId('battle map', 'list_battle_maps'),
        entry: cellId.optional().describe('An entry on that map; its first if left out.'),
      }),
    ])
    .describe('"out" (back to the town, or the world), or { map, entry }: another map.'),
});
const generic = z
  .strictObject({
    kind: z
      .string()
      .trim()
      .toLowerCase()
      .min(2)
      .max(40)
      .describe('What sort of place it fits: tavern, temple, forest-clearing…'),
    terrain: z.string().trim().toLowerCase().min(2).max(40).nullable().optional(),
  })
  .describe('Makes it generic: reusable, assignable to any number of places.');

// Every way a definition can be wrong, against the world it would join.
function checkMap(world, id, def) {
  const cell = (item) => `(${item.x}, ${item.y})`;
  const onGrid = (item) => item.x < def.width && item.y < def.height;
  for (const [list, what] of [
    [def.entries, 'entry'],
    [def.exits, 'exit'],
    [def.features, 'feature'],
  ]) {
    const ids = new Set();
    for (const item of list) {
      if (ids.has(item.id)) throw new ToolError(`Two ${what} ids are "${item.id}".`);
      ids.add(item.id);
      if (!onGrid(item)) {
        throw new ToolError(
          `The ${what} "${item.id}" at ${cell(item)} is off the ${def.width} × ${def.height} grid.`
        );
      }
    }
  }
  const exitAt = new Map();
  for (const e of def.exits) {
    const key = cell(e);
    if (exitAt.has(key)) {
      throw new ToolError(`The exits "${exitAt.get(key)}" and "${e.id}" share the cell ${key}.`);
    }
    exitAt.set(key, e.id);
  }
  for (const f of def.features) {
    if (exitAt.has(cell(f))) {
      throw new ToolError(
        `The feature "${f.id}" sits on the exit "${exitAt.get(cell(f))}" at ${cell(f)}: ` +
          'stepping onto an exit leaves by it, so move the feature.'
      );
    }
  }
  // Exits to other maps (or this one) lead to entries that exist.
  for (const e of def.exits) {
    if (e.to === 'out') continue;
    const target = e.to.map === id ? def : (world.battleMaps || {})[e.to.map];
    if (!target || (e.to.map !== id && target.retired)) {
      throw new ToolError(
        `The exit "${e.id}" leads to "${e.to.map}", which is no live battle map. Use ` +
          'list_battle_maps to see them.'
      );
    }
    if (e.to.entry && !(target.entries || []).some((x) => x.id === e.to.entry)) {
      throw new ToolError(`The exit "${e.id}" leads to an entry "${e.to.entry}" it doesn't have.`);
    }
  }
  // Other maps' exits into this one must still find their entries.
  for (const other of Object.values(world.battleMaps || {})) {
    if (other.id === id || other.retired) continue;
    for (const e of other.exits || []) {
      if (!e.to || e.to === 'out' || e.to.map !== id || !e.to.entry) continue;
      if (!def.entries.some((x) => x.id === e.to.entry)) {
        throw new ToolError(
          `"${e.name}" on ${other.name} (${other.id}) leads to this map's entry ` +
            `"${e.to.entry}", which this change removes. Keep it, or change that exit first.`
        );
      }
    }
  }
}

// A point of interest or a place in town, which takes a battle map.
function mappable(world, id) {
  if ((world.places || {})[id]) return { collection: 'places', entity: live(world, 'place', id) };
  if (world.locations[id]) {
    const location = live(world, 'location', id);
    if ((location.geo || {}).kind === 'settlement') {
      throw new ToolError(
        `${location.name} is a settlement: it has a town, not a battle map. Give one of its ` +
          'places a map (get_town lists them).'
      );
    }
    return { collection: 'locations', entity: location };
  }
  throw new ToolError(
    `No point of interest or place in town "${id}". Use find_locations or get_town to look one up.`
  );
}

function mapTools({ writer }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
  const editNote =
    'Works on drafts and published worlds; a change to a published world reaches games on ' +
    'their next turn.';

  return [
    {
      name: 'set_battle_map',
      title: 'Create or change a battle map',
      description:
        'Draw a battle map: a grid (at most 64 × 64 cells; { x, y } from the top-left, 0-based) ' +
        'with entries (where players arrive: the first, unless an exit names one), exits ' +
        '(stepping onto one leaves by it: "out" to the town or the world, or to an entry on ' +
        'another map, for floors and wings) and features (named cells players can walk to: the ' +
        'bar, the altar). Nothing blocks movement yet. Leave out mapId to make a new map; give ' +
        'it to replace that map’s grid (its image is kept). `generic` makes it reusable for any ' +
        'number of places (a tavern, a forest clearing): it opens a place, but only a place’s ' +
        'own map can make it Rich. Assign maps with assign_battle_map. Images are uploaded on ' +
        'the Cartographer page. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps')
          .optional()
          .describe('The map to replace; leave out to make a new one.'),
        name: label.describe('e.g. "The Gull & Anchor, ground floor".'),
        width: z.number().int().min(1).max(maps.MAX_SIDE),
        height: z.number().int().min(1).max(maps.MAX_SIDE),
        entries: z.array(entry).min(1).max(20),
        exits: z.array(exit).min(1).max(20),
        features: z.array(feature).max(60).optional(),
        generic: generic.nullable().optional(),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const before = args.mapId ? live(world, 'battleMap', args.mapId) : null;
          const id = before ? before.id : newId(world, 'battleMap', 'bm', args.name);
          const def = {
            name: args.name,
            width: args.width,
            height: args.height,
            entries: args.entries,
            exits: args.exits,
            features: args.features || [],
          };
          checkMap(world, id, def);
          const doc = {
            id,
            ...def,
            image: before ? before.image || null : null,
            generic:
              args.generic === undefined ? (before ? before.generic || null : null) : args.generic,
            sources: { map: 'mcp' },
          };
          if (before && before.imageWidth) {
            doc.imageWidth = before.imageWidth;
            doc.imageHeight = before.imageHeight;
          }
          e.set(e.ref('battleMaps', id), doc);
          const result = {
            map: views.battleMapRow(
              { ...world, battleMaps: { ...world.battleMaps, [id]: doc } },
              doc
            ),
          };
          if (!before) result.created = true;
          if (before && (before.width > args.width || before.height > args.height)) {
            result.warnings = [
              'The grid is smaller now: players standing beyond its edge are moved to its entry.',
            ];
          }
          return result;
        }),
    },
    {
      name: 'assign_battle_map',
      title: 'Assign a battle map',
      description:
        'Give a point of interest or a place in town a battle map, its own or a generic one ' +
        '(list_battle_maps). Arriving there in the Loom lands players on it, at its entry. ' +
        'Settlements have towns, not maps: give one of their places a map. mapId null takes ' +
        'the map away. ' +
        editNote,
      inputSchema: {
        worldId,
        placeId: entityId('point of interest or place in town', 'find_locations or get_town'),
        mapId: entityId('battle map', 'list_battle_maps').nullable(),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const { collection, entity } = mappable(world, args.placeId);
          const current = (entity.battleMap && entity.battleMap.mapId) || null;
          const map = args.mapId ? live(world, 'battleMap', args.mapId) : null;
          const fields = {};
          if ((map ? map.id : null) !== current) {
            fields.battleMap = map ? { mapId: map.id } : FieldValue.delete();
            e.update(e.ref(collection, entity.id), fields);
          }
          return {
            place: { id: entity.id, name: entity.name },
            battleMap: map ? { id: map.id, name: map.name, generic: Boolean(map.generic) } : null,
            updated: changedFields(fields),
            ...(map && map.generic
              ? {
                  note:
                    'A generic map opens the place, but only its own map can make it Rich ' +
                    '(set_battle_map, then assign it).',
                }
              : {}),
          };
        }),
    },
  ];
}

module.exports = { mapTools, checkMap };
