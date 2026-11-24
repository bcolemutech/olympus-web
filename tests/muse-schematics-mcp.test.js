'use strict';

/**
 * Schematics over the Muse connector (planning/the-muse.md §3 SC1–SC9, D7,
 * D9, D10; M-202 / #915), driven by a real MCP client through /mcp/muse
 * against the Firestore emulator: a location's floor plan added, points set
 * linking to rooms by name, `get_schematic` returning the picture with its
 * numbered pins and a grid, the linked room's `get_element` and `lookup`
 * listing where it is marked, and a version by `mcp` kept before `set_point`;
 * order, picture and renaming; removing points and schematics; and what is
 * refused.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-schematics-mcp --verbose"
 */

const PROJECT = 'demo-muse-schematics-mcp';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-muse-schematics';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

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
const { initializeApp, getApps } = require(
  require.resolve('firebase-admin/app', { paths: [functionsDir] })
);
if (!getApps().length) initializeApp({ projectId: PROJECT });
const sharp = require(require.resolve('sharp', { paths: [functionsDir] }));
const { createMuseStore, studioImages } = require('../functions/muse/store');
const { museApp } = require('../functions/mcp/apps/muse');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

jest.setTimeout(30000);

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/muse`;
const IMG = 'img_0123456789abcdef';
const IMG2 = 'img_fedcba9876543210';

const db = getFirestore();
let plan; // the studio's picture: a 800 × 600 PNG, made in beforeAll

// The studio, faked: what the studio tools call, recorded.
const started = [];
const studio = {
  library: () => ({
    getImage: async (id) => ({
      id,
      title: 'x',
      versions: [{ n: 1, path: `studio/${id}/v1.png`, format: 'png' }],
      current: 1,
    }),
    search: async () => ({ images: [], total: 0 }),
    labels: async () => [],
  }),
  costs: () => ({
    line: async () => ({ thisCall: 0, month: 0, warning: null }),
    totals: async () => ({ total: 0 }),
  }),
  jobs: () => ({
    start: async (uid, args, via) => {
      started.push({ uid, args, via });
      return { id: 'job_0123456789abcdef', state: 'queued', request: args, createdBy: uid, via };
    },
    list: async () => [],
  }),
  styles: () => ({ list: async () => [], get: async () => null, set: async () => null }),
  load: async () => plan,
};

const registry = createRegistry();
registry.registerApp(
  'muse',
  museApp({ store: createMuseStore({ db, FieldValue, images: studioImages(db) }), studio })
);

const oauthStore = createInMemoryStore();
function tokenFor(uid, { scope = 'mcp:muse', audience = AUD } = {}) {
  const grantId = `grant-${uid}-${scope}`;
  oauthStore._debug.grants.set(grantId, { grantId, uid, appId: 'muse', revoked: false });
  return signAccessToken({ uid, audience, scope, issuer: CANONICAL, grantId });
}

let server;
let base;
let ann;
let bob;

async function connect(uid) {
  const client = new Client({ name: 'muse-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp/muse`), {
      requestInit: { headers: { Authorization: `Bearer ${tokenFor(uid)}` } },
    })
  );
  return client;
}

// A tool's result as data; a tool error throws with its message.
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((c) => c.type === 'text').text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

beforeAll(async () => {
  plan = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#2b4a66' } })
    .png()
    .toBuffer();
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
  base = `http://127.0.0.1:${server.address().port}`;
  ann = await connect('ann');
  bob = await connect('bob');
});

afterAll(async () => {
  await ann.close();
  await bob.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(db.collection('muse_projects'));
  await db.recursiveDelete(db.collection('studio_images'));
});

beforeEach(async () => {
  started.length = 0;
  await db.recursiveDelete(db.collection('muse_projects'));
  await db.recursiveDelete(db.collection('studio_images'));
  for (const [id, title] of [
    [IMG, 'The Keep, ground floor'],
    [IMG2, 'The Keep, upper floor'],
  ]) {
    await db.doc(`studio_images/${id}`).set({
      id,
      title,
      kind: 'schematic',
      link: `https://example.com/${id}.png`,
    });
  }
});

const doc = async (p) => (await db.doc(p).get()).data();
const versionsOf = async (projectId, of) =>
  (await db.collection(`muse_projects/${projectId}/versions`).where('of', '==', of).get()).docs.map(
    (d) => d.data()
  );

