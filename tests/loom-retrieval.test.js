'use strict';

/**
 * Integration tests for functions/loom-turn/retrieval.js (L-117).
 *
 * Runs against the Firestore emulator to exercise the real array-contains
 * query (the emulator auto-indexes locally; the production composite index
 * is declared in firestore.indexes.json).
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-retrieval --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

const admin = require('firebase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-loom-test' });
}
const db = admin.firestore();

const {
  DEFAULT_LIMIT_PER_ENTITY,
  getEntityHistory,
  getEntityDisposition,
  retrieveEntityContext,
  retrieveContextForEntities,
} = require('../functions/loom-turn/retrieval');

const SAVE_ID = 'retrieval-test-save';

function saveRef() {
  return db.collection('loom_saves').doc(SAVE_ID);
}

function makeTurn(index, entityRefs, overrides) {
  return Object.assign(
    {
      index,
      actionText: 'do something turn ' + index,
      proposedAction: { verb: 'look', targets: [], params: {} },
      resolution: { outcome: 'success', mutations: [], constraints: [] },
      narration: 'Narration for turn ' + index,
      entityRefs,
    },
    overrides
  );
}

async function seedTurns(turns) {
  const batch = db.batch();
  turns.forEach((turn) => {
    batch.set(saveRef().collection('loom_turns').doc('turn-' + turn.index), turn);
  });
  await batch.commit();
}

async function clearTurns() {
  const snap = await saveRef().collection('loom_turns').get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

afterEach(async () => {
  await clearTurns();
});

describe('getEntityHistory', () => {
  it('returns only turns referencing the given entity, oldest first', async () => {
    await seedTurns([
      makeTurn(0, ['captain-orla-vance']),
      makeTurn(1, ['old-mireille']),
      makeTurn(2, ['captain-orla-vance', 'commandant-de-alva']),
      makeTurn(3, ['old-mireille']),
    ]);

    const history = await getEntityHistory({ saveRef: saveRef(), entityId: 'captain-orla-vance' });

    expect(history.map((t) => t.index)).toEqual([0, 2]);
  });

  it('returns an empty array when the entity has no history', async () => {
    await seedTurns([makeTurn(0, ['old-mireille'])]);
    const history = await getEntityHistory({ saveRef: saveRef(), entityId: 'nonexistent-npc' });
    expect(history).toEqual([]);
  });

  it('bounds results to the requested limit, keeping the most recent turns', async () => {
    const turns = [];
    for (let i = 0; i < DEFAULT_LIMIT_PER_ENTITY + 3; i++) {
      turns.push(makeTurn(i, ['recurring-npc']));
    }
    await seedTurns(turns);

    const history = await getEntityHistory({ saveRef: saveRef(), entityId: 'recurring-npc' });

    expect(history).toHaveLength(DEFAULT_LIMIT_PER_ENTITY);
    // Oldest-first among the most recent N: the last DEFAULT_LIMIT_PER_ENTITY indices.
    const expectedIndices = turns.slice(-DEFAULT_LIMIT_PER_ENTITY).map((t) => t.index);
    expect(history.map((t) => t.index)).toEqual(expectedIndices);
  });

  it('respects a custom limit override', async () => {
    await seedTurns([
      makeTurn(0, ['npc']),
      makeTurn(1, ['npc']),
      makeTurn(2, ['npc']),
    ]);

    const history = await getEntityHistory({ saveRef: saveRef(), entityId: 'npc', limit: 2 });
    expect(history.map((t) => t.index)).toEqual([1, 2]);
  });
});

describe('getEntityDisposition', () => {
  it('returns the stored disposition for a known entity', () => {
    const save = { relationships: { 'old-mireille': 'trusted' } };
    expect(getEntityDisposition(save, 'old-mireille')).toBe('trusted');
  });

  it('returns null when the entity has no recorded relationship', () => {
    const save = { relationships: {} };
    expect(getEntityDisposition(save, 'old-mireille')).toBeNull();
  });

  it('returns null when relationships is missing entirely', () => {
    expect(getEntityDisposition({}, 'old-mireille')).toBeNull();
  });
});

describe('retrieveEntityContext', () => {
  it('combines turn history and disposition for one entity', async () => {
    await seedTurns([makeTurn(0, ['old-mireille']), makeTurn(1, ['someone-else'])]);
    const save = { relationships: { 'old-mireille': 'wary' } };

    const context = await retrieveEntityContext({
      saveRef: saveRef(),
      save,
      entityId: 'old-mireille',
    });

    expect(context.entityId).toBe('old-mireille');
    expect(context.turns.map((t) => t.index)).toEqual([0]);
    expect(context.disposition).toBe('wary');
  });
});

describe('retrieveContextForEntities', () => {
  it('returns a context entry per unique entity, deduplicating and skipping falsy ids', async () => {
    await seedTurns([
      makeTurn(0, ['captain-orla-vance']),
      makeTurn(1, ['old-mireille']),
    ]);
    const save = { relationships: { 'captain-orla-vance': 'ally', 'old-mireille': 'wary' } };

    const contexts = await retrieveContextForEntities({
      saveRef: saveRef(),
      save,
      entityIds: ['captain-orla-vance', 'captain-orla-vance', null, 'old-mireille', ''],
    });

    expect(contexts).toHaveLength(2);
    const byId = Object.fromEntries(contexts.map((c) => [c.entityId, c]));
    expect(byId['captain-orla-vance'].disposition).toBe('ally');
    expect(byId['old-mireille'].disposition).toBe('wary');
  });

  it('returns an empty array for an empty entity list', async () => {
    const contexts = await retrieveContextForEntities({ saveRef: saveRef(), save: {}, entityIds: [] });
    expect(contexts).toEqual([]);
  });
});
