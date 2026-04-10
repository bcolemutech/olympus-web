'use strict';

/**
 * Unit tests for functions/gemini.js
 *
 * Mocks @google/genai to test callGemini in isolation.
 * Does not require the Firestore emulator.
 *
 * Run: cd tests && npx jest gemini --verbose
 */

// Set project env var BEFORE any require so getClient() reads the projectId
// from the environment instead of from the Firebase admin app options.
process.env.GCLOUD_PROJECT = 'test-project';

// Mock GoogleGenAI before requiring gemini.js.
const mockGenerateContent = jest.fn();
jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

const { callGemini } = require('../functions/gemini');

function makeGenAiResponse({ text, finishReason = 'STOP' }) {
  return {
    text,
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('callGemini', () => {
  test('returns parsed JSON for a normal response', async () => {
    const payload = { narrative: 'You dock at the station.', mood: 'calm' };
    mockGenerateContent.mockResolvedValue(makeGenAiResponse({ text: JSON.stringify(payload) }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'You are a narrator.',
      userMessage: 'Do something.',
      maxOutputTokens: 1024,
    });

    expect(result).toEqual(payload);
    // Verify the new flat SDK call shape — guards against reverting to the
    // old nested @google-cloud/vertexai API.
    expect(mockGenerateContent).toHaveBeenCalledWith({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: 'Do something.' }] }],
      config: {
        systemInstruction: 'You are a narrator.',
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    });
  });

  test('strips markdown fences before parsing JSON', async () => {
    const payload = { narrative: 'Engines fire.' };
    const fenced = '```json\n' + JSON.stringify(payload) + '\n```';
    mockGenerateContent.mockResolvedValue(makeGenAiResponse({ text: fenced }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 512,
    });

    expect(result).toEqual(payload);
  });

  test('returns raw text when jsonMode is false', async () => {
    mockGenerateContent.mockResolvedValue(makeGenAiResponse({ text: 'plain text response' }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 256,
      jsonMode: false,
    });

    expect(result).toBe('plain text response');
    // responseMimeType must be omitted when jsonMode is false.
    expect(mockGenerateContent.mock.calls[0][0].config).toEqual({
      systemInstruction: 'sys',
      maxOutputTokens: 256,
    });
  });

  test('throws resource-exhausted HttpsError when finishReason is MAX_TOKENS', async () => {
    mockGenerateContent.mockResolvedValue(
      makeGenAiResponse({ text: '{"narrative": "truncated', finishReason: 'MAX_TOKENS' })
    );

    await expect(
      callGemini({
        modelName: 'gemini-2.5-flash',
        systemInstruction: 'sys',
        userMessage: 'user',
        maxOutputTokens: 128,
      })
    ).rejects.toMatchObject({
      code: 'resource-exhausted',
      message: 'AI response was truncated. Please try again.',
    });
  });

  test('passes thinkingConfig when thinkingBudget is provided', async () => {
    const payload = { backstory: 'You grew up on a mining rig.' };
    mockGenerateContent.mockResolvedValue(makeGenAiResponse({ text: JSON.stringify(payload) }));

    await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 1024,
      thinkingBudget: 0,
    });

    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: { thinkingBudget: 0 },
        }),
      })
    );
  });

  test('omits thinkingConfig when thinkingBudget is not provided', async () => {
    const payload = { narrative: 'You dock at the station.' };
    mockGenerateContent.mockResolvedValue(makeGenAiResponse({ text: JSON.stringify(payload) }));

    await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 1024,
    });

    const config = mockGenerateContent.mock.calls[0][0].config;
    expect(config).not.toHaveProperty('thinkingConfig');
  });

  test('throws internal HttpsError when response text is empty', async () => {
    mockGenerateContent.mockResolvedValue({ candidates: [] });

    await expect(
      callGemini({
        modelName: 'gemini-2.5-flash',
        systemInstruction: 'sys',
        userMessage: 'user',
        maxOutputTokens: 512,
      })
    ).rejects.toMatchObject({ code: 'internal' });
  });
});