// A keep with two rooms, a chest and a captain, and a floor plan of the keep.
async function keep() {
  const { id: pid } = await call(ann, 'create_project', { title: 'The Keep' });
  const make = async (type, name) =>
    (await call(ann, 'create_element', { projectId: pid, type, name })).id;
  const ids = {
    keep: await make('location', 'The Keep'),
    hall: await make('location', 'Great Hall'),
    armoury: await make('location', 'Armoury'),
    chest: await make('object', 'Iron chest'),
    vey: await make('character', 'Captain Vey'),
  };
  const { schematic } = await call(ann, 'add_schematic', {
    projectId: pid,
    elementId: ids.keep,
    name: 'Ground floor',
    imageId: IMG,
  });
  return { pid, ids, sc: schematic.id };
}

// The picture of a result, as pixels: [r, g, b] at a fraction of it.
async function pixels(result) {
  const image = result.content.find((c) => c.type === 'image');
  const { data, info } = await sharp(Buffer.from(image.data, 'base64'))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    mimeType: image.mimeType,
    width: info.width,
    height: info.height,
    at: (fx, fy) => {
      const i =
        (Math.round(fy * (info.height - 1)) * info.width + Math.round(fx * (info.width - 1))) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    },
  };
}

describe('the tools', () => {
  test('are listed, with their inputs described', async () => {
    const { tools } = await ann.listTools();
    const names = tools.map((t) => t.name);
    for (const name of [
      'list_schematics',
      'get_schematic',
      'add_schematic',
      'update_schematic',
      'remove_schematic',
      'set_point',
      'remove_point',
    ]) {
      expect(names).toContain(name);
    }
    const setPoint = tools.find((t) => t.name === 'set_point');
    expect(setPoint.inputSchema.properties.x.description).toMatch(/grid of tenths/);
    expect(tools.find((t) => t.name === 'get_schematic').annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'remove_schematic').annotations.destructiveHint).toBe(true);
    // The studio can make a schematic: its kind is one of the library's.
    const generate = tools.find((t) => t.name === 'studio_generate');
    expect(JSON.stringify(generate.inputSchema)).toContain('schematic');
  });
});

