'use strict';

/**
 * What loomGetMap sends the painter (planning/maps-from-data.md §4.6; L-924 /
 * #728), with Gemini never called, in the Andor world (./fixtures/andor-
 * world.js), each of its kinds of map given geometry:
 *
 *   - on the deck (a grid): its geometry as far as seen, lines and lights
 *     among it; objects' art and the world's own kinds' art as links only
 *     (never the library's records, A5); and the fog's outline of what's in
 *     sight, to the sight lines;
 *   - in the station (an area map): its geometry whole, and its space;
 *   - on Vega (a region map): its geometry whole, and its space;
 *   - hidden things are never sent.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-paint-view --verbose"
 */

const PROJECT = 'demo-loom-paint-view';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const mockWorld = (() => {
  const geo = require('../functions/loom-canon/map-geometry');
  const w = require('./fixtures/andor-world').andorWorld('andor-paint');
  const art = (id) => ({
    imageId: id,
    link: `https://images.example/${id}`,
    width: 64,
    height: 64,
  });
  w.objectKinds = { chest: { art: art('img-chest'), size: [3, 2] } };
  // The deck, 60 × 40 ft: a bulkhead at x = 30 with a 5 ft gap, a lamp, a
  // pipe along the floor, a crate with its own art, and a hidden hatch.
  w.maps.deck = {
    ...w.maps.deck,
    geometry: geo.normalize({
      ground: [{ id: 'plates', material: 'metal', shape: { rect: { x: 0, y: 0, w: 60, h: 40 } } }],
      walls: [
        {
          id: 'north',
          material: 'metal',
          points: [
            [30, 0],
            [30, 17.5],
          ],
        },
        {
          id: 'south',
          material: 'metal',
          points: [
            [30, 22.5],
            [30, 40],
          ],
        },
      ],
      lines: [
        {
          id: 'pipe',
          material: 'canal',
          points: [
            [2, 38],
            [28, 38],
          ],
        },
      ],
      objects: [
        { id: 'crate', kind: 'crate', at: [10, 10], size: [3, 3], art: art('img-crate') },
        { id: 'hatch', kind: 'trapdoor', at: [20, 30], size: [3, 3] },
      ],
      lights: [{ id: 'lamp', at: [12, 20], radius: 10 }],
      hidden: ['hatch'],
    }),
  };
  // The station and Vega: a little of each, drawn whole.
  w.maps.station = {
    ...w.maps.station,
    geometry: geo.normalize({
      ground: [
        { id: 'deck', material: 'metal', shape: { rect: { x: 100, y: 100, w: 800, h: 800 } } },
      ],
      walls: [
        {
          id: 'hull',
          material: 'metal',
          points: [
            [100, 100],
            [900, 100],
          ],
        },
      ],
      objects: [{ id: 'secret', kind: 'chest', at: [500, 500], size: [10, 10] }],
      hidden: [{ id: 'secret' }],
    }),
  };
  w.maps.vega = {
    ...w.maps.vega,
    geometry: geo.normalize({
      ground: [
        { id: 'belt', material: 'rock', shape: { circle: { x: 50, y: 50, r: 30 } } },
        { id: 'void', material: 'ocean', shape: { rect: { x: 0, y: 0, w: 100, h: 10 } } },
      ],
    }),
  };
  return w;
})();

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === mockWorld.id ? mockWorld : real.loadWorld(worldId, options),
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async () => {
    throw new Error('The model is never called here.');
  },
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const frames = require('../functions/loom-canon/frames');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const WORLD = mockWorld.id;
const PLAYER = { uid: 'player-paint', token: { apps: ['loom'] } };
const down = [
  { mapId: 'sector', placeId: 'pl_vega' },
  { mapId: 'vega', placeId: 'pl_station' },
];

async function standing(saveId, at) {
  const { fields } = frames.legacyOf(frames.playWorld(mockWorld), at);
  const save = makeSave({
    ownerUid: PLAYER.uid,
    worldId: WORLD,
    name: 'Andor',
    character: { name: 'Ash', sheet: sheets.defaultSheet(BUILT_IN['d20-fantasy']) },
    at,
    discovered: ['pl_rigel', 'pl_vega', 'pl_station', 'pl_dock', 'pl_vega_gate', 'pl_airlock'],
    visited: [],
    waysKnown: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db
    .collection('loom_saves')
    .doc(saveId)
    .set({ ...save, ...fields, turn: { n: 1, ap: 20, kept: 0, plan: null } });
}
const mapOf = (saveId) => loomGetMap.run({ data: { worldId: WORLD, saveId }, auth: PLAYER });

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

describe('what the painter is sent', () => {
  test('on the deck: what is seen of it, lines and lights, art as links, the sight outline', async () => {
    await standing('deck', [
      ...down,
      { mapId: 'station', placeId: 'pl_dock' },
      { mapId: 'deck', cell: { x: 2, y: 4 } },
    ]);
    const { battleMap } = await mapOf('deck');
    const g = battleMap.geometry;
    expect(g.lines.map((l) => l.id)).toEqual(['pipe']);
    expect(g.lights.map((l) => l.id)).toEqual(['lamp']);
    // The crate's own art: its link alone, never the library's record (A5).
    expect(g.objects.find((o) => o.id === 'crate').art).toEqual({
      link: 'https://images.example/img-crate',
    });
    // The hidden hatch isn't sent.
    expect(g.objects.map((o) => o.id)).not.toContain('hatch');
    // The world's own art for chests, as a link.
    expect(battleMap.objectKinds).toEqual({
      chest: { art: { link: 'https://images.example/img-chest' }, size: [3, 2] },
    });
    // What's in sight, as an outline round the player's eyes: the near side
    // of the bulkhead, and a cone through its gap.
    const view = battleMap.fog.view;
    expect(view.length % 2).toBe(0);
    const xs = view.filter((v, i) => i % 2 === 0);
    expect(Math.max(...xs)).toBe(60); // through the gap, to the far wall
    expect(xs.filter((x) => x === 30).length).toBeGreaterThan(1); // the bulkhead's face
  });

  test('in the station: its area map drawn whole, with its space; hidden things left out', async () => {
    await standing('station', [...down, { mapId: 'station', point: { x: 500, y: 900 } }]);
    const { town } = await mapOf('station');
    expect(town.space).toEqual({ width: 1000, height: 1000 });
    expect(town.geometry.ground.map((g) => g.id)).toEqual(['deck']);
    expect(town.geometry.walls.map((w) => w.id)).toEqual(['hull']);
    expect(town.geometry.objects).toBeUndefined();
    expect(town.geometry.hidden).toBeUndefined();
  });

  test('on Vega: its region map drawn whole, with its space', async () => {
    await standing('vega', [down[0], { mapId: 'vega', placeId: 'pl_vega_gate' }]);
    const view = await mapOf('vega');
    expect(view.mapId).toBe('vega');
    expect(view.map.space).toEqual({ width: 100, height: 100 });
    expect(view.map.geometry.ground.map((g) => g.id)).toEqual(['belt', 'void']);
  });
});
