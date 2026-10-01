'use strict';

/**
 * Towns for tests. The town requirement (planning/the-loom-layered-worlds.md
 * §5; L-342) makes a settlement Playable only with a working town layout, so
 * suites that open settlements for reasons of their own give each one the
 * smallest town that passes: a single written-up gate serving every route.
 * Settlements that already have places keep the town they were given.
 */

const ROUTES = ['road', 'trail', 'sea'];

const gateId = (settlementId) => `plc_${settlementId.replace(/^loc_/, '')}_town-gate`;

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
  };
}

/** An in-memory world with a gate for each of these settlements. */
function withTowns(world, ...settlementIds) {
  const gates = Object.fromEntries(settlementIds.map((id) => [gateId(id), townGate(id)]));
  return { ...world, places: { ...(world.places || {}), ...gates } };
}

/**
 * Writes a gate for each of these locations that is a settlement without a
 * town yet. The caller bumps canonVersion, as it does for any canon edit.
 */
async function layOutTowns(worldRef, ...locationIds) {
  for (const id of locationIds) {
    const location = (await worldRef.collection('locations').doc(id).get()).data();
    if (!location || (location.geo || {}).kind !== 'settlement') continue;
    const built = await worldRef.collection('places').where('locationId', '==', id).limit(1).get();
    if (built.empty) await worldRef.collection('places').doc(gateId(id)).set(townGate(id));
  }
}

module.exports = { gateId, townGate, withTowns, layOutTowns };
