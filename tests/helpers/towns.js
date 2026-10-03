'use strict';

/**
 * Towns for tests. The town requirement (planning/the-loom-layered-worlds.md
 * §5; L-342) makes a settlement Playable only with a working town layout, so
 * suites that open settlements for reasons of their own give each one the
 * smallest town that passes: a single written-up gate serving every route.
 * Settlements that already have places keep the town they were given.
 *
 * Battle maps (L-622): the battle-map requirement makes a place in town, or a
 * point of interest, Playable only with a map. So the gates are given a tiny
 * generic map, GATEWAY (its one entry is its way out), and mapPlaces gives a
 * suite's own places the same. Arriving at a place with a map lands on it, and
 * other moves wait until the player walks out: offMap stands a save in town
 * again, for suites whose moves aren't about maps.
 */

const ROUTES = ['road', 'trail', 'sea'];

const gateId = (settlementId) => `plc_${settlementId.replace(/^loc_/, '')}_town-gate`;

const GATEWAY = {
  id: 'bm_test-gateway',
  name: 'A gateway',
  width: 3,
  height: 3,
  image: null,
  entries: [{ id: 'in', x: 1, y: 1 }],
  exits: [{ id: 'way-out', name: 'the way out', x: 1, y: 1, to: 'out' }],
  features: [],
  generic: { kind: 'gateway', terrain: null },
  sources: { map: 'mcp' },
};
const mapped = { battleMap: { mapId: GATEWAY.id } };

function townGate(settlementId) {
  return {
    id: gateId(settlementId),
    locationId: settlementId,
    name: 'The Town Gate',
    kind: 'gate',
    description: 'The way in and out of town.',
    sources: { description: 'mcp' },
    connections: [],
    entrance: { via: ROUTES },
    npcIds: [],
    rules: {},
    ...mapped,
  };
}

/** An in-memory world with a gate for each of these settlements. */
function withTowns(world, ...settlementIds) {
  const gates = Object.fromEntries(settlementIds.map((id) => [gateId(id), townGate(id)]));
  return {
    ...world,
    places: { ...(world.places || {}), ...gates },
    battleMaps: { ...(world.battleMaps || {}), [GATEWAY.id]: GATEWAY },
  };
}

/**
 * Writes a gate for each of these locations that is a settlement without a
 * town yet. The caller bumps canonVersion, as it does for any canon edit.
 */
async function layOutTowns(worldRef, ...locationIds) {
  await worldRef.collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
  for (const id of locationIds) {
    const location = (await worldRef.collection('locations').doc(id).get()).data();
    if (!location || (location.geo || {}).kind !== 'settlement') continue;
    const built = await worldRef.collection('places').where('locationId', '==', id).limit(1).get();
    if (built.empty) await worldRef.collection('places').doc(gateId(id)).set(townGate(id));
  }
}

/**
 * Gives these places in town (or points of interest) the generic GATEWAY map,
 * unless they have a map. `collection` is 'places' or 'locations'.
 */
async function mapPlaces(worldRef, collection, ...ids) {
  await worldRef.collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);
  for (const id of ids) {
    const ref = worldRef.collection(collection).doc(id);
    const doc = (await ref.get()).data();
    if (doc && !doc.battleMap) await ref.update(mapped);
  }
}

/** Stands a save in town, off any battle map, as if it had walked out. */
const offMap = (db, saveId) =>
  db.collection('loom_saves').doc(saveId).update({ mapId: null, cell: null });

module.exports = { gateId, townGate, withTowns, layOutTowns, mapPlaces, offMap, GATEWAY };
