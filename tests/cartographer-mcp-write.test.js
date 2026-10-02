'use strict';

/**
 * The Cartographer's MCP connector, write side (C-7 / #374), driven by a real
 * MCP client through /mcp/cartographer against Nisia imported into the
 * Firestore emulator — and, for the Initiative 2 exit criterion, played
 * through the Loom's own callables with Gemini mocked.
 *
 * Covers the integrity rules every edit keeps (ids exist, names unique,
 * connections and relations symmetric, casts in step with homes), soft
 * retirement in published worlds and clean deletion in drafts, serialized
 * concurrent edits, auditing, and that a fix reaches a game on its next turn
 * without breaking a save that stands in a retired place.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest cartographer-mcp-write --verbose"
 */

const PROJECT = 'demo-cartographer-write';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-cartographer-write';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
const { loomCreateSave, loomPlayTurn } = require('../functions/index');

const fs = require('fs');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { loadDraftWorld } = require('../functions/cartographer/load');
const loomCanon = require('../functions/loom-canon');
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
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

const db = getFirestore();
const worlds = () => db.collection('loom_worlds');
const parsed = parseAzgaarExport(
  fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
);

const registry = createRegistry();
registry.registerApp(
  'cartographer',
  cartographerApp({
    reader: createFirestoreWorldReader(() => db),
    writer: createFirestoreWorldWriter(() => db),
  })
);
const oauthStore = createInMemoryStore();
const audit = createInMemoryAuditLog();

let server;
let client;
let seq = 0;

// ── Helpers ────────────────────────────────────────────────────────────

async function call(name, args) {
  return client.callTool({ name, arguments: args });
}

async function ok(name, args) {
  const result = await call(name, args);
  if (result.isError) throw new Error(`${name} failed: ${result.content[0].text}`);
  return result.structuredContent;
}

async function refused(name, args) {
  const result = await call(name, args);
  expect(result.isError).toBe(true);
  return result.content[0].text;
}

// A fresh import of Nisia as a draft; optionally published with Burdendal
// (loc_1) as the start.
async function freshWorld({ published = false } = {}) {
  seq += 1;
  const worldId = `nisia-${String(seq).padStart(6, '0')}`;
  await loadDraftWorld({
    db,
    mapped: mapToCanon(parsed),
    source: parsed.source,
    uploadedBy: BUILDER,
    worldId,
  });
  if (published) {
    await worlds()
      .doc(worldId)
      .update({
        status: 'published',
        openingHook: 'A storm drives your ship ashore at Burdendal.',
        rules: { startingLocationId: 'loc_1' },
        canonVersion: 2,
      });
  }
  return worldId;
}

const raw = async (worldId, collection, id) =>
  (await worlds().doc(worldId).collection(collection).doc(id).get()).data();
const version = async (worldId) => (await worlds().doc(worldId).get()).data().canonVersion;
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
  client = new Client({ name: 'cartographer-write-test', version: '0.0.0' });
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
  await db.recursiveDelete(db.collection('loom_saves'));
  functionsTest.cleanup();
});

// ── Tool surface ───────────────────────────────────────────────────────

test('exposes the write tools with honest hints', async () => {
  const { tools } = await client.listTools();
  const writes = tools.filter((t) => !t.annotations.readOnlyHint);
  expect(writes.map((t) => t.name).sort()).toEqual([
    'add_character',
    'add_lore',
    'add_place',
    'assign_battle_map',
    'connect_locations',
    'connect_places',
    'disconnect_locations',
    'disconnect_places',
    'publish_world',
    'retire_entity',
    'set_art',
    'set_battle_map',
    'update_character',
    'update_faction',
    'update_location',
    'update_lore',
    'update_place',
    'update_region',
    'update_world',
  ]);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  expect(byName.retire_entity.annotations.destructiveHint).toBe(true);
  expect(byName.disconnect_locations.annotations.destructiveHint).toBe(true);
  expect(byName.add_lore.annotations.destructiveHint).toBe(false);
});

// ── update_world ───────────────────────────────────────────────────────

