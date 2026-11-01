'use strict';

/**
 * The map levels migration (planning/map-levels.md §4.4; L-902 / #720),
 * against the Firestore emulator:
 *
 *   - a fixture world (locations, a town with ground, battle maps: one
 *     generic, one with an exit onto another map) migrates to the expected
 *     maps and places, and loads with its tree;
 *   - a world made from scratch (a backdrop, no image) migrates, and a way
 *     in set aside for a destination still serves only it;
 *   - a wary group with a trigger on a door still turns hostile when that
 *     door is forced;
 *   - a dry run writes nothing; running it twice changes nothing;
 *   - a replay: the same actions, with the same dice, give the same
 *     outcomes, lines and changes before and after.
 *
 * Saves are not migrated (decided 2026-11-01: none were left).
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-levels-migrate --verbose"
 */

const PROJECT = 'demo-loom-levels-migrate';
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
const town = require('../functions/loom-canon/town');
const migrate = require('../functions/cartographer/migrate-levels');
const wary = require('../functions/loom-modules/combat/wary');
const figures = require('../functions/loom-modules/combat/figures');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { makeSave } = require('../functions/loom-models');

const app = initializeApp({ projectId: PROJECT }, 'levels-migrate');
const db = getFirestore(app);
const WORLD = 'march-test';
const SCRATCH = 'scratch-test';
const W = { description: 'mcp' };
const text = (name) => name + ' is written up for the test, with enough to be read as built.';

const rect = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

// Each document with its own id, as the Cartographer writes them.
async function write(worldId, meta, collections) {
  const ref = db.collection('loom_worlds').doc(worldId);
  await ref.set({ name: worldId, status: 'published', canonVersion: 1, ...meta });
  for (const [name, docs] of Object.entries(collections)) {
    for (const [id, data] of Object.entries(docs)) {
      await ref
        .collection(name)
        .doc(id)
        .set({ id, ...data });
    }
  }
}

// The fixture world: Ashford (a settlement with a town on ground: a gate on
// a generic gate map, an inn) and the ruin (a point of interest on its own
// map, a locked cellar door guarded by a wary pair, and a stair down to the
// cellar, another map).
const FIXTURE = {
  meta: {
    name: 'The March',
    map: { width: 1000, height: 800, distance: { unit: 'mi', perMapUnit: 2 } },
    rules: { startingLocationId: 'loc_ash' },
  },
  collections: {
    locations: {
      loc_ash: {
        name: 'Ashford',
        description: text('Ashford'),
        sources: W,
        population: 1200,
        geo: { kind: 'settlement', x: 100, y: 100, links: { loc_ruin: 'road' } },
        connections: ['loc_ruin'],
        town: {
          size: 400,
          ground: { buildings: [{ name: 'the mill', points: rect(300, 300, 100, 100) }] },
        },
      },
      loc_ruin: {
        name: 'The ruin',
        description: text('The ruin'),
        sources: W,
        geo: { kind: 'poi', x: 220, y: 160, links: { loc_ash: 'road' } },
        connections: ['loc_ash'],
        battleMap: { mapId: 'bm_ruin' },
      },
    },
    places: {
      pl_gate: {
        locationId: 'loc_ash',
        name: 'The gate',
        kind: 'gate',
        description: text('The gate'),
        sources: W,
        entrance: { via: ['road'] },
        position: { x: 100, y: 500 },
        connections: ['pl_inn'],
        battleMap: { mapId: 'bm_gate' },
      },
      pl_inn: {
        locationId: 'loc_ash',
        name: 'The inn',
        kind: 'tavern',
        description: text('The inn'),
        sources: W,
        position: { x: 700, y: 500 },
        connections: ['pl_gate'],
        battleMap: { mapId: 'bm_gate' },
      },
    },
    battleMaps: {
      bm_gate: {
        name: 'A town gate',
        width: 8,
        height: 6,
        generic: { kind: 'gate', terrain: 'town' },
        entries: [{ id: 'in', x: 1, y: 3 }],
        exits: [{ id: 'out', name: 'the road', x: 0, y: 3, to: 'out' }],
        features: [],
      },
      bm_ruin: {
        name: 'The ruin',
        width: 10,
        height: 8,
        sources: W,
        entries: [{ id: 'in', x: 1, y: 4 }],
        exits: [
          { id: 'out', name: 'the track', x: 0, y: 4, to: 'out' },
          { id: 'stair', name: 'the stair', x: 8, y: 6, to: { map: 'bm_cellar', entry: 'top' } },
        ],
        features: [{ id: 'altar', name: 'the altar', x: 5, y: 2 }],
        walls: [
          {
            points: [
              { x: 6, y: 0 },
              { x: 6, y: 3 },
            ],
          },
        ],
        doors: [
          {
            id: 'cellar',
            name: 'the cellar door',
            from: { x: 6, y: 3 },
            to: { x: 6, y: 4 },
            locked: true,
          },
        ],
        figures: [
          {
            id: 'guards',
            name: 'Guard',
            side: 'wary',
            challenge: { says: 'Halt!', check: { skill: 'Persuasion' } },
            triggers: [{ on: 'doorForced', target: 'cellar', then: 'hostile' }],
            cells: [
              { x: 7, y: 2 },
              { x: 7, y: 5 },
            ],
          },
        ],
      },
      bm_cellar: {
        name: 'The cellar',
        width: 6,
        height: 6,
        entries: [{ id: 'top', name: 'the stair foot', x: 0, y: 0 }],
        exits: [],
        features: [],
      },
    },
  },
};

