'use strict';

/**
 * "What's here?" on a battle map (#672): the facts of one square, or one
 * door, as the save knows them, for the GM to describe and for nothing else.
 * Only what the save may know is gathered: a square it has seen, the things
 * on it, its door's state for this save, a hazard there only while in sight,
 * someone standing there only while in sight, the area it lies in, how far
 * it is and the cover it gives from where the player stands; and whether it
 * is in sight now or only remembered.
 *
 *   lookAt(canonWorld, save, { cell } | { door }, { known, inSight })
 *     → { refused }                         nothing to look at
 *     | { at, inSight, facts, empty, line } the square's facts as lines;
 *                                          `empty` when nothing is there,
 *                                          `line` the rules' plain line for it
 *
 * `known` and `inSight` are squares keyed "x,y" (./seen.js). Perception
 * (finding what is hidden there) can add to the facts later, here.
 *
 * Pure.
 */

const maps = require('../loom-canon/maps');
const layers = require('../loom-canon/layers');
const hazards = require('../loom-canon/hazards');
const mapAreas = require('../loom-canon/map-areas');
const combat = require('../loom-modules/combat');
const { doorStatesOf, doorSides } = require('./steps');

const key = (c) => c.x + ',' + c.y;
const coords = (c) => '(' + c.x + ', ' + c.y + ')';
const squares = (n) => (n === 1 ? '1 square' : n + ' squares');

// The obstacle covering a square, if any.
function obstacleAt(map, cell) {
  return (
    (map.obstacles || []).find(
      (o) =>
        cell.x >= o.x && cell.x < o.x + (o.w || 1) && cell.y >= o.y && cell.y < o.y + (o.h || 1)
    ) || null
  );
}

const KIND = {
  solid: 'blocks the way and the view',
  low: 'low: it blocks the way',
  difficult: 'hard going',
};

function lookAt(canonWorld, save, target, { known, inSight } = {}) {
  const { map, cell: here } = maps.positionOf(canonWorld, save);
  if (!map) return { refused: "There's no map here to look at." };
  const states = doorStatesOf(save, map.id);
  const sees = (c) => !inSight || Boolean(inSight[key(c)]);
  const knows = (c) => !known || Boolean(known[key(c)]);

  if (target.door) {
    const door = (map.doors || []).find((d) => d.id === target.door);
    if (!door || !doorSides(door).some(knows)) return { refused: "You haven't seen that door." };
    const now = doorSides(door).some(sees);
    const name = door.name || 'a door';
    return {
      at: name,
      inSight: now,
      facts: ['A door: ' + name + ', ' + layers.doorState(door, states) + '.'],
      empty: false,
    };
  }

  const cell = target.cell;
  if (!maps.inBounds(map, cell)) return { refused: "That's off the map." };
  if (!knows(cell)) return { refused: "You haven't seen that spot." };
  const now = sees(cell);
  const facts = [];
  const there = maps.at(map, cell);
  if (there.feature) facts.push('A feature: ' + there.feature.name + '.');
  if (there.exit) facts.push('A way out: ' + there.exit.name + '.');
  if ((map.entries || []).some((e) => e.x === cell.x && e.y === cell.y) && !there.exit) {
    facts.push('Where people come in.');
  }
  const obstacle = obstacleAt(map, cell);
  if (obstacle) {
    facts.push(
      'An obstacle: ' +
        (obstacle.name || 'something') +
        ' (' +
        (KIND[obstacle.kind] || obstacle.kind) +
        ').'
    );
  }
  // Doors along its sides, as this save left them.
  (map.doors || [])
    .filter((d) => doorSides(d).some((s) => s.x === cell.x && s.y === cell.y))
    .forEach((d) =>
      facts.push(
        'A door beside it: ' + (d.name || 'a door') + ', ' + layers.doorState(d, states) + '.'
      )
    );
  // A hazard, only while it is in sight (L-815).
  if (now && inSight) {
    hazards
      .seenOn(map, inSight, states)
      .filter(({ squares: sq }) => sq.includes(key(cell)))
      .forEach(({ hazard }) =>
        facts.push(
          'A hazard: ' + hazard.name + (hazard.description ? ', ' + hazard.description : '') + '.'
        )
      );
  }
  // Someone standing there, only while in sight (L-642).
  if (now) {
    const host = maps.hostOf(canonWorld, save);
    maps
      .standingAt(canonWorld, host)
      .filter((c) => c.cell.x === cell.x && c.cell.y === cell.y)
      .forEach((c) => {
        const down = combat.play.downOf(save, c.id);
        facts.push(
          'Someone there: ' +
            c.name +
            (c.description ? ', ' + c.description : '') +
            (down ? ' (' + down + ')' : '') +
            '.'
        );
      });
  }
  const empty = !facts.length;
  const area = mapAreas.areaAt(map, cell);
  if (area) facts.push('It is in ' + area.name + '.');
  const steps = Math.max(Math.abs(cell.x - here.x), Math.abs(cell.y - here.y));
  facts.push(
    steps === 0
      ? 'It is where the player stands.'
      : steps === 1
        ? 'It is beside the player.'
        : 'It is ' + squares(steps) + ' from the player.'
  );
  if (steps > 0) {
    const cover = combat.position.coverOf(map, states, here, cell);
    if (cover) facts.push('From where the player stands, it is behind ' + cover + ' cover.');
  }
  return {
    at: coords(cell),
    inSight: now,
    facts,
    empty,
    line: empty
      ? (now ? '' : 'When you last saw it: ') +
        (now ? 'Bare floor' : 'bare floor') +
        (area ? ', in ' + area.name : '') +
        '.'
      : null,
  };
}

// What a typed look names on the battle map (#672): a feature's, an exit's
// or someone's square, or a door; null when it names nothing there (an
// area, a place, nothing at all), for the turn to go on as before.
// Searching is a check (perception, later), not a look.
const LOOKING = ['look', 'examine', 'inspect'];
function lookTargetOf(canonWorld, save, proposedAction) {
  if (!LOOKING.includes(proposedAction.verb)) return null;
  const { map } = maps.positionOf(canonWorld, save);
  const target = (proposedAction.targets || [])[0];
  if (!map || typeof target !== 'string') return null;
  const named = (prefix, list) =>
    target.indexOf(prefix) === 0
      ? (list || []).find((item) => item.id === target.slice(prefix.length)) || null
      : null;
  const thing = named('feature:', map.features) || named('exit:', map.exits);
  if (thing) return { cell: { x: thing.x, y: thing.y } };
  const door = named('door:', map.doors);
  if (door) return { door: door.id };
  const person = maps
    .standingAt(canonWorld, maps.hostOf(canonWorld, save))
    .find((c) => c.id === target);
  return person ? { cell: { x: person.cell.x, y: person.cell.y } } : null;
}

module.exports = { lookAt, lookTargetOf };
