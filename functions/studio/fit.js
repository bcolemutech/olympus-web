'use strict';

/**
 * Fitting art to what it is drawn on (planning/builders-tools.md §4.6;
 * L-396 / #742): art the model makes at its own shapes (4:3, 16:9) put to a
 * battle map's grid (26 × 20) or a town's square, without stretching.
 *
 *   crop     the middle of the image, at the shape: the edges are lost
 *   pad      the whole image, with see-through margins to the shape
 *   stretch  as it is: drawn stretched to fit, as before
 *
 * fitFile(file, shape, how) returns a new PNG file (as functions/studio/
 * formats.js readImage reads one) at `shape`'s proportions, the long side
 * kept, or null when nothing need change: stretch, already that shape (to
 * within 2%), or SVG, which says its own shape with its viewBox.
 *
 * sharp is loaded only when a fit is made.
 */

const FITS = ['crop', 'pad', 'stretch'];
const CLOSE = 0.02;

/** Whether a size is already a shape's proportions, to within 2%. */
function fits(size, shape) {
  const want = shape.width / shape.height;
  return Math.abs(size.width / size.height - want) / want <= CLOSE;
}

async function fitFile(file, shape, how) {
  if (how === 'stretch' || !FITS.includes(how) || file.format === 'svg') return null;
  if (fits(file, shape)) return null;
  const sharp = require('sharp');
  const { readImage } = require('./formats');
  const want = shape.width / shape.height;
  const { width: w, height: h } = file;
  const wide = w / h > want;
  let out;
  if (how === 'crop') {
    const width = wide ? Math.round(h * want) : w;
    const height = wide ? h : Math.round(w / want);
    out = sharp(file.bytes).extract({
      left: Math.floor((w - width) / 2),
      top: Math.floor((h - height) / 2),
      width,
      height,
    });
  } else {
    const width = wide ? w : Math.round(h * want);
    const height = wide ? Math.round(w / want) : h;
    const left = Math.floor((width - w) / 2);
    const top = Math.floor((height - h) / 2);
    out = sharp(file.bytes).extend({
      left,
      right: width - w - left,
      top,
      bottom: height - h - top,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  return readImage(await out.png().toBuffer());
}

module.exports = { FITS, fits, fitFile };