describe('a floor plan', () => {
  test('added to a location, points set linking to rooms, looked at with its pins drawn', async () => {
    const { pid, ids, sc } = await keep();
    expect(await doc(`muse_projects/${pid}/schematics/${sc}`)).toMatchObject({
      element: ids.keep,
      name: 'Ground floor',
      order: 0,
      image: IMG,
      points: [],
      links: [],
    });

    // By name: the Great Hall, and the Armoury by its id.
    const first = await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Hall door',
      description: 'Oak, iron-bound.',
      x: 0.25,
      y: 0.5,
      link: 'Great Hall',
    });
    expect(first.schematic.points).toEqual([
      expect.objectContaining({
        number: 1,
        id: 'p1',
        name: 'Hall door',
        x: 0.25,
        y: 0.5,
        link: { id: ids.hall, name: 'Great Hall' },
      }),
    ]);
    expect(first.schematic.points[0].page).toContain(`/e/${ids.keep}/m/${sc}/p1`);
    await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Armoury door',
      x: 0.75,
      y: 0.8,
      link: ids.armoury,
    });
    expect((await doc(`muse_projects/${pid}/schematics/${sc}`)).links).toEqual([
      ids.hall,
      ids.armoury,
    ]);

    // The picture comes back with the pins, and the JSON beside it.
    const seen = await ann.callTool({
      name: 'get_schematic',
      arguments: { projectId: pid, schematicId: sc },
    });
    const body = JSON.parse(seen.content.find((c) => c.type === 'text').text);
    expect(body).toMatchObject({
      name: 'Ground floor',
      element: { id: ids.keep, name: 'The Keep' },
      picture: { id: IMG, title: 'The Keep, ground floor' },
    });
    expect(body.points.map((p) => [p.number, p.name])).toEqual([
      [1, 'Hall door'],
      [2, 'Armoury door'],
    ]);
    const view = await pixels(seen);
    expect(view).toMatchObject({ mimeType: 'image/jpeg', width: 800, height: 600 });
    // Amber at each pin; the plain plan away from them.
    for (const [fx, fy] of [
      [0.25, 0.5],
      [0.75, 0.8],
    ]) {
      // A little off the pin's middle, where its number is drawn.
      const [r, , b] = view.at(fx + 0.012, fy);
      expect(r).toBeGreaterThan(200);
      expect(b).toBeLessThan(120);
    }
    const [r2, , b2] = view.at(0.55, 0.65);
    expect(r2).toBeLessThan(120);
    expect(b2).toBeGreaterThan(70);
    // The grid of tenths is drawn on it, and can be left off.
    const lineAt = view.at(0.3, 0.3);
    expect(lineAt[0]).toBeGreaterThan(110);
    const bare = await pixels(
      await ann.callTool({
        name: 'get_schematic',
        arguments: { projectId: pid, schematicId: sc, grid: false },
      })
    );
    expect(bare.at(0.3, 0.3)[0]).toBeLessThan(80);
    expect(structuredOf(seen).points).toHaveLength(2);
  });

  test('the linked room says where it is marked, in get_element and lookup (SC9)', async () => {
    const { pid, ids, sc } = await keep();
    await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Hall door',
      x: 0.25,
      y: 0.5,
      link: ids.hall,
    });
    await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Back door',
      x: 0.3,
      y: 0.9,
      link: ids.hall,
    });
    const element = await call(ann, 'get_element', { projectId: pid, elementId: ids.hall });
    expect(element.markedOn).toEqual([
      {
        schematic: {
          id: sc,
          name: 'Ground floor',
          element: { id: ids.keep, name: 'The Keep' },
        },
        points: [
          { id: 'p1', number: 1, name: 'Hall door' },
          { id: 'p2', number: 2, name: 'Back door' },
        ],
        page: expect.stringContaining(`/e/${ids.keep}/m/${sc}/p1`),
      },
    ]);
    const looked = await call(ann, 'lookup', { projectId: pid, name: 'Great Hall' });
    expect(looked.element.markedOn).toHaveLength(1);
    // The armoury is linked from nowhere.
    const none = await call(ann, 'get_element', { projectId: pid, elementId: ids.armoury });
    expect(none.markedOn).toEqual([]);
  });

  test('a version by mcp is kept before set_point, in the same write (D9)', async () => {
    const { pid, ids, sc } = await keep();
    const of = `muse_projects/${pid}/schematics/${sc}`;
    expect(await versionsOf(pid, of)).toHaveLength(0);
    const done = await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Hall door',
      x: 0.25,
      y: 0.5,
      link: ids.hall,
    });
    expect(done.version).toMatchObject({ dropped: [] });
    let kept = await versionsOf(pid, of);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ by: 'mcp', snapshot: { points: [], links: [] } });
    await call(ann, 'set_point', { projectId: pid, schematicId: sc, point: 'Hall door', x: 0.5 });
    kept = await versionsOf(pid, of);
    expect(kept).toHaveLength(2);
    expect(kept.map((v) => v.snapshot.points.length).sort()).toEqual([0, 1]);
    // A named one by hand.
    const named = await call(ann, 'save_version', {
      projectId: pid,
      schematicId: sc,
      name: 'Before the siege',
    });
    expect(named.version.id).toBeTruthy();
    expect((await versionsOf(pid, of)).find((v) => v.name === 'Before the siege')).toMatchObject({
      by: 'mcp',
      snapshot: { points: [expect.objectContaining({ x: 0.5 })] },
    });
  });
});

