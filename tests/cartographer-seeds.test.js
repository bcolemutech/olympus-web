'use strict';

/**
 * Town seeds for already-imported worlds (planning/the-loom-layered-worlds.md
 * §8; L-341 / #395): planned from the world's original Azgaar export and
 * applied by the shared backfill writer, alongside the description stamps.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-seeds --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const fs = require('fs');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { planSeedBackfill } = require('../functions/cartographer/seeds');
const { planSourceBackfill, sourceWrites } = require('../functions/cartographer/sources');
const { applyBackfill } = require('../functions/cartographer/backfill');

const mapped = mapToCanon(
  parseAzgaarExport(fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json')))
);

// Nisia as imported before seeds: the mapper's locations without geo.seeds,
// and a map without its distance scale.
function oldNisia() {
  const locations = JSON.parse(JSON.stringify(mapped.canon.locations));
  for (const place of Object.values(locations)) delete place.geo.seeds;
  return {
    meta: { map: { width: 1718, height: 1270, imagePath: null } },
    entities: { locations },
  };
}

describe('planning', () => {
  test('every settlement gets its seeds, and the map its distance scale', () => {
    const { meta, entities } = oldNisia();
    const plan = planSeedBackfill({ meta, entities, mapped });
    expect(plan.summary).toEqual({
      settlements: 663,
      toSeed: 663,
      alreadySeeded: 0,
      unknown: 0,
      distance: { unit: 'mi', perMapUnit: 2 },
    });
    expect(plan.writes.find((w) => w.id === 'loc_1')).toEqual({
      collection: 'locations',
      id: 'loc_1',
      fields: { 'geo.seeds': mapped.canon.locations.loc_1.geo.seeds },
    });
    expect(plan.writes.some((w) => w.id.startsWith('poi_'))).toBe(false);
    expect(plan.worldFields).toEqual({ 'map.distance': { unit: 'mi', perMapUnit: 2 } });
  });

  test('seeded settlements and a map that has its scale are left alone', () => {
    const { entities } = oldNisia();
    entities.locations.loc_1.geo.seeds = { type: 'Generic' };
    const meta = { map: { distance: { unit: 'km', perMapUnit: 3 } } };
    const plan = planSeedBackfill({ meta, entities, mapped });
    expect(plan.summary).toMatchObject({ toSeed: 662, alreadySeeded: 1, distance: null });
    expect(plan.worldFields).toEqual({});
  });

  test('a settlement the export doesn’t know is counted, not guessed', () => {
    const { meta, entities } = oldNisia();
    entities.locations.loc_9999 = { id: 'loc_9999', geo: { kind: 'settlement' } };
    expect(planSeedBackfill({ meta, entities, mapped }).summary.unknown).toBe(1);
  });
});

describe('applying seeds and stamps together', () => {
  const adminApp = initializeApp({ projectId: 'demo-cartographer-seeds' }, 'seeds-test');
  const db = getFirestore(adminApp);
  const worldRef = db.collection('loom_worlds').doc('nisia-000002');

  beforeAll(async () => {
    await db.recursiveDelete(db.collection('loom_worlds'));
    await worldRef.set({
      id: 'nisia-000002',
      status: 'published',
      canonVersion: 7,
      map: { width: 1718, height: 1270, imagePath: 'worlds/nisia-000002/map.png' },
    });
    const { geo, ...rest } = mapped.canon.locations.loc_1;
    const { seeds, ...oldGeo } = geo;
    expect(seeds).toBeDefined();
    await worldRef
      .collection('locations')
      .doc('loc_1')
      .set({ ...rest, geo: oldGeo });
  });

  afterAll(async () => {
    await db.recursiveDelete(db.collection('loom_worlds'));
    await db.terminate();
  });

  test('one pass writes both, keeps what was there, and bumps canonVersion once', async () => {
    const place = (await worldRef.collection('locations').doc('loc_1').get()).data();
    const entities = { locations: { loc_1: place } };
    const meta = (await worldRef.get()).data();
    const seeds = planSeedBackfill({ meta, entities, mapped });
    const stamps = planSourceBackfill({ entities, mapped });
    const result = await applyBackfill(db, 'nisia-000002', {
      writes: [...sourceWrites(stamps), ...seeds.writes],
      worldFields: seeds.worldFields,
    });
    expect(result).toEqual({ written: 2, canonVersion: 8 });

    const after = (await worldRef.collection('locations').doc('loc_1').get()).data();
    expect(after.geo).toMatchObject({
      kind: 'settlement',
      population: 28473,
      seeds: mapped.canon.locations.loc_1.geo.seeds,
    });
    expect(after.sources).toEqual({ description: 'import' });
    expect((await worldRef.get()).data().map).toEqual({
      width: 1718,
      height: 1270,
      imagePath: 'worlds/nisia-000002/map.png',
      distance: { unit: 'mi', perMapUnit: 2 },
    });
  });
});
