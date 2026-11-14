'use strict';

/**
 * Events on the way (planning/off-road-travel.md §4.5, EV1–EV3, EV7; L-364 /
 * #838): after each day leg a roll, seeded by the save and the leg, says
 * whether something happens at the camp; when it does, a row of an encounter
 * table that fits the camp's ground and the sort of path walked says what.
 *
 * The path is the wilds (off the road) or a route's kind (road, trail, sea…):
 * a leg's is the one it spent most hours on. An event is far less likely on a
 * route (the module's `routeChance` of it, 0.2), by the share of the leg's
 * hours spent on one.
 *
 *   KINDS                          travellers, creatures, hazard, weather, find
 *   WILD                           'wild': the path off the road
 *   chanceOf(settings, danger, share)  the chance of an event: the module's
 *                                  `eventChance` × the camp's danger (its
 *                                  material's × its region's), × the leg's mix
 *                                  of wild (1) and route (`routeChance`) by
 *                                  `share` of its hours on routes; at most 0.95
 *   rollOf(seed, chance)           { roll, chance, happened }: the same seed
 *                                  always rolls the same
 *   dice(seed)                     `(sides) => 1..sides`, from the same seed
 *   tablesOf(view, mapId, regionId) the tables that apply, nearest first:
 *                                  [{ source, rows }] (region, map, world)
 *   pathOf(spans, a, b)            { path, share } of hours a to b: the path
 *                                  walked most, and the share on routes
 *   fits(row, material, path)      whether a row fits ground of this material
 *                                  and this path
 *   choose(view, at, dice)         the event at a camp, or null
 *   happen(view, opts)             the roll and, on a hit, the event: what a
 *                                  day leg's turn records (`event`)
 *   validateRows(world, rows)      what's wrong with a table of rows, each
 *                                  named (it is the encounters format of
 *                                  ../combat/spawns.js, extended)
 *
 * A row is `{ what?, count?, weight?, text?, kind?, terrain?, path?, narrated? }`:
 * `what` a stat block of the world (figures to meet), `text` what happens,
 * `kind` one of KINDS (needed with no `what`; a creature's with one),
 * `terrain` the ground materials it fits (any when absent), `path` the paths
 * it fits ('wild', or route kinds like 'road'; any when absent) and `narrated`
 * that it is only told, with no map. An event with figures is played on a
 * map (L-366); until then, like any other, it is narrated.
 *
 * The tables are those of the camp's region, then its map, then the world,
 * then the built-ins (BUILT_INS: narrated, worded for any world): the first
 * of them with a row that fits the ground and the path is where the event is
 * picked from, by weight.
 *
 * Pure.
 */

const crypto = require('crypto');
const spawns = require('../combat/spawns');
const materials = require('../../loom-canon/materials');
const realms = require('../../loom-canon/realms');
const wildPlan = require('../../loom-canon/wild-plan');
const { MAX_CHANCE } = require('./settings');

