'use strict';

/**
 * Today's battle maps converted (planning/maps-from-data.md §4.7, EX4;
 * L-928 / #732): each battle map's walls, doors and obstacles stored as its
 * geometry, in its battle map document (GE5), beside the layers, which play
 * goes on reading until the code reads only the geometry (L-928's second
 * PR). Generic maps, floors reached by exits and templates (whose instances
 * are made from them as the world loads) convert with them. Features,
 * entries, exits, areas, hazards and figures aren't layers and stay as they
 * are; their ids and squares don't change.
 *
 *   walls      → walls, along the same lines (stone)
 *   doors      → doors (wood), each in a short wall of its own, keeping its
 *                id, name, lock, key, own AP, long action and difficulty
 *   obstacles  → solid: pillars (objects that hide); low: walls round their
 *                squares, 3 ft high, hiding nothing; difficult: ground (gravel)
 *                costing 2
 *
 * as ../loom-canon/layer-geometry.js `converted` makes it: what play reads
 * now, stored.
 *
 * The replay (`replay`): for each map, the same questions asked of it as
 * played now and of its geometry alone, the layers dropped: the cost of the
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

const geo = require('../loom-canon/map-geometry');
const mapPaths = require('../loom-canon/map-paths');
const sight = require('../loom-canon/sight');
const layerGeometry = require('../loom-canon/layer-geometry');

const SIZES = ['medium', 'large'];
const MAX_SPOTS = 16;
const ROUND = 1e-6;

// ── The replay ────────────────────────────────────────────────────────

/** The map with its layers dropped and `geometry` stored: what play will read. */
function afterOf(map, geometry) {
  return { ...map, walls: [], doors: [], obstacles: [], geometry };
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
 * its layers' counts, the geometry to store, whether it differs from what's
 * stored, the geometry's problems (map-geometry.js `check`), and the replay.
 * A map without layers has nothing to convert (`geometry` null).
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
  const geometry = layerGeometry.converted(map);
  const F = geo.FEET_PER_SQUARE;
  const problems = geo.check(geometry, { width: map.width * F, height: map.height * F });
  const changed = layerGeometry.stable(map.geometry || {}) !== layerGeometry.stable(geometry);
  return {
    id: map.id,
    layers,
    geometry,
    changed,
    problems,
    replay: replayIt ? replay(map, afterOf(map, geometry)) : null,
  };
}

// ── In Firestore ──────────────────────────────────────────────────────

/**
 * Converts one world's battle maps: `{ worldId, name, maps, converted,
 * changed, changedIds, problems, replay: { maps, checks, matched,
 * differences }, applied }`, `changed` how many differ from what is stored
 * (written, or with `apply` false would be).
 */
async function convertWorld(db, worldId, { apply = false, replayIt = true } = {}) {
  const ref = db.collection('loom_worlds').doc(worldId);
  const snap = await ref.get();
  if (!snap.exists) return { worldId, missing: true };
  const meta = snap.data();
  const docs = (await ref.collection('battleMaps').get()).docs;
  const plans = docs.map((d) => planMap({ ...d.data(), id: d.id }, { replayIt }));
  const withLayers = plans.filter((p) => p.geometry);
  const changedPlans = withLayers.filter((p) => p.changed);
  const problems = withLayers.flatMap((p) => p.problems.map((x) => `${p.id}: ${x}`));
  const differences = withLayers.flatMap((p) =>
    p.replay ? p.replay.differences.map((d) => ({ map: p.id, ...d })) : []
  );
  const report = {
    worldId,
    name: meta.name || worldId,
    maps: plans.length,
    converted: withLayers.length,
    changed: changedPlans.length,
    changedIds: changedPlans.slice(0, 50).map((p) => p.id),
    problems,
    replay: {
      maps: withLayers.filter((p) => p.replay).length,
      checks: withLayers.reduce((n, p) => n + (p.replay ? p.replay.checks : 0), 0),
      matched: withLayers.filter((p) => p.replay && !p.replay.differences.length).length,
      differences: differences.slice(0, 50),
    },
    applied: false,
  };
  if (apply && changedPlans.length) {
    for (let i = 0; i < changedPlans.length; i += 400) {
      const batch = db.batch();
      changedPlans
        .slice(i, i + 400)
        .forEach((p) =>
          batch.update(ref.collection('battleMaps').doc(p.id), { geometry: p.geometry })
        );
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

module.exports = { SIZES, afterOf, spotsOf, replay, planMap, convertWorld, run };
