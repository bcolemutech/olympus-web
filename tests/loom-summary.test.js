'use strict';

/**
 * Unit tests for functions/loom-turn/summary.js (L-116).
 *
 * Mocks functions/gemini.js's callGemini and a minimal fake Firestore
 * saveRef to test summary regeneration in isolation. Does not require the
 * Firestore emulator (the end-to-end threshold-crossing path is covered by
 * tests/loom-turn.test.js against the real emulator).
 *
 * Run: cd tests && npx jest loom-summary --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const {
  SUMMARY_REGEN_THRESHOLD,
  MAX_SUMMARY_CHARS,
  shouldRegenerateSummary,
  maybeRegenerateSummary,
} = require('../functions/loom-turn/summary');

function makeTurn(overrides) {
  return Object.assign(
    { index: 0, actionText: 'look around', resolution: { outcome: 'success' }, narration: 'x' },
    overrides
  );
}

/** Minimal fake Firestore DocumentReference supporting the calls summary.js makes. */
function makeFakeSaveRef({ turns, save }) {
  const updateCalls = [];
  const ref = {
    collection() {
      return {
        orderBy() {
          return {
            limit() {
              return {
                async get() {
                  return {
                    empty: turns.length === 0,
                    docs: turns.map((t) => ({ data: () => t })),
                  };
                },
              };
            },
          };
        },
      };
    },
    async get() {
      return { exists: save !== null, data: () => save };
    },
    async update(fields) {
      updateCalls.push(fields);
      Object.assign(save, fields);
    },
  };
  return { ref, updateCalls, save };
}

beforeEach(() => {
  mockCallGemini.mockReset();
});

describe('shouldRegenerateSummary', () => {
  it('is false for turn indices before the threshold', () => {
    for (let i = 0; i < SUMMARY_REGEN_THRESHOLD - 1; i++) {
      expect(shouldRegenerateSummary(i)).toBe(false);
    }
  });

  it('is true exactly when the turn count completes a multiple of the threshold', () => {
    expect(shouldRegenerateSummary(SUMMARY_REGEN_THRESHOLD - 1)).toBe(true);
    expect(shouldRegenerateSummary(2 * SUMMARY_REGEN_THRESHOLD - 1)).toBe(true);
  });

  it('is false for turn indices between threshold multiples', () => {
    expect(shouldRegenerateSummary(SUMMARY_REGEN_THRESHOLD)).toBe(false);
  });
});

describe('maybeRegenerateSummary', () => {
  it('does nothing when there are no turns yet', async () => {
    const { ref, updateCalls } = makeFakeSaveRef({ turns: [], save: { recentSummary: '' } });
    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });
    expect(updateCalls).toHaveLength(0);
    expect(mockCallGemini).not.toHaveBeenCalled();
  });

  it('does nothing when the save no longer exists', async () => {
    const { ref, updateCalls } = makeFakeSaveRef({ turns: [makeTurn()], save: null });
    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });
    expect(updateCalls).toHaveLength(0);
  });

  it('writes the model-produced summary to recentSummary', async () => {
    mockCallGemini.mockResolvedValueOnce('A condensed recap of the last ten turns.');
    const { ref, save } = makeFakeSaveRef({
      turns: [makeTurn({ index: 0 }), makeTurn({ index: 1 })],
      save: { recentSummary: 'old summary' },
    });

    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });

    expect(save.recentSummary).toBe('A condensed recap of the last ten turns.');
  });

  it('passes the previous summary and turn log to the model call', async () => {
    mockCallGemini.mockResolvedValueOnce('updated');
    const { ref } = makeFakeSaveRef({
      turns: [makeTurn({ actionText: 'talk to Doran', index: 0 })],
      save: { recentSummary: 'previously on the Loom...' },
    });

    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });

    const callArgs = mockCallGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('previously on the Loom...');
    expect(callArgs.userMessage).toContain('talk to Doran');
    expect(callArgs.jsonMode).toBe(false);
  });

  it('truncates an overly long summary to MAX_SUMMARY_CHARS', async () => {
    mockCallGemini.mockResolvedValueOnce('x'.repeat(MAX_SUMMARY_CHARS + 500));
    const { ref, save } = makeFakeSaveRef({ turns: [makeTurn()], save: { recentSummary: '' } });

    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });

    expect(save.recentSummary).toHaveLength(MAX_SUMMARY_CHARS);
  });

  it('falls back to the previous summary when callGemini throws', async () => {
    mockCallGemini.mockRejectedValueOnce(new Error('AI unavailable'));
    const { ref, save } = makeFakeSaveRef({
      turns: [makeTurn()],
      save: { recentSummary: 'keep me' },
    });

    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });

    expect(save.recentSummary).toBe('keep me');
  });

  it('falls back to the previous summary when the model returns empty text', async () => {
    mockCallGemini.mockResolvedValueOnce('   ');
    const { ref, save } = makeFakeSaveRef({
      turns: [makeTurn()],
      save: { recentSummary: 'keep me too' },
    });

    await maybeRegenerateSummary({ saveRef: ref, worldId: 'shattered-coast', turnIndex: 9 });

    expect(save.recentSummary).toBe('keep me too');
  });
});
