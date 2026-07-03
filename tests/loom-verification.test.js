'use strict';

/**
 * Phase 1 exit-criterion verification harness (L-131 / #308).
 *
 * This is the sign-off gate for The Loom's MVP milestone (design doc §10):
 * a scripted multi-session scenario against the real shattered-coast canon
 * world, exercising all three failure modes the whole project's thesis
 * rests on, plus resume:
 *
 *   1. Hard state set early (a location change + world clock tick) survives
 *      a simulated session gap untouched.
 *   2. A seeded rule rejects an illegal move even when the mocked model's
 *      narration lies about succeeding.
 *   3. An NPC's prior-session history is retrieved and surfaced to NARRATE
 *      when the player re-enters their scene after the gap.
 *   4. A model-invented entity is quarantined in World State on its first
 *      mention and only promoted on its second — it never silently becomes
 *      canon, and the frozen canon module is provably untouched throughout.
 *
 * Uses the same mocked-functions/gemini.js + Firestore emulator harness as
 * tests/loom-turn.test.js (L-130 / #307), but drives loomCreateSave for a
 * realistic save and narrates one continuous adventure across a simulated
 * session gap rather than isolated per-mechanism cases.
 *
 * Run: firebase emulators:exec --only firestore --project demo-loom-test "cd tests && npx jest loom-verification --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-loom-test';

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const functionsTest = require('firebase-functions-test')({ projectId: 'demo-loom-test' }, null);

const admin = require('firebase-admin');
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-loom-test' });
}
const db = admin.firestore();

const { loomPlayTurn, loomCreateSave, loomDeleteSave } = require('../functions/index');
const loomCanon = require('../functions/loom-canon');
const { normalizeEntityName, softCanonDocId } = require('../functions/loom-turn/soft-canon');
const { makePlayerAction, makeAiResponse } = require('./fixtures/loom');

const TEST_UID = 'exit-criterion-player';
const WORLD_ID = 'shattered-coast';
const CAPTAIN_GREETING =
  'Captain Orla Vance raises a scarred hand in greeting and mutters that her bosun, a ' +
  "one-eyed hand named Bramwell, will see to the ship's papers.";

function callCreate(data) {
  return loomCreateSave.run({
    data,
    auth: { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

function callTurn(data) {
  return loomPlayTurn.run({
    data,
    auth: { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

function callDelete(data) {
  return loomDeleteSave.run({
    data,
    auth: { uid: TEST_UID, token: { apps: ['loom'], admin: false } },
  });
}

/** Default mock: routes by system prompt content, same convention as loom-turn.test.js. */
function defaultCallGeminiImplementation(options) {
  if (options.systemInstruction.indexOf('INTERPRET stage') !== -1) {
    return Promise.resolve(makePlayerAction());
  }
  if (options.systemInstruction.indexOf('summarizer') !== -1) {
    return Promise.resolve('A summary of recent events.');
  }
  return Promise.resolve(makeAiResponse());
}

let saveId;

beforeEach(() => {
  mockCallGemini.mockReset();
  mockCallGemini.mockImplementation(defaultCallGeminiImplementation);
});

afterAll(async () => {
  if (saveId) {
    const saveRef = db.collection('loom_saves').doc(saveId);
    const turnsSnap = await saveRef.collection('loom_turns').get();
    await Promise.all(turnsSnap.docs.map((d) => d.ref.delete()));
    await saveRef.delete().catch(() => {});
  }
  await db
    .collection('loom_world_state')
    .doc(WORLD_ID)
    .delete()
    .catch(() => {});
  await db
    .collection('loom_softcanon')
    .doc(softCanonDocId(WORLD_ID, normalizeEntityName('Bramwell')))
    .delete()
    .catch(() => {});
  functionsTest.cleanup();
});

