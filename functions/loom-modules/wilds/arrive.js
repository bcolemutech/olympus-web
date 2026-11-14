'use strict';

/**
 * Playing an event (planning/off-road-travel.md §4.6, EV4, EV5, EV8; L-366 /
 * #840): an event with figures to meet (L-364) stops the journey on a battle
 * map that fits the camp's ground, with its figures standing on it; the
 * player plays it as any battle map, and leaves by its edge back to the
 * journey.
 *
 *   playedOn(event)            whether an event is played on a map: it has
 *                              figures (`what`) and isn't only told
 *   terrainOf(view, material)  the generator's terrain for a ground material
 *   sceneOf(terrain, event)    the scene it is played in
 *   mapFor(view, at, opts)     the map: the world's generic one tagged for
 *                              the terrain, else a wilds map made from the
 *                              seed; `{ map, from: 'world' | 'generated' }`
 *   arrive(view, save, opts)   the save put on the map at an entry with the
 *                              event's figures standing on it: `{ map,
 *                              mutations, line, groups }`
 *   leave(save, exit)          what leaving by an exit puts right: `{
 *                              mutations, lines }` (the map and its figures
 *                              are dropped; the journey is as it was)
 *   isOn(save)                 whether the save stands on an event's map
 *   worldFor(world, save)      the world as the save sees it on that map: the
 *                              map and its figures among the characters
 *
 * The map is kept on the save, not the world: `save.wildMaps` ({ [mapId]:
 * map }, `wild: true`) and `save.wildEvent` ({ mapId, kind, text, what, count,
 * source }) while it is played. A world's own map is copied under an id of
 * its own (the same event gives the same id), so what the save does on it
 * (doors, objects, what it has found, those it fights) is the event's alone;
 * a map made for it is the generator's for the same terrain, scene and seed,
 * the same every time. Its figures are kept as `save.spawned[mapId]`, stood
 * on the map's spawn areas (one, by the seed), as a broken rest's are
 * (../combat/spawns.js), and their `fig-…` states in `save.figures`.
 * Figures are hostile, and neutral for travellers.
 *
 * Pure: the dice come from the caller.
 */

const crypto = require('crypto');
const mapGenerators = require('../../loom-canon/map-generators');
const geo = require('../../loom-canon/map-geometry');
const maps = require('../../loom-canon/maps');
const materials = require('../../loom-canon/materials');
const wildPlan = require('../../loom-canon/wild-plan');
const spawns = require('../combat/spawns');
const figures = require('../combat/figures');

const SCENE_PHRASES = Object.freeze({
  clearing: 'a clearing',
  'forest-track': 'a track through the trees',
  ford: 'a ford',
  ridge: 'a ridge',
  'marsh-path': 'a path through the marsh',
  ruins: 'some old ruins',
});
const SCENE_NAMES = Object.freeze({
  clearing: 'A clearing',
  'forest-track': 'A forest track',
  ford: 'A ford',
  ridge: 'A ridge',
  'marsh-path': 'A marsh path',
  ruins: 'Old ruins',
});
// How far from every entry a group stands when its map has no spawn areas, in squares.
const FAR = 8;

const live = (e) => Boolean(e) && !e.retired;
const set = (path, value) => ({ target: 'save', op: 'set-flag', path, value });
const hashOf = (text) => crypto.createHash('sha1').update(String(text)).digest('hex');

/** Whether an event is played on a map: figures to meet, not only told. */
function playedOn(event) {
  return Boolean(event) && typeof event.what === 'string' && event.narrated !== true;
}

/** Whether the save stands on the map of an event it is playing. */
function isOn(save) {
  const event = save && save.wildEvent;
  return Boolean(event) && Boolean(save.mapId) && save.mapId === event.mapId;
}

/** The terrain the generator makes for a ground material: its own, or what a world's own is like. */
function terrainOf(view, material) {
  const terrains = mapGenerators.TERRAINS;
  if (terrains.includes(material)) return material;
  const found = materials.materialOf('ground', material, view && view.materials);
  return found && terrains.includes(found.like) ? found.like : 'grass';
}

/** The scene an event is played in: its terrain's likeliest, a clearing for travellers. */
function sceneOf(terrain, event) {
  if (event && event.kind === 'travellers') return 'clearing';
  return mapGenerators.DEFAULT_SCENE[terrain] || 'clearing';
}

// The id of the map for an event, the same for the same seed.
const mapIdOf = (seed) => 'wild-' + hashOf(seed).slice(0, 10);

