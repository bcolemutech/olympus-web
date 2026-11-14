'use strict';

/**
 * Playing an event (planning/off-road-travel.md §4.6, EV4, EV5, EV8; L-366 /
 * #840), played through loomPlayTurn and loomGetMap with Gemini stubbed, under
 * both built-in systems, on The Weald (./fixtures/wilds-world.js):
 *
 *   - a creatures event in a forest with no generic map is played on a
 *     generated forest map with its stat-block figures, and starts a fight;
 *   - with the world's generic forest map, that map is used (a copy kept on
 *     the save, the world's untouched);
 *   - leaving by an edge resumes the journey at the camp: go on from there;
 *   - the same event makes the same map again, after a reload and in another
 *     save with the same seed;
 *   - travellers stand there without a fight; an event only told isn't played.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-wild-event-maps-play --verbose"
 */

const PROJECT = 'demo-loom-wild-event-maps-play';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const crypto = require('crypto');
const { BUILT_IN: mockSystems } = require('../functions/loom-canon/systems');
const { wildsWorld: mockWildsWorld } = require('./fixtures/wilds-world');
const mockGeo = require('../functions/loom-canon/map-geometry');

const CLUB = {
  'd20-fantasy': {
    id: 'club',
    name: 'Club',
    reach: 1,
    attack: '1d20 + mod(STR) + 2',
    damage: '2d6 + mod(STR)',
    type: 'bludgeoning',
  },
  'pool-scifi': {
    id: 'pipe',
    name: 'Pipe',
    reach: 1,
    attack: 'count((Body + Melee)d10, >= 7)',
    damage: '3d3',
    type: 'kinetic',
  },
};
const FRAIL = {
  'd20-fantasy': { STR: 8, DEX: 8, CON: 3, INT: 8, WIS: 8, CHA: 8 },
  'pool-scifi': { Body: 1, Reflex: 1, Mind: 1, Presence: 1 },
};
const mockBlock = (systemId, name) => ({
  id: name.toLowerCase(),
  name,
  statBlock: {
    attributes: FRAIL[systemId],
    ...(systemId === 'pool-scifi' ? { skills: { Melee: 3 } } : {}),
    attacks: [CLUB[systemId]],
  },
});

// A small wood 12 × 12 squares, the world's generic map for forest: an entry
// beside its way out, and a den in the far corner for figures to stand in.
const mockWood = () => ({
  id: 'bm_wood',
  name: 'The old wood',
  width: 12,
  height: 12,
  entries: [{ id: 'in', x: 1, y: 6 }],
  exits: [{ id: 'out', name: 'the way out', x: 2, y: 6, to: 'out' }],
  features: [],
  generic: { kind: 'forest-clearing', terrain: 'forest' },
  geometry: mockGeo.normalize({
    spawns: [{ id: 'den', name: 'the den', shape: { rect: { x: 40, y: 40, w: 15, h: 15 } } }],
  }),
});

// The Weald with its region's danger 2 and a chance of 95% at every camp, the
// region's table `row`; `generic` gives it the world's own forest map.
function mapsWorld(id, systemId, row, generic) {
  const world = mockWildsWorld(id, { system: mockSystems[systemId] });
  world.rules = { ...world.rules, wilds: { navigation: null, eventChance: 0.95 } };
  world.regions.reg_wood.danger = 2;
  world.statBlocks = { wolf: mockBlock(systemId, 'Wolf'), pedlar: mockBlock(systemId, 'Pedlar') };
  world.regions.reg_wood.encounters = [row];
  if (generic) world.battleMaps = { bm_wood: mockWood() };
  return world;
}
const mockWorlds = {};
for (const id of ['d20-fantasy', 'pool-scifi']) {
  const variants = {
    gen: [{ what: 'wolf', count: 2, kind: 'creatures' }, false],
    own: [{ what: 'wolf', count: 2, kind: 'creatures' }, true],
    folk: [{ what: 'pedlar', kind: 'travellers' }, true],
    told: [{ what: 'wolf', count: 2, kind: 'creatures', narrated: true }, false],
  };
  for (const [name, [row, generic]] of Object.entries(variants)) {
    const world = mapsWorld(`maps-${name}-${id}`, id, row, generic);
    mockWorlds[world.id] = world;
  }
}

