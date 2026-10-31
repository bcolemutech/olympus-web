'use strict';

const path = require('path');
const { Worker } = require('worker_threads');
const { setTimeout, clearTimeout } = require('timers');
const { normaliseColours } = require('../../../cartographer/svg');

// SVG art drawn for view_image away from the request (#744): in a worker
// thread, with a time limit. A drawing that takes too long, or that brings
// down the renderer, ends the worker, not the request, which answers with a
// clear error instead of failing with a 502 when Hosting gives up on it.
// Colours with alpha in hex are written as rgba() first, for art stored
// before set_art did so.

const TIME_LIMIT_MS = 30000;

class RasterError extends Error {}

// The worker: draws the SVG with resvg, its long side `maxSide`.
const SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { Resvg } = require(workerData.resvg);
const probe = new Resvg(workerData.svg);
const long = Math.max(probe.width, probe.height) || 1;
const side = (n) => Math.max(1, Math.round((n / long) * workerData.maxSide));
const png = new Resvg(workerData.svg, {
  fitTo:
    probe.width >= probe.height
      ? { mode: 'width', value: side(probe.width) }
      : { mode: 'height', value: side(probe.height) },
}).render().asPng();
parentPort.postMessage(Uint8Array.from(png));
`;

/**
 * An SVG's text drawn as PNG bytes, its long side `maxSide`: a Promise of a
 * Buffer, or a RasterError saying why it couldn't be drawn.
 */
function rasterSvg(svg, { maxSide, timeLimitMs = TIME_LIMIT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(SOURCE, {
      eval: true,
      workerData: {
        svg: normaliseColours(String(svg)),
        maxSide,
        resvg: require.resolve('@resvg/resvg-js', { paths: [path.resolve(__dirname, '../../..')] }),
      },
    });
    let done = false;
    const finish = (fn, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      fn(value);
    };
    const timer = setTimeout(
      () =>
        finish(
          reject,
          new RasterError(
            `the SVG took more than ${Math.round(timeLimitMs / 1000)} s to draw: simplify it ` +
              '(fewer shapes, smaller or fewer filters)'
          )
        ),
      timeLimitMs
    );
    worker.once('message', (png) => finish(resolve, Buffer.from(png)));
    worker.once('error', (err) =>
      finish(reject, new RasterError(`the SVG could not be drawn (${(err && err.message) || err})`))
    );
    worker.once('exit', (code) => {
      if (code !== 0) {
        finish(
          reject,
          new RasterError(`the SVG could not be drawn (the renderer stopped: ${code})`)
        );
      }
    });
  });
}

module.exports = { rasterSvg, RasterError, TIME_LIMIT_MS };
