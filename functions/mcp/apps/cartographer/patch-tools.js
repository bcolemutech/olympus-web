'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const geo = require('../../../loom-canon/map-geometry');
const patcher = require('../../../loom-canon/geometry-patch');
const mapPaths = require('../../../loom-canon/map-paths');
const scale = require('../../../loom-canon/scale');
const { worldId, entityId } = require('./schemas');
const mapTools = require('./map-tools');
const realms = require('../../../loom-canon/realms');

// Patching a map's shapes by id (planning/maps-from-data.md §4.8; L-929 /
// #733, #735 gap 17). Claude builds a map from data with one tool a kind of
// shape, each taking `{ mapId, set, remove }`: `set` adds a shape or changes
// the one with its id (only the fields given; null takes one away), `remove`
// takes shapes away by id (../../../loom-canon/geometry-patch.js). Each is
// checked by map-geometry.js with the rest of the map, and nothing is
// written if any part is refused.
//
//   set_ground, set_lines, set_walls, set_doors, set_windows, set_objects,
//   set_zones, set_spawns, set_lights, set_notes, set_hidden
//                      a grid's geometry (a battle map's), or a region or area
//                      map's made with add_map
//   set_features, set_entries, set_exits
//                      a grid's named spots, ways in and ways out, by id
//   get_geometry       what a map has, to patch it
//
// A patch never bumps a map's `revision`, so a save keeps what it has seen of
// the map: moving one exit doesn't make players forget the rest (replacing a
// grid with set_battle_map, set_grid or set_map_layers still does, loom-turn/
// seen.js). Images can't be sent over MCP: art is uploaded on the Cartographer
// page.

const FEET = mapPaths.FEET;
const readOnly = { readOnlyHint: true, openWorldHint: false };
const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
const editNote =
  'Works on drafts and published worlds; a change to a published world reaches games on ' +
  'their next turn.';

const itemId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'ids are lowercase letters, digits and dashes')
  .describe('Unique across the map’s shapes: "north-wall", "cellar-door".');
const idList = z.array(itemId).max(100);

const UNITS =
  'Feet on a grid (a square is 5 ft; 0, 0 is the top-left), the map’s own units on a region or ' +
  'area map. Points are [x, y]; a shape (an area) is a list of points, SVG path data ' +
  '("M0 0 H10 V10 H0 Z"), { circle: { x, y, r } } or { rect: { x, y, w, h } }. ';
const PATCH =
  'A patch: `set` adds a shape, or changes the one with its id (only the fields you give; ' +
  'null takes one away), so moving a door sends its id and its new ends; a shape with no id ' +
  'is given one (in `added`). `remove` takes shapes away by id. Ids are unique across a ' +
  'map’s shapes. All checked together with the rest of the map: nothing is written if any is ' +
  'refused, and the reason is said. It never makes players forget what they have seen. ' +
  'get_geometry shows what a map has, view_image draws it. ';