jest.mock('../functions/loom-canon', () => {
  const real = jest.requireActual('../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) => mockWorlds[worldId] || real.loadWorld(worldId, options),
  };
});
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    return { narration: 'You go on.', inventedEntities: [], suggestedActions: [] };
  },
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomPlayTurn, loomGetMap } = require('../functions/index');
const { makeSave } = require('../functions/loom-models');
const clock = require('../functions/loom-canon/clock');
const sheets = require('../functions/loom-canon/sheets');
const events = require('../functions/loom-modules/wilds/events');
const arrive = require('../functions/loom-modules/wilds/arrive');
const frames = require('../functions/loom-canon/frames');

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const db = getFirestore();

const PLAYER = { uid: 'player-event-maps', token: { apps: ['loom'] } };
const H = clock.HOUR;
const CAP = 0.95;
const ASHBY = [{ mapId: 'weald', placeId: 'pl_ashby' }];
const saveRef = (saveId) => db.collection('loom_saves').doc(saveId);
const saveOf = async (saveId) => (await saveRef(saveId).get()).data();
const lastTurn = async (saveId) =>
  (
    await saveRef(saveId).collection('loom_turns').orderBy('index', 'desc').limit(1).get()
  ).docs[0].data();

// The seed of the roll after leg `leg`, camping each night.
const seedOf = (saveId, leg) => `${saveId}:${leg}:${clock.START + (leg - 1) * 24 * H}`;
// A save id whose first leg's roll hits at 95%.
function hitting(prefix) {
  for (let n = 0; n < 500; n++) {
    const id = `${prefix}-${n}`;
    if (events.rollOf(seedOf(id, 1), CAP).happened) return id;
  }
  throw new Error('no such save id');
}

// The server's dice all roll high: the player is quick, and the wolves can't drop them.
beforeAll(() => {
  jest.spyOn(crypto, 'randomInt').mockImplementation((min, max) => Math.min(max - 1, min + 19));
});
afterAll(async () => {
  crypto.randomInt.mockRestore();
  await db.recursiveDelete(db.collection('loom_saves'));
  await db.recursiveDelete(db.collection('loom_world_state'));
  functionsTest.cleanup();
});

