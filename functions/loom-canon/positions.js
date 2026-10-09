'use strict';

/**
 * Where every character is (planning/the-loom-movement-and-vision.md §6a;
 * L-681 / #513): one position, at the most precise level that applies to
 * them, exactly one of
 *
 *   - a square, `cell: { x, y }`, on the battle map of the place they are at
 *     (their place in town, else their point of interest), when it has one
 *     (L-641; ./maps.js);
 *   - a town point, `townPoint: { x, y }`, in their settlement's 0–1000 square,
 *     for someone about a settlement and not in a place with a map;
 *   - a world point, `worldPoint: { x, y }`, in the world map's own units
 *     (`world.map`, as locations' `geo`), for someone in the wilderness: in no
 *     settlement or point of interest, so with no `locationId`.
 *
 * At a point of interest without a battle map, the point of interest's own
 * world position (`geo`) counts, and the character carries none of the three.
 *
 * Pure helpers over a loaded world. A position is a requirement, checked on
 * every change and at publish (L-682, L-683), not a grading criterion.
 */

const maps = require('./maps');
const town = require('./town');
const layers = require('./layers');

const TOWN_SIDE = 1000; // a town's square, as places' positions use it (./town.js)
const FIELDS = ['cell', 'townPoint', 'worldPoint'];

const isPoint = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const within = (p, width, height) => p.x >= 0 && p.y >= 0 && p.x <= width && p.y <= height;
const at = (p) => '(' + p.x + ', ' + p.y + ')';

/**
 * The level a character's position must be at, from where they are found:
 *   { level: 'square', host, map }        — at a place or point of interest with a map
 *   { level: 'town', settlement, place }   — about a settlement (place: theirs, if any)
 *   { level: 'here', location }            — at a point of interest without a map
 *   { level: 'world' }                     — in the wilderness (no locationId)
 * or { problem } when where they are found doesn't exist.
 */
function levelFor(world, character) {
  if (!character.locationId) return { level: 'world' };
  const location = (world.locations || {})[character.locationId];
  if (!location) return { problem: 'their location "' + character.locationId + '" does not exist' };
  const host = maps.characterHost(world, character);
  if (!host) return { problem: 'their place "' + character.placeId + '" does not exist' };
  const map = maps.mapOf(world, host);
  if (map) return { level: 'square', host, map };
  if ((location.geo || {}).kind === 'settlement') {
    return { level: 'town', settlement: location, place: host === location ? null : host };
  }
  return { level: 'here', location };
}

/**
 * A character's position, or why they have none:
 *   { level: 'square', host, map, cell }
 *   { level: 'town', settlement, place, point }
 *   { level: 'world', point, location }    — location: the point of interest
 *                                            whose position counts, or null in
 *                                            the wilderness
 *   { problem }                            — a plain sentence's end, to follow
 *                                            "<name> has no position: "
 */
function positionOf(world, character) {
  const expected = levelFor(world, character);
  if (expected.problem) return { problem: expected.problem };
  const given = FIELDS.filter((field) => character[field] != null);
  if (given.length > 1) {
    return { problem: 'they have more than one (' + given.join(', ') + '); keep only one' };
  }
  const wrong = (needed) =>
    given.length && given[0] !== needed
      ? { problem: reason(expected) + ', so they need a ' + needed + ', not a ' + given[0] }
      : null;

  if (expected.level === 'square') {
    const { host, map } = expected;
    if (wrong('cell')) return wrong('cell');
    if (!given.length) return { problem: reason(expected) + ': they need a square (cell)' };
    const problem = maps.squareProblem(world, map, host, character.cell, character.id);
    if (problem) return { problem: 'their square won’t do: ' + problem };
    return { level: 'square', host, map, cell: character.cell };
  }

  if (expected.level === 'town') {
    if (wrong('townPoint')) return wrong('townPoint');
    if (!given.length) {
      return { problem: reason(expected) + ': they need a town point (townPoint)' };
    }
    const point = character.townPoint;
    if (!isPoint(point) || !within(point, TOWN_SIDE, TOWN_SIDE)) {
      return { problem: 'their town point must be within 0–1000 each way' };
    }
    return {
      level: 'town',
      settlement: expected.settlement,
      place: expected.place,
      point: { x: point.x, y: point.y },
    };
  }

  if (expected.level === 'here') {
    const { location } = expected;
    if (given.length) {
      return {
        problem:
          location.name + ' has no battle map, so its own position counts; drop their ' + given[0],
      };
    }
    if (!isPoint(location.geo)) return { problem: location.name + ' has no coordinates' };
    return { level: 'world', point: { x: location.geo.x, y: location.geo.y }, location };
  }

  // The wilderness.
  if (wrong('worldPoint')) return wrong('worldPoint');
  if (!given.length)
    return { problem: reason(expected) + ': they need a world point (worldPoint)' };
  const size = world.map || {};
  if (!(size.width > 0 && size.height > 0)) return { problem: 'the world has no map' };
  const point = character.worldPoint;
  if (!isPoint(point) || !within(point, size.width, size.height)) {
    return {
      problem:
        'their world point ' +
        (isPoint(point) ? at(point) + ' ' : '') +
        'must be on the ' +
        size.width +
        ' × ' +
        size.height +
        ' world map',
    };
  }
  return { level: 'world', point: { x: point.x, y: point.y }, location: null };
}

