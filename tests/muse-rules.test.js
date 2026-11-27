'use strict';

/**
 * The Muse's projects under the Firestore rules (planning/the-muse.md §3 MU4,
 * D1, §4; M-101 / #889): the owner, with the muse claim, reads and writes
 * their projects; another user, or a user without the claim, is refused; and
 * badly shaped documents are refused.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-rules --verbose"
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
  serverTimestamp,
  Timestamp,
} = require('firebase/firestore');

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

// A new project as the page makes it.
const newProject = (owner, overrides = {}) => ({
  owner,
  title: 'The Drowned Kingdom',
  short: 'A sea that took a crown',
  summary: '',
  cover: null,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  ...overrides,
});

// Seeds a project with the rules off.
async function seed(id, owner, extra = {}) {
  await testEnv.withSecurityRulesDisabled((ctx) =>
    setDoc(doc(ctx.firestore(), 'muse_projects', id), {
      owner,
      title: 'Seeded',
      short: '',
      summary: '# Seeded',
      cover: null,
      createdAt: Timestamp.fromMillis(1000),
      updatedAt: Timestamp.fromMillis(1000),
      ...extra,
    })
  );
}

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

describe('the owner', () => {
  test('makes a project', async () => {
    await assertSucceeds(setDoc(doc(db('ann'), 'muse_projects', 'p1'), newProject('ann')));
  });

  test('makes one with every later field (fields, lanes, calendar, a cover)', async () => {
    await assertSucceeds(
      setDoc(
        doc(db('ann'), 'muse_projects', 'p1'),
        newProject('ann', { cover: 'img_abc', fields: {}, lanes: [], calendar: {} })
      )
    );
  });

  test('reads their project, and lists their projects by owner', async () => {
    await seed('p1', 'ann');
    await seed('p2', 'bob');
    await assertSucceeds(getDoc(doc(db('ann'), 'muse_projects', 'p1')));
    const snap = await assertSucceeds(
      getDocs(query(collection(db('ann'), 'muse_projects'), where('owner', '==', 'ann')))
    );
    expect(snap.docs.map((d) => d.id)).toEqual(['p1']);
  });

  test('renames it, and edits its short description, summary and cover', async () => {
    await seed('p1', 'ann');
    await assertSucceeds(
      updateDoc(doc(db('ann'), 'muse_projects', 'p1'), {
        title: 'Renamed',
        short: 'Shorter',
        summary: '## A summary\n\nIn **Markdown**.',
        cover: 'img_cover',
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('deletes it', async () => {
    await seed('p1', 'ann');
    await assertSucceeds(deleteDoc(doc(db('ann'), 'muse_projects', 'p1')));
  });
});

describe('everyone else is refused', () => {
  test('another user can’t read, list, change or delete it', async () => {
    await seed('p1', 'ann');
    const bob = db('bob');
    await assertFails(getDoc(doc(bob, 'muse_projects', 'p1')));
    await assertFails(getDocs(collection(bob, 'muse_projects')));
    await assertFails(
      getDocs(query(collection(bob, 'muse_projects'), where('owner', '==', 'ann')))
    );
    await assertFails(
      updateDoc(doc(bob, 'muse_projects', 'p1'), { title: 'Mine', updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(bob, 'muse_projects', 'p1')));
  });

  test('a user can’t make a project for someone else', async () => {
    await assertFails(setDoc(doc(db('bob'), 'muse_projects', 'p1'), newProject('ann')));
  });

  test('the owner can’t hand a project to someone else', async () => {
    await seed('p1', 'ann');
    await assertFails(
      updateDoc(doc(db('ann'), 'muse_projects', 'p1'), {
        owner: 'bob',
        updatedAt: serverTimestamp(),
      })
    );
  });

  test('the owner without the muse claim is refused everything', async () => {
    await seed('p1', 'ann');
    const ann = db('ann', { apps: ['cartographer'] });
    await assertFails(getDoc(doc(ann, 'muse_projects', 'p1')));
    await assertFails(
      getDocs(query(collection(ann, 'muse_projects'), where('owner', '==', 'ann')))
    );
    await assertFails(setDoc(doc(ann, 'muse_projects', 'p2'), newProject('ann')));
    await assertFails(
      updateDoc(doc(ann, 'muse_projects', 'p1'), { title: 'X', updatedAt: serverTimestamp() })
    );
    await assertFails(deleteDoc(doc(ann, 'muse_projects', 'p1')));
  });

  test('a signed-out visitor is refused', async () => {
    await seed('p1', 'ann');
    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, 'muse_projects', 'p1')));
    await assertFails(setDoc(doc(anon, 'muse_projects', 'p2'), newProject('ann')));
  });

  test('its subcollections are closed until their stories give them rules', async () => {
    await seed('p1', 'ann');
    await assertFails(
      setDoc(doc(db('ann'), 'muse_projects', 'p1', 'relationships', 'r1'), { a: 'e1', b: 'e2' })
    );
  });
});

describe('badly shaped projects are refused', () => {
  const bad = {
    'no title': { title: '' },
    'a title too long': { title: 'x'.repeat(201) },
    'a title that is not text': { title: 42 },
    'a short description too long': { short: 'x'.repeat(301) },
    'a summary that is not text': { summary: ['no'] },
    'a cover that is not an id': { cover: 7 },
    'an empty cover id': { cover: '' },
    'fields that are not a map': { fields: 'x' },
    'lanes that are not a list': { lanes: {} },
    'a calendar that is not a map': { calendar: ['Hammer'] },
    'a calendar with a part it doesn’t know': { calendar: { moons: [] } },
    'a calendar’s months not a list': { calendar: { months: 'Hammer' } },
    'a calendar of 101 months': { calendar: { months: new Array(101).fill({ name: 'M', days: 1 }) } },
    'a week of 31 days': { calendar: { weekdays: new Array(31).fill('Day') } },
    'a calendar of 25 seasons': { calendar: { seasons: new Array(25).fill({}) } },
    'a calendar of 21 eras': { calendar: { eras: new Array(21).fill({}) } },
    'a day of no hours': { calendar: { hoursPerDay: 0 } },
    'an hour of 101 minutes': { calendar: { minutesPerHour: 101 } },
    'a first weekday that is not a whole number': { calendar: { firstWeekday: 1.5 } },
    'a pattern that is not text': { calendar: { format: 3 } },
    'a pattern too long': { calendar: { format: 'x'.repeat(101) } },
    'a field it doesn’t know': { colour: 'red' },
    'a made-up time': { createdAt: Timestamp.fromMillis(5) },
  };

  Object.entries(bad).forEach(([name, overrides]) => {
    test(`on create: ${name}`, async () => {
      await assertFails(
        setDoc(doc(db('ann'), 'muse_projects', 'p1'), newProject('ann', overrides))
      );
    });
  });

  test('a whole calendar is kept, and changed (M-301)', async () => {
    await seed('p1', 'ann');
    const ref = doc(db('ann'), 'muse_projects', 'p1');
    const calendar = require('../functions/muse/calendar.js');
    await assertSucceeds(updateDoc(ref, { calendar: calendar.gregorian(), updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(ref, { calendar: calendar.blank(), updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(ref, { calendar: { hoursPerDay: 'many' }, updatedAt: serverTimestamp() })
    );
  });

  test('on create: a missing summary', async () => {
    const data = newProject('ann');
    delete data.summary;
    await assertFails(setDoc(doc(db('ann'), 'muse_projects', 'p1'), data));
  });

  test('on update: a badly shaped change, a moved createdAt, a stale updatedAt', async () => {
    await seed('p1', 'ann');
    const ref = doc(db('ann'), 'muse_projects', 'p1');
    await assertFails(updateDoc(ref, { title: '', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, { extra: true, updatedAt: serverTimestamp() }));
    await assertFails(
      updateDoc(ref, { createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    );
    await assertFails(updateDoc(ref, { title: 'No time' }));
  });
});
