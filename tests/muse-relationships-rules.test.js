'use strict';

/**
 * The Muse's relationships and mentions under the Firestore rules
 * (planning/the-muse.md §3 EL3, EL6, D1, §4; M-103 / #891): the owner makes,
 * changes and removes a relationship between two elements of the project, as
 * the page's plans do, and reads one from either end with the queries the
 * page uses (`ends` and `mentions` array-contains); badly shaped ones, ones
 * with an end that isn't there, and changes to the ends are refused; and no
 * one else reads or writes them.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-relationships-rules --verbose"
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
  deleteField,
  Timestamp,
} = require('firebase/firestore');
const model = require('../public/apps/muse/js/model.js');
const links = require('../public/apps/muse/js/links.js');

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

// A plan from ./model.js or ./links.js done as one batch, as the page does it.
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
    if (op === 'delete') batch.delete(ref);
    else if (op === 'set') batch.set(ref, toSdk(data));
    else if (op === 'merge') batch.set(ref, toSdk(data), { merge: true });
    else batch.update(ref, toSdk(data));
  });
  return batch.commit();
}

async function seedProject(id, owner) {
  await testEnv.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'muse_projects', id), {
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

const checked = (type, input) => model.checkElement(type, input, {}).value;

// Two elements made the way the page makes them, with their index lines.
async function makeElements(firestore, names = { el_marta: 'Marta', el_peter: 'Peter' }) {
  const index = model.readIndex([]);
  for (const [id, name] of Object.entries(names)) {
    const writes = model.planCreate('p1', id, 'character', checked('character', { name }), index);
    await commit(firestore, writes);
    model.applyToIndex(index, writes);
  }
}

const relate = (firestore, id = 'r1', over = {}) =>
  commit(
    firestore,
    links.planRelate('p1', id, {
      a: 'el_marta',
      b: 'el_peter',
      aToB: 'mother of',
      bToA: 'son of',
      description: 'Raised him alone.',
      ...over,
    })
  );

const relDoc = (firestore, id = 'r1') =>
  doc(firestore, 'muse_projects', 'p1', 'relationships', id);

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
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await makeElements(db('ann'));
  });

  test('makes a relationship, and reads it from either end', async () => {
    const ann = db('ann');
    await assertSucceeds(relate(ann));
    const of = async (id) =>
      (
        await getDocs(
          query(
            collection(ann, 'muse_projects', 'p1', 'relationships'),
            where('ends', 'array-contains', id)
          )
        )
      ).docs.map((d) => links.sideOf({ id: d.id, ...d.data() }, id));
    expect(await of('el_marta')).toEqual([
      {
        id: 'r1',
        other: 'el_peter',
        kind: 'mother of',
        back: 'son of',
        description: 'Raised him alone.',
      },
    ]);
    expect(await of('el_peter')).toEqual([
      {
        id: 'r1',
        other: 'el_marta',
        kind: 'son of',
        back: 'mother of',
        description: 'Raised him alone.',
      },
    ]);
    expect(await of('el_other')).toEqual([]);
  });

  test('allows more than one between the same two elements', async () => {
    const ann = db('ann');
    await assertSucceeds(relate(ann, 'r1'));
    await assertSucceeds(relate(ann, 'r2', { aToB: 'rival of', bToA: 'rival of' }));
  });

  test('changes the words and the description, and removes it', async () => {
    const ann = db('ann');
    await relate(ann);
    await assertSucceeds(
      commit(
        ann,
        links.planRelationshipUpdate('p1', 'r1', {
          aToB: 'guardian of',
          bToA: 'ward of',
          description: '',
        })
      )
    );
    expect((await getDoc(relDoc(ann))).data()).toMatchObject({
      a: 'el_marta',
      b: 'el_peter',
      aToB: 'guardian of',
      bToA: 'ward of',
      description: '',
      ends: ['el_marta', 'el_peter'],
    });
    await assertSucceeds(commit(ann, links.planUnrelate('p1', 'r1')));
    expect((await getDoc(relDoc(ann))).exists()).toBe(false);
  });

  test('keeps a relationship when one end is retired', async () => {
    const ann = db('ann');
    await relate(ann);
    const now = {
      id: 'el_peter',
      ...(await getDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter'))).data(),
    };
    await assertSucceeds(commit(ann, model.planRetire('p1', now)));
    await assertSucceeds(
      commit(
        ann,
        links.planRelationshipUpdate('p1', 'r1', {
          aToB: 'mother of',
          bToA: 'son of',
          description: 'Still true.',
        })
      )
    );
  });

  test('finds the elements that link to one by `mentions`', async () => {
    const ann = db('ann');
    const peter = {
      id: 'el_peter',
      ...(await getDoc(doc(ann, 'muse_projects', 'p1', 'elements', 'el_peter'))).data(),
    };
    const value = model.checkElement(
      'character',
      { bio: 'Son of [Marta](muse:el/el_marta).' },
      { current: peter }
    ).value;
    await assertSucceeds(commit(ann, model.planUpdate('p1', peter, value)));
    const snap = await getDocs(
      query(
        collection(ann, 'muse_projects', 'p1', 'elements'),
        where('mentions', 'array-contains', 'el_marta')
      )
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['el_peter']);
  });

  test('is deleted with the rest of the project', async () => {
    const ann = db('ann');
    await relate(ann);
    await assertSucceeds(deleteDoc(relDoc(ann)));
  });
});

describe('badly shaped relationships are refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await makeElements(db('ann'));
  });

  // A relationship written by hand, from a good one, with changes.
  const raw = (firestore, id, over) =>
    setDoc(relDoc(firestore, id), {
      a: 'el_marta',
      b: 'el_peter',
      aToB: 'mother of',
      bToA: 'son of',
      description: '',
      ends: ['el_marta', 'el_peter'],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...over,
    });

  test('the hand-written good one is accepted', async () => {
    await assertSucceeds(raw(db('ann'), 'ok', {}));
  });

  test.each([
    ['with an end that isn’t an element', { b: 'el_nobody', ends: ['el_marta', 'el_nobody'] }],
    ['to itself', { b: 'el_marta', ends: ['el_marta', 'el_marta'] }],
    ['whose ends don’t match its `ends`', { ends: ['el_peter', 'el_marta'] }],
    ['with no words', { aToB: '' }],
    ['with no words back', { bToA: '' }],
    ['with words too long', { aToB: 'x'.repeat(101) }],
    ['with a description too long', { description: 'x'.repeat(1001) }],
    ['with words that aren’t text', { aToB: 5 }],
    ['with a field it shouldn’t have', { when: { year: 3 } }],
    ['with a time that isn’t the server’s', { createdAt: Timestamp.fromMillis(5) }],
  ])('%s', async (_, over) => {
    await assertFails(raw(db('ann'), 'bad', over));
  });

  test('without a required field', async () => {
    await assertFails(
      setDoc(relDoc(db('ann'), 'bad'), {
        a: 'el_marta',
        b: 'el_peter',
        aToB: 'x',
        bToA: 'y',
        ends: ['el_marta', 'el_peter'],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('the ends and the made time can’t be changed afterwards', async () => {
    const ann = db('ann');
    await relate(ann);
    const change = (data) => updateDoc(relDoc(ann), { updatedAt: serverTimestamp(), ...data });
    await assertFails(change({ b: 'el_marta', ends: ['el_marta', 'el_marta'] }));
    await assertFails(change({ a: 'el_peter', b: 'el_marta', ends: ['el_peter', 'el_marta'] }));
    await assertFails(change({ createdAt: Timestamp.fromMillis(5) }));
    await assertFails(updateDoc(relDoc(ann), { aToB: 'x' })); // not stamped
    await assertSucceeds(change({ aToB: 'x' }));
  });
});

describe('everyone else is refused', () => {
  beforeEach(async () => {
    await seedProject('p1', 'ann');
    await makeElements(db('ann'));
    await relate(db('ann'));
  });

  test('another user can’t read, write or delete ann’s relationships', async () => {
    const bob = db('bob');
    await assertFails(getDoc(relDoc(bob)));
    await assertFails(
      getDocs(
        query(
          collection(bob, 'muse_projects', 'p1', 'relationships'),
          where('ends', 'array-contains', 'el_marta')
        )
      )
    );
    await assertFails(relate(bob, 'r2'));
    await assertFails(
      commit(
        bob,
        links.planRelationshipUpdate('p1', 'r1', { aToB: 'x', bToA: 'y', description: '' })
      )
    );
    await assertFails(deleteDoc(relDoc(bob)));
  });

  test('the owner without the muse claim is refused', async () => {
    const ann = db('ann', { apps: ['loom'] });
    await assertFails(getDoc(relDoc(ann)));
    await assertFails(relate(ann, 'r2'));
  });

  test('a signed-out visitor is refused', async () => {
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(relDoc(anon)));
  });
});