// A world from scratch (L-391): a backdrop, no image; the east gate serves
// the road to the ruin only.
const SCRATCH_WORLD = {
  meta: {
    name: 'Scratch',
    source: { kind: 'scratch' },
    map: { width: 400, height: 300, backdrop: '#223322' },
  },
  collections: {
    locations: {
      loc_town: {
        name: 'Holt',
        geo: { kind: 'settlement', x: 50, y: 50, links: { loc_ruin: 'road', loc_farm: 'road' } },
        connections: ['loc_ruin', 'loc_farm'],
      },
      loc_ruin: {
        name: 'The ruin',
        geo: { kind: 'poi', x: 150, y: 60, links: { loc_town: 'road' } },
      },
      loc_farm: {
        name: 'The farm',
        geo: { kind: 'poi', x: 20, y: 200, links: { loc_town: 'road' } },
      },
    },
    places: {
      east: {
        locationId: 'loc_town',
        name: 'The east gate',
        kind: 'gate',
        entrance: { via: ['road'], to: ['loc_ruin'] },
        position: { x: 900, y: 500 },
        connections: ['west'],
        description: text('The east gate'),
        sources: W,
        battleMap: { mapId: 'bm_gate' },
      },
      west: {
        locationId: 'loc_town',
        name: 'The west gate',
        kind: 'gate',
        entrance: { via: ['road'] },
        position: { x: 100, y: 500 },
        connections: ['east'],
        description: text('The west gate'),
        sources: W,
        battleMap: { mapId: 'bm_gate' },
      },
    },
    battleMaps: {
      bm_gate: {
        name: 'A gate',
        width: 6,
        height: 6,
        generic: { kind: 'gate', terrain: 'town' },
        entries: [{ id: 'in', x: 1, y: 3 }],
        exits: [{ id: 'out', name: 'the road', x: 0, y: 3, to: 'out' }],
        features: [],
      },
    },
  },
};

const load = async (id) => {
  loomCanon.clearWorldCache();
  return loomCanon.loadWorld(id, { db });
};

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
  await write(WORLD, FIXTURE.meta, FIXTURE.collections);
  await write(SCRATCH, SCRATCH_WORLD.meta, SCRATCH_WORLD.collections);
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('loom_worlds'));
});

// The actions replayed, with the dice: each before and after must agree.
const REPLAY = [
  [
    'travel to the ruin',
    { location: 'loc_ash', placeId: 'pl_gate' },
    { verb: 'move', targets: ['loc_ruin'], params: {} },
  ],
  [
    'walk to the inn',
    { location: 'loc_ash', placeId: 'pl_gate' },
    { verb: 'move', targets: ['pl_inn'], params: {} },
  ],
  [
    'walk to an unknown place',
    { location: 'loc_ash', placeId: 'pl_gate' },
    { verb: 'move', targets: ['nowhere'], params: {} },
  ],
  [
    'step on the ruin',
    { location: 'loc_ruin', mapId: 'bm_ruin', cell: { x: 1, y: 4 } },
    { verb: 'move', targets: [], params: { cell: { x: 3, y: 4 } } },
  ],
  [
    'force the cellar door',
    { location: 'loc_ruin', mapId: 'bm_ruin', cell: { x: 6, y: 3 } },
    { verb: 'force', targets: ['door:cellar'], params: {} },
  ],
  [
    'take the stair',
    { location: 'loc_ruin', mapId: 'bm_ruin', cell: { x: 8, y: 6 } },
    { verb: 'move', targets: ['exit:stair'], params: { from: 'map' } },
  ],
];

