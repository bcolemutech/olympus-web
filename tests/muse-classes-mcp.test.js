'use strict';

/**
 * Classifications over the Muse connector (planning/the-muse.md §3 CL1–CL10,
 * D3–D6, D9; M-201 / #914), driven by a real MCP client through /mcp/muse
 * against the Firestore emulator: a weapon classification three levels deep,
 * objects classified at different levels, find_elements by "Sword" finding
 * the Longsword, and a version by `mcp` kept before `classify`; a single
 * classification keeping one class; deleting refused while anything is in a
 * class; classes in get_element, outline, search and lookup, with photos and
 * versions of their own.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-classes-mcp --verbose"
 */

const PROJECT = 'demo-muse-classes-mcp';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-muse-classes';
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

// The studio, faked: what the studio tools call, recorded.
const started = [];
const studio = {
  library: () => ({
    getImage: async (id) => ({ id, title: 'x', versions: [], current: 1 }),
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
  load: async () => Buffer.alloc(0),
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
    [IMG, 'King Peter'],
    [IMG2, 'King Peter, older'],
  ]) {
    await db.doc(`studio_images/${id}`).set({
      id,
      title,
      kind: 'portrait',
      link: `https://example.com/${id}.png`,
    });
  }
});

const doc = async (p) => (await db.doc(p).get()).data();
const indexOf = async (projectId) =>
  Object.assign(
    {},
    ...(await db.collection(`muse_projects/${projectId}/index`).get()).docs.map(
      (d) => d.data().entries
    )
  );
const versionsOf = async (projectId, of) =>
  (await db.collection(`muse_projects/${projectId}/versions`).where('of', '==', of).get()).docs.map(
    (d) => d.data()
  );

// An armoury: Weapons › Sword › Double Edge › Longsword, with an axe beside
// the sword, and three objects classified at different levels.
async function armoury() {
  const project = await call(ann, 'create_project', { title: 'The Armoury' });
  const pid = project.id;
  const { classification: weapons } = await call(ann, 'create_classification', {
    projectId: pid,
    type: 'object',
    name: 'Weapons',
  });
  const sword = await call(ann, 'create_class', {
    projectId: pid,
    classificationId: 'Weapons',
    name: 'Sword',
    description: 'A blade longer than a knife.',
  });
  const edge = await call(ann, 'create_class', {
    projectId: pid,
    parent: sword.id,
    name: 'Double Edge',
  });
  const longsword = await call(ann, 'create_class', {
    projectId: pid,
    parent: 'Sword › Double Edge',
    name: 'Longsword',
    description: 'Held in two hands.',
  });
  const axe = await call(ann, 'create_class', {
    projectId: pid,
    classificationId: weapons.id,
    name: 'Axe',
  });
  const brand = await call(ann, 'create_element', {
    projectId: pid,
    type: 'object',
    name: 'Kingsbrand',
    aliases: ['The Old Blade'],
    classes: ['Longsword'],
  });
  const blade = await call(ann, 'create_element', {
    projectId: pid,
    type: 'object',
    name: 'A rusted blade',
  });
  const cleaver = await call(ann, 'create_element', {
    projectId: pid,
    type: 'object',
    name: 'The Cleaver',
  });
  return { project, pid, weapons, sword, edge, longsword, axe, brand, blade, cleaver };
}

