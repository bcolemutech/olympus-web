'use strict';

/**
 * Versions kept by the server (planning/the-muse.md §3 VR1, VR2, MS5; M-105 /
 * #893): the Muse connector's helper keeps a version of a project or an
 * element as it is stored, by `mcp`, before a write; the 51st deletes the
 * oldest of that thing and no other's; a thing that isn't there gets none; and
 * the plan can be done in a batch of the caller's own. Runs against the
 * Firestore emulator through the Admin SDK, which the rules don't govern.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-versions-store --verbose"
 */

const PROJECT = 'demo-muse-versions';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp, getApps } = require(
  require.resolve('firebase-admin/app', { paths: [functionsDir] })
);
const { getFirestore, FieldValue, Timestamp } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { createVersionStore, VersionError } = require('../functions/muse/version-store');
const versions = require('../functions/muse/versions');

if (!getApps().length) initializeApp({ projectId: PROJECT });
const db = getFirestore();
const store = createVersionStore({ db, FieldValue });

const PETER = 'muse_projects/p1/elements/el_peter';
const versionsOf = async (of) =>
  (await db.collection('muse_projects/p1/versions').where('of', '==', of).get()).docs.map((d) => ({
    id: d.id,
    ...d.data(),
  }));

beforeEach(async () => {
  await db.recursiveDelete(db.collection('muse_projects'));
  await db.doc('muse_projects/p1').set({
    owner: 'ann',
    title: 'The Court',
    short: '',
    summary: 'Before.',
    cover: null,
    createdAt: Timestamp.fromMillis(1000),
    updatedAt: Timestamp.fromMillis(1000),
  });
  await db.doc(PETER).set({
    type: 'character',
    name: 'King Peter',
    aliases: ['The Drowned King'],
    bio: 'Rules the tides.',
    fields: { born: { year: 312 } },
    images: [],
    primary: null,
    mentions: [],
    appearance: '',
    residence: null,
    shard: '0',
    retired: false,
    createdAt: Timestamp.fromMillis(1000),
    updatedAt: Timestamp.fromMillis(2000),
  });
});

afterAll(async () => {
  await db.recursiveDelete(db.collection('muse_projects'));
});

describe('keeping a version from the server', () => {
  test('of an element: the document as stored, kept by mcp, with the server’s time', async () => {
    const before = Date.now();
    const kept = await store.save('p1', 'elements', 'el_peter');
    expect(kept).toEqual({ id: expect.any(String), dropped: [] });
    const [version] = await versionsOf(PETER);
    expect(version).toMatchObject({
      id: kept.id,
      of: PETER,
      name: null,
      by: 'mcp',
      snapshot: {
        type: 'character',
        name: 'King Peter',
        aliases: ['The Drowned King'],
        bio: 'Rules the tides.',
        fields: { born: { year: 312 } },
        shard: '0',
        retired: false,
      },
    });
    expect(version.snapshot.id).toBeUndefined();
    // Times in the snapshot stay times, and `at` is the server's.
    expect(version.snapshot.updatedAt.toMillis()).toBe(2000);
    expect(version.at.toMillis()).toBeGreaterThanOrEqual(before - 5000);
  });

  test('of the project, with a name when one is given', async () => {
    const kept = await store.save('p1', null, null, { by: 'page', name: 'Draft one' });
    const [version] = await versionsOf('muse_projects/p1');
    expect(version).toMatchObject({
      id: kept.id,
      by: 'page',
      name: 'Draft one',
      snapshot: { owner: 'ann', title: 'The Court', summary: 'Before.' },
    });
  });

  test('is the state before the write that follows, which then changes the thing', async () => {
    await store.save('p1', 'elements', 'el_peter');
    await db.doc(PETER).update({ name: 'Peter the Second', updatedAt: FieldValue.serverTimestamp() });
    await store.save('p1', 'elements', 'el_peter');
    const kept = (await versionsOf(PETER)).sort((a, b) => a.at.toMillis() - b.at.toMillis());
    expect(kept.map((v) => v.snapshot.name)).toEqual(['King Peter', 'Peter the Second']);
    expect(kept.every((v) => v.by === 'mcp')).toBe(true);
  });

  test('of a thing that isn’t there: none, and nothing written', async () => {
    await expect(store.save('p1', 'elements', 'nope')).resolves.toBeNull();
    await expect(store.save('nope', null, null)).resolves.toBeNull();
    expect(await versionsOf('muse_projects/p1/elements/nope')).toEqual([]);
    expect((await db.collection('muse_projects/p1/versions').get()).size).toBe(0);
  });

  test('refuses what it can’t keep', async () => {
    await expect(store.save('', null, null)).rejects.toThrow(VersionError);
    await expect(store.save('p1', 'elements', '')).rejects.toThrow(/its id/);
    await expect(store.save('p1', 'elements', 'el_peter', { by: 'someone' })).rejects.toThrow(
      /page or mcp/
    );
    await expect(
      store.save('p1', 'elements', 'el_peter', { name: 'x'.repeat(101) })
    ).rejects.toThrow(/at most 100/);
    expect(await versionsOf(PETER)).toEqual([]);
  });
});