const KINDS = Object.freeze(['travellers', 'creatures', 'hazard', 'weather', 'find']);
const MAX_TEXT = 400;
const MAX_TERRAINS = 12;
const MAX_PATHS = 6;
// The path off the road.
const WILD = 'wild';
// A route's kind: as the world's route kinds are named.
const PATH = /^[a-z][a-z0-9_-]{0,29}$/;
// A route span with no kind (a journey set out on before they had one).
const DEFAULT_ROUTE = 'trail';
const ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ROW_KEYS = ['what', 'count', 'weight', 'text', 'kind', 'terrain', 'path', 'narrated'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const live = (e) => Boolean(e) && !e.retired;
const text = (v) => (typeof v === 'string' ? v.trim() : '');

// ── The roll ─────────────────────────────────────────────────────────

/**
 * The chance of an event at a camp of this `danger` (EV7), from 0 to 0.95:
 * full off the road, the module's `routeChance` of it on a route, and by the
 * hours of each for a leg part on one (`share`, 0 to 1, of it on routes).
 */
function chanceOf(settings, danger, share = 0) {
  const base = settings && Number.isFinite(settings.eventChance) ? settings.eventChance : 0;
  const route =
    settings && Number.isFinite(settings.routeChance)
      ? Math.max(0, Math.min(1, settings.routeChance))
      : 1;
  const d = Number.isFinite(danger) && danger > 0 ? danger : 1;
  const on = Number.isFinite(share) ? Math.max(0, Math.min(1, share)) : 0;
  return Math.max(0, Math.min(MAX_CHANCE, base * d * (1 - on + on * route)));
}

/**
 * The path walked from hour `a` to `b` of a journey whose route stretches are
 * `spans` (`[{ from, to, kind? }]`, hours from its start): the one it spent
 * most hours on (a tie goes to the wilds), and the share of the time on
 * routes, `{ path, share }`.
 */
function pathOf(spans, a, b) {
  const total = b - a;
  const by = {};
  let onRoutes = 0;
  for (const s of Array.isArray(spans) ? spans : []) {
    const hours = Math.min(b, s.to) - Math.max(a, s.from);
    if (!(hours > 0)) continue;
    const kind = typeof s.kind === 'string' && PATH.test(s.kind) ? s.kind : DEFAULT_ROUTE;
    by[kind] = (by[kind] || 0) + hours;
    onRoutes += hours;
  }
  if (!(total > 0)) return { path: WILD, share: 0 };
  let path = WILD;
  let most = total - onRoutes;
  for (const [kind, hours] of Object.entries(by).sort(([x], [y]) => (x < y ? -1 : 1))) {
    if (hours > most + 1e-9) {
      path = kind;
      most = hours;
    }
  }
  return { path, share: Math.max(0, Math.min(1, onRoutes / total)) };
}

// A number from 0 up to (not including) 1, the `n`th of a seed's stream.
function unit(seed, n) {
  const hash = crypto.createHash('sha256').update(`${seed}#${n}`).digest();
  return hash.readUIntBE(0, 6) / 2 ** 48;
}

/** Dice from a seed: `(sides) => 1..sides`, the same series for the same seed. */
function dice(seed) {
  let n = 1;
  return (sides) => 1 + Math.min(sides - 1, Math.floor(unit(seed, n++) * sides));
}

/**
 * The event roll for a seed: `{ roll, chance, happened }`, the roll from 0
 * up to 1 (four places), an event when it is under the chance.
 */
function rollOf(seed, chance) {
  const roll = Math.floor(unit(seed, 0) * 10000) / 10000;
  const c = Math.round(chance * 10000) / 10000;
  return { roll, chance: c, happened: roll < c };
}

// ── The tables ───────────────────────────────────────────────────────

const tableOf = (holder) => (holder && Array.isArray(holder.encounters) ? holder.encounters : []);

/**
 * The tables that apply at a camp, nearest first: its region's, its map's,
 * the world's (EV2). Each is `{ source, rows }`, rows that are objects.
 */
function tablesOf(view, mapId, regionId) {
  const region = regionId && ((view && view.regions) || {})[regionId];
  const map = mapId && ((view && view.maps) || {})[mapId];
  return [
    { source: 'region', rows: tableOf(live(region) ? region : null) },
    { source: 'map', rows: tableOf(live(map) ? map : null) },
    { source: 'world', rows: tableOf(view) },
  ].map((t) => ({ ...t, rows: t.rows.filter(isObject) }));
}

/**
 * Whether a row fits ground of `material` and a `path` (the wilds by
 * default): a row with no `terrain` or no `path` fits any.
 */
function fits(row, material, path = WILD) {
  const terrain = Array.isArray(row.terrain) ? row.terrain : [];
  const paths = Array.isArray(row.path) ? row.path : [];
  return (
    (!terrain.length || (Boolean(material) && terrain.includes(material))) &&
    (!paths.length || paths.includes(path))
  );
}

// A row that says something can happen: figures to meet, or words to tell.
const usable = (row) => typeof row.what === 'string' || Boolean(text(row.text));

// A row chosen by weight with the dice.
function pick(rows, roll) {
  const weight = (r) => (Number.isInteger(r.weight) && r.weight > 0 ? r.weight : 1);
  let n = roll(rows.reduce((sum, r) => sum + weight(r), 0));
  for (const row of rows) {
    n -= weight(row);
    if (n <= 0) return row;
  }
  return rows[rows.length - 1];
}

// ── The built-ins ────────────────────────────────────────────────────

/**
 * Narrated events for any world (EV2: last in the order), none naming a
 * thing a world might not have. Those with no path fit any; the rest the
 * wilds, a road or trail, or the sea.
 */
const BUILT_INS = Object.freeze(
  [
    // Anywhere.
    ['travellers', 'You meet other travellers on the way, and trade news and a few words.'],
    ['travellers', 'A lone wayfarer shares your fire for the night and leaves before dawn.'],
    ['weather', 'A hard rain sets in and soaks you through before you can make camp.'],
    ['weather', 'A fog rolls in at evening and sits on the land until morning.'],
    ['find', 'You come on something left by the way: the remains of an old camp, long cold.'],
    // Off the road.
    [
      'creatures',
      'Something large moves through the dark beyond your camp, and keeps its distance.',
      ['wild'],
    ],
    [
      'creatures',
      'You find fresh tracks of some beast near your camp, and sleep lightly.',
      ['wild'],
    ],
    [
      'hazard',
      'The ground turns treacherous in the dusk, and you pick your way with care.',
      ['wild'],
    ],
    [
      'hazard',
      'A night of bad footing and worse luck: a stream swollen, a path washed out.',
      ['wild'],
    ],
    ['find', 'A path you would have missed shows itself in the last light.', ['wild']],
    // A road or trail.
    [
      'travellers',
      'A trader on the road offers goods and gossip from the places behind you.',
      ['road', 'trail'],
    ],
    [
      'travellers',
      'A cart stuck across the way holds up a line of travellers, and you wait with them.',
      ['road', 'trail'],
    ],
    [
      'hazard',
      'A stretch of the way is broken up, and you pick a slow way round it.',
      ['road', 'trail'],
    ],
    [
      'creatures',
      'Something watches from the verge as you pass, then slips away.',
      ['road', 'trail'],
    ],
    ['find', 'A weathered marker by the way shows how far you have come.', ['road', 'trail']],
    // The sea.
    ['travellers', 'Another vessel crosses your course and hails you across the water.', ['sea']],
    [
      'weather',
      'The wind shifts and the sea rises, and the crew works hard to hold the way.',
      ['sea'],
    ],
    ['creatures', 'Something large moves beneath the water alongside, and is gone.', ['sea']],
  ].map(([kind, line, path]) =>
    Object.freeze({
      kind,
      text: line,
      narrated: true,
      ...(path ? { path: Object.freeze(path) } : {}),
    })
  )
);

// ── Choosing ─────────────────────────────────────────────────────────

// The words an event is told in: its text, or, for figures to meet, who.
function wordsOf(view, row) {
  const given = text(row.text);
  if (given) return given;
  const block = ((view && view.statBlocks) || {})[row.what];
  const name = (block && block.name) || row.what;
  const count = Number.isInteger(row.count) && row.count > 1 ? row.count : 1;
  return count > 1
    ? `You are set upon by ${count} ${name}.`
    : `You are set upon by ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}.`;
}

// An event as the turn records it.
function eventOf(view, row, source) {
  const figures = typeof row.what === 'string';
  const count = Number.isInteger(row.count) && row.count > 0 ? row.count : 1;
  return {
    kind: KINDS.includes(row.kind) ? row.kind : figures ? 'creatures' : 'find',
    text: wordsOf(view, row),
    source,
    // Figures to meet and a map to meet them on (L-366): not narrated only.
    ...(figures ? { what: row.what, count } : {}),
    narrated: row.narrated === true || !figures,
  };
}

/**
 * The event at a camp, picked by weight with `roll` (`(sides) => 1..sides`):
 * the first of the region's, the map's and the world's tables with a row
 * that fits the ground and the path, else a built-in. `at` is `{ material,
 * path?, regionId?, mapId? }`; the event is `{ kind, text, source, what?, count?, narrated }`.
 */
function choose(view, at, roll) {
  const material = at && at.material;
  const path = (at && at.path) || WILD;
  for (const { source, rows } of tablesOf(view, at && at.mapId, at && at.regionId)) {
    const fitting = rows.filter((r) => usable(r) && fits(r, material, path));
    if (fitting.length) return eventOf(view, pick(fitting, roll), source);
  }
  return eventOf(view, pick(builtInsFor(path), roll), 'built-in');
}

/** The built-in events that fit a path (the wilds by default), in order. */
function builtInsFor(path = WILD) {
  const fitting = BUILT_INS.filter((row) => fits(row, null, path));
  return fitting.length ? fitting : BUILT_INS.filter((row) => !row.path);
}

/**
 * What a day leg's end holds (EV7): the roll, seeded by `seed`, against the
 * chance at the camp `point` of the frame's map, for the leg's `path` (the
 * wilds by default) and its `share` of hours on routes; and, when it hits,
 * the event. `{ roll, chance, happened, danger, material, path, event? }`.
 */
function happen(view, { settings, point, seed, path = WILD, share = 0 }) {
  const ground = wildPlan.groundAt(view, point) || {};
  const mapId = view.frame && view.frame.mapId;
  const here = mapId ? realms.regionAt(view, mapId, point) : null;
  const danger = Number.isFinite(ground.danger) ? ground.danger : 1;
  const out = {
    ...rollOf(seed, chanceOf(settings, danger, share)),
    path,
    danger: Math.round(danger * 100) / 100,
    ...(ground.material ? { material: ground.material } : {}),
  };
  if (!out.happened) return out;
  return {
    ...out,
    event: choose(
      view,
      { material: ground.material, path, mapId, regionId: here && here.region.id },
      dice(seed)
    ),
  };
}

// ── Checking a table ─────────────────────────────────────────────────

/**
 * What's wrong with a table of rows for the wilds, each named: its shape;
 * each row's fields (the encounters format of ../combat/spawns.js, whose
 * `what`, `count` and `weight` are checked as there), `text` words, `kind`
 * one of KINDS (needed with no `what`), `terrain` ground materials of the
 * world and `narrated` a flag; and that each row gives `what` or `text`.
 * Errors only.
 */
function validateRows(world, rows) {
  if (!Array.isArray(rows)) return ['encounters must be a list.'];
  // `what`, `count`, `weight` and the shape, as a place's table is checked.
  const errors = spawns.validateEncounters(world, rows, { wild: true });
  rows.forEach((row, i) => {
    const at = `encounters[${i}]`;
    if (!isObject(row)) return;
    for (const k of Object.keys(row)) {
      if (!ROW_KEYS.includes(k)) errors.push(`${at}.${k} isn't a field of a row.`);
    }
    if (row.what === undefined && !text(row.text)) {
      errors.push(`${at} needs a \`what\` (a stat block) or a \`text\` (what happens).`);
    }
    if (row.text !== undefined && (typeof row.text !== 'string' || row.text.length > MAX_TEXT)) {
      errors.push(`${at}.text must be words of at most ${MAX_TEXT} characters.`);
    }
    if (row.kind !== undefined && !KINDS.includes(row.kind)) {
      errors.push(`${at}.kind must be one of ${KINDS.join(', ')}.`);
    }
    if (row.kind === undefined && row.what === undefined && text(row.text)) {
      errors.push(`${at}.kind is needed with no \`what\`: one of ${KINDS.join(', ')}.`);
    }
    if (row.narrated !== undefined && typeof row.narrated !== 'boolean') {
      errors.push(`${at}.narrated must be true or false.`);
    }
    if (row.path !== undefined) {
      if (!Array.isArray(row.path) || !row.path.length || row.path.length > MAX_PATHS) {
        errors.push(`${at}.path must list 1 to ${MAX_PATHS} paths.`);
      } else {
        for (const id of row.path) {
          if (typeof id !== 'string' || !PATH.test(id)) {
            errors.push(`${at}.path "${id}" must be "${WILD}" or a route kind, like "road".`);
          }
        }
      }
    }
    if (row.terrain !== undefined) {
      if (!Array.isArray(row.terrain) || !row.terrain.length || row.terrain.length > MAX_TERRAINS) {
        errors.push(`${at}.terrain must list 1 to ${MAX_TERRAINS} ground materials.`);
      } else {
        for (const id of row.terrain) {
          if (
            typeof id !== 'string' ||
            !ID.test(id) ||
            !materials.materialOf('ground', id, (world || {}).materials)
          ) {
            errors.push(`${at}.terrain "${id}" is no ground material (list_materials).`);
          }
        }
      }
    }
  });
  return errors;
}

module.exports = {
  KINDS,
  WILD,
  MAX_TEXT,
  BUILT_INS,
  builtInsFor,
  chanceOf,
  pathOf,
  rollOf,
  dice,
  tablesOf,
  fits,
  choose,
  happen,
  validateRows,
};
