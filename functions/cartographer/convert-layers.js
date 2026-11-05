'use strict';

/**
 * Today's battle maps converted (planning/maps-from-data.md §4.7, EX4;
 * L-928 / #732): each battle map's walls, doors and obstacles stored as its
 * geometry, in its battle map document (GE5), and the layers deleted: play
 * reads only the geometry. Generic maps, floors reached by exits and
 * templates (whose instances are made from them as the world loads) convert
 * with them. Features, entries, exits, areas, hazards and figures aren't
 * layers and stay as they are; their ids and squares don't change.
 *
 *   walls      → walls, along the same lines (stone)
 *   doors      → doors (wood), each in a short wall of its own, keeping its
 *                id, name, lock, key, own AP, long action and difficulty
 *   obstacles  → solid: pillars (objects that hide); low: walls round their
 *                squares, 3 ft high, hiding nothing; difficult: ground (gravel)
 *                costing 2; each keeping its name
 *
 * as ../loom-canon/layer-geometry.js makes it: what the layers made before
 * (ids starting "layer-", and doors in doorways of that name) made again
 * from the layers, and the map's own items kept. The first run (L-928's
 * first PR) stored the geometry beside the layers; this one stores it again
 * (now with obstacles' names) and deletes the layers, and the copies of them
 * L-902 left on grid maps in `maps`. A grid map in `maps` with no battle map
 * document of its own is converted the same way.
 *
 * The replay (`replay`): for each map, the same questions asked of it as
 * played before (its layers read as geometry beside what was stored, the
 * stored items winning on an id) and of its geometry alone: the cost of the
 * way from each entry, exit, feature and figure to every square, for a
 * medium and a large character; the squares reached from the entries (as
 * `cell: "auto"` and the builders' checks ask, and with every door open);
 * and the squares in sight from each of those spots. Every answer must
 * match; any that doesn't is reported, and the map is still written only
 * when asked (`apply`).
 *
 * run() reads each world's battle maps, converts them, compares with what is
 * stored, and writes only what differs (a dry run writes nothing), so
 * running it twice changes nothing.
 */

const { FieldValue } = require('firebase-admin/firestore');
const geo = require('../loom-canon/map-geometry');
const mapPaths = require('../loom-canon/map-paths');
const sight = require('../loom-canon/sight');
const layerGeometry = require('../loom-canon/layer-geometry');

const SIZES = ['medium', 'large'];
const MAX_SPOTS = 16;
const ROUND = 1e-6;

// ── The replay ────────────────────────────────────────────────────────

/** The map with its layers dropped and `geometry` stored: what play reads. */
function afterOf(map, geometry) {
  const out = { ...map, geometry };
  for (const k of layerGeometry.LAYERS) delete out[k];
  return out;
}

/** The map as it played before: its layers read as geometry beside what was stored. */
function beforeOf(map) {
  return { ...map, geometry: layerGeometry.converted(map) };
}

/** The geometry a map stores: what its layers make, made again, its own items kept. */
function geometryFor(map) {
  return layerGeometry.converted({ ...map, geometry: layerGeometry.ownOf(map.geometry) });
}

// The squares the replay starts from: entries, exits, features and figures,
// once each, on the grid, at most MAX_SPOTS.
function spotsOf(map) {
  const out = [];
  const seen = new Set();
  const add = (c, what) => {
    if (!c || !Number.isInteger(c.x) || !Number.isInteger(c.y)) return;
    if (c.x < 0 || c.y < 0 || c.x >= map.width || c.y >= map.height) return;
    const k = c.x + ',' + c.y;
    if (seen.has(k) || out.length >= MAX_SPOTS) return;
    seen.add(k);
    out.push({ x: c.x, y: c.y, what });
  };
  (map.entries || []).forEach((e) => add(e, 'entry ' + (e.id || '')));
  (map.exits || []).forEach((e) => add(e, 'exit ' + (e.id || '')));
  (map.features || []).forEach((f) => add(f, 'feature ' + (f.id || '')));
  (map.figures || []).forEach((f) =>
    (f.cells || (f.cell ? [f.cell] : [])).forEach((c) => add(c, 'figure ' + (f.id || '')))
  );
  return out;
}

