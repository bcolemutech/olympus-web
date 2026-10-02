'use strict';

// SVG art (planning/the-loom-layered-worlds.md §8, §9; L-356 / #431): art
// Claude draws itself over MCP (set_art), or a builder uploads, for a battle
// map or a town. SVG can carry scripts and reach out to other sites, so every
// SVG is checked strictly before it is stored, and refused if it has:
//
//   - scripts, event handlers (on…=), javascript: or CSS @import;
//   - foreignObject, embedded or linked images, or frames;
//   - any reference outside itself: an href or a url() not to "#…";
//   - a DOCTYPE or entities.
//
// What passes is plain drawing: shapes, paths, text, gradients, patterns,
// filters, and <use> of things in the same SVG. It is stored as
// image/svg+xml with Content-Disposition: attachment, and the Loom only ever
// draws art as an image, where browsers run no script anyway.

const MAX_SVG_BYTES = 1024 * 1024;
const MAX_SIDE = 100000;

const REFUSED = [
  [/<!DOCTYPE/i, 'a DOCTYPE'],
  [/<!ENTITY/i, 'an entity'],
  [/<script\b/i, 'a script'],
  [/<foreignObject\b/i, 'a foreignObject'],
  [/<(?:image|img|iframe|object|embed|audio|video|canvas)\b/i, 'an embedded image or frame'],
  [/[\s"'/]on[a-z]+\s*=/i, 'an event handler (on…=)'],
  [/javascript:/i, 'a javascript: link'],
  [/@import/i, 'a CSS @import'],
  // (The lookaheads also refuse a space or quote, so backtracking past the
  // spaces in "url( #x )" can't make a local reference look external.)
  [/\b(?:xlink:)?href\s*=\s*(["'])\s*(?![\s#])/i, 'a link outside the SVG (an href not to "#…")'],
  [/url\(\s*(["']?)\s*(?![\s#"'])/i, 'a reference outside the SVG (a url() not to "#…")'],
];

// A length attribute's number (width="1000", width="1000px"), or null.
function length(value) {
  const m = /^\s*([0-9]*\.?[0-9]+)\s*(px)?\s*$/.exec(value || '');
  return m ? Number(m[1]) : null;
}

function attribute(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'is').exec(tag);
  return m ? m[2] : null;
}

/**
 * Checks an SVG and finds its size: { svg, width, height }, the size from its
 * viewBox (else its width and height). Throws an Error saying what is wrong.
 */
function checkSvg(input) {
  if (typeof input !== 'string') throw new Error('the art must be SVG text');
  const svg = input.trim();
  if (Buffer.byteLength(svg, 'utf8') > MAX_SVG_BYTES) {
    throw new Error(`it is larger than ${MAX_SVG_BYTES / 1024} KB`);
  }
  // Optional <?xml …?> and comments, then the <svg> element, to the end.
  const start = /^(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg\b/i;
  if (!start.test(svg) || !/<\/svg>\s*$/i.test(svg)) {
    throw new Error('it is not an SVG (it must be one <svg> element)');
  }
  for (const [pattern, what] of REFUSED) {
    if (pattern.test(svg)) throw new Error(`it has ${what}, which art can't have`);
  }
  const root = /<svg\b[^>]*>/i.exec(svg)[0];
  let width = null;
  let height = null;
  const viewBox = attribute(root, 'viewBox');
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) [, , width, height] = parts;
  }
  if (!(width > 0 && height > 0)) {
    width = length(attribute(root, 'width'));
    height = length(attribute(root, 'height'));
  }
  if (!(width > 0 && height > 0)) {
    throw new Error('it needs a viewBox (or a width and height) to give it a size');
  }
  if (width > MAX_SIDE || height > MAX_SIDE) throw new Error('its size is too large');
  return { svg, width, height };
}

/** Whether stored art bytes are SVG (rather than PNG). */
function isSvg(bytes) {
  const head = Buffer.from(bytes).subarray(0, 512).toString('utf8').trimStart();
  return head.startsWith('<');
}

module.exports = { MAX_SVG_BYTES, checkSvg, isSvg };
