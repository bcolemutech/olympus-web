#!/usr/bin/env node
/**
 * The game art pipeline (planning/art-spike.md §5.3), run by hand from the
 * repo root, one step at a time so each step's output can be looked at:
 *
 *   node scripts/art/art.js fetch <link> <out.png>
 *   node scripts/art/art.js slice <sheet.png> <outDir> [name,name,…]
 *   node scripts/art/art.js key <in.png> <out.png>
 *   node scripts/art/art.js seamless <in.png> <out.png>
 *   node scripts/art/art.js fit <in.png> <out.png> tile|strip|object [wFeet,dFeet | span]
 *   node scripts/art/art.js check <file.png> tile|strip|object
 *
 * For an art set (planning/game-art.md §4.3; L-944), under
 * public/apps/loom/art/sets/<set>/:
 *
 *   node scripts/art/art.js webp <in.png> <out.webp> ground|strip|face|object [span | wFeet,dFeet]
 *   node scripts/art/art.js atlas <setDir> [--keep]
 *   node scripts/art/art.js budget <setDir>
 *
 * Images come from the studio's library (studio_generate, studio_get): fetch
 * takes an image's link. Nothing here spends money.
 */

import {
  fetchImage,
  slice,
  key,
  seamless,
  fit,
  sizeFor,
  check,
  webp,
  atlas,
  checkBudget,
} from './steps.js';

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  fetch: ([url, out]) => fetchImage(url, out),
  slice: ([file, outDir, names]) => slice(file, outDir, names ? names.split(',') : []),
  key: ([file, out]) => key(file, out),
  seamless: ([file, out]) => seamless(file, out),
  fit: ([file, out, kind, extra]) =>
    fit(
      file,
      out,
      kind === 'object'
        ? sizeFor(kind, extra ? extra.split(',').map(Number) : [1, 1])
        : sizeFor(kind, null, extra ? Number(extra) : 1),
      { contain: kind === 'object' }
    ),
  check: ([file, kind]) => check(file, kind),
  webp: ([file, out, role, extra]) =>
    webp(
      file,
      out,
      role,
      role === 'object'
        ? { size: extra ? extra.split(',').map(Number) : [5, 5] }
        : { span: extra ? Number(extra) : 1 }
    ),
  atlas: ([dir, flag]) => atlas(dir, { keep: flag === '--keep' }),
  budget: ([dir]) =>
    checkBudget(dir).then((result) => {
      if (result.problems.length) process.exitCode = 1;
      return result;
    }),
};

if (!commands[cmd]) {
  console.error(`Usage: node scripts/art/art.js ${Object.keys(commands).join('|')} …`);
  process.exit(1);
}

commands[cmd](args)
  .then((result) => console.log(JSON.stringify(result, null, 2)))
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