// The tools over a map's geometry: one a list.
const SHAPES = [
  {
    tool: 'set_ground',
    key: 'ground',
    title: 'Set ground',
    what:
      'Floors and terrain: polygons, a later one over an earlier. Fields: id, material (a ' +
      'ground material, list_materials), shape, height? (the floor’s height in feet, may be ' +
      'below 0), cost? (a multiple of the AP for moving, 1 or more, or "never"), depth? ' +
      '(water’s depth).',
  },
  {
    tool: 'set_lines',
    key: 'lines',
    title: 'Set lines',
    what:
      'Rivers, roads, streets, pipes: lines drawn on the floor. Fields: id, material (a line ' +
      'material, list_materials), points, width? (feet).',
  },
  {
    tool: 'set_walls',
    key: 'walls',
    title: 'Set walls',
    what:
      'Walls: polylines at any angle, not only along grid lines. Fields: id, material (a ' +
      'wall material, list_materials), points, height? (feet; a low wall is seen over), ' +
      'blocksMove?, blocksSight? (a glass wall or a gate blocks movement only, by its ' +
      'material). A door or window is set in a wall (set_doors, set_windows).',
  },
  {
    tool: 'set_doors',
    key: 'doors',
    title: 'Set doors',
    what:
      'Doors: a segment lying in a wall, which it replaces there. Fields: id, material (a ' +
      'door material), from, to (its two ends, on the wall), wall? (the wall’s id), name?, ' +
      'state? (open, closed, or locked), unlocks? ({ key?: the inventory item, action?: ' +
      'an object’s id or "id.action", the lever whose use unlocks it }), ap?, long? ({ ap }), ' +
      'difficulty? (how hard its lock is to pick, 5 to 30), seeThrough?.',
  },
  {
    tool: 'set_windows',
    key: 'windows',
    title: 'Set windows',
    what:
      'Windows: a segment lying in a wall, never walked through, seen through by its ' +
      'material (glass) or when open. Fields: id, material (a window material), from, to, ' +
      'wall?, state? (open or closed), seeThrough?.',
  },
  {
    tool: 'set_objects',
    key: 'objects',
    title: 'Set objects',
    what:
      'Objects: furniture, chests, levers. Fields: id, kind (a catalog kind, list_object_' +
      'kinds, or the world’s own), at (its centre), size ([w, h] feet), turn? (degrees), ' +
      'height?, name?, blocksMove?, blocksSight?; art is set with set_object_art. One you ' +
      'can use has settings: description?, container? ({ contents?: what it holds, ' +
      'search?: opening it is searching it }), locked?, unlocks? ({ key?, action? }), ' +
      'difficulty?, ap?, long? ({ ap }), actions? ([{ id, name?, ap?, long?, text? }], its ' +
      'own: a lever’s Pull). An object with none of these is scenery. `decor: true` (the ' +
      'catalog’s decor kinds are decor already; dress_room fills a room with them) only ' +
      'dresses a room: no click menu, never noticed or searched, and it blocks movement only ' +
      'when over 2.5 ft both ways. An object under half or over twice its kind’s usual size, ' +
      'or going into a wall, is said in the answer’s warnings, and kept.',
  },
  {
    tool: 'set_zones',
    key: 'zones',
    title: 'Set zones',
    what:
      'Zones: named or unnamed areas (the cellar, the dais), for the narrator and for what ' +
      'happens in them. Fields: id, name?, shape, region? (on a region map: the id of the ' +
      'world’s region it shapes, add_regions; a region’s land is its zones, a realm’s its ' +
      'regions’, and a place is in the topmost zone naming a region where it sits; null takes ' +
      'it away).',
  },
  {
    tool: 'set_spawns',
    key: 'spawns',
    title: 'Set spawns',
    what:
      'Spawns: where figures appear when an event fills the map (a rest broken somewhere ' +
      'dangerous). Fields: id, name?, at (a point) or shape (an area), what? (a stat block ' +
      'of the world, list_stat_blocks; none makes it generic: the place’s encounters table ' +
      'fills it, update_place or update_location), count? (1 to 50).',
  },
  {
    tool: 'set_lights',
    key: 'lights',
    title: 'Set lights',
    what:
      'Lights: a source, { id, at, radius, dim? } (feet), or a dark area, { id, shape, ' +
      'dark: true }.',
  },
  {
    tool: 'set_notes',
    key: 'notes',
    title: 'Set notes',
    what:
      'Notes for the narrator, never shown to players: sounds, smells, writing on a wall. ' +
      'Fields: id, text, at? or shape?, sense? (hearing, smell…).',
  },
  {
    tool: 'set_hidden',
    key: 'hidden',
    title: 'Set hidden things',
    what:
      'What is hidden until a save finds it (L-927), by passive check or Search: a secret ' +
      'door, a hidden cache. An item names a wall, line, door, window, object or ground ' +
      'that is in the geometry: { id, dc? } (dc: a number on the d20 scale, or a rung’s name; ' +
      'Moderate if left out). `remove` makes a thing plain to everyone. A trap is a ' +
      'hazard’s own hidden setting (set_hazards).',
  },
];

// Which map holds a geometry, and how big it is (the geometry's units).
function homeOf(world, mapId) {
  const grid = (world.battleMaps || {})[mapId];
  if (grid && !grid.retired) {
    return {
      collection: 'battleMaps',
      doc: grid,
      kind: 'grid',
      bounds: { width: grid.width * FEET, height: grid.height * FEET },
      units: 'feet',
    };
  }
  const stored = (world.maps || {})[mapId];
  if (stored && !stored.retired && ['region', 'area'].includes(stored.kind) && stored.space) {
    return {
      collection: 'maps',
      doc: stored,
      kind: stored.kind,
      bounds: { width: stored.space.width, height: stored.space.height },
      units: 'map units',
    };
  }
  throw new ToolError(
    `"${mapId}" is no grid, or region or area map made with add_map (list_maps shows them). ` +
      'A world map or town in today’s shape has no document of its own: a town takes ' +
      'set_town_ground.'
  );
}