describe('update_world', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('sets the hook, tagline and start, making the draft ready to publish', async () => {
    const result = await ok('update_world', {
      worldId,
      openingHook: 'A storm drives your ship ashore.',
      tagline: 'Twenty-three realms, one coastline.',
      startingLocationId: 'loc_1',
    });
    expect(result).toMatchObject({
      worldId,
      canonVersion: 2,
      changed: true,
      updated: ['tagline', 'openingHook', 'startingLocationId'],
      world: { startingLocation: { id: 'loc_1', name: 'Burdendal' } },
      warnings: [
        "The start isn't open to players yet (Burdendal: it has no town layout; its " +
          'description is still the imported text). Open it before publishing; get_location ' +
          'lists what it needs.',
      ],
    });
    const doc = (await worlds().doc(worldId).get()).data();
    expect(doc).toMatchObject({
      openingHook: 'A storm drives your ship ashore.',
      tagline: 'Twenty-three realms, one coastline.',
      rules: { startingLocationId: 'loc_1' },
      canonVersion: 2,
      updatedBy: BUILDER,
    });
    // Not ready until the start is open: written up, with its town laid out.
    const notReady = {
      readyToPublish: false,
      missing: ['a starting location players can enter (get_location lists what it needs)'],
    };
    expect(await ok('get_world', { worldId })).toMatchObject(notReady);
    await ok('update_location', { worldId, locationId: 'loc_1', description: 'Slate and rain.' });
    expect(await ok('get_world', { worldId })).toMatchObject(notReady);
    await ok('add_place', {
      worldId,
      locationId: 'loc_1',
      name: 'The Harbour',
      kind: 'harbour',
      description: 'Slate quays and tarred rope.',
      entranceFor: ['sea', 'trail'],
    });
    expect((await ok('get_world', { worldId })).readyToPublish).toBe(true);
  });

  test('an unchanged value commits nothing and keeps the version', async () => {
    const before = await version(worldId);
    const result = await ok('update_world', { worldId, startingLocationId: 'loc_1' });
    expect(result).toMatchObject({ changed: false, updated: [], canonVersion: before });
    expect(await version(worldId)).toBe(before);
  });

  test('refuses an unknown start, an empty change, or an empty hook', async () => {
    expect(await refused('update_world', { worldId, startingLocationId: 'loc_0' })).toMatch(
      /No location "loc_0"/
    );
    expect(await refused('update_world', { worldId })).toMatch(/Nothing to change/);
    await refused('update_world', { worldId, openingHook: '   ' });
  });
});

// ── Names ──────────────────────────────────────────────────────────────

describe('names stay unique among places, realms and characters', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld({ published: true });
  });

  test('as the Loom matches them — case and punctuation ignored', async () => {
    expect(
      await refused('update_location', { worldId, locationId: 'loc_1', name: 'dunsmouth!' })
    ).toMatch(/location "Dunsmouth" \(loc_631\) already has that name/);
    expect(
      await refused('add_character', {
        worldId,
        name: 'Kingdom of Pendonia',
        description: 'A pretender.',
        locationId: 'loc_1',
      })
    ).toMatch(/faction "Kingdom of Pendonia" \(fac_1\)/);
    expect(
      await refused('update_faction', { worldId, factionId: 'fac_2', name: 'Burdendal' })
    ).toMatch(/loc_1/);
    expect(await refused('update_location', { worldId, locationId: 'loc_1', name: '!!!' })).toMatch(
      /at least one letter or digit/
    );
  });

  test('renaming a thing to a variant of its own name is fine', async () => {
    await ok('update_location', { worldId, locationId: 'loc_1', name: 'BURDENDAL' });
    expect((await raw(worldId, 'locations', 'loc_1')).name).toBe('BURDENDAL');
    await ok('update_location', { worldId, locationId: 'loc_1', name: 'Burdendal' });
  });

  test('a retired thing’s name can be reused, with a fresh id', async () => {
    const first = await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Harbourmaster.',
      locationId: 'loc_1',
    });
    expect(first.character.id).toBe('chr_mara-quill');
    await ok('retire_entity', { worldId, type: 'character', id: 'chr_mara-quill' });
    const second = await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Her daughter, harbourmaster now.',
      locationId: 'loc_1',
    });
    expect(second.character.id).toBe('chr_mara-quill-2');
  });
});

// ── Places ─────────────────────────────────────────────────────────────

