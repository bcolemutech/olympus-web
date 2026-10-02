'use strict';

/**
 * The world map's pan-and-zoom maths (planning/the-loom-layered-worlds.md §7;
 * L-332 / #394): public/apps/loom/js/map-math.js, loaded as the browser loads
 * it but through module.exports. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-map-math --verbose
 */

const math = require('../public/apps/loom/js/map-math.js');

const MAP = { width: 1718, height: 1270 }; // Nisia's coordinate space
const PHONE = { width: 360, height: 480 };
const DESKTOP = { width: 800, height: 600 };
const close = (a, b) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

test('screen and map coordinates round-trip', () => {
  const view = { scale: 2.5, x: -1200, y: -800 };
  const s = math.toScreen(view, 922.31, 869.84);
  const back = math.toMap(view, s.x, s.y);
  close(back.x, 922.31);
  close(back.y, 869.84);
});

describe('clamp', () => {
  test('never zooms out past the whole map, nor in past the maximum', () => {
    expect(math.clamp({ scale: 0.01, x: 0, y: 0 }, DESKTOP, MAP).scale).toBeCloseTo(
      Math.min(800 / 1718, 600 / 1270)
    );
    expect(math.clamp({ scale: 99, x: 0, y: 0 }, DESKTOP, MAP).scale).toBe(math.MAX_SCALE);
  });

  test('keeps a zoomed-in map covering the panel', () => {
    const view = math.clamp({ scale: 2, x: 500, y: -99999 }, DESKTOP, MAP);
    expect(view.x).toBe(0); // no gap on the left
    expect(view.y).toBe(600 - 1270 * 2); // bottom edge meets the panel's
  });

  test('centres a map smaller than the panel', () => {
    const view = math.clamp({ scale: 0.1, x: 0, y: 0 }, DESKTOP, MAP);
    const scale = math.minScale(DESKTOP, MAP);
    close(view.y, (600 - 1270 * scale) / 2);
  });
});

describe('fit', () => {
  test('frames the discovered places around where the player stands', () => {
    const here = { x: 922.31, y: 869.84 };
    const places = [here, { x: 900, y: 850 }, { x: 940, y: 890 }];
    const view = math.fit(places, PHONE, MAP, here);
    const s = math.toScreen(view, here.x, here.y);
    close(s.x, PHONE.width / 2);
    close(s.y, PHONE.height / 2);
    // A tight cluster still shows a sensible stretch of land, not one pixel.
    expect(view.scale).toBeLessThan(math.MAX_SCALE);
    for (const p of places) {
      const q = math.toScreen(view, p.x, p.y);
      expect(q.x).toBeGreaterThan(0);
      expect(q.x).toBeLessThan(PHONE.width);
    }
  });

  test('without a focus, centres the places; with none, the map', () => {
    const view = math.fit(
      [
        { x: 100, y: 100 },
        { x: 500, y: 300 },
      ],
      DESKTOP,
      MAP
    );
    const centre = math.toMap(view, DESKTOP.width / 2, DESKTOP.height / 2);
    expect(centre.x).toBeGreaterThan(100);
    expect(centre.x).toBeLessThan(500);
    expect(math.fit([], DESKTOP, MAP).scale).toBeGreaterThan(0);
  });
});

