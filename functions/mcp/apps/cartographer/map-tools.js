'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const maps = require('../../../loom-canon/maps');
const positions = require('../../../loom-canon/positions');
const layers = require('../../../loom-canon/layers');
const areas = require('../../../loom-canon/areas');
const hazards = require('../../../loom-canon/hazards');
const { systemOf } = require('../../../loom-canon/checks');
const { worldId, entityId } = require('./schemas');
const { helpers } = require('./write-tools');
const views = require('./views');
const figures = require('../../../loom-modules/combat/figures');

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
//   - Walls, doors and obstacles (L-622 / #447; loom-canon/layers.js) pass its
//     checks: on the grid and its lines, nothing blocking an entry or exit,
//     every entry able to reach an exit. Given with the grid, or alone with
//     set_map_layers; replacing a grid without them keeps them.
//   - Characters standing on a map (L-641) are warned about when a change
//     leaves them off the grid or on something they can't stand on. Giving a
//     place another map, or none, moves its characters to a position there
//     (L-682): a free square near the new map's entry, or the place's door in
//     town; a point of interest without a map needs none.
//
//   - Hazards (L-815; loom-canon/hazards.js): a gas cloud, a fire, thorns, set
//     with set_hazards: an area on the grid, the effect it puts on (one of the
//     world's system's conditions, with how long and its save), checked
//     against the map and the system. Replacing a grid keeps them, warning
//     about any that no longer fit it.
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
// Layers (L-622): corners are the grid points between squares, so square
// (x, y) runs from corner (x, y) to (x + 1, y + 1), as in SVG art.
const corner = z.number().int().min(0).max(maps.MAX_SIDE);
const point = z.strictObject({ x: corner, y: corner });
const wall = z
  .strictObject({
    points: z
      .array(point)
      .min(2)
      .max(200)
      .describe('Corners along the grid lines, each run straight across or down.'),
  })
  .describe('A wall: a line along the grid lines, between squares.');
const door = z.strictObject({
  id: cellId,
  name: label.describe('As players would say it: "the cellar door".'),
  from: point.describe('One end: a corner.'),
  to: point.describe('The other end: the next corner along the grid line (one square long).'),
  locked: z.boolean().optional().describe('Locked doors stop players until opened.'),
  key: label.optional().describe('The inventory item that opens it when locked.'),
  difficulty: z
    .number()
    .int()
    .min(5)
    .max(30)
    .optional()
    .describe('How hard its lock is to pick or force (a d20 roll must reach it); 15 if left out.'),
});
const obstacle = z.strictObject({
  id: cellId,
  name: label.describe('As players would say it: "the bar", "a pillar".'),
  kind: z
    .enum(layers.KINDS)
    .describe(
      'solid blocks movement and sight (a pillar); low blocks movement only (a table, the bar, ' +
        'a pit); difficult costs 2 movement a square (rubble, mud).'
    ),
  x: coord,
  y: coord,
  w: z
    .number()
    .int()
    .min(1)
    .max(maps.MAX_SIDE)
    .optional()
    .describe('Squares across; 1 if left out.'),
  h: z.number().int().min(1).max(maps.MAX_SIDE).optional().describe('Squares down; 1 if left out.'),
});
// Hazards (L-815): an area, the effect it puts on, and its save.
const hazardArea = z
  .strictObject({
    shape: z
      .enum(['burst', 'cone', 'line', 'square'])
      .describe(
        'burst: every square within radius (a diagonal step counts one, so a square of ' +
          'squares); cone: a 90° wedge out from beside the origin, length long, toward facing; ' +
          'line: a strip out from beside the origin, length long and width wide (1); square: ' +
          'size × size squares with the origin its top-left.'
      ),
    x: coord.describe('The origin square.'),
    y: coord,
    radius: z.number().int().min(1).max(areas.MAX_REACH).optional().describe('burst'),
    length: z.number().int().min(1).max(areas.MAX_REACH).optional().describe('cone, line'),
    width: z.number().int().min(1).max(areas.MAX_REACH).optional().describe('line; 1 if left out'),
    size: z.number().int().min(1).max(areas.MAX_REACH).optional().describe('square'),
    facing: z.enum(Object.keys(areas.FACINGS)).optional().describe('cone, line (north is up)'),
  })
  .describe(
    'Squares whose centre is inside, in line of effect from the origin: walls and closed ' +
      'doors stop it.'
  );
