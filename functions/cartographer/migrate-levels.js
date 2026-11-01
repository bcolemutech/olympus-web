'use strict';

/**
 * The map levels migration (planning/map-levels.md §4.4, MP3; L-902 / #720):
 * a world's world map, towns, town places and battle maps written into the
 * levels model (../loom-canon/levels.js; L-901), beside today's data.
 *
 *   the world map    → the top region map, `map_world` (its size, its
 *                      distance unit, its route kinds, its art or backdrop)
 *   each location    → a place on it, keeping its id, position and links
 *   each town        → an area map, `map_town_<locationId>`, under its
 *                      settlement's place (its size in metres, its ground,
 *                      its art); its places become places on it, in place
 *                      (`mapId`, `at` from their position, `opens`)
 *   each battle map  → a grid map of the same id under the place that has it
 *                      (generic maps shared, with no parent), its layers and
 *                      figures carried over; an exit onto another map becomes
 *                      an exit place on it, leading to an entry place on the
 *                      other (`exits: [{ placeId, seconds: 0, name }]`); a
 *                      map no place has, reached by such an exit (a floor
 *                      below), sits under that exit place, which opens it
 *
 * Decided 2026-11-01 (the user): worlds only, no saves (none were left); the
 * old fields stay until L-903 plays from the new model. So nothing a game
 * reads changes: places for locations and grid exits carry no `locationId`
 * and load apart from today's town places (`world.mapPlaces`), and town
 * places keep every field they had.
 *
 * plan(raw) is pure: what the world should hold. run() reads each world,
 * plans it, compares with what is there, and writes only what differs (a
 * dry run writes nothing), so running it twice changes nothing.
 */

const { TOP, townMapId, exitPlaceId, entryPlaceId, plan } = require('../loom-canon/level-plan');

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ── In Firestore ──────────────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// A doc's fields in a stable order, for comparing.
const sorted = (v) =>
  Array.isArray(v)
    ? v.map(sorted)
    : isObject(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sorted(v[k])])
        )
      : v;

async function readRaw(db, worldId) {
  const ref = db.collection('loom_worlds').doc(worldId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const read = async (name) => {
    const out = {};
    (await ref.collection(name).get()).docs.forEach((d) => {
      out[d.id] = d.data();
    });
    return out;
  };
  const [locations, places, battleMaps, maps] = await Promise.all(
    ['locations', 'places', 'battleMaps', 'maps'].map(read)
  );
  return { id: worldId, meta: snap.data(), locations, places, battleMaps, maps };
}

/**
 * Migrates one world: `{ worldId, name, counts, problems, changes: { maps,
 * places, townPlaces, world }, applied }`, `changes` what differs from what
 * is there (what it wrote, or with `apply` false would write).
 */
async function migrateWorld(db, worldId, { apply = false } = {}) {
  const raw = await readRaw(db, worldId);
  if (!raw) return { worldId, missing: true };
  const p = plan(raw);
  const ref = db.collection('loom_worlds').doc(worldId);
  const writes = [];
  const changes = { maps: 0, places: 0, townPlaces: 0, world: 0 };
  // Which, by id (the first 50 of each), for the report.
  const changedIds = { maps: [], places: [], townPlaces: [] };
  const note = (kind, id) => {
    changes[kind] += 1;
    if (changedIds[kind].length < 50) changedIds[kind].push(id);
  };
  for (const [id, doc] of Object.entries(p.maps)) {
    if (same(sorted(raw.maps[id] || null), sorted(doc))) continue;
    note('maps', id);
    writes.push((b) => b.set(ref.collection('maps').doc(id), doc));
  }
  for (const [id, doc] of Object.entries(p.places)) {
    if (same(sorted(raw.places[id] || null), sorted(doc))) continue;
    note('places', id);
    writes.push((b) => b.set(ref.collection('places').doc(id), doc));
  }
  for (const [id, fields] of Object.entries(p.merges)) {
    const now = raw.places[id] || {};
    if (Object.entries(fields).every(([k, v]) => same(sorted(now[k]), sorted(v)))) continue;
    note('townPlaces', id);
    writes.push((b) => b.set(ref.collection('places').doc(id), fields, { merge: true }));
  }
  const changed = writes.length > 0 || raw.meta.topMapId !== p.world.topMapId;
  if (raw.meta.topMapId !== p.world.topMapId) changes.world = 1;
  if (apply && changed) {
    // In batches of 400, then the world: its top map, and a new canonVersion
    // so every cached copy reloads.
    for (let i = 0; i < writes.length; i += 400) {
      const batch = db.batch();
      writes.slice(i, i + 400).forEach((w) => w(batch));
      await batch.commit();
    }
    await ref.update({
      topMapId: p.world.topMapId,
      canonVersion: (raw.meta.canonVersion || 0) + 1,
    });
  }
  return {
    worldId,
    name: raw.meta.name || worldId,
    counts: p.counts,
    problems: p.problems,
    changes,
    changedIds,
    applied: Boolean(apply && changed),
  };
}

/** Migrates every world (or those named): one report each. */
async function run(db, { apply = false, worldIds = null } = {}) {
  const ids = worldIds || (await db.collection('loom_worlds').get()).docs.map((d) => d.id);
  const reports = [];
  for (const id of ids) reports.push(await migrateWorld(db, id, { apply }));
  return reports;
}

module.exports = { TOP, townMapId, exitPlaceId, entryPlaceId, plan, readRaw, migrateWorld, run };
