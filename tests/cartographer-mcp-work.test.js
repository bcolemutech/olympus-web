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
    open: 0,
  });
  expect(list.origin).toEqual({ id: 'loc_1', name: 'Burdendal' });
  expect(list.byTier).toEqual({ frontier: 1, town: 0, closed: 718, enrich: 0, describe: 168 });
  expect(list.items[0]).toEqual({
    priority: 'frontier',
    type: 'location',
    id: 'loc_1',
    name: 'Burdendal',
    kind: 'settlement',
    grade: 'unbuilt',
    hops: 0,
    population: 28473,
    missing: ['town', 'description', 'residents', 'lore'],
    // How far it is toward Rich, so "missing residents" isn't read as "nobody".
    progress: { size: 'great city', residents: '0 of 6', lore: '0 of 3' },
  });
  // Then the closed places nearest the start.
  expect(list.items.slice(1).every((i) => i.priority === 'closed' && i.hops === 1)).toBe(true);
  expect(Object.keys(list.howTo)).toEqual(['town', 'description', 'residents', 'lore']);
  expect(list.howTo.town).toMatch(/add_place/);
  expect(list.howTo.description).toMatch(/update_location/);
  expect(list).toMatchObject({ total: 887, offset: 0, count: 5, nextOffset: 5 });
});

test('writing up the start and laying out its town opens it, moving the frontier on', async () => {
  await ok('update_location', {
    worldId: WORLD,
    locationId: 'loc_1',
    description: 'A rain-soaked port of slate roofs and tarred rope.',
  });
  // Written up, but still Unbuilt: it has no town.
  const written = await work({ limit: 1 });
  expect(written.items[0]).toMatchObject({
    id: 'loc_1',
    grade: 'unbuilt',
    missing: ['town', 'residents', 'lore'],
  });
  expect(written.items[0].progress).toMatchObject({ residents: '0 of 6' });

  await ok('add_place', {
    worldId: WORLD,
    locationId: 'loc_1',
    name: 'The Harbour',
    kind: 'harbour',
    description: 'Slate quays and tarred rope.',
    entranceFor: ['sea', 'trail'],
  });
  const list = await work({ limit: 6 });
  expect(list.completion).toMatchObject({ unbuilt: 718, playable: 1, open: 0.001 });
  expect(summary(list.items)).toEqual([
    ['frontier', 'loc_631', 'unbuilt', 1],
    ['frontier', 'loc_120', 'unbuilt', 1],
    ['frontier', 'loc_231', 'unbuilt', 1],
    ['frontier', 'loc_229', 'unbuilt', 1],
    // The harbour itself, written up but with nobody there yet.
    ['town', 'plc_1_the-harbour', 'playable', 0],
    ['closed', list.items[5].id, list.items[5].grade, 2],
  ]);
  expect(list.byTier).toMatchObject({ frontier: 4, town: 1, enrich: 1 });

  const start = await work({ grade: 'playable' });
  expect(start.items).toEqual([
    expect.objectContaining({ priority: 'town', id: 'plc_1_the-harbour' }),
    expect.objectContaining({ priority: 'enrich', id: 'loc_1', missing: ['residents', 'lore'] }),
  ]);
});

test('get_location shows the grade, the checklist, and which neighbours are open', async () => {
  const place = await ok('get_location', { worldId: WORLD, locationId: 'loc_1' });
  expect(place).toMatchObject({
    grade: 'playable',
    // Burdendal is a capital of 28,473: a great city's bar (SIZE_TIERS).
    missing: [
      { need: 'residents', for: 'rich', message: 'A great city needs 6 residents (it has 0).' },
      { need: 'lore', for: 'rich', message: 'A great city needs 3 lore entries (it has 0).' },
    ],
  });
  expect(place.connections.map((c) => c.grade)).toEqual([
    'unbuilt',
    'unbuilt',
    'unbuilt',
    'unbuilt',
  ]);
  expect(place.town).toEqual({ places: 1, waysInAndOut: ['The Harbour'], valid: true });
  const neighbour = await ok('get_location', { worldId: WORLD, locationId: 'loc_631' });
  expect(neighbour.connections.find((c) => c.id === 'loc_1').grade).toBe('playable');
  expect(neighbour.missing.slice(0, 2)).toEqual([
    { need: 'town', for: 'playable', message: 'It has no town layout.' },
    {
      need: 'description',
      for: 'playable',
      message: 'Its description is still the imported text.',
    },
  ]);
});

