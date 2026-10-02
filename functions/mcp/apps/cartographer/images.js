'use strict';

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { pngDimensions } = require('../../../cartographer/service');

// Images Claude can see (planning/the-loom-layered-worlds.md §9; L-355 /
// #417): a town's art, a battle map's art, or the world map, scaled down for
// viewing and returned as an image in the tool result. Towns and battle maps
// carry an overlay for checking placement: the grid with coordinate labels,
// and numbered markers (with a legend) for what has been placed. Without art,
// a town or battle map is drawn on a plain background, so a layout can be
// checked before any art exists.
//
// Pure JavaScript (pngjs, jpeg-js); digits come from a tiny built-in font, so
// nothing depends on system fonts.

const MAX_SIDE = 1568; // the long side Claude sees best
const MAX_PIXELS = 36e6; // larger images are refused rather than decoded
const QUALITY = 82;

const COLOURS = {
  plain: [26, 31, 44],
  gridLine: [255, 255, 255, 60],
  gridMajor: [255, 255, 255, 120],
  label: [255, 255, 255, 255],
  labelBack: [10, 14, 26, 200],
  entry: [102, 187, 106, 255],
  exit: [239, 83, 80, 255],
  feature: [255, 183, 77, 255],
  place: [129, 212, 250, 255],
  wayIn: [128, 203, 196, 255],
  link: [255, 255, 255, 150],
  outline: [10, 14, 26, 255],
};

// ── A canvas of RGBA pixels ───────────────────────────────────────────────

function canvas(width, height, rgb) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function blend(c, x, y, [r, g, b, a = 255]) {
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.width || y >= c.height) return;
  const i = (y * c.width + x) * 4;
  const k = a / 255;
  c.data[i] = Math.round(r * k + c.data[i] * (1 - k));
  c.data[i + 1] = Math.round(g * k + c.data[i + 1] * (1 - k));
  c.data[i + 2] = Math.round(b * k + c.data[i + 2] * (1 - k));
  c.data[i + 3] = 255;
}

function fillRect(c, x0, y0, w, h, colour) {
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(c.height, Math.ceil(y0 + h)); y++) {
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(c.width, Math.ceil(x0 + w)); x++) {
      blend(c, x, y, colour);
    }
  }
}

function fillCircle(c, cx, cy, r, colour) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) blend(c, x, y, colour);
    }
  }
}

function line(c, x0, y0, x1, y1, colour, width = 1) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  const half = (width - 1) / 2;
  for (let s = 0; s <= steps; s++) {
    const x = x0 + ((x1 - x0) * s) / steps;
    const y = y0 + ((y1 - y0) * s) / steps;
    fillRect(c, x - half, y - half, width, width, colour);
  }
}

// Digits, 3 × 5, one string of bits per row.
const DIGITS = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

/** Draws a number on a dark box, its top-left at (x, y); returns its width. */
function number(c, value, x, y, scale = 2) {
  const digits = String(value).split('');
  const w = digits.length * 4 * scale + scale;
  const h = 7 * scale;
  fillRect(c, x, y, w, h, COLOURS.labelBack);
  digits.forEach((d, i) => {
    (DIGITS[d] || []).forEach((row, ry) => {
      row.split('').forEach((bit, rx) => {
        if (bit === '1') {
          fillRect(
            c,
            x + scale + (i * 4 + rx) * scale,
            y + scale + ry * scale,
            scale,
            scale,
            COLOURS.label
          );
        }
      });
    });
  });
  return w;
}

// Digits large enough to read at the image's size.
const labelScale = (c) => Math.max(2, Math.round(Math.min(c.width, c.height) / 300));

// A numbered marker: a shape at (x, y), its number beside it.
function marker(c, x, y, n, shape, colour, size) {
  const r = Math.max(4, size);
  if (shape === 'square') {
    fillRect(c, x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2, COLOURS.outline);
    fillRect(c, x - r, y - r, 2 * r, 2 * r, colour);
  } else {
    fillCircle(c, x, y, r + 1, COLOURS.outline);
    fillCircle(c, x, y, r, colour);
  }
  number(c, n, x + r + 2, y - r - 2, labelScale(c));
}

// ── PNG in, JPEG out ──────────────────────────────────────────────────────