describe('the last 50', () => {
  async function fifty(of) {
    const batch = db.batch();
    for (let i = 1; i <= 50; i++) {
      batch.set(db.doc(`muse_projects/p1/versions/${of.split('/').pop()}-${String(i).padStart(2, '0')}`), {
        of,
        snapshot: { name: 'old ' + i },
        name: null,
        by: 'mcp',
        at: Timestamp.fromMillis(i * 1000),
      });
    }
    await batch.commit();
  }

  test('the 51st deletes the oldest of that thing', async () => {
    await fifty(PETER);
    const kept = await store.save('p1', 'elements', 'el_peter');
    expect(kept.dropped).toEqual(['el_peter-01']);
    const left = await versionsOf(PETER);
    expect(left).toHaveLength(50);
    expect(left.map((v) => v.id)).not.toContain('el_peter-01');
    expect(left.map((v) => v.id)).toContain('el_peter-02');
    expect(left.map((v) => v.id)).toContain(kept.id);
    // And the next deletes the next.
    const again = await store.save('p1', 'elements', 'el_peter');
    expect(again.dropped).toEqual(['el_peter-02']);
    expect(await versionsOf(PETER)).toHaveLength(50);
  });

  test('another thing’s versions are left alone', async () => {
    await fifty(PETER);
    await fifty('muse_projects/p1');
    await store.save('p1', 'elements', 'el_peter');
    expect(await versionsOf(PETER)).toHaveLength(50);
    expect(await versionsOf('muse_projects/p1')).toHaveLength(50);
    // The project's own is still at 50 until it is next kept.
    const kept = await store.save('p1', null, null);
    expect(kept.dropped).toEqual(['p1-01']);
  });

  test('more than 50 that had piled up are brought back to 50', async () => {
    await fifty(PETER);
    await db.doc('muse_projects/p1/versions/extra').set({
      of: PETER,
      snapshot: {},
      name: null,
      by: 'mcp',
      at: Timestamp.fromMillis(60000),
    });
    const kept = await store.save('p1', 'elements', 'el_peter');
    expect(kept.dropped).toEqual(['el_peter-01', 'el_peter-02']);
    expect(await versionsOf(PETER)).toHaveLength(50);
  });
});

describe('a plan in the caller’s own batch', () => {
  test('is prepared, then done with the write it goes before', async () => {
    const plan = await store.prepare('p1', 'elements', 'el_peter');
    expect(plan.writes[0].path).toBe(`muse_projects/p1/versions/${plan.id}`);
    expect(versions.isNow(plan.writes[0].data.at)).toBe(true);
    const batch = db.batch();
    store.apply(batch, plan.writes);
    batch.update(db.doc(PETER), { name: 'Peter the Second' });
    await batch.commit();
    expect((await db.doc(PETER).get()).get('name')).toBe('Peter the Second');
    const [version] = await versionsOf(PETER);
    expect(version.snapshot.name).toBe('King Peter');
    expect(version.at.toMillis()).toBeGreaterThan(0);
  });

  test('a thing that isn’t there has no plan', async () => {
    await expect(store.prepare('p1', 'elements', 'nope')).resolves.toBeNull();
  });
});