describe('classifications', () => {
  test('a weapon classification three levels deep, objects classified, found by "Sword"', async () => {
    const a = await armoury();
    expect(a.longsword).toMatchObject({
      name: 'Longsword',
      path: 'Weapons › Sword › Double Edge › Longsword',
      depth: 3,
      parents: [
        { id: a.sword.id, name: 'Sword' },
        { id: a.edge.id, name: 'Double Edge' },
      ],
      classification: { id: a.weapons.id, name: 'Weapons', type: 'object', multiple: false },
    });
    expect(a.longsword.page).toMatch(`/apps/muse/#/p/${a.pid}/c/${a.longsword.id}`);
    expect(await doc(`muse_projects/${a.pid}/classes/${a.longsword.id}`)).toMatchObject({
      classification: a.weapons.id,
      parent: a.edge.id,
      depth: 3,
      name: 'Longsword',
      images: [],
      primary: null,
      mentions: [],
    });

    // Kingsbrand was made a Longsword; the blade is just a Sword for now.
    const done = await call(ann, 'classify', {
      projectId: a.pid,
      elementId: a.blade.id,
      add: ['Sword'],
    });
    expect(done.element.classes).toEqual([{ id: a.sword.id, path: 'Weapons › Sword' }]);
    await call(ann, 'classify', { projectId: a.pid, elementId: a.cleaver.id, add: ['Axe'] });

    // The index line holds the classes (D3).
    const index = await indexOf(a.pid);
    expect(index[a.brand.id].classes).toEqual([a.longsword.id]);
    expect(index[a.blade.id].classes).toEqual([a.sword.id]);

    // "Sword" finds the Longsword and the blade, not the cleaver.
    const found = await call(ann, 'find_elements', { projectId: a.pid, class: 'Sword' });
    expect(found.elements.map((e) => e.name)).toEqual(['A rusted blade', 'Kingsbrand']);
    expect(found.elements[1].classes).toEqual(['Weapons › Sword › Double Edge › Longsword']);
    const listed = await call(ann, 'list_elements', { projectId: a.pid, class: a.longsword.id });
    expect(listed.elements.map((e) => e.name)).toEqual(['Kingsbrand']);
    const named = await call(ann, 'find_elements', {
      projectId: a.pid,
      query: 'old blade',
      class: 'Weapons › Sword',
    });
    expect(named.elements.map((e) => e.name)).toEqual(['Kingsbrand']);

    // The trees, with counts.
    const trees = await call(ann, 'list_classifications', { projectId: a.pid, type: 'object' });
    expect(trees.types.object).toEqual([
      {
        id: a.weapons.id,
        type: 'object',
        name: 'Weapons',
        multiple: false,
        classes: [
          { id: a.axe.id, name: 'Axe', in: 1, all: 1 },
          {
            id: a.sword.id,
            name: 'Sword',
            in: 1,
            all: 2,
            classes: [
              {
                id: a.edge.id,
                name: 'Double Edge',
                in: 0,
                all: 1,
                classes: [{ id: a.longsword.id, name: 'Longsword', in: 1, all: 1 }],
              },
            ],
          },
        ],
      },
    ]);

    // A class's page: the elements in it and beneath it.
    const sword = await call(ann, 'get_class', { projectId: a.pid, classId: 'Weapons › Sword' });
    expect(sword.elements.map((e) => e.name)).toEqual(['A rusted blade']);
    expect(sword.beneath.map((e) => e.name)).toEqual(['Kingsbrand']);
    expect(sword.subclasses).toEqual([{ id: a.edge.id, name: 'Double Edge', all: 1 }]);
  });

  test('a version by mcp is kept before classify, and refining replaces the class above', async () => {
    const a = await armoury();
    await call(ann, 'classify', { projectId: a.pid, elementId: a.blade.id, add: ['Sword'] });
    const of = `muse_projects/${a.pid}/elements/${a.blade.id}`;
    const before = await versionsOf(a.pid, of);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ by: 'mcp' });
    expect(before[0].snapshot.classes).toEqual([]);

    // Decided it's a Longsword: Sword makes way for it.
    const done = await call(ann, 'classify', {
      projectId: a.pid,
      elementId: a.blade.id,
      add: ['Longsword'],
    });
    expect(done.element.classes.map((c) => c.path)).toEqual([
      'Weapons › Sword › Double Edge › Longsword',
    ]);
    expect(done.version.id).toBeTruthy();
    const after = await versionsOf(a.pid, of);
    expect(after).toHaveLength(2);
    expect(after.map((v) => v.snapshot.classes).sort()).toEqual([[], [a.sword.id]]);

    // Taken out again.
    const out = await call(ann, 'classify', {
      projectId: a.pid,
      elementId: a.blade.id,
      remove: ['Longsword'],
    });
    expect(out.element.classes).toEqual([]);
    await expect(
      call(ann, 'classify', { projectId: a.pid, elementId: a.blade.id, remove: ['Axe'] })
    ).rejects.toThrow(/isn’t in Weapons › Axe/);
  });

  test('a single classification keeps one class; it is made single only when none holds two', async () => {
    const a = await armoury();
    // Single: the axe replaces the longsword.
    const done = await call(ann, 'classify', {
      projectId: a.pid,
      elementId: a.brand.id,
      add: ['Axe'],
    });
    expect(done.element.classes.map((c) => c.path)).toEqual(['Weapons › Axe']);

    // Multiple: it holds both, and can't be made single again while it does.
    await call(ann, 'update_classification', {
      projectId: a.pid,
      classificationId: 'Weapons',
      multiple: true,
    });
    const both = await call(ann, 'classify', {
      projectId: a.pid,
      elementId: a.brand.id,
      add: ['Longsword'],
    });
    expect(both.element.classes.map((c) => c.path)).toEqual([
      'Weapons › Axe',
      'Weapons › Sword › Double Edge › Longsword',
    ]);
    await expect(
      call(ann, 'update_classification', {
        projectId: a.pid,
        classificationId: a.weapons.id,
        multiple: false,
      })
    ).rejects.toThrow(/Kingsbrand holds two of its classes/);
    // Retired, it still counts.
    await call(ann, 'retire_element', { projectId: a.pid, elementId: a.brand.id });
    await expect(
      call(ann, 'update_classification', {
        projectId: a.pid,
        classificationId: a.weapons.id,
        multiple: false,
      })
    ).rejects.toThrow(/Kingsbrand holds two/);
    await call(ann, 'retire_element', { projectId: a.pid, elementId: a.brand.id, restore: true });
    await call(ann, 'classify', { projectId: a.pid, elementId: a.brand.id, remove: ['Axe'] });
    const single = await call(ann, 'update_classification', {
      projectId: a.pid,
      classificationId: a.weapons.id,
      multiple: false,
      name: 'Arms',
    });
    expect(single.classification).toMatchObject({ name: 'Arms', multiple: false });
  });

  test('deleting is refused while anything is in a class, or a classification has classes', async () => {
    const a = await armoury();
    // A subclass.
    await expect(
      call(ann, 'delete_class', { projectId: a.pid, classId: 'Double Edge' })
    ).rejects.toThrow(/subclasses/);
    // An element, even retired.
    await call(ann, 'retire_element', { projectId: a.pid, elementId: a.brand.id });
    await expect(
      call(ann, 'delete_class', { projectId: a.pid, classId: 'Longsword' })
    ).rejects.toThrow(/Elements are in it/);
    await expect(
      call(ann, 'delete_classification', { projectId: a.pid, classificationId: 'Weapons' })
    ).rejects.toThrow(/still has classes/);
    // Emptied, it goes.
    await call(ann, 'retire_element', { projectId: a.pid, elementId: a.brand.id, restore: true });
    await call(ann, 'classify', { projectId: a.pid, elementId: a.brand.id, remove: ['Longsword'] });
    const gone = await call(ann, 'delete_class', { projectId: a.pid, classId: 'Longsword' });
    expect(gone).toEqual({
      deleted: a.longsword.id,
      path: 'Weapons › Sword › Double Edge › Longsword',
    });
    expect(await doc(`muse_projects/${a.pid}/classes/${a.longsword.id}`)).toBeUndefined();
  });

  test('names and places: unique among siblings, at most 6 deep, a type’s own classes only', async () => {
    const a = await armoury();
    await expect(
      call(ann, 'create_class', { projectId: a.pid, parent: 'Sword', name: 'double edge' })
    ).rejects.toThrow(/already a class called that/);
    await expect(
      call(ann, 'create_classification', { projectId: a.pid, type: 'object', name: 'weapons' })
    ).rejects.toThrow(/already has a classification/);
    let parent = a.longsword.id;
    for (const name of ['Four', 'Five', 'Six']) {
      parent = (await call(ann, 'create_class', { projectId: a.pid, parent, name })).id;
    }
    await expect(
      call(ann, 'create_class', { projectId: a.pid, parent, name: 'Seven' })
    ).rejects.toThrow(/at most 6 levels deep/);
    // A location's classification isn't an object's.
    await call(ann, 'create_classification', {
      projectId: a.pid,
      type: 'location',
      name: 'Realms',
    });
    await call(ann, 'create_class', {
      projectId: a.pid,
      classificationId: 'Realms',
      name: 'North',
    });
    await expect(
      call(ann, 'classify', { projectId: a.pid, elementId: a.blade.id, add: ['North'] })
    ).rejects.toThrow(/No class “North”/);
    await expect(call(ann, 'find_elements', { projectId: a.pid, class: 'Spear' })).rejects.toThrow(
      /No class “Spear”/
    );
  });

  test('classes in get_element, outline, search and lookup; @-links to a class', async () => {
    const a = await armoury();
    const smith = await call(ann, 'create_element', {
      projectId: a.pid,
      type: 'character',
      name: 'Hild',
      bio: `Forges the [Longsword](muse:cl/${a.longsword.id}) of the north.`,
    });
    expect(smith.mentions).toEqual([{ id: a.longsword.id, name: 'Longsword' }]);
    const el = await call(ann, 'get_element', { projectId: a.pid, elementId: a.brand.id });
    expect(el.classes).toEqual([
      { id: a.longsword.id, path: 'Weapons › Sword › Double Edge › Longsword' },
    ]);
    const outline = await call(ann, 'outline', { projectId: a.pid, type: 'object' });
    expect(outline.types.object.find((e) => e.name === 'Kingsbrand').classes).toEqual([
      'Weapons › Sword › Double Edge › Longsword',
    ]);
    expect(outline.classifications.object[0]).toEqual({
      id: a.weapons.id,
      name: 'Weapons',
      multiple: false,
      classes: ['Axe', 'Sword', 'Sword › Double Edge', 'Sword › Double Edge › Longsword'],
    });

    // Full text finds a class by its description.
    const found = await call(ann, 'search', { projectId: a.pid, query: 'two hands' });
    expect(found.results).toEqual([
      expect.objectContaining({
        id: a.longsword.id,
        type: 'class',
        name: 'Longsword',
        path: 'Weapons › Sword › Double Edge › Longsword',
        where: ['bio'],
      }),
    ]);
    const objects = await call(ann, 'search', {
      projectId: a.pid,
      query: 'two hands',
      types: ['object'],
    });
    expect(objects.total).toBe(0);

    // Lookup reads a class, with what links to it.
    const looked = await call(ann, 'lookup', { projectId: a.pid, name: 'Longsword' });
    expect(looked.class).toMatchObject({
      id: a.longsword.id,
      path: 'Weapons › Sword › Double Edge › Longsword',
      elements: [{ id: a.brand.id, name: 'Kingsbrand', type: 'object' }],
      mentionedIn: [{ id: smith.id, name: 'Hild', type: 'character' }],
    });
    expect(looked.element).toBeUndefined();
  });

  test('a class has photos, a description and versions of its own', async () => {
    const a = await armoury();
    const of = `muse_projects/${a.pid}/classes/${a.sword.id}`;
    const photo = await call(ann, 'add_photos', {
      projectId: a.pid,
      classId: 'Sword',
      imageIds: [IMG],
    });
    expect(photo.class.photos).toEqual([
      expect.objectContaining({ id: IMG, title: 'King Peter', primary: true }),
    ]);
    expect(photo.version.id).toBeTruthy();
    await call(ann, 'add_photos', { projectId: a.pid, classId: a.sword.id, imageIds: [IMG2] });
    const primary = await call(ann, 'set_primary', {
      projectId: a.pid,
      classId: a.sword.id,
      imageId: IMG2,
    });
    expect(primary.class.primary).toBe(IMG2);
    const removed = await call(ann, 'remove_photo', {
      projectId: a.pid,
      classId: a.sword.id,
      imageId: IMG2,
    });
    expect(removed.class.primary).toBe(IMG);
    await expect(
      call(ann, 'add_photos', {
        projectId: a.pid,
        classId: a.sword.id,
        elementId: a.blade.id,
        imageIds: [IMG],
      })
    ).rejects.toThrow(/one of them/);

    const changed = await call(ann, 'update_class', {
      projectId: a.pid,
      classId: a.sword.id,
      name: 'Swords',
      description: `Kin to the [Axe](muse:cl/${a.axe.id}).`,
    });
    expect(changed.class.path).toBe('Weapons › Swords');
    expect(changed.class.mentions).toEqual([{ id: a.axe.id, name: 'Axe' }]);
    const axe = await call(ann, 'get_class', { projectId: a.pid, classId: a.axe.id });
    expect(axe.mentionedIn).toEqual([{ id: a.sword.id, name: 'Swords', type: 'class' }]);

    await call(ann, 'save_version', { projectId: a.pid, classId: a.sword.id, name: 'Named' });
    const kept = await versionsOf(a.pid, of);
    // Before each of the five changes, and the one saved by name.
    expect(kept).toHaveLength(6);
    expect(kept.every((v) => v.by === 'mcp')).toBe(true);
    expect(kept.filter((v) => v.name === 'Named')).toHaveLength(1);
  });

  test('another user sees none of it', async () => {
    const a = await armoury();
    await expect(call(bob, 'list_classifications', { projectId: a.pid })).rejects.toThrow(
      /Project not found/
    );
    await expect(
      call(bob, 'classify', { projectId: a.pid, elementId: a.blade.id, add: ['Sword'] })
    ).rejects.toThrow(/Project not found/);
  });
});
