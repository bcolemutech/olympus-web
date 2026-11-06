/**
 * The asset pipeline's steps (planning/art-spike.md §5.3): each takes and
 * gives image files, so they can be run one at a time and their output
 * looked at. `sharp` is the one functions/ already depends on.
 *
 *   fetch(url, out)              a library image by its link
 *   slice(file, outDir, names?)  a sheet cut into its cells by the gaps of
 *                                its key colour between them
 *   key(file, out)               the key colour (read from the corners) made
 *                                transparent with a soft edge, its spill
 *                                taken out, the picture trimmed
 *   seamless(file, out)          a ground tile's seams blended: offset by
 *                                half, the cross where the edges meet
 *                                painted over from the unshifted tile
 *   fit(file, out, size)         resized to its art's scale (§5.3)
 *   check(file, kind)            what the report records for an asset
 */

import { Buffer } from 'buffer';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(ROOT, 'functions', 'package.json'));
const sharp = require('sharp');

// How far from the key colour a pixel must be to be kept: fully past FAR,
// fading in between NEAR and FAR (the soft edge).
const NEAR = 60;
const FAR = 120;
// A row or column of a sheet with fewer picture pixels than this is a gap.
const GAP_PIXELS = 3;
// A cell narrower or shorter than this is noise, not an asset.
const MIN_CELL = 20;
// A line this much dark across the sheet is a drawn divider between cells.
const DIVIDER = 0.9;
// The art's scale (functions/loom-canon/materials.js; build-art.js): a
// ground tile is 64 units, a strip 64 × 16, an object 16 units to the foot,
// all drawn at 4 pixels to the unit.
const SCALE = 4;
const UNITS = { tile: [64, 64], strip: [64, 16] };
const PER_FOOT = 16;

async function rgb(file) {
  const { data, info } = await sharp(file)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

const dist = (data, i, c) => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);

/** The key colour: the average of the four corners, which a sheet or a single object leaves empty. */
function keyColour({ data, width, height }) {
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const sum = [0, 0, 0];
  for (const p of corners) for (let k = 0; k < 3; k++) sum[k] += data[p * 3 + k];
  return sum.map((s) => s / 4);
}

export async function fetchImage(url, out) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

/** Runs along one axis where `empty(i)` is false, longer than MIN_CELL. */
function runs(n, empty) {
  const out = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const gap = i === n || empty(i);
    if (!gap && start < 0) start = i;
    if (gap && start >= 0) {
      if (i - start >= MIN_CELL) out.push([start, i]);
      start = -1;
    }
  }
  return out;
}

export async function slice(file, outDir, names = []) {
  const img = await rgb(file);
  const { data, width: w, height: h } = img;
  const bg = keyColour(img);
  const filled = (x, y) => dist(data, (y * w + x) * 3, bg) >= NEAR;
  const dark = (x, y) => {
    const i = (y * w + x) * 3;
    return data[i] + data[i + 1] + data[i + 2] < 150;
  };
  // Dividers the model drew though asked not to: dark lines across the whole
  // sheet, found once, before the sheet is cut.
  const darkShare = (n, at) => {
    let d = 0;
    for (let i = 0; i < n; i++) if (dark(...at(i))) d++;
    return d / n;
  };
  const dividerCols = new Set();
  const dividerRows = new Set();
  for (let x = 0; x < w; x++) if (darkShare(h, (y) => [x, y]) > DIVIDER) dividerCols.add(x);
  for (let y = 0; y < h; y++) if (darkShare(w, (x) => [x, y]) > DIVIDER) dividerRows.add(y);
  // A gap is a line of (almost) nothing but the key colour, or a divider.
  const sparse = (n, at) => {
    let c = 0;
    for (let i = 0; i < n && c < GAP_PIXELS; i++) if (filled(...at(i))) c++;
    return c < GAP_PIXELS;
  };
  const columns = runs(w, (x) => dividerCols.has(x) || sparse(h, (y) => [x, y]));
  fs.mkdirSync(outDir, { recursive: true });
  const cells = [];
  // Cells are named row by row, so read each column's rows, then order them.
  for (const [x0, x1] of columns) {
    const rows = runs(h, (y) => dividerRows.has(y) || sparse(x1 - x0, (i) => [x0 + i, y]));
    rows.forEach(([y0, y1], row) => cells.push({ x0, x1, y0, y1, row }));
  }
  const ordered = cells.sort((a, b) => a.row - b.row || a.x0 - b.x0);
  const written = [];
  for (const [i, c] of ordered.entries()) {
    const name = names[i] || `cell-${i + 1}`;
    const out = path.join(outDir, `${name}.png`);
    await sharp(file)
      .extract({ left: c.x0, top: c.y0, width: c.x1 - c.x0, height: c.y1 - c.y0 })
      .png()
      .toFile(out);
    written.push({ name, file: out, width: c.x1 - c.x0, height: c.y1 - c.y0 });
  }
  return written;
}

