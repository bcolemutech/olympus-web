'use strict';

const { GoogleGenAI } = require('@google/genai');
const { HttpsError } = require('firebase-functions/v2/https');

let genAIClient;

function getClient() {
  if (!genAIClient) {
    const { getApps } = require('firebase-admin/app');
    const app = getApps().length > 0 ? getApps()[0] : null;
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      (app && app.options && app.options.projectId);
    genAIClient = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location: 'us-central1',
    });
  }
  return genAIClient;
}

/**
 * Calls Gemini via Vertex AI and returns the parsed JSON response (or raw text if jsonMode is false).
 * Strips markdown fences and parses the result when in JSON mode.
 * Throws HttpsError on failure.
 */
async function callGemini({
  modelName,
  systemInstruction,
  userMessage,
  maxOutputTokens,
  jsonMode = true,
}) {
  try {
    const response = await getClient().models.generateContent({
      model: modelName,
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      config: {
        systemInstruction,
        maxOutputTokens,
        ...(jsonMode && { responseMimeType: 'application/json' }),
      },
    });

    const candidate = response.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.error('callGemini: response truncated by MAX_TOKENS');
      throw new HttpsError('resource-exhausted', 'AI response was truncated. Please try again.', {
        finishReason,
      });
    }

    const rawText = response.text;
    if (!rawText) {
      throw new HttpsError('internal', 'Empty response from AI.');
    }

    const cleanedText = rawText
      .trim()
      .replace(/^\s*```(?:\s*json)?\s*/i, '')
      .replace(/\s*```\s*$/, '');

    return jsonMode ? JSON.parse(cleanedText) : cleanedText;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('callGemini error:', err);
    throw new HttpsError('internal', 'Failed to generate AI response.');
  }
}

module.exports = { callGemini };