describe('Phase 1 exit criterion — hard state, seeded rules, canon integrity, and resume', () => {
  // Snapshotted once, before the scenario runs, so the final check can prove
  // nothing in the frozen canon module moved even by reference.
  const canonBefore = JSON.stringify(loomCanon.getWorld(WORLD_ID));

  it('Session 1 — establishes hard state and a first, unpromoted entity mention', async () => {
    const created = await callCreate({
      worldId: WORLD_ID,
      name: 'Exit Criterion Run',
      characterName: 'Ishmael',
    });
    saveId = created.saveId;

    // Turn 1 — meet the captain in the starting scene; the model invents a
    // one-off NPC that must NOT be promoted to World State on a single
    // mention (failure mode: silently contradicting canon).
    mockCallGemini
      .mockImplementationOnce(() =>
        makePlayerAction({ verb: 'talk', targets: ['captain-orla-vance'] })
      )
      .mockImplementationOnce(() =>
        makeAiResponse({ narration: CAPTAIN_GREETING, inventedEntities: ['Bramwell'] })
      );
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'talk to the captain' });

    const bramwellFlag = 'entity_' + normalizeEntityName('Bramwell');
    let worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().globalFlags[bramwellFlag]).toBeUndefined();

    // Turn 2 — a legal move. This is the hard fact that must survive the gap
    // (failure mode: forgetting hard state).
    mockCallGemini.mockImplementationOnce(() =>
      makePlayerAction({ verb: 'move', targets: ['skeleton-cove'] })
    );
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'row to skeleton cove' });

    const saveSnap = await db.collection('loom_saves').doc(saveId).get();
    expect(saveSnap.data().location).toBe('skeleton-cove');
    worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().worldClock).toBe(1);
  });

  it('Session gap — resume reads the same hard state back from storage, not process memory', async () => {
    // Nothing in this test process is carried forward except the saveId
    // string — every read below hits Firestore fresh, standing in for the
    // player closing the app and coming back another day.
    const saveSnap = await db.collection('loom_saves').doc(saveId).get();
    expect(saveSnap.data().location).toBe('skeleton-cove');

    const worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().worldClock).toBe(1);
  });

  it('Session 2 — a seeded rule rejects an illegal move regardless of what the narration claims', async () => {
    // Skeleton Cove only connects back to Widow's Reach — there is no direct
    // path to Fort Augustine. The mocked model lies and claims arrival
    // anyway; ADJUDICATE must still block it (failure mode: breaking the
    // seeded rules).
    mockCallGemini
      .mockImplementationOnce(() => makePlayerAction({ verb: 'move', targets: ['fort-augustine'] }))
      .mockImplementationOnce(() =>
        makeAiResponse({ narration: 'You slip past the battery and arrive at Fort Augustine!' })
      );
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'sail straight for fort augustine' });

    const saveSnap = await db.collection('loom_saves').doc(saveId).get();
    expect(saveSnap.data().location).toBe('skeleton-cove');
  });

  it("Session 2 — re-entering a scene surfaces the NPC's prior-session history to NARRATE", async () => {
    // Row back to Widow's Reach, where Captain Orla Vance is, and confirm
    // this turn's NARRATE call actually receives session 1's narration about
    // her — the memory the design doc calls entity-keyed retrieval.
    mockCallGemini.mockImplementationOnce(() =>
      makePlayerAction({ verb: 'move', targets: ['widows-reach'] })
    );
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'row back to widows reach' });

    let sawPriorHistory = false;
    mockCallGemini
      .mockImplementationOnce(() =>
        makePlayerAction({ verb: 'talk', targets: ['captain-orla-vance'] })
      )
      .mockImplementationOnce((options) => {
        sawPriorHistory = options.userMessage.indexOf('raises a scarred hand in greeting') !== -1;
        return makeAiResponse({ narration: 'She nods, recognizing you from before.' });
      });
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'talk to the captain again' });

    expect(sawPriorHistory).toBe(true);
  });

  it('Session 2 — a second mention promotes the invented entity into World State, never into canon', async () => {
    mockCallGemini
      .mockImplementationOnce(() => makePlayerAction({ verb: 'talk', targets: ['Bramwell'] }))
      .mockImplementationOnce(() =>
        makeAiResponse({
          narration: 'Bramwell the bosun nods at you from across the deck.',
          inventedEntities: ['Bramwell'],
        })
      );
    await callTurn({ worldId: WORLD_ID, saveId, actionText: 'greet bramwell' });

    const bramwellFlag = 'entity_' + normalizeEntityName('Bramwell');
    const worldStateSnap = await db.collection('loom_world_state').doc(WORLD_ID).get();
    expect(worldStateSnap.data().globalFlags[bramwellFlag]).toBe('Bramwell');

    // Promotion happened in World State only — the frozen canon module was
    // never touched, and still has no idea Bramwell exists.
    const canonAfter = JSON.stringify(loomCanon.getWorld(WORLD_ID));
    expect(canonAfter).toBe(canonBefore);
    expect(
      Object.values(loomCanon.getWorld(WORLD_ID).characters).some((c) => c.name === 'Bramwell')
    ).toBe(false);
  });

  it('cleans up the run', async () => {
    await callDelete({ saveId });
    const saveSnap = await db.collection('loom_saves').doc(saveId).get();
    expect(saveSnap.exists).toBe(false);
  });
});
