'use strict';

/**
 * The Muse's schematics as plain data (planning/the-muse.md §3 SC1–SC9, D7;
 * M-202 / #915): checks and plans in ./schematics.js, run on both the page's
 * copy and the server's (they must agree), and the picture Claude is shown
 * with its grid and numbered pins (D10).
 */

const page = require('../public/apps/muse/js/schematics.js');
const server = require('../functions/muse/schematics.js');
const { viewSchematic, overlay, numberPath } = require('../functions/muse/schematic-view');

describe.each([
  ['the page’s copy', page],
  ['the server’s copy', server],
])('%s', (_, S) => {
  const live = { el_hall: 'location', el_chest: 'object' };
  const options = { elementType: (id) => live[id] || null };
  const made = (extra = {}) =>
    S.read('sc_a', {
      element: 'el_keep',
      name: 'Ground floor',
      order: 0,
      image: 'img_plan',
      points: [],
      links: [],
      ...extra,
    });

  describe('making one', () => {
    test('only a location or an object has schematics, each named and with a picture', () => {
      const input = { element: 'el_keep', name: ' Ground   floor ', image: 'img_plan' };
      const plan = S.planCreate('p1', 'sc_a', input, { elementType: 'location', siblings: [] });
      expect(plan.value).toHaveLength(1);
      expect(plan.value[0]).toMatchObject({
        op: 'set',
        path: 'muse_projects/p1/schematics/sc_a',
        data: {
          element: 'el_keep',
          name: 'Ground floor',
          order: 0,
          image: 'img_plan',
          points: [],
          links: [],
        },
      });
      expect(S.planCreate('p1', 'x', input, { elementType: 'object' }).value).toBeDefined();
      for (const type of ['character', 'faction', 'concept', undefined]) {
        expect(S.planCreate('p1', 'x', input, { elementType: type }).error).toMatch(
          /locations and objects/
        );
      }
      expect(
        S.planCreate('p1', 'x', { ...input, name: ' ' }, { elementType: 'location' }).error
      ).toMatch(/needs a name/);
      expect(
        S.planCreate('p1', 'x', { ...input, image: '' }, { elementType: 'location' }).error
      ).toMatch(/needs a picture/);
      expect(
        S.planCreate('p1', 'x', { ...input, element: '' }, { elementType: 'location' }).error
      ).toMatch(/belongs to an element/);
    });

    test('it goes after those its element has, and an element has at most 30 (SC4)', () => {
      const input = { element: 'el_keep', name: 'Cellars', image: 'img_plan' };
      const sibling = (order) => made({ order });
      const plan = S.planCreate('p1', 'sc_b', input, {
        elementType: 'location',
        siblings: [sibling(0), sibling(4)],
      });
      expect(plan.value[0].data.order).toBe(5);
      const full = Array.from({ length: 30 }, (_, i) => sibling(i));
      expect(
        S.planCreate('p1', 'sc_c', input, { elementType: 'location', siblings: full }).error
      ).toMatch(/at most 30/);
    });
  });

  describe('points', () => {
    test('a point is a name, a place within the picture, a description and a link', () => {
      const ok = S.checkPoint(
        { name: ' Hall  door ', x: '0.25', y: 0.5, link: 'el_hall' },
        null,
        options
      );
      expect(ok.value).toEqual({
        name: 'Hall door',
        description: '',
        x: 0.25,
        y: 0.5,
        link: 'el_hall',
      });
      expect(S.checkPoint({ name: 'A', x: 0.123456, y: 1 }).value).toMatchObject({
        x: 0.1235,
        y: 1,
      });
      for (const bad of [-0.01, 1.01, NaN, Infinity, null, undefined, '', 'left']) {
        expect(S.checkPoint({ name: 'A', x: bad, y: 0 }).error).toMatch(/fraction of the picture/);
        expect(S.checkPoint({ name: 'A', x: 0, y: bad }).error).toMatch(/fraction of the picture/);
      }
      expect(S.checkPoint({ name: '', x: 0, y: 0 }).error).toMatch(/needs a name/);
      expect(S.checkPoint({ name: 'x'.repeat(101), x: 0, y: 0 }).error).toMatch(/at most 100/);
      expect(S.checkPoint({ name: 'A', x: 0, y: 0, description: 'x'.repeat(5001) }).error).toMatch(
        /at most 5000/
      );
    });

    test('a link is to an element of the project: any type (SC5), and a retired one already linked stays', () => {
      expect(
        S.checkPoint({ name: 'A', x: 0, y: 0, link: 'el_chest' }, null, options).value.link
      ).toBe('el_chest');
      expect(S.checkPoint({ name: 'A', x: 0, y: 0, link: 'el_gone' }, null, options).error).toMatch(
        /element of this project/
      );
      expect(S.checkPoint({ name: 'A', x: 0, y: 0, link: 'bad id!' }, null, options).error).toMatch(
        /element’s id/
      );
      const current = { name: 'A', description: '', x: 0, y: 0, link: 'el_gone' };
      expect(S.checkPoint({ x: 0.5 }, current, options).value.link).toBe('el_gone');
      expect(S.checkPoint({ link: null }, current, options).value.link).toBeNull();
    });

    test('added at the end, numbered by place; ids are not reused while others stand', () => {
      let sc = made();
      let plan = S.planAddPoint('p1', sc, { name: 'Door', x: 0.1, y: 0.2 }, options);
      expect(plan).toMatchObject({ id: 'p1', number: 1 });
      sc = made({ points: plan.value[0].data.points, links: plan.value[0].data.links });
      plan = S.planAddPoint('p1', sc, { name: 'Stair', x: 0.3, y: 0.4, link: 'el_hall' }, options);
      expect(plan).toMatchObject({ id: 'p2', number: 2 });
      expect(plan.value[0].data.links).toEqual(['el_hall']);
      sc = made({ points: plan.value[0].data.points, links: plan.value[0].data.links });
      // Taking the first off renumbers; the next id still clears the highest.
      const without = S.planRemovePoint('p1', sc, 'p1');
      sc = made({ points: without.value[0].data.points, links: without.value[0].data.links });
      expect(sc.points.map((p) => p.id)).toEqual(['p2']);
      expect(S.newPointId(sc.points)).toBe('p3');
    });

    test('changed by id; a move keeps the rest; the links follow', () => {
      const sc = made({
        points: [
          { id: 'p1', name: 'Door', description: '', x: 0.1, y: 0.1, link: 'el_hall' },
          { id: 'p2', name: 'Stair', description: '', x: 0.5, y: 0.5, link: null },
        ],
        links: ['el_hall'],
      });
      const moved = S.planChangePoint('p1', sc, 'p2', { x: 0.9, y: 0.8 }, options);
      expect(moved.value[0].data.points[1]).toMatchObject({ name: 'Stair', x: 0.9, y: 0.8 });
      expect(moved.value[0].data.points[0]).toEqual(sc.points[0]);
      const relinked = S.planChangePoint('p1', sc, 'p1', { link: 'el_chest' }, options);
      expect(relinked.value[0].data.links).toEqual(['el_chest']);
      const unlinked = S.planChangePoint('p1', sc, 'p1', { link: null }, options);
      expect(unlinked.value[0].data.links).toEqual([]);
      expect(S.planChangePoint('p1', sc, 'p9', { x: 0 }, options).error).toMatch(/no longer there/);
      expect(S.planRemovePoint('p1', sc, 'p9').error).toMatch(/no longer there/);
      expect(S.planChangePoint('p1', sc, 'p1', { x: 2 }, options).error).toMatch(/fraction/);
    });

    test('at most 200 points', () => {
      const points = Array.from({ length: 200 }, (_, i) => ({
        id: `p${i + 1}`,
        name: `P${i + 1}`,
        description: '',
        x: 0.5,
        y: 0.5,
        link: null,
      }));
      const full = made({ points });
      expect(S.planAddPoint('p1', full, { name: 'More', x: 0, y: 0 }).error).toMatch(/at most 200/);
      expect(S.planUpdate('p1', made(), { points: points.concat(points[0]) }).error).toMatch(
        /at most 200/
      );
    });

    test('a point is named by its id, a name only it has, or its number', () => {
      const points = [
        { id: 'p1', name: 'Door', x: 0, y: 0 },
        { id: 'p2', name: 'Stair', x: 0, y: 0 },
        { id: 'p3', name: 'door', x: 0, y: 0 },
      ];
      expect(S.findPoint(points, 'p2')).toMatchObject({ number: 2 });
      expect(S.findPoint(points, 'Stair').value.id).toBe('p2');
      expect(S.findPoint(points, '#2').value.id).toBe('p2');
      expect(S.findPoint(points, '3').value.id).toBe('p3');
      expect(S.findPoint(points, 'Door').error).toMatch(/names 2 points/);
      expect(S.findPoint(points, '9').error).toMatch(/No point/);
      expect(S.findPoint(points, '').error).toMatch(/Name a point/);
    });
  });

  describe('changing one', () => {
    test('renamed and given another picture; the points stay', () => {
      const sc = made({ points: [{ id: 'p1', name: 'A', x: 0.1, y: 0.1 }] });
      const plan = S.planUpdate('p1', sc, { name: ' Upper ', image: 'img_new' });
      expect(plan.value[0]).toMatchObject({
        op: 'update',
        path: 'muse_projects/p1/schematics/sc_a',
        data: { name: 'Upper', image: 'img_new' },
      });
      expect(plan.value[0].data.points).toBeUndefined();
      expect(S.planUpdate('p1', sc, { name: '' }).error).toMatch(/needs a name/);
      expect(S.planUpdate('p1', sc, { image: '' }).error).toMatch(/needs a picture/);
    });

    test('ordered: moved earlier or later, or put at a place, mending ties and gaps (SC4)', () => {
      const three = [
        made({ order: 0 }),
        { ...made({ order: 1 }), id: 'sc_b' },
        { ...made({ order: 2 }), id: 'sc_c' },
      ];
      const orders = (plan) =>
        Object.fromEntries(plan.value.map((w) => [w.path.split('/').pop(), w.data.order]));
      expect(orders(S.planMove('p1', three, 'sc_c', -1))).toEqual({ sc_c: 1, sc_b: 2 });
      expect(orders(S.planMove('p1', three, 'sc_a', 1))).toEqual({ sc_b: 0, sc_a: 1 });
      expect(S.planMove('p1', three, 'sc_a', -1).value).toEqual([]);
      expect(S.planMove('p1', three, 'sc_c', 1).value).toEqual([]);
      expect(orders(S.planPlace('p1', three, 'sc_c', 1))).toEqual({ sc_c: 0, sc_a: 1, sc_b: 2 });
      expect(orders(S.planPlace('p1', three, 'sc_a', 99))).toEqual({ sc_b: 0, sc_c: 1, sc_a: 2 });
      const gappy = [
        made({ order: 0 }),
        { ...made({ order: 7 }), id: 'sc_b' },
        { ...made({ order: 7 }), id: 'sc_c' },
      ];
      expect(orders(S.planPlace('p1', gappy, 'sc_c', 2))).toEqual({ sc_b: 2, sc_c: 1 });
      expect(S.planMove('p1', three, 'sc_z', 1).error).toMatch(/no longer there/);
    });

    test('deleted', () => {
      expect(S.planDelete('p1', 'sc_a').value).toEqual([
        { op: 'delete', path: 'muse_projects/p1/schematics/sc_a', data: {} },
      ]);
    });
  });

  test('where an element is marked: each schematic with its points linking to it, by name (SC9)', () => {
    const keep = (name, order, points) => ({
      ...made({ order, name, points }),
      id: `sc_${name}`,
    });
    const p = (id, link) => ({ id, name: `Point ${id}`, x: 0, y: 0, link });
    const list = [
      keep('Upper', 1, [p('p1', 'el_hall'), p('p2', null), p('p3', 'el_hall')]),
      keep('Cellars', 0, [p('p1', 'el_chest')]),
      keep('Ground', 2, [p('p1', 'el_hall')]),
    ];
    const found = S.markedOn(list, 'el_hall');
    expect(found.map((m) => m.schematic.name)).toEqual(['Ground', 'Upper']);
    expect(found[1].points).toEqual([
      { id: 'p1', number: 1, name: 'Point p1' },
      { id: 'p3', number: 3, name: 'Point p3' },
    ]);
    expect(S.markedOn(list, 'el_nowhere')).toEqual([]);
  });
});

