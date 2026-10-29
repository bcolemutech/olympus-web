'use strict';

/**
 * Named stat blocks (planning/builders-tools.md §4.3; L-393 / #739), driven
 * by a real MCP client through /mcp/cartographer against the Firestore
 * emulator: three stat blocks and twenty characters set in two calls; a
 * changed block reaching them all while an override stays; a bad block
 * refused with reasons; one in use not deleted; and a figure placed from a
 * named block fighting with its numbers, in the world as the Loom loads it.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-stat-blocks --verbose"
 */

const PROJECT = 'demo-cartographer-stat-blocks';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-stat-blocks';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

// The admin app, as the Cloud Functions start it.
const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
require('../functions/index');

const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const loomCanon = require('../functions/loom-canon');
const sheets = require('../functions/loom-canon/sheets');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const combat = require('../functions/loom-modules/combat');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { applyStateMutations } = require('../functions/loom-models');
const { cartographerApp } = require('../functions/mcp/apps/cartographer');
const { createFirestoreWorldReader } = require('../functions/mcp/apps/cartographer/reader');
const { createFirestoreWorldWriter } = require('../functions/mcp/apps/cartographer/writer');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createInMemoryAuditLog } = require('../functions/mcp/audit');

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/cartographer`;
const BUILDER = 'builder-001';

const db = getFirestore();
const worlds = () => db.collection('loom_worlds');
const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
    systems: { get: async (id) => BUILT_IN[id] || null },
  })
);
const oauthStore = createInMemoryStore();
const audit = createInMemoryAuditLog();

let server;
let client;

async function ok(name, args) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}
async function refused(name, args) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError).toBe(true);
  return result.content[0].text;
}
const loaded = (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false });

beforeAll(async () => {
  await db.recursiveDelete(worlds());
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
      audit,
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  oauthStore._debug.grants.set('grant-builder', {
    grantId: 'grant-builder',
    uid: BUILDER,
    appId: 'cartographer',
    revoked: false,
  });
  const token = signAccessToken({
    uid: BUILDER,
    audience: AUD,
    scope: 'mcp:cartographer',
    issuer: CANONICAL,
    grantId: 'grant-builder',
  });
  client = new Client({ name: 'cartographer-stat-blocks-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${server.address().port}/mcp/cartographer`),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
    )
  );
});

afterAll(async () => {
  await client.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(worlds());
  functionsTest.cleanup();
});

