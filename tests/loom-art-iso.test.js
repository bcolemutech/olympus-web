'use strict';

/**
 * The art pipeline's isometric props (planning/isometric-view.md §4.4, AR1,
 * AR4; L-954 / #860): `node scripts/art/art.js set <work> <setDir>` writes
 * the pictures in `iso/<id>.front.png` and `iso/<id>.back.png` as WebP within
 * the iso budget, names them in the manifest's `iso` with a foot from the
 * object's footprint and the axis it is painted long along (iso/meta.json);
 * a prop with no back stands as its front for both; a thing hung on a wall is
 * padded so its panel spans its side of the diamond; `atlas` packs them, a
 * picture standing for both facings once; and `budget` holds them to their
 * limits. Run as the commands they are, on made-up pictures.
 *
 * Run: cd tests && npx jest loom-art-iso --verbose
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { PNG } = require('pngjs');
const catalog = require('../functions/loom-canon/materials');
const budget = require('../scripts/art/budget.cjs');

const ART = path.join(__dirname, '../scripts/art/art.js');
const art = (...args) =>
  JSON.parse(execFileSync('node', [ART, ...args], { encoding: 'utf8', maxBuffer: 1 << 24 }));

// A picture of one colour, w × h, opaque.
function picture(file, w, h, [r, g, b]) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) png.data.set([r, g, b, 255], i * 4);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
}

describe('the iso budget role', () => {
  test('a picture is as wide as 40 px a foot of its footprint’s two sides', () => {
    expect(budget.roleLimits('iso', { size: [5, 3] })).toMatchObject({
      width: 320,
      height: 1024,
    });
    expect(budget.roleLimits('iso', { size: [8, 8] }).width).toBe(640);
    expect(budget.roleLimits('iso', {}).width).toBe(400);
  });

  test('a set’s isometric pictures are listed with their size, front and back', () => {
    const list = budget.picturesOf({
      objects: {
        table: {
          iso: { facings: [{ file: 'a.webp' }, { atlas: 's', frame: [0, 0, 9, 9] }] },
        },
      },
    });
    expect(list.map((p) => [p.where, p.role, p.size])).toEqual([
      ['objects "table" isometric front', 'iso', [5, 3]],
      ['objects "table" isometric back', 'iso', [5, 3]],
    ]);
  });
});

describe('the set step, then atlas and budget, on isometric pictures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iso-set-'));
  const work = path.join(dir, 'work');
  const set = path.join(dir, 'set');
  let manifest;

  beforeAll(() => {
    // A table, long along the lower-left side, with a back; a barrel, the
    // same from both sides; a tapestry, hung on a wall; all bigger than the
    // budget lets them be.
    picture(path.join(work, 'iso/table.front.png'), 900, 600, [150, 100, 60]);
    picture(path.join(work, 'iso/table.back.png'), 900, 600, [120, 80, 40]);
    picture(path.join(work, 'iso/barrel.front.png'), 500, 600, [110, 70, 30]);
    picture(path.join(work, 'iso/tapestry.front.png'), 400, 500, [160, 40, 40]);
    fs.writeFileSync(
      path.join(work, 'iso/meta.json'),
      JSON.stringify({ table: { long: 'x' }, tapestry: { long: 'x' } })
    );
    fs.mkdirSync(set, { recursive: true });
    fs.writeFileSync(
      path.join(set, 'manifest.json'),
      JSON.stringify({ name: 'iso-test', title: 'Iso', objects: {}, materials: {} })
    );
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('writes each as WebP within the budget, with its foot and long axis', () => {
    const wrote = art('set', work, set);
    expect(wrote.iso).toBe(3);
    manifest = JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'));
    const { table, barrel, tapestry } = manifest.objects;
    // The front toward the lower left is w of w + d of the way across: 5 of 8.
    expect(table.iso.foot).toEqual([0.63, 1]);
    expect(table.iso.long).toBe('x');
    expect(table.iso.facings).toHaveLength(2);
    expect(table.iso.facings[0].file).not.toBe(table.iso.facings[1].file);
    // No back: the front stands for both. A square footprint is across the middle.
    expect(barrel.iso.foot).toEqual([0.5, 1]);
    expect(barrel.iso.long).toBeUndefined();
    expect(barrel.iso.facings[1]).toEqual(barrel.iso.facings[0]);
    // On a wall (4 × 1): its panel is 4 of the 5 across, its corner the right.
    expect(tapestry.iso.foot).toEqual([0.8, 1]);
    const sizeOf = (f) => budget.sizeOf(path.join(set, f));
    expect(sizeOf(table.iso.facings[0].file)).toMatchObject({ format: 'webp', width: 320 });
    expect(sizeOf(barrel.iso.facings[0].file).width).toBeLessThanOrEqual(
      budget.roleLimits('iso', { size: catalog.objectKind('barrel').size }).width
    );
    // 400 px wide, padded by a quarter: 500, then fitted to 5 × 40.
    const padded = sizeOf(tapestry.iso.facings[0].file);
    expect(padded.width).toBe(budget.roleLimits('iso', { size: [4, 1] }).width);
    expect(padded.width / padded.height).toBeCloseTo((400 * 1.25) / 500, 1);
  });

  test('atlas packs them, a picture that stands for both facings once', () => {
    const sheets = art('atlas', set);
    expect(sheets.length).toBeGreaterThan(0);
    manifest = JSON.parse(fs.readFileSync(path.join(set, 'manifest.json'), 'utf8'));
    const { table, barrel } = manifest.objects;
    table.iso.facings.forEach((f) => {
      expect(f.file).toBeUndefined();
      expect(f.atlas).toMatch(/^sheet-\d+$/);
      expect(f.frame).toHaveLength(4);
    });
    expect(barrel.iso.facings[1]).toEqual(barrel.iso.facings[0]);
    // 4 distinct pictures: the table's two, the barrel's one, the tapestry's one.
    const frames = new Set(
      ['table', 'barrel', 'tapestry'].flatMap((id) =>
        manifest.objects[id].iso.facings.map((f) => JSON.stringify(f.frame))
      )
    );
    expect(frames.size).toBe(4);
    expect(sheets.reduce((n, s) => n + s.frames, 0)).toBe(4);
    expect(fs.readdirSync(path.join(set, 'objects'))).toEqual([]);
    expect(catalog.checkManifest(manifest)).toEqual([]);
  });

  test('budget passes it, and fails a picture over its width', () => {
    expect(art('budget', set).problems).toEqual([]);
    // Pretend the table is bigger than 40 px a foot allows.
    manifest.objects.table.iso.facings[0].frame[2] = 400;
    fs.writeFileSync(path.join(set, 'manifest.json'), JSON.stringify(manifest));
    let problems = [];
    try {
      execFileSync('node', [ART, 'budget', set], { encoding: 'utf8' });
    } catch (err) {
      problems = JSON.parse(String(err.stdout)).problems;
    }
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/objects "table" isometric front/);
    expect(problems[0]).toMatch(/over its 320/);
  });
});