describe('points', () => {
  test('changed by id, number or name; moved; relinked; described', async () => {
    const { pid, ids, sc } = await keep();
    const args = { projectId: pid, schematicId: sc };
    await call(ann, 'set_point', { ...args, name: 'Door', x: 0.1, y: 0.1 });
    await call(ann, 'set_point', { ...args, name: 'Stair', x: 0.2, y: 0.2 });
    let r = await call(ann, 'set_point', { ...args, point: 'p1', x: 0.9 });
    expect(r.schematic.points[0]).toMatchObject({ x: 0.9, y: 0.1, name: 'Door' });
    r = await call(ann, 'set_point', { ...args, point: '#2', y: 0.7, description: 'Spiral.' });
    expect(r.schematic.points[1]).toMatchObject({ x: 0.2, y: 0.7, description: 'Spiral.' });
    r = await call(ann, 'set_point', { ...args, point: 'Stair', link: ids.chest });
    expect(r.schematic.points[1].link).toMatchObject({ id: ids.chest, name: 'Iron chest' });
    r = await call(ann, 'set_point', { ...args, point: 'Stair', link: null });
    expect(r.schematic.points[1].link).toBeNull();
    expect((await doc(`muse_projects/${pid}/schematics/${sc}`)).links).toEqual([]);
    r = await call(ann, 'set_point', { ...args, point: 'Stair', name: 'Spiral stair' });
    expect(r.schematic.points[1].name).toBe('Spiral stair');
  });

  test('removed; those after are numbered one less', async () => {
    const { pid, ids, sc } = await keep();
    const args = { projectId: pid, schematicId: sc };
    for (const [name, link] of [
      ['One', ids.hall],
      ['Two', null],
      ['Three', ids.armoury],
    ]) {
      await call(ann, 'set_point', { ...args, name, x: 0.5, y: 0.5, link });
    }
    const r = await call(ann, 'remove_point', { ...args, point: 'One' });
    expect(r.schematic.points.map((p) => [p.number, p.name])).toEqual([
      [1, 'Two'],
      [2, 'Three'],
    ]);
    expect((await doc(`muse_projects/${pid}/schematics/${sc}`)).links).toEqual([ids.armoury]);
    expect((await versionsOf(pid, `muse_projects/${pid}/schematics/${sc}`)).length).toBe(4);
    await expect(call(ann, 'remove_point', { ...args, point: 'One' })).rejects.toThrow(/No point/);
  });

  test('refused: no name or place, a place off the picture, a link to nothing, a second of a name', async () => {
    const { pid, ids, sc } = await keep();
    const args = { projectId: pid, schematicId: sc };
    await expect(call(ann, 'set_point', { ...args, x: 0.5, y: 0.5 })).rejects.toThrow(
      /needs a name/
    );
    await expect(call(ann, 'set_point', { ...args, name: 'A', y: 0.5 })).rejects.toThrow(
      /fraction/
    );
    const bad = await ann.callTool({
      name: 'set_point',
      arguments: { ...args, name: 'A', x: 1.5, y: 0.5 },
    });
    expect(bad.isError).toBe(true);
    await expect(
      call(ann, 'set_point', { ...args, name: 'A', x: 0, y: 0, link: 'Nowhere' })
    ).rejects.toThrow(/element of this project/);
    await call(ann, 'set_point', { ...args, name: 'Door', x: 0, y: 0 });
    await call(ann, 'set_point', { ...args, name: 'Door', x: 1, y: 1 });
    await expect(call(ann, 'set_point', { ...args, point: 'Door', x: 0.5 })).rejects.toThrow(
      /names 2 points/
    );
    await expect(call(ann, 'set_point', { ...args, point: 'p1' })).rejects.toThrow(
      /Say what to change/
    );
    expect((await doc(`muse_projects/${pid}/schematics/${sc}`)).points).toHaveLength(2);
    expect(ids.keep).toBeTruthy();
  });
});

