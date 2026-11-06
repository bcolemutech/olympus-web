'use strict';

/**
 * Hidden things and noticing them (planning/maps-from-data.md §3 DA3, §4.5;
 * L-927 / #731): a secret door, a trap, a cache. A map hides things two ways:
 * its geometry's `hidden` list (`[{ id, dc? }]`, the walls, lines, doors,
 * windows, objects and ground it names) and a hazard's own `hidden` setting
 * (`true` or `{ dc }`; hazards are in the battle map's `hazards`, not its
 * geometry). Zones, spawns, lights and notes are never drawn to a player, so
 * hiding them changes nothing.
 *
 * A save finds them one of two ways (decided 2026-11-06), both the same
 * roll, the system's `checks.notice` (a skill or attribute; else its combat
 * module's surprise `notice`) against the thing's `dc` (else the system's
 * Moderate rung):
 *
 *   passive   rolled once for each thing the first time it is in sight; a
 *             hit finds it, a miss is remembered ('missed'), not rolled again
 *   Search    rolled for every thing in sight not yet found, missed or not
 *
 * What a save has found is in `save.secrets` (./secrets.js); the map it
 * stands on is laid over with it (`maps.positionOf`), so once found a thing
 * is simply shown. A trap unfound still springs when walked into: the walk
 * finds it (../loom-turn/adjudicate.js).
 *
 *   thingsOf(map, states)          the hidden things a (revealed) map still has
 *   inSight(thing, sightMap)       whether any of its squares is in sight
 *   notice(system, map, save, { dice, inSight, search })
 *                                  the check for what is in sight: `{ mutations,
 *                                  lines, found }`
 *
 * Pure: the dice come from the caller.
 */

const geo = require('./map-geometry');
const mapPaths = require('./map-paths');
const checks = require('./checks');
const objects = require('./objects');
const doors = require('./doors');
const hazards = require('./hazards');
const secrets = require('./secrets');

const FEET = mapPaths.FEET;
const SAMPLE = FEET / 2;
// What a player can tell is there; the rest of a geometry is never drawn to them.
const NOTICEABLE = ['walls', 'lines', 'doors', 'windows', 'objects', 'ground'];
// What a thing is called when it has no name of its own.
const DEFAULT_NAMES = {
  walls: 'a hidden wall',
  lines: 'a hidden path',
  doors: 'a hidden door',
  windows: 'a hidden window',
  ground: 'something in the floor',
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyOfSquare = (x, y) => x + ',' + y;

// The squares a list of points touches, either side of a line along them.
function squaresAlong(lines, map) {
  const out = new Set();
  const take = (x, y) => {
    const sx = Math.floor(x / FEET + 1e-9);
    const sy = Math.floor(y / FEET + 1e-9);
    if (sx >= 0 && sy >= 0 && sx < (map.width || 0) && sy < (map.height || 0)) {
      out.add(keyOfSquare(sx, sy));
    }
  };
  lines.forEach((line) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      const length = Math.hypot(bx - ax, by - ay);
      const nx = length ? (-(by - ay) / length) * (FEET / 4) : 0;
      const ny = length ? ((bx - ax) / length) * (FEET / 4) : 0;
      const n = Math.max(1, Math.ceil(length / SAMPLE));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n;
        const y = ay + ((by - ay) * k) / n;
        take(x, y);
        take(x + nx, y + ny);
        take(x - nx, y - ny);
      }
    }
  });
  return Array.from(out);
}

// The squares of a hidden item of the geometry, as "x,y" keys.
function squaresOf(map, c, found) {
  const { list, item } = found;
  if (list === 'objects') {
    return objects.squaresOf(map, item).map((s) => keyOfSquare(s.x, s.y));
  }
  if (list === 'doors' || list === 'windows') {
    return doors
      .sidesOf(item)
      .filter((s) => s.x >= 0 && s.y >= 0 && s.x < (map.width || 0) && s.y < (map.height || 0))
      .map((s) => keyOfSquare(s.x, s.y));
  }
  if (list === 'walls' || list === 'lines') {
    const entry = c[list].find((e) => e.item.id === item.id);
    return entry ? squaresAlong(entry.lines, map) : [];
  }
  const entry = c.ground.find((e) => e.item.id === item.id);
  if (!entry || !entry.rings) return [];
  const out = [];
  for (let y = 0; y < (map.height || 0); y++) {
    for (let x = 0; x < (map.width || 0); x++) {
      const middle = [(x + 0.5) * FEET, (y + 0.5) * FEET];
      if (entry.rings.some((ring) => geo.pointInShape(middle, ring))) out.push(keyOfSquare(x, y));
    }
  }
  return out;
}