const hazardEffect = z.strictObject({
  condition: z
    .string()
    .min(1)
    .max(40)
    .describe("One of the world's system's conditions (get_system: sheet.conditions)."),
  duration: z
    .union([
      z.strictObject({ rounds: z.number().int().min(1).max(100) }),
      z.strictObject({ turns: z.number().int().min(1).max(100) }),
      z.strictObject({
        seconds: z
          .number()
          .int()
          .min(1)
          .max(30 * 86400),
      }),
      z.strictObject({ untilSaved: z.literal(true) }),
    ])
    .describe(
      '{ turns } (End turn ticks them; a round is a turn until combat), { seconds } of game ' +
        'time, or { untilSaved: true } (needs a save at the end of each turn).'
    ),
  save: z
    .strictObject({
      skill: z.string().min(1).max(40).optional(),
      attribute: z.string().min(1).max(40).optional(),
      against: z
        .union([z.string().min(1).max(200), z.number()])
        .describe(
          'A rung of the ladder ("Moderate"), a number on the d20 scale locks use (placed on ' +
            "the system's ladder), or a formula."
        ),
      when: z
        .union([z.enum(['apply', 'endOfTurn']), z.array(z.enum(['apply', 'endOfTurn'])).min(1)])
        .describe('apply: rolled when it lands, to resist it; endOfTurn: to shake it off.'),
    })
    .optional()
    .describe('The check the character rolls against it (their skill or attribute).'),
});
const hazard = z.strictObject({
  id: cellId,
  name: label.describe('As players would say it: "the gas", "the burning oil".'),
  description: z
    .string()
    .trim()
    .max(300)
    .optional()
    .describe('What it looks like, for the narrator: "a yellow fog, low to the floor".'),
  area: hazardArea,
  effect: hazardEffect,
});

// Figures placed from a stat block (L-824; loom-modules/combat/figures.js).
const figureGroup = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
    .describe('The group’s id: lowercase letters, digits and dashes ("bandits").'),
  name: label.describe('What one is called: "Bandit". Several are numbered: "Bandit 3".'),
  description: z.string().trim().max(300).optional().describe('What they look like.'),
  statBlock: z
    .object({})
    .passthrough()
    .describe(
      'Their stat block, as set_sheet takes it: { attributes (every one), skills?, ' +
        'resources?, level?, traits?, attacks? }.'
    ),
  side: z.enum(figures.SIDES).optional().describe('hostile (the default), party or neutral.'),
  role: z
    .enum(figures.ROLES)
    .optional()
    .describe('How they fight (default: archer with a ranged attack, else brute).'),
  posture: z
    .enum(figures.POSTURES)
    .optional()
    .describe('How much risk they take (default steady).'),
  leader: z.boolean().optional().describe('Whether their fall shakes the rest.'),
  cells: z
    .array(z.strictObject({ x: coord, y: coord }))
    .min(1)
    .max(20)
    .describe('The squares they stand on: one figure each.'),
});

// A map's hazards against the world's system (loom-canon/hazards.js): its
// errors as one tool error, its warnings returned.
function checkHazards(world, map, list) {
  const { errors, warnings } = hazards.validate(systemOf(world), map, list);
  if (errors.length) throw new ToolError(errors.join(' '));
  return warnings;
}

const LAYER_SHAPES = {
  walls: z.array(wall).max(200),
  doors: z.array(door).max(60),
  obstacles: z.array(obstacle).max(200),
};