// A door's AP as the replay prices it: its own, else 1.
const PRICES = { move: 1, difficult: 2, door: (d) => (d && Number.isFinite(d.ap) ? d.ap : 1) };

const round = (w) => Math.round(w / ROUND) * ROUND;

// The cost of the way from `from` to every square (null where it's not
// reached), and where in each square it ends.
function costs(map, from, size) {
  const plan = mapPaths.planner(map, { width: mapPaths.widthOf(size), prices: PRICES });
  const start = mapPaths.spotIn(plan, from);
  if (!start) return null;
  const at = mapPaths.costsFrom(plan, start);
  const out = [];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const c = at({ x, y });
      out.push(c ? round(c.weight) + '@' + round(c.spot.x) + ',' + round(c.spot.y) : '-');
    }
  }
  return out;
}

const keysOf = (set) => Object.keys(set || {}).sort();

/**
 * The replay of one map: `{ checks, differences }`, each difference
 * `{ check, from?, size?, at?, before, after }` (the first 20).
 */
function replay(before, after) {
  const differences = [];
  let checks = 0;
  const differ = (d) => {
    if (differences.length < 20) differences.push(d);
  };
  const spots = spotsOf(before);
  const name = (c) => `(${c.x}, ${c.y})` + (c.what ? ' ' + c.what.trim() : '');

  // The ways from each spot, by size.
  for (const size of SIZES) {
    for (const s of spots) {
      checks++;
      const a = costs(before, s, size);
      const b = costs(after, s, size);
      if (!a || !b) {
        if (Boolean(a) !== Boolean(b)) {
          differ({ check: 'room', from: name(s), size, before: Boolean(a), after: Boolean(b) });
        }
        continue;
      }
      const i = a.findIndex((v, k) => v !== b[k]);
      if (i !== -1) {
        const at = { x: i % before.width, y: Math.floor(i / before.width) };
        differ({ check: 'way', from: name(s), size, at, before: a[i], after: b[i] });
      }
    }
  }

  // The squares reached from the entries: as `cell: "auto"` and the
  // builders' checks ask (doors open unless locked), and every door open.
  const entries = before.entries || [];
  if (entries.length) {
    for (const [label, options] of [
      ['reach', {}],
      ['reach, doors open', { open: () => true }],
    ]) {
      checks++;
      const a = keysOf(mapPaths.squaresReached(before, entries, options));
      const b = keysOf(mapPaths.squaresReached(after, entries, options));
      if (a.join(' ') !== b.join(' ')) {
        differ({
          check: label,
          before: a.filter((k) => !b.includes(k)).slice(0, 10),
          after: b.filter((k) => !a.includes(k)).slice(0, 10),
        });
      }
    }
  }

  // The squares in sight from each spot, doors as they start.
  for (const s of spots) {
    checks++;
    const a = keysOf(sight.inSight(before, { cell: s }, {}));
    const b = keysOf(sight.inSight(after, { cell: s }, {}));
    if (a.join(' ') !== b.join(' ')) {
      differ({
        check: 'sight',
        from: name(s),
        before: a.filter((k) => !b.includes(k)).slice(0, 10),
        after: b.filter((k) => !a.includes(k)).slice(0, 10),
      });
    }
  }
  return { checks, differences };
}

/**
 * One battle map: `{ id, layers, geometry, changed, problems, replay }`:
 * its layers' counts, the geometry to store, whether the map changes (its
 * geometry differs from what's stored, or it has layers to delete), the
 * geometry's problems (map-geometry.js `check`), and the replay. A map
 * without layers has nothing to convert (`geometry` null).
 */
function planMap(map, { replayIt = true } = {}) {
  const layers = {
    walls: (map.walls || []).length,
    doors: (map.doors || []).length,
    obstacles: (map.obstacles || []).length,
  };
  if (!layerGeometry.hasLayers(map)) {
    return { id: map.id, layers, geometry: null, changed: false, problems: [], replay: null };
  }
  const geometry = geometryFor(map);
  const F = geo.FEET_PER_SQUARE;
  const problems = geo.check(geometry, { width: map.width * F, height: map.height * F });
  return {
    id: map.id,
    layers,
    geometry,
    changed: true,
    problems,
    replay: replayIt ? replay(beforeOf(map), afterOf(map, geometry)) : null,
  };
}