// The world's generic maps tagged for the ground (`generic.terrain`, by the
// ground's own id or the terrain it is like) with a way out, those of the scene first.
function genericFor(view, material, terrain, scene) {
  const tags = [material, terrain];
  const fits = Object.values((view && view.battleMaps) || {}).filter(
    (m) =>
      live(m) &&
      !m.wild &&
      m.generic &&
      tags.includes(m.generic.terrain) &&
      Array.isArray(m.exits) &&
      m.exits.length > 0
  );
  const best = fits.filter((m) => m.generic.kind === scene);
  return (best.length ? best : fits).sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * The map an event is played on at ground of `material` (EV5): the world's
 * generic map tagged for it, one chosen by `seed` among those that fit, else
 * a wilds map made from the seed. `{ map, from: 'world' | 'generated' }`: the
 * map as the save keeps it (`wild: true`, an id of its own).
 */
function mapFor(view, { material, event, seed }) {
  const terrain = terrainOf(view, material);
  const scene = sceneOf(terrain, event);
  const id = mapIdOf(seed);
  const own = genericFor(view, material, terrain, scene);
  if (own.length) {
    const src = own[parseInt(hashOf(seed + ':map').slice(0, 8), 16) % own.length];
    const copy = JSON.parse(JSON.stringify(src));
    delete copy.retired;
    return {
      map: {
        ...copy,
        id,
        // Its own figures stay at the places that use it: the event brings its own.
        figures: [],
        wild: true,
        sources: { ...(copy.sources || {}), from: src.id },
      },
      from: 'world',
    };
  }
  const made = mapGenerators.generate('wilds', { terrain, scene, seed });
  return {
    map: {
      id,
      name: SCENE_NAMES[made.scene] || 'Open country',
      width: made.width,
      height: made.height,
      entries: made.entries,
      exits: made.exits,
      features: [],
      geometry: geo.normalize(made.geometry),
      areas: [],
      hazards: [],
      figures: [],
      image: null,
      generic: { kind: made.scene, terrain: made.terrain },
      wild: true,
      sources: {
        map: 'generated',
        generated: {
          kind: 'wilds',
          seed: made.seed,
          terrain: made.terrain,
          scene: made.scene,
          version: mapGenerators.VERSION,
        },
      },
    },
    from: 'generated',
  };
}

// The entry the traveller comes in by: on the side they came from (`from`,
// the point of the region map the leg came from, with `to` the camp), else the first.
function entryOf(map, from, to) {
  const entries = (map.entries || []).filter((e) => maps.inBounds(map, e));
  if (!entries.length) return null;
  const dx = from && to ? from[0] - to[0] : 0;
  const dy = from && to ? from[1] - to[1] : 0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return entries[0];
  const cx = (map.width - 1) / 2;
  const cy = (map.height - 1) / 2;
  let best = entries[0];
  let bestScore = -Infinity;
  for (const e of entries) {
    const ex = e.x - cx;
    const ey = e.y - cy;
    const norm = Math.hypot(ex, ey) || 1;
    const score = (ex * dx + ey * dy) / (norm * len);
    if (score > bestScore + 1e-9) {
      best = e;
      bestScore = score;
    }
  }
  return best;
}

// The world with the event's map in it, for placing figures on it.
function withMap(world, map) {
  return { ...world, battleMaps: { ...(world.battleMaps || {}), [map.id]: map } };
}

// The squares a group may stand on when the map has no spawn areas: open ones
// FAR squares or more from every entry, nearest a seeded pivot first.
function scatterSquares(world, map, host, dice) {
  const entries = map.entries && map.entries.length ? map.entries : [{ x: 0, y: 0 }];
  const open = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const sq = { x, y };
      if (!maps.squareProblem(world, map, host, sq, null)) open.push(sq);
    }
  }
  const away = (sq) => Math.min(...entries.map((e) => Math.hypot(e.x - sq.x, e.y - sq.y)));
  const far = open.filter((sq) => away(sq) >= FAR);
  const pool = far.length ? far : open.sort((a, b) => away(b) - away(a)).slice(0, 12);
  if (!pool.length) return [];
  const pivot = pool[dice(pool.length) - 1];
  return open.sort(
    (a, b) =>
      Math.hypot(a.x - pivot.x, a.y - pivot.y) - Math.hypot(b.x - pivot.x, b.y - pivot.y) ||
      a.y - b.y ||
      a.x - b.x
  );
}

/**
 * The event's figures on the map, as one group (as `place_figures` sets one
 * and a broken rest's spawn fills one): on one of the map's spawn areas, by
 * the dice, or, with none, on open squares far from its entries. `world` has
 * the map in it. Returns the groups (none when nobody can stand there).
 */