// The layers' checks (loom-canon/layers.js), as one tool error.
function checkLayers(map) {
  const problems = layers.check(map);
  if (problems.length) throw new ToolError(problems.join(' '));
}

// What to warn about once a map's layers pass: none at all, and features
// nobody can get to (on or beside them) from an entry.
function layerWarnings(map) {
  if (!layers.hasLayers(map)) {
    return [
      'It has no walls, doors or obstacles: players walk anywhere on it, and a place with it ' +
        'as its own map earns only half its score for a map. Add them with set_map_layers.',
    ];
  }
  const reached = layers.reachable(map, map.entries || []);
  const near = (f) =>
    [-1, 0, 1].some((dx) => [-1, 0, 1].some((dy) => reached[`${f.x + dx},${f.y + dy}`]));
  return (map.features || [])
    .filter((f) => !near(f))
    .map((f) => `Nobody can reach ${f.name} at (${f.x}, ${f.y}) from an entry: it's walled in.`);
}

// Characters a changed map leaves where nobody can stand (L-641).
function standingWarnings(world, map) {
  const after = { ...world, battleMaps: { ...world.battleMaps, [map.id]: map } };
  return maps.standingOn(after, map).flatMap(({ character, host, cell }) => {
    const problem = maps.squareProblem(after, map, host, cell, character.id);
    return problem
      ? [
          `${character.name} (${character.id}) stands where they can't: ${problem}. Move them ` +
            'with update_character (cell).',
        ]
      : [];
  });
}

