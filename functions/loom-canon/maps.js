'use strict';

/**
 * The Loom — battle maps (planning/the-loom-layered-worlds.md §9; L-351 / #400).
 *
 * A point of interest, or a place in town, can have a battle map: a grid of
 * cells over artwork, walked cell by cell. Maps live in the world's
 * `battleMaps` collection:
 *
 *   BattleMap
 *     id, name, width, height   — the grid, in cells (at most 64 each way)
 *     image                     — { path (Cloud Storage), width, height }, or null
 *                                 (drawn as a plain grid); stretched to the grid
 *     entries:  [{ id, x, y }]  — where you arrive: the first, unless an exit names one
 *     exits:    [{ id, name, x, y, to }]
 *                               — to: 'out' (back to the town, or the world), or
 *                                 { map, entry } (onto another map: a floor, a wing)
 *     features: [{ id, name, x, y }]   — named cells: the bar, the altar, the well
 *     geometry                  — what blocks movement and sight, in feet (L-921;
 *                                 ./map-geometry.js): ground, walls, doors, windows,
 *                                 objects…; the walls, doors and obstacles of before
 *                                 (L-621) are stored in it and dropped (L-928)
 *     generic: { kind, terrain } | null — reusable, assignable to any number of places
 *     revision                  — counts the times its grid was replaced (L-641): what
 *                                 saves had seen of an older one is forgotten
 *     sources, retired
 *
 * A place carries `battleMap: { mapId }`, its own map or a generic one. A save
 * on a map records `mapId` and `cell: { x, y }`; both are null off a map.
 * A character at a place with a map can stand on one of its squares,
 * `character.cell: { x, y }` (L-641), placed over MCP.
 * Until L-624, paths ignore the layers; the checks keep a map walkable. Pure helpers over a loaded world, shared by the rules engine, the
 * narrator, the interpreter, new games and grading.
 */

const town = require('./town');
const geo = require('./map-geometry');
const materials = require('./materials');
const mapPaths = require('./map-paths');
const secrets = require('./secrets');

const MAX_SIDE = 64;

const live = (entity) => Boolean(entity) && !entity.retired;

/** The live map assigned to a place (its own, or a generic one), or null. */
function mapOf(world, entity) {
  const mapId = entity && entity.battleMap && entity.battleMap.mapId;
  const map = mapId && (world.battleMaps || {})[mapId];
  return live(map) ? map : null;
}

/**
 * What kind of map a place has, for grading: 'own', 'generic', or null.
 * A generic map opens a place but stops it short of Rich.
 */
function kindOf(world, entity) {
  const map = mapOf(world, entity);
  if (!map) return null;
  return map.generic ? 'generic' : 'own';
}

/**
 * The place a save is at, whose map it may be on: its place in town, else the
 * world place it stands in (a point of interest).
 */
function hostOf(world, save) {
  const { location, place } = town.positionOf(world, save);
  return place || (location ? world.locations[location] : null) || wildHostOn(world, save);
}

// ── An event in the wilds (planning/off-road-travel.md §4.6; L-366) ────

const WILD_HOST = 'wild:';

/**
 * The host of a map an event in the wilds is played on: the map's own, kept on
 * the save (`wild: true`, ../loom-modules/wilds/arrive.js), has no place of the
 * world, so figures stand at `wild:<map id>`. `{ id, name, battleMap, wild }`,
 * or null when the map isn't one.
 */
function wildHost(world, mapId) {
  const map = mapId && (world.battleMaps || {})[mapId];
  if (!live(map) || !map.wild) return null;
  return { id: WILD_HOST + mapId, name: map.name, battleMap: { mapId }, wild: true };
}

// The host of the map a save stands on, when that is an event's.
function wildHostOn(world, save) {
  return save && save.mapId ? wildHost(world, save.mapId) : null;
}

function inBounds(map, cell) {
  return (
    Boolean(cell) &&
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.y) &&
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < map.width &&
    cell.y < map.height
  );
}

