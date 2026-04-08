'use strict';

/**
 * Unit tests for voidOdysseyGenerateBackstory.
 *
 * Mocks functions/gemini so no Vertex AI credentials are needed and the test
 * does not require the Firestore emulator — this callable does not read or
 * write Firestore.
 *
 * Run: cd tests && npx jest void-odyssey-generate-backstory --verbose
 */

// Set project env var BEFORE any require so firebase-admin can initialize
// without real credentials.
process.env.GCLOUD_PROJECT = 'demo-void-odyssey-test';

// Mock callGemini BEFORE requiring the functions module so the export picks
// up the mock.
jest.mock('../functions/gemini', () => ({
  callGemini: jest.fn(),
}));

const { callGemini } = require('../functions/gemini');
const { voidOdysseyGenerateBackstory } = require('../functions/index');

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Invokes the callable directly via .run() — firebase-functions-test misdetects
 * v2 onCall arity, so the existing turn tests use the same workaround.
 */
function callGenerate(data = {}, { authOverride } = {}) {
  return voidOdysseyGenerateBackstory.run({
    data,
    auth:
      authOverride !== undefined
        ? authOverride
        : {
            uid: 'test-user',
            token: { apps: ['void-odyssey'], admin: false },
          },
  });
}

function validData(overrides = {}) {
  return {
    journey: 'frontier_explorer',
    captainName: 'Mara Solano',
    captainTraits: ['resourceful', 'curious'],
    ...overrides,
  };
}

beforeEach(() => {
  callGemini.mockReset();
});

// ── Auth / claim enforcement ───────────────────────────────────────────────

describe('voidOdysseyGenerateBackstory — auth', () => {
  test('rejects unauthenticated callers', async () => {
    await expect(callGenerate(validData(), { authOverride: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('rejects callers without the void-odyssey app claim', async () => {
    await expect(
      callGenerate(validData(), {
        authOverride: { uid: 'test-user', token: { apps: ['symposium'] } },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('rejects callers with no apps array', async () => {
    await expect(
      callGenerate(validData(), {
        authOverride: { uid: 'test-user', token: {} },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(callGemini).not.toHaveBeenCalled();
  });
});

// ── Input validation ───────────────────────────────────────────────────────

describe('voidOdysseyGenerateBackstory — input validation', () => {
  test('rejects missing journey', async () => {
    await expect(callGenerate(validData({ journey: undefined }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('rejects unknown journey', async () => {
    await expect(callGenerate(validData({ journey: 'not_a_real_journey' }))).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('accepts every allowlisted journey', async () => {
    const journeys = [
      'frontier_explorer',
      'smugglers_run',
      'warpath',
      'deep_salvage',
      'first_contact',
      'the_long_haul',
      'ships_company',
      'custom',
    ];
    for (const journey of journeys) {
      callGemini.mockResolvedValueOnce({ backstory: 'ok.' });
      const result = await callGenerate(validData({ journey }));
      expect(result).toEqual({ backstory: 'ok.' });
    }
    expect(callGemini).toHaveBeenCalledTimes(journeys.length);
  });

  test('rejects fewer than 2 traits', async () => {
    await expect(callGenerate(validData({ captainTraits: ['resourceful'] }))).rejects.toMatchObject(
      { code: 'invalid-argument' }
    );
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('rejects more than 3 traits', async () => {
    await expect(
      callGenerate(validData({ captainTraits: ['resourceful', 'curious', 'stoic', 'reckless'] }))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('accepts exactly 2 traits', async () => {
    callGemini.mockResolvedValueOnce({ backstory: 'A short past.' });
    const result = await callGenerate(validData({ captainTraits: ['resourceful', 'curious'] }));
    expect(result.backstory).toBe('A short past.');
  });

  test('accepts exactly 3 traits', async () => {
    callGemini.mockResolvedValueOnce({ backstory: 'A short past.' });
    const result = await callGenerate(
      validData({ captainTraits: ['resourceful', 'curious', 'stoic'] })
    );
    expect(result.backstory).toBe('A short past.');
  });

  test('rejects trait not on the allowlist', async () => {
    await expect(
      callGenerate(validData({ captainTraits: ['resourceful', 'destroyer_of_worlds'] }))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(callGemini).not.toHaveBeenCalled();
  });

  test('rejects non-array captainTraits', async () => {
    await expect(
      callGenerate(validData({ captainTraits: 'resourceful,curious' }))
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(callGemini).not.toHaveBeenCalled();
  });
});

// ── Output shape / capping ─────────────────────────────────────────────────

describe('voidOdysseyGenerateBackstory — output handling', () => {
  test('returns trimmed backstory from the AI', async () => {
    callGemini.mockResolvedValueOnce({
      backstory: '   You grew up on a mining moon and never looked back.   ',
    });
    const result = await callGenerate(validData());
    expect(result.backstory).toBe('You grew up on a mining moon and never looked back.');
  });

  test('caps oversize AI output at 400 characters', async () => {
    const oversize = 'a'.repeat(600);
    callGemini.mockResolvedValueOnce({ backstory: oversize });
    const result = await callGenerate(validData());
    expect(result.backstory.length).toBeLessThanOrEqual(400);
    expect(result.backstory.length).toBe(400);
  });

  test('throws internal error when AI returns empty backstory', async () => {
    callGemini.mockResolvedValueOnce({ backstory: '   ' });
    await expect(callGenerate(validData())).rejects.toMatchObject({ code: 'internal' });
  });

  test('throws internal error when AI response has no backstory field', async () => {
    callGemini.mockResolvedValueOnce({ somethingElse: 'nope' });
    await expect(callGenerate(validData())).rejects.toMatchObject({ code: 'internal' });
  });

  test('wraps unknown callGemini errors as internal HttpsError', async () => {
    callGemini.mockRejectedValueOnce(new Error('network down'));
    await expect(callGenerate(validData())).rejects.toMatchObject({ code: 'internal' });
  });
});

// ── Prompt construction ────────────────────────────────────────────────────

describe('voidOdysseyGenerateBackstory — prompt content', () => {
  test('passes captain name and traits into the user message', async () => {
    callGemini.mockResolvedValueOnce({ backstory: 'ok.' });
    await callGenerate(
      validData({
        journey: 'smugglers_run',
        captainName: 'Mara Solano',
        captainTraits: ['silver_tongued', 'ruthless'],
      })
    );

    expect(callGemini).toHaveBeenCalledTimes(1);
    const callArgs = callGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('Mara Solano');
    expect(callArgs.userMessage).toContain('silver_tongued');
    expect(callArgs.userMessage).toContain('ruthless');
    expect(callArgs.userMessage).toContain("Smuggler's Run");
  });

  test('falls back to an anonymous captain label when name is absent', async () => {
    callGemini.mockResolvedValueOnce({ backstory: 'ok.' });
    await callGenerate(validData({ captainName: '' }));

    const callArgs = callGemini.mock.calls[0][0];
    expect(callArgs.userMessage).toContain('unnamed');
  });
});
