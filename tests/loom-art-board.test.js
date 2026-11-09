'use strict';

/**
 * The art pipeline's board step (planning/game-art.md §4.4, AR6; L-946 /
 * #800): `node scripts/art/art.js board <out> <dir | files> [--tile | --across] [--cols n]
 * [--title text]` lays a batch out for the user to approve, each picture in
 * a cell with its name under it. Run as the command it is, on the pictures of
 * the tests' own set (fixtures/art-sets/files).
 *
 * Run: cd tests && npx jest loom-art-board --verbose
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');

const ROOT = path.join(__dirname, '..');
const SET = path.join(__dirname, 'fixtures/art-sets/files');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'board-')), 'board.png');

const board = (...args) =>
  JSON.parse(
    execFileSync('node', [path.join(ROOT, 'scripts/art/art.js'), 'board', out, ...args], {
      encoding: 'utf8',
    })
  );
const read = () => PNG.sync.read(fs.readFileSync(out));
// Cells are 256 px with a 34 px label and 14 px gaps; a title takes 44 px.
const widthFor = (cols) => 14 + cols * (256 + 14);
const heightFor = (rows, title) => (title ? 44 : 0) + 14 + rows * (256 + 34 + 14);

test('a folder of pictures is laid out in rows, each in its cell', () => {
  const files = fs.readdirSync(path.join(SET, 'objects'));
  expect(files.length).toBe(2);
  const made = board(path.join(SET, 'objects'), '--cols', '2');
  expect(made).toMatchObject({
    count: 2,
    width: widthFor(2),
    height: heightFor(1, false),
  });
  const png = read();
  expect([png.width, png.height]).toEqual([made.width, made.height]);
  // The first cell has its picture in it: not all one colour.
  const colours = new Set();
  for (let y = 20; y < 260; y += 3) {
    for (let x = 20; x < 260; x += 3) {
      const i = (y * png.width + x) * 4;
      colours.add(`${png.data[i]},${png.data[i + 1]},${png.data[i + 2]}`);
    }
  }
  expect(colours.size).toBeGreaterThan(20);
});

test('more pictures than columns go on to another row; a title makes room along the top', () => {
  const list = [
    path.join(SET, 'objects/chest.webp'),
    path.join(SET, 'objects/pillar.webp'),
    path.join(SET, 'ground/flagstone.webp'),
  ].join(',');
  const made = board(list, '--cols', '2', '--title', 'Batch');
  expect(made).toMatchObject({ count: 3, width: widthFor(2), height: heightFor(2, true) });
  expect(read().height).toBe(made.height);
});

test('--tile shows a floor 2 × 2, so its seams show', () => {
  const made = board(path.join(SET, 'ground/flagstone.webp'), '--tile', '--cols', '1');
  expect(made).toMatchObject({ count: 1, width: widthFor(1) });
  const png = read();
  // The cell's quarters match: the picture repeated across it.
  const at = (x, y) => {
    const i = (y * png.width + x) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const left = at(14 + 40, 14 + 40);
  const right = at(14 + 128 + 40, 14 + 40);
  const below = at(14 + 40, 14 + 128 + 40);
  [right, below].forEach((c) =>
    c.forEach((v, k) => expect(Math.abs(v - left[k])).toBeLessThanOrEqual(2))
  );
});

test('--across shows a strip twice side by side, so its seam shows', () => {
  const strip = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'strip-')), 'strip.png');
  // A strip 4:1 whose left half is red and right half blue, a little grain
  // in each (so its inside has some difference to measure against).
  const png = new PNG({ width: 64, height: 16 });
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 64; x++) {
      const i = (y * 64 + x) * 4;
      const g = (x % 2) * 6;
      png.data.set(x < 32 ? [220 - g, 30, 30, 255] : [30, 30, 220 - g, 255], i);
    }
  }
  fs.writeFileSync(strip, PNG.sync.write(png));
  const made = board(strip, '--across', '--cols', '1');
  // A cell twice as wide (512), as tall as the strip at 256 wide (64).
  expect(made).toMatchObject({ count: 1, width: 14 + 512 + 14, height: 14 + 64 + 34 + 14 });
  const out = read();
  const at = (x, y) => {
    const i = (y * out.width + x) * 4;
    return [out.data[i], out.data[i + 1], out.data[i + 2]];
  };
  const y = 14 + 32;
  // Red, blue, then red again where the second copy starts.
  expect(at(14 + 60, y)[0]).toBeGreaterThan(150);
  expect(at(14 + 200, y)[2]).toBeGreaterThan(150);
  expect(at(14 + 256 + 60, y)[0]).toBeGreaterThan(150);
  // The check scores only a strip's side edges: here they differ (red, blue).
  const report = JSON.parse(
    execFileSync('node', [path.join(ROOT, 'scripts/art/art.js'), 'check', strip, 'strip'], {
      encoding: 'utf8',
    })
  );
  expect(report.seam).toBeGreaterThan(3);
});
