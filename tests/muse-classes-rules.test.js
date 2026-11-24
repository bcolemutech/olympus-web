'use strict';

/**
 * The Muse's classifications and classes under the Firestore rules
 * (planning/the-muse.md §3 CL1–CL8, D3, D9, §4; M-201 / #914): the owner
 * makes them through the page's plans; their shapes are checked; a class past
 * 6 deep, one whose depth or classification doesn't follow its parent's, and
 * a change to where a class sits are refused; an element holds at most 50
 * classes, and its index line must state them; versions of a class are kept;
 * and no one else reads or writes them.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-classes-rules --verbose"
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
const classes = require('../public/apps/muse/js/classes.js');
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

// Reads an element as the page holds it.
async function current(firestore, projectId, id) {
  const snap = await getDoc(doc(firestore, 'muse_projects', projectId, 'elements', id));
  return { id, ...snap.data() };
}

async function readIndex(firestore, projectId) {
  const snap = await getDocs(collection(firestore, 'muse_projects', projectId, 'index'));
  return model.readIndex(snap.docs.map((d) => ({ id: d.id, data: d.data() })));
}

const checked = (type, input) => model.checkElement(type, input, {}).value;
const makePeter = (firestore, index = model.readIndex([])) =>
  commit(
    firestore,
    model.planCreate('p1', 'el_peter', 'character', checked('character', { name: 'Peter' }), index)
  );

async function readTree(firestore, projectId) {
  const read = async (name) =>
    (await getDocs(collection(firestore, 'muse_projects', projectId, name))).docs.map((d) => ({
      id: d.id,
      data: d.data(),
    }));
  return classes.readTree(await read('classifications'), await read('classes'));
}

// Weapons › Sword › Double Edge, made through the plans.
async function weapons(firestore) {
  const tree = classes.emptyTree();
  const run = async (plan) => {
    expect(plan.error).toBeUndefined();
    await assertSucceeds(commit(firestore, plan.value));
    classes.applyToTree(tree, plan.value);
  };
  await run(
    classes.planCreateClassification('p1', 'cf_w', { type: 'object', name: 'Weapons' }, tree)
  );
  await run(
    classes.planCreateClass('p1', 'cl_sword', { classification: 'cf_w', name: 'Sword' }, tree)
  );
  await run(
    classes.planCreateClass('p1', 'cl_edge', { parent: 'cl_sword', name: 'Double Edge' }, tree)
  );
  return tree;
}

const classDoc = (fields = {}) => ({
  classification: 'cf_w',
  parent: null,
  depth: 1,
  name: 'Axe',
  description: '',
  images: [],
  primary: null,
  mentions: [],
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...fields,
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

describe('the owner, through the plans', () => {
  beforeEach(() => seedProject('p1', 'ann'));

  test('makes a classification three levels deep, renames, describes and deletes', async () => {
    const ann = db('ann');
    let tree = await weapons(ann);
    const long = classes.planCreateClass(
      'p1',
      'cl_long',
      { parent: 'cl_edge', name: 'Longsword', description: 'See [Sword](muse:cl/cl_sword).' },
      tree
    );
    await assertSucceeds(commit(ann, long.value));
    tree = await readTree(ann, 'p1');
    expect(classes.pathText(tree, 'cl_long')).toBe('Weapons › Sword › Double Edge › Longsword');
    expect(tree.classes.cl_long).toMatchObject({ depth: 3, mentions: ['cl_sword'] });

    const renamed = classes.planUpdateClass('p1', tree, 'cl_long', { name: 'Greatsword' });
    await assertSucceeds(commit(ann, renamed.value));
    const photos = classes.planUpdateClass(
      'p1',
      tree,
      'cl_long',
      {},
      model.checkPhotos({ images: ['img_a', 'img_b'], primary: 'img_b' }).value
    );
    await assertSucceeds(commit(ann, photos.value));
    const single = classes.planUpdateClassification('p1', tree, 'cf_w', { multiple: true }, []);
    await assertSucceeds(commit(ann, single.value));
    tree = await readTree(ann, 'p1');
    expect(tree.classes.cl_long).toMatchObject({ name: 'Greatsword', primary: 'img_b' });
    expect(tree.classifications.cf_w.multiple).toBe(true);

    const gone = classes.planDeleteClass('p1', tree, 'cl_long', false).value;
    await assertSucceeds(commit(ann, gone));
    classes.applyToTree(tree, gone);
    await assertSucceeds(commit(ann, classes.planDeleteClass('p1', tree, 'cl_edge', false).value));
  });

  test('an element holds classes, and its index line states them', async () => {
    const ann = db('ann');
    const tree = await weapons(ann);
    const value = model.checkElement(
      'object',
      { name: 'Kingsbrand', classes: ['cl_edge'] },
      { tree }
    ).value;
    await assertSucceeds(
      commit(ann, model.planCreate('p1', 'el_brand', 'object', value, model.readIndex([])))
    );
    const now = await current(ann, 'p1', 'el_brand');
    expect(now.classes).toEqual(['cl_edge']);
    const index = await readIndex(ann, 'p1');
    expect(index.entries.el_brand.classes).toEqual(['cl_edge']);
    // Reclassified, the line follows.
    await assertSucceeds(commit(ann, model.planUpdate('p1', now, { classes: ['cl_sword'] })));
    expect((await readIndex(ann, 'p1')).entries.el_brand.classes).toEqual(['cl_sword']);
  });

  test('a line written before M-201, without classes, is rewritten on the next save', async () => {
    const ann = db('ann');
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const fs = ctx.firestore();
      await setDoc(doc(fs, 'muse_projects/p1/elements/el_old'), {
        type: 'object',
        name: 'Old',
        aliases: [],
        bio: '',
        fields: {},
        images: [],
        primary: null,
        mentions: [],
        shard: '0',
        retired: false,
        createdAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000),
      });
      await setDoc(doc(fs, 'muse_projects/p1/index/0'), {
        entries: { el_old: { type: 'object', name: 'Old', aliases: [], primary: null } },
        last: 'el_old',
      });
    });
    const now = await current(ann, 'p1', 'el_old');
    const value = model.checkElement('object', { bio: 'Still here.' }, { current: now }).value;
    await assertSucceeds(commit(ann, model.planUpdate('p1', now, value)));
    expect((await readIndex(ann, 'p1')).entries.el_old.classes).toEqual([]);
  });

  test('keeps versions of a class', async () => {
    const ann = db('ann');
    await weapons(ann);
    const snap = await getDoc(doc(ann, 'muse_projects/p1/classes/cl_sword'));
    const plan = versions.planSave({
      projectId: 'p1',
      id: 'v1',
      of: versions.ofPath('p1', 'classes', 'cl_sword'),
      data: snap.data(),
      existing: [],
      by: 'page',
    });
    await assertSucceeds(commit(ann, plan.writes));
    // Not of another collection's thing.
    const odd = versions.planSave({
      projectId: 'p1',
      id: 'v2',
      of: versions.ofPath('p1', 'classifications', 'cf_w'),
      data: { name: 'Weapons' },
      existing: [],
      by: 'page',
    });
    await assertFails(commit(ann, odd.writes));
  });
});

describe('badly shaped or misplaced classes are refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await weapons(db('ann'));
  });

  const cases = [
    ['no classification', { classification: 'cf_none' }],
    ['depth 2 at the top', { depth: 2 }],
    ['a parent of another depth', { parent: 'cl_sword', depth: 3 }],
    [
      'a parent in another classification',
      { parent: 'cl_sword', depth: 2, classification: 'cf_m' },
    ],
    ['a parent that isn’t there', { parent: 'cl_none', depth: 2 }],
    ['an empty name', { name: '' }],
    ['a long name', { name: 'x'.repeat(101) }],
    ['a primary not among its images', { images: ['a'], primary: 'b' }],
    ['a field of its own', { extra: true }],
    ['no mentions', { mentions: undefined }],
  ];
  test.each(cases)('%s', async (_, fields) => {
    const ann = db('ann');
    await testEnv.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'muse_projects/p1/classifications/cf_m'), {
        type: 'object',
        name: 'Materials',
        multiple: true,
        createdAt: Timestamp.fromMillis(1000),
        updatedAt: Timestamp.fromMillis(1000),
      })
    );
    const data = classDoc(fields);
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    await assertFails(setDoc(doc(ann, 'muse_projects/p1/classes/cl_bad'), data));
  });

  test('a class past 6 levels deep', async () => {
    const ann = db('ann');
    let parent = 'cl_edge';
    for (let depth = 3; depth <= 6; depth++) {
      await assertSucceeds(
        setDoc(
          doc(ann, `muse_projects/p1/classes/cl_${depth}`),
          classDoc({ parent, depth, name: `L${depth}` })
        )
      );
      parent = `cl_${depth}`;
    }
    await assertFails(
      setDoc(doc(ann, 'muse_projects/p1/classes/cl_7'), classDoc({ parent, depth: 7, name: 'L7' }))
    );
  });

  test('a class can’t change its classification, parent or depth', async () => {
    const ann = db('ann');
    const ref = doc(ann, 'muse_projects/p1/classes/cl_edge');
    await assertSucceeds(updateDoc(ref, { name: 'Two Edges', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { parent: null, depth: 1, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { depth: 3, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { classification: 'cf_x', updatedAt: serverTimestamp() }));
  });

  test('a classification of no type, or one that changes its type', async () => {
    const ann = db('ann');
    const base = {
      type: 'object',
      name: 'Rarity',
      multiple: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    await assertFails(
      setDoc(doc(ann, 'muse_projects/p1/classifications/cf_x'), { ...base, type: 'weapon' })
    );
    await assertFails(
      setDoc(doc(ann, 'muse_projects/p1/classifications/cf_x'), { ...base, multiple: 'no' })
    );
    await assertFails(
      setDoc(doc(ann, 'muse_projects/p1/classifications/cf_x'), { ...base, name: '' })
    );
    await assertFails(
      updateDoc(doc(ann, 'muse_projects/p1/classifications/cf_w'), {
        type: 'location',
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe('an element’s classes', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await weapons(db('ann'));
    await commit(
      db('ann'),
      model.planCreate(
        'p1',
        'el_brand',
        'object',
        model.checkElement('object', { name: 'Kingsbrand' }, {}).value,
        model.readIndex([])
      )
    );
  });

  test('more than 50 are refused', async () => {
    const ann = db('ann');
    const now = await current(ann, 'p1', 'el_brand');
    const many = Array.from({ length: 51 }, (_, i) => `cl_${i}`);
    await assertFails(commit(ann, model.planUpdate('p1', now, { classes: many })));
    await assertSucceeds(commit(ann, model.planUpdate('p1', now, { classes: many.slice(0, 50) })));
  });

  test('a line that lacks or misstates its classes is refused', async () => {
    const ann = db('ann');
    const now = await current(ann, 'p1', 'el_brand');
    const plan = model.planUpdate('p1', now, { classes: ['cl_sword'] });
    // Without its line.
    await assertFails(commit(ann, plan.slice(0, 1)));
    // With a line that names another class.
    const wrong = JSON.parse(JSON.stringify(plan));
    wrong[1].data.entries.el_brand.classes = ['cl_edge'];
    wrong[0].data.updatedAt = model.NOW;
    await assertFails(commit(ann, wrong));
    // With a line that lacks them.
    const lacking = JSON.parse(JSON.stringify(plan));
    delete lacking[1].data.entries.el_brand.classes;
    lacking[0].data.updatedAt = model.NOW;
    await assertFails(
      commit(ann, [
        lacking[0],
        {
          op: 'set',
          path: 'muse_projects/p1/index/0',
          data: lacking[1].data,
        },
      ])
    );
    await assertSucceeds(commit(ann, plan));
  });
});

describe('everyone else is refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await weapons(db('ann'));
  });

  test('another user can’t read or write ann’s classifications or classes', async () => {
    const bob = db('bob');
    await assertFails(getDoc(doc(bob, 'muse_projects/p1/classes/cl_sword')));
    await assertFails(getDocs(collection(bob, 'muse_projects/p1/classifications')));
    await assertFails(setDoc(doc(bob, 'muse_projects/p1/classes/cl_axe'), classDoc()));
    await assertFails(deleteDoc(doc(bob, 'muse_projects/p1/classes/cl_edge')));
    await assertFails(deleteDoc(doc(bob, 'muse_projects/p1/classifications/cf_w')));
  });

  test('the owner without the muse claim is refused', async () => {
    const ann = db('ann', { apps: ['loom'] });
    await assertFails(getDoc(doc(ann, 'muse_projects/p1/classes/cl_sword')));
    await assertFails(setDoc(doc(ann, 'muse_projects/p1/classes/cl_axe'), classDoc()));
  });
});