function decode(png) {
  const size = pngDimensions(png.subarray(0, 24));
  if (!size) throw new Error('not a PNG');
  if (size.width * size.height > MAX_PIXELS) {
    const err = new Error(`too large to view (${size.width} × ${size.height})`);
    err.tooLarge = true;
    throw err;
  }
  const { width, height, data } = PNG.sync.read(png);
  return { width, height, data };
}

// Scales an image down (area averaging) so its long side is at most `max`.
function scaleDown(img, max = MAX_SIDE) {
  const ratio = Math.min(1, max / Math.max(img.width, img.height));
  if (ratio === 1) return img;
  const w = Math.max(1, Math.round(img.width * ratio));
  const h = Math.max(1, Math.round(img.height * ratio));
  const sums = new Float64Array(w * h * 4);
  for (let y = 0; y < img.height; y++) {
    const ty = Math.min(h - 1, Math.floor((y * h) / img.height));
    for (let x = 0; x < img.width; x++) {
      const tx = Math.min(w - 1, Math.floor((x * w) / img.width));
      const s = (y * img.width + x) * 4;
      const t = (ty * w + tx) * 4;
      sums[t] += img.data[s];
      sums[t + 1] += img.data[s + 1];
      sums[t + 2] += img.data[s + 2];
      sums[t + 3] += 1;
    }
  }
  const out = canvas(w, h, [0, 0, 0]);
  for (let i = 0; i < w * h; i++) {
    const n = sums[i * 4 + 3] || 1;
    out.data[i * 4] = sums[i * 4] / n;
    out.data[i * 4 + 1] = sums[i * 4 + 1] / n;
    out.data[i * 4 + 2] = sums[i * 4 + 2] / n;
  }
  return out;
}

function encode(c) {
  return jpeg.encode({ data: c.data, width: c.width, height: c.height }, QUALITY).data;
}

// Draws `img` into `c`, scaled to the box (x, y, w, h).
function drawInto(c, img, x0, y0, w, h) {
  for (let y = 0; y < Math.round(h); y++) {
    const sy = Math.min(img.height - 1, Math.floor((y * img.height) / h));
    for (let x = 0; x < Math.round(w); x++) {
      const sx = Math.min(img.width - 1, Math.floor((x * img.width) / w));
      const s = (sy * img.width + sx) * 4;
      blend(c, x0 + x, y0 + y, [img.data[s], img.data[s + 1], img.data[s + 2], 255]);
    }
  }
}

// ── What Claude sees ──────────────────────────────────────────────────────

/**
 * A battle map: its art (stretched to the grid, as the grid view draws it) or
 * a plain background, the grid with every fifth line labelled, and numbered
 * markers for entries, exits and features.
 */
function renderBattleMap(map, png) {
  let base;
  if (png) {
    base = scaleDown(decode(png));
  } else {
    const cell = Math.max(12, Math.min(48, Math.floor(1200 / Math.max(map.width, map.height))));
    base = canvas(map.width * cell, map.height * cell, COLOURS.plain);
  }
  const cw = base.width / map.width;
  const ch = base.height / map.height;
  for (let gx = 0; gx <= map.width; gx++) {
    const major = gx % 5 === 0 || gx === map.width;
    line(base, gx * cw, 0, gx * cw, base.height - 1, major ? COLOURS.gridMajor : COLOURS.gridLine);
  }
  for (let gy = 0; gy <= map.height; gy++) {
    const major = gy % 5 === 0 || gy === map.height;
    line(base, 0, gy * ch, base.width - 1, gy * ch, major ? COLOURS.gridMajor : COLOURS.gridLine);
  }
  const ls = labelScale(base);
  for (let gx = 0; gx < map.width; gx += 5) number(base, gx, gx * cw + 2, 2, ls);
  for (let gy = 5; gy < map.height; gy += 5) number(base, gy, 2, gy * ch + 2, ls);

  const markers = [];
  const add = (type, item, shape, colour) => {
    const n = markers.length + 1;
    markers.push({
      n,
      type,
      id: item.id,
      ...(item.name ? { name: item.name } : {}),
      cell: { x: item.x, y: item.y },
    });
    const size = Math.max(4, Math.min(cw, ch) / 3);
    marker(base, (item.x + 0.5) * cw, (item.y + 0.5) * ch, n, shape, colour, size);
  };
  (map.entries || []).forEach((e) => add('entry', e, 'circle', COLOURS.entry));
  (map.exits || []).forEach((e) => add('exit', e, 'square', COLOURS.exit));
  (map.features || []).forEach((f) => add('feature', f, 'circle', COLOURS.feature));

  return {
    jpeg: encode(base),
    legend: {
      of: 'battleMap',
      id: map.id,
      name: map.name,
      art: Boolean(png),
      grid: { width: map.width, height: map.height },
      image: { width: base.width, height: base.height },
      cellSize: { width: round(cw), height: round(ch) },
      reading:
        'Cells are { x, y } from the top-left, 0-based; every fifth grid line is brighter and ' +
        'labelled. Green circles are entries, red squares exits, amber circles features; each ' +
        'marker is at the centre of its cell, numbered as below.',
      markers,
    },
  };
}