// Three blocks for the fort's garrison (d20 Fantasy).
const block = (str, attack) => ({
  attributes: { STR: str, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
  attacks: [
    {
      id: attack.toLowerCase(),
      name: attack,
      reach: 1,
      attack: '1d20 + 4',
      damage: '1d8',
      type: 'piercing',
    },
  ],
});
const BLOCKS = [
  { id: 'gate-guard', name: 'Gate guard', statBlock: block(14, 'Halberd') },
  { id: 'archer', name: 'Wall archer', statBlock: block(10, 'Dagger') },
  { id: 'sergeant', name: 'Sergeant', statBlock: block(16, 'Longsword') },
];

describe('named stat blocks', () => {
  let worldId;
  let ids;

  beforeAll(async () => {
    ({ worldId } = await ok('create_world', { name: 'Fort Vigil' }));
    const { added } = await ok('add_locations', {
      worldId,
      locations: [{ name: 'The Fort', kind: 'poi', x: 100, y: 100, markerType: 'fort' }],
    });
    ids = [];
    for (let i = 1; i <= 20; i++) {
      const { character } = await ok('add_character', {
        worldId,
        name: `Soldier ${i}`,
        description: 'One of the garrison.',
        locationId: added[0].id,
      });
      ids.push(character.id);
    }
  });

  test('three stat blocks and twenty characters, in two calls', async () => {
    const set = await ok('set_stat_block', { worldId, blocks: BLOCKS });
    expect(set.statBlocks.map((b) => [b.id, b.created])).toEqual([
      ['gate-guard', true],
      ['archer', true],
      ['sergeant', true],
    ]);
    const given = await ok('set_sheets', {
      worldId,
      sheets: ids.map((characterId, i) =>
        i === 0
          ? { characterId, statBlock: 'sergeant' }
          : i === 1
            ? { characterId, statBlock: 'gate-guard', overrides: { attributes: { STR: 18 } } }
            : { characterId, statBlock: i < 14 ? 'gate-guard' : 'archer' }
      ),
    });
    expect(given.count).toBe(20);
    const world = await loaded(worldId);
    expect(world.characters[ids[0]].sheet.attributes.STR).toBe(16);
    expect(world.characters[ids[1]].sheet.attributes.STR).toBe(18);
    expect(world.characters[ids[5]].sheet.attacks[0].name).toBe('Halberd');
    expect(world.characters[ids[19]].sheet.attacks[0].name).toBe('Dagger');
    // Stored as the name, not the sheet.
    const raw = (await worlds().doc(worldId).collection('characters').doc(ids[5]).get()).data();
    expect(raw).toMatchObject({ statBlock: 'gate-guard' });
    expect(raw).not.toHaveProperty('sheet');
    const listed = await ok('list_stat_blocks', { worldId });
    expect(listed.statBlocks.find((b) => b.id === 'gate-guard').usedBy.characters).toHaveLength(13);
  });

  test('a changed stat block reaches them all; an override stays', async () => {
    const changed = await ok('set_stat_block', {
      worldId,
      id: 'gate-guard',
      statBlock: { ...block(15, 'Pike'), skills: { Perception: 2 } },
    });
    expect(changed.statBlock).toMatchObject({
      created: false,
      reaches: '13 characters and 0 groups of figures',
    });
    const world = await loaded(worldId);
    expect(world.characters[ids[5]].sheet).toMatchObject({
      attributes: { STR: 15 },
      skills: { Perception: 2 },
    });
    expect(world.characters[ids[5]].sheet.attacks[0].name).toBe('Pike');
    // The one with an override: the new block, and still STR 18.
    expect(world.characters[ids[1]].sheet.attributes.STR).toBe(18);
    expect(world.characters[ids[1]].sheet.attacks[0].name).toBe('Pike');
    // get_character shows the sheet worked out.
    expect((await ok('get_character', { worldId, characterId: ids[5] })).sheet.attributes.STR).toBe(
      15
    );
  });

  test('a bad stat block is refused with reasons, and nothing is written', async () => {
    const text = await refused('set_stat_block', {
      worldId,
      blocks: [
        { id: 'ogre', name: 'Ogre', statBlock: { attributes: { STR: 30 } } },
        { id: 'archer', statBlock: block(10, 'Bow') },
      ],
    });
    expect(text).toMatch(/blocks\[0\] \(ogre\): it doesn’t fit the world’s rules/);
    expect(text).toMatch(/Strength is 30/);
    expect(text).toMatch(/Dexterity \(DEX\) has no score/);
    const world = await loaded(worldId);
    expect(world.statBlocks).not.toHaveProperty('ogre');
    expect(world.statBlocks.archer.statBlock.attacks[0].name).toBe('Dagger');
    // A name that isn't a block, and overrides on a sheet of their own.
    expect(
      await refused('set_sheets', {
        worldId,
        sheets: [
          { characterId: ids[0], statBlock: 'knight' },
          { characterId: ids[1], statBlock: block(10, 'Club'), overrides: { level: 2 } },
        ],
      })
    ).toMatch(/sheets\[0\]: No stat block "knight"[\s\S]*sheets\[1\]: overrides go with/);
  });

  test('one in use is not deleted; unused, it is', async () => {
    expect(await refused('set_stat_block', { worldId, id: 'sergeant', statBlock: null })).toMatch(
      /Sergeant is named by Soldier 1\. Give them another first\./
    );
    await ok('update_character', { worldId, characterId: ids[0], statBlock: 'archer' });
    expect((await loaded(worldId)).characters[ids[0]].sheet.attributes.STR).toBe(10);
    expect(await ok('set_stat_block', { worldId, id: 'sergeant', statBlock: null })).toMatchObject({
      statBlock: { id: 'sergeant', deleted: true },
    });
  });

  test('set_sheet with a sheet of their own leaves the block behind', async () => {
    await ok('set_sheet', { worldId, characterId: ids[2], statBlock: block(8, 'Club') });
    const raw = (await worlds().doc(worldId).collection('characters').doc(ids[2]).get()).data();
    expect(raw).not.toHaveProperty('statBlock');
    expect(raw.sheet.attributes.STR).toBe(8);
  });

  test('a figure placed from a named block fights with its numbers', async () => {
    // A yard to fight in, given to the fort.
    const fort = Object.values((await loaded(worldId)).locations)[0].id;
    const yard = {
      id: 'bm_yard',
      name: 'The yard',
      width: 8,
      height: 5,
      entries: [{ id: 'gate', x: 0, y: 2 }],
      exits: [],
      features: [],
      walls: [],
      doors: [],
      obstacles: [],
    };
    await worlds().doc(worldId).collection('battleMaps').doc(yard.id).set(yard);
    await worlds()
      .doc(worldId)
      .collection('locations')
      .doc(fort)
      .update({ battleMap: { mapId: yard.id } });
    await worlds()
      .doc(worldId)
      .update({ canonVersion: FieldValue.increment(1) });
    const placed = await ok('place_figures', {
      worldId,
      mapId: yard.id,
      figures: [
        {
          id: 'watch',
          name: 'Watchman',
          statBlock: 'gate-guard',
          overrides: { attributes: { STR: 17 } },
          side: 'hostile',
          cells: [{ x: 3, y: 2 }],
        },
      ],
    });
    expect(placed.figures[0]).toMatchObject({ statBlock: 'gate-guard' });
    // Unknown names are refused.
    expect(
      await refused('place_figures', {
        worldId,
        mapId: yard.id,
        figures: [{ id: 'x', name: 'X', statBlock: 'knight', cells: [{ x: 4, y: 2 }] }],
      })
    ).toMatch(/figures\[0\]\.statBlock: no stat block "knight"/);

    // As the Loom loads it: the figure's sheet is the block's, with its override.
    const world = await loaded(worldId);
    const system = BUILT_IN['d20-fantasy'];
    const sheet = sheets.defaultSheet(system);
    for (const r of system.sheet.resources) sheet.resources[r.id] = { current: 500 };
    let save = {
      location: fort,
      mapId: yard.id,
      cell: { x: 2, y: 2 },
      time: 1000,
      turn: { n: 1, ap: 40, kept: 0, plan: null },
      character: { name: 'Tam', sheet },
    };
    const seen = combat.figures.withFigures(world, save);
    expect(seen.characters['fig-watch'].sheet).toMatchObject({
      attributes: { STR: 17, DEX: 12 },
      skills: { Perception: 2 },
    });
    // In a fight, it strikes with the block's pike.
    const high = (sides) => sides;
    const begun = evaluate({ verb: 'fight', targets: [], params: {} }, {}, save, high, seen);
    save = JSON.parse(JSON.stringify(save));
    applyStateMutations(
      save,
      begun.mutations.filter((m) => m.target === 'save')
    );
    const lines = begun.constraints.slice();
    if (save.fight && save.fight.turn === 'player') {
      const round = evaluate(
        { verb: 'end-turn', targets: [], params: {} },
        {},
        save,
        high,
        combat.figures.withFigures(world, save)
      );
      lines.push(...round.constraints);
    }
    expect(lines.join(' ')).toMatch(/Watchman (hits|misses) you with their pike/);
  });
});
