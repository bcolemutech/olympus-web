'use strict';

/**
 * A schematic as Claude sees it (planning/the-muse.md §3 SC6, D10; M-202 /
 * #915): the studio picture scaled to at most 1568 px on its long side, with
 * a light grid of tenths drawn on it (the lines are labelled 1 to 9, so x of
 * 0.3 is the line marked 3 along the top) and each point's numbered pin on
 * top. Claude places a point by eye against the grid, then looks again to
 * check it.
 *
 * The numbers are drawn as strokes, so no system font is needed.
 */

const MAX_SIDE = 1568;
const MAX_PIXELS = 100e6; // larger pictures are refused rather than decoded

// A seven-segment figure: each segment's ends, as fractions of a box.
const SEGMENT = {
  a: [0, 0, 1, 0],
  b: [1, 0, 1, 0.5],
  c: [1, 0.5, 1, 1],
  d: [0, 1, 1, 1],
  e: [0, 0.5, 0, 1],
  f: [0, 0, 0, 0.5],
  g: [0, 0.5, 1, 0.5],
};
const DIGITS = [
  'abcdef',
  'bc',
  'abdeg',
  'abcdg',
  'bcfg',
  'acdfg',
  'acdefg',
  'abc',
  'abcdefg',
  'abcdfg',
];

const num = (n) => Math.round(n * 100) / 100;

// The strokes of `text` (digits), centred on (cx, cy), `h` tall, as an SVG path.
function numberPath(text, cx, cy, h) {
  const w = h * 0.55;
  const gap = h * 0.28;
  const chars = String(text).split('');
  const total = chars.length * w + (chars.length - 1) * gap;
  let x = cx - total / 2;
  const top = cy - h / 2;
  const d = [];
  chars.forEach((ch) => {
    for (const s of DIGITS[Number(ch)] || '') {
      const [x1, y1, x2, y2] = SEGMENT[s];
      d.push(`M${num(x + x1 * w)} ${num(top + y1 * h)}L${num(x + x2 * w)} ${num(top + y2 * h)}`);
    }
    x += w + gap;
  });
  return d.join('');
}

// The overlay as SVG: the grid of tenths with its labels, then the pins.
function overlay(width, height, points, { grid = true } = {}) {
  const side = Math.min(width, height);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`];
  if (grid) {
    const label = Math.max(9, Math.round(side / 70));
    for (let i = 1; i <= 9; i++) {
      const x = (width * i) / 10;
      const y = (height * i) / 10;
      const lines = `M${num(x)} 0V${height}M0 ${num(y)}H${width}`;
      out.push(
        `<path d="${lines}" stroke="#000" stroke-opacity=".35" stroke-width="3" fill="none"/>`,
        `<path d="${lines}" stroke="#fff" stroke-opacity=".7" stroke-width="1" fill="none"/>`
      );
      // A label on the top edge and the left edge, on a dark chip.
      const chipW = label * 1.1;
      const chipH = label * 1.6;
      out.push(
        `<rect x="${num(x - chipW / 2)}" y="0" width="${num(chipW)}" height="${num(chipH)}" fill="#0a0e1a" fill-opacity=".75"/>`,
        `<rect x="0" y="${num(y - chipH / 2)}" width="${num(chipW)}" height="${num(chipH)}" fill="#0a0e1a" fill-opacity=".75"/>`,
        `<path d="${numberPath(i, x, chipH / 2, label)}${numberPath(i, chipW / 2, y, label)}" stroke="#fff" stroke-width="${num(Math.max(1, label / 7))}" stroke-linecap="round" fill="none"/>`
      );
    }
  }
  const base = Math.max(11, Math.min(26, side / 42));
  points.forEach((p, i) => {
    const text = String(i + 1);
    const r = base * (text.length > 2 ? 1.45 : text.length > 1 ? 1.2 : 1);
    const cx = p.x * width;
    const cy = p.y * height;
    const h = base * (text.length > 2 ? 0.95 : 1.05);
    out.push(
      `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}" fill="#f59e0b" stroke="#111827" stroke-width="2.5"/>`,
      `<path d="${numberPath(text, cx, cy, h)}" stroke="#111827" stroke-width="${num(Math.max(1.6, base / 6))}" stroke-linecap="round" fill="none"/>`
    );
  });
  out.push('</svg>');
  return out.join('');
}

/**
 * The picture (`bytes`: PNG, JPEG, WebP or SVG) with its grid and pins, as a
 * JPEG: { data, mimeType, width, height }. `points` are { x, y } fractions.
 * `options`: grid (true), maxPixels (a bigger picture is refused, `tooLarge`).
 */
async function viewSchematic(bytes, points, options = {}) {
  const sharp = require('sharp');
  const meta = await sharp(Buffer.from(bytes)).metadata();
  const limit = options.maxPixels || MAX_PIXELS;
  if (meta.width && meta.height && meta.width * meta.height > limit) {
    const err = new Error(`too large to view (${meta.width} × ${meta.height})`);
    err.tooLarge = true;
    throw err;
  }
  const isSvg = meta.format === 'svg';
  const input = isSvg ? sharp(Buffer.from(bytes), { density: 200 }) : sharp(Buffer.from(bytes));
  const { data, info } = await input
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: !isSvg })
    .flatten({ background: '#ffffff' })
    .png()
    .toBuffer({ resolveWithObject: true });
  const svg = overlay(info.width, info.height, points || [], options);
  const out = await sharp(data)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
  return { data: out, mimeType: 'image/jpeg', width: info.width, height: info.height };
}

module.exports = { viewSchematic, overlay, numberPath, MAX_SIDE };