describe('zoom and pan', () => {
  test('zooming keeps the point under the cursor or fingers in place', () => {
    const view = { scale: 1, x: -200, y: -150 };
    const before = math.toMap(view, 300, 200);
    const zoomed = math.zoomAt(view, 2, 300, 200, DESKTOP, MAP);
    expect(zoomed.scale).toBe(2);
    const after = math.toMap(zoomed, 300, 200);
    close(after.x, before.x);
    close(after.y, before.y);
  });

  test('a pinch keeps the map point under the fingers there, worked out from its start', () => {
    const start = { scale: 2, x: -1200, y: -900 };
    const at = { mid: { x: 180, y: 240 }, distance: 200 };
    const under = math.toMap(start, 180, 240);
    // Fingers closing to half their spread: half the scale, same point under them.
    const out = math.pinch(start, at, { mid: { x: 180, y: 240 }, distance: 100 }, PHONE, MAP);
    close(out.scale, 1);
    const still = math.toMap(out, 180, 240);
    close(still.x, under.x);
    close(still.y, under.y);
    // Moving both fingers together pans: the same point follows the midpoint.
    const moved = math.pinch(start, at, { mid: { x: 200, y: 260 }, distance: 100 }, PHONE, MAP);
    const followed = math.toMap(moved, 200, 260);
    close(followed.x, under.x);
    close(followed.y, under.y);
  });

  test('a long pinch out lands where one big step would: nothing builds up', () => {
    const start = { scale: 2.8, x: -300, y: -1500 };
    const at = { mid: { x: 180, y: 300 }, distance: 300 };
    // Many small steps, each worked out from the start, as the fingers close.
    let view = start;
    for (let d = 299; d >= 150; d--) {
      view = math.pinch(start, at, { mid: { x: 180, y: 300 }, distance: d }, PHONE, MAP);
    }
    expect(view).toEqual(
      math.pinch(start, at, { mid: { x: 180, y: 300 }, distance: 150 }, PHONE, MAP)
    );
    // Pinching out past the whole map stops at the whole map, centred.
    const all = math.pinch(start, at, { mid: { x: 180, y: 300 }, distance: 1 }, PHONE, MAP);
    expect(all).toEqual(math.clamp({ scale: 0, x: 0, y: 0 }, PHONE, MAP));
  });

  test('a pinch with no spread changes nothing', () => {
    const start = { scale: 2, x: -1200, y: -900 };
    expect(
      math.pinch(
        start,
        { mid: { x: 0, y: 0 }, distance: 0 },
        { mid: { x: 9, y: 9 }, distance: 50 },
        PHONE,
        MAP
      )
    ).toEqual(math.clamp(start, PHONE, MAP));
  });

  describe('at the zoom limits, zooming further leaves the map where it is (#420)', () => {
    // At the maximum, a zoom-in used to place the map for the scale asked for
    // (6 × 1.5 = 9) and then limit the scale to 6, which moved it ~1,800 px
    // toward the bottom-right on every press of +.
    const AT_MAX = { scale: math.MAX_SCALE, x: -1032.81, y: -5210.35 };
    const PANEL = { width: 661.78, height: 544.69 }; // the iPad's, from the readout

    test('the + button, or the wheel, at the maximum changes nothing', () => {
      const pressed = math.zoomAt(AT_MAX, 1.5, PANEL.width / 2, PANEL.height / 2, PANEL, MAP);
      expect(pressed).toEqual(math.clamp(AT_MAX, PANEL, MAP));
      const wheeled = math.zoomAt(AT_MAX, Math.exp(0.15), 120, 400, PANEL, MAP);
      expect(wheeled).toEqual(math.clamp(AT_MAX, PANEL, MAP));
    });

    test('zooming in to the maximum keeps the point under the cursor', () => {
      const near = { scale: 5.94, x: -578.24, y: -3382.79 };
      const under = math.toMap(near, 331, 272);
      const zoomed = math.zoomAt(near, 1.5, 331, 272, PANEL, MAP);
      expect(zoomed.scale).toBe(math.MAX_SCALE);
      const still = math.toMap(zoomed, 331, 272);
      close(still.x, under.x);
      close(still.y, under.y);
    });

    test('spreading the fingers past the maximum keeps the point under them', () => {
      const at = { mid: { x: 200, y: 260 }, distance: 100 };
      const under = math.toMap(AT_MAX, 200, 260);
      const out = math.pinch(AT_MAX, at, { mid: { x: 200, y: 260 }, distance: 300 }, PANEL, MAP);
      expect(out.scale).toBe(math.MAX_SCALE);
      const still = math.toMap(out, 200, 260);
      close(still.x, under.x);
      close(still.y, under.y);
    });

    test('zooming out at the whole map changes nothing', () => {
      const all = math.clamp({ scale: 0, x: 0, y: 0 }, PANEL, MAP);
      expect(math.zoomAt(all, 1 / 1.5, 50, 50, PANEL, MAP)).toEqual(all);
    });
  });

  test('panning moves the view, within the map', () => {
    const view = { scale: 2, x: -1000, y: -800 };
    expect(math.pan(view, 50, -30, DESKTOP, MAP)).toEqual({ scale: 2, x: -950, y: -830 });
    expect(math.pan(view, 5000, 0, DESKTOP, MAP).x).toBe(0);
  });

  test('reveal brings an off-screen place into view, and leaves a visible one alone', () => {
    const view = { scale: 2, x: -1000, y: -800 };
    const visible = math.toMap(view, 400, 300);
    expect(math.reveal(view, visible, DESKTOP, MAP)).toEqual(view);
    const offscreen = math.toMap(view, 900, 300);
    const moved = math.reveal(view, offscreen, DESKTOP, MAP);
    expect(math.toScreen(moved, offscreen.x, offscreen.y).x).toBeCloseTo(DESKTOP.width - 40);
  });
});
