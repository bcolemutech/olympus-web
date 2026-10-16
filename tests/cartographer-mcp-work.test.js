'use strict';

/**
 * The build work list and grades over MCP (planning/the-loom-layered-worlds.md
 * §4, §6; L-323 / #392), driven by a real MCP client against Nisia imported
 * into the Firestore emulator: the frontier grows outward from the start as
 * places are written up, checklists say what is missing, and grades update on
 * the next call.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-work --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-work';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { GATEWAY } = require('./helpers/towns');
const { loadDraftWorld } = require('../functions/cartographer/load');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const WORLD = 'nisia-a0a0a0';

const adminApp = initializeApp({ projectId: 'demo-cartographer-work' }, 'cartographer-work-test');
const db = getFirestore(adminApp);
const worlds = () => db.collection('loom_worlds');

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
  })
);
const oauthStore = createInMemoryStore();

let server;
let client;

// Every place needs a battle map to be open (L-622): new places here get the
// generic gateway, as Claude would give them a map.
async function call(name, args) {
  const withMap =
    name === 'add_place' && args && !('battleMap' in args)
      ? { ...args, battleMap: GATEWAY.id }
      : args;
  return client.callTool({ name, arguments: withMap });
}
async function ok(name, args) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}
const work = (args = {}) => ok('list_work', { worldId: WORLD, ...args });
const summary = (items) => items.map((i) => [i.priority, i.id, i.grade, i.hops]);

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  const parsed = parseAzgaarExport(
    fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
  );
  await loadDraftWorld({
    db,
    mapped: mapToCanon(parsed),
    source: parsed.source,
    uploadedBy: 'builder-001',
    worldId: WORLD,
  });
  await worlds()
    .doc(WORLD)
    .update({
      status: 'published',
      openingHook: 'A storm drives your ship ashore at Burdendal.',
      rules: { startingLocationId: 'loc_1' },
      canonVersion: 2,
    });
  await worlds().doc(WORLD).collection('battleMaps').doc(GATEWAY.id).set(GATEWAY);

  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  oauthStore._debug.grants.set('g', {
    grantId: 'g',
    uid: 'builder-001',
    appId: 'cartographer',
    revoked: false,
  });
  const token = signAccessToken({
    uid: 'builder-001',
    audience: `${CANONICAL}/mcp/cartographer`,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'g',
  });
  client = new Client({ name: 'cartographer-work-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
  );
}, 60000);

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(worlds());
  await db.terminate();
});

// The tests build on each other, like a session with Claude.

const scoreItems = (list) => list.items.filter((item) => item.priority === 'score');
const groupOf = (list, criterion, tool) =>
  scoreItems(list).find((g) => g.criterion === criterion && (!tool || g.tool === tool));

test('a fresh import: nothing is open, and the start is the only frontier', async () => {
  const list = await work({ limit: 5 });
  // No settlement has a town yet, nor any point of interest a map: all Unbuilt.
  expect(list.completion).toMatchObject({
    total: 719,
    // Every settlement lacks a town, and every point of interest a map (L-622).
    unbuilt: 719,
    stub: 0,
    playable: 0,
    rich: 0,
    vivid: 0,
    legendary: 0,
    open: 0,
  });
  expect(list.world).toEqual({ score: expect.any(Number), band: 'playable' });
  expect(list.origin).toEqual({ id: 'loc_1', name: 'Burdendal' });
  expect(list.byTier).toMatchObject({ frontier: 1, closed: 718 });
  expect(list.byTier.score).toBeGreaterThan(0);
  expect(list.items[0]).toEqual({
    priority: 'frontier',
    type: 'location',
    id: 'loc_1',
    name: 'Burdendal',
    kind: 'settlement',
    grade: 'unbuilt',
    band: 'unbuilt',
    score: 0,
    hops: 0,
    population: 28473,
    // What opens it: the gate's needs (its score's work comes once open).
    missing: ['town', 'description'],
    // How far it is toward its size's people and lore, so "missing
    // residents" isn't read as "nobody" (a great city wants 12 and 8).
    progress: { size: 'great city', residents: '0 of 12', lore: '0 of 8' },
    // Whether its town has ground yet (L-653).
    ground: false,
  });
  // Then the closed places nearest the start.
  expect(list.items.slice(1).every((i) => i.priority === 'closed' && i.hops === 1)).toBe(true);
  expect(Object.keys(list.howTo)).toEqual(['town', 'description']);
  expect(list.howTo.town).toMatch(/add_place/);
  expect(list.howTo.description).toMatch(/update_location/);
  expect(list).toMatchObject({ offset: 0, count: 5, nextOffset: 5 });
  expect(list.total).toBe(719 + list.byTier.score);
});

test('closed places come first; then the score’s work, grouped, most points first', async () => {
  const all = await work({ limit: 100, offset: 719 });
  const groups = scoreItems(all);
  expect(groups.length).toBe(all.byTier.score);
  // Most points first.
  const points = groups.map((g) => g.points);
  expect(points).toEqual([...points].sort((a, b) => b - a));
  for (const group of groups) {
    // Every group names its criterion, the tool that does it, and what it is for.
    expect(group).toEqual(
      expect.objectContaining({
        type: 'criterion',
        criterion: expect.any(String),
        label: expect.any(String),
        need: expect.any(String),
        tool: expect.any(String),
        weight: expect.any(Number),
        count: group.entities.length + (group.more || 0),
        summary: expect.stringContaining(`${group.points} points · ${group.tool}`),
      })
    );
    for (const entity of group.entities) {
      expect(entity).toEqual(
        expect.objectContaining({ type: expect.any(String), id: expect.any(String) })
      );
    }
  }
  // Realms and regions are never gated: the work to describe them is score
  // work, apart because their tools differ. 145 regions, shown ten at a time.
  const regions = groupOf(all, 'realm.description', 'update_region');
  expect(regions).toMatchObject({ count: 145, more: 135, need: 'description' });
  expect(regions.summary).toMatch(/^145 regions: a description long enough · [\d.]+ points/);
  expect(groupOf(all, 'realm.description', 'update_faction')).toMatchObject({ count: 23 });
});

test('writing up the start and laying out its town opens it, moving the frontier on', async () => {
  await ok('update_location', {
    worldId: WORLD,
    locationId: 'loc_1',
    description: 'A rain-soaked port of slate roofs and tarred rope.',
  });
  // Written up, but still Unbuilt: it has no town.
  const written = await work({ limit: 1 });
  expect(written.items[0]).toMatchObject({ id: 'loc_1', grade: 'unbuilt', missing: ['town'] });
  expect(written.items[0].progress).toMatchObject({ residents: '0 of 12' });

  await ok('add_place', {
    worldId: WORLD,
    locationId: 'loc_1',
    name: 'The Harbour',
    kind: 'harbour',
    description: 'Slate quays and tarred rope.',
    entranceFor: ['sea', 'trail'],
  });
  const list = await work({ limit: 5 });
  expect(list.completion).toMatchObject({ unbuilt: 718, playable: 1, open: 0.001 });
  expect(summary(list.items)).toEqual([
    ['frontier', 'loc_631', 'unbuilt', 1],
    ['frontier', 'loc_120', 'unbuilt', 1],
    ['frontier', 'loc_231', 'unbuilt', 1],
    ['frontier', 'loc_229', 'unbuilt', 1],
    ['closed', list.items[4].id, list.items[4].grade, 2],
  ]);
  expect(list.byTier).toMatchObject({ frontier: 4, closed: 714 });

  // Open now, Burdendal and its harbour are score work: near play, so they
  // weigh three times what far places do (§4.4).
  const open = await work({ grade: 'playable', kind: 'settlement', limit: 100 });
  expect(open.items.every((i) => i.priority === 'score')).toBe(true);
  const residents = groupOf(open, 'settlement.residents');
  expect(residents.entities).toEqual([
    expect.objectContaining({
      type: 'location',
      kind: 'settlement',
      id: 'loc_1',
      band: 'playable',
      // Its whole weight, 15, times 3 for being where the game is.
      points: 45,
      have: 0,
      want: 12,
      message: 'A great city needs 12 residents (it has 0).',
    }),
  ]);
  expect(residents.summary).toBe(
    '1 settlement: residents for its size · 45 points · add_character'
  );
  const harbour = await work({ kind: 'place', limit: 100 });
  expect(groupOf(harbour, 'place.someone').entities).toEqual([
    expect.objectContaining({ id: 'plc_1_the-harbour', kind: 'place', have: 0, want: 2 }),
  ]);
});

test('get_location shows the score, band, what it is missing and its weighted checklist', async () => {
  const place = await ok('get_location', { worldId: WORLD, locationId: 'loc_1' });
  expect(place).toMatchObject({ grade: 'playable', band: 'playable' });
  // Open, but nothing past the gate yet: its short description, nobody, no
  // lore, no ground, and its harbour as bare.
  expect(place.score).toBe(0);
  // Burdendal is a capital of 28,473: a great city (SIZE_TIERS). Its unmet
  // criteria come most score first, each with what doing it gains (L-691).
  const { missing } = place;
  expect(missing.every((item) => item.for === 'score')).toBe(true);
  expect(missing.map((item) => item.gain)).toEqual(
    missing.map((item) => item.gain).sort((a, b) => b - a)
  );
  expect(missing).toContainEqual(
    expect.objectContaining({
      need: 'residents',
      criterion: 'settlement.residents',
      message: 'A great city needs 12 residents (it has 0).',
      have: 0,
      want: 12,
      tool: 'add_character',
    })
  );
  // The whole checklist: every criterion, with its weight and progress (L-692).
  expect(place.checklist.map((c) => c.id)).toEqual([
    'settlement.residents',
    'settlement.lore',
    'settlement.townArt',
    'settlement.description',
    'settlement.loreLinks',
    'settlement.ground',
  ]);
  expect(place.checklist[0]).toEqual({
    id: 'settlement.residents',
    label: 'Residents for its size',
    weight: 15,
    met: false,
    progress: 0,
    have: 0,
    want: 12,
    need: 'residents',
    tool: 'add_character',
    message: 'A great city needs 12 residents (it has 0).',
  });
  expect(place.connections.map((c) => c.grade)).toEqual([
    'unbuilt',
    'unbuilt',
    'unbuilt',
    'unbuilt',
  ]);
  expect(place.town).toEqual({ places: 1, waysInAndOut: ['The Harbour'], valid: true });
  const neighbour = await ok('get_location', { worldId: WORLD, locationId: 'loc_631' });
  expect(neighbour.connections.find((c) => c.id === 'loc_1')).toMatchObject({
    grade: 'playable',
    band: 'playable',
  });
  expect(neighbour.missing.slice(0, 2)).toEqual([
    { need: 'town', for: 'playable', message: 'It has no town layout.' },
    {
      need: 'description',
      for: 'playable',
      message: 'Its description is still the imported text.',
    },
  ]);
});

test('people, lore and a long description make it Rich; ground raises it', async () => {
  const long = (what) => `${what}. ` + Array(60).fill('salt').join(' ');
  await ok('update_location', {
    worldId: WORLD,
    locationId: 'loc_1',
    description: long('A rain-soaked port of slate roofs and tarred rope'),
  });
  for (let i = 1; i <= 12; i += 1) {
    await ok('add_character', {
      worldId: WORLD,
      name: `Local ${String.fromCharCode(64 + i)}`,
      description: `A Burdendal local, one of ${i}.`,
      locationId: 'loc_1',
      townPoint: { x: 500, y: 500 },
    });
    // Five of a great city's twelve: its progress says so.
    if (i === 5) {
      const { missing } = await ok('get_location', { worldId: WORLD, locationId: 'loc_1' });
      expect(missing).toContainEqual(
        expect.objectContaining({
          need: 'residents',
          message: 'A great city needs 12 residents (it has 5).',
          have: 5,
          want: 12,
        })
      );
    }
  }
  // The same work across many: twelve locals with short descriptions and no
  // realm make two groups of twelve, each with its tool (L-692).
  const people = await work({ kind: 'character', limit: 100 });
  expect(groupOf(people, 'character.description')).toMatchObject({
    count: 12,
    more: 2,
    tool: 'update_character',
    summary: expect.stringMatching(/^12 characters: a description long enough · [\d.]+ points/),
  });
  expect(groupOf(people, 'character.faction')).toMatchObject({ count: 12, need: 'faction' });

  // Eight entries long enough to count, about the town and its harbour, one
  // naming both (variety, and lore that links).
  for (let i = 1; i <= 8; i += 1) {
    await ok('add_lore', {
      worldId: WORLD,
      title: `Tale ${i}`,
      text: long(`Tale ${i}`),
      about: i === 1 ? ['loc_1', 'plc_1_the-harbour'] : ['loc_1'],
    });
  }
  // Rich already, with only its town's art and ground (L-655) to go.
  const unground = await ok('get_location', { worldId: WORLD, locationId: 'loc_1' });
  expect(unground.missing.map((item) => item.need)).toEqual(['townArt', 'ground']);
  expect(unground).toMatchObject({ grade: 'playable', band: 'rich' });
  expect(unground.score).toBeGreaterThanOrEqual(40);
  await ok('update_place', {
    worldId: WORLD,
    placeId: 'plc_1_the-harbour',
    position: { x: 500, y: 950 },
  });
  await ok('set_town_ground', {
    worldId: WORLD,
    locationId: 'loc_1',
    water: [
      {
        name: 'the bay',
        points: [
          { x: 0, y: 960 },
          { x: 1000, y: 960 },
          { x: 1000, y: 1000 },
          { x: 0, y: 1000 },
        ],
      },
    ],
  });
  const built = await ok('get_location', { worldId: WORLD, locationId: 'loc_1' });
  expect(built).toMatchObject({ grade: 'playable', band: 'rich' });
  expect(built.score).toBeGreaterThan(unground.score);
  // Town art is what is left of its own: Vivid takes more than this.
  expect(built.missing.map((item) => item.need)).toEqual(['townArt']);
  const closed = await work({ kind: 'settlement', limit: 1 });
  const list = await work({
    kind: 'settlement',
    offset: closed.byTier.frontier + closed.byTier.closed,
  });
  expect(list.completion).toMatchObject({ playable: 0, rich: 1 });
  // What is left for it is town art, in its group with its tool.
  expect(scoreItems(list).map((g) => g.criterion)).toEqual(['settlement.townArt']);
  expect(groupOf(list, 'settlement.townArt')).toMatchObject({
    tool: 'studio_assign',
    entities: [expect.objectContaining({ id: 'loc_1', band: 'rich' })],
  });
  expect((await work({ band: 'rich', kind: 'settlement' })).total).toBe(1);

  const rich = await ok('find_locations', { worldId: WORLD, band: 'rich' });
  expect(rich.locations).toEqual([
    expect.objectContaining({
      id: 'loc_1',
      grade: 'playable',
      band: 'rich',
      score: built.score,
    }),
  ]);
  // `grade` filters by the gate.
  const open = await ok('find_locations', { worldId: WORLD, grade: 'playable' });
  expect(open.locations.map((l) => l.id)).toEqual(['loc_1']);
  expect((await ok('find_locations', { worldId: WORLD, band: 'vivid' })).total).toBe(0);
  const overview = await ok('get_world', { worldId: WORLD });
  expect(overview).toMatchObject({ score: overview.completion.score, band: 'playable' });
  expect(overview.completion).toMatchObject({
    graded: true,
    rubricVersion: 6,
    band: 'playable',
    places: { total: 719, rich: 1, unbuilt: 718, stub: 0 },
    factions: { stub: 23 },
    regions: { stub: 145 },
    characters: { playable: 12 },
  });
  expect(overview.score).toBeGreaterThan(0);
  expect(overview.completion.criteria.map((c) => c.id)).toEqual([
    'world.mapArt',
    'world.cover',
    'world.lore',
    'world.system',
    'world.hook',
  ]);
});

test('get_character and get_battle_map show their score, band and weighted checklist', async () => {
  const [local] = Object.values(
    (await ok('get_world', { worldId: WORLD })).characters.filter((c) => c.name === 'Local A')
  );
  const character = await ok('get_character', { worldId: WORLD, characterId: local.id });
  expect(character).toMatchObject({ grade: 'playable', band: expect.any(String) });
  expect(character.checklist).toEqual([
    expect.objectContaining({ id: 'character.description', weight: 25, met: false, have: 6 }),
    // Tale 1 doesn't name them: no lore about them.
    expect.objectContaining({ id: 'character.lore', weight: 15, met: false }),
    expect.objectContaining({ id: 'character.faction', weight: 10, met: false }),
  ]);
  expect(character.missing[0]).toMatchObject({ criterion: 'character.description', gain: 25 });

  const map = await ok('get_battle_map', { worldId: WORLD, mapId: GATEWAY.id });
  expect(map).toMatchObject({ grade: 'playable', score: expect.any(Number) });
  expect(map.checklist.map((c) => [c.id, c.weight])).toEqual([
    ['battleMap.layers', 30],
    ['battleMap.art', 30],
    ['battleMap.features', 20],
    ['battleMap.exits', 20],
  ]);
  // The gateway has an exit and nothing else.
  expect(map.checklist.find((c) => c.id === 'battleMap.exits').met).toBe(true);
  expect(map.score).toBe(20);
});

test('filters: by kind, by what is missing, and around another place', async () => {
  // Closed places, by what opens them.
  const towns = await work({ need: 'town', limit: 3 });
  expect(towns.items.every((i) => i.missing.includes('town'))).toBe(true);
  expect(towns.byTier.score).toBe(0);
  // Score work, by what it asks for: residents for the harbour (a place
  // wants two found there).
  const residents = await work({ need: 'residents' });
  expect(residents.byTier).toMatchObject({ frontier: 0, closed: 0 });
  expect(scoreItems(residents).every((g) => g.need === 'residents')).toBe(true);
  expect(groupOf(residents, 'place.someone').entities.map((e) => e.id)).toEqual([
    'plc_1_the-harbour',
  ]);
  // need battleMap: places without a map, or on a generic one.
  const battleMaps = await work({ need: 'battleMap', kind: 'place' });
  expect(groupOf(battleMaps, 'place.ownMap')).toMatchObject({
    need: 'battleMap',
    entities: [expect.objectContaining({ id: 'plc_1_the-harbour' })],
  });

  const regions = await work({ kind: 'region', limit: 100 });
  expect(regions.byTier).toMatchObject({ frontier: 0, closed: 0 });
  expect(scoreItems(regions).every((g) => g.entities.every((e) => e.kind === 'region'))).toBe(true);

  // Around Hitchel instead of the start: it is closed, so it heads the frontier.
  const around = await work({ near: 'loc_24', limit: 2 });
  expect(around.origin).toEqual({ id: 'loc_24', name: 'Hitchel' });
  expect(around.items[0]).toMatchObject({ priority: 'frontier', id: 'loc_24', hops: 0 });

  const unknown = await call('list_work', { worldId: WORLD, near: 'loc_0' });
  expect(unknown.isError).toBe(true);
});

test('update_region writes a description at last, and grades the region', async () => {
  const result = await ok('update_region', {
    worldId: WORLD,
    regionId: 'reg_1',
    description: 'Rain-green hills between the bay and the old road.',
  });
  expect(result).toMatchObject({ changed: true, updated: ['description'] });
  const stored = (await worlds().doc(WORLD).collection('regions').doc('reg_1').get()).data();
  expect(stored).toMatchObject({
    description: 'Rain-green hills between the bay and the old road.',
    sources: { description: 'mcp' },
  });
  const region = await ok('get_region', { worldId: WORLD, regionId: 'reg_1' });
  expect(region).toMatchObject({
    description: 'Rain-green hills between the bay and the old road.',
    grade: 'playable',
    band: expect.any(String),
    score: expect.any(Number),
  });
  // Its description is short of 80 words, and nobody writes its lore yet.
  expect(region.missing.map((item) => item.criterion)).toEqual(
    expect.arrayContaining(['realm.description', 'realm.lore'])
  );
  expect(region.checklist.map((c) => c.id)).toEqual([
    'realm.description',
    'realm.lore',
    'realm.people',
  ]);
  // Burdendal's twelve locals are its notable people.
  expect(region.checklist.find((c) => c.id === 'realm.people').met).toBe(true);
  expect(region.locations[0]).toMatchObject({ id: 'loc_1', grade: 'playable', band: 'rich' });
  const realm = await ok('get_faction', { worldId: WORLD, factionId: 'fac_1' });
  expect(realm.checklist.map((c) => c.id)).toEqual([
    'realm.description',
    'realm.lore',
    'realm.people',
  ]);
  expect((await call('update_region', { worldId: WORLD, regionId: 'reg_1' })).isError).toBe(true);
});

test('unplaced: the characters still without a position, each with a suggestion (L-683)', async () => {
  const characters = worlds().doc(WORLD).collection('characters');
  await characters.doc('chr_old-timer').set({
    id: 'chr_old-timer',
    name: 'Old Timer',
    description: 'Made before positions.',
    locationId: 'loc_1',
  });
  const bump = async () =>
    worlds()
      .doc(WORLD)
      .update({ canonVersion: (await worlds().doc(WORLD).get()).data().canonVersion + 1 });
  await bump();
  const listed = await work();
  expect(listed.unplaced).toMatchObject({
    total: 1,
    characters: [
      {
        id: 'chr_old-timer',
        name: 'Old Timer',
        problem: expect.stringMatching(/they need a town point \(townPoint\)$/),
        suggested: { townPoint: { x: expect.any(Number), y: expect.any(Number) } },
      },
    ],
    howTo: expect.stringMatching(/update_character/),
  });
  await characters.doc('chr_old-timer').delete();
  await bump();
  expect(await work()).not.toHaveProperty('unplaced');
});