// The old fields' deletes, for the ones a doc has.
function deletes(doc) {
  const out = {};
  for (const k of layerGeometry.LAYERS) if (doc[k] !== undefined) out[k] = FieldValue.delete();
  return out;
}

// ── In Firestore ──────────────────────────────────────────────────────

/**
 * Converts one world's battle maps: `{ worldId, name, maps, converted,
 * changed, changedIds, gridCopies, problems, replay: { maps, checks,
 * matched, differences }, applied }`: `converted` the battle maps (and grid
 * maps without one) with layers, each stored as geometry with its layers
 * deleted; `gridCopies` the grid maps whose copies of their battle map's
 * layers are deleted (written, or with `apply` false would be).
 */
async function convertWorld(db, worldId, { apply = false, replayIt = true } = {}) {
  const ref = db.collection('loom_worlds').doc(worldId);
  const snap = await ref.get();
  if (!snap.exists) return { worldId, missing: true };
  const meta = snap.data();
  const [battleDocs, mapDocs] = await Promise.all(
    ['battleMaps', 'maps'].map(async (name) => (await ref.collection(name).get()).docs)
  );
  const battleIds = new Set(battleDocs.map((d) => d.id));
  // Grid maps with no battle map document play from their own (frames.js).
  const grids = mapDocs.filter((d) => (d.data() || {}).kind === 'grid');
  const native = grids.filter((d) => !battleIds.has(d.id));
  const copies = grids.filter(
    (d) => battleIds.has(d.id) && layerGeometry.hasLayers(d.data() || {})
  );
  const plans = [
    ...battleDocs.map((d) => ({ collection: 'battleMaps', doc: d })),
    ...native.map((d) => ({ collection: 'maps', doc: d })),
  ].map(({ collection, doc }) => ({
    collection,
    data: doc.data(),
    ...planMap({ ...doc.data(), id: doc.id }, { replayIt }),
  }));
  const withLayers = plans.filter((p) => p.geometry);
  const problems = withLayers.flatMap((p) => p.problems.map((x) => `${p.id}: ${x}`));
  const differences = withLayers.flatMap((p) =>
    p.replay ? p.replay.differences.map((d) => ({ map: p.id, ...d })) : []
  );
  const report = {
    worldId,
    name: meta.name || worldId,
    maps: battleDocs.length,
    converted: withLayers.length,
    changed: withLayers.length,
    changedIds: withLayers.slice(0, 50).map((p) => p.id),
    gridCopies: copies.length,
    problems,
    replay: {
      maps: withLayers.filter((p) => p.replay).length,
      checks: withLayers.reduce((n, p) => n + (p.replay ? p.replay.checks : 0), 0),
      matched: withLayers.filter((p) => p.replay && !p.replay.differences.length).length,
      differences: differences.slice(0, 50),
    },
    applied: false,
  };
  const writes = [
    ...withLayers.map(
      (p) => (b) =>
        b.update(ref.collection(p.collection).doc(p.id), {
          geometry: Object.keys(p.geometry).length ? p.geometry : FieldValue.delete(),
          ...deletes(p.data),
        })
    ),
    ...copies.map((d) => (b) => b.update(ref.collection('maps').doc(d.id), deletes(d.data()))),
  ];
  if (apply && writes.length) {
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }
    // A new canonVersion, so every cached copy reloads.
    await ref.update({ canonVersion: (meta.canonVersion || 0) + 1 });
    report.applied = true;
  }
  return report;
}

/** Converts every world's battle maps (or those named): one report each. */
async function run(db, { apply = false, worldIds = null, replayIt = true } = {}) {
  const ids = worldIds || (await db.collection('loom_worlds').get()).docs.map((d) => d.id);
  const reports = [];
  for (const id of ids) reports.push(await convertWorld(db, id, { apply, replayIt }));
  return reports;
}

module.exports = {
  SIZES,
  afterOf,
  beforeOf,
  geometryFor,
  spotsOf,
  replay,
  planMap,
  convertWorld,
  run,
};
