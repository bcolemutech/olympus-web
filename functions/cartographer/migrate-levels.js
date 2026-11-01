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

const town = require('../loom-canon/town');
const levels = require('../loom-canon/levels');

const TOP = 'map_world';
const townMapId = (locationId) => 'map_town_' + locationId;
const exitPlaceId = (mapId, exitId) => mapId + '~exit~' + exitId;
const entryPlaceId = (mapId, entryId) => mapId + '~entry~' + entryId;
// A battle map's square in metres (5 ft), for the grid's space.
const SQUARE_METRES = 1.5;
// What a grid carries over from a battle map besides its size.
const GRID_LAYERS = [
  'entries',
  'exits',
  'features',
  'walls',
  'doors',
  'obstacles',
  'hazards',
  'areas',
  'figures',
  'image',
  'generic',
  'revision',
  'sources',
  'retired',
];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const has = (v) => v !== undefined && v !== null;
const pick = (from, keys) =>
  Object.fromEntries(keys.filter((k) => has(from[k])).map((k) => [k, from[k]]));

/**
 * What a world should hold in the levels model: `{ world: { topMapId },
 * maps: { [id]: doc }, places: { [id]: doc } (whole, new), merges: { [id]:
 * fields } (on today's town places), problems: [text], counts }`. `raw` is
 * the world document and its collections as stored: `{ id, meta, locations,
 * places, battleMaps }`.
 */
