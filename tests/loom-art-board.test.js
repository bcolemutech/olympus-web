'use strict';

/**
 * The art pipeline's board step (planning/game-art.md §4.4, AR6; L-946 /
 * #800): `node scripts/art/art.js board <out> <dir | files> [--tile] [--cols n]
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
