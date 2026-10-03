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
 *     walls, doors, obstacles   — what blocks movement and sight (L-621; ./layers.js):
 *                                 walls along the grid lines, doors in them, and
 *                                 solid, low or difficult squares; none is open ground
 *     generic: { kind, terrain } | null — reusable, assignable to any number of places
 *     sources, retired
 *
 * A place carries `battleMap: { mapId }`, its own map or a generic one. A save
 * on a map records `mapId` and `cell: { x, y }`; both are null off a map.
 * Until L-624, paths ignore the layers; the checks keep a map walkable. Pure helpers over a loaded world, shared by the rules engine, the
 * narrator, the interpreter, new games and grading.
 */

const town = require('./town');

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
  return place || (location ? world.locations[location] : null);
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
 * Where a save stands on a map: { map, cell }, or nulls off a map. A recorded
 * map is kept even if retired, so nobody is stranded on one.
 */
function positionOf(world, save) {
  const map = save && save.mapId && (world.battleMaps || {})[save.mapId];
  if (!map) return { map: null, cell: null };
  return { map, cell: inBounds(map, save.cell) ? save.cell : entryCell(map) };
}

/** The mutations that put a save on a place's map on arrival (or take it off one). */
function arrivalMutations(world, entity, save) {
  const map = mapOf(world, entity);
  if (map) {
    return [
      { target: 'save', op: 'set-flag', path: 'mapId', value: map.id },
      { target: 'save', op: 'set-flag', path: 'cell', value: entryCell(map) },
    ];
  }
  if (save && (save.mapId || save.cell)) {
    return [
      { target: 'save', op: 'set-flag', path: 'mapId', value: null },
      { target: 'save', op: 'set-flag', path: 'cell', value: null },
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

module.exports = {
  MAX_SIDE,
  mapOf,
  kindOf,
  hostOf,
  inBounds,
  entryCell,
  positionOf,
  arrivalMutations,
  sameCell,
  at,
  exitsOut,
};
