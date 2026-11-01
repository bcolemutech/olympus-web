'use strict';

/**
 * Map levels to any depth (planning/map-levels.md §4.1; L-901 / #719),
 * against the Firestore emulator: a world built in the new shape (its top
 * map, maps inside it three deep and places on them) loads through
 * loadWorld with its maps, places, top map and tree; a world from before
 * the model loads as before, with no top map and an empty tree; and a path
 * to a place in the loaded world holds against canon.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-levels-load --verbose"
 */

const PROJECT = 'demo-loom-levels-load';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const loomCanon = require('../functions/loom-canon');
const levels = require('../functions/loom-canon/levels');

const app = initializeApp({ projectId: PROJECT }, 'levels-load');
const db = getFirestore(app);
const WORLD = 'levels-world';
const OLD = 'levels-old-world';

async function write(worldId, meta, collections) {
  const ref = db.collection('loom_worlds').doc(worldId);
  await ref.set({ name: worldId, status: 'published', canonVersion: 1, ...meta });
  for (const [name, docs] of Object.entries(collections)) {
    for (const [id, data] of Object.entries(docs)) await ref.collection(name).doc(id).set(data);
  }
}

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  loomCanon.clearWorldCache();
  await write(
    WORLD,
    { topMapId: 'sector' },
    {
      maps: {
        sector: {
          kind: 'region',
          parent: null,
          name: 'Andor sector',
          space: { width: 100, height: 100, distance: { unit: 'ly', perUnit: 1 } },
        },
        vega: {
          kind: 'region',
          parent: { mapId: 'sector', placeId: 'pl_vega' },
          name: 'Vega',
          space: { width: 50, height: 50 },
        },
        station: {
          kind: 'area',
          parent: { mapId: 'vega', placeId: 'pl_station' },
          name: 'Vega station',
          space: { width: 1000, height: 1000, size: 300 },
        },
        deck: {
          kind: 'grid',
          parent: { mapId: 'station', placeId: 'pl_dock' },
          name: 'The deck',
          space: { width: 12, height: 8, squareSize: 1.5 },
        },
      },
      places: {
        pl_vega: { mapId: 'sector', name: 'Vega', at: { x: 40, y: 30 }, opens: { mapId: 'vega' } },
        pl_station: {
          mapId: 'vega',
          name: 'Vega station',
          at: { x: 10, y: 10 },
          opens: { mapId: 'station' },
        },
        pl_dock: {
          mapId: 'station',
          name: 'The dock',
          at: { x: 500, y: 200 },
          opens: { mapId: 'deck' },
        },
        pl_hatch: { mapId: 'deck', name: 'The hatch', at: { x: 2, y: 3 } },
      },
      locations: {},
    }
  );
  await write(OLD, {}, { locations: { loc_1: { name: 'Burdendal', connections: [] } } });
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
});

test('a world in the new shape loads with its maps, places, top map and tree', async () => {
  const world = await loomCanon.loadWorld(WORLD, { db });
  expect(world.topMapId).toBe('sector');
  expect(Object.keys(world.maps).sort()).toEqual(['deck', 'sector', 'station', 'vega']);
  expect(world.places.pl_hatch).toMatchObject({ mapId: 'deck', name: 'The hatch' });
  expect(world.tree.orphans).toEqual([]);
  expect(world.tree.top).toEqual({
    mapId: 'sector',
    kind: 'region',
    name: 'Andor sector',
    children: [
      {
        mapId: 'vega',
        kind: 'region',
        name: 'Vega',
        children: [
          {
            mapId: 'station',
            kind: 'area',
            name: 'Vega station',
            children: [{ mapId: 'deck', kind: 'grid', name: 'The deck', children: [] }],
          },
        ],
      },
    ],
  });
  // A path to the hatch holds against the loaded canon.
  const at = levels.pathTo(world, 'pl_hatch');
  expect(at.map((s) => s.mapId)).toEqual(['sector', 'vega', 'station', 'deck']);
  expect(levels.validateAt(world, at)).toEqual([]);
  expect(levels.parentChain(world, 'deck')).toEqual(['sector', 'vega', 'station', 'deck']);
});

test('a world from before the model loads as before, with no top map', async () => {
  const world = await loomCanon.loadWorld(OLD, { db });
  expect(world.topMapId).toBeNull();
  expect(world.maps).toEqual({});
  expect(world.tree).toEqual({ top: null, orphans: [] });
  expect(world.locations.loc_1.name).toBe('Burdendal');
});
