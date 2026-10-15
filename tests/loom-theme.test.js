'use strict';

/**
 * The Loom's world accent (planning/the-map-first-loom.md §4.5, K1; L-729 /
 * #600): public/apps/loom/js/theme.js, loaded as the browser loads it but
 * through module.exports. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-theme --verbose
 */

const theme = require('../public/apps/loom/js/theme.js');

const PANEL = '#0f1525';

test('contrast follows WCAG: white on black is 21:1, a colour on itself 1:1', () => {
  expect(theme.contrast('#ffffff', '#000000')).toBeCloseTo(21, 5);
  expect(theme.contrast('#ffb74d', '#ffb74d')).toBeCloseTo(1, 5);
});

test('no accent, or one that is not a colour, is the Loom’s own', () => {
  [undefined, null, '', 'gold', '#12345', 'rgb(1,2,3)'].forEach((value) => {
    expect(theme.accentOf(value)).toBe(theme.DEFAULT_ACCENT);
  });
});

test('a light accent is kept as it is', () => {
  expect(theme.accentOf('#ffb74d')).toBe('#ffb74d');
  expect(theme.accentOf('#ABC')).toBe('#aabbcc');
});

test('a dark accent is lightened until its text reads on the panels, with room to spare', () => {
  ['#2e4f8a', '#000000', '#5a1010', '#0f1525', '#123'].forEach((dark) => {
    const accent = theme.accentOf(dark);
    expect(accent).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.contrast(accent, PANEL)).toBeGreaterThanOrEqual(6);
    // And dark text on it (its buttons) meets AA as well.
    expect(theme.contrast(accent, '#0a0e1a')).toBeGreaterThanOrEqual(4.5);
  });
});

test('lightening keeps the hue: a dark blue stays blue', () => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(theme.accentOf('#2e4f8a').slice(i, i + 2), 16));
  expect(b).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(r);
});