describe('schematics', () => {
  test('listed in order; reordered, renamed and given another picture (SC4)', async () => {
    const { pid, ids, sc } = await keep();
    const upper = (
      await call(ann, 'add_schematic', {
        projectId: pid,
        elementId: ids.keep,
        name: 'Upper floor',
        imageId: IMG2,
      })
    ).schematic;
    const cellars = (
      await call(ann, 'add_schematic', {
        projectId: pid,
        elementId: 'The Keep',
        name: 'Cellars',
        imageId: IMG,
      })
    ).schematic;
    expect(upper.order).toBe(2);
    expect(cellars.order).toBe(3);
    const names = async () =>
      (await call(ann, 'list_schematics', { projectId: pid, elementId: ids.keep })).schematics.map(
        (s) => s.name
      );
    expect(await names()).toEqual(['Ground floor', 'Upper floor', 'Cellars']);

    const moved = await call(ann, 'update_schematic', {
      projectId: pid,
      schematicId: cellars.id,
      position: 1,
    });
    expect(moved.schematic.order).toBe(1);
    expect(await names()).toEqual(['Cellars', 'Ground floor', 'Upper floor']);
    // Named by its name, with the element.
    const renamed = await call(ann, 'update_schematic', {
      projectId: pid,
      elementId: ids.keep,
      schematicId: 'Upper floor',
      name: 'Battlements',
      imageId: IMG,
    });
    expect(renamed.schematic).toMatchObject({ name: 'Battlements', picture: { id: IMG } });
    expect(await names()).toEqual(['Cellars', 'Ground floor', 'Battlements']);
    // A version by mcp was kept before each change.
    expect(await versionsOf(pid, `muse_projects/${pid}/schematics/${upper.id}`)).toHaveLength(1);
    await expect(
      call(ann, 'update_schematic', { projectId: pid, schematicId: sc })
    ).rejects.toThrow(/Say what to change/);
    await expect(
      call(ann, 'update_schematic', {
        projectId: pid,
        schematicId: sc,
        imageId: 'img_0000000000000000',
      })
    ).rejects.toThrow(/No image/);
    // A name without its element isn't found; a name two share isn't guessed.
    await expect(
      call(ann, 'get_schematic', { projectId: pid, schematicId: 'Ground floor' })
    ).rejects.toThrow(/not found/i);
  });

  test('removed, with a version kept and the points gone from the room’s “marked on”', async () => {
    const { pid, ids, sc } = await keep();
    await call(ann, 'set_point', {
      projectId: pid,
      schematicId: sc,
      name: 'Hall door',
      x: 0.2,
      y: 0.2,
      link: ids.hall,
    });
    const done = await call(ann, 'remove_schematic', { projectId: pid, schematicId: sc });
    expect(done).toMatchObject({ removed: sc, name: 'Ground floor', version: { dropped: [] } });
    expect(await doc(`muse_projects/${pid}/schematics/${sc}`)).toBeUndefined();
    const kept = await versionsOf(pid, `muse_projects/${pid}/schematics/${sc}`);
    expect(kept).toHaveLength(2);
    expect(kept.some((v) => v.snapshot.points.length === 1)).toBe(true);
    const hall = await call(ann, 'get_element', { projectId: pid, elementId: ids.hall });
    expect(hall.markedOn).toEqual([]);
    await expect(
      call(ann, 'remove_schematic', { projectId: pid, schematicId: sc })
    ).rejects.toThrow(/not found/i);
  });

  test('only a location or an object has them; the picture must be in the studio', async () => {
    const { pid, ids } = await keep();
    await expect(
      call(ann, 'add_schematic', { projectId: pid, elementId: ids.vey, name: 'Plan', imageId: IMG })
    ).rejects.toThrow(/locations and objects/);
    await expect(
      call(ann, 'add_schematic', {
        projectId: pid,
        elementId: ids.chest,
        name: 'Parts',
        imageId: 'img_0000000000000000',
      })
    ).rejects.toThrow(/No image/);
    const ok = await call(ann, 'add_schematic', {
      projectId: pid,
      elementId: ids.chest,
      name: 'Parts',
      imageId: IMG,
    });
    expect(ok.schematic).toMatchObject({ element: { name: 'Iron chest' }, name: 'Parts' });
    await expect(
      call(ann, 'list_schematics', { projectId: pid, elementId: ids.vey })
    ).rejects.toThrow(/locations and objects/);
    await expect(
      call(ann, 'add_schematic', { projectId: pid, elementId: ids.keep, name: ' ', imageId: IMG })
    ).rejects.toThrow();
  });

  test('a picture gone from the studio is said so, not shown', async () => {
    const { pid, sc } = await keep();
    await db.doc(`studio_images/${IMG}`).delete();
    const seen = await ann.callTool({
      name: 'get_schematic',
      arguments: { projectId: pid, schematicId: sc },
    });
    expect(seen.content.some((c) => c.type === 'image')).toBe(false);
    const body = JSON.parse(seen.content.find((c) => c.type === 'text').text);
    expect(body.view).toMatch(/no longer in the studio/);
    expect(body.picture.missing).toMatch(/no longer in the studio/);
  });

  test('another user can’t see or change them', async () => {
    const { pid, ids, sc } = await keep();
    const args = { projectId: pid, schematicId: sc };
    for (const [name, extra] of [
      ['list_schematics', { elementId: ids.keep }],
      ['get_schematic', {}],
      ['set_point', { name: 'A', x: 0, y: 0 }],
      ['remove_schematic', {}],
    ]) {
      await expect(call(bob, name, { ...args, ...extra })).rejects.toThrow(/not found/i);
    }
    expect(await doc(`muse_projects/${pid}/schematics/${sc}`)).toMatchObject({ points: [] });
  });
});

// A tool result's structured data.
function structuredOf(result) {
  return result.structuredContent || JSON.parse(result.content.find((c) => c.type === 'text').text);
}
