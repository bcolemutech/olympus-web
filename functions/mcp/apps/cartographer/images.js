'use strict';

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { pngDimensions } = require('../../../cartographer/service');
const { isSvg } = require('../../../cartographer/svg');

// Images Claude can see (planning/the-loom-layered-worlds.md §9; L-355 /
// #417): a town's art, a battle map's art, or the world map, scaled down for
// viewing and returned as an image in the tool result. Towns and battle maps
// carry an overlay for checking placement: the grid with coordinate labels,
// and numbered markers (with a legend) for what has been placed. Without art,
// a town or battle map is drawn on a plain background, so a layout can be
// checked before any art exists.
//
// PNG art is read with pngjs, SVG art (L-356) rasterised with resvg; the
// result is JPEG (jpeg-js). Digits come from a tiny built-in font, so the
// overlay depends on no system fonts.

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
  // People (L-684): the grid view's teal, as diamonds, apart from every place.
  person: [77, 182, 172, 255],
  outline: [10, 14, 26, 255],
  // Layers (L-623): walls, doors and obstacles.
  wall: [255, 255, 255, 255],
  door: [255, 183, 77, 255],
  solid: [12, 14, 20, 215],
  low: [205, 170, 125, 210],
  difficult: [190, 190, 190, 190],
  // Town ground (L-654): see-through over the art, so it can be lined up.
  building: [176, 112, 72, 170],
  buildingEdge: [240, 190, 150, 255],
  water: [40, 110, 230, 150],
  waterEdge: [120, 180, 255, 255],
  bridge: [222, 184, 110, 220],
  ford: [190, 235, 255, 190],
  crossingEdge: [255, 236, 179, 255],
  townWall: [235, 235, 235, 255],
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

// Fills a polygon ([{ x, y }] in pixels), a row at a time: pixels whose
// centres are inside it (even-odd).
function fillPolygon(c, points, colour) {
  const ys = points.map((p) => p.y);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(c.height - 1, Math.ceil(Math.max(...ys)));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[i];
      const b = points[j];
      if (a.y > cy !== b.y > cy) xs.push(a.x + ((cy - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(xs[k] - 0.5));
      const to = Math.min(c.width - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = from; x <= to; x++) blend(c, x, y, colour);
    }
  }
}

function outline(c, points, colour, width, closed = true) {
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    line(c, a.x, a.y, b.x, b.y, colour, width);
  }
}

// A town's ground (L-654; loom-canon/ground.js) drawn on the town square at
// k pixels a unit: water, then crossings over it, then buildings, then walls
// as thick lines on top. Returns how many of each were drawn.
function drawGround(c, given, k) {
  const scaled = (shape) => (shape.points || []).map((p) => ({ x: p.x * k, y: p.y * k }));
  const edge = Math.max(1, Math.round(c.width / 800));
  const counts = {};
  const polygons = (kind, fill, rim) => {
    const list = given[kind] || [];
    for (const shape of list) {
      const points = scaled(shape);
      if (points.length < 3) continue;
      fillPolygon(c, points, typeof fill === 'function' ? fill(shape) : fill);
      outline(c, points, rim, edge);
    }
    counts[kind] = list.length;
  };
  polygons('water', COLOURS.water, COLOURS.waterEdge);
  polygons(
    'crossings',
    (shape) => (shape.kind === 'ford' ? COLOURS.ford : COLOURS.bridge),
    COLOURS.crossingEdge
  );
  polygons('buildings', COLOURS.building, COLOURS.buildingEdge);
  const walls = given.walls || [];
  const thick = Math.max(3, Math.round(c.width / 200));
  for (const shape of walls) outline(c, scaled(shape), COLOURS.townWall, thick, false);
  counts.walls = walls.length;
  return counts;
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

// A filled diamond of half-width r about (cx, cy).
function fillDiamond(c, cx, cy, r, colour) {
  for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
    const half = r - Math.abs(dy);
    if (half < 0) continue;
    fillRect(c, cx - half, cy + dy, 2 * half + 1, 1, colour);
  }
}

// A numbered marker: a shape at (x, y), its number beside it.
function marker(c, x, y, n, shape, colour, size) {
  const r = Math.max(4, size);
  if (shape === 'diamond') {
    fillDiamond(c, x, y, r + 2, COLOURS.outline);
    fillDiamond(c, x, y, r, colour);
  } else if (shape === 'square') {
    fillRect(c, x - r - 1, y - r - 1, 2 * r + 2, 2 * r + 2, COLOURS.outline);
    fillRect(c, x - r, y - r, 2 * r, 2 * r, colour);
  } else {
    fillCircle(c, x, y, r + 1, COLOURS.outline);
    fillCircle(c, x, y, r, colour);
  }
  number(c, n, x + r + 2, y - r - 2, labelScale(c));
}

// ── PNG in, JPEG out ──────────────────────────────────────────────────────