const counts = (geometry) =>
  Object.fromEntries(
    geo.LISTS.filter((k) => (geometry[k] || []).length).map((k) => [k, geometry[k].length])
  );

// A zod parse as the reasons it failed, each naming its item.
function reasons(error, where) {
  return error.issues.map(
    (i) => `${where}${i.path.length ? '.' + i.path.join('.') : ''}: ${i.message}`
  );
}

function patchTools({ writer, worldFor }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);

  const shapeTool = ({ tool, key, title, what }) => ({
    name: tool,
    title,
    description:
      what + ' ' + UNITS + PATCH + 'A map’s ' + key + ' list holds at most 500. ' + editNote,
    inputSchema: {
      worldId,
      mapId: entityId('grid, region or area map', 'list_maps'),
      set: z
        .array(z.object({ id: itemId.optional() }).passthrough())
        .max(100)
        .optional()
        .describe(`The ${patcher.NAMES[key]}s to add or change: { id?, ...fields }.`),
      remove: idList.optional().describe('Ids to take away.'),
    },
    annotations: replacing,
    handler: (ctx, args) =>
      edit(ctx, args, (e) => {
        const { world } = e;
        if (!(args.set || []).length && !(args.remove || []).length) {
          throw new ToolError('Give something to set or remove.');
        }
        const home = homeOf(world, args.mapId);
        const done = patcher.patch(
          home.doc.geometry,
          key,
          { set: args.set, remove: args.remove },
          home.bounds,
          world.materials
        );
        // A zone naming a region (L-712): on a region map, a region the world has.
        if (!done.problems && key === 'zones') {
          const touched = new Set([...done.added, ...done.changed]);
          const named = (done.geometry.zones || []).filter(
            (z) => touched.has(z.id) && z.region !== undefined
          );
          if (named.length && home.kind !== 'region') {
            done.problems = [
              `zones.${named[0].id}: only a zone on a region map names a region; this is ` +
                `${home.kind === 'grid' ? 'a grid' : 'an area map'}.`,
            ];
          } else {
            const problems = realms.zoneProblems(world, named);
            if (problems.length) done.problems = problems;
          }
        }
        if (done.problems) {
          throw new ToolError(
            `That won’t do for ${home.doc.name}: ${done.problems.slice(0, 10).join(' ')}`
          );
        }
        const empty = !Object.keys(done.geometry).length;
        e.update(e.ref(home.collection, args.mapId), {
          geometry: empty ? FieldValue.delete() : done.geometry,
        });
        const warnings =
          home.kind === 'grid'
            ? [
                ...mapTools.layerWarnings({ ...home.doc, geometry: done.geometry }),
                ...mapTools.standingWarnings(world, { ...home.doc, geometry: done.geometry }),
                // What's out of scale in what was just set (L-945).
                ...(key === 'objects'
                  ? scale.warnings(done.geometry, {
                      worldKinds: world.objectKinds,
                      only: [...done.added, ...done.changed],
                    })
                  : []),
              ]
            : [];
        return {
          map: { mapId: args.mapId, name: home.doc.name, kind: home.kind },
          list: key,
          added: done.added,
          changed: done.changed,
          removed: done.removed,
          ...(done.unhidden ? { unhidden: done.unhidden } : {}),
          counts: counts(done.geometry),
          ...(warnings.length ? { warnings } : {}),
        };
      }),
  });

  // A grid's named spots, ways in and ways out, patched by id the same way.
  const POINTS = [
    {
      tool: 'set_features',
      key: 'features',
      label: 'feature',
      schema: mapTools.shapes.feature,
      what:
        'Features: named spots players act on (the lever, the altar), { id, name, x, y, ap?, ' +
        'long? }, squares on a grid. Not on an exit.',
    },
    {
      tool: 'set_entries',
      key: 'entries',
      label: 'entry',
      schema: mapTools.shapes.entry,
      what:
        'Entries: where players arrive, { id, x, y }, squares. A grid keeps at least one, ' +
        'and one another map’s exit leads to can’t be removed.',
    },
    {
      tool: 'set_exits',
      key: 'exits',
      label: 'exit',
      schema: mapTools.shapes.exit,
      what:
        'Exits: stepping onto one leaves by it, { id, name, x, y, to }, `to` "out" (to the ' +
        'town or the world) or { map, entry } (another grid, for floors and wings). A grid ' +
        'keeps at least one, and no two share a square.',
    },
  ];
  const pointTool = ({ tool, key, label, schema, what }) => ({
    name: tool,
    title: `Set ${key}`,
    description:
      what +
      ' A patch: `set` adds one, or changes the one with its id (only the fields you give), ' +
      'so moving an exit sends its id and its new square; `remove` takes them away by id. ' +
      'Checked with the rest of the map, and nothing is written if any is refused. Unlike ' +
      'set_battle_map and set_grid, it never makes players forget what they have seen of the ' +
      'map. ' +
      editNote,
    inputSchema: {
      worldId,
      mapId: entityId('grid', 'list_maps'),
      set: z
        .array(z.object({ id: itemId }).passthrough())
        .max(60)
        .optional()
        .describe(`The ${key} to add or change: { id, ...fields }; a new one needs them all.`),
      remove: idList.optional().describe('Ids to take away.'),
    },
    annotations: replacing,
    handler: (ctx, args) =>
      edit(ctx, args, (e) => {
        const { world } = e;
        if (!(args.set || []).length && !(args.remove || []).length) {
          throw new ToolError('Give something to set or remove.');
        }
        const before = (world.battleMaps || {})[args.mapId];
        if (!before || before.retired) {
          throw new ToolError(`"${args.mapId}" is no grid. list_maps shows the grids.`);
        }
        const done = patcher.patchPoints(
          before[key] || [],
          { set: args.set, remove: args.remove },
          label
        );
        if (done.problems) throw new ToolError(done.problems.slice(0, 10).join(' '));
        // Each as a whole one is: the fields given over what it had.
        const problems = done.items.flatMap((item, i) => {
          const parsed = schema.safeParse(item);
          return parsed.success ? [] : reasons(parsed.error, `${key}[${i}] "${item.id}"`);
        });
        if (problems.length) throw new ToolError(problems.slice(0, 10).join(' '));
        if (['entries', 'exits'].includes(key) && !done.items.length) {
          throw new ToolError(`A map keeps at least one ${label}.`);
        }
        const def = {
          name: before.name,
          width: before.width,
          height: before.height,
          entries: before.entries || [],
          exits: before.exits || [],
          features: before.features || [],
          [key]: done.items,
        };
        mapTools.checkMap(world, args.mapId, def);
        e.update(e.ref('battleMaps', args.mapId), { [key]: done.items });
        const after = { ...before, [key]: done.items };
        const warnings = [
          ...mapTools.layerWarnings(after),
          ...mapTools.standingWarnings(world, after),
        ];
        return {
          map: { mapId: args.mapId, name: before.name, kind: 'grid' },
          list: key,
          added: done.added,
          changed: done.changed,
          removed: done.removed,
          [key]: done.items,
          ...(warnings.length ? { warnings } : {}),
        };
      }),
  });

  return [
    ...SHAPES.map(shapeTool),
    ...POINTS.map(pointTool),
    {
      name: 'get_geometry',
      title: 'Get a map’s geometry',
      description:
        'What a map is made of, to patch it by id: its ground, lines, walls, doors, windows, ' +
        'objects, zones, spawns, lights, notes and hidden things, as stored (a shape’s points ' +
        'are SVG path data, "M0 0L30 0"; hidden things as { id, dc? }), with the size of the map ' +
        'and each list’s count. For a grid, a map in get_battle_map or get_map; a region or ' +
        'area map made with add_map too. Hidden things are shown here, to you only.',
      inputSchema: {
        worldId,
        mapId: entityId('grid, region or area map', 'list_maps'),
        lists: z
          .array(z.enum(geo.LISTS))
          .max(geo.LISTS.length)
          .optional()
          .describe('Only these lists; all if left out.'),
      },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const { world } = await worldFor(args.worldId);
        const home = homeOf(world, args.mapId);
        const geometry = home.doc.geometry || {};
        const wanted = args.lists || geo.LISTS;
        return {
          map: { mapId: args.mapId, name: home.doc.name, kind: home.kind },
          bounds: { ...home.bounds, units: home.units },
          counts: counts(geometry),
          geometry: Object.fromEntries(
            wanted.filter((k) => geometry[k]).map((k) => [k, geometry[k]])
          ),
        };
      },
    },
  ];
}

module.exports = { patchTools, homeOf, SHAPES };