describe('update_location', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('changes description, realms present and rules; null removes a rule', async () => {
    await ok('update_location', {
      worldId,
      locationId: 'loc_1',
      description: 'A rain-soaked port of slate roofs.',
      factionIds: ['fac_1', 'fac_16'],
      rules: { requiresAbility: 'harbour-pass', hostileToFactionId: 'fac_13' },
    });
    expect(await raw(worldId, 'locations', 'loc_1')).toMatchObject({
      description: 'A rain-soaked port of slate roofs.',
      factionIds: ['fac_1', 'fac_16'],
      rules: { requiresAbility: 'harbour-pass', hostileToFactionId: 'fac_13' },
    });
    await ok('update_location', { worldId, locationId: 'loc_1', rules: { requiresAbility: null } });
    expect((await raw(worldId, 'locations', 'loc_1')).rules).toEqual({
      hostileToFactionId: 'fac_13',
    });
  });

  test('refuses unknown realms and unknown rule keys', async () => {
    expect(
      await refused('update_location', { worldId, locationId: 'loc_1', factionIds: ['fac_99'] })
    ).toMatch(/No faction "fac_99"/);
    await refused('update_location', { worldId, locationId: 'loc_1', rules: { magic: true } });
  });
});

describe('descriptions written over MCP are stamped as written (L-321)', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('imports arrive stamped as import; a new description is stamped mcp', async () => {
    expect((await raw(worldId, 'locations', 'loc_1')).sources).toEqual({ description: 'import' });
    await ok('update_location', { worldId, locationId: 'loc_1', description: 'Slate and rain.' });
    expect(await raw(worldId, 'locations', 'loc_1')).toMatchObject({
      description: 'Slate and rain.',
      sources: { description: 'mcp' },
    });
  });

  test('re-sending the imported text approves it, once', async () => {
    const { description } = await raw(worldId, 'locations', 'loc_631');
    const before = await version(worldId);
    const first = await ok('update_location', { worldId, locationId: 'loc_631', description });
    expect(first).toMatchObject({ changed: true, updated: ['description'] });
    expect(await raw(worldId, 'locations', 'loc_631')).toMatchObject({
      description,
      sources: { description: 'mcp' },
    });
    expect(await version(worldId)).toBe(before + 1);
    const again = await ok('update_location', { worldId, locationId: 'loc_631', description });
    expect(again).toMatchObject({ changed: false, updated: [] });
  });

  test('other edits leave the stamp alone', async () => {
    await ok('update_location', { worldId, locationId: 'loc_24', name: 'Hitchel Harbour' });
    expect((await raw(worldId, 'locations', 'loc_24')).sources).toEqual({ description: 'import' });
  });

  test('realms and characters are stamped the same way', async () => {
    await ok('update_faction', { worldId, factionId: 'fac_1', description: 'An old kingdom.' });
    expect((await raw(worldId, 'factions', 'fac_1')).sources).toEqual({ description: 'mcp' });
    await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Harbourmaster.',
      locationId: 'loc_1',
    });
    expect((await raw(worldId, 'characters', 'chr_mara-quill')).sources).toEqual({
      description: 'mcp',
    });
  });
});

