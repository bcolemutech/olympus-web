'use strict';

/**
 * The art's size budget (planning/game-art.md §4.3, EN1, EN2; L-944 / #798):
 * how big each picture of an art set may be, and the set as a whole, so a
 * large map still draws quickly on a slow phone. The pipeline's `webp` step
 * fits pictures to it (./steps.js) and a test fails on any set over it
 * (tests/loom-art-sets.test.js). Pure, no dependencies: it reads WebP and
 * PNG headers itself.
 *
 *   LIMITS              the limits, below
 *   roleLimits(role, o) a role's limits: { width, height, bytes }
 *   sizeOf(file)        { format, width, height } from its header
 *   picturesOf(m)       each picture a manifest names, with its role
 *   checkSet(dir)       { problems: [sentence], bytes, pictures }
 *
 * Roles:
 *   ground   a floor (and its variants): its long side at most 1024 px for
 *            five squares (25 ft) of span
 *   strip    a wall's, door's, window's or line's top, seen from above
 *   face     a wall's face, standing: 64 px a foot of an 8 ft wall high
 *   object   a prop, standing or from above: 64 px a foot of its width
 *   atlas    a sheet of frames: 2048 px a side
 */

const fs = require('fs');
const path = require('path');

const PX_PER_FOOT = 64;
const FEET_PER_SQUARE = 5;
const KB = 1024;
const LIMITS = {
  pxPerFoot: PX_PER_FOOT,
  groundPx: 1024, // for five squares of span
  stripPx: 1024,
  stripShortPx: 256,
  facePx: { width: 1024, height: PX_PER_FOOT * 8 },
  objectHeightFeet: 16,
  atlasPx: 2048,
  bytes: {
    ground: 400 * KB,
    strip: 200 * KB,
    face: 300 * KB,
    object: 200 * KB,
    atlas: 1536 * KB,
  },
  setBytes: 16 * KB * KB,
};

// A material's catalog, for an object's width: read lazily, so this file
// works without functions/ installed.
function catalog() {
  return require('../../functions/loom-canon/materials.js');
}

/** A role's limits: { width, height, bytes } (width and height the most, in px). */
function roleLimits(role, o = {}) {
  if (role === 'ground') {
    const px = Math.round((LIMITS.groundPx * (o.span > 0 ? o.span : 1)) / FEET_PER_SQUARE);
    return { width: px, height: px, bytes: LIMITS.bytes.ground };
  }
  if (role === 'strip') {
    return { width: LIMITS.stripPx, height: LIMITS.stripShortPx, bytes: LIMITS.bytes.strip };
  }
  if (role === 'face') return { ...LIMITS.facePx, bytes: LIMITS.bytes.face };
  if (role === 'object') {
    const feet = (o.size && o.size[0]) || FEET_PER_SQUARE;
    return {
      width: Math.round(feet * PX_PER_FOOT),
      height: LIMITS.objectHeightFeet * PX_PER_FOOT,
      bytes: LIMITS.bytes.object,
    };
  }
  if (role === 'atlas') {
    return { width: LIMITS.atlasPx, height: LIMITS.atlasPx, bytes: LIMITS.bytes.atlas };
  }
  throw new Error(`No role "${role}".`);
}

