'use strict';

/**
 * SVG art's safety check (functions/cartographer/svg.js;
 * planning/the-loom-layered-worlds.md §9; L-356 / #431): plain drawing passes,
 * with its size from the viewBox; anything that could run or reach outside the
 * SVG is refused. Pure; no emulator.
 *
 * Run: cd tests && npx jest cartographer-svg --verbose
 */

const { checkSvg, isSvg, MAX_SVG_BYTES } = require('../functions/cartographer/svg');

const wrap = (inner, attrs = 'viewBox="0 0 12 8"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${inner}</svg>`;

describe('what passes', () => {
  test('plain drawing, with its size from the viewBox', () => {
    const svg = wrap(
      '<defs><linearGradient id="wood"><stop offset="0" stop-color="#753"/></linearGradient>' +
        '<g id="stool"><circle r="0.3"/></g></defs>' +
        '<rect width="12" height="8" fill="url(#wood)"/>' +
        '<path d="M3 2h1v1h-1z" fill="#421" stroke="#000" stroke-width="0.05"/>' +
        '<use href="#stool" x="5" y="3"/><use xlink:href="#stool" x="6" y="3"/>' +
        '<text x="3" y="2.5" font-size="0.4">Bar</text>' +
        '<style>.floor { fill: url( #wood ); }</style>'
    );
    expect(checkSvg(svg)).toEqual({ svg, width: 12, height: 8 });
  });

  test('a town, sized by width and height; an XML declaration and comments first', () => {
    const svg = `<?xml version="1.0"?>\n<!-- Hatham -->\n${wrap('<rect width="1000" height="1000"/>', 'width="1000px" height="1000"')}`;
    expect(checkSvg(svg)).toMatchObject({ width: 1000, height: 1000 });
  });

  test('isSvg tells SVG bytes from PNG bytes', () => {
    expect(isSvg(Buffer.from('  <svg></svg>'))).toBe(true);
    expect(isSvg(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
  });
});

describe('what is refused', () => {
  test.each([
    ['a script', wrap('<script>alert(1)</script>'), /a script/],
    ['an event handler', wrap('<rect onclick="x()" width="1" height="1"/>'), /an event handler/],
    [
      'an event handler on the root',
      '<svg onload="x()" viewBox="0 0 1 1"></svg>',
      /an event handler/,
    ],
    ['a foreignObject', wrap('<foreignObject><div/></foreignObject>'), /a foreignObject/],
    ['an embedded image', wrap('<image href="data:image/png;base64,AAAA"/>'), /an embedded image/],
    [
      'an external link',
      wrap('<a href="https://example.com"><rect/></a>'),
      /a link outside the SVG/,
    ],
    [
      'an external xlink',
      wrap('<use xlink:href="https://example.com/x.svg#a"/>'),
      /a link outside/,
    ],
    ['an external url()', wrap('<rect fill="url(https://example.com/x)"/>'), /a reference outside/],
    ['a data url()', wrap('<rect style="fill: url(\'data:x\')"/>'), /a reference outside/],
    ['a javascript: link', wrap('<a href="#x"><set to="javascript:x"/></a>'), /a javascript: link/],
    ['a CSS @import', wrap('<style>@import "x.css";</style>'), /a CSS @import/],
    ['a DOCTYPE before the SVG', `<!DOCTYPE svg [<!ENTITY x "y">]>${wrap('')}`, /not an SVG/],
    ['a DOCTYPE inside it', wrap('<!DOCTYPE x>'), /a DOCTYPE/],
    ['an entity', wrap('<!ENTITY x "y">'), /an entity/],
    ['something that is not an SVG', '<html><body/></html>', /not an SVG/],
    ['an SVG with something after it', `${wrap('')}<script/>`, /not an SVG/],
    ['an SVG with no size', '<svg xmlns="http://www.w3.org/2000/svg"></svg>', /needs a viewBox/],
  ])('%s', (_label, svg, message) => {
    expect(() => checkSvg(svg)).toThrow(message);
  });

  test('more than 1 MB', () => {
    const big = wrap(`<!--${'x'.repeat(MAX_SVG_BYTES)}-->`);
    expect(() => checkSvg(big)).toThrow(/larger than 1024 KB/);
  });

  test('anything but text', () => {
    expect(() => checkSvg(null)).toThrow(/must be SVG text/);
  });
});
