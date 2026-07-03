'use strict';

/**
 * Unit tests for functions/loom-turn/narrate.js (L-113).
 *
 * Mocks functions/gemini.js's callGemini and functions/loom-turn/retrieval.js
 * to test NARRATE's context assembly and fallback behavior in isolation.
 * Uses the real Shattered Coast canon world (L-103) for realistic entity ids.
 * Does not require the Firestore emulator.
 *
 * Run: cd tests && npx jest loom-narrate --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const mockRetrieveContextForEntities = jest.fn();
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: (...args) => mockRetrieveContextForEntities(...args),
}));

const { narrateResolution, resolveSceneEntityIds } = require('../functions/loom-turn/narrate');
const { getWorld } = require('../functions/loom-canon');

const CANON_WORLD = getWorld('shattered-coast');

function makeParams(overrides) {
  return Object.assign(
    {
      actionText: 'look around',
      proposedAction: { verb: 'look', targets: [], params: {} },
      resolution: { outcome: 'acknowledged', mutations: [], constraints: [] },
      canonWorld: CANON_WORLD,
      save: { location: 'widows-reach', recentSummary: '' },
      worldState: {},
      saveRef: {},
    },
    overrides
  );
}

beforeEach(() => {
  mockCallGemini.mockReset();
  mockRetrieveContextForEntities.mockReset();
  mockRetrieveContextForEntities.mockResolvedValue([]);
});

describe('resolveSceneEntityIds', () => {
  it("includes the current location's default cast", () => {
    const ids = resolveSceneEntityIds(CANON_WORLD, { location: 'widows-reach' }, { targets: [] });
    expect(ids).toEqual(expect.arrayContaining(['captain-orla-vance', 'pirate-brethren']));
  });

  it('includes resolved proposedAction targets', () => {
    const ids = resolveSceneEntityIds(
      CANON_WORLD,
      { location: null },
      { targets: ['commandant-de-alva'] }
    );
    expect(ids).toEqual(['commandant-de-alva']);
  });

  it('drops unresolved raw-text targets', () => {
    const ids = resolveSceneEntityIds(
      CANON_WORLD,
      { location: null },
      { targets: ['a mysterious stranger'] }
    );
    expect(ids).toEqual([]);
  });

  it('dedupes ids present in both the scene cast and targets', () => {
    const ids = resolveSceneEntityIds(
      CANON_WORLD,
      { location: 'widows-reach' },
      { targets: ['captain-orla-vance'] }
    );
    expect(ids.filter((id) => id === 'captain-orla-vance')).toHaveLength(1);
  });
});

describe('narrateResolution', () => {
  it('passes the resolution outcome and every constraint into the model prompt', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: [],
      suggestedActions: [],
    });
    await narrateResolution(
      makeParams({
        resolution: {
          outcome: 'success',
          mutations: [],
          constraints: ['You arrive at Skeleton Cove.', 'The tide turns.'],
        },
      })
    );

    const callArgs = mockCallGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('success');
    expect(callArgs.userMessage).toContain('You arrive at Skeleton Cove.');
    expect(callArgs.userMessage).toContain('The tide turns.');
  });

  it('returns the model narration, invented entities, and suggested actions', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'The captain nods grimly.',
      inventedEntities: ['a barkeep named Doral'],
      suggestedActions: ['ask about the job'],
    });

    const result = await narrateResolution(makeParams());

    expect(result.narration).toBe('The captain nods grimly.');
    expect(result.inventedEntities).toEqual(['a barkeep named Doral']);
    expect(result.suggestedActions).toEqual(['ask about the job']);
  });

  it('includes resolved scene entities in entityRefs', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: [],
      suggestedActions: [],
    });
    const result = await narrateResolution(makeParams({ save: { location: 'widows-reach' } }));
    expect(result.entityRefs).toEqual(
      expect.arrayContaining(['captain-orla-vance', 'pirate-brethren'])
    );
  });

  it('falls back to a constraint-based narration when callGemini throws', async () => {
    mockCallGemini.mockRejectedValueOnce(new Error('AI unavailable'));
    const result = await narrateResolution(
      makeParams({
        resolution: {
          outcome: 'blocked',
          mutations: [],
          constraints: ['You cannot get there directly from here.'],
        },
      })
    );
    expect(result.narration).toContain('You cannot get there directly from here.');
    expect(result.inventedEntities).toEqual([]);
    expect(result.suggestedActions).toEqual([]);
  });

  it('falls back to a constraint-based narration when the model returns malformed output', async () => {
    mockCallGemini.mockResolvedValueOnce({ inventedEntities: [] }); // missing narration
    const result = await narrateResolution(
      makeParams({
        resolution: { outcome: 'failure', mutations: [], constraints: ['The lock does not budge.'] },
      })
    );
    expect(result.narration).toContain('The lock does not budge.');
  });

  it('sanitizes non-string entries out of inventedEntities and suggestedActions', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: ['Real Name', 42, '', null],
      suggestedActions: ['do a thing', 7],
    });
    const result = await narrateResolution(makeParams());
    expect(result.inventedEntities).toEqual(['Real Name']);
    expect(result.suggestedActions).toEqual(['do a thing']);
  });

  it('calls retrieveContextForEntities with the resolved scene entity ids', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: [],
      suggestedActions: [],
    });
    await narrateResolution(makeParams({ save: { location: 'widows-reach' } }));

    const callArgs = mockRetrieveContextForEntities.mock.calls[0][0];
    expect(callArgs.entityIds).toEqual(
      expect.arrayContaining(['captain-orla-vance', 'pirate-brethren'])
    );
  });

  it('includes entity canon snippets and history in the prompt', async () => {
    mockRetrieveContextForEntities.mockResolvedValueOnce([
      {
        entityId: 'captain-orla-vance',
        turns: [{ narration: 'She warned you once already.' }],
        disposition: 'wary',
      },
    ]);
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: [],
      suggestedActions: [],
    });

    await narrateResolution(makeParams());

    const callArgs = mockCallGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('Captain Orla Vance');
    expect(callArgs.userMessage).toContain('She warned you once already.');
    expect(callArgs.userMessage).toContain('wary');
  });

  it('includes the rolling summary in the prompt when present', async () => {
    mockCallGemini.mockResolvedValueOnce({
      narration: 'text',
      inventedEntities: [],
      suggestedActions: [],
    });
    await narrateResolution(
      makeParams({ save: { location: 'widows-reach', recentSummary: 'Previously, chaos ensued.' } })
    );

    const callArgs = mockCallGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('Previously, chaos ensued.');
  });
});
