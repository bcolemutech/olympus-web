'use strict';

/**
 * Where descriptions came from (planning/the-loom-layered-worlds.md §4.3;
 * L-321 / #390): the backfill that stamps worlds imported before sources
 * existed, planned against the Nisia fixture and applied to the Firestore
 * emulator.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-sources --verbose"
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
const {
  SOURCES,
  importStamp,
  checkExportMatchesWorld,
  planSourceBackfill,
  applySourceBackfill,
} = require('../functions/cartographer/sources');

const parsed = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);
const mapped = mapToCanon(parsed);

// Nisia as it was stored before sources existed: the mapper's entities with
// no stamps, a couple of them since written over MCP, and one character.
function unstampedNisia() {
  const copy = (entities) => JSON.parse(JSON.stringify(entities));
  const entities = {
    locations: copy(mapped.canon.locations),
    factions: copy(mapped.canon.factions),
    characters: {
      chr_mara: { id: 'chr_mara', name: 'Mara Quill', description: 'Harbourmaster.' },
    },
  };
  entities.locations.loc_1.description = 'A rain-soaked port of slate roofs.';
  entities.locations.loc_631.description = 'Dunsmouth, where the river meets the sea.';
  entities.factions.fac_1.description = 'An old, proud kingdom.';
  return entities;
}

describe('planning the backfill', () => {
  test('text the mapper still produces is import; anything since written is mcp', () => {
    const plan = planSourceBackfill({ entities: unstampedNisia(), mapped });
    expect(plan.summary).toEqual({
      locations: { total: 719, import: 717, mcp: 2, alreadyStamped: 0, noDescription: 0 },
      factions: { total: 23, import: 22, mcp: 1, alreadyStamped: 0, noDescription: 0 },
      characters: { total: 1, import: 0, mcp: 1, alreadyStamped: 0, noDescription: 0 },
    });
    const written = plan.updates.filter((u) => u.source === SOURCES.MCP).map((u) => u.id);
    expect(written.sort()).toEqual(['chr_mara', 'fac_1', 'loc_1', 'loc_631']);
  });

  test('existing stamps are left alone, so it can run twice', () => {
    const entities = unstampedNisia();
    entities.locations.loc_1.sources = { description: 'gemini' };
    entities.locations.loc_2.sources = { description: 'import' };
    const plan = planSourceBackfill({ entities, mapped });
    expect(plan.summary.locations).toMatchObject({ alreadyStamped: 2, mcp: 1 });
    expect(plan.updates.map((u) => u.id)).not.toEqual(expect.arrayContaining(['loc_1', 'loc_2']));
  });

  test('without the export, every place and realm is import; characters stay mcp', () => {
    const plan = planSourceBackfill({ entities: unstampedNisia(), mapped: null });
    expect(plan.summary.locations).toMatchObject({ import: 719, mcp: 0 });
    expect(plan.summary.factions).toMatchObject({ import: 23, mcp: 0 });
    expect(plan.summary.characters).toMatchObject({ mcp: 1 });
  });

  test('a place the mapper doesn’t know stays closed, as import', () => {
    const entities = unstampedNisia();
    entities.locations.poi_9999 = { id: 'poi_9999', name: 'Odd', description: 'Hmm.' };
    const plan = planSourceBackfill({ entities, mapped });
    expect(plan.updates.find((u) => u.id === 'poi_9999').source).toBe('import');
  });

  test('refuses an export from a different map', () => {
    expect(() => checkExportMatchesWorld({ source: parsed.source }, parsed)).not.toThrow();
    expect(() =>
      checkExportMatchesWorld({ source: { ...parsed.source, seed: '1' } }, parsed)
    ).toThrow(/not the map this world was imported from/);
  });

  test('the loader stamps only entities that have a description', () => {
    expect(importStamp({ description: 'x' })).toEqual({ description: 'import' });
    expect(importStamp({ description: '' })).toEqual({ description: 'import' });
    expect(importStamp({ name: 'Region' })).toBeNull();
  });
});

describe('applying it', () => {
  const adminApp = initializeApp({ projectId: 'demo-cartographer-sources' }, 'sources-test');
  const db = getFirestore(adminApp);
  const worldRef = db.collection('loom_worlds').doc('nisia-000001');

  beforeAll(async () => {
    await db.recursiveDelete(db.collection('loom_worlds'));
    await worldRef.set({ id: 'nisia-000001', status: 'published', canonVersion: 5 });
    await worldRef.collection('locations').doc('loc_1').set({
      id: 'loc_1',
      name: 'Burdendal',
      description: 'A rain-soaked port.',
    });
    await worldRef
      .collection('locations')
      .doc('loc_2')
      .set({
        id: 'loc_2',
        name: 'Other',
        description: mapped.canon.locations.loc_2.description,
        geo: { kind: 'settlement' },
      });
  });

  afterAll(async () => {
    await db.recursiveDelete(db.collection('loom_worlds'));
    await db.terminate();
  });

  test('writes the stamps and bumps canonVersion once', async () => {
    const entities = {
      locations: {
        loc_1: (await worldRef.collection('locations').doc('loc_1').get()).data(),
        loc_2: (await worldRef.collection('locations').doc('loc_2').get()).data(),
      },
    };
    const plan = planSourceBackfill({ entities, mapped });
    expect(await applySourceBackfill(db, 'nisia-000001', plan)).toEqual({
      written: 2,
      canonVersion: 6,
    });
    const loc = async (id) => (await worldRef.collection('locations').doc(id).get()).data();
    expect((await loc('loc_1')).sources).toEqual({ description: 'mcp' });
    expect(await loc('loc_2')).toMatchObject({
      sources: { description: 'import' },
      geo: { kind: 'settlement' },
    });
    expect(await applySourceBackfill(db, 'nisia-000001', { updates: [] })).toEqual({
      written: 0,
      canonVersion: null,
    });
    expect((await worldRef.get()).data().canonVersion).toBe(6);
  });
});