const layerCounts = (map) => ({
  walls: (map.walls || []).length,
  doors: (map.doors || []).length,
  obstacles: (map.obstacles || []).length,
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

// Everyone at a place whose map changes is given a position that fits the
// new one (L-682): squares on the old map mean nothing on the new. Each is
// placed in turn, so two never share a square. Returns [{ id, name, position }].
function movePeople(e, world, collection, entity, map) {
  const host = { ...entity };
  if (map) host.battleMap = { mapId: map.id };
  else delete host.battleMap;
  const after = {
    ...world,
    [collection]: { ...world[collection], [entity.id]: host },
    characters: { ...(world.characters || {}) },
  };
  const moved = [];
  for (const character of Object.values(world.characters || {})) {
    if (character.retired) continue;
    if ((maps.characterHost(after, character) || {}).id !== entity.id) continue;
    const bare = { ...character };
    for (const field of positions.FIELDS) delete bare[field];
    const fallback = positions.defaultPosition(after, bare) || {};
    const fields = {};
    for (const field of positions.FIELDS) {
      if (fallback[field]) fields[field] = fallback[field];
      else if (character[field] != null) fields[field] = FieldValue.delete();
    }
    if (!Object.keys(fields).length) continue;
    e.update(e.ref('characters', character.id), fields);
    const placed = { ...bare, ...fallback };
    after.characters[character.id] = placed;
    moved.push({
      id: character.id,
      name: character.name,
      position: positions.positionView(after, placed),
    });
  }
  return moved;
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
        'bar, the altar). Walls, doors and obstacles (see set_map_layers) can come with it; ' +
        'replacing a grid without them keeps the ones it has. Leave out mapId to make a new ' +
        'map; give it to replace that map’s grid (its image is kept, but players forget what ' +
        'they had seen of it). `generic` makes it ' +
        'reusable for any ' +
        'number of places (a tavern, a forest clearing): it opens a place, but only a place’s ' +
        'own map adds to its score. Assign maps with assign_battle_map. Images are uploaded on ' +
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
        walls: LAYER_SHAPES.walls.optional(),
        doors: LAYER_SHAPES.doors.optional(),
        obstacles: LAYER_SHAPES.obstacles.optional(),
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
          for (const layer of ['walls', 'doors', 'obstacles']) {
            def[layer] = args[layer] || (before && before[layer]) || [];
          }
          checkLayers(def);
          // Its hazards are kept (L-815); any that no longer fit are said.
          def.hazards = (before && before.hazards) || [];
          // And its figures (L-824).
          def.figures = (before && before.figures) || [];
          const misfit = def.hazards.length
            ? hazards.validate(systemOf(world), def, def.hazards).errors
            : [];
          const doc = {
            id,
            ...def,
            image: before ? before.image || null : null,
            generic:
              args.generic === undefined ? (before ? before.generic || null : null) : args.generic,
            sources: { map: 'mcp' },
            // A replaced grid is a new map to players: what they had seen of
            // it is forgotten (loom-turn/seen.js; L-641).
            ...(before ? { revision: (before.revision || 0) + 1 } : {}),
          };
          e.set(e.ref('battleMaps', id), doc);
          const result = {
            map: views.battleMapRow(
              { ...world, battleMaps: { ...world.battleMaps, [id]: doc } },
              doc
            ),
          };
          if (!before) result.created = true;
          const warnings = [...layerWarnings(doc), ...standingWarnings(world, doc)];
          if (misfit.length) {
            warnings.push(
              `Its hazards no longer fit it: ${misfit.join(' ')} Fix them with set_hazards.`
            );
          }
          if (before) {
            warnings.unshift(
              'Players who had explored it start over: what they had seen of it is forgotten.'
            );
          }
          if (before && (before.width > args.width || before.height > args.height)) {
            warnings.unshift(
              'The grid is smaller now: players standing beyond its edge are moved to its entry.'
            );
          }
          if (warnings.length) result.warnings = warnings;
          return result;
        }),
    },
    {
      name: 'set_map_layers',
      title: 'Set a battle map’s walls, doors and obstacles',
      description:
        'Give a battle map what blocks movement and sight, without resending its grid. ' +
        'Coordinates: square (x, y) runs from corner (x, y) to corner (x + 1, y + 1), as in the ' +
        'map’s SVG art (viewBox one unit per square). Walls are lines along the grid lines ' +
        'between corners (each run straight across or down), e.g. the top of a 12-wide map is ' +
        '{ points: [{ x: 0, y: 0 }, { x: 12, y: 0 }] }. Doors are one square long, in a gap ' +
        'left in a wall (from one corner to the next), closed to start with; locked ones need ' +
        'their key or a picked lock. Obstacles are rectangles of squares: solid (blocks movement ' +
        'and sight: a pillar), low (blocks movement only: a table, the bar, a pit) or difficult ' +
        '(costs 2 movement a square: rubble). A feature can sit on an obstacle (the bar on the ' +
        'bar); players stand beside it. Nothing that blocks may cover an entry or exit, and every ' +
        'entry must reach an exit without a locked door. Each list given replaces that list; an ' +
        'empty list clears it; one left out is kept. A place’s own map needs these to count in ' +
        'full toward its score. Check them against the art with view_image. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps'),
        walls: LAYER_SHAPES.walls.optional(),
        doors: LAYER_SHAPES.doors.optional(),
        obstacles: LAYER_SHAPES.obstacles.optional(),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const map = live(world, 'battleMap', args.mapId);
          const given = ['walls', 'doors', 'obstacles'].filter((l) => args[l] !== undefined);
          if (!given.length) {
            throw new ToolError('Give walls, doors or obstacles (an empty list clears them).');
          }
          const fields = Object.fromEntries(given.map((l) => [l, args[l]]));
          const next = { ...map, ...fields };
          checkLayers(next);
          e.update(e.ref('battleMaps', map.id), fields);
          const result = {
            map: views.battleMapRow(
              { ...world, battleMaps: { ...world.battleMaps, [map.id]: next } },
              next
            ),
            layers: layerCounts(next),
            updated: given,
          };
          const warnings = [...layerWarnings(next), ...standingWarnings(world, next)];
          if (warnings.length) result.warnings = warnings;
          return result;
        }),
    },
    {
      name: 'set_hazards',
      title: 'Set a battle map’s hazards',
      description:
        'Place hazards on a battle map (L-815): a gas cloud, a fire, a patch of thorns. Each is ' +
        'an area (a burst, cone, line or square, in line of effect from its origin: walls and ' +
        'closed doors stop it) and the effect it puts on whoever walks into it: one of the ' +
        "world's system's conditions (get_system lists them, each with what it does), for how " +
        'long, and the save that resists it (rolled when it lands) or shakes it off (at the end ' +
        'of each turn). Walking from outside it into it triggers it: the Loom rolls the save ' +
        'with its own dice and puts the condition on a failure, and the narrator is told. ' +
        'Players see a hazard on the grid while it is in sight. The list replaces the map’s ' +
        'hazards; an empty list clears them. get_battle_map shows them with their squares. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps'),
        hazards: z.array(hazard).max(hazards.MAX_HAZARDS),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const map = live(world, 'battleMap', args.mapId);
          const list = args.hazards.map((h) => JSON.parse(JSON.stringify(h)));
          const warnings = checkHazards(world, map, list);
          e.update(e.ref('battleMaps', map.id), { hazards: list });
          const next = { ...map, hazards: list };
          const result = {
            map: views.battleMapRow(
              { ...world, battleMaps: { ...world.battleMaps, [map.id]: next } },
              next
            ),
            hazards: views.hazardRows(world, next),
          };
          if (warnings.length) result.warnings = warnings;
          return result;
        }),
    },
    {
      name: 'place_figures',
      title: 'Place figures on a battle map',
      description:
        'Place unnamed fighters on a battle map from a stat block (L-824): "bandit × 4". Each ' +
        'group has a name, a stat block (as set_sheet takes it, with attacks), a side ' +
        '(hostile by default: they start a fight when a player comes into sight), how they ' +
        'fight (role: brute, skirmisher, archer, guard, caster or leader), how much risk they ' +
        'take (posture: cowardly, cautious, steady, bold or reckless; it sets when they break ' +
        'and flee), whether one is a leader whose fall shakes the rest, and one square each. ' +
        'In play each is numbered ("Bandit 3"), with its own health in each save. The list ' +
        'replaces the map’s figures; an empty list clears them. get_battle_map shows them. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps'),
        figures: z.array(figureGroup).max(figures.MAX_GROUPS),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const map = live(world, 'battleMap', args.mapId);
          const list = args.figures.map((g) => JSON.parse(JSON.stringify(g)));
          const errors = figures.validateFigures(world, systemOf(world), map, list);
          if (errors.length) throw new ToolError(errors.join(' '));
          e.update(e.ref('battleMaps', map.id), { figures: list });
          const next = { ...map, figures: list };
          const result = { figures: views.figureRows(world, next) };
          if (map.generic) {
            result.warnings = [
              `${map.name} is a generic map: its figures stand at every place that uses it.`,
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
        'the map away. Characters there are moved to a position that fits: a free square near ' +
        'the new map’s entry, or, with no map, the place’s door in town (a point of interest ' +
        'without a map needs none). The result lists who moved where. ' +
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
          const moved = [];
          if ((map ? map.id : null) !== current) {
            fields.battleMap = map ? { mapId: map.id } : FieldValue.delete();
            e.update(e.ref(collection, entity.id), fields);
            moved.push(...movePeople(e, world, collection, entity, map));
          }
          return {
            place: { id: entity.id, name: entity.name },
            ...(moved.length ? { moved } : {}),
            battleMap: map ? { id: map.id, name: map.name, generic: Boolean(map.generic) } : null,
            updated: changedFields(fields),
            ...(map && map.generic
              ? {
                  note:
                    'A generic map opens the place, but only its own map adds to its score ' +
                    '(set_battle_map, then assign it).',
                }
              : {}),
          };
        }),
    },
  ];
}

module.exports = { mapTools, checkMap };
