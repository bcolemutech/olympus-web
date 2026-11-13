'use strict';

/**
 * Realm borders on a region map (planning/worlds-without-azgaar.md §4.4, R8;
 * L-714 / #819), with Gemini never called:
 *
 *   - the outlines (functions/loom-canon/realm-borders.js, pure): a realm's
 *     land is its regions' zones together, so the border between two of its
 *     own regions isn't an edge, while the border between two realms is an
 *     edge of each; a hole is an edge; overlapping zones merge; the name's
 *     centre is always inside the land, even for an L or a ring; a realm with
 *     no colour gets the same one every time;
 *   - loomGetMap sends the realms for a region map with no image, and none
 *     for one with an image.
 *
 * Its drawing is in loom-realm-borders-draw.test.js.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-realm-borders --verbose"
 */

const PROJECT = 'demo-loom-realm-borders';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const geo = require('../functions/loom-canon/map-geometry');
const realms = require('../functions/loom-canon/realms');
const { bordersOn } = require('../functions/loom-canon/realm-borders');

const rect = (x, y, w, h) => ({ rect: { x, y, w, h } });

// A world map 1000 × 1000 (a region map), its zones as given.
function worldOf(zones, extra = {}) {
  return {
    id: 'w',
    maps: {
      map_world: {
        kind: 'region',
        parent: null,
        name: 'The world',
        space: { width: 1000, height: 1000 },
        geometry: geo.normalize({ zones }),
      },
    },
    regions: {
      reg_nw: { id: 'reg_nw', name: 'North Crown', factionId: 'fac_crown' },
      reg_sw: { id: 'reg_sw', name: 'South Crown', factionId: 'fac_crown' },
      reg_e: { id: 'reg_e', name: 'Eastholm', factionId: 'fac_free' },
      reg_lone: { id: 'reg_lone', name: 'Nowhere', factionId: 'fac_gone' },
      reg_free: { id: 'reg_free', name: 'Unclaimed' },
    },
    factions: {
      fac_crown: { id: 'fac_crown', name: 'The Crown', politics: { color: '#AA3311' } },
      fac_free: { id: 'fac_free', name: 'The Free Cities' },
      fac_gone: { id: 'fac_gone', name: 'The Gone', retired: true },
    },
    ...extra,
  };
}

// Whether a flat outline has a straight run between two points.
const has = (flat, a, b) => {
  for (let i = 0; i + 3 < flat.length; i += 2) {
    const [x0, y0, x1, y1] = flat.slice(i, i + 4);
    if (
      (x0 === a[0] && y0 === a[1] && x1 === b[0] && y1 === b[1]) ||
      (x0 === b[0] && y0 === b[1] && x1 === a[0] && y1 === a[1])
    ) {
      return true;
    }
  }
  return false;
};
// Every straight run of a list of outlines, as "x,y>x,y" with the lower end first.
const runs = (outlines) =>
  outlines
    .flatMap((flat) => {
      const out = [];
      for (let i = 0; i + 3 < flat.length; i += 2) {
        const a = [flat[i], flat[i + 1]];
        const b = [flat[i + 2], flat[i + 3]];
        out.push(
          [a, b]
            .sort((p, q) => p[0] - q[0] || p[1] - q[1])
            .map((p) => p.join(','))
            .join('>')
        );
      }
      return out;
    })
    .sort();
const closed = (flat) => flat[0] === flat[flat.length - 2] && flat[1] === flat[flat.length - 1];