export async function key(file, out) {
  const img = await rgb(file);
  const { data, width, height } = img;
  const bg = keyColour(img);
  const n = width * height;
  const rgba = Buffer.alloc(n * 4);
  // The key's strongest channels (magenta: red and blue) bleed into the
  // edge; take back what they hold over the weakest one.
  const order = [0, 1, 2].sort((a, b) => bg[b] - bg[a]);
  const [hi1, hi2, lo] = order;
  for (let i = 0; i < n; i++) {
    const d = dist(data, i * 3, bg);
    const a = d < NEAR ? 0 : d > FAR ? 255 : Math.round(((d - NEAR) / (FAR - NEAR)) * 255);
    const px = [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
    const spill = Math.max(0, Math.min(px[hi1], px[hi2]) - px[lo]) * (a < 255 ? 1 : 0.35);
    px[hi1] -= spill;
    px[hi2] -= spill;
    rgba.set([Math.round(px[0]), Math.round(px[1]), Math.round(px[2]), a], i * 4);
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(rgba, { raw: { width, height, channels: 4 } })
    .trim({ threshold: 1 })
    .png()
    .toFile(out);
  return out;
}

export async function seamless(file, out, band = 0.12) {
  const { data, width: w, height: h } = await rgb(file);
  const res = Buffer.alloc(w * h * 3);
  const bx = Math.round(w * band);
  const by = Math.round(h * band);
  // The shifted tile's own edges meet in a cross through its middle; there,
  // fade to the unshifted tile, whose middle is seamless by nature.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = (x + w / 2) % w;
      const sy = (y + h / 2) % h;
      const fx = Math.max(0, 1 - Math.abs(x - w / 2) / bx);
      const fy = Math.max(0, 1 - Math.abs(y - h / 2) / by);
      const t = Math.min(1, Math.max(fx, fy));
      const o = (y * w + x) * 3;
      const s = (Math.floor(sy) * w + Math.floor(sx)) * 3;
      for (let k = 0; k < 3; k++) res[o + k] = Math.round(data[s + k] * (1 - t) + data[o + k] * t);
    }
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(res, { raw: { width: w, height: h, channels: 3 } })
    .png()
    .toFile(out);
  return out;
}

/**
 * The pixel size an asset is fitted to: a tile or strip at its units (a
 * ground picture spanning `span` tiles, as materials.js's PNG_ART says), an
 * object at its catalog size in feet ([w, d]).
 */
export function sizeFor(kind, feet, span = 1) {
  if (kind === 'object') return feet.map((f) => Math.round(f * PER_FOOT * SCALE));
  const [u, v] = UNITS[kind === 'tile' ? 'tile' : 'strip'];
  return [u * SCALE * span, v * SCALE * span];
}

export async function fit(file, out, [width, height], { contain = false } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await sharp(file)
    .resize(width, height, {
      fit: contain ? 'contain' : 'fill',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png({ compressionLevel: 9 })
    .toFile(out);
  return out;
}

/**
 * What the report records: the size; for a tile, how different its
 * opposite edges are against neighbouring pixels inside (1 is perfect);
 * for a cut-out, whether its edge pixels are clear and any key colour left.
 */
export async function check(file, kind) {
  const meta = await sharp(file).metadata();
  const out = {
    file: path.basename(file),
    width: meta.width,
    height: meta.height,
    bytes: fs.statSync(file).size,
  };
  if (kind === 'tile') {
    const { data, width: w, height: h } = await rgb(file);
    const col = (a, b) => {
      let s = 0;
      for (let y = 0; y < h; y++)
        for (let k = 0; k < 3; k++)
          s += Math.abs(data[(y * w + a) * 3 + k] - data[(y * w + b) * 3 + k]);
      return s / (h * 3);
    };
    const row = (a, b) => {
      let s = 0;
      for (let x = 0; x < w; x++)
        for (let k = 0; k < 3; k++)
          s += Math.abs(data[(a * w + x) * 3 + k] - data[(b * w + x) * 3 + k]);
      return s / (w * 3);
    };
    let inside = 0;
    for (let i = 1; i <= 20; i++) {
      const x = Math.floor((w * i) / 22);
      inside += col(x, x + 1);
    }
    inside /= 20;
    out.seam = +((col(w - 1, 0) + row(h - 1, 0)) / 2 / inside).toFixed(2);
  } else if (meta.hasAlpha) {
    const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    let pink = 0;
    let opaque = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const [r, g, b, a] = data.subarray(i * 4, i * 4 + 4);
      if (a > 0) {
        opaque++;
        if (r > 180 && b > 180 && g < 120) pink++;
      }
    }
    out.keyLeft = +((pink / Math.max(1, opaque)) * 100).toFixed(2); // % of the picture still key-coloured
  }
  return out;
}
