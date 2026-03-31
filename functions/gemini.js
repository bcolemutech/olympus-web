'use strict';

const { VertexAI } = require('@google-cloud/vertexai');
const { HttpsError } = require('firebase-functions/v2/https');

let vertexAI;

function getVertexAI() {
  if (!vertexAI) {
    const { getApps } = require('firebase-admin/app');
    const app = getApps().length > 0 ? getApps()[0] : null;
    const projectId =
      process.env.GCLOUD_PROJECT ||
      process.env.GCP_PROJECT ||
      (app && app.options && app.options.projectId);
    vertexAI = new VertexAI({ project: projectId, location: 'us-central1' });
  }
  return vertexAI;
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
    const model = getVertexAI().getGenerativeModel({
      model: modelName,
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: {
        maxOutputTokens,
        ...(jsonMode && { responseMimeType: 'application/json' }),
      },
    });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    });

    const candidate = result.response?.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      console.error('callGemini: response truncated by MAX_TOKENS');
      throw new HttpsError('resource-exhausted', 'AI response was truncated. Please try again.', {
        finishReason,
      });
    }

    const rawText = candidate?.content?.parts?.[0]?.text;
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