describe('a realm’s outline', () => {
  // The Crown holds the west in two regions that share an edge along y = 500;
  // Eastholm, of the Free Cities, holds the east, sharing x = 500 with it.
  const world = worldOf([
    { id: 'nw', region: 'reg_nw', shape: rect(0, 0, 500, 500) },
    { id: 'sw', region: 'reg_sw', shape: rect(0, 500, 500, 500) },
    { id: 'e', region: 'reg_e', shape: rect(500, 0, 500, 1000) },
  ]);

  test('its own regions’ border is no edge; the border with another realm is', () => {
    const [crown, free] = bordersOn(world, 'map_world');
    expect([crown.id, free.id]).toEqual(['fac_crown', 'fac_free']);
    // The west's edge: all but the run between its two regions, which is
    // two runs end to end (one a region), the border with Eastholm among them.
    expect(runs(crown.outlines)).toEqual([
      '0,0>0,500',
      '0,0>500,0',
      '0,1000>500,1000',
      '0,500>0,1000',
      '500,0>500,500',
      '500,500>500,1000',
    ]);
    // Eastholm has its own edge along the same line, all the way round.
    expect(free.outlines).toHaveLength(1);
    expect(closed(free.outlines[0])).toBe(true);
    expect(has(free.outlines[0], [500, 0], [500, 1000])).toBe(true);
  });

  test('the land is the zones to fill; the name is in the middle of it', () => {
    const [crown, free] = bordersOn(world, 'map_world');
    expect(crown.land.map((l) => l.outer)).toEqual([
      [0, 0, 500, 0, 500, 500, 0, 500],
      [0, 500, 500, 500, 500, 1000, 0, 1000],
    ]);
    expect(crown.land.every((l) => l.holes.length === 0)).toBe(true);
    expect(crown.centre).toEqual({ x: 250, y: 500 });
    expect(free.centre).toEqual({ x: 750, y: 500 });
  });

  test('a realm’s name and colour; one with none has the same colour every time', () => {
    const [crown, free] = bordersOn(world, 'map_world');
    expect(crown.name).toBe('The Crown');
    expect(crown.colour).toBe('#aa3311');
    expect(free.colour).toBe(realms.colourOf(world.factions.fac_free));
    expect(realms.PALETTE).toContain(free.colour);
    // Every load: the same, and the same for a copy of the world.
    expect(bordersOn(world, 'map_world')[1].colour).toBe(free.colour);
    expect(bordersOn(JSON.parse(JSON.stringify(world)), 'map_world')[1].colour).toBe(free.colour);
  });

  test('regions with no realm, a retired realm, or no region leave nothing', () => {
    const w = worldOf([
      { id: 'a', region: 'reg_free', shape: rect(0, 0, 100, 100) },
      { id: 'b', region: 'reg_lone', shape: rect(200, 0, 100, 100) },
      { id: 'c', region: 'reg_missing', shape: rect(400, 0, 100, 100) },
      { id: 'd', name: 'The Fens', shape: rect(600, 0, 100, 100) },
    ]);
    expect(bordersOn(w, 'map_world')).toEqual([]);
  });

  test('a map that isn’t a region map, or is missing, has none', () => {
    const w = worldOf([{ id: 'a', region: 'reg_e', shape: rect(0, 0, 100, 100) }]);
    w.maps.map_area = { ...w.maps.map_world, kind: 'area' };
    expect(bordersOn(w, 'map_area')).toEqual([]);
    expect(bordersOn(w, 'nope')).toEqual([]);
  });
});

describe('zones that overlap, hold holes and bend', () => {
  test('two zones of a realm lying over each other make one outline', () => {
    const w = worldOf([
      { id: 'a', region: 'reg_nw', shape: rect(0, 0, 400, 400) },
      { id: 'b', region: 'reg_sw', shape: rect(200, 200, 400, 400) },
    ]);
    const [crown] = bordersOn(w, 'map_world');
    // Only the edge of the two together: where one lies over the other, its
    // edge is inside the land and goes.
    expect(runs(crown.outlines)).toEqual([
      '0,0>0,400',
      '0,0>400,0',
      '0,400>200,400',
      '200,400>200,600',
      '200,600>600,600',
      '400,0>400,200',
      '400,200>600,200',
      '600,200>600,600',
    ]);
  });

  test('a zone with a hole has an edge round the hole, and the land cuts it out', () => {
    const w = worldOf([
      {
        id: 'ring',
        region: 'reg_e',
        shape: 'M0 0 H1000 V1000 H0 Z M300 300 H700 V700 H300 Z',
      },
    ]);
    const [free] = bordersOn(w, 'map_world');
    expect(free.outlines).toHaveLength(2);
    expect(free.land).toHaveLength(1);
    expect(free.land[0].holes).toEqual([[300, 300, 700, 300, 700, 700, 300, 700]]);
    // The middle of a ring is a hole: the name goes on the land, not in it.
    const { x, y } = free.centre;
    const inHole = x > 300 && x < 700 && y > 300 && y < 700;
    expect(inHole).toBe(false);
    expect(geo.pointInShape([x, y], w.maps.map_world.geometry.zones[0].shape)).toBe(true);
  });

  test('the name of an L-shaped realm is inside it', () => {
    const w = worldOf([{ id: 'l', region: 'reg_e', shape: 'M0 0 H100 V900 H900 V1000 H0 Z' }]);
    const [free] = bordersOn(w, 'map_world');
    expect(
      geo.pointInShape([free.centre.x, free.centre.y], w.maps.map_world.geometry.zones[0].shape)
    ).toBe(true);
  });

  test('a realm in two parts is named in the bigger', () => {
    const w = worldOf([
      { id: 'small', region: 'reg_e', shape: rect(0, 0, 200, 200) },
      { id: 'big', region: 'reg_e', shape: rect(780, 780, 220, 220) },
    ]);
    const [free] = bordersOn(w, 'map_world');
    expect(free.outlines).toHaveLength(2);
    // The centre of the two together falls between them, in neither.
    expect(free.centre).toEqual({ x: 890, y: 890 });
  });
});