/**
 * A town: its art fitted inside the town's 0–1000 square (as the town view
 * draws it) or a plain square, a grid every 100 units (labelled every 200),
 * the links between places, and numbered markers at the places' positions.
 */
function renderTown(world, settlement, places, png) {
  const art = png ? scaleDown(decode(png)) : null;
  const side = art ? Math.max(art.width, art.height) : 1000;
  const base = canvas(side, side, COLOURS.plain);
  if (art)
    drawInto(base, art, (side - art.width) / 2, (side - art.height) / 2, art.width, art.height);
  const k = side / 1000;
  for (let u = 0; u <= 1000; u += 100) {
    const colour = u % 500 === 0 ? COLOURS.gridMajor : COLOURS.gridLine;
    line(base, u * k, 0, u * k, side - 1, colour);
    line(base, 0, u * k, side - 1, u * k, colour);
  }
  const ls = labelScale(base);
  for (let u = 0; u < 1000; u += 200) {
    number(base, u, u * k + 2, 2, ls);
    if (u) number(base, u, 2, u * k + 2, ls);
  }

  const at = (p) => p.position && { x: p.position.x * k, y: p.position.y * k };
  const byId = Object.fromEntries(places.map((p) => [p.id, p]));
  const drawn = new Set();
  for (const p of places) {
    for (const other of p.connections || []) {
      const key = [p.id, other].sort().join('|');
      const a = at(p);
      const b = byId[other] && at(byId[other]);
      if (!a || !b || drawn.has(key)) continue;
      drawn.add(key);
      line(base, a.x, a.y, b.x, b.y, COLOURS.link, Math.max(2, Math.round(side / 400)));
    }
  }
  const markers = [];
  const unplaced = [];
  for (const p of places) {
    const point = at(p);
    if (!point) {
      unplaced.push({ id: p.id, name: p.name });
      continue;
    }
    const n = markers.length + 1;
    const wayIn = Boolean(p.entrance);
    markers.push({ n, id: p.id, name: p.name, wayIn, position: p.position });
    marker(
      base,
      point.x,
      point.y,
      n,
      wayIn ? 'square' : 'circle',
      wayIn ? COLOURS.wayIn : COLOURS.place,
      Math.max(6, side / 120)
    );
  }

  return {
    jpeg: encode(base),
    legend: {
      of: 'town',
      id: settlement.id,
      name: settlement.name,
      art: Boolean(png),
      image: { width: side, height: side },
      reading:
        'The town’s 0–1000 square fills the image (the art fitted inside it, centred, as the ' +
        'town view draws it). Grid lines every 100 units, labelled every 200, from the ' +
        'top-left. Squares are ways in and out, circles other places, lines their links; each ' +
        'marker sits at the place’s position, numbered as below.',
      markers,
      ...(unplaced.length ? { notPositioned: unplaced } : {}),
    },
  };
}

/** The world map, scaled down, with how its coordinates map onto the image. */
function renderWorld(world, png) {
  const img = scaleDown(decode(png));
  const map = world.map || {};
  return {
    jpeg: encode(img),
    legend: {
      of: 'world',
      name: world.name,
      image: { width: img.width, height: img.height },
      ...(map.width
        ? {
            mapCoordinates: { width: map.width, height: map.height },
            reading:
              "A place at (x, y) in map coordinates (get_location's position) is at " +
              `(x × ${round(img.width / map.width)}, y × ${round(img.height / map.height)}) ` +
              'in this image.',
          }
        : {}),
    },
  };
}

const round = (n) => Math.round(n * 1000) / 1000;

module.exports = { MAX_SIDE, renderBattleMap, renderTown, renderWorld, scaleDown, decode };
