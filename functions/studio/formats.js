'use strict';

/**
 * The image studio's file formats (planning/the-image-studio.md §4.2; L-701 /
 * #537): PNG, JPEG, WebP and SVG. A file is known by its bytes, never its
 * name, and its size in pixels is read from its header. SVG is checked as
 * set_art checks it (../cartographer/svg.js): no scripts, nothing outside it.
 */

const { checkSvg } = require('../cartographer/svg');

const MAX_BYTES = 30 * 1024 * 1024; // as the Cartographer's PNG art (L-347)
const FORMATS = Object.freeze({
  png: { ext: 'png', contentType: 'image/png' },
  jpeg: { ext: 'jpg', contentType: 'image/jpeg' },
  webp: { ext: 'webp', contentType: 'image/webp' },
  svg: { ext: 'svg', contentType: 'image/svg+xml' },
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

// A JPEG's size, from its first start-of-frame marker.
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // padding
      continue;
    }
    const length = bytes.readUInt16BE(at + 2);
    // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(at + 5), width: bytes.readUInt16BE(at + 7) };
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

// A WebP's size, from its first chunk: lossy (VP8), lossless (VP8L) or
// extended (VP8X).
function webpSize(bytes) {
  if (bytes.length < 30) return null;
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  return null;
}

/**
 * What an uploaded file is: { format, bytes, width, height, contentType, ext },
 * the SVG cleaned. Throws an Error saying why it can't be used.
 */
function readImage(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw new Error('the file is empty');
  if (bytes.length > MAX_BYTES) {
    throw new Error(`it is larger than ${MAX_BYTES / (1024 * 1024)} MB`);
  }
  const sized = [
    ['png', pngSize],
    ['jpeg', jpegSize],
    ['webp', webpSize],
  ];
  for (const [format, sizeOf] of sized) {
    const size = sizeOf(bytes);
    if (size && size.width > 0 && size.height > 0) {
      return { format, bytes, ...size, ...FORMATS[format] };
    }
  }
  // Not a raster image: SVG text, or nothing we take.
  const text = bytes.toString('utf8');
  if (/<svg\b/i.test(text.slice(0, 4096))) {
    const checked = checkSvg(text); // throws, saying what is wrong
    return {
      format: 'svg',
      bytes: Buffer.from(checked.svg, 'utf8'),
      width: checked.width,
      height: checked.height,
      ...FORMATS.svg,
    };
  }
  throw new Error('it is not a PNG, JPEG, WebP or SVG image');
}

module.exports = { readImage, FORMATS, MAX_BYTES };