/** A picture's format and size from its header: WebP (lossy, lossless or extended) or PNG. */
function sizeOf(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(32);
  try {
    fs.readSync(fd, b, 0, 32, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') {
      return {
        format: 'webp',
        width: 1 + b.readUIntLE(24, 3),
        height: 1 + b.readUIntLE(27, 3),
      };
    }
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return { format: 'webp', width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
    }
    if (chunk === 'VP8 ') {
      return {
        format: 'webp',
        width: b.readUInt16LE(26) & 0x3fff,
        height: b.readUInt16LE(28) & 0x3fff,
      };
    }
    return { format: 'webp', width: 0, height: 0 };
  }
  if (b.readUInt32BE(0) === 0x89504e47) {
    return { format: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  return { format: path.extname(file).slice(1) || 'unknown', width: 0, height: 0 };
}

/**
 * Each picture a manifest names: [{ where, picture, role, span?, size? }],
 * `picture` its { file } or { atlas, frame }.
 */
function picturesOf(manifest) {
  const out = [];
  const mats = manifest.materials || {};
  Object.keys(mats).forEach((id) => {
    const e = mats[id] || {};
    const kind = id.split('/')[0];
    const main = kind === 'ground' ? 'ground' : 'strip';
    if (e.file || e.atlas)
      out.push({ where: `materials "${id}"`, picture: e, role: main, span: e.span });
    (Array.isArray(e.variants) ? e.variants : []).forEach((v, i) =>
      out.push({
        where: `materials "${id}" variant ${i + 1}`,
        picture: v,
        role: 'ground',
        span: e.span,
      })
    );
    if (e.face) out.push({ where: `materials "${id}"’s face`, picture: e.face, role: 'face' });
  });
  const objs = manifest.objects || {};
  Object.keys(objs).forEach((id) => {
    const e = objs[id] || {};
    const kind = catalog().objectKind(id);
    const size = kind ? kind.size : null;
    if (e.file || e.atlas) out.push({ where: `objects "${id}"`, picture: e, role: 'object', size });
    if (e.stand) {
      out.push({ where: `objects "${id}" standing`, picture: e.stand, role: 'object', size });
    }
  });
  return out;
}

function over(where, dims, limits) {
  const out = [];
  if (dims.width > limits.width || dims.height > limits.height) {
    out.push(
      `${where} is ${dims.width} × ${dims.height} px, over its ${limits.width} × ` +
        `${limits.height} px.`
    );
  }
  return out;
}

/**
 * A set's folder checked against the budget: every picture its manifest
 * names is there, WebP, within its role's size and bytes (an atlas frame by
 * its size, its atlas by the atlas's), and the folder's files together
 * within the set's total. { problems, bytes, pictures }.
 */
function checkSet(dir) {
  const problems = [];
  const file = path.join(dir, 'manifest.json');
  if (!fs.existsSync(file))
    return { problems: [`${dir} has no manifest.json.`], bytes: 0, pictures: 0 };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const named = (f) => path.join(dir, f);
  const fileProblems = (where, f, limits) => {
    const p = named(f);
    if (!fs.existsSync(p)) return [`${where}: ${f} isn't there.`];
    const out = [];
    const dims = sizeOf(p);
    if (dims.format !== 'webp') out.push(`${where}: ${f} isn't WebP.`);
    out.push(...over(`${where} (${f})`, dims, limits));
    const bytes = fs.statSync(p).size;
    if (bytes > limits.bytes) {
      out.push(
        `${where} (${f}) is ${Math.round(bytes / KB)} KB, over its ${limits.bytes / KB} KB.`
      );
    }
    return out;
  };
  const atlases = manifest.atlases || {};
  Object.keys(atlases).forEach((id) => {
    problems.push(...fileProblems(`atlas "${id}"`, atlases[id].file, roleLimits('atlas')));
  });
  const pictures = picturesOf(manifest);
  pictures.forEach((p) => {
    const limits = roleLimits(p.role, p);
    if (p.picture.file) problems.push(...fileProblems(p.where, p.picture.file, limits));
    else if (Array.isArray(p.picture.frame)) {
      const [, , width, height] = p.picture.frame;
      problems.push(...over(`${p.where} (atlas "${p.picture.atlas}")`, { width, height }, limits));
    }
  });
  let bytes = 0;
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else bytes += fs.statSync(p).size;
    });
  walk(dir);
  if (bytes > LIMITS.setBytes) {
    problems.push(
      `The set is ${(bytes / KB / KB).toFixed(1)} MB, over its ${LIMITS.setBytes / KB / KB} MB.`
    );
  }
  return { problems, bytes, pictures: pictures.length };
}

module.exports = { LIMITS, roleLimits, sizeOf, picturesOf, checkSet };