function groupsFor(world, map, event, dice) {
  const block = ((world && world.statBlocks) || {})[event.what];
  if (!block) return [];
  const host = maps.wildHost(world, map.id);
  const count = Math.min(spawns.MAX_COUNT, Number.isInteger(event.count) ? event.count : 1);
  const areas = spawns
    .spawnsOf(map)
    .map((spawn) => ({
      spawn,
      free: spawns
        .squaresOf(map, spawn)
        .filter((sq) => !maps.squareProblem(world, map, host, sq, null)),
    }))
    .filter((a) => a.free.length);
  let spawn = null;
  let cells = [];
  if (areas.length) {
    // One area, by the dice: one that holds them all if any does.
    const roomy = areas.filter((a) => a.free.length >= count);
    const from = roomy.length ? roomy : areas;
    const area = from[dice(from.length) - 1];
    spawn = area.spawn.id;
    const free = area.free.slice();
    while (cells.length < count && free.length)
      cells.push(free.splice(dice(free.length) - 1, 1)[0]);
  } else {
    spawn = 'scatter';
    cells = scatterSquares(world, map, host, dice).slice(0, count);
  }
  if (!cells.length) return [];
  return [
    {
      id: 'event-' + map.id.slice(5),
      name: block.name || event.what,
      statBlock: event.what,
      cells,
      side: event.kind === 'travellers' ? 'neutral' : 'hostile',
      spawn,
    },
  ];
}

/**
 * The save put on the map of an event at the camp `at` ([x, y] of the
 * frame's map): `{ map, from, mutations, line, groups }`, or null when the
 * event isn't played on a map (no stat block of the world, no square for
 * its figures, no way in). `opts`: `event` (as the turn records it), `from`
 * (the point the leg came from, to choose the side it enters by), `seed`
 * (the leg's, as the roll is) and `dice` (`(sides) => 1..sides`, from the
 * same seed).
 */
function arrive(view, save, { at, event, from = null, seed, dice }) {
  if (!playedOn(event) || !((view && view.statBlocks) || {})[event.what]) return null;
  const ground = wildPlan.groundAt(view, at) || {};
  const made = mapFor(view, { material: ground.material, event, seed });
  const map = made.map;
  const entry = entryOf(map, from, at);
  const world = withMap(view, map);
  const groups = groupsFor(world, map, event, dice);
  if (!groups.length) return null;
  const cell = maps.entryCell(map, entry && entry.id);
  const scene = (map.generic && map.generic.kind) || null;
  return {
    map,
    from: made.from,
    groups,
    line: 'You come to ' + (SCENE_PHRASES[scene] || 'open country') + '.',
    mutations: [
      // In the wilds at the camp, as `at` puts it (the turn's other fields
      // are read from it only when it is committed).
      set('location', null),
      set('placeId', null),
      set('townPoint', null),
      set('wild', { x: at[0], y: at[1] }),
      set('wildMaps', { [map.id]: map }),
      set('wildEvent', {
        mapId: map.id,
        kind: event.kind,
        text: event.text,
        what: event.what,
        count: event.count,
        source: event.source,
      }),
      set('mapId', map.id),
      set('cell', cell),
      set('gridPoint', null),
      set(`spawned.${map.id}`, groups),
    ],
  };
}

// An object without `id`: what is left when a map's entries are dropped.
const without = (obj, id) =>
  Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k !== id));

/**
 * Leaving the event's map by `exit` (EV8): back to the camp, the journey as
 * it was. The map and its figures are dropped, with what the save did there
 * (doors, objects, what it found). `{ mutations, lines }`.
 */
function leave(save, exit) {
  const mapId = save.mapId;
  const ids = new Set();
  for (const group of figures.spawnedOn(save, mapId)) {
    (group.cells || []).forEach((_, i) => ids.add(figures.figureId(group, i + 1)));
  }
  const mutations = [
    set('mapId', null),
    set('cell', null),
    set('gridPoint', null),
    set('wildEvent', null),
    set('wildMaps', null),
    set('spawned', without(save.spawned, mapId)),
  ];
  for (const field of ['doors', 'objects', 'secrets']) {
    if (save[field] && save[field][mapId]) mutations.push(set(field, without(save[field], mapId)));
  }
  const dropped = (field) =>
    Object.fromEntries(Object.entries(save[field] || {}).filter(([k]) => !ids.has(k)));
  for (const field of ['figures', 'sides']) {
    if (Object.keys(save[field] || {}).some((k) => ids.has(k))) {
      mutations.push(set(field, dropped(field)));
    }
  }
  mutations.push({ op: 'increment', path: 'worldClock', value: 1 });
  const journey = save.journey && (save.journey.path || []).length;
  return {
    mutations,
    lines: [
      'You leave by ' +
        (exit && exit.name ? exit.name : 'the edge of the map') +
        ', back to the ' +
        (journey ? 'way you were going' : 'open country') +
        '.' +
        (journey ? ' You can go on, turn back or head somewhere else.' : ''),
    ],
  };
}

/**
 * The world as a save on the map of an event sees it: that map, kept on the
 * save, in `battleMaps`, and its figures standing among the characters.
 */
function worldFor(world, save) {
  const kept = (save && save.wildMaps) || {};
  const grafted = Object.keys(kept).length
    ? { ...world, battleMaps: { ...(world.battleMaps || {}), ...kept } }
    : world;
  return figures.withFigures(grafted, save);
}

module.exports = {
  SCENE_PHRASES,
  playedOn,
  isOn,
  terrainOf,
  sceneOf,
  mapFor,
  entryOf,
  groupsFor,
  arrive,
  leave,
  worldFor,
};