/**
 * The hidden things a map still has (so, on a map as a save sees it, those
 * not yet found): `{ key, id, list, item, dc, name, squares }`, `key` what a
 * save keeps its state of it under, `squares` "x,y" keys, `states` the save's
 * doors (a hazard's reach depends on them).
 */
function thingsOf(map, states = {}) {
  if (!map) return [];
  const g = mapPaths.geometryOf(map);
  const things = [];
  if (g && Array.isArray(g.hidden) && g.hidden.length) {
    const c = geo.compile(g);
    Object.keys(c.hidden).forEach((id) => {
      const found = c.byId[id];
      if (!found || !NOTICEABLE.includes(found.list)) return;
      const kind = found.list === 'objects' ? objects.nameOf(found.item) : null;
      things.push({
        key: secrets.keyOf(id),
        id,
        list: found.list,
        item: found.item,
        dc: c.hidden[id].dc,
        name: found.item.name || kind || DEFAULT_NAMES[found.list],
        squares: squaresOf(map, c, found),
      });
    });
  }
  (map.hazards || []).forEach((hazard) => {
    if (!hazard || !hazard.hidden) return;
    things.push({
      key: secrets.keyOf(hazard.id, true),
      id: hazard.id,
      list: 'hazards',
      item: hazard,
      dc: isObject(hazard.hidden) ? hazard.hidden.dc : undefined,
      name: hazard.name || 'a trap',
      squares: Object.keys(hazards.squaresOf(map, hazard, states)),
    });
  });
  return things;
}

/** Whether any square of a thing is in sight (`seen`: "x,y" → true). */
const inSight = (thing, seen) => thing.squares.some((k) => seen && seen[k]);

// The rung a thing is noticed against: its own `dc` (a rung's name, or a
// number on the d20 scale as a lock's is), else the system's Moderate.
function difficultyOf(system, thing) {
  if (typeof thing.dc === 'number' || typeof thing.dc === 'string') {
    return checks.canonRung(system, thing.dc);
  }
  const ladder = system.checks.ladder;
  return ladder.find((r) => /^moderate$/i.test(r.name)) || ladder[Math.floor(ladder.length / 2)];
}

/** What noticing rolls in a system: `checks.notice`, else its combat module's surprise notice. */
function checkOf(system) {
  const own = system.checks && system.checks.notice;
  if (isObject(own)) return own;
  const combat = system.modules && system.modules.combat;
  return (combat && combat.surprise && combat.surprise.notice) || {};
}

/**
 * The check for what is in sight (`seen`, or a function that works it out,
 * called only if there is something to roll for) on a save's map: a passive one
 * (each thing not yet checked, once) or, with `search`, a Search (each thing
 * not yet found). Returns `{ mutations, lines, found }`: the save's new
 * states of what was rolled for, a line for each find, and the things found.
 * Nothing is said of what was missed.
 */
function notice(system, map, save, { dice, inSight: seen, search = false }) {
  const states = secrets.statesOf(save, map.id);
  const doorStates = ((save && save.doors) || {})[map.id] || {};
  const mutations = [];
  const lines = [];
  const found = [];
  // Only what there is to roll for: so a map with nothing hidden works out nothing.
  const open = thingsOf(map, doorStates).filter((thing) => search || !states[thing.key]);
  if (!open.length) return { mutations, lines, found };
  const sight = typeof seen === 'function' ? seen() : seen;
  open.forEach((thing) => {
    if (!inSight(thing, sight)) return;
    const result = checks.rollCheck(system, {
      check: checkOf(system),
      character: (save && save.character) || null,
      difficulty: difficultyOf(system, thing),
      dice,
    });
    const hit = Boolean(result.success);
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: `secrets.${map.id}.${thing.key}`,
      value: hit ? 'found' : 'missed',
    });
    if (!hit) return;
    found.push(thing);
    lines.push('You ' + (search ? 'find ' : 'notice ') + thing.name + '.');
  });
  return { mutations, lines, found };
}

module.exports = { NOTICEABLE, thingsOf, inSight, difficultyOf, checkOf, notice };