// Why they need the level they do, as a problem says it.
function reason(expected) {
  if (expected.level === 'square') return expected.host.name + ' has a battle map';
  if (expected.level === 'town') {
    return expected.place
      ? expected.place.name + ' in ' + expected.settlement.name + ' has no battle map'
      : expected.settlement.name + ' is a town';
  }
  return 'they are in the wilderness';
}

/**
 * A position a character could take where they are found (L-682), as the
 * fields to give them: at a map, the free square nearest its entry (one
 * reachable from an entry first); in a town, their place's door, else the
 * first way in, else the middle of the town; at a point of interest without
 * a map, nothing (`{}`). Null in the wilderness, which has no default, or
 * when no square is free.
 */
function defaultPosition(world, character) {
  const expected = levelFor(world, character);
  if (expected.problem || expected.level === 'world') return null;
  if (expected.level === 'here') return {};
  if (expected.level === 'town') {
    const way = town.entrancesOf(world, expected.settlement.id).find((p) => isPoint(p.position));
    const door = expected.place && isPoint(expected.place.position) ? expected.place : way;
    const point = door ? door.position : { x: TOWN_SIDE / 2, y: TOWN_SIDE / 2 };
    return { townPoint: { x: point.x, y: point.y } };
  }
  const { map, host } = expected;
  const entry = maps.entryCell(map);
  const reached = layers.reachable(map, map.entries || []);
  let best = null;
  let bestRank = null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const cell = { x, y };
      if (maps.squareProblem(world, map, host, cell, character.id)) continue;
      const rank = [
        reached[x + ',' + y] ? 0 : 1,
        Math.max(Math.abs(x - entry.x), Math.abs(y - entry.y)),
      ];
      if (!best || rank[0] < bestRank[0] || (rank[0] === bestRank[0] && rank[1] < bestRank[1])) {
        best = cell;
        bestRank = rank;
      }
    }
  }
  return best ? { cell: best } : null;
}

/**
 * A character's position as the Cartographer's tools show it (L-682):
 *   { level: 'square', at: { id, name }, x, y }
 *   { level: 'town', town: { id, name }, place?: { id, name }, x, y }
 *   { level: 'world', x, y, at?: { id, name } }   — at: the point of interest
 *   { problem }                                  — none yet, and why
 */
function positionView(world, character) {
  const position = positionOf(world, character);
  const ref = (entity) => ({ id: entity.id, name: entity.name });
  if (position.problem) return { problem: position.problem };
  if (position.level === 'square') {
    return { level: 'square', at: ref(position.host), x: position.cell.x, y: position.cell.y };
  }
  if (position.level === 'town') {
    return {
      level: 'town',
      town: ref(position.settlement),
      ...(position.place ? { place: ref(position.place) } : {}),
      x: position.point.x,
      y: position.point.y,
    };
  }
  return {
    level: 'world',
    x: position.point.x,
    y: position.point.y,
    ...(position.location ? { at: ref(position.location) } : {}),
  };
}

/**
 * The live characters without a valid position (L-683): `[{ character,
 * problem }]`, by name. Publishing refuses a world with any; list_work lists
 * them.
 */
function unplacedCharacters(world) {
  return Object.values(world.characters || {})
    .filter((character) => !character.retired)
    .map((character) => ({ character, problem: positionOf(world, character).problem }))
    .filter((entry) => entry.problem)
    .sort((a, b) => a.character.name.localeCompare(b.character.name));
}

module.exports = {
  positionOf,
  levelFor,
  defaultPosition,
  positionView,
  unplacedCharacters,
  TOWN_SIDE,
  FIELDS,
};
