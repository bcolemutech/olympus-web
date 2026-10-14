'use strict';

const { MODELS, VERTEX_LOCATION } = require('./config');

/**
 * The image model call (planning/the-image-studio.md §4.3; L-707 / #543):
 * one request to a Gemini image model on Vertex, through @google/genai's
 * generateContent, with reference images and the prompt, asking for one
 * image (M5) at a size and shape.
 *
 *   generate({ model, prompt, references: [{ bytes, mimeType }], size,
 *              aspectRatio })
 *     → { image: { bytes, mimeType } | null, usage: { input, output, text } | null,
 *         text, finishReason }
 *
 * No image back (refused, or blocked by safety) isn't an error here: the job
 * records why, and is charged for the tokens the provider reports. A failed
 * call (network, quota, a bad request) throws, and isn't charged.
 */

let client;
function getClient() {
  if (!client) {
    const { GoogleGenAI } = require('@google/genai');
    const { getApps } = require('firebase-admin/app');
    const app = getApps()[0];
    client = new GoogleGenAI({
      vertexai: true,
      project:
        process.env.GCLOUD_PROJECT ||
        process.env.GCP_PROJECT ||
        (app && app.options && app.options.projectId),
      location: VERTEX_LOCATION,
    });
  }
  return client;
}

/**
 * What a call used, as the price list charges it: prompt tokens (`input`),
 * image tokens (`output`), and text and thinking tokens (`text`), which cost
 * a tenth of image tokens. The image's share comes from the reply's
 * per-modality counts; without them, everything but thinking counts as image.
 */
function usageOf(meta) {
  const candidates = meta.candidatesTokenCount || 0;
  const details = meta.candidatesTokensDetails || [];
  const imageDetail = details.find((d) => d && d.modality === 'IMAGE');
  const image = imageDetail ? imageDetail.tokenCount || 0 : candidates;
  return {
    input: meta.promptTokenCount || 0,
    output: image,
    text: candidates - image + (meta.thoughtsTokenCount || 0),
  };
}

function createImageModel({ genai } = {}) {
  const models = () => (genai || getClient()).models;

  async function generate({ model, prompt, references = [], size, aspectRatio }) {
    const spec = MODELS[model];
    if (!spec) throw new Error(`Unknown image model "${model}".`);
    const parts = [
      ...references.map((ref) => ({
        inlineData: { mimeType: ref.mimeType, data: Buffer.from(ref.bytes).toString('base64') },
      })),
      { text: prompt },
    ];
    const response = await models().generateContent({
      model: spec.vertexId,
      contents: [{ role: 'user', parts }],
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        candidateCount: 1,
        imageConfig: {
          ...(aspectRatio ? { aspectRatio } : {}),
          // A model that makes one size is asked for none.
          ...(size && spec.sizes.length > 1 ? { imageSize: size } : {}),
        },
      },
    });
    const candidate = (response.candidates || [])[0] || {};
    const got = ((candidate.content && candidate.content.parts) || []).filter(Boolean);
    const picture = got.find((part) => part.inlineData && part.inlineData.data);
    const text = got
      .filter((part) => typeof part.text === 'string' && !part.thought)
      .map((part) => part.text)
      .join('\n')
      .trim();
    const meta = response.usageMetadata;
    return {
      image: picture
        ? {
            bytes: Buffer.from(picture.inlineData.data, 'base64'),
            mimeType: picture.inlineData.mimeType || 'image/png',
          }
        : null,
      usage: meta ? usageOf(meta) : null,
      text,
      finishReason:
        candidate.finishReason ||
        (response.promptFeedback && response.promptFeedback.blockReason) ||
        null,
    };
  }

  return { generate };
}

module.exports = { createImageModel, usageOf };
