#!/usr/bin/env node

/**
 * Makes the Loom's built-in art (planning/maps-from-data.md RD1, RD3, OB1;
 * L-925 / #729): a tile for every material and a picture for every catalog
 * object (functions/loom-canon/materials.js), as SVG, under
 * public/apps/loom/art/. Run it from the repo root:
 *
 *   node scripts/build-art.js          write the art
 *   node scripts/build-art.js --check  fail if what's written differs
 *
 * The art is drawn here, from the material's or object's own id, so it is the
 * same every time and costs nothing. It is seen from above, and each file is
 * plain SVG (checked as set_art's is). A file can be replaced by art made with
 * the studio under the same name: nothing else reads how it was made, and the
 * test that every material and object has art only looks for the file.
 *
 *   materials/<kind>-<id>.svg   a ground tile 64 × 64 that repeats; a line,
 *                               wall, door or window 64 × 16, drawn along its
 *                               length, which repeats along it
 *   objects/<id>.svg            a transparent picture, 16 units to the foot
 *   objects/unknown.svg         the box with a question mark
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const catalog = require('../functions/loom-canon/materials.js');
const { checkSvg } = require('../functions/cartographer/svg.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/apps/loom/art');
const T = 64; // a ground tile's side
const L = 16; // a strip's depth (walls, doors, windows, lines)
const PER_FOOT = 16; // an object's units to the foot

// ── Small tools ──────────────────────────────────────────────────────

const f = (n) => Math.round(n * 10) / 10;
const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? f(v) : v}"`)
    .join('');
const el = (tag, o) => `<${tag}${attrs(o)}/>`;
const rect = (x, y, w, h, fill, o = {}) => el('rect', { x, y, width: w, height: h, fill, ...o });
const circle = (cx, cy, r, fill, o = {}) => el('circle', { cx, cy, r, fill, ...o });
const ellipse = (cx, cy, rx, ry, fill, o = {}) => el('ellipse', { cx, cy, rx, ry, fill, ...o });
const line = (x1, y1, x2, y2, stroke, w = 1, o = {}) =>
  el('line', { x1, y1, x2, y2, stroke, 'stroke-width': w, 'stroke-linecap': 'round', ...o });
const path_ = (d, o = {}) => el('path', { d, fill: 'none', ...o });
const poly = (pts, fill, o = {}) =>
  el('polygon', { points: pts.map((p) => p.map(f).join(',')).join(' '), fill, ...o });
const group = (inner, o = {}) => `<g${attrs(o)}>${inner}</g>`;
const svg = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>\n`;

function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (r, lo, hi) => lo + (hi - lo) * r();
const pick = (r, list) => list[Math.floor(r() * list.length)];

// A colour lightened (k > 1, toward white) or darkened (k < 1).
function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) =>
    Math.max(0, Math.min(255, Math.round(k >= 1 ? v + (255 - v) * (k - 1) : v * k)))
  );
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}
const vary = (r, hex, amount) => shade(hex, 1 + between(r, -amount, amount));

// A shape drawn again a tile over, where it runs off an edge, so a tile repeats
// with no seam: draw(x, y) returns the SVG at that place.
function wrapped(x, y, reach, draw, w = T, h = T) {
  const xs = [x];
  const ys = [y];
  if (x < reach) xs.push(x + w);
  if (x > w - reach) xs.push(x - w);
  if (y < reach) ys.push(y + h);
  if (y > h - reach) ys.push(y - h);
  return xs.flatMap((px) => ys.map((py) => draw(px, py))).join('');
}
// Any shape repeated in the nine tiles round it (for veins and cracks).
const tiled = (inner) =>
  [-T, 0, T]
    .flatMap((dx) => [-T, 0, T].map((dy) => group(inner, { transform: `translate(${dx} ${dy})` })))
    .join('');
// The same along a strip's length only.
const along = (inner) =>
  [-T, 0, T].map((dx) => group(inner, { transform: `translate(${dx} 0)` })).join('');

// ── Ground tiles (64 × 64) ───────────────────────────────────────────

const speckle = (r, n, colors, [lo, hi], opacity = 1) =>
  Array.from({ length: n }, () => {
    const x = between(r, 0, T);
    const y = between(r, 0, T);
    const rad = between(r, lo, hi);
    const fill = pick(r, colors);
    return wrapped(x, y, rad, (px, py) => circle(px, py, rad, fill, { opacity }));
  }).join('');

// Rows of blocks, each row cut into random lengths and slid sideways.
function blocks(r, { base, mortar, rows, cuts = [2, 3], vary: v = 0.1, gap = 1.5, round = 0 }) {
  let out = rect(0, 0, T, T, mortar);
  let y = 0;
  for (const h of rows) {
    const n = pick(r, cuts);
    const points = Array.from({ length: n - 1 }, () => between(r, 6, T - 6)).sort((a, b) => a - b);
    const edges = [0, ...points, T];
    const slide = between(r, 0, T);
    for (let i = 0; i < n; i++) {
      const x0 = edges[i];
      const w = edges[i + 1] - x0;
      const fill = vary(r, base, v);
      for (const dx of [slide, slide - T]) {
        out += rect(x0 + dx + gap / 2, y + gap / 2, w - gap, h - gap, fill, { rx: round });
      }
    }
    y += h;
  }
  return out;
}

const waves = (r, base, light, rows = 4) => {
  let out = rect(0, 0, T, T, base);
  for (let i = 0; i < rows; i++) {
    const y = (i + 0.5) * (T / rows) + between(r, -3, 3);
    const x = between(r, 0, 16);
    const d = `M${f(x)} ${f(y)} q8 -5 16 0 t16 0 t16 0 t16 0 t16 0`;
    out += tiled(
      path_(d, { stroke: light, 'stroke-width': 1.6, opacity: 0.6, 'stroke-linecap': 'round' })
    );
  }
  return out;
};

const blades = (r, base, colors, n = 120) => {
  let out = rect(0, 0, T, T, base);
  for (let i = 0; i < n; i++) {
    const x = between(r, 0, T);
    const y = between(r, 0, T);
    const len = between(r, 3, 6);
    const lean = between(r, -2, 2);
    const stroke = pick(r, colors);
    out += wrapped(x, y, 6, (px, py) =>
      line(px, py, px + lean, py - len, stroke, 1.2, { opacity: 0.85 })
    );
  }
  return out;
};

const canopy = (r, base, greens, n, [lo, hi]) => {
  let out = rect(0, 0, T, T, base);
  for (let i = 0; i < n; i++) {
    const x = between(r, 0, T);
    const y = between(r, 0, T);
    const rad = between(r, lo, hi);
    const fill = pick(r, greens);
    out += wrapped(
      x,
      y,
      rad,
      (px, py) =>
        circle(px + 1.5, py + 1.5, rad, shade(base, 0.7), { opacity: 0.5 }) +
        circle(px, py, rad, fill)
    );
    out += wrapped(x, y, rad, (px, py) =>
      circle(px - rad * 0.3, py - rad * 0.3, rad * 0.4, shade(fill, 1.25), { opacity: 0.6 })
    );
  }
  return out;
};

const GROUND = {
  stone: (r) =>
    blocks(r, { base: '#8a8a90', mortar: '#55555b', rows: [16, 16, 16, 16], cuts: [2, 3] }),
  flagstone: (r) =>
    blocks(r, {
      base: '#9a9690',
      mortar: '#5f5b55',
      rows: [20, 24, 20],
      cuts: [2, 2],
      round: 2,
      gap: 2.5,
    }),
  cobble: (r) => {
    let out = rect(0, 0, T, T, '#5e5b57');
    for (let gx = 0; gx < 8; gx++) {
      for (let gy = 0; gy < 8; gy++) {
        const x = gx * 8 + 4 + between(r, -1.2, 1.2);
        const y = gy * 8 + 4 + between(r, -1.2, 1.2);
        const rad = between(r, 3, 3.8);
        const fill = vary(r, '#8f8b84', 0.14);
        out += wrapped(
          x,
          y,
          rad,
          (px, py) =>
            circle(px, py, rad, fill) +
            circle(px - 1, py - 1, rad * 0.45, shade(fill, 1.2), { opacity: 0.5 })
        );
      }
    }
    return out;
  },
  marble: (r) => {
    let veins = '';
    for (let i = 0; i < 3; i++) {
      const y = between(r, 8, 56);
      veins += path_(
        `M0 ${f(y)} c12 ${f(between(r, -14, 14))} 24 ${f(between(r, -14, 14))} 32 0 s20 ${f(between(r, -12, 12))} 32 0`,
        {
          stroke: '#a9aab5',
          'stroke-width': between(r, 0.6, 1.4),
          opacity: 0.7,
        }
      );
    }
    return (
      rect(0, 0, T, T, '#e8e6e0') +
      tiled(veins) +
      speckle(r, 40, ['#ffffff', '#d8d6d0'], [0.6, 1.2], 0.5)
    );
  },
  tile: (r) => {
    let out = rect(0, 0, T, T, '#8d949a');
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        const fill = (gx + gy) % 2 ? '#d5d9dc' : '#bcc2c7';
        out += rect(gx * 16 + 1, gy * 16 + 1, 14, 14, vary(r, fill, 0.03));
      }
    }
    return out;
  },
  wood: (r) => {
    let out = '';
    for (let i = 0; i < 4; i++) {
      const y = i * 16;
      const fill = vary(r, '#a0713f', 0.1);
      out += rect(0, y, T, 16, fill) + rect(0, y + 15, T, 1.2, '#4a2f17');
      for (let g = 0; g < 4; g++) {
        const gy = y + between(r, 2, 13);
        out += line(0, gy, T, gy + between(r, -1, 1), shade(fill, 0.8), 0.7, { opacity: 0.6 });
      }
      const joint = between(r, 6, T - 6);
      out += rect(joint, y, 1.2, 16, '#4a2f17');
    }
    return out;
  },
  carpet: (r) => {
    let out = rect(0, 0, T, T, '#8b2a2f');
    for (let gx = 0; gx < 4; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        out += poly(
          [
            [gx * 16 + 8, gy * 16 + 2],
            [gx * 16 + 14, gy * 16 + 8],
            [gx * 16 + 8, gy * 16 + 14],
            [gx * 16 + 2, gy * 16 + 8],
          ],
          'none',
          { stroke: '#d8b25a', 'stroke-width': 1, opacity: 0.8 }
        );
      }
    }
    return out + speckle(r, 60, ['#6e1f24', '#a63a40'], [0.6, 1.1], 0.5);
  },
  dirt: (r) =>
    rect(0, 0, T, T, '#7a5c3e') + speckle(r, 90, ['#5e4429', '#957453', '#6a4e32'], [0.8, 2.2]),
  sand: (r) => {
    const ripples = [0, 1, 2, 3]
      .map((i) =>
        path_(`M0 ${8 + i * 16} q8 -3 16 0 t16 0 t16 0 t16 0`, {
          stroke: '#bfa86a',
          'stroke-width': 1,
          opacity: 0.55,
        })
      )
      .join('');
    return (
      rect(0, 0, T, T, '#d9c58f') +
      tiled(ripples) +
      speckle(r, 80, ['#c4ad74', '#ece0b4'], [0.5, 1.2], 0.8)
    );
  },
  gravel: (r) =>
    rect(0, 0, T, T, '#8a8882') +
    speckle(r, 180, ['#6e6c67', '#a6a39b', '#7d7b75', '#b9b6ad'], [1, 2.4]),
  mud: (r) =>
    rect(0, 0, T, T, '#5b4630') +
    speckle(r, 14, ['#6f5840', '#4a3724'], [3, 7], 0.7) +
    speckle(r, 20, ['#8a7358'], [0.8, 1.6], 0.6),
  rock: (r) =>
    rect(0, 0, T, T, '#5d5954') +
    speckle(r, 26, ['#6d6862', '#4d4944', '#77716a'], [4, 9], 0.85) +
    tiled(
      path_(`M${f(between(r, 4, 20))} 0 l6 14 l-4 12 l8 16 l-3 14`, {
        stroke: '#2f2c29',
        'stroke-width': 1.2,
        opacity: 0.7,
      })
    ),
  snow: (r) => rect(0, 0, T, T, '#eef3f7') + speckle(r, 40, ['#d4e1ec', '#ffffff'], [1.5, 4], 0.7),
  ice: (r) =>
    rect(0, 0, T, T, '#bfe3f0') +
    tiled(
      path_('M6 8 L28 30 L24 52 M28 30 L52 22 L60 44', {
        stroke: '#ffffff',
        'stroke-width': 1.2,
        opacity: 0.75,
      })
    ) +
    speckle(r, 20, ['#e8f7fc', '#9fd0e4'], [1, 3], 0.6),
  lava: (r) => {
    const cracks =
      path_(`M0 ${f(between(r, 10, 22))} l14 8 l10 -6 l14 12 l12 -4 l14 10`, {
        stroke: '#ff9a2e',
        'stroke-width': 2.2,
        'stroke-linecap': 'round',
      }) +
      path_('M18 0 l-4 16 l10 14 l-4 14 l8 20', {
        stroke: '#ffcf4a',
        'stroke-width': 1.4,
        'stroke-linecap': 'round',
      });
    return (
      rect(0, 0, T, T, '#3a0f0a') +
      speckle(r, 12, ['#7a1d0c', '#5a1409'], [4, 8], 0.9) +
      tiled(cracks) +
      speckle(r, 18, ['#ff7a1c'], [0.8, 1.8], 0.8)
    );
  },
  roof: (r) => {
    let out = rect(0, 0, T, T, '#5b3a30');
    for (let i = 0; i < 8; i++) {
      const y = i * 8;
      const off = i % 2 ? 8 : 0;
      for (let x = -16; x < T + 16; x += 16) {
        out +=
          rect(x + off + 0.5, y, 15, 8, vary(r, '#8a4f3d', 0.1), { rx: 2 }) +
          rect(x + off + 0.5, y + 6.6, 15, 1.4, '#3f251d', { opacity: 0.8 });
      }
    }
    return out;
  },
  metal: (r) => {
    let out = rect(0, 0, T, T, '#5c6368');
    for (let gx = 0; gx < 2; gx++) {
      for (let gy = 0; gy < 2; gy++) {
        const x = gx * 32;
        const y = gy * 32;
        out +=
          rect(x + 1, y + 1, 30, 30, vary(r, '#7a8288', 0.05)) +
          rect(x + 1, y + 1, 30, 1.4, '#a4adb3') +
          rect(x + 1, y + 29.6, 30, 1.4, '#434a4f');
        for (const [cx, cy] of [
          [4, 4],
          [28, 4],
          [4, 28],
          [28, 28],
        ])
          out += circle(x + cx, y + cy, 1.4, '#3c4247');
      }
    }
    return out;
  },
  water: (r) => waves(r, '#3f7fb0', '#bfe2f5', 4),
  'deep-water': (r) => waves(r, '#1d4a78', '#6aa5d0', 3),
  swamp: (r) =>
    rect(0, 0, T, T, '#4a5d3a') +
    speckle(r, 9, ['#3a5a52', '#2f4d4a'], [5, 9], 0.85) +
    blades(r, 'none', ['#2f4a22', '#6d8a3c'], 40),
  ocean: (r) => waves(r, '#2c5f8f', '#8fc0e6', 3),
  lake: (r) => waves(r, '#4c8fbf', '#d0ebfa', 4),
  marsh: (r) =>
    rect(0, 0, T, T, '#6b7d4b') +
    speckle(r, 7, ['#4f7f96', '#5e8ea3'], [5, 9], 0.8) +
    blades(r, 'none', ['#3e5a2a', '#9aae5a'], 50),
  grass: (r) => blades(r, '#5a8f3c', ['#4a7a30', '#78ae4e', '#69a043', '#3f6c2a']),
  grassland: (r) => blades(r, '#7aa545', ['#689337', '#94c25a', '#85b44c'], 90),
  farmland: () => {
    let out = rect(0, 0, T, T, '#a58f45');
    for (let i = 0; i < 8; i++) {
      out += rect(0, i * 8 + 2, T, 3, '#8a7433');
      for (let k = 0; k < 8; k++) out += circle(k * 8 + 4, i * 8 + 3.5, 1.4, '#b9ce5a');
    }
    return out;
  },
  forest: (r) => canopy(r, '#244d27', ['#2f5d30', '#376b37', '#2a5a35'], 16, [6, 10]),
  jungle: (r) => canopy(r, '#173f22', ['#1f5a2a', '#2a7a38', '#18502a'], 22, [5, 9]),
  savanna: (r) => blades(r, '#bba55a', ['#a38e45', '#d1be76', '#8f7a37'], 70),
  desert: (r) => {
    const dunes = [0, 1, 2, 3]
      .map((i) =>
        path_(`M0 ${6 + i * 16} q16 -8 32 0 t32 0`, {
          stroke: '#c4a25c',
          'stroke-width': 2,
          opacity: 0.6,
        })
      )
      .join('');
    return (
      rect(0, 0, T, T, '#dcc17c') +
      tiled(dunes) +
      speckle(r, 50, ['#efdca0', '#cdb06a'], [0.5, 1.1], 0.7)
    );
  },
  hills: (r) => {
    let out = rect(0, 0, T, T, '#8aa35a');
    for (let i = 0; i < 7; i++) {
      const x = between(r, 0, T);
      const y = between(r, 0, T);
      const rad = between(r, 7, 11);
      out += wrapped(
        x,
        y,
        rad,
        (px, py) =>
          ellipse(px, py + rad * 0.2, rad, rad * 0.75, '#6e8744') +
          ellipse(px - 1, py - 1, rad * 0.95, rad * 0.65, '#a5bc72')
      );
    }
    return out;
  },
  mountains: (r) => {
    let out = rect(0, 0, T, T, '#7f8184');
    for (let i = 0; i < 6; i++) {
      const x = between(r, 0, T);
      const y = between(r, 0, T);
      const s = between(r, 9, 14);
      out += wrapped(
        x,
        y,
        s,
        (px, py) =>
          poly(
            [
              [px - s, py + s * 0.7],
              [px, py - s],
              [px + s, py + s * 0.7],
            ],
            '#a4a6a9'
          ) +
          poly(
            [
              [px, py - s],
              [px + s, py + s * 0.7],
              [px + 1, py + s * 0.7],
            ],
            '#5f6164'
          ) +
          poly(
            [
              [px, py - s],
              [px - s * 0.28, py - s * 0.45],
              [px + s * 0.28, py - s * 0.45],
            ],
            '#f1f3f5'
          )
      );
    }
    return out;
  },
  tundra: (r) =>
    rect(0, 0, T, T, '#a9b49a') +
    speckle(r, 14, ['#e7ede9', '#c5d0c4'], [3, 7], 0.75) +
    speckle(r, 40, ['#7f8c70'], [0.6, 1.4], 0.8),
  taiga: (r) => {
    let out = rect(0, 0, T, T, '#3f6b52');
    for (let i = 0; i < 20; i++) {
      const x = between(r, 0, T);
      const y = between(r, 0, T);
      const s = between(r, 4, 7);
      out += wrapped(
        x,
        y,
        s,
        (px, py) =>
          poly(
            [
              [px - s, py + s],
              [px, py - s * 1.3],
              [px + s, py + s],
            ],
            vary(r, '#2a4f3a', 0.15)
          ) +
          poly(
            [
              [px - s * 0.6, py + s * 0.1],
              [px, py - s * 1.3],
              [px + s * 0.6, py + s * 0.1],
            ],
            '#e8f0f0',
            { opacity: 0.6 }
          )
      );
    }
    return out;
  },
  glacier: (r) =>
    rect(0, 0, T, T, '#dff3f8') +
    tiled(
      path_('M0 20 L22 26 L34 14 L64 22 M30 64 L36 44 L52 36', {
        stroke: '#7ec1d6',
        'stroke-width': 1.6,
      }) + path_('M10 0 L18 18', { stroke: '#a9dbe8', 'stroke-width': 1.2 })
    ) +
    speckle(r, 30, ['#ffffff', '#c3e6f0'], [1, 3], 0.8),
};

// ── Strips (64 × 16): lines, walls, doors and windows ────────────────

const bandEdge = (top, bottom, w = 64) =>
  rect(0, 0, w, top, 'rgba(0,0,0,0.25)') + rect(0, L - bottom, w, bottom, 'rgba(0,0,0,0.25)');

const LINE = {
  river: (r) => {
    const flow = path_('M0 5 q8 -3 16 0 t16 0 t16 0 t16 0 M0 11 q8 3 16 0 t16 0 t16 0 t16 0', {
      stroke: '#cfe9f7',
      'stroke-width': 1.3,
      opacity: 0.6,
    });
    return (
      rect(0, 1, T, 14, '#3f86b8', { rx: 5 }) +
      rect(0, 3, T, 10, '#4f98c8', { rx: 4 }) +
      flow +
      speckle2(r)
    );
  },
  stream: (r) =>
    rect(0, 4, T, 8, '#5aa3d0', { rx: 3 }) +
    path_('M0 8 q8 -2 16 0 t16 0 t16 0 t16 0', {
      stroke: '#d6eefa',
      'stroke-width': 1,
      opacity: 0.7,
    }) +
    speckle2(r),
  canal: () =>
    rect(0, 0, T, L, '#8e8b86') +
    rect(0, 3, T, 10, '#3f7fb0') +
    path_('M0 8 q8 -2 16 0 t16 0 t16 0 t16 0', {
      stroke: '#bfe2f5',
      'stroke-width': 1,
      opacity: 0.6,
    }) +
    rect(0, 0, T, 1.2, '#5a5752') +
    rect(0, 14.8, T, 1.2, '#5a5752'),
  road: (r) =>
    rect(0, 1.5, T, 13, '#b89a68', { rx: 3 }) +
    rect(0, 3, T, 10, '#c9ad7b', { rx: 3 }) +
    sp(r, 26, ['#a08455', '#d8c294'], 0.5, 1.4),
  track: () =>
    rect(0, 2, T, 12, '#a98b5a', { rx: 4, opacity: 0.55 }) +
    rect(0, 4.6, T, 1.8, '#6f5733') +
    rect(0, 9.6, T, 1.8, '#6f5733'),
  street: (r) => {
    let out = rect(0, 0, T, L, '#6f6c68');
    for (let gx = 0; gx < 8; gx++)
      for (let gy = 0; gy < 2; gy++)
        out += circle(gx * 8 + 4 + (gy ? 4 : 0), gy * 8 + 4, 3.3, vary(r, '#8c8882', 0.12));
    return out;
  },
  path: (r) =>
    rect(0, 5, T, 6, '#b79f78', { rx: 3, opacity: 0.8 }) +
    sp(r, 14, ['#9a8461', '#d4c29c'], 0.5, 1.1),
};
function sp(r, n, colors, lo, hi) {
  return Array.from({ length: n }, () => {
    const x = between(r, 0, T);
    const y = between(r, 3, L - 3);
    const rad = between(r, lo, hi);
    return wrappedX(x, rad, (px) => circle(px, y, rad, pick(r, colors)));
  }).join('');
}
function wrappedX(x, reach, draw) {
  const xs = [x];
  if (x < reach) xs.push(x + T);
  if (x > T - reach) xs.push(x - T);
  return xs.map(draw).join('');
}
const speckle2 = (r) => sp(r, 8, ['#ffffff'], 0.5, 1);

const WALL = {
  stone: (r) => {
    let out = rect(0, 0, T, L, '#4f4e52');
    const cuts = [
      0,
      ...Array.from({ length: 3 }, () => between(r, 6, T - 6)).sort((a, b) => a - b),
      T,
    ];
    for (let i = 0; i < cuts.length - 1; i++)
      out += rect(cuts[i] + 0.8, 1.5, cuts[i + 1] - cuts[i] - 1.6, 13, vary(r, '#8d8c92', 0.1), {
        rx: 1.5,
      });
    return out + bandEdge(1.2, 1.2);
  },
  brick: (r) => {
    let out = rect(0, 0, T, L, '#5c3b32');
    for (let row = 0; row < 2; row++)
      for (let x = -8; x < T + 8; x += 16)
        out += rect(x + (row ? 8 : 0) + 0.8, row * 8 + 0.8, 14.4, 6.4, vary(r, '#a35a45', 0.1));
    return out + bandEdge(1, 1);
  },
  wood: (r) => {
    let out = '';
    for (let i = 0; i < 2; i++) {
      const fill = vary(r, '#8a5a2b', 0.08);
      out += rect(0, i * 8, T, 8, fill) + rect(0, i * 8 + 7, T, 1, '#3a2615');
      for (let g = 0; g < 3; g++)
        out += line(
          0,
          i * 8 + between(r, 1.5, 6.5),
          T,
          i * 8 + between(r, 1.5, 6.5),
          shade(fill, 0.78),
          0.7,
          { opacity: 0.7 }
        );
    }
    return out + bandEdge(0.8, 0.8);
  },
  rock: (r) =>
    rect(0, 0, T, L, '#4e4a46') +
    sp(r, 22, ['#625d58', '#3d3a36', '#6f6a64'], 2.5, 5) +
    bandEdge(1, 1),
  metal: () => {
    let out = rect(0, 0, T, L, '#5a6167') + rect(0, 7.4, T, 1.2, '#2f3438');
    for (const x of [0, 32]) {
      out += rect(x + 1, 1.4, 30, 5.2, '#7b838a') + rect(x + 1, 9.4, 30, 5.2, '#7b838a');
      for (const cx of [4, 28])
        out += circle(x + cx, 4, 1, '#3a4045') + circle(x + cx, 12, 1, '#3a4045');
    }
    return out + bandEdge(1, 1);
  },
  ice: (r) =>
    rect(0, 0, T, L, '#b3dcec') +
    along(
      path_('M4 3 L20 8 L34 4 M40 14 L52 8 L60 12', {
        stroke: '#ffffff',
        'stroke-width': 1.1,
        opacity: 0.8,
      })
    ) +
    sp(r, 10, ['#e3f6fc', '#8cc4da'], 1, 2.5) +
    bandEdge(1, 1),
  hedge: (r) => {
    let out = rect(0, 0, T, L, '#264d24');
    for (let i = 0; i < 18; i++) {
      const x = between(r, 0, T);
      const y = between(r, 3, 13);
      const rad = between(r, 3, 5);
      out += wrappedX(x, rad, (px) => circle(px, y, rad, vary(r, '#33702f', 0.2)));
    }
    return out + sp(r, 14, ['#58a049'], 0.8, 1.6);
  },
  palisade: (r) => {
    let out = rect(0, 0, T, L, '#2c1d10');
    for (let i = 0; i < 4; i++) {
      const fill = vary(r, '#8a5a2b', 0.1);
      out +=
        circle(i * 16 + 8, 8, 7.4, fill) +
        circle(i * 16 + 8, 8, 4.6, shade(fill, 0.85), { opacity: 0.8 }) +
        circle(i * 16 + 8, 8, 1.8, shade(fill, 0.7));
    }
    return out;
  },
  glass: () =>
    rect(0, 0, T, L, 'rgba(170,220,235,0.35)') +
    rect(0, 0, T, 1.4, 'rgba(70,110,130,0.9)') +
    rect(0, 14.6, T, 1.4, 'rgba(70,110,130,0.9)') +
    line(8, 3.5, 20, 12.5, 'rgba(255,255,255,0.75)', 1.2) +
    line(34, 3.5, 46, 12.5, 'rgba(255,255,255,0.75)', 1.2),
  bars: () => bars(8, '#33363b') + rect(0, 1, T, 1.8, '#33363b') + rect(0, 13.2, T, 1.8, '#33363b'),
  fence: () =>
    rect(0, 4.4, T, 1.8, '#8a5a2b') +
    rect(0, 9.8, T, 1.8, '#8a5a2b') +
    [0, 32]
      .map((x) => rect(x + 1, 1, 4, 14, '#6f4821') + rect(x + 1, 1, 4, 1.4, '#a8763b'))
      .join(''),
};
function bars(gap, colour, y = 0, h = L) {
  let out = '';
  for (let x = gap / 2; x < T; x += gap)
    out += rect(x - 1.1, y, 2.2, h, colour) + rect(x - 1.1, y, 0.8, h, 'rgba(255,255,255,0.3)');
  return out;
}

const planks = (r, base, n = 8) => {
  let out = '';
  for (let i = 0; i < n; i++) {
    const w = T / n;
    out +=
      rect(i * w, 0, w, L, vary(r, base, 0.08)) +
      rect(i * w + w - 0.8, 0, 0.8, L, shade(base, 0.5));
  }
  return out;
};

const DOOR = {
  wood: (r) =>
    planks(r, '#8a5a2b', 8) +
    rect(0, 0, T, 1.2, '#3a2615') +
    rect(0, 14.8, T, 1.2, '#3a2615') +
    rect(4, 3, 10, 2, '#2a2a2e') +
    rect(4, 11, 10, 2, '#2a2a2e') +
    circle(48, 8, 2.2, '#d9b44a', { stroke: '#7a5c1a', 'stroke-width': 0.8 }),
  iron: () => {
    let out =
      rect(0, 0, T, L, '#3b3f45') +
      rect(0, 0, T, 1.4, '#22252a') +
      rect(0, 14.6, T, 1.4, '#22252a');
    for (const x of [10, 32, 54]) out += rect(x - 1.5, 0, 3, L, '#4d5259');
    for (let x = 4; x < T; x += 10)
      out += circle(x, 4, 0.9, '#6a7078') + circle(x, 12, 0.9, '#6a7078');
    return out + circle(46, 8, 2.2, '#9aa1a8');
  },
  stone: (r) =>
    rect(0, 0, T, L, '#7a7a80') +
    rect(0, 0, T, 1.4, '#45454a') +
    rect(0, 14.6, T, 1.4, '#45454a') +
    rect(31.4, 1.4, 1.2, 13.2, '#45454a') +
    sp(r, 14, ['#6b6b71', '#8c8c92'], 1, 2.4),
  metal: () =>
    rect(0, 0, T, L, '#6a7278') +
    rect(0, 0, T, 1.4, '#3a4045') +
    rect(0, 14.6, T, 1.4, '#3a4045') +
    circle(32, 8, 6.2, '#4b5257', { stroke: '#a4adb3', 'stroke-width': 1.2 }) +
    line(26, 8, 38, 8, '#a4adb3', 1.2) +
    line(32, 3, 32, 13, '#a4adb3', 1.2),
  curtain: (r) => {
    let out = rect(0, 0, T, L, '#7a1f2a');
    for (let x = 0; x < T; x += 8)
      out +=
        rect(x, 0, 4, L, vary(r, '#98303c', 0.1)) + rect(x + 4, 0, 4, L, vary(r, '#5e1620', 0.1));
    return out + rect(0, 0, T, 1.6, '#c9a24a');
  },
  glass: () =>
    rect(0, 0, T, L, 'rgba(170,220,235,0.35)') +
    rect(0, 0, T, 1.8, '#5e4a2f') +
    rect(0, 14.2, T, 1.8, '#5e4a2f') +
    rect(0, 0, 1.8, L, '#5e4a2f') +
    rect(62.2, 0, 1.8, L, '#5e4a2f') +
    rect(31.1, 0, 1.8, L, '#5e4a2f') +
    circle(40, 8, 1.8, '#d9b44a') +
    line(10, 3.5, 20, 12.5, 'rgba(255,255,255,0.75)', 1.1),
  bars: () =>
    bars(8, '#33363b') +
    rect(0, 0, T, 2, '#22252a') +
    rect(0, 14, T, 2, '#22252a') +
    rect(0, 6.5, T, 3, '#33363b'),
  gate: () =>
    rect(0, 0, T, 2.4, '#4a3220') +
    rect(0, 13.6, T, 2.4, '#4a3220') +
    rect(0, 6.6, T, 2.8, '#4a3220') +
    bars(6, '#6f4821'),
};

const WINDOW = {
  glass: () =>
    rect(0, 3, T, 10, '#6b5a43') +
    rect(2, 5, T - 4, 6, 'rgba(170,220,235,0.55)') +
    rect(31, 5, 2, 6, '#6b5a43') +
    line(8, 6, 18, 10, 'rgba(255,255,255,0.8)', 1),
  bars: () =>
    rect(0, 3, T, 10, '#6b5a43') +
    rect(2, 5, T - 4, 6, 'rgba(20,20,24,0.25)') +
    bars(7, '#2c2f34', 3, 10),
  opening: () =>
    rect(0, 3, T, 1.6, '#8a7a62') +
    rect(0, 11.4, T, 1.6, '#8a7a62') +
    rect(0, 3, 1.6, 10, '#8a7a62') +
    rect(62.4, 3, 1.6, 10, '#8a7a62'),
  shutters: (r) => {
    let out = '';
    for (const x of [0, 32]) {
      out += rect(x + 1, 2, 30, 12, '#7a5a35', { stroke: '#3a2615', 'stroke-width': 1 });
      for (let k = 0; k < 4; k++)
        out += line(x + 3, 4 + k * 2.6, x + 29, 4 + k * 2.6, vary(r, '#5a3f21', 0.1), 0.9);
    }
    return out;
  },
};

// ── Objects (16 units to the foot, seen from above) ──────────────────

const WOOD = '#8a5a2b';
const WOOD_DARK = '#3a2615';
const STONE_DARK = '#55555b';

function plank(W, H, base = WOOD, r = null, o = {}) {
  let out = rect(1.5, 1.5, W - 3, H - 3, base, {
    stroke: WOOD_DARK,
    'stroke-width': 2,
    rx: 3,
    ...o,
  });
  if (r)
    for (let i = 0; i < Math.max(2, Math.round(H / 14)); i++)
      out += line(5, between(r, 6, H - 6), W - 5, between(r, 6, H - 6), shade(base, 0.8), 0.9, {
        opacity: 0.6,
      });
  return out;
}

const OBJECT = {
  chest: (W, H) =>
    rect(2, 3, W - 4, H - 6, WOOD, { stroke: WOOD_DARK, 'stroke-width': 2, rx: 4 }) +
    rect(2, 3, W - 4, H * 0.42, '#a06c38', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 4 }) +
    rect(W * 0.2, 3, 4, H - 6, '#b8a46a') +
    rect(W * 0.8 - 4, 3, 4, H - 6, '#b8a46a') +
    rect(W / 2 - 4, H * 0.42 - 2, 8, 9, '#d9b44a', {
      stroke: '#7a5c1a',
      'stroke-width': 1.2,
      rx: 1.5,
    }),
  table: (W, H, r) =>
    plank(W, H, '#9b6a3a', r) +
    rect(7, 7, W - 14, H - 14, 'none', {
      stroke: shade('#9b6a3a', 0.75),
      'stroke-width': 1,
      opacity: 0.7,
    }),
  chair: (W, H) =>
    rect(4, 8, W - 8, H - 12, '#8a5a2b', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 3 }) +
    rect(4, 3, W - 8, 6, '#6b4220', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 2 }),
  bench: (W, H, r) =>
    plank(W, H, '#94623a', r) +
    line(W / 3, 3, W / 3, H - 3, WOOD_DARK, 1) +
    line((2 * W) / 3, 3, (2 * W) / 3, H - 3, WOOD_DARK, 1),
  bed: (W, H) =>
    rect(2, 2, W - 4, H - 4, '#6d4a2a', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 3 }) +
    rect(6, 6, W - 12, H - 12, '#e8e2d0', { rx: 3 }) +
    rect(10, 10, W - 20, 20, '#f6f3ea', { stroke: '#cfc8b2', 'stroke-width': 1.2, rx: 5 }) +
    rect(6, H * 0.4, W - 12, H * 0.6 - 6, '#8b2a2f', { rx: 3 }) +
    line(8, H * 0.4 + 8, W - 8, H * 0.4 + 8, '#c25a60', 1.4),
  desk: (W, H, r) =>
    plank(W, H, '#8d5f34', r) +
    rect(W - 24, 7, 17, 14, '#f0e8cc', { stroke: '#b5a97c', 'stroke-width': 0.8 }) +
    circle(14, 14, 3, '#1f2a4a') +
    rect(W * 0.3, H - 9, W * 0.4, 3, WOOD_DARK, { rx: 1 }),
  bookshelf: (W, H, r) => {
    let out = rect(1.5, 1.5, W - 3, H - 3, '#4a3220', { stroke: '#22160c', 'stroke-width': 2 });
    for (let row = 0; row < 2; row++) {
      let x = 5;
      while (x < W - 8) {
        const w = between(r, 3, 6);
        out += rect(
          x,
          5 + row * (H / 2 - 2),
          Math.min(w, W - 6 - x),
          H / 2 - 8,
          pick(r, ['#7a2a2a', '#2a4f7a', '#2f6b3a', '#8a6a2a', '#5a2a6b', '#6b6b6b']),
          { stroke: '#22160c', 'stroke-width': 0.6 }
        );
        x += w + 0.4;
      }
    }
    return out;
  },
  wardrobe: (W, H) =>
    rect(1.5, 1.5, W - 3, H - 3, '#6f4a27', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 2 }) +
    line(W / 2, 2, W / 2, H - 2, WOOD_DARK, 1.6) +
    circle(W / 2 - 5, H / 2, 1.8, '#d9b44a') +
    circle(W / 2 + 5, H / 2, 1.8, '#d9b44a') +
    rect(5, 5, W - 10, 3, '#8a5f33'),
  rug: (W, H) =>
    rect(2, 4, W - 4, H - 8, '#8b2a2f') +
    rect(8, 10, W - 16, H - 20, 'none', { stroke: '#d8b25a', 'stroke-width': 2 }) +
    poly(
      [
        [W / 2, 18],
        [W - 24, H / 2],
        [W / 2, H - 18],
        [24, H / 2],
      ],
      '#b8463e',
      { stroke: '#d8b25a', 'stroke-width': 1.4 }
    ) +
    circle(W / 2, H / 2, 8, '#d8b25a', { opacity: 0.8 }) +
    Array.from(
      { length: Math.floor(W / 6) },
      (_, i) =>
        line(4 + i * 6, 1, 4 + i * 6, 5, '#e0d2a4', 1) +
        line(4 + i * 6, H - 5, 4 + i * 6, H - 1, '#e0d2a4', 1)
    ).join(''),
  barrel: (W) =>
    circle(W / 2, W / 2, W / 2 - 2, WOOD, { stroke: WOOD_DARK, 'stroke-width': 2 }) +
    circle(W / 2, W / 2, W / 2 - 7, 'none', { stroke: '#4a4f55', 'stroke-width': 2 }) +
    [-1, 0, 1]
      .map((i) => line(W / 2 + i * 6, 6, W / 2 + i * 6, W - 6, shade(WOOD, 0.75), 0.9))
      .join('') +
    circle(W / 2, W / 2, 2.4, '#4a4f55'),
  crate: (W, H) =>
    rect(2, 2, W - 4, H - 4, '#b08850', { stroke: WOOD_DARK, 'stroke-width': 2 }) +
    rect(6, 6, W - 12, H - 12, 'none', { stroke: '#7d5c2e', 'stroke-width': 2 }) +
    line(7, 7, W - 7, H - 7, '#7d5c2e', 2.2) +
    line(W - 7, 7, 7, H - 7, '#7d5c2e', 2.2),
  sarcophagus: (W, H) =>
    rect(2, 2, W - 4, H - 4, '#a1a0a4', { stroke: STONE_DARK, 'stroke-width': 2, rx: 12 }) +
    rect(8, 8, W - 16, H - 16, '#b4b3b8', { stroke: STONE_DARK, 'stroke-width': 1.2, rx: 9 }) +
    circle(W / 2, 22, 6, '#8d8c92', { stroke: STONE_DARK, 'stroke-width': 1 }) +
    ellipse(W / 2, 46, 11, 7, '#8d8c92', { stroke: STONE_DARK, 'stroke-width': 1 }) +
    line(W / 2, 54, W / 2, H - 14, STONE_DARK, 1.6),
  altar: (W, H) =>
    rect(2, 2, W - 4, H - 4, '#aaaaaf', { stroke: STONE_DARK, 'stroke-width': 2 }) +
    rect(2, H * 0.3, W - 4, H * 0.4, '#8b2a2f') +
    rect(2, H * 0.3, W - 4, 1.4, '#d8b25a') +
    rect(2, H * 0.7 - 1.4, W - 4, 1.4, '#d8b25a') +
    circle(14, H / 2, 3.2, '#f4d35e', { stroke: '#8a6a10', 'stroke-width': 0.8 }) +
    circle(W - 14, H / 2, 3.2, '#f4d35e', { stroke: '#8a6a10', 'stroke-width': 0.8 }) +
    circle(W / 2, H / 2, 4, '#d9b44a', { stroke: '#7a5c1a', 'stroke-width': 1 }),
  statue: (W) =>
    circle(W / 2, W / 2, W / 2 - 2, '#a6a6ab', { stroke: STONE_DARK, 'stroke-width': 2 }) +
    ellipse(W / 2, W / 2 + 2, 13, 8, '#7c7c82', { stroke: '#4a4a50', 'stroke-width': 1 }) +
    circle(W / 2, W / 2 - 1, 6.5, '#8f8f95', { stroke: '#4a4a50', 'stroke-width': 1 }),
  pillar: (W) =>
    circle(W / 2, W / 2, W / 2 - 1.5, '#a4a4aa', { stroke: STONE_DARK, 'stroke-width': 2 }) +
    circle(W / 2, W / 2, W / 2 - 6, '#b8b8be', { stroke: '#7a7a80', 'stroke-width': 1 }) +
    circle(W / 2 - 2, W / 2 - 2, 3, '#d4d4da', { opacity: 0.7 }),
  fountain: (W) =>
    circle(W / 2, W / 2, W / 2 - 2, '#a6a6ab', { stroke: STONE_DARK, 'stroke-width': 2.4 }) +
    circle(W / 2, W / 2, W / 2 - 9, '#4a8fc0') +
    [0.7, 0.45]
      .map((k) =>
        circle(W / 2, W / 2, (W / 2 - 9) * k, 'none', {
          stroke: '#cfe9f7',
          'stroke-width': 1.2,
          opacity: 0.7,
        })
      )
      .join('') +
    circle(W / 2, W / 2, 9, '#b4b4ba', { stroke: STONE_DARK, 'stroke-width': 1.6 }) +
    circle(W / 2, W / 2, 3.6, '#8fc8ec'),
  console: (W, H) =>
    rect(2, 2, W - 4, H - 4, '#2b3138', { stroke: '#14181c', 'stroke-width': 2, rx: 3 }) +
    rect(7, 6, W * 0.5, H - 14, 'rgba(57,197,212,0.55)', {
      stroke: '#39c5d4',
      'stroke-width': 1,
      rx: 2,
    }) +
    [0, 1, 2]
      .map((i) => circle(W * 0.64 + i * 7, 10, 2, ['#e04f4f', '#e0c94f', '#4fe06a'][i]))
      .join('') +
    line(W * 0.62, H - 9, W - 8, H - 9, '#7a838c', 2) +
    line(W * 0.62, H - 15, W - 8, H - 15, '#7a838c', 2),
  lever: (W) =>
    rect(1, 1, W - 2, W - 2, '#6d737a', { stroke: '#2f3438', 'stroke-width': 1.2, rx: 2 }) +
    line(W / 2, W / 2, W / 2 + 3, 3, '#a4adb3', 2) +
    circle(W / 2 + 3, 3.4, 2.6, '#d24a4a', { stroke: '#7a1f1f', 'stroke-width': 0.8 }),
  brazier: (W) =>
    circle(W / 2, W / 2, W / 2 - 1.5, '#555a60', { stroke: '#2a2d31', 'stroke-width': 2 }) +
    circle(W / 2, W / 2, W / 2 - 5, '#2f1a10') +
    [
      [-4, -2],
      [3, -4],
      [4, 3],
      [-3, 4],
      [0, 0],
    ]
      .map(([dx, dy], i) =>
        circle(W / 2 + dx, W / 2 + dy, 3 - (i % 2), i % 2 ? '#ffb02e' : '#ff7a1c')
      )
      .join(''),
  cauldron: (W) =>
    circle(W / 2, W / 2, W / 2 - 1.5, '#23252a', { stroke: '#0e0f11', 'stroke-width': 2 }) +
    circle(W / 2, W / 2, W / 2 - 6, '#5fbf4f') +
    [
      [-6, -4, 3],
      [5, 3, 2.4],
      [-2, 7, 2],
      [6, -7, 1.6],
    ]
      .map(([dx, dy, rr]) => circle(W / 2 + dx, W / 2 + dy, rr, '#a6e88f', { opacity: 0.85 }))
      .join('') +
    path_(`M3 ${W / 2 - 4} q-4 4 0 8 M${W - 3} ${W / 2 - 4} q4 4 0 8`, {
      stroke: '#23252a',
      'stroke-width': 2,
    }),
  anvil: (W, H) =>
    poly(
      [
        [4, 8],
        [W - 4, 8],
        [W - 4, 20],
        [W - 10, 24],
        [W - 10, H - 6],
        [10, H - 6],
        [10, 24],
        [4, 20],
      ],
      '#4a4f56',
      { stroke: '#1d2024', 'stroke-width': 1.6, 'stroke-linejoin': 'round' }
    ) +
    rect(7, 10, W - 14, 4, '#7a8189', { rx: 1 }) +
    ellipse(W / 2, 6, 3, 4, '#4a4f56', { stroke: '#1d2024', 'stroke-width': 1 }),
  campfire: (W) =>
    Array.from({ length: 8 }, (_, i) =>
      circle(
        W / 2 + Math.cos((i * Math.PI) / 4) * (W / 2 - 7),
        W / 2 + Math.sin((i * Math.PI) / 4) * (W / 2 - 7),
        5,
        i % 2 ? '#8c8c92' : '#a4a4aa',
        { stroke: STONE_DARK, 'stroke-width': 1 }
      )
    ).join('') +
    circle(W / 2, W / 2, W / 2 - 13, '#2a1a10') +
    rect(W / 2 - 14, W / 2 - 2.5, 28, 5, '#6b4220', {
      stroke: WOOD_DARK,
      'stroke-width': 1,
      transform: `rotate(35 ${W / 2} ${W / 2})`,
    }) +
    rect(W / 2 - 14, W / 2 - 2.5, 28, 5, '#7a4a25', {
      stroke: WOOD_DARK,
      'stroke-width': 1,
      transform: `rotate(-35 ${W / 2} ${W / 2})`,
    }) +
    poly(
      [
        [W / 2, W / 2 - 11],
        [W / 2 + 7, W / 2 + 5],
        [W / 2, W / 2 + 8],
        [W / 2 - 7, W / 2 + 5],
      ],
      '#ff8a1c'
    ) +
    poly(
      [
        [W / 2, W / 2 - 5],
        [W / 2 + 3.5, W / 2 + 4],
        [W / 2 - 3.5, W / 2 + 4],
      ],
      '#ffe27a'
    ),
  tree: (W, H, r) => {
    let out = circle(W / 2 + 5, H / 2 + 6, W / 2 - 6, 'rgba(0,0,0,0.25)');
    const greens = ['#2f5d30', '#376b37', '#2a5a35', '#3f7a3c'];
    out += circle(W / 2, H / 2, W / 2 - 4, '#244d27');
    for (let i = 0; i < 14; i++) {
      const a = between(r, 0, Math.PI * 2);
      const d = between(r, 0, W / 2 - 24);
      const rad = between(r, 14, 24);
      out += circle(W / 2 + Math.cos(a) * d, H / 2 + Math.sin(a) * d, rad, pick(r, greens));
    }
    return (
      out +
      [0, 1, 2, 3, 4]
        .map(() =>
          circle(between(r, 30, W - 30), between(r, 30, H - 30), between(r, 4, 9), '#5aa04c', {
            opacity: 0.55,
          })
        )
        .join('')
    );
  },
  boulder: (W, H) =>
    poly(
      [
        [W * 0.15, H * 0.55],
        [W * 0.25, H * 0.2],
        [W * 0.55, H * 0.08],
        [W * 0.85, H * 0.28],
        [W * 0.92, H * 0.65],
        [W * 0.62, H * 0.92],
        [W * 0.28, H * 0.86],
      ],
      '#7d7b78',
      { stroke: '#3f3d3b', 'stroke-width': 2, 'stroke-linejoin': 'round' }
    ) +
    poly(
      [
        [W * 0.25, H * 0.2],
        [W * 0.55, H * 0.08],
        [W * 0.5, H * 0.45],
        [W * 0.3, H * 0.5],
      ],
      '#9d9b97'
    ) +
    poly(
      [
        [W * 0.55, H * 0.08],
        [W * 0.85, H * 0.28],
        [W * 0.7, H * 0.5],
        [W * 0.5, H * 0.45],
      ],
      '#8c8a86'
    ) +
    poly(
      [
        [W * 0.62, H * 0.92],
        [W * 0.92, H * 0.65],
        [W * 0.7, H * 0.5],
        [W * 0.5, H * 0.45],
        [W * 0.28, H * 0.86],
      ],
      '#65635f'
    ),
  well: (W) =>
    circle(W / 2, W / 2, W / 2 - 1.5, '#8a8a90', { stroke: STONE_DARK, 'stroke-width': 2 }) +
    Array.from({ length: 12 }, (_, i) =>
      line(
        W / 2 + Math.cos((i * Math.PI) / 6) * (W / 2 - 10),
        W / 2 + Math.sin((i * Math.PI) / 6) * (W / 2 - 10),
        W / 2 + Math.cos((i * Math.PI) / 6) * (W / 2 - 2),
        W / 2 + Math.sin((i * Math.PI) / 6) * (W / 2 - 2),
        STONE_DARK,
        1
      )
    ).join('') +
    circle(W / 2, W / 2, W / 2 - 10, '#16324a') +
    circle(W / 2, W / 2, W / 2 - 14, '#24557f', { opacity: 0.8 }) +
    rect(3, W / 2 - 2.5, W - 6, 5, '#7a4f26', { stroke: WOOD_DARK, 'stroke-width': 1.2, rx: 1.5 }),
  cart: (W, H, r) =>
    rect(8, 22, W - 16, H - 44, '#8a5a2b', { stroke: WOOD_DARK, 'stroke-width': 2, rx: 2 }) +
    Array.from({ length: 6 }, (_, i) =>
      line(10, 30 + i * ((H - 60) / 5), W - 10, 30 + i * ((H - 60) / 5), shade(WOOD, 0.75), 1)
    ).join('') +
    rect(1, H * 0.5 - 14, 8, 28, '#2e2a26', { rx: 2 }) +
    rect(W - 9, H * 0.5 - 14, 8, 28, '#2e2a26', { rx: 2 }) +
    rect(W / 2 - 14, 2, 2.4, 22, '#6b4220') +
    rect(W / 2 + 12, 2, 2.4, 22, '#6b4220') +
    circle(W / 2, H - 34 + (r() - 0.5), 9, '#b08850', { stroke: WOOD_DARK, 'stroke-width': 1.2 }),
  tent: (W, H) =>
    rect(4, 4, W - 8, H - 8, '#c9b68a', { stroke: '#5e5238', 'stroke-width': 2.4, rx: 3 }) +
    rect(W / 2, 4, W / 2 - 4, H - 8, '#a99768', { rx: 3 }) +
    line(W / 2, 4, W / 2, H - 4, '#5e5238', 2.4) +
    poly(
      [
        [W / 2 - 14, H - 4],
        [W / 2, H - 30],
        [W / 2 + 14, H - 4],
      ],
      '#7a6a45',
      { stroke: '#5e5238', 'stroke-width': 1.6 }
    ),
  stairs: (W, H) => {
    let out = rect(1, 1, W - 2, H - 2, '#9a9aa0', { stroke: STONE_DARK, 'stroke-width': 2 });
    const n = Math.round(H / 16);
    for (let i = 0; i < n; i++)
      out +=
        rect(1, 1 + (i * (H - 2)) / n, W - 2, (H - 2) / n, i % 2 ? '#a8a8ae' : '#8f8f95') +
        line(1, 1 + ((i + 1) * (H - 2)) / n, W - 1, 1 + ((i + 1) * (H - 2)) / n, STONE_DARK, 1);
    return out + rect(1, 1, 5, H - 2, '#6d6d73') + rect(W - 6, 1, 5, H - 2, '#6d6d73');
  },
  trapdoor: (W, H, r) =>
    plank(W, H, '#8a5a2b', r) +
    line(W / 2, 3, W / 2, H - 3, WOOD_DARK, 1.2) +
    circle(W / 2, H / 2, 6, 'none', { stroke: '#4a4f55', 'stroke-width': 2.2 }) +
    circle(W / 2, H / 2 - 6, 1.8, '#4a4f55') +
    rect(5, 5, 6, 3, '#4a4f55') +
    rect(W - 11, 5, 6, 3, '#4a4f55'),
};

// The box with a question mark: an object with no art at all (OB1).
const UNKNOWN = svg(
  48,
  48,
  rect(3, 3, 42, 42, '#c8b48a', { stroke: '#5a4a2a', 'stroke-width': 3, rx: 5 }) +
    rect(7, 7, 34, 34, '#d9c9a0', { stroke: '#8a7648', 'stroke-width': 1.2, rx: 3 }) +
    path_('M17 19 C17 9 33 9 33 19 C33 26 24 26 24 33', {
      stroke: '#3a2f18',
      'stroke-width': 4.4,
      'stroke-linecap': 'round',
    }) +
    circle(24, 40, 2.8, '#3a2f18')
);

// ── Writing ──────────────────────────────────────────────────────────

function files() {
  const out = new Map();
  const tile = (artPath, w, h, inner) => out.set(artPath, svg(w, h, inner));
  for (const item of catalog.MATERIALS) {
    const r = rng(`${item.kind}-${item.id}`);
    const make = { ground: GROUND, line: LINE, wall: WALL, door: DOOR, window: WINDOW }[item.kind][
      item.id
    ];
    if (!make) throw new Error(`No art is drawn for ${item.kind} ${item.id}.`);
    const strip = item.kind !== 'ground';
    tile(item.art, T, strip ? L : T, make(r));
  }
  for (const item of catalog.OBJECT_KINDS) {
    const make = OBJECT[item.id];
    if (!make) throw new Error(`No art is drawn for the object ${item.id}.`);
    const [w, h] = item.size.map((ft) => Math.round(ft * PER_FOOT));
    tile(item.art, w, h, make(w, h, rng(`object-${item.id}`)));
  }
  out.set(catalog.FALLBACK_ART, UNKNOWN);
  return out;
}

const made = files();
for (const text of made.values()) checkSvg(text);

if (process.argv.includes('--check')) {
  const stale = [...made].filter(([name, text]) => {
    const file = path.join(OUT, name);
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text;
  });
  if (stale.length) {
    console.error(
      `${stale.length} art file(s) are out of date: ${stale.map(([n]) => n).join(', ')}`
    );
    process.exit(1);
  }
  console.log(`All ${made.size} art files are up to date.`);
} else {
  for (const [name, text] of made) {
    const file = path.join(OUT, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  console.log(`Wrote ${made.size} art files to ${path.relative(ROOT, OUT)}.`);
}