describe.each(['d20-fantasy', 'pool-scifi'])('playing an event under %s', (systemId) => {
  const system = mockSystems[systemId];
  const GEN = `maps-gen-${systemId}`;
  const OWN = `maps-own-${systemId}`;
  const FOLK = `maps-folk-${systemId}`;
  const TOLD = `maps-told-${systemId}`;

  async function seed(worldId, saveId, fields = {}) {
    await saveRef(saveId).set(
      makeSave({
        ownerUid: PLAYER.uid,
        worldId,
        name: 'Weald',
        character: { name: 'Ash', inventory: [], sheet: sheets.defaultSheet(system) },
        at: ASHBY,
        discovered: ['pl_ashby', 'pl_carrow', 'pl_dunsmouth'],
        visited: ['pl_ashby'],
        waysKnown: {},
        time: clock.START,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...fields,
      })
    );
  }
  async function play(worldId, saveId, data) {
    const answer = await loomPlayTurn.run({ data: { worldId, saveId, ...data }, auth: PLAYER });
    const turn = await lastTurn(saveId);
    return {
      answer,
      resolution: turn.resolution,
      lines: turn.resolution.constraints.join(' '),
      save: await saveOf(saveId),
    };
  }
  const travelTo = (worldId, saveId, to) =>
    play(worldId, saveId, { action: { verb: 'travel', to, offRoad: true } });
  const mapOf = async (worldId, saveId) =>
    (await loomGetMap.run({ data: { worldId, saveId }, auth: PLAYER })).battleMap;

  test('a creatures event in a forest with no generic map plays on a generated forest map, and a fight starts', async () => {
    const id = hitting(`${systemId}-gen`);
    await seed(GEN, id);
    const { resolution, lines, save } = await travelTo(GEN, id, 'pl_carrow');

    // The map: made for the forest, kept on the save, not the world.
    const mapId = save.mapId;
    expect(mapId).toMatch(/^wild-/);
    expect(Object.keys(save.wildMaps)).toEqual([mapId]);
    const map = save.wildMaps[mapId];
    expect(map).toMatchObject({
      id: mapId,
      wild: true,
      generic: { kind: 'forest-track', terrain: 'forest' },
      sources: { generated: { kind: 'wilds', terrain: 'forest', scene: 'forest-track' } },
    });
    expect(map.entries.length).toBeGreaterThanOrEqual(2);
    expect(map.entries.map((e) => e.id)).toContain(
      map.entries.find((e) => `${e.x},${e.y}` === `${save.cell.x},${save.cell.y}`).id
    );
    expect(mockWorlds[GEN].battleMaps || {}).toEqual({});
    expect(resolution.event.event).toMatchObject({
      what: 'wolf',
      count: 2,
      narrated: false,
      map: { id: mapId, name: 'A forest track', from: 'generated' },
    });

    // Stood at an entry, at the camp in the wilds, the journey kept.
    expect(map.entries.map((e) => `${e.x},${e.y}`)).toContain(`${save.cell.x},${save.cell.y}`);
    expect(save.location).toBeNull();
    expect(save.wild).toEqual(expect.objectContaining({ x: expect.any(Number) }));
    expect(save.at[save.at.length - 1]).toMatchObject({ mapId: 'weald', point: save.wild });
    expect(save.journey).toMatchObject({ leg: 1, done: expect.any(Number) });
    expect(save.wildEvent).toMatchObject({ mapId, what: 'wolf', count: 2, kind: 'creatures' });

    // Its figures: the event's two wolves, from the stat block, on a spawn area.
    expect(save.spawned[mapId]).toHaveLength(1);
    expect(save.spawned[mapId][0]).toMatchObject({
      statBlock: 'wolf',
      name: 'Wolf',
      side: 'hostile',
    });
    expect(save.spawned[mapId][0].cells).toHaveLength(2);
    expect(save.spawned[mapId][0].spawn).toMatch(/^spawn-/);

    // They come for the player: a fight, by an event.
    expect(save.fight).toMatchObject({ by: 'event', mapId });
    expect(Object.keys(save.fight.combatants)).toEqual(
      expect.arrayContaining([
        'player',
        ...save.spawned[mapId][0].cells.map((_, i) => `fig-event-${mapId.slice(5)}-${i + 1}`),
      ])
    );
    expect(resolution.fight).toBeDefined();
    expect(lines).toContain('You come to a track through the trees.');
    expect(lines).toContain('You are set upon by 2 Wolf.');

    // What the page is sent: the map, and the wolves on it.
    const view = await mapOf(GEN, id);
    expect(view).toMatchObject({ id: mapId, name: 'A forest track', width: 30, height: 30 });
    // What is out of sight is not sent: the wolves are off in their spawn area.
    expect(view.people.every((p) => p.side === 'hostile' && p.figure)).toBe(true);
    expect(view.fog.seen).toBeDefined();
    expect(view.host).toEqual({ id: `wild:${mapId}`, name: 'A forest track' });
  });

  test('with the world’s generic forest map, that map is used', async () => {
    const id = hitting(`${systemId}-own`);
    await seed(OWN, id);
    const { resolution, save } = await travelTo(OWN, id, 'pl_carrow');
    const mapId = save.mapId;
    expect(mapId).toMatch(/^wild-/);
    // A copy under an id of its own, flagged, with the world's map unchanged.
    expect(save.wildMaps[mapId]).toMatchObject({
      id: mapId,
      name: 'The old wood',
      wild: true,
      width: 12,
      height: 12,
      sources: { from: 'bm_wood' },
    });
    expect(save.cell).toEqual({ x: 1, y: 6 });
    expect(resolution.event.event.map).toEqual({ id: mapId, name: 'The old wood', from: 'world' });
    expect(mockWorlds[OWN].battleMaps.bm_wood.wild).toBeUndefined();
    // Its figures on the den, and a fight.
    const [group] = save.spawned[mapId];
    expect(group.spawn).toBe('den');
    expect(group.cells).toHaveLength(2);
    group.cells.forEach((c) => {
      expect(c.x).toBeGreaterThanOrEqual(8);
      expect(c.y).toBeGreaterThanOrEqual(8);
    });
    expect(save.fight).toMatchObject({ by: 'event' });
  });

  test('leaving by an edge resumes the journey at the camp: go on from there', async () => {
    const id = hitting(`${systemId}-leave`);
    await seed(FOLK, id);
    // Travellers: standing there, no fight.
    let { save, resolution } = await travelTo(FOLK, id, 'pl_carrow');
    const mapId = save.mapId;
    expect(save.fight).toBeUndefined();
    expect(resolution.fight).toBeUndefined();
    expect(save.spawned[mapId][0]).toMatchObject({ statBlock: 'pedlar', side: 'neutral' });
    const camp = save.wild;
    const journey = save.journey;
    const cellBefore = save.cell;
    expect(cellBefore).toEqual({ x: 1, y: 6 });

    // Going on with the journey is refused while on the map.
    const stuck = await play(FOLK, id, { action: { verb: 'travel', go: 'on' } });
    expect(stuck.lines).toMatch(/Leave the map first/);
    expect((await saveOf(id)).mapId).toBe(mapId);

    // Out by the edge, one square along.
    ({ save, resolution } = await play(FOLK, id, {
      action: { verb: 'move', cell: { x: 2, y: 6 } },
    }));
    expect(resolution.constraints.join(' ')).toContain('You leave by the way out');
    expect(save.mapId).toBeNull();
    expect(save.cell).toBeNull();
    expect(save.wildEvent).toBeNull();
    expect(save.wildMaps).toBeNull();
    expect(save.spawned || {}).toEqual({});
    expect(save.figures || {}).toEqual({});
    // At the camp, the journey as it was.
    expect(save.location).toBeNull();
    expect(save.wild).toEqual(camp);
    expect(save.journey).toEqual(journey);

    // Go on: the next leg walks from the camp (and may bring its own event).
    const next = await play(FOLK, id, { action: { verb: 'travel', go: 'on' } });
    expect(next.resolution.journey).toMatchObject({ offRoad: true, leg: 2 });
    expect(next.lines).toContain('You travel');
  });

  test('leaving in the middle of a fight flees it: the wolves stay behind, and the journey goes on', async () => {
    const id = hitting(`${systemId}-flee`);
    await seed(OWN, id);
    let { save } = await travelTo(OWN, id, 'pl_carrow');
    const mapId = save.mapId;
    expect(save.fight).toMatchObject({ by: 'event' });
    const camp = save.wild;
    const journey = save.journey;
    // The way out is the next square along.
    const fled = await play(OWN, id, { action: { verb: 'move', cell: { x: 2, y: 6 } } });
    save = fled.save;
    expect(fled.lines).toContain('You leave by the way out');
    expect(save.fight).toBeNull();
    expect(save.mapId).toBeNull();
    expect(save.wildMaps).toBeNull();
    expect(save.spawned).toEqual({});
    expect(Object.keys(save.figures || {}).filter((k) => k.includes(mapId.slice(5)))).toEqual([]);
    expect(save.wild).toEqual(camp);
    expect(save.journey).toEqual(journey);
    // Nothing of the event is left for the page.
    const view = await loomGetMap.run({ data: { worldId: OWN, saveId: id }, auth: PLAYER });
    expect(view.battleMap).toBeNull();
    expect(view.wild).toEqual(camp);
  });

  test('the same event makes the same map: in another save, and after a reload', async () => {
    const one = hitting(`${systemId}-same`);
    await seed(GEN, one);
    const first = (await travelTo(GEN, one, 'pl_carrow')).save;
    // The same seed again (the save's id, the leg, the hour): the same map.
    await db.recursiveDelete(saveRef(one));
    await seed(GEN, one);
    const again = (await travelTo(GEN, one, 'pl_carrow')).save;
    expect(again.wildMaps).toEqual(first.wildMaps);
    expect(again.spawned).toEqual(first.spawned);
    // A reload shows the same map, and the same wolves where they are.
    const a = await mapOf(GEN, one);
    const b = await mapOf(GEN, one);
    expect(b).toEqual(a);
    expect(a.id).toBe(first.mapId);
    // Made again from nothing but the world and the seed, it is the same.
    const view = frames.viewFor(frames.playWorld(mockWorlds[GEN]), 'weald', []);
    const seedOfEvent = seedOf(one, 1);
    const made = arrive.mapFor(view, {
      material: 'forest',
      event: { kind: 'creatures', what: 'wolf' },
      seed: seedOfEvent,
    });
    expect(made.map).toEqual(first.wildMaps[first.mapId]);
  });

  test('an event that is only told isn’t played on a map', async () => {
    const id = hitting(`${systemId}-told`);
    await seed(TOLD, id);
    const { resolution, save, lines } = await travelTo(TOLD, id, 'pl_carrow');
    expect(resolution.event.event).toMatchObject({ what: 'wolf', narrated: true });
    expect(resolution.event.event.map).toBeUndefined();
    expect(save.mapId).toBeNull();
    expect(save.wildMaps || null).toBeNull();
    expect(lines).toContain('You are set upon by 2 Wolf.');
  });
});
