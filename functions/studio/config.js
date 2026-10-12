'use strict';

/**
 * The image studio's settings (planning/the-image-studio.md §4.3, §4.5;
 * L-707 / #543). No dependencies, so the scripts can load it too.
 *
 * Models (checked 2026-10-12 against Google's price list): Gemini 2.5 Flash
 * Image was shut down on 2026-10-02; the current image models are Gemini 3.1
 * Flash Image, its Lite version, and Gemini 3 Pro Image. All are called with
 * generateContent, through Vertex's `global` endpoint, where the Gemini 3
 * image models are served.
 */

// Named tiers (M1): a fast, cheap draft and a careful final image.
const TIERS = Object.freeze({
  draft: { model: 'gemini-3.1-flash-image', size: '1K' },
  final: { model: 'gemini-3-pro-image', size: '2K' },
});

// Each model, the sizes it makes, and the id Vertex serves it under.
const MODELS = Object.freeze({
  'gemini-3.1-flash-image': {
    vertexId: 'gemini-3.1-flash-image-preview',
    sizes: ['512', '1K', '2K', '4K'],
  },
  'gemini-3.1-flash-lite-image': {
    vertexId: 'gemini-3.1-flash-lite-image-preview',
    sizes: ['1K'],
  },
  'gemini-3-pro-image': {
    vertexId: 'gemini-3-pro-image-preview',
    sizes: ['1K', '2K', '4K'],
  },
});

// The shapes the models make (ImageConfig.aspectRatio).
const ASPECT_RATIOS = Object.freeze([
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
]);

const VERTEX_LOCATION = 'global';

// Jobs running at once (T5): guards against a runaway loop; not a spending limit.
const MAX_RUNNING = 8;

// The most reference images a request may carry (M3).
const MAX_REFERENCES = 6;

module.exports = {
  TIERS,
  MODELS,
  ASPECT_RATIOS,
  VERTEX_LOCATION,
  MAX_RUNNING,
  MAX_REFERENCES,
};
