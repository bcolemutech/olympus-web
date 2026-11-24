'use strict';

/**
 * The Muse's schematics under the Firestore rules (planning/the-muse.md §3
 * SC3–SC5, D7, D9, §4; M-202 / #915): the owner makes a location's or an
 * object's schematics through the page's plans; their shapes are checked (a
 * point outside 0 to 1, more than 200 points, a schematic on a character, one
 * with no name or no picture are refused); the element is fixed once made;
 * versions of a schematic are kept; and no one else reads or writes them.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-schematics-rules --verbose"
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
  writeBatch,
  serverTimestamp,
  deleteField,
  Timestamp,
} = require('firebase/firestore');
const model = require('../public/apps/muse/js/model.js');
const versions = require('../public/apps/muse/js/versions.js');

const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'demo-olympus-rules-test';
const MUSE = { apps: ['muse'] };

let testEnv;

function firestoreConfig() {
  const config = { rules: readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8') };
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  config.host = host;
  config.port = Number(port);
  return config;
}

const db = (uid, claims = MUSE) => testEnv.authenticatedContext(uid, claims).firestore();

// A plan from ./model.js done as one batch, as the page does it.
function toSdk(value) {
  if (versions.isNow(value)) return serverTimestamp();
  if (value === model.DELETE) return deleteField();
  if (Array.isArray(value)) return value.map(toSdk);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toSdk(v)]));
  }
  return value;
}

function commit(firestore, writes) {
  const batch = writeBatch(firestore);
  writes.forEach(({ op, path, data }) => {
    const ref = doc(firestore, path);
    if (op === 'set') batch.set(ref, toSdk(data));
    else if (op === 'merge') batch.set(ref, toSdk(data), { merge: true });
    else if (op === 'delete') batch.delete(ref);
    else batch.update(ref, toSdk(data));
  });
  return batch.commit();
}

async function seedProject(id, owner, extra = {}) {
  await testEnv.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'muse_projects', id), {
      owner,
      title: 'Seeded',
      short: '',
      summary: '',
      cover: null,
      createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(1000),
      ...extra,
    })
  );
}

const schematics = require('../public/apps/muse/js/schematics.js');

// A location, an object and a character, made through the plans.
async function elements(firestore) {
  let index = model.readIndex([]);
  const make = async (id, type, name) => {
    const plan = model.planCreate(
      'p1',
      id,
      type,
      model.checkElement(type, { name }, {}).value,
      index
    );
    await assertSucceeds(commit(firestore, plan));
    model.applyToIndex(index, plan);
  };
  await make('el_keep', 'location', 'The Keep');
  await make('el_chest', 'object', 'Iron chest');
  await make('el_peter', 'character', 'Peter');
}

const plan = (id, element = 'el_keep', elementType = 'location', siblings = []) =>
  schematics.planCreate(
    'p1',
    id,
    { element, name: 'Ground floor', image: 'img_plan' },
    { elementType, siblings }
  );

const rawDoc = (fields = {}) => ({
  element: 'el_keep',
  name: 'Ground floor',
  order: 0,
  image: 'img_plan',
  points: [],
  links: [],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...fields,
});
const point = (n, fields = {}) => ({ id: `p${n}`, name: `Point ${n}`, x: 0.5, y: 0.5, ...fields });
const at = (id) => doc(db('ann'), 'muse_projects', 'p1', 'schematics', id);

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

describe('the owner, through the plans', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await elements(db('ann'));
  });

  test('makes a schematic of a location and of an object, adds, moves and removes points', async () => {
    const ann = db('ann');
    await assertSucceeds(commit(ann, plan('sc_a').value));
    await assertSucceeds(commit(ann, plan('sc_b', 'el_chest', 'object').value));
    const read = async () =>
      schematics.read('sc_a', (await getDoc(doc(ann, 'muse_projects/p1/schematics/sc_a'))).data());

    let sc = await read();
    expect(sc).toMatchObject({ element: 'el_keep', name: 'Ground floor', order: 0, points: [] });
    const added = schematics.planAddPoint('p1', sc, {
      name: 'Door',
      x: 0.25,
      y: 0.5,
      link: 'el_chest',
    });
    await assertSucceeds(commit(ann, added.value));
    sc = await read();
    expect(sc.points).toEqual([
      { id: 'p1', name: 'Door', description: '', x: 0.25, y: 0.5, link: 'el_chest' },
    ]);
    expect(sc.links).toEqual(['el_chest']);

    const moved = schematics.planChangePoint('p1', sc, 'p1', { x: 0.75, y: 0.1 });
    await assertSucceeds(commit(ann, moved.value));
    sc = await read();
    expect(sc.points[0]).toMatchObject({ x: 0.75, y: 0.1 });

    await assertSucceeds(commit(ann, schematics.planRemovePoint('p1', sc, 'p1').value));
    sc = await read();
    expect(sc.points).toEqual([]);
    expect(sc.links).toEqual([]);

    await assertSucceeds(commit(ann, schematics.planUpdate('p1', sc, { name: 'Cellars' }).value));
    await assertSucceeds(commit(ann, schematics.planDelete('p1', 'sc_a').value));
    expect((await getDoc(doc(ann, 'muse_projects/p1/schematics/sc_a'))).exists()).toBe(false);
  });

  test('a schematic’s element must be there, and a location or an object', async () => {
    const ann = db('ann');
    await assertFails(setDoc(at('sc_chr'), rawDoc({ element: 'el_peter' })));
    await assertFails(setDoc(at('sc_none'), rawDoc({ element: 'el_nowhere' })));
    await assertSucceeds(setDoc(at('sc_ok'), rawDoc()));
    // The plans refuse a character before the rules are asked.
    expect(plan('sc_x', 'el_peter', 'character').error).toMatch(/locations and objects/);
    expect(ann).toBeDefined();
  });

  test('the element is fixed once made', async () => {
    await assertSucceeds(setDoc(at('sc_a'), rawDoc()));
    await assertSucceeds(updateDoc(at('sc_a'), { name: 'Renamed', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(at('sc_a'), { element: 'el_chest', updatedAt: serverTimestamp() }));
  });

  test('keeps versions of a schematic (D9)', async () => {
    const ann = db('ann');
    await assertSucceeds(commit(ann, plan('sc_a').value));
    const snap = (await getDoc(doc(ann, 'muse_projects/p1/schematics/sc_a'))).data();
    const kept = versions.planSave({
      projectId: 'p1',
      id: 'v1',
      of: versions.ofPath('p1', 'schematics', 'sc_a'),
      data: snap,
      existing: [],
      by: 'page',
      name: 'Before',
    });
    await assertSucceeds(commit(ann, kept.writes));
    // A version of something else is still refused.
    const odd = versions.planSave({
      projectId: 'p1',
      id: 'v2',
      of: 'muse_projects/p1/relationships/x',
      data: snap,
      existing: [],
      by: 'page',
    });
    await assertFails(commit(ann, odd.writes));
  });
});

describe('badly shaped schematics are refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await elements(db('ann'));
  });

  test('a point outside the picture, or one with no place', async () => {
    await assertSucceeds(
      setDoc(at('ok'), rawDoc({ points: [point(1), point(2, { x: 0, y: 1 })] }))
    );
    await assertFails(setDoc(at('a'), rawDoc({ points: [point(1, { x: 1.2 })] })));
    await assertFails(setDoc(at('b'), rawDoc({ points: [point(1, { y: -0.1 })] })));
    await assertFails(setDoc(at('c'), rawDoc({ points: [point(1), point(2, { x: 2 })] })));
    await assertFails(setDoc(at('d'), rawDoc({ points: [point(1, { x: '0.5' })] })));
    await assertFails(setDoc(at('e'), rawDoc({ points: [{ id: 'p1', name: 'No place' }] })));
    await assertFails(setDoc(at('f'), rawDoc({ points: ['not a point'] })));
    // A change that moves a point outside, as the page would write it.
    await assertSucceeds(setDoc(at('i'), rawDoc({ points: [point(1)] })));
    await assertFails(
      updateDoc(at('i'), { points: [point(1, { x: 3 })], updatedAt: serverTimestamp() })
    );
  });

  test('the rules look at the first 16 points; the page and the connector check them all', async () => {
    const many = (n, bad) =>
      Array.from({ length: n }, (_, i) => point(i + 1, i === bad ? { x: 9 } : {}));
    await assertFails(setDoc(at('last'), rawDoc({ points: many(16, 15) })));
    // Past the sixteenth, the rules (which can't afford more) leave it to them.
    await assertSucceeds(setDoc(at('beyond'), rawDoc({ points: many(30, 20) })));
    expect(schematics.checkPoint(many(30, 20)[20]).error).toMatch(/fraction of the picture/);
  });

  test('a name, a picture and an order of the right kinds', async () => {
    await assertFails(setDoc(at('a'), rawDoc({ name: '' })));
    await assertFails(setDoc(at('b'), rawDoc({ name: 'x'.repeat(101) })));
    await assertFails(setDoc(at('c'), rawDoc({ image: '' })));
    await assertFails(setDoc(at('d'), rawDoc({ image: null })));
    await assertFails(setDoc(at('e'), rawDoc({ order: -1 })));
    await assertFails(setDoc(at('f'), rawDoc({ order: 1.5 })));
    await assertFails(setDoc(at('g'), rawDoc({ extra: 1 })));
    const { name, ...lacking } = rawDoc();
    expect(name).toBeDefined();
    await assertFails(setDoc(at('h'), lacking));
  });

  test('the times are the server’s', async () => {
    await assertFails(setDoc(at('a'), rawDoc({ createdAt: Timestamp.fromMillis(5) })));
    await assertSucceeds(setDoc(at('b'), rawDoc()));
    await assertFails(updateDoc(at('b'), { name: 'Late', updatedAt: Timestamp.fromMillis(5) }));
  });
});

describe('everyone else is refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await elements(db('ann'));
    await assertSucceeds(setDoc(at('sc_a'), rawDoc()));
  });

  test('another user can’t read or write ann’s schematics', async () => {
    const bob = db('bob');
    const there = doc(bob, 'muse_projects', 'p1', 'schematics', 'sc_a');
    await assertFails(getDoc(there));
    await assertFails(setDoc(doc(bob, 'muse_projects', 'p1', 'schematics', 'sc_b'), rawDoc()));
    await assertFails(updateDoc(there, { name: 'Mine', updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(there));
  });

  test('the owner without the muse claim is refused', async () => {
    const bare = db('ann', {});
    await assertFails(getDoc(doc(bare, 'muse_projects', 'p1', 'schematics', 'sc_a')));
    await assertFails(deleteDoc(doc(bare, 'muse_projects', 'p1', 'schematics', 'sc_a')));
  });

  test('a signed-out visitor is refused', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'muse_projects', 'p1', 'schematics', 'sc_a')));
  });
});