function replay(world) {
  return REPLAY.map(([label, at, action]) => {
    const save = {
      ...makeSave({
        ownerUid: 'u',
        worldId: WORLD,
        name: 'Replay',
        character: { name: 'Tam' },
        location: at.location,
        placeId: at.placeId || null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      }),
      ...(at.mapId ? { mapId: at.mapId, cell: at.cell } : {}),
      time: 28800,
    };
    let n = 0;
    const dice = (sides) => ((n++ * 7) % sides) + 1;
    const r = evaluate(action, { worldClock: 0 }, save, dice, figures.withFigures(world, save));
    return { label, outcome: r.outcome, constraints: r.constraints, mutations: r.mutations };
  });
}

let before;
test('a dry run reports and writes nothing', async () => {
  before = replay(await load(WORLD));
  const [report] = await migrate.run(db, { worldIds: [WORLD] });
  expect(report).toMatchObject({
    worldId: WORLD,
    applied: false,
    counts: { maps: 5, regionMaps: 1, areaMaps: 1, gridMaps: 3, places: 4, townPlaces: 2 },
  });
  expect(report.changes).toEqual({ maps: 5, places: 4, townPlaces: 2, world: 1 });
  const ref = db.collection('loom_worlds').doc(WORLD);
  expect((await ref.collection('maps').get()).size).toBe(0);
  expect((await ref.get()).data().topMapId).toBeUndefined();
  expect((await ref.collection('places').doc('pl_gate').get()).data().mapId).toBeUndefined();
});

test('the fixture world migrates to the expected maps and places', async () => {
  const [report] = await migrate.run(db, { worldIds: [WORLD], apply: true });
  expect(report.applied).toBe(true);
  // The cellar is reached by the stair: no problems to report.
  expect(report.problems).toEqual([]);
  const world = await load(WORLD);
  expect(world.topMapId).toBe('map_world');
  expect(world.maps.map_world).toMatchObject({
    kind: 'region',
    parent: null,
    name: 'The March',
    space: { width: 1000, height: 800, distance: { unit: 'mi', perUnit: 2 } },
    routeKinds: ['road'],
  });
  // The town: an area map under Ashford, its ground and size carried over.
  expect(world.maps.map_town_loc_ash).toMatchObject({
    kind: 'area',
    parent: { mapId: 'map_world', placeId: 'loc_ash' },
    space: { width: 1000, height: 1000, size: 400 },
    ground: FIXTURE.collections.locations.loc_ash.town.ground,
  });
  // Locations: places on the top map, their ids, positions and links kept.
  expect(world.mapPlaces.loc_ash).toMatchObject({
    mapId: 'map_world',
    at: { x: 100, y: 100 },
    links: [{ placeId: 'loc_ruin', kind: 'road' }],
    opens: { mapId: 'map_town_loc_ash' },
  });
  expect(world.mapPlaces.loc_ruin.opens).toEqual({ mapId: 'bm_ruin' });
  // Town places: on the town's map, everything they had kept.
  expect(world.places.pl_gate).toMatchObject({
    locationId: 'loc_ash',
    mapId: 'map_town_loc_ash',
    at: { x: 100, y: 500 },
    opens: { mapId: 'bm_gate' },
    entrance: { via: ['road'] },
    connections: ['pl_inn'],
  });
  // Grids: the generic one shared with no parent; the ruin under its place,
  // its layers and figures carried over; the cellar under the stair.
  expect(world.maps.bm_gate).toMatchObject({
    kind: 'grid',
    parent: null,
    generic: { kind: 'gate', terrain: 'town' },
  });
  expect(world.maps.bm_ruin).toMatchObject({
    kind: 'grid',
    parent: { mapId: 'map_world', placeId: 'loc_ruin' },
    space: { width: 10, height: 8, squareSize: 1.5 },
    doors: FIXTURE.collections.battleMaps.bm_ruin.doors,
    figures: FIXTURE.collections.battleMaps.bm_ruin.figures,
  });
  expect(world.maps.bm_cellar.parent).toEqual({ mapId: 'bm_ruin', placeId: 'bm_ruin~exit~stair' });
  expect(world.mapPlaces['bm_ruin~exit~stair']).toMatchObject({
    mapId: 'bm_ruin',
    at: { x: 8, y: 6 },
    exits: [{ placeId: 'bm_cellar~entry~top', seconds: 0, name: 'the stair' }],
    opens: { mapId: 'bm_cellar' },
  });
  // The tree, and a path down to the cellar holds against canon.
  expect(levels.parentChain(world, 'bm_cellar')).toEqual(['map_world', 'bm_ruin', 'bm_cellar']);
  expect(levels.validateAt(world, levels.pathTo(world, 'bm_cellar~entry~top'))).toEqual([]);
  expect(world.tree.orphans.map((o) => o.mapId)).toEqual(['bm_gate']);
  // Today's readers see the town places only, as before.
  expect(Object.keys(world.places).sort()).toEqual(['pl_gate', 'pl_inn']);
});

