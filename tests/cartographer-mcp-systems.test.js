'use strict';

/**
 * Game systems over MCP (planning/game-systems.md §4.1; L-801 / #627), driven
 * by a real MCP client against the Firestore emulator: list_systems,
 * get_system, set_system (checked, refused with every problem, warnings
 * back), copy_system, and update_world with systemId, which get_world and
 * the world's grading then show.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-systems --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-systems';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

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

const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createSystemStore, BUILT_IN } = require('../functions/loom-canon/systems');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

const CANONICAL = 'https://bcoletech.com';
const WORLD = 'isles-b1b1b1';

const adminApp = initializeApp({ projectId: 'demo-cartographer-systems' }, 'cartographer-systems');
const db = getFirestore(adminApp);

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
    systems: createSystemStore(() => db),
  })
);
const oauthStore = createInMemoryStore();

let server;
let client;

const call = (name, args) => client.callTool({ name, arguments: args });
async function ok(name, args = {}) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}
async function refused(name, args) {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

// A dice-pool sci-fi system, as Claude would write it.
const STARS = {
  id: 'star-pool',
  name: 'Star Pool',
  credits: [{ source: 'The Loom', licence: 'Our own' }],
  words: { health: 'Stress', currency: 'Credits' },
  sheet: {
    attributes: [
      { id: 'Body', name: 'Body', min: 1, max: 5, modifier: 'Body' },
      { id: 'Mind', name: 'Mind', min: 1, max: 5, modifier: 'Mind' },
    ],
    resources: [{ id: 'stress', name: 'Stress', max: '5 + Mind' }],
    level: { min: 1, max: 10 },
    optional: ['skills'],
    skills: [
      { id: 'Piloting', name: 'Piloting', attribute: 'Mind' },
      { id: 'Brawl', name: 'Brawl', attribute: 'Body' },
    ],
  },
  checks: {
    formula: 'count((attribute + rank)d10, >= 7)',
    ladder: [
      { name: 'Routine', value: 1 },
      { name: 'Tough', value: 2 },
      { name: 'Legendary', value: 4 },
    ],
  },
  creation: { method: 'pointBuy', budget: 6, costs: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 } },
  gmNotes: 'Neon and vacuum.',
};

beforeAll(async () => {
  await db.recursiveDelete(db.collection('loom_systems'));
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db
    .collection('loom_worlds')
    .doc(WORLD)
    .set({
      name: 'The Isles',
      status: 'draft',
      canonVersion: 1,
      tagline: '',
      openingHook: '',
      map: { width: 100, height: 100 },
      rules: {},
      createdAtMs: 1,
      updatedAtMs: 1,
    });

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
  client = new Client({ name: 'cartographer-systems-test', version: '0.0.0' });
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
  await db.recursiveDelete(db.collection('loom_systems'));
  await db.recursiveDelete(db.collection('loom_worlds'));
  await db.terminate();
});

// The tests build on each other, like a session with Claude.

test('the tools are offered, and update_world takes systemId', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  expect(names).toEqual(
    expect.arrayContaining(['list_systems', 'get_system', 'set_system', 'copy_system', 'test_roll'])
  );
  const update = tools.find((t) => t.name === 'update_world');
  expect(Object.keys(update.inputSchema.properties)).toContain('systemId');
});

test('list_systems: the two built-in systems, before any is written (L-804)', async () => {
  expect((await ok('list_systems')).systems).toEqual([
    {
      id: 'd20-fantasy',
      name: 'd20 Fantasy',
      version: 0,
      builtIn: true,
      attributes: ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'],
      optional: ['skills', 'traits'],
      modules: [],
    },
    {
      id: 'pool-scifi',
      name: 'Dice-pool Sci-fi',
      version: 0,
      builtIn: true,
      attributes: ['Body', 'Reflex', 'Mind', 'Presence'],
      optional: ['skills', 'traits'],
      modules: [],
    },
  ]);
});

test('set_system: a valid system is saved, and get_system reads it back', async () => {
  const saved = await ok('set_system', { system: STARS });
  expect(saved).toEqual({
    created: true,
    system: {
      id: 'star-pool',
      name: 'Star Pool',
      version: 1,
      attributes: ['Body', 'Mind'],
      optional: ['skills'],
      modules: [],
    },
  });
  const { system } = await ok('get_system', { systemId: 'star-pool' });
  expect(system).toMatchObject({
    ...STARS,
    version: 1,
    advancement: {},
    modules: {},
    createdBy: 'builder-001',
    createdAt: expect.stringMatching(/^\d{4}-/),
  });
  // Replacing it raises its version, with any warnings.
  const again = await ok('set_system', {
    system: { ...STARS, modules: { shipBattle: { arcs: 4 } } },
  });
  expect(again).toMatchObject({
    created: false,
    system: { version: 2, modules: ['shipBattle'] },
    warnings: ['modules.shipBattle: no module by that name is built yet; it is kept, unused.'],
  });
});

test('set_system: problems refuse it, each one named', async () => {
  const bad = JSON.parse(JSON.stringify(STARS));
  bad.sheet.attributes.push({ id: 'body', name: 'Bulk', min: 1, max: 5, modifier: 'body' });
  // Neither rising nor falling: out of order.
  bad.checks.ladder = [bad.checks.ladder[0], bad.checks.ladder[2], bad.checks.ladder[1]];
  const text = await refused('set_system', { system: bad });
  expect(text).toBe(
    'The system has problems:\n' +
      '- sheet.attributes[2].id "body" is already used by sheet.attributes[0].\n' +
      '- checks.ladder must be in order, easiest first: each rung strictly above the last ' +
      '(or strictly below, for a system that rolls under).'
  );
  expect((await ok('get_system', { systemId: 'star-pool' })).system.version).toBe(2);
  // A built-in can't be set.
  expect(
    await refused('set_system', { system: { ...BUILT_IN['d20-fantasy'], name: 'Mine' } })
  ).toMatch(/built-in system and can't be changed\. Copy it with copy_system/);
});

test('copy_system: a new, named system, independent of its source', async () => {
  const copied = await ok('copy_system', {
    fromSystemId: 'd20-fantasy',
    id: 'isles-fantasy',
    name: 'Fantasy of the Isles',
  });
  expect(copied.system).toMatchObject({
    id: 'isles-fantasy',
    name: 'Fantasy of the Isles',
    version: 1,
    copiedFrom: { id: 'd20-fantasy', version: 0 },
  });
  const { system } = await ok('get_system', { systemId: 'isles-fantasy' });
  await ok('set_system', { system: { ...system, gmNotes: 'Sea mist.' } });
  expect((await ok('get_system', { systemId: 'isles-fantasy' })).system).toMatchObject({
    version: 2,
    gmNotes: 'Sea mist.',
  });
  expect((await ok('get_system', { systemId: 'd20-fantasy' })).system.gmNotes).toMatch(
    /^Heroic fantasy/
  );
  expect(
    await refused('copy_system', { fromSystemId: 'star-pool', id: 'isles-fantasy', name: 'X' })
  ).toMatch(/already a system "isles-fantasy"/);
  expect(await refused('get_system', { systemId: 'nowhere' })).toBe(
    'No system "nowhere". list_systems shows them.'
  );
});

test('update_world sets a world’s system; get_world and its grading show it', async () => {
  const before = await ok('get_world', { worldId: WORLD });
  expect(before.system).toEqual({
    id: 'd20-fantasy',
    name: 'd20 Fantasy',
    version: 0,
    notChosen: true,
  });
  const unmet = before.completion.criteria.find((c) => c.id === 'world.system');
  expect(unmet).toMatchObject({ progress: 0 });

  expect(await refused('update_world', { worldId: WORLD, systemId: 'nowhere' })).toBe(
    'No system "nowhere". list_systems shows them.'
  );
  const updated = await ok('update_world', { worldId: WORLD, systemId: 'star-pool' });
  expect(updated).toMatchObject({
    changed: true,
    updated: ['systemId'],
    world: { system: { id: 'star-pool', name: 'Star Pool' } },
  });
  const after = await ok('get_world', { worldId: WORLD });
  expect(after.system).toEqual({ id: 'star-pool', name: 'Star Pool', version: 2 });
  expect(after.completion.criteria.find((c) => c.id === 'world.system')).toMatchObject({
    progress: 1,
  });
  // A new version reaches the world without the world changing (SY2).
  await ok('set_system', { system: { ...STARS, name: 'Star Pool II' } });
  expect((await ok('get_world', { worldId: WORLD })).system).toEqual({
    id: 'star-pool',
    name: 'Star Pool II',
    version: 3,
  });
  // Setting the same system again changes nothing.
  expect(await ok('update_world', { worldId: WORLD, systemId: 'star-pool' })).toMatchObject({
    changed: false,
    updated: [],
  });
});

test('test_roll: a check for a sample character, with its breakdown (L-803)', async () => {
  const roll = await ok('test_roll', {
    systemId: 'd20-fantasy',
    skill: 'Stealth',
    rung: 'Hard',
    sheet: { attributes: { DEX: 16 }, skills: { Stealth: 2 } },
    seed: 42,
  });
  expect(roll).toMatchObject({
    system: { id: 'd20-fantasy', version: 0 },
    seed: 42,
    formula: '1d20 + modifier + rank',
    rolledWith: { attribute: 'DEX', skill: 'Stealth' },
    rung: 'Hard',
    difficulty: 16,
    degree: expect.stringMatching(
      /^(criticalSuccess|success|successAtCost|failure|criticalFailure)$/
    ),
  });
  // DEX 16 is +3, Stealth 2: the die and 5.
  const die = roll.breakdown.terms[0];
  expect(die).toMatchObject({ kind: 'dice', expr: '1d20' });
  expect(roll.total).toBe(die.value + 3 + 2);
  expect(roll.breakdown.shown).toBe(`${die.value} + 3 + 2`);
  // The same seed, the same roll.
  expect(
    await ok('test_roll', {
      systemId: 'd20-fantasy',
      skill: 'Stealth',
      rung: 'Hard',
      sheet: { attributes: { DEX: 16 }, skills: { Stealth: 2 } },
      seed: 42,
    })
  ).toEqual(roll);

  // A dice-pool system, by attribute, with the defaults for the rest.
  const pool = await ok('test_roll', { systemId: 'star-pool', attribute: 'Body', seed: 7 });
  expect(pool).toMatchObject({
    formula: 'count((attribute + rank)d10, >= 7)',
    rolledWith: { attribute: 'Body', skill: null },
    rung: 'Routine',
  });
  expect(pool.breakdown.terms.find((t) => t.kind === 'count').rolls).toHaveLength(3);
});

test('test_roll: the built-in systems’ odds, rung by rung, over seeded rolls (L-804)', async () => {
  // How often an untrained, middling character succeeds at each rung, at a
  // cost or better: a bare d20 in the fantasy system, three d10s in the
  // sci-fi one (where one success short is still a success, at a cost).
  const expected = {
    'd20-fantasy': [0.55, 0.4, 0.25, 0.1, 0.05],
    'pool-scifi': [0.784, 0.784, 0.352, 0.064, 0],
  };
  const SEEDS = 120;
  for (const [systemId, rates] of Object.entries(expected)) {
    const { system } = await ok('get_system', { systemId });
    for (const [i, rung] of system.checks.ladder.entries()) {
      let wins = 0;
      for (let seed = 0; seed < SEEDS; seed++) {
        const roll = await ok('test_roll', {
          systemId,
          skill: system.checks.lock.skill,
          rung: rung.name,
          seed,
        });
        if (roll.success) wins += 1;
      }
      expect([systemId, rung.name, Math.abs(wins / SEEDS - rates[i]) <= 0.1]).toEqual([
        systemId,
        rung.name,
        true,
      ]);
    }
  }
});

test('test_roll refusals', async () => {
  expect(await refused('test_roll', { systemId: 'd20-fantasy', skill: 'Juggling' })).toBe(
    'There is no skill "Juggling" in this world’s rules.'
  );
  expect(await refused('test_roll', { systemId: 'nowhere' })).toBe(
    'No system "nowhere". list_systems shows them.'
  );
});

test('update_world sets a premade character, checked against the world’s system (L-812)', async () => {
  const { defaultSheet } = require('../functions/loom-canon/sheets');
  const fantasy = BUILT_IN['d20-fantasy'];
  const sheet = { ...defaultSheet(fantasy, { traits: ['swim'] }), speed: 99 };
  sheet.attributes.DEX = 16;
  // With the system it will play by, given together.
  const set = await ok('update_world', {
    worldId: WORLD,
    systemId: 'd20-fantasy',
    startingSheet: sheet,
  });
  expect(set).toMatchObject({ changed: true, updated: ['systemId', 'startingSheet'] });
  const stored = (await db.collection('loom_worlds').doc(WORLD).get()).data().rules.startingSheet;
  expect(stored.attributes.DEX).toBe(16);
  expect(stored).not.toHaveProperty('speed'); // worked out by the system (L-811)
  // One that doesn't fit is refused, each problem named.
  expect(
    await refused('update_world', {
      worldId: WORLD,
      startingSheet: { ...sheet, attributes: { ...sheet.attributes, DEX: 30 }, level: 0 },
    })
  ).toBe(
    'The starting sheet doesn’t fit the world’s rules:\n' +
      '- Dexterity is 30; it must be a whole number from 3 to 18.\n' +
      '- The level is 0; it must be from 1 to 20.\n' +
      '- Hit points is 6; it must be a whole number from 0 to 1.'
  );
  // null removes it.
  expect(await ok('update_world', { worldId: WORLD, startingSheet: null })).toMatchObject({
    updated: ['startingSheet'],
  });
  expect((await db.collection('loom_worlds').doc(WORLD).get()).data().rules).not.toHaveProperty(
    'startingSheet'
  );
});
