'use strict';

/**
 * The Muse's versions under the Firestore rules (planning/the-muse.md §3 VR1,
 * VR2, §4; M-105 / #893): the owner keeps a version of the project or of an
 * element as the page's plan does it, with the oldest past the last 50
 * deleted in the same batch, reads them back with the page's query, and
 * deletes one; an update to a version is refused, as is one that claims to be
 * the connector's, one of another project's or another kind of document, one
 * badly shaped or with a time of its own; and no one else reads or writes
 * them.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-versions-rules --verbose"
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const {
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
  Timestamp,
} = require('firebase/firestore');
const model = require('../public/apps/muse/js/model.js');
const versions = require('../public/apps/muse/js/versions.js');

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-olympus-rules-test';
const MUSE = { apps: ['muse'] };
const PETER = 'muse_projects/p1/elements/el_peter';

let testEnv;

function firestoreConfig() {
  const config = { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') };
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  config.host = host;
  config.port = Number(port);
  return config;
}

const db = (uid, claims = MUSE) => testEnv.authenticatedContext(uid, claims).firestore();

// A plan done as one batch, as the page does it.
function toSdk(value) {
  if (versions.isNow(value)) return serverTimestamp();
  if (Array.isArray(value)) return value.map(toSdk);
  if (value && typeof value === 'object' && value.constructor === Object) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toSdk(v)]));
  }
  return value;
}

function commit(firestore, writes) {
  const batch = writeBatch(firestore);
  writes.forEach(({ op, path, data }) => {
    const ref = doc(firestore, path);
    if (op === 'delete') batch.delete(ref);
    else batch.set(ref, toSdk(data));
  });
  return batch.commit();
}

async function seed(fn) {
  await testEnv.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
}

async function seedProject(id, owner) {
  await seed((firestore) =>
    setDoc(doc(firestore, 'muse_projects', id), {
      owner,
      title: 'Seeded',
      short: '',
      summary: '',
      cover: null,
      createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(1000),
    })
  );
}

// An element made as the page makes it, stored as Firestore holds it.
const peterData = () => {
  const checked = model.checkElement('character', { name: 'King Peter' }, {}).value;
  const writes = model.planCreate('p1', 'el_peter', 'character', checked, model.readIndex([]));
  return writes[0].data;
};

async function seedPeter() {
  await seed((firestore) =>
    setDoc(doc(firestore, PETER), {
      ...toSdk(peterData()),
      createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(1000),
    })
  );
}

// The page's plan for a version of King Peter.
const keepPeter = (id, over = {}) =>
  versions.planSave({
    projectId: 'p1',
    id,
    of: PETER,
    data: { type: 'character', name: 'King Peter', aliases: [] },
    existing: [],
    by: 'page',
    ...over,
  });

const versionRef = (firestore, id) => doc(firestore, 'muse_projects', 'p1', 'versions', id);

// A version as a plan would write it, for testing a field at a time.
const raw = (over = {}) => ({
  of: PETER,
  snapshot: { name: 'King Peter' },
  name: null,
  by: 'page',
  at: serverTimestamp(),
  ...over,
});

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: firestoreConfig(),
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

describe('the owner, through the page’s plan', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await seedPeter();
  });

  test('keeps a version of an element, and reads it back by the thing it is of', async () => {
    const ann = db('ann');
    await assertSucceeds(commit(ann, keepPeter('v1', { name: 'Before the war' }).writes));
    await assertSucceeds(commit(ann, keepPeter('v2').writes));
    // Another thing's, which the query leaves out.
    await assertSucceeds(
      commit(
        ann,
        versions.planSave({
          projectId: 'p1',
          id: 'v3',
          of: 'muse_projects/p1',
          data: { title: 'Seeded' },
          existing: [],
          by: 'page',
        }).writes
      )
    );
    const found = await assertSucceeds(
      getDocs(
        query(collection(ann, 'muse_projects', 'p1', 'versions'), where('of', '==', PETER))
      )
    );
    expect(found.docs.map((d) => d.id).sort()).toEqual(['v1', 'v2']);
    const first = (await getDoc(versionRef(ann, 'v1'))).data();
    expect(first).toMatchObject({
      of: PETER,
      name: 'Before the war',
      by: 'page',
      snapshot: { type: 'character', name: 'King Peter' },
    });
    expect(first.at.toMillis()).toBeGreaterThan(0);
  });

  test('keeps the project’s own version', async () => {
    await assertSucceeds(
      commit(
        db('ann'),
        versions.planSave({
          projectId: 'p1',
          id: 'v1',
          of: 'muse_projects/p1',
          data: { owner: 'ann', title: 'Seeded', summary: '' },
          existing: [],
          by: 'page',
        }).writes
      )
    );
  });

  test('the 51st, with the oldest deleted in its batch, is kept; fifty are left', async () => {
    const ann = db('ann');
    await seed(async (firestore) => {
      for (let i = 1; i <= 50; i++) {
        await setDoc(
          versionRef(firestore, 'v' + String(i).padStart(2, '0')),
          raw({ at: Timestamp.fromMillis(i * 1000) })
        );
      }
    });
    const existing = (
      await getDocs(
        query(collection(ann, 'muse_projects', 'p1', 'versions'), where('of', '==', PETER))
      )
    ).docs.map((d) => ({ id: d.id, at: d.data().at }));
    expect(existing).toHaveLength(50);
    const plan = keepPeter('v51', { existing });
    expect(plan.dropped).toEqual(['v01']);
    await assertSucceeds(commit(ann, plan.writes));
    const left = (await getDocs(collection(ann, 'muse_projects', 'p1', 'versions'))).docs.map(
      (d) => d.id
    );
    expect(left).toHaveLength(50);
    expect(left).not.toContain('v01');
    expect(left).toContain('v02');
    expect(left).toContain('v51');
  });

  test('deletes one of its versions', async () => {
    const ann = db('ann');
    await assertSucceeds(commit(ann, keepPeter('v1').writes));
    await assertSucceeds(deleteDoc(versionRef(ann, 'v1')));
    expect((await getDoc(versionRef(ann, 'v1'))).exists()).toBe(false);
  });
});

describe('a version is never changed', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await seedPeter();
    await seed((firestore) => setDoc(versionRef(firestore, 'v1'), raw({ name: 'Kept' })));
  });

  test('an update is refused, whatever it changes', async () => {
    const ann = db('ann');
    await assertFails(updateDoc(versionRef(ann, 'v1'), { name: 'Renamed' }));
    await assertFails(updateDoc(versionRef(ann, 'v1'), { snapshot: { name: 'Changed' } }));
    await assertFails(updateDoc(versionRef(ann, 'v1'), { by: 'page' }));
    await assertFails(setDoc(versionRef(ann, 'v1'), raw({ name: 'Overwritten' })));
    expect((await getDoc(versionRef(ann, 'v1'))).data().name).toBe('Kept');
  });
});

describe('the shape of a version', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await seedPeter();
  });

  const makes = (data, id = 'v1') => setDoc(versionRef(db('ann'), id), data);

  test('a well-formed one is accepted, with or without a name', async () => {
    await assertSucceeds(makes(raw()));
    await assertSucceeds(makes(raw({ name: 'Named' }), 'v2'));
    await assertSucceeds(makes(raw({ name: 'x'.repeat(100) }), 'v3'));
    await assertSucceeds(makes(raw({ of: 'muse_projects/p1' }), 'v4'));
  });

  test('the page cannot claim to be the connector', async () => {
    await assertFails(makes(raw({ by: 'mcp' })));
    await assertFails(makes(raw({ by: 'someone' })));
    await assertFails(makes(raw({ by: null })));
  });

  test('its time is the server’s, not one it picks', async () => {
    await assertFails(makes(raw({ at: Timestamp.fromMillis(5) })));
    await assertFails(makes(raw({ at: Timestamp.now() })));
    await assertFails(makes(raw({ at: 5 })));
  });

  test('it is of the project or one of its elements, and no other', async () => {
    await assertFails(makes(raw({ of: 'muse_projects/p2' })));
    await assertFails(makes(raw({ of: 'muse_projects/p2/elements/el_peter' })));
    await assertFails(makes(raw({ of: 'muse_projects/p1/elements' })));
    await assertFails(makes(raw({ of: 'muse_projects/p1/elements/' })));
    await assertFails(makes(raw({ of: 'muse_projects/p1/elements/el_peter/versions/v0' })));
    await assertFails(makes(raw({ of: 'muse_projects/p1/relationships/r1' })));
    await assertFails(makes(raw({ of: 'muse_projects/p1/versions/v0' })));
    await assertFails(makes(raw({ of: 'loom_worlds/w1' })));
    await assertFails(makes(raw({ of: 'muse_projects' })));
    await assertFails(makes(raw({ of: '' })));
    await assertFails(makes(raw({ of: 5 })));
    await assertFails(makes(raw({ of: null })));
  });

  test('its snapshot is a map', async () => {
    await assertFails(makes(raw({ snapshot: 'King Peter' })));
    await assertFails(makes(raw({ snapshot: ['King Peter'] })));
    await assertFails(makes(raw({ snapshot: null })));
  });

  test('its name is nothing or text of 1 to 100 characters', async () => {
    await assertFails(makes(raw({ name: '' })));
    await assertFails(makes(raw({ name: 'x'.repeat(101) })));
    await assertFails(makes(raw({ name: 5 })));
  });

  test('it has these fields and no others', async () => {
    const { name, ...without } = raw();
    expect(name).toBeNull();
    await assertFails(makes(without));
    await assertFails(makes({ ...raw(), extra: true }));
    const { snapshot, ...noSnapshot } = raw();
    expect(snapshot).toBeDefined();
    await assertFails(makes(noSnapshot));
  });
});

describe('no one else', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await seedPeter();
    await seed((firestore) => setDoc(versionRef(firestore, 'v1'), raw()));
  });

  const strangers = [
    ['another writer with the muse claim', () => db('bob')],
    ['the owner without the muse claim', () => db('ann', { apps: ['loom'] })],
    ['the owner with only the cartographer claim', () => db('ann', { apps: ['cartographer'] })],
    ['an admin without the muse claim', () => db('root', { admin: true })],
    ['someone signed out', () => testEnv.unauthenticatedContext().firestore()],
  ];

  test.each(strangers)('%s cannot read, keep, or delete a version', async (_name, as) => {
    const firestore = as();
    await assertFails(getDoc(versionRef(firestore, 'v1')));
    await assertFails(
      getDocs(
        query(collection(firestore, 'muse_projects', 'p1', 'versions'), where('of', '==', PETER))
      )
    );
    await assertFails(setDoc(versionRef(firestore, 'v2'), raw()));
    await assertFails(commit(firestore, keepPeter('v3').writes));
    await assertFails(deleteDoc(versionRef(firestore, 'v1')));
  });

  test('a version of a project that isn’t there cannot be made', async () => {
    await assertFails(setDoc(doc(db('ann'), 'muse_projects', 'nope', 'versions', 'v1'), raw()));
  });
});