/** Where you arrive on a map: the named entry, else its first, else its middle. */
function entryCell(map, entryId) {
  const entries = map.entries || [];
  const entry = entries.find((e) => e.id === entryId) || entries[0];
  if (entry && inBounds(map, entry)) return { x: entry.x, y: entry.y };
  return { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
}

/**
 * Where a save stands on a map: { map, cell, point }, or nulls off a map. A
 * recorded map is kept even if retired, so nobody is stranded on one.
 * `point` is where in feet (L-922; ./map-paths.js): the save's `gridPoint`
 * while it lies in its square, else the square's centre, so a square set
 * on its own (an arrival, a fall, a save from before) reads as its centre.
 */
function positionOf(world, save) {
  const stored = save && save.mapId && (world.battleMaps || {})[save.mapId];
  if (!stored) return { map: null, cell: null, point: null };
  // As this save sees it (L-927): what it has found is no longer hidden.
  const map = secrets.reveal(stored, save);
  const cell = inBounds(map, save.cell) ? save.cell : entryCell(map);
  return { map, cell, point: pointIn(cell, save.gridPoint) };
}

/**
 * Where a save's character looks from on its battle map (L-923): its
 * square, its point in feet and its size (for its eyes' height,
 * ./sight.js), the size from `sized` (by default the same save). Null off
 * a map.
 */
function viewerOf(world, save, sized = save) {
  const { cell, point } = positionOf(world, save);
  if (!cell) return null;
  const sheet = (sized && sized.character && sized.character.sheet) || {};
  return { cell, point, ...(sheet.size ? { size: sheet.size } : {}) };
}

/** A point in feet if it lies in a square, else the square's centre (L-922). */
function pointIn(cell, point) {
  if (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    sameCell(mapPaths.squareOf(point), cell)
  ) {
    return { x: point.x, y: point.y };
  }
  return mapPaths.centreOf(cell);
}

/** The mutations that put a save on a place's map on arrival (or take it off one). */
function arrivalMutations(world, entity, save) {
  const map = mapOf(world, entity);
  if (map) {
    return [
      { target: 'save', op: 'set-flag', path: 'mapId', value: map.id },
      { target: 'save', op: 'set-flag', path: 'cell', value: entryCell(map) },
      { target: 'save', op: 'set-flag', path: 'gridPoint', value: null },
    ];
  }
  if (save && (save.mapId || save.cell)) {
    return [
      { target: 'save', op: 'set-flag', path: 'mapId', value: null },
      { target: 'save', op: 'set-flag', path: 'cell', value: null },
      { target: 'save', op: 'set-flag', path: 'gridPoint', value: null },
    ];
  }
  return [];
}

const sameCell = (a, b) => Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y;

/** The exit and the feature at a cell, if any. */
function at(map, cell) {
  return {
    exit: (map.exits || []).find((e) => sameCell(e, cell)) || null,
    feature: (map.features || []).find((f) => sameCell(f, cell)) || null,
  };
}

/** The exits that lead out of a map, back to the town or the world. */
function exitsOut(map) {
  return (map.exits || []).filter((e) => e.to === 'out' || !e.to);
}

// ── Characters on squares (L-641) ──────────────────────────────────────

/**
 * The place a character is found at, whose map they stand on: their place in
 * town, else their world place.
 */
function characterHost(world, character) {
  if (character.placeId) return (world.places || {})[character.placeId] || null;
  const id = character.locationId;
  if (typeof id === 'string' && id.indexOf(WILD_HOST) === 0) {
    return wildHost(world, id.slice(WILD_HOST.length));
  }
  return world.locations[id] || null;
}

/**
 * The live characters standing on a map: [{ character, host, cell }]. A
 * generic map is shared, so each stands on the copy at their own place.
 */
function standingOn(world, map) {
  const found = [];
  for (const character of Object.values(world.characters || {})) {
    if (!live(character) || !character.cell) continue;
    const host = characterHost(world, character);
    const hostMap = host && mapOf(world, host);
    if (hostMap && hostMap.id === map.id) found.push({ character, host, cell: character.cell });
  }
  return found;
}

/** The live characters standing on squares at a place (L-642): its map's people. */
function standingAt(world, host) {
  if (!host) return [];
  return Object.values(world.characters || {}).filter(
    (c) => live(c) && c.cell && (characterHost(world, c) || {}).id === host.id
  );
}

const isPair = (p) => Array.isArray(p) && p.length >= 2;
const sameCorner = (a, b) => Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/**
 * What covers a square's middle on a battle map, from its geometry (L-928;
 * what an obstacle was): `{ id, name, kind }`, `kind` 'solid' for something
 * that blocks the way and hides (a pillar, a statue), 'low' for something
 * that blocks the way only, or a closed wall round it (a table, the bar, a
 * pit's rail), 'difficult' for ground that costs more (rubble); or null.
 * Hidden things are left out.
 */
function blockerAt(map, cell) {
  const g = mapPaths.geometryOf(map);
  if (!g || !Object.keys(g).length) return null;
  const c = geo.compile(g);
  const middle = [(cell.x + 0.5) * mapPaths.FEET, (cell.y + 0.5) * mapPaths.FEET];
  const shown = (item) => !c.hidden[item.id];
  for (let i = c.objects.length - 1; i >= 0; i--) {
    const { item, rings } = c.objects[i];
    if (!shown(item) || !geo.objectBlocksMove(item)) continue;
    if (!rings.some((ring) => geo.pointInShape(middle, ring))) continue;
    const kind = materials.objectKind(item.kind);
    const hides =
      typeof item.blocksSight === 'boolean' ? item.blocksSight : Boolean(kind && kind.blocksSight);
    return {
      id: item.id,
      name: item.name || (kind && kind.name.toLowerCase()) || item.kind,
      kind: hides ? 'solid' : 'low',
    };
  }
  for (const { item, lines } of c.walls) {
    if (!shown(item) || item.blocksMove === false) continue;
    const ring = lines.find(
      (l) => l.length >= 4 && isPair(l[0]) && sameCorner(l[0], l[l.length - 1])
    );
    if (!ring || !geo.pointInShape(middle, ring)) continue;
    return {
      id: item.id,
      name: item.name || 'a wall',
      kind: item.blocksSight === false ? 'low' : 'solid',
    };
  }
  const ground = geo.groundAt(c, middle);
  if (ground && shown(ground) && (ground.cost === 'never' || ground.cost >= 2)) {
    const info = materials.materialOf('ground', ground.material);
    return {
      id: ground.id,
      name: ground.name || (info && info.name.toLowerCase()) || ground.material,
      kind: ground.cost === 'never' ? 'low' : 'difficult',
    };
  }
  return null;
}

/**
 * Why nobody can stand on a square of a place's map, or null: off the grid,
 * on something that blocks (solid or low), on an entry or an exit, or on
 * another character's square (`selfId` is the one being placed). `map` is
 * the map to check against, which may be one about to be saved.
 */
function squareProblem(world, map, host, cell, selfId) {
  const at = `(${cell.x}, ${cell.y})`;
  if (!inBounds(map, cell)) return `${at} is off the ${map.width} × ${map.height} grid`;
  const obstacle = blockerAt(map, cell);
  if (obstacle && obstacle.kind !== 'difficult') {
    return `${at} is ${obstacle.name} (${obstacle.kind})`;
  }
  const entry = (map.entries || []).find((e) => sameCell(e, cell));
  if (entry) return `${at} is the entry "${entry.id}", where players arrive`;
  const exit = (map.exits || []).find((e) => sameCell(e, cell));
  if (exit) return `${at} is ${exit.name}, an exit`;
  const other = Object.values(world.characters || {}).find(
    (c) =>
      live(c) &&
      c.id !== selfId &&
      sameCell(c.cell, cell) &&
      (characterHost(world, c) || {}).id === host.id
  );
  if (other) return `${other.name} (${other.id}) already stands at ${at}`;
  return null;
}

/**
 * The open square nearest `from` (L-394; planning/builders-tools.md §4.4):
 * by distance in feet (L-922), in reading order where that's the same, the
 * first that `isOpen(cell)` passes, preferring one a walk from an entry
 * reaches (locked doors open). Null when there is none.
 */
function nearestOpen(map, from, isOpen) {
  const reached = mapPaths.squaresReached(map, map.entries || [], { open: () => true });
  const cells = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) cells.push({ x, y, d: Math.hypot(x - from.x, y - from.y) });
  }
  cells.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  let fallback = null;
  for (const { x, y } of cells) {
    const cell = { x, y };
    if (!isOpen(cell)) continue;
    if (reached[x + ',' + y]) return cell;
    if (!fallback) fallback = cell;
  }
  return fallback;
}

/**
 * Where nobody stands yet at a place (L-394): the open square nearest
 * `from` (by default its first entry), free of what blocks, of entries and
 * exits, and of anyone standing there or in `taken` ("x,y").
 */
function nearestFree(world, map, host, from, { selfId = null, taken = new Set() } = {}) {
  const start = from || (map.entries || [])[0] || { x: 0, y: 0 };
  return nearestOpen(
    map,
    { x: start.x, y: start.y },
    (cell) => !taken.has(cell.x + ',' + cell.y) && !squareProblem(world, map, host, cell, selfId)
  );
}

module.exports = {
  MAX_SIDE,
  nearestOpen,
  nearestFree,
  mapOf,
  kindOf,
  hostOf,
  wildHost,
  inBounds,
  entryCell,
  positionOf,
  viewerOf,
  pointIn,
  arrivalMutations,
  sameCell,
  at,
  exitsOut,
  characterHost,
  standingOn,
  standingAt,
  squareProblem,
  blockerAt,
};
