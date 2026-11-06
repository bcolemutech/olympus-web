'use strict';

/**
 * Spawns (planning/maps-from-data.md §3 DA1b, DA4, §4.5; L-927 / #731):
 * where figures appear on a battle map, and how many. A spawn is an item of
 * the map's geometry, `{ id, name?, at | shape, what?, count? }`: a point or
 * an area, `what` a stat block of the world, `count` how many (1 by default).
 *
 * Events fill them (the broken rest of L-827 now, L-360's later). A spawn
 * with `what` brings its `count` of that stat block. A generic one, with
 * none (DA1b: the same map is reused, so it names no one), takes `{ what,
 * count? }` from the host place's `encounters` table (`[{ what, count?,
 * weight? }]`, a row chosen by weight with the server's dice), so different
 * events bring different figures to the same map.
 *
 * What a fill makes is figures of a group each (the shape `place_figures`
 * sets, ./figures.js), kept on the save, not the world, in
 * `save.spawned[mapId]`: the same map's next save has none. A spawn whose
 * figures still stand is not filled again; one whose figures are all down or
 * gone is, as a new group.
 *
 *   spawnsOf(map)                    the map's spawns
 *   squaresOf(map, spawn)            the squares it covers
 *   encountersOf(host)               the host's table, as written
 *   validateEncounters(world, list)  what's wrong with a table, each named
 *   fill(world, save, { dice })      `{ groups, all, mutations }` for a save
 *                                    standing on a battle map
 *
 * Pure: the dice come from the caller.
 */

const geo = require('../../loom-canon/map-geometry');
const mapPaths = require('../../loom-canon/map-paths');
const maps = require('../../loom-canon/maps');
const figures = require('./figures');

const FEET = mapPaths.FEET;
const MAX_ROWS = 20;
const MAX_COUNT = 20;
const MAX_WEIGHT = 100;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = (cell) => cell.x + ',' + cell.y;

/** A map's spawns, from its geometry. */
function spawnsOf(map) {
  const g = mapPaths.geometryOf(map);
  return g && Array.isArray(g.spawns) ? g.spawns.filter((s) => isObject(s) && s.id) : [];
}

/** The squares a spawn covers, `[{ x, y }]` in reading order: a point's square, or an area's. */
function squaresOf(map, spawn) {
  const c = geo.compile(mapPaths.geometryOf(map));
  const entry = c.spawns.find((e) => e.item.id === spawn.id);
  if (!entry) return [];
  const width = map.width || 0;
  const height = map.height || 0;
  if (!entry.rings) {
    if (!entry.at) return [];
    const cell = {
      x: Math.floor(entry.at.x / FEET + 1e-9),
      y: Math.floor(entry.at.y / FEET + 1e-9),
    };
    return cell.x >= 0 && cell.y >= 0 && cell.x < width && cell.y < height ? [cell] : [];
  }
  const out = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const middle = [(x + 0.5) * FEET, (y + 0.5) * FEET];
      if (entry.rings.some((ring) => geo.pointInShape(middle, ring))) out.push({ x, y });
    }
  }
  return out;
}

/** A host place's encounter table, as written (`[{ what, count?, weight? }]`), or []. */
function encountersOf(host) {
  return host && Array.isArray(host.encounters) ? host.encounters.filter(isObject) : [];
}

/**
 * What's wrong with an encounter table against a world's stat blocks, each
 * named: its shape, each row's `what` a stat block of the world, `count`
 * from 1 to 20, `weight` from 1 to 100. Errors only.
 */