describe('connections stay symmetric', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld({ published: true });
  });

  test('connect links both ends the same way; connecting again changes how', async () => {
    await ok('connect_locations', { worldId, fromId: 'loc_1', toId: 'loc_24', via: 'sea' });
    const [a, b] = [
      await raw(worldId, 'locations', 'loc_1'),
      await raw(worldId, 'locations', 'loc_24'),
    ];
    expect(a.connections).toContain('loc_24');
    expect(b.connections).toContain('loc_1');
    expect([a.geo.links.loc_24, b.geo.links.loc_1]).toEqual(['sea', 'sea']);

    await ok('connect_locations', { worldId, fromId: 'loc_24', toId: 'loc_1', via: 'road' });
    expect((await raw(worldId, 'locations', 'loc_1')).geo.links.loc_24).toBe('road');
    expect((await raw(worldId, 'locations', 'loc_24')).geo.links.loc_1).toBe('road');

    const place = await ok('get_location', { worldId, locationId: 'loc_1' });
    expect(place.connections).toContainEqual(
      expect.objectContaining({ id: 'loc_24', via: 'road' })
    );
  });

  test('disconnect removes both ends; an absent link commits nothing', async () => {
    await ok('disconnect_locations', { worldId, fromId: 'loc_1', toId: 'loc_24' });
    const [a, b] = [
      await raw(worldId, 'locations', 'loc_1'),
      await raw(worldId, 'locations', 'loc_24'),
    ];
    expect(a.connections).not.toContain('loc_24');
    expect(b.connections).not.toContain('loc_1');
    expect(a.geo.links).not.toHaveProperty('loc_24');
    expect(b.geo.links).not.toHaveProperty('loc_1');

    const before = await version(worldId);
    const again = await ok('disconnect_locations', { worldId, fromId: 'loc_1', toId: 'loc_24' });
    expect(again).toMatchObject({ changed: false, note: expect.stringMatching(/not connected/) });
    expect(await version(worldId)).toBe(before);
  });

  test('warns when a disconnect cuts places off from the start', async () => {
    const world = await loaded(worldId);
    const leaf = Object.values(world.locations).find(
      (l) => !l.retired && l.id !== 'loc_1' && l.connections.length === 1
    );
    const [neighbour] = leaf.connections;
    const result = await ok('disconnect_locations', { worldId, fromId: neighbour, toId: leaf.id });
    expect(result.warnings).toEqual([
      expect.stringMatching(
        new RegExp(`^1 place\\(s\\) can no longer be reached from Burdendal: .*\\(${leaf.id}\\)`)
      ),
    ]);
  });

  test('refuses a place connecting to itself or to a retired place', async () => {
    await refused('connect_locations', { worldId, fromId: 'loc_1', toId: 'loc_1' });
    await ok('retire_entity', { worldId, type: 'location', id: 'poi_2' });
    expect(await refused('connect_locations', { worldId, fromId: 'loc_1', toId: 'poi_2' })).toMatch(
      /has been retired/
    );
  });
});

// ── Realms ─────────────────────────────────────────────────────────────

describe('update_faction', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('relations are set on both realms, vassal mirrored as suzerain', async () => {
    await ok('update_faction', {
      worldId,
      factionId: 'fac_1',
      disposition: 'friendly',
      relations: { fac_2: 'vassal', fac_3: 'ally' },
    });
    const [one, two, three] = await Promise.all(
      ['fac_1', 'fac_2', 'fac_3'].map((id) => raw(worldId, 'factions', id))
    );
    expect(one.disposition).toBe('friendly');
    expect(one.politics.relations).toMatchObject({ fac_2: 'vassal', fac_3: 'ally' });
    expect(two.politics.relations.fac_1).toBe('suzerain');
    expect(three.politics.relations.fac_1).toBe('ally');
    // Untouched relations stay as they were.
    expect(one.politics.relations.fac_13).toBe('rival');
  });

  test('refuses a relation to itself, an unknown realm, or an unknown stance', async () => {
    expect(
      await refused('update_faction', { worldId, factionId: 'fac_1', relations: { fac_1: 'ally' } })
    ).toMatch(/no relation to itself/);
    await refused('update_faction', { worldId, factionId: 'fac_1', relations: { fac_99: 'ally' } });
    await refused('update_faction', {
      worldId,
      factionId: 'fac_1',
      relations: { fac_2: 'besties' },
    });
  });
});

// ── Characters and lore ────────────────────────────────────────────────

describe('characters', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('a new character is found at their home: the cast list follows them', async () => {
    const { character } = await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Harbourmaster of Burdendal.',
      locationId: 'loc_1',
      factionId: 'fac_1',
    });
    expect(character).toEqual({
      id: 'chr_mara-quill',
      name: 'Mara Quill',
      location: { id: 'loc_1', name: 'Burdendal' },
      faction: { id: 'fac_1', name: 'Kingdom of Pendonia' },
    });
    expect((await raw(worldId, 'locations', 'loc_1')).npcIds).toEqual(['chr_mara-quill']);

    await ok('update_character', {
      worldId,
      characterId: 'chr_mara-quill',
      locationId: 'loc_631',
      factionId: null,
    });
    expect((await raw(worldId, 'locations', 'loc_1')).npcIds).toEqual([]);
    expect((await raw(worldId, 'locations', 'loc_631')).npcIds).toEqual(['chr_mara-quill']);
    const stored = await raw(worldId, 'characters', 'chr_mara-quill');
    expect(stored.locationId).toBe('loc_631');
    expect(stored).not.toHaveProperty('factionId');
    const place = await ok('get_location', { worldId, locationId: 'loc_631' });
    expect(place.characters).toEqual([{ id: 'chr_mara-quill', name: 'Mara Quill' }]);
  });

  test('refuses an unknown home', async () => {
    expect(
      await refused('add_character', {
        worldId,
        name: 'Nobody',
        description: 'Lost.',
        locationId: 'loc_0',
      })
    ).toMatch(/No location/);
  });
});

