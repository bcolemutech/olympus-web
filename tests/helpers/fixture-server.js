'use strict';

/**
 * A static server for the headless Chrome tests (tests/loom-paint.test.js,
 * tests/loom-objects-menu.test.js): the app's `public/` directory, the tests'
 * `fixtures/`, and the libraries the page loads from a CDN, served from the
 * tests' own copy at the same version (PixiJS, Preact, htm).
 *
 *   const { server, origin } = await serveFixtures({ artDelay: () => ms });
 *
 * `artDelay` (optional): milliseconds the art files are held back, for the
 * progress effect.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const TESTS = path.join(__dirname, '..');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.json': 'application/json',
};
const LIBRARIES = {
  '/pixi.min.js': 'node_modules/pixi.js/dist/pixi.min.js',
  '/preact.umd.js': 'node_modules/preact/dist/preact.umd.js',
  '/htm.umd.js': 'node_modules/htm/dist/htm.umd.js',
};

async function serveFixtures({ artDelay = () => 0 } = {}) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    const file = LIBRARIES[url]
      ? path.join(TESTS, LIBRARIES[url])
      : url.startsWith('/fixtures/')
        ? path.join(TESTS, url)
        : path.join(ROOT, 'public', url);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      res.end();
      return;
    }
    const send = () => {
      res.writeHead(200, {
        'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      });
      res.end(fs.readFileSync(file));
    };
    const delay = artDelay();
    if (delay && url.startsWith('/apps/loom/art/')) setTimeout(send, delay);
    else send();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

module.exports = { serveFixtures };