function validateEncounters(world, list) {
  if (!Array.isArray(list)) return ['encounters must be a list.'];
  const errors = [];
  if (list.length > MAX_ROWS) errors.push(`A table has at most ${MAX_ROWS} rows.`);
  const blocks = (world && world.statBlocks) || {};
  list.forEach((row, i) => {
    const at = `encounters[${i}]`;
    if (!isObject(row)) return errors.push(`${at} must be { what, count?, weight? }.`);
    for (const k of Object.keys(row)) {
      if (!['what', 'count', 'weight'].includes(k))
        errors.push(`${at}.${k} isn't a field of a row.`);
    }
    if (typeof row.what !== 'string' || !ID.test(row.what)) {
      errors.push(`${at}.what must be a stat block's id.`);
    } else if (!blocks[row.what]) {
      errors.push(`${at}.what "${row.what}" isn't one of the world's stat blocks.`);
    }
    const whole = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
    if (row.count !== undefined && !whole(row.count, MAX_COUNT)) {
      errors.push(`${at}.count must be a whole number from 1 to ${MAX_COUNT}.`);
    }
    if (row.weight !== undefined && !whole(row.weight, MAX_WEIGHT)) {
      errors.push(`${at}.weight must be a whole number from 1 to ${MAX_WEIGHT}.`);
    }
  });
  return errors;
}

// A row of a table chosen by weight with the dice (`dice(n)`: 1 to n).
function pickRow(rows, dice) {
  const live = rows.filter((r) => typeof r.what === 'string');
  const total = live.reduce((sum, r) => sum + (Number.isInteger(r.weight) ? r.weight : 1), 0);
  if (!total) return null;
  let roll = dice(total);
  for (const row of live) {
    roll -= Number.isInteger(row.weight) ? row.weight : 1;
    if (roll <= 0) return row;
  }
  return live[live.length - 1];
}

// Whether a spawn's figures from an earlier fill still stand in this save.
function standing(save, groups, spawn) {
  const states = (save && save.figures) || {};
  return groups
    .filter((g) => g.spawn === spawn.id)
    .some((g) =>
      (g.cells || []).some((_, i) => {
        const s = states[figures.figureId(g, i + 1)];
        return !(s && (s.down || s.gone));
      })
    );
}

/**
 * Fills a save's map's spawns, for an event: each not standing gets its
 * figures, `what` and `count` its own or a row of the host's table, placed
 * on free squares of its area by the dice (not on what blocks, an entry, an
 * exit, anyone standing there, the player, or each other). Returns `{
 * groups }` (the new ones), `{ all }` (every group the save has now) and the
 * `mutations` that keep them; none when there is no battle map, nothing to
 * fill, or no square free. `world` is as the save sees it (withFigures).
 */
function fill(world, save, { dice }) {
  const { map, cell } = maps.positionOf(world || {}, save);
  const none = { groups: [], all: figures.spawnedOn(save, map && map.id), mutations: [] };
  if (!map) return none;
  const host = maps.hostOf(world, save);
  if (!host) return none;
  const before = figures.spawnedOn(save, map.id);
  const taken = new Set(cell ? [key(cell)] : []);
  const blocks = (world && world.statBlocks) || {};
  const groups = [];
  for (const spawn of spawnsOf(map)) {
    if (standing(save, before, spawn)) continue;
    const row = spawn.what
      ? { what: spawn.what, count: spawn.count }
      : pickRow(encountersOf(host), dice);
    const block = row && blocks[row.what];
    if (!block) continue;
    const count = Math.min(MAX_COUNT, Number.isInteger(row.count) ? row.count : spawn.count || 1);
    const free = squaresOf(map, spawn).filter(
      (sq) => !taken.has(key(sq)) && !maps.squareProblem(world, map, host, sq, null)
    );
    const cells = [];
    while (cells.length < count && free.length) {
      cells.push(free.splice(dice(free.length) - 1, 1)[0]);
    }
    if (!cells.length) continue;
    cells.forEach((sq) => taken.add(key(sq)));
    const made = before.concat(groups).filter((g) => g.spawn === spawn.id).length + 1;
    groups.push({
      id: `spawn-${spawn.id}-${made}`,
      name: block.name || row.what,
      statBlock: row.what,
      cells,
      side: 'hostile',
      spawn: spawn.id,
    });
  }
  if (!groups.length) return none;
  const all = before.concat(groups);
  return {
    groups,
    all,
    mutations: [{ target: 'save', op: 'set-flag', path: `spawned.${map.id}`, value: all }],
  };
}

module.exports = {
  MAX_ROWS,
  MAX_COUNT,
  spawnsOf,
  squaresOf,
  encountersOf,
  validateEncounters,
  fill,
};