describe('lore', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
  });

  test('is about places, realms, regions and characters that exist', async () => {
    const { lore } = await ok('add_lore', {
      worldId,
      title: 'The Founding of Burdendal',
      text: 'Raised on the wreck of the first fleet.',
      about: ['loc_1', 'fac_1', 'reg_1', 'loc_1'],
    });
    expect(lore).toEqual({
      id: 'lore_the-founding-of-burdendal',
      title: 'The Founding of Burdendal',
      about: [
        { id: 'loc_1', type: 'location', name: 'Burdendal' },
        { id: 'fac_1', type: 'faction', name: 'Kingdom of Pendonia' },
        { id: 'reg_1', type: 'region', name: 'Burdendal County' },
      ],
    });
    await ok('update_lore', { worldId, loreId: lore.id, about: ['loc_631'], text: 'Rewritten.' });
    expect(await raw(worldId, 'lore', lore.id)).toMatchObject({
      text: 'Rewritten.',
      entityRefs: ['loc_631'],
    });
    expect(await refused('add_lore', { worldId, title: 'x', text: 'y', about: ['loc_0'] })).toMatch(
      /No place, realm, region or character "loc_0"/
    );
    await refused('add_lore', { worldId, title: 'x', text: 'y', about: [] });
  });
});

// ── Removal ────────────────────────────────────────────────────────────

describe('retire_entity in a published world is soft', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld({ published: true });
  });

  test('a retired place stays, hidden from travel; its links are kept', async () => {
    const neighbour = (await raw(worldId, 'locations', 'loc_631')).connections;
    const result = await ok('retire_entity', { worldId, type: 'location', id: 'loc_631' });
    expect(result.retired).toEqual({ type: 'location', id: 'loc_631', name: 'Dunsmouth' });
    expect(await raw(worldId, 'locations', 'loc_631')).toMatchObject({
      retired: true,
      connections: neighbour,
    });
    expect((await raw(worldId, 'locations', 'loc_1')).connections).toContain('loc_631');
    const play = await loomCanon.loadWorld(worldId, { db });
    expect(play.locations.loc_631.retired).toBe(true);
    expect(play.locations.loc_1.connections).not.toContain('loc_631');

    expect(await ok('retire_entity', { worldId, type: 'location', id: 'loc_631' })).toMatchObject({
      changed: false,
      note: 'Already retired.',
    });
  });

  test('the starting location can’t be retired', async () => {
    expect(await refused('retire_entity', { worldId, type: 'location', id: 'loc_1' })).toMatch(
      /where new games begin/
    );
  });
});

