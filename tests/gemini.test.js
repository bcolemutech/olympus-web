'use strict';

/**
 * Unit tests for functions/gemini.js
 *
 * Mocks @google-cloud/vertexai to test callGemini in isolation.
 * Does not require the Firestore emulator.
 *
 * Run: cd tests && npx jest gemini --verbose
 */

// Set project env var BEFORE any require so getVertexAI() uses it directly
// and skips the firebase-admin/app lookup.
process.env.GCLOUD_PROJECT = 'test-project';

// Mock VertexAI before requiring gemini.js.
const mockGenerateContent = jest.fn();
const mockGetGenerativeModel = jest.fn(() => ({ generateContent: mockGenerateContent }));
jest.mock('@google-cloud/vertexai', () => ({
  VertexAI: jest.fn(() => ({ getGenerativeModel: mockGetGenerativeModel })),
}));

const { callGemini } = require('../functions/gemini');

function makeVertexResponse({ text, finishReason = 'STOP' }) {
  return {
    response: {
      candidates: [{ finishReason, content: { parts: [{ text }] } }],
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('callGemini', () => {
  test('returns parsed JSON for a normal response', async () => {
    const payload = { narrative: 'You dock at the station.', mood: 'calm' };
    mockGenerateContent.mockResolvedValue(makeVertexResponse({ text: JSON.stringify(payload) }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'You are a narrator.',
      userMessage: 'Do something.',
      maxOutputTokens: 1024,
    });

    expect(result).toEqual(payload);
  });

  test('strips markdown fences before parsing JSON', async () => {
    const payload = { narrative: 'Engines fire.' };
    const fenced = '```json\n' + JSON.stringify(payload) + '\n```';
    mockGenerateContent.mockResolvedValue(makeVertexResponse({ text: fenced }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 512,
    });

    expect(result).toEqual(payload);
  });

  test('returns raw text when jsonMode is false', async () => {
    mockGenerateContent.mockResolvedValue(makeVertexResponse({ text: 'plain text response' }));

    const result = await callGemini({
      modelName: 'gemini-2.5-flash',
      systemInstruction: 'sys',
      userMessage: 'user',
      maxOutputTokens: 256,
      jsonMode: false,
    });

    expect(result).toBe('plain text response');
  });

  test('throws resource-exhausted HttpsError when finishReason is MAX_TOKENS', async () => {
    mockGenerateContent.mockResolvedValue(
      makeVertexResponse({ text: '{"narrative": "truncated', finishReason: 'MAX_TOKENS' })
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

  test('throws internal HttpsError when response text is empty', async () => {
    mockGenerateContent.mockResolvedValue({ response: { candidates: [] } });

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