test('enough residents and lore for its size make it rich, and it leaves the work list', async () => {
  const people = ['Mara Quill', 'Tobin Reed', 'Elsa Varne', 'Corin Hale', 'Isa Wren', 'Pell Marr'];
  for (const [i, name] of people.entries()) {
    await ok('add_character', {
      worldId: WORLD,
      name,
      description: `A Burdendal local, one of ${i + 1}.`,
      locationId: 'loc_1',
      townPoint: { x: 500, y: 500 },
    });
    // One resident short of a great city's six: still only playable.
    if (i === 4) {
      const enrich = await work({ grade: 'playable', kind: 'settlement' });
      expect(enrich.items[0]).toMatchObject({
        id: 'loc_1',
        missing: ['residents', 'lore'],
        progress: { residents: '5 of 6', lore: '0 of 3' },
      });
      expect(
        (await ok('get_location', { worldId: WORLD, locationId: 'loc_1' })).missing[0]
      ).toEqual({
        need: 'residents',
        for: 'rich',
        message: 'A great city needs 6 residents (it has 5).',
      });
    }
  }
  for (const title of ['The Founding', 'The Drowned Bells', 'The Salt Tithe']) {
    await ok('add_lore', { worldId: WORLD, title, text: `${title}, retold.`, about: ['loc_1'] });
  }
  expect((await ok('get_location', { worldId: WORLD, locationId: 'loc_1' })).grade).toBe('rich');
  const list = await work({ limit: 100 });
  expect(list.completion).toMatchObject({ playable: 0, rich: 1 });
  // Nothing rich is ever work: it has left the list entirely.
  expect((await work({ grade: 'rich' })).total).toBe(0);
  // 887 to start with, less Burdendal, plus its harbour.
  expect((await work({ limit: 1 })).total).toBe(887);

  const rich = await ok('find_locations', { worldId: WORLD, grade: 'rich' });
  expect(rich.locations).toEqual([expect.objectContaining({ id: 'loc_1', grade: 'rich' })]);
  const overview = await ok('get_world', { worldId: WORLD });
  expect(overview.completion).toMatchObject({
    graded: true,
    places: { total: 719, rich: 1, unbuilt: 718, stub: 0 },
    factions: { stub: 23 },
    regions: { stub: 145 },
  });
});

test('filters: by kind, by what is missing, and around another place', async () => {
  // Settlements take residents (662 still need people), and so do places in
  // town (the harbour).
  expect((await work({ need: 'residents' })).total).toBe(663);
  const needingPeople = await work({ need: 'residents', kind: 'settlement', limit: 3 });
  expect(needingPeople.total).toBe(662);
  expect(needingPeople.items.every((i) => i.kind === 'settlement')).toBe(true);
  expect(needingPeople.items.every((i) => i.missing.includes('residents'))).toBe(true);
  expect((await work({ kind: 'poi', need: 'residents' })).total).toBe(0);

  const regions = await work({ kind: 'region', limit: 2 });
  expect(regions.total).toBe(145);
  expect(regions.items[0]).toMatchObject({
    priority: 'describe',
    type: 'region',
    grade: 'stub',
    missing: ['description', 'lore'],
  });

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
    missing: [{ need: 'lore', for: 'rich', message: 'There is no lore about it.' }],
  });
  expect(region.locations[0]).toMatchObject({ id: 'loc_1', grade: 'rich' });
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