// Art bytes (PNG, or SVG text) as pixels on the plain background: any
// transparency is blended onto it, so see-through art never shows as black.
function decode(art) {
  const bytes = Buffer.from(art);
  let png = bytes;
  if (isSvg(bytes)) {
    const { Resvg } = require('@resvg/resvg-js');
    let rendered;
    try {
      const probe = new Resvg(bytes.toString('utf8'));
      const long = Math.max(probe.width, probe.height) || 1;
      const side = (n) => Math.max(1, Math.round((n / long) * MAX_SIDE));
      rendered = new Resvg(bytes.toString('utf8'), {
        fitTo:
          probe.width >= probe.height
            ? { mode: 'width', value: side(probe.width) }
            : { mode: 'height', value: side(probe.height) },
      }).render();
    } catch (err) {
      throw new Error(`the SVG could not be drawn (${err.message})`);
    }
    png = rendered.asPng();
  }
  const size = pngDimensions(png.subarray(0, 24));
  if (!size) throw new Error('not a PNG');
  if (size.width * size.height > MAX_PIXELS) {
    const err = new Error(`too large to view (${size.width} × ${size.height})`);
    err.tooLarge = true;
    throw err;
  }
  const { width, height, data } = PNG.sync.read(png);
  const [r, g, b] = COLOURS.plain;
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    if (a === 1) continue;
    data[i * 4] = Math.round(data[i * 4] * a + r * (1 - a));
    data[i * 4 + 1] = Math.round(data[i * 4 + 1] * a + g * (1 - a));
    data[i * 4 + 2] = Math.round(data[i * 4 + 2] * a + b * (1 - a));
    data[i * 4 + 3] = 255;
  }
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

// An obstacle's squares, shaded by kind: solid filled dark, low hatched,
// difficult dotted; each outlined in its colour.
function obstacle(c, o, cw, ch) {
  const x0 = o.x * cw;
  const y0 = o.y * ch;
  const w = (o.w || 1) * cw;
  const h = (o.h || 1) * ch;
  const colour = COLOURS[o.kind] || COLOURS.solid;
  const gap = Math.max(4, Math.round(Math.min(cw, ch) / 5));
  const dot = Math.max(2, Math.round(gap / 4));
  for (let y = Math.floor(y0); y < Math.ceil(y0 + h); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) {
      const on =
        o.kind === 'low'
          ? (x + y) % gap < Math.max(1, gap / 3)
          : o.kind === 'difficult'
            ? x % gap < dot && y % gap < dot
            : true;
      if (on) blend(c, x, y, colour);
    }
  }
  const edge = [colour[0], colour[1], colour[2], 255];
  line(c, x0, y0, x0 + w - 1, y0, edge, 2);
  line(c, x0, y0 + h - 1, x0 + w - 1, y0 + h - 1, edge, 2);
  line(c, x0, y0, x0, y0 + h - 1, edge, 2);
  line(c, x0 + w - 1, y0, x0 + w - 1, y0 + h - 1, edge, 2);
}

// A line along the grid between two corners: a dark edge under a bright core.
function gridLine(c, a, b, cw, ch, colour, width) {
  line(c, a.x * cw, a.y * ch, b.x * cw, b.y * ch, COLOURS.outline, width + 2);
  line(c, a.x * cw, a.y * ch, b.x * cw, b.y * ch, colour, width);
}

/**
 * A battle map: its art (stretched to the grid, as the grid view draws it) or
 * a plain background, the grid with every fifth line labelled, its layers
 * (L-623: obstacles shaded by kind, walls in white, doors in amber), and
 * numbered markers for entries, exits, features, doors, obstacles and the
 * people standing on it (L-684: `people`, [{ id, name, x, y, at }], `at` the
 * place whose copy of the map they stand on).
 */
