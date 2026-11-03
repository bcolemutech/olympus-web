'use strict';

/**
 * A map's geometry stored and loaded (planning/maps-from-data.md §4.1, GE5;
 * L-921 / #725), against the Firestore emulator: a grid's geometry, in its
 * battle map beside its layers, and a region map's, on its map doc, save in
 * their stored form (no arrays of arrays) and load through loadWorld, read
 * through the frame; a template's geometry reaches each place's instance.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-map-geometry-load --verbose"
 */

const PROJECT = 'demo-loom-map-geometry-load';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const loomCanon = require('../functions/loom-canon');
const frames = require('../functions/loom-canon/frames');
const geo = require('../functions/loom-canon/map-geometry');

const app = initializeApp({ projectId: PROJECT }, 'map-geometry-load');
const db = getFirestore(app);
const WORLD = 'geometry-world';

// The crypt: a room cut by a wall at 45°, its door, a pillar, a chest.
const crypt = {
  ground: [
    {
      id: 'floor',
      material: 'flagstone',
      shape: [
        [0, 0],
        [40, 0],
        [40, 30],
        [0, 30],
      ],
    },
    { id: 'pool', material: 'water', depth: 2, cost: 2, shape: { circle: { x: 30, y: 22, r: 4 } } },
  ],
  walls: [
    {
      id: 'diagonal',
      material: 'stone',
      points: [
        [0, 30],
        [30, 0],
      ],
    },
  ],
  doors: [
    {
      id: 'crypt-door',
      material: 'iron',
      from: [12, 18],
      to: [18, 12],
      state: 'locked',
      unlocks: { key: 'the crypt key' },
    },
  ],
  objects: [{ id: 'chest', kind: 'chest', at: [35, 5], size: [4, 2], turn: 15 }],
  spawns: [
    {
      id: 'dead',
      name: 'The restless dead',
      shape: { rect: { x: 20, y: 20, w: 10, h: 8 } },
      count: 3,
    },
  ],
  hidden: [{ id: 'chest', dc: 14 }],
};

const coast = {
  ground: [{ id: 'sea', material: 'ocean', shape: 'M0 0 H100 V20 Q50 35 0 20 Z' }],
  lines: [
    {
      id: 'river',
      material: 'river',
      points: [
        [50, 100],
        [50, 40],
        [55, 28],
      ],
    },
  ],
};

const moon = {
  ground: [{ id: 'regolith', material: 'dirt', shape: { rect: { x: 0, y: 0, w: 40, h: 30 } } }],
  walls: [{ id: 'ridge', material: 'rock', points: 'M20 0 L20 30', height: 4 }],
};

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  loomCanon.clearWorldCache();
  const ref = db.collection('loom_worlds').doc(WORLD);
  await ref.set({ name: 'Geometry', status: 'published', canonVersion: 1, topMapId: 'realm' });
  const docs = {
    maps: {
      realm: {
        kind: 'region',
        parent: null,
        name: 'The realm',
        space: { width: 100, height: 100, distance: { unit: 'mile', perUnit: 1 } },
        geometry: geo.normalize(coast),
      },
      crypt: {
        kind: 'grid',
        parent: { mapId: 'realm', placeId: 'pl_crypt' },
        name: 'The crypt',
        space: { width: 8, height: 6, squareSize: 1.5 },
      },
      tpl_moon: {
        kind: 'grid',
        template: true,
        parent: null,
        name: 'The barrow of {place}',
        space: { width: 8, height: 6, squareSize: 1.5 },
      },
    },
    battleMaps: {
      crypt: {
        name: 'The crypt',
        width: 8,
        height: 6,
        walls: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 8, y: 0 },
            ],
          },
        ],
        geometry: geo.normalize(crypt),
      },
      tpl_moon: {
        name: 'The barrow of {place}',
        width: 8,
        height: 6,
        geometry: geo.normalize(moon),
      },
    },
    places: {
      pl_crypt: {
        mapId: 'realm',
        name: 'The crypt',
        at: { x: 50, y: 60 },
        opens: { mapId: 'crypt' },
      },
      pl_hill: {
        mapId: 'realm',
        name: 'Hob Hill',
        at: { x: 20, y: 70 },
        opens: { template: 'tpl_moon' },
      },
      pl_knoll: {
        mapId: 'realm',
        name: 'Ash Knoll',
        at: { x: 80, y: 70 },
        opens: { template: 'tpl_moon' },
      },
    },
  };
  for (const [name, byId] of Object.entries(docs)) {
    for (const [id, data] of Object.entries(byId)) await ref.collection(name).doc(id).set(data);
  }
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
});

describe('geometry saved and loaded (GE5)', () => {
  test('lists of points as given can’t be stored; the stored form can', async () => {
    await expect(
      db.collection('loom_worlds').doc('nested').set({ geometry: crypt })
    ).rejects.toThrow(/nested/i);
    expect(geo.check(geo.normalize(crypt), geo.boundsOf({ width: 8, height: 6 }))).toEqual([]);
  });

  test('a grid’s geometry loads in its battle map, beside its layers, through its frame', async () => {
    const world = await loomCanon.loadWorld(WORLD, { db });
    expect(world.battleMaps.crypt.walls).toHaveLength(1); // today's layers, kept
    const play = frames.playWorld(world);
    const stored = frames.geometryOf(play, 'crypt');
    expect(stored).toEqual(geo.normalize(crypt));
    expect(geo.check(stored, geo.boundsOf(world.battleMaps.crypt))).toEqual([]);
    const view = frames.viewFor(play, 'realm');
    expect(view.locations.pl_crypt.battleMap).toEqual({ mapId: 'crypt' });
    const c = geo.compile(view.battleMaps.crypt.geometry);
    // Through the locked door at (15, 15); round it the wall.
    expect(geo.hits(c, [5, 5], [25, 25], { move: true }).map((h) => h.id)).toEqual(['crypt-door']);
    expect(geo.hits(c, [0, 20], [10, 30], { move: true }).map((h) => h.id)).toEqual(['diagonal']);
    expect(geo.groundAt(c, [30, 22]).material).toBe('water');
  });

  test('a region map’s geometry loads on its map, and its frame carries it', async () => {
    const world = await loomCanon.loadWorld(WORLD, { db });
    const play = frames.playWorld(world);
    const view = frames.viewFor(play, 'realm');
    expect(view.map.geometry).toEqual(geo.normalize(coast));
    const c = geo.compile(view.map.geometry);
    expect(geo.groundAt(c, [50, 10]).id).toBe('sea');
    expect(geo.groundAt(c, [50, 60])).toBeNull();
  });

  test('each place using a template plays an instance with its geometry', async () => {
    const world = await loomCanon.loadWorld(WORLD, { db });
    const play = frames.playWorld(world);
    for (const id of ['tpl_moon__pl_hill', 'tpl_moon__pl_knoll']) {
      expect(frames.geometryOf(play, id)).toEqual(geo.normalize(moon));
    }
    const view = frames.viewFor(play, 'realm');
    expect(view.locations.pl_hill.battleMap).toEqual({ mapId: 'tpl_moon__pl_hill' });
    expect(view.battleMaps.tpl_moon__pl_hill.geometry.walls[0].id).toBe('ridge');
  });
});