describe('the picture Claude is shown (D10)', () => {
  test('numbers are drawn as strokes, with no font', () => {
    expect(numberPath('8', 10, 10, 10)).toMatch(/^M/);
    expect(numberPath('10', 10, 10, 10).split('M').length).toBeGreaterThan(
      numberPath('1', 10, 10, 10).split('M').length
    );
    const svg = overlay(800, 500, [
      { x: 0.5, y: 0.25 },
      { x: 1, y: 1 },
    ]);
    expect(svg).not.toMatch(/<text/);
    expect(svg.match(/<circle/g)).toHaveLength(2);
    expect(overlay(800, 500, [], { grid: false })).not.toMatch(/<path/);
  });

  test('the picture is scaled to 1568 px, gridded, and the pins are where the points are', async () => {
    const sharp = require('../functions/node_modules/sharp');
    const size = { width: 2000, height: 1000 };
    const plain = await sharp({ create: { ...size, channels: 3, background: '#223344' } })
      .png()
      .toBuffer();
    const seen = await viewSchematic(plain, [{ x: 0.5, y: 0.5 }]);
    expect(seen).toMatchObject({ mimeType: 'image/jpeg', width: 1568, height: 784 });
    const { data, info } = await sharp(seen.data).raw().toBuffer({ resolveWithObject: true });
    const at = (fx, fy) => {
      const i =
        (Math.round(fy * (info.height - 1)) * info.width + Math.round(fx * (info.width - 1))) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    // The pin's amber at its point; the plain blue away from pins and grid lines.
    const [r, g, b] = at(0.5, 0.5);
    expect(r).toBeGreaterThan(200);
    expect(b).toBeLessThan(120);
    expect(at(0.55, 0.55)[2]).toBeGreaterThan(40);
    const bare = await viewSchematic(plain, [], { grid: false });
    const flat = await sharp(bare.data).raw().toBuffer({ resolveWithObject: true });
    expect(flat.data[0]).toBeLessThan(60);
  });

  test('a small SVG picture is shown too, and an oversized one is refused', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#fff"/></svg>'
    );
    const seen = await viewSchematic(svg, [{ x: 0.1, y: 0.9 }]);
    expect(seen.width).toBeGreaterThanOrEqual(200);
    expect(seen.width / seen.height).toBeCloseTo(2, 1);
    const sharp = require('../functions/node_modules/sharp');
    const big = await sharp({
      create: { width: 100, height: 100, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    await expect(viewSchematic(big, [], { maxPixels: 9999 })).rejects.toMatchObject({
      tooLarge: true,
    });
    await expect(viewSchematic(big, [], { maxPixels: 10000 })).resolves.toMatchObject({
      width: 100,
    });
  });
});