function renderBattleMap(map, art, people = []) {
  let base;
  if (art) {
    base = scaleDown(decode(art));
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

  // The layers (L-623): obstacles under the walls, doors over them.
  const thick = Math.max(3, Math.round(Math.min(cw, ch) / 8));
  (map.obstacles || []).forEach((o) => obstacle(base, o, cw, ch));
  (map.walls || []).forEach((wall) => {
    const points = wall.points || [];
    for (let i = 1; i < points.length; i++) {
      gridLine(base, points[i - 1], points[i], cw, ch, COLOURS.wall, thick);
    }
  });
  (map.doors || []).forEach((d) => gridLine(base, d.from, d.to, cw, ch, COLOURS.door, thick + 2));

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
  people.forEach((p) => {
    add('person', p, 'diamond', COLOURS.person);
    if (p.at) markers[markers.length - 1].at = p.at;
  });
  // Doors are numbered at their middle, obstacles at their top-left corner.
  (map.doors || []).forEach((d) => {
    const n = markers.length + 1;
    markers.push({
      n,
      type: 'door',
      id: d.id,
      ...(d.name ? { name: d.name } : {}),
      from: d.from,
      to: d.to,
      ...(d.locked ? { locked: true } : {}),
    });
    number(base, n, ((d.from.x + d.to.x) / 2) * cw + 3, ((d.from.y + d.to.y) / 2) * ch + 3, ls);
  });
  (map.obstacles || []).forEach((o) => {
    const n = markers.length + 1;
    markers.push({
      n,
      type: 'obstacle',
      id: o.id,
      ...(o.name ? { name: o.name } : {}),
      kind: o.kind,
      cells: { x: o.x, y: o.y, w: o.w || 1, h: o.h || 1 },
    });
    number(base, n, o.x * cw + 3, o.y * ch + 3, ls);
  });

  return {
    jpeg: encode(base),
    legend: {
      of: 'battleMap',
      id: map.id,
      name: map.name,
      art: Boolean(art),
      grid: { width: map.width, height: map.height },
      image: { width: base.width, height: base.height },
      cellSize: { width: round(cw), height: round(ch) },
      reading:
        'Cells are { x, y } from the top-left, 0-based; every fifth grid line is brighter and ' +
        'labelled. Green circles are entries, red squares exits, amber circles features, teal ' +
        'diamonds people (at: the place they stand at); each marker is at the centre of its ' +
        'cell, numbered as below. Layers: white lines are walls ' +
        'and amber bars doors, both on the grid lines between squares (corner (x, y) is the ' +
        'top-left of square (x, y)); obstacles are shaded by kind: solid filled dark, low ' +
        'hatched, difficult dotted. Doors are numbered at their middle, obstacles at their ' +
        'top-left square.',
      walls: (map.walls || []).length,
      markers,
    },
  };
}

/**
 * A town: its art fitted inside the town's 0–1000 square (as the town view
 * draws it) or a plain square, a grid every 100 units (labelled every 200),
 * the links between places, numbered markers at the places' positions, and
 * the people about town at their town points (L-684: `people`, [{ id, name,
 * x, y, place }]). A town with ground (L-654) has it drawn over the art,
 * under the grid and markers.
 */
function renderTown(world, settlement, places, artBytes, people = []) {
  const art = artBytes ? scaleDown(decode(artBytes)) : null;
  const side = art ? Math.max(art.width, art.height) : 1000;
  const base = canvas(side, side, COLOURS.plain);
  if (art)
    drawInto(base, art, (side - art.width) / 2, (side - art.height) / 2, art.width, art.height);
  const k = side / 1000;
  const given = settlement.town && settlement.town.ground;
  const ground = given ? drawGround(base, given, k) : null;
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
  for (const p of people) {
    const n = markers.length + 1;
    markers.push({
      n,
      type: 'person',
      id: p.id,
      name: p.name,
      position: { x: p.x, y: p.y },
      ...(p.place ? { place: p.place } : {}),
    });
    marker(base, p.x * k, p.y * k, n, 'diamond', COLOURS.person, Math.max(6, side / 140));
  }

  return {
    jpeg: encode(base),
    legend: {
      of: 'town',
      id: settlement.id,
      name: settlement.name,
      art: Boolean(artBytes),
      image: { width: side, height: side },
      reading:
        'The town’s 0–1000 square fills the image (the art fitted inside it, centred, as the ' +
        'town view draws it). Grid lines every 100 units, labelled every 200, from the ' +
        'top-left. Squares are ways in and out, circles other places, lines their links; each ' +
        'marker sits at the place’s position, numbered as below. Teal diamonds are people ' +
        'about town, at their town points (type person).' +
        (ground
          ? ' Its ground (set_town_ground) is drawn see-through over the art: buildings ' +
            'brown, water blue, bridges tan and fords pale blue over it, walls as thick white ' +
            'lines; open ground is left as it is.'
          : ''),
      ...(ground ? { ground } : {}),
      markers,
      ...(unplaced.length ? { notPositioned: unplaced } : {}),
    },
  };
}

/**
 * The world map, scaled down, with how its coordinates map onto the image,
 * and the people in the wilderness at their world points (L-684: `people`,
 * [{ id, name, x, y }]), numbered.
 */
function renderWorld(world, art, people = []) {
  const img = scaleDown(decode(art));
  const map = world.map || {};
  const markers = [];
  if (map.width && map.height) {
    const kx = img.width / map.width;
    const ky = img.height / map.height;
    for (const p of people) {
      const n = markers.length + 1;
      markers.push({ n, type: 'person', id: p.id, name: p.name, position: { x: p.x, y: p.y } });
      marker(img, p.x * kx, p.y * ky, n, 'diamond', COLOURS.person, Math.max(6, img.width / 150));
    }
  }
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
              'in this image. Teal diamonds are people in the wilderness, at their world ' +
              'points, numbered as below.',
          }
        : {}),
      ...(markers.length ? { markers } : {}),
    },
  };
}

const round = (n) => Math.round(n * 1000) / 1000;

module.exports = { MAX_SIDE, renderBattleMap, renderTown, renderWorld, scaleDown, decode };