describe('retire_entity in a draft deletes, with every reference', () => {
  let worldId;
  beforeAll(async () => {
    worldId = await freshWorld();
    await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Harbourmaster.',
      locationId: 'loc_631',
      factionId: 'fac_1',
    });
    await ok('add_lore', {
      worldId,
      title: 'Dunsmouth Tales',
      text: 'Fish.',
      about: ['loc_631', 'fac_1', 'chr_mara-quill'],
    });
  });

  const where = async (collection, field, op, value) =>
    (await worlds().doc(worldId).collection(collection).where(field, op, value).get()).docs.map(
      (d) => d.id
    );

  test('a place with residents must be emptied first', async () => {
    expect(await refused('retire_entity', { worldId, type: 'location', id: 'loc_631' })).toMatch(
      /Characters live here: Mara Quill \(chr_mara-quill\)/
    );
  });

  test('deleting a character clears it from casts and lore', async () => {
    await ok('retire_entity', { worldId, type: 'character', id: 'chr_mara-quill' });
    expect(await raw(worldId, 'characters', 'chr_mara-quill')).toBeUndefined();
    expect(await where('locations', 'npcIds', 'array-contains', 'chr_mara-quill')).toEqual([]);
    expect((await raw(worldId, 'lore', 'lore_dunsmouth-tales')).entityRefs).toEqual([
      'loc_631',
      'fac_1',
    ]);
  });

  test('deleting a place clears links, regions, capitals and lore', async () => {
    const result = await ok('retire_entity', { worldId, type: 'location', id: 'loc_631' });
    expect(result).toMatchObject({ deleted: { id: 'loc_631', name: 'Dunsmouth' } });
    expect(await raw(worldId, 'locations', 'loc_631')).toBeUndefined();
    expect(await where('locations', 'connections', 'array-contains', 'loc_631')).toEqual([]);
    expect((await raw(worldId, 'locations', 'loc_1')).geo.links).not.toHaveProperty('loc_631');
    expect(await where('regions', 'locationIds', 'array-contains', 'loc_631')).toEqual([]);
    expect((await raw(worldId, 'lore', 'lore_dunsmouth-tales')).entityRefs).toEqual(['fac_1']);
  });

  test('deleting a realm clears it from places, regions and every other realm', async () => {
    const result = await ok('retire_entity', { worldId, type: 'faction', id: 'fac_1' });
    expect(result.referencesCleaned).toBeGreaterThan(60);
    expect(await raw(worldId, 'factions', 'fac_1')).toBeUndefined();
    expect(await where('locations', 'factionIds', 'array-contains', 'fac_1')).toEqual([]);
    expect(await where('regions', 'factionId', '==', 'fac_1')).toEqual([]);
    const others = (await worlds().doc(worldId).collection('factions').get()).docs;
    expect(others.filter((d) => d.data().politics.relations.fac_1)).toEqual([]);
    expect((await raw(worldId, 'lore', 'lore_dunsmouth-tales')).entityRefs).toEqual([]);
    // The world still loads and reads cleanly.
    const overview = await ok('get_world', { worldId });
    expect(overview.counts.factions).toBe(22);
  });
});

// ── Concurrency, lifecycle, refusals, audit ────────────────────────────

describe('edits to one world are serialized', () => {
  test('parallel edits all land, each bumping the version once', async () => {
    const worldId = await freshWorld();
    const before = await version(worldId);
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        ok('add_lore', { worldId, title: `Tale ${n}`, text: `Tale number ${n}.`, about: ['loc_1'] })
      )
    );
    expect(new Set(results.map((r) => r.canonVersion)).size).toBe(4);
    expect(await version(worldId)).toBe(before + 4);
    expect((await worlds().doc(worldId).collection('lore').get()).size).toBe(4);
  });

  test('two parallel characters with one name: exactly one is created', async () => {
    const worldId = await freshWorld();
    const attempt = () =>
      call('add_character', {
        worldId,
        name: 'Twin',
        description: 'One of two.',
        locationId: 'loc_1',
      });
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.filter((r) => !r.isError)).toHaveLength(1);
    expect(results.find((r) => r.isError).content[0].text).toMatch(/already has that name/);
    expect((await worlds().doc(worldId).collection('characters').get()).size).toBe(1);
  });
});

describe('publish_world', () => {
  test('publishes a draft once it has a hook and a start', async () => {
    const worldId = await freshWorld();
    expect(await refused('publish_world', { worldId })).toMatch(
      /Not ready to publish.*opening hook.*starting location/
    );
    await ok('update_world', {
      worldId,
      openingHook: 'A storm.',
      startingLocationId: 'loc_1',
    });
    expect(await refused('publish_world', { worldId })).toMatch(
      /a starting location players can enter \(Burdendal: it has no town layout; its description is still the imported text\)/
    );
    await ok('update_location', { worldId, locationId: 'loc_1', description: 'Slate and rain.' });
    // Written up, but a settlement needs its town too.
    expect(await refused('publish_world', { worldId })).toMatch(
      /players can enter \(Burdendal: it has no town layout\)/
    );
    // A settlement also needs its town: one way in and out will do.
    await ok('add_place', {
      worldId,
      locationId: 'loc_1',
      name: 'The Harbour',
      kind: 'harbour',
      description: 'Slate quays and tarred rope.',
      entranceFor: ['sea', 'trail'],
    });
    expect(await ok('publish_world', { worldId })).toMatchObject({ worldId, status: 'published' });
    expect((await worlds().doc(worldId).get()).data()).toMatchObject({
      status: 'published',
      publishedBy: BUILDER,
    });
    expect(await refused('publish_world', { worldId })).toMatch(/Only a draft can be published/);
  });
});