function plan(raw) {
  const meta = raw.meta || {};
  const locations = raw.locations || {};
  // Today's town places: those with a settlement. The places a run before
  // wrote (locations, grids' ways in and out) have none and aren't read.
  const townPlaces = Object.fromEntries(
    Object.entries(raw.places || {}).filter(([, p]) => p && p.locationId)
  );
  const battleMaps = raw.battleMaps || {};
  const maps = {};
  const places = {};
  const merges = {};
  const problems = [];

  // ── The top region map (MP4) ──
  const map = meta.map || {};
  const kinds = new Set();
  for (const loc of Object.values(locations)) {
    for (const kind of Object.values((loc.geo && loc.geo.links) || {})) kinds.add(kind);
  }
  const distance = isObject(map.distance)
    ? {
        unit: map.distance.unit || 'mile',
        perUnit: map.distance.perMapUnit || map.distance.perUnit || 1,
      }
    : null;
  maps[TOP] = {
    kind: 'region',
    parent: null,
    name: meta.name || raw.id,
    space: {
      width: map.width || 1000,
      height: map.height || 1000,
      ...(distance ? { distance } : {}),
    },
    routeKinds: [...kinds].sort(),
    ...(has(map.image) ? { image: map.image } : {}),
    ...(has(map.imagePath) ? { imagePath: map.imagePath } : {}),
    ...(has(map.backdrop) ? { backdrop: map.backdrop } : {}),
    migratedFrom: 'world',
  };

  // Who has which battle map: [{ mapId (the place's map), placeId }].
  const users = {};
  const usesMap = (entity, at) => {
    const id = entity && entity.battleMap && entity.battleMap.mapId;
    if (id) (users[id] = users[id] || []).push(at);
    return id || null;
  };

  // ── Each location: a place on the top map; its town an area map ──
  const townOf = {};
  for (const tp of Object.values(townPlaces)) {
    if (tp && tp.locationId) (townOf[tp.locationId] = townOf[tp.locationId] || []).push(tp);
  }
  for (const [id, loc] of Object.entries(locations)) {
    if (townPlaces[id]) {
      problems.push(`Location ${id} has the same id as a town place: left out.`);
      continue;
    }
    const geo = loc.geo || {};
    const hasTown = Boolean(townOf[id] && townOf[id].length) || isObject(loc.town);
    const battle = usesMap(loc, { mapId: TOP, placeId: id });
    if (hasTown && battle) {
      problems.push(`${loc.name || id} has a town and a battle map: it opens the town.`);
    }
    places[id] = {
      mapId: TOP,
      name: loc.name || id,
      kind: geo.kind || loc.kind || 'location',
      ...(has(loc.description) ? { description: loc.description } : {}),
      ...(Number.isFinite(geo.x) && Number.isFinite(geo.y) ? { at: { x: geo.x, y: geo.y } } : {}),
      links: Object.entries(geo.links || {})
        .map(([placeId, kind]) => ({ placeId, kind }))
        .sort((a, b) => a.placeId.localeCompare(b.placeId)),
      ...(hasTown
        ? { opens: { mapId: townMapId(id) } }
        : battle
          ? { opens: { mapId: battle } }
          : {}),
      ...(loc.retired ? { retired: true } : {}),
      migratedFrom: 'location',
    };
    if (!places[id].at) problems.push(`${loc.name || id} has no position on the world map.`);
    if (!hasTown) continue;
    const t = loc.town || {};
    maps[townMapId(id)] = {
      kind: 'area',
      parent: { mapId: TOP, placeId: id },
      name: loc.name || id,
      space: { width: town.TOWN_SIDE, height: town.TOWN_SIDE, size: town.townSize(loc).metres },
      ...(has(t.ground) ? { ground: t.ground } : {}),
      ...(has(t.image) ? { image: t.image } : {}),
      migratedFrom: 'town',
    };
  }

  // ── Town places: on their town's map, in place ──
  for (const [id, tp] of Object.entries(townPlaces)) {
    if (!tp || !tp.locationId) continue;
    if (!locations[tp.locationId]) {
      problems.push(
        `Town place ${id} is in ${tp.locationId}, which isn't a location: left as it is.`
      );
      continue;
    }
    const mapId = townMapId(tp.locationId);
    const battle = usesMap(tp, { mapId, placeId: id });
    const pos = tp.position;
    merges[id] = {
      mapId,
      ...(isObject(pos) && Number.isFinite(pos.x) && Number.isFinite(pos.y)
        ? { at: { x: pos.x, y: pos.y } }
        : {}),
      ...(battle ? { opens: { mapId: battle } } : {}),
    };
  }

  // Maps reached only by an exit from another map (a floor below): the
  // first such exit's place on the map above is their parent.
  const reachedBy = {};
  for (const [id, bm] of Object.entries(battleMaps)) {
    for (const exit of bm.exits || []) {
      const to = exit && exit.to;
      if (isObject(to) && to.map && to.map !== id && !reachedBy[to.map]) {
        reachedBy[to.map] = { mapId: id, placeId: exitPlaceId(id, exit.id) };
      }
    }
  }

  // ── Battle maps: grids under the place that has them ──
  for (const [id, bm] of Object.entries(battleMaps)) {
    const who = users[id] || [];
    let parent = null;
    if (bm.generic) parent = null;
    else if (!who.length && reachedBy[id] && battleMaps[reachedBy[id].mapId]) {
      parent = reachedBy[id];
    } else if (who.length) {
      parent = who[0];
      if (who.length > 1) {
        problems.push(
          `Battle map ${id} is used by ${who.length} places: its parent is ${who[0].placeId}.`
        );
      }
    } else problems.push(`Battle map ${id} is used by no place: it has no parent.`);
    maps[id] = {
      kind: 'grid',
      parent,
      name: bm.name || id,
      space: { width: bm.width, height: bm.height, squareSize: SQUARE_METRES },
      ...pick(bm, GRID_LAYERS),
      migratedFrom: 'battleMap',
    };
  }

  // ── Exits onto other maps: an exit place leading to an entry place ──
  for (const [id, bm] of Object.entries(battleMaps)) {
    for (const exit of bm.exits || []) {
      const to = exit && exit.to;
      if (!isObject(to) || !to.map) continue;
      const target = battleMaps[to.map];
      if (!target) {
        problems.push(`Exit ${exit.id} on ${id} leads to ${to.map}, which isn't a battle map.`);
        continue;
      }
      const entry =
        (target.entries || []).find((e) => e.id === to.entry) || (target.entries || [])[0];
      if (!entry) {
        problems.push(`Exit ${exit.id} on ${id} leads to ${to.map}, which has no entry.`);
        continue;
      }
      const into = entryPlaceId(to.map, entry.id);
      places[into] = {
        mapId: to.map,
        name: entry.name || 'The way in',
        kind: 'entry',
        at: { x: entry.x, y: entry.y },
        migratedFrom: 'entry',
      };
      places[exitPlaceId(id, exit.id)] = {
        mapId: id,
        name: exit.name || 'The way out',
        kind: 'exit',
        at: { x: exit.x, y: exit.y },
        exits: [{ placeId: into, seconds: 0, name: exit.name || 'the way out' }],
        // The floor below, when this is the way it is reached.
        ...(maps[to.map] &&
        maps[to.map].parent &&
        maps[to.map].parent.placeId === exitPlaceId(id, exit.id)
          ? { opens: { mapId: to.map } }
          : {}),
        migratedFrom: 'exit',
      };
    }
  }

  // ── Checked against the model, as loaded (L-901) ──
  const world = {
    topMapId: TOP,
    maps,
    places: Object.fromEntries(
      Object.entries(townPlaces).map(([id, tp]) => [id, { ...tp, ...(merges[id] || {}) }])
    ),
  };
  Object.assign(world.places, places);
  for (const [id, m] of Object.entries(maps)) {
    levels.validateMap(m, id).forEach((e) => problems.push(e));
  }
  for (const [id, p] of Object.entries(world.places)) {
    if (p.mapId) levels.validatePlace(world, p, id).forEach((e) => problems.push(e));
  }

  return {
    world: { topMapId: TOP },
    maps,
    places,
    merges,
    problems,
    counts: {
      maps: Object.keys(maps).length,
      regionMaps: 1,
      areaMaps: Object.values(maps).filter((m) => m.kind === 'area').length,
      gridMaps: Object.values(maps).filter((m) => m.kind === 'grid').length,
      places: Object.keys(places).length,
      townPlaces: Object.keys(merges).length,
    },
  };
}

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