// ── loomGetMap ──────────────────────────────────────────────────────────

const mockWorld = (() => {
  const w = require('./fixtures/andor-world').andorWorld('andor-realms');
  // Vega, 100 × 100: the Guild holds the west in two regions that share an
  // edge, the Ring the east.
  w.maps.vega = {
    ...w.maps.vega,
    geometry: geo.normalize({
      ground: [{ id: 'belt', material: 'rock', shape: { circle: { x: 50, y: 50, r: 30 } } }],
      zones: [
        { id: 'z_north', region: 'reg_north', shape: rect(0, 0, 50, 50) },
        { id: 'z_south', region: 'reg_south', shape: rect(0, 50, 50, 50) },
        { id: 'z_east', region: 'reg_east', shape: rect(50, 0, 50, 100) },
      ],
    }),
  };
  w.regions = {
    reg_north: { id: 'reg_north', name: 'High Vega', factionId: 'fac_guild' },
    reg_south: { id: 'reg_south', name: 'Low Vega', factionId: 'fac_guild' },
    reg_east: { id: 'reg_east', name: 'The Rim', factionId: 'fac_ring' },
  };
  w.factions = {
    fac_guild: { id: 'fac_guild', name: 'The Guild', politics: { color: '#3366CC' } },
    fac_ring: { id: 'fac_ring', name: 'The Ring' },
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
const PLAYER = { uid: 'player-realms', token: { apps: ['loom'] } };
const AT = [
  { mapId: 'sector', placeId: 'pl_vega' },
  { mapId: 'vega', placeId: 'pl_vega_gate' },
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

describe('what the world map is sent', () => {
  afterEach(() => {
    delete mockWorld.maps.vega.image;
  });

  test('a region map with no image: each realm’s edge, name, colour and land', async () => {
    await standing('plain', AT);
    const view = await mapOf('plain');
    expect(view.map.image).toBeNull();
    const sent = view.map.realms;
    expect(sent.map((r) => [r.id, r.name, r.colour])).toEqual([
      ['fac_guild', 'The Guild', '#3366cc'],
      ['fac_ring', 'The Ring', realms.colourOf(mockWorld.factions.fac_ring)],
    ]);
    const guild = sent[0];
    expect(runs(guild.outlines)).toEqual([
      '0,0>0,50',
      '0,0>50,0',
      '0,100>50,100',
      '0,50>0,100',
      '50,0>50,50',
      '50,50>50,100',
    ]);
    expect(guild.centre).toEqual({ x: 25, y: 50 });
    // The same on the next turn: nothing is chosen at random.
    expect((await mapOf('plain')).map.realms).toEqual(sent);
  });

  test('a region map with an image: none', async () => {
    mockWorld.maps.vega.image = {
      imageId: 'img-vega',
      link: 'https://images.example/img-vega',
      width: 64,
      height: 64,
    };
    await standing('pictured', AT);
    const view = await mapOf('pictured');
    expect(view.map.image).not.toBeNull();
    expect(view.map.realms).toBeUndefined();
  });

  test('a map whose regions have no live realm sends none', async () => {
    Object.values(mockWorld.factions).forEach((f) => (f.retired = true));
    try {
      await standing('landless', AT);
      expect((await mapOf('landless')).map.realms).toBeUndefined();
    } finally {
      Object.values(mockWorld.factions).forEach((f) => delete f.retired);
    }
  });
});
