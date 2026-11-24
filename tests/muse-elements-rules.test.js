'use strict';

/**
 * The Muse's elements and index under the Firestore rules (planning/the-muse.md
 * §3 EL1, EL2, D1, D2, §4; M-102 / #890): the owner writes an element and its
 * index line together, in one batch, as the page's plans do; either alone is
 * refused, as is a line that doesn't match its element; badly shaped elements
 * and field definitions are refused; and no one else reads or writes them.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-elements-rules --verbose"
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
  if (value === model.NOW) return serverTimestamp();
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

describe('the owner, through the page’s plans', () => {
  beforeEach(() => seedProject('p1', 'ann'));

  test('makes each type of element with its index line', async () => {
    const ann = db('ann');
    let index = model.readIndex([]);
    const types = ['character', 'faction', 'location', 'object', 'concept'];
    for (const type of types) {
      const writes = model.planCreate('p1', `el_${type}`, type, checked(type, { name: type }), index);
      await assertSucceeds(commit(ann, writes));
      model.applyToIndex(index, writes);
    }
    index = await readIndex(ann, 'p1');
    expect(Object.keys(index.entries).sort()).toEqual(types.map((t) => `el_${t}`).sort());
    expect(index.entries.el_concept).toEqual({
      type: 'concept',
      name: 'concept',
      aliases: [],
      primary: null,
      classes: [],
      shard: '0',
    });
  });

  test('a character with a residence and custom fields', async () => {
    const ann = db('ann');
    await assertSucceeds(
      commit(
        ann,
        model.planCreate(
          'p1',
          'el_peter',
          'character',
          {
            ...checked('character', { name: 'Peter', appearance: 'Tall' }),
            residence: 'el_sea',
            fields: { age_x: 40, born_x: { year: 312 }, temper_x: 'Calm' },
          },
          model.readIndex([])
        )
      )
    );
    const peter = await current(ann, 'p1', 'el_peter');
    expect(peter).toMatchObject({ residence: 'el_sea', appearance: 'Tall', shard: '0' });
  });

  test('renames, changes aliases and the bio, retires and brings back', async () => {
    const ann = db('ann');
    await makePeter(ann);
    const change = async (input) => {
      const now = await current(ann, 'p1', 'el_peter');
      const value = model.checkElement('character', input, { current: now }).value;
      await assertSucceeds(commit(ann, model.planUpdate('p1', now, value)));
    };
    await change({ name: 'King Peter' });
    await change({ aliases: ['Peter', 'The Drowned King'] });
    await change({ aliases: ['The Drowned King'] });
    await change({ bio: '# A king' });
    let index = await readIndex(ann, 'p1');
    expect(index.entries.el_peter).toMatchObject({
      name: 'King Peter',
      aliases: ['The Drowned King'],
    });

    await assertSucceeds(commit(ann, model.planRetire('p1', await current(ann, 'p1', 'el_peter'))));
    index = await readIndex(ann, 'p1');
    expect(index.entries.el_peter).toBeUndefined();
    // A retired element can still be read and changed.
    await change({ bio: 'Lost' });

    await assertSucceeds(
      commit(ann, model.planRestore('p1', await current(ann, 'p1', 'el_peter')))
    );
    index = await readIndex(ann, 'p1');
    expect(index.entries.el_peter.name).toBe('King Peter');
  });

  test('keeps an element’s photos, with the primary one of them, and its index line (M-104)', async () => {
    const ann = db('ann');
    await makePeter(ann);
    const photos = async (next) => {
      const now = await current(ann, 'p1', 'el_peter');
      const checked = model.checkPhotos(next);
      return commit(ann, model.planUpdate('p1', now, checked.value));
    };
    await assertSucceeds(photos(model.addPhotos({ images: [], primary: null }, ['img_a', 'img_b'])));
    let peter = await current(ann, 'p1', 'el_peter');
    expect([peter.images, peter.primary]).toEqual([['img_a', 'img_b'], 'img_a']);
    expect((await readIndex(ann, 'p1')).entries.el_peter.primary).toBe('img_a');
    await assertSucceeds(photos(model.primaryPhoto(peter, 'img_b')));
    expect((await readIndex(ann, 'p1')).entries.el_peter.primary).toBe('img_b');
    peter = await current(ann, 'p1', 'el_peter');
    await assertSucceeds(photos(model.removePhoto(peter, 'img_b')));
    expect((await readIndex(ann, 'p1')).entries.el_peter.primary).toBe('img_a');
    peter = await current(ann, 'p1', 'el_peter');
    await assertSucceeds(photos(model.removePhoto(peter, 'img_a')));
    peter = await current(ann, 'p1', 'el_peter');
    expect([peter.images, peter.primary]).toEqual([[], null]);
    expect((await readIndex(ann, 'p1')).entries.el_peter.primary).toBe(null);
  });

  test('refuses a primary photo that is not among the element’s photos (M-104)', async () => {
    const ann = db('ann');
    await makePeter(ann);
    const now = await current(ann, 'p1', 'el_peter');
    const write = (data, entry) =>
      commit(ann, [
        { op: 'update', path: 'muse_projects/p1/elements/el_peter', data: { ...data, updatedAt: model.NOW } },
        {
          op: 'merge',
          path: 'muse_projects/p1/index/0',
          data: { entries: { el_peter: { ...model.entryOf(now), ...entry } }, last: 'el_peter' },
        },
      ]);
    // A primary with no images, or not among them.
    await assertFails(write({ images: [], primary: 'img_a' }, { primary: 'img_a' }));
    await assertFails(write({ images: ['img_b'], primary: 'img_a' }, { primary: 'img_a' }));
    // Too many photos.
    await assertFails(
      write({ images: Array.from({ length: 201 }, (_, i) => `img_${i}`), primary: null }, {})
    );
    // One of them is fine.
    await assertSucceeds(write({ images: ['img_a', 'img_b'], primary: 'img_b' }, { primary: 'img_b' }));
  });

  test('sets the project’s custom fields by type', async () => {
    await assertSucceeds(
      updateDoc(doc(db('ann'), 'muse_projects', 'p1'), {
        fields: {
          character: [{ key: 'age_x', label: 'Age', kind: 'number' }],
          concept: [],
        },
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('deletes elements and the index, as deleting the project does', async () => {
    const ann = db('ann');
    await makePeter(ann);
    await assertSucceeds(deleteDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter')));
    await assertSucceeds(deleteDoc(doc(ann, 'muse_projects', 'p1', 'index', '0')));
  });
});

describe('the element and its line move together', () => {
  beforeEach(() => seedProject('p1', 'ann'));

  test('an element alone is refused; so is a line alone', async () => {
    const ann = db('ann');
    const [element, line] = model.planCreate(
      'p1',
      'el_peter',
      'character',
      checked('character', { name: 'Peter' }),
      model.readIndex([])
    );
    await assertFails(commit(ann, [element]));
    await assertFails(commit(ann, [line]));
  });

  test('a rename without its line is refused', async () => {
    const ann = db('ann');
    await makePeter(ann);
    await assertFails(
      updateDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter'), {
        name: 'King Peter',
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      updateDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter'), {
        aliases: ['Pete'],
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('a line that doesn’t match its element is refused', async () => {
    const ann = db('ann');
    await makePeter(ann);
    const line = (entry, last = 'el_peter') =>
      setDoc(
        doc(ann, 'muse_projects', 'p1', 'index', '0'),
        { entries: { el_peter: entry }, last },
        { merge: true }
      );
    await assertFails(line({ type: 'character', name: 'Someone else', aliases: [], primary: null }));
    await assertFails(line({ type: 'faction', name: 'Peter', aliases: [], primary: null }));
    await assertFails(line({ type: 'character', name: 'Peter', aliases: ['Pete'], primary: null }));
    await assertFails(
      line({ type: 'character', name: 'Peter', aliases: [], primary: null, colour: 'red' })
    );
    // A line for one element, named as another's.
    await assertFails(
      line({ type: 'character', name: 'Peter', aliases: [], primary: null }, 'el_other')
    );
    // Two lines at once.
    await assertFails(
      setDoc(
        doc(ann, 'muse_projects', 'p1', 'index', '0'),
        {
          entries: { el_ghost: { type: 'object', name: 'Ghost', aliases: [], primary: null } },
          last: 'el_peter',
        },
        { merge: true }
      )
    );
  });

  test('retiring without taking the line away, or taking it away alone, is refused', async () => {
    const ann = db('ann');
    await makePeter(ann);
    await assertFails(
      updateDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter'), {
        retired: true,
        updatedAt: serverTimestamp(),
      })
    );
    await assertFails(
      setDoc(
        doc(ann, 'muse_projects', 'p1', 'index', '0'),
        { entries: { el_peter: deleteField() }, last: 'el_peter' },
        { merge: true }
      )
    );
  });

  test('an element can’t move shard, change type or reset its time', async () => {
    const ann = db('ann');
    await makePeter(ann);
    const ref = doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter');
    await assertFails(updateDoc(ref, { type: 'faction', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { shard: '1', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { bio: 'No time' }));
  });

  test('a new element can’t be born retired', async () => {
    const ann = db('ann');
    const [element] = model.planCreate(
      'p1',
      'el_peter',
      'character',
      checked('character', { name: 'Peter' }),
      model.readIndex([])
    );
    element.data.retired = true;
    await assertFails(commit(ann, [element]));
  });
});

describe('badly shaped elements are refused', () => {
  beforeEach(() => seedProject('p1', 'ann'));

  const bad = {
    'a type we don’t know': { type: 'dragon' },
    'no name': { name: '' },
    'a name too long': { name: 'x'.repeat(201) },
    'aliases that aren’t a list': { aliases: 'Pete' },
    'too many aliases': { aliases: Array.from({ length: 21 }, (_, i) => `a${i}`) },
    'a bio that isn’t text': { bio: 7 },
    'fields that aren’t a map': { fields: [] },
    'a shard that isn’t a number': { shard: 'x' },
    'a field it doesn’t know': { colour: 'red' },
    'a residence on a faction': { type: 'faction', residence: 'el_sea' },
    'an appearance on an object': { type: 'object', appearance: 'Shiny' },
    'a residence that isn’t an id': { residence: 42 },
  };

  Object.entries(bad).forEach(([name, overrides]) => {
    test(name, async () => {
      const ann = db('ann');
      const writes = model.planCreate(
        'p1',
        'el_x',
        'character',
        checked('character', { name: 'Peter' }),
        model.readIndex([])
      );
      Object.assign(writes[0].data, overrides);
      if (overrides.type === 'faction' || overrides.type === 'object') {
        delete writes[0].data[overrides.type === 'faction' ? 'appearance' : 'residence'];
      }
      // Its line matches it, so only the shape is wrong.
      writes[1] = { ...writes[1], data: { entries: { el_x: model.entryOf(writes[0].data) }, last: 'el_x' } };
      if (overrides.shard) writes[1].path = writes[1].path.replace(/\/0$/, `/${overrides.shard}`);
      await assertFails(commit(ann, writes));
    });
  });

  test('custom field definitions that aren’t lists by type', async () => {
    const ref = doc(db('ann'), 'muse_projects', 'p1');
    await assertFails(updateDoc(ref, { fields: { dragon: [] }, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { fields: { character: {} }, updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(ref, {
        fields: {
          character: Array.from({ length: 31 }, (_, i) => ({ key: `f${i}`, label: 'F', kind: 'text' })),
        },
        updatedAt: serverTimestamp(),
      })
    );
  });
});

describe('everyone else is refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await makePeter(db('ann'));
  });

  test('another user can’t read or write ann’s elements or index', async () => {
    const bob = db('bob');
    await assertFails(getDoc(doc(bob, 'muse_projects', 'p1', 'elements', 'el_peter')));
    await assertFails(getDocs(collection(bob, 'muse_projects', 'p1', 'index')));
    await assertFails(
      commit(
        bob,
        model.planCreate('p1', 'el_bob', 'object', checked('object', { name: 'Bob’s' }), model.readIndex([]))
      )
    );
    await assertFails(deleteDoc(doc(bob, 'muse_projects', 'p1', 'elements', 'el_peter')));
    await assertFails(deleteDoc(doc(bob, 'muse_projects', 'p1', 'index', '0')));
  });

  test('the owner without the muse claim is refused', async () => {
    const ann = db('ann', { apps: ['loom'] });
    await assertFails(getDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter')));
    await assertFails(getDocs(collection(ann, 'muse_projects', 'p1', 'index')));
  });

  test('a signed-out visitor is refused', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'muse_projects', 'p1', 'elements', 'el_peter')));
  });
});