test('running it twice changes nothing', async () => {
  const [again] = await migrate.run(db, { worldIds: [WORLD], apply: true });
  expect(again.changedIds).toEqual({ maps: [], places: [], townPlaces: [] });
  expect(again.changes).toEqual({ maps: 0, places: 0, townPlaces: 0, world: 0 });
  expect(again.applied).toBe(false);
});

test('the replay: the same actions give the same outcomes, lines and changes', async () => {
  const after = replay(await load(WORLD));
  expect(after).toEqual(before);
  // It played real turns: a move made, a door forced or refused, the stair taken.
  expect(before.map((r) => r.outcome)).toContain('success');
  expect(before.some((r) => r.outcome === 'blocked' || r.outcome === 'invalid_target')).toBe(true);
});

test('a wary group with a trigger on a door still turns when the door is forced', async () => {
  const world = await load(WORLD);
  const save = { location: 'loc_ruin', mapId: 'bm_ruin', cell: { x: 6, y: 3 }, figures: {} };
  const turned = wary.react(
    figures.withFigures(world, save),
    save,
    wary.doorEvents('cellar', 'locked', 'closed')
  );
  expect(turned.map((t) => [t.side, t.was])).toEqual([
    ['hostile', 'wary'],
    ['hostile', 'wary'],
  ]);
});

test('a world from scratch migrates, and a way in set aside still serves only its place', async () => {
  const arriving = (world) =>
    ['loc_ruin', 'loc_farm'].map((from) => town.arrivalPlace(world, 'loc_town', 'road', from).id);
  expect(arriving(await load(SCRATCH))).toEqual(['east', 'west']);
  const [report] = await migrate.run(db, { worldIds: [SCRATCH], apply: true });
  expect(report.applied).toBe(true);
  const world = await load(SCRATCH);
  expect(world.maps.map_world).toMatchObject({
    kind: 'region',
    space: { width: 400, height: 300 },
    backdrop: '#223322',
  });
  expect(world.maps.map_world.image).toBeUndefined();
  expect(world.places.east).toMatchObject({
    mapId: 'map_town_loc_town',
    entrance: { to: ['loc_ruin'] },
  });
  // From the ruin, still the east gate; from the farm, the west.
  expect(arriving(world)).toEqual(['east', 'west']);
});

test('Nisia, as imported, plans cleanly: every location placed, links kept', async () => {
  const fs = require('fs');
  const { parseAzgaarExport } = require('../functions/cartographer/parse');
  const { mapToCanon } = require('../functions/cartographer/map');
  const { loadDraftWorld } = require('../functions/cartographer/load');
  const parsed = parseAzgaarExport(
    fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
  );
  await loadDraftWorld({
    db,
    mapped: mapToCanon(parsed),
    source: parsed.source,
    uploadedBy: 'b',
    worldId: 'nisia-test',
  });
  const raw = await migrate.readRaw(db, 'nisia-test');
  const p = migrate.plan(raw);
  expect(p.problems).toEqual([]);
  expect(p.counts.places).toBe(Object.keys(raw.locations).length);
  // Every link kept, both ways, as on the world map.
  const links = Object.values(raw.locations).reduce(
    (n, l) => n + Object.keys((l.geo && l.geo.links) || {}).length,
    0
  );
  expect(Object.values(p.places).reduce((n, pl) => n + pl.links.length, 0)).toBe(links);
  expect(p.maps.map_world.space.distance).toEqual(
    expect.objectContaining({ unit: expect.any(String), perUnit: expect.any(Number) })
  );
  // A dry run of it writes nothing.
  const [report] = await migrate.run(db, { worldIds: ['nisia-test'] });
  expect(report.applied).toBe(false);
  expect((await db.collection('loom_worlds').doc('nisia-test').collection('maps').get()).size).toBe(
    0
  );
}, 60000);