describe('worlds that can’t be edited', () => {
  test('unknown, importing and failed worlds are refused', async () => {
    await worlds().doc('half-built-aaaaaa').set({ id: 'half-built-aaaaaa', status: 'importing' });
    await worlds().doc('broken-bbbbbb').set({ id: 'broken-bbbbbb', status: 'failed' });
    const edit = (worldId) => refused('update_world', { worldId, tagline: 'x' });
    expect(await edit('nowhere-000000')).toMatch(/World not found/);
    expect(await edit('half-built-aaaaaa')).toMatch(/still importing/);
    expect(await edit('broken-bbbbbb')).toMatch(/can't be edited \(status: failed\)/);
  });
});

test('every write is audited as a tool_call, without its arguments', async () => {
  const calls = audit.events('tool_call');
  expect(calls.length).toBeGreaterThan(0);
  const adds = calls.filter((e) => e.tool === 'add_lore');
  expect(adds.map((e) => e.outcome)).toEqual(expect.arrayContaining(['ok', 'tool_error']));
  for (const entry of calls) {
    expect(entry).toMatchObject({ uid: BUILDER, appId: 'cartographer' });
    expect(JSON.stringify(entry)).not.toMatch(/Tale number|Harbourmaster/);
  }
});

// ── Initiative 2 exit criterion ────────────────────────────────────────

describe('exit criterion: build with Claude, play, fix, keep playing', () => {
  const narratorPrompts = [];

  beforeAll(() => {
    mockCallGemini.mockImplementation(async (options) => {
      if (options.systemInstruction.includes('INTERPRET stage')) {
        return { verb: 'look', targets: [], params: {} };
      }
      if (options.systemInstruction.includes('summarizer')) return 'A summary.';
      narratorPrompts.push(options.userMessage);
      return { narration: 'You take in the harbour.', inventedEntities: [], suggestedActions: [] };
    });
  });

  const turn = (worldId, saveId) =>
    loomPlayTurn.run({ data: { worldId, saveId, actionText: 'look around' }, auth: PLAYER });

  test('a draft built over MCP is published, played, fixed mid-game, and keeps working', async () => {
    const worldId = await freshWorld();

    // Build it with Claude.
    await ok('update_world', {
      worldId,
      openingHook: 'A storm drives your ship ashore at Burdendal.',
      startingLocationId: 'loc_1',
    });
    await ok('add_character', {
      worldId,
      name: 'Mara Quill',
      description: 'Harbourmaster of Burdendal, weathered and wary.',
      locationId: 'loc_1',
    });
    await ok('add_lore', {
      worldId,
      title: 'The Quill Ledger',
      text: 'Mara keeps a ledger of every ship lost on the bar.',
      about: ['chr_mara-quill'],
    });
    await ok('update_location', {
      worldId,
      locationId: 'loc_1',
      description: 'A rain-soaked port of slate roofs and tarred rope.',
    });
    // A settlement also needs its town: one way in and out will do.
    await ok('add_place', {
      worldId,
      locationId: 'loc_1',
      name: 'The Harbour',
      kind: 'harbour',
      description: 'Slate quays and tarred rope.',
      entranceFor: ['sea', 'trail'],
    });
    await ok('publish_world', { worldId });

    // Play it.
    const { saveId } = await loomCreateSave.run({
      data: { worldId, name: 'First voyage', characterName: 'Tam' },
      auth: PLAYER,
    });
    await turn(worldId, saveId);
    expect(narratorPrompts.at(-1)).toContain('Mara Quill — Harbourmaster of Burdendal');
    expect(narratorPrompts.at(-1)).toContain('Mara keeps a ledger of every ship lost on the bar.');

    // A fix over MCP appears on the game's very next turn.
    await ok('update_character', {
      worldId,
      characterId: 'chr_mara-quill',
      description: 'Harbourmaster of Burdendal, and secretly a smuggler.',
    });
    await turn(worldId, saveId);
    expect(narratorPrompts.at(-1)).toContain('and secretly a smuggler');
    expect(narratorPrompts.at(-1)).not.toContain('weathered and wary');

    // Retiring the place a save stands in never breaks that save.
    await db.collection('loom_saves').doc(saveId).update({ location: 'loc_631' });
    await ok('retire_entity', { worldId, type: 'location', id: 'loc_631' });
    await expect(turn(worldId, saveId)).resolves.toMatchObject({
      narration: expect.any(String),
    });
    expect((await db.collection('loom_saves').doc(saveId).get()).data().location).toBe('loc_631');
  });
});
