#!/usr/bin/env node

/**
 * A world's layer from its Azgaar save (planning/worlds-without-azgaar.md
 * §4.7, AZ5; L-717 / #822): reads an Azgaar full JSON export and writes the
 * top region map's terrain, rivers and provinces as geometry, with the MCP
 * calls that write it, and prints the dry-run report (./layer.cjs). It writes
 * nothing to the world: Claude checks the result, then sends the calls.
 *
 * The save never goes in the repo: keep it in the gitignored maps/ folder or
 * a scratch directory.
 *
 * Usage:
 *   node scripts/azgaar/convert.js <save.json> [options]
 *
 *   --world <file>      get_world's answer (or the world's factions and
 *                       regions) to match realms and regions against;
 *                       without it the import's ids (fac_<i>, reg_<i>) are
 *                       assumed
 *   --world-id <id>     the worldId in the calls (default <worldId>)
 *   --map-id <id>       the region map (default map_world)
 *   --out <file>        the whole result as JSON
 *   --calls <dir>       each call as its own file, 01-add_realms.json…
 *   --preview <file>    an SVG of the result, realms over the terrain
 *   --overlay <name>    realms (default) or regions, for the preview
 *   --tolerance <n>     how far a simplified border may stray, in map units
 *                       (default 1; grown until it fits)
 *   --budget <n>        points the map may hold (default 18000)
 *   --no-relief         biomes only, no hills and mountains from height
 *
 * Exit codes:
 *   0 - converted, and the geometry passes map-geometry.js's check
 *   1 - bad arguments, or the file isn't a full JSON export
 *   2 - converted, but the geometry fails the check (the report says why)
 */

import { createRequire } from 'module';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const require = createRequire(import.meta.url);
const layer = require('./layer.cjs');

const USAGE =
  'Usage: node scripts/azgaar/convert.js <save.json> [--world f] [--world-id id] ' +
  '[--map-id id] [--out f] [--calls dir] [--preview f.svg] [--overlay realms|regions] ' +
  '[--tolerance n] [--budget n] [--no-relief]';

function parseArgs(argv) {
  const args = { relief: true };
  const takes = {
    '--world': 'world',
    '--world-id': 'worldId',
    '--map-id': 'mapId',
    '--out': 'out',
    '--calls': 'calls',
    '--preview': 'preview',
    '--overlay': 'overlay',
    '--tolerance': 'tolerance',
    '--budget': 'budget',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-relief') args.relief = false;
    else if (takes[a]) {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value.`);
      args[takes[a]] = argv[++i];
    } else if (a.startsWith('--')) throw new Error(`Unknown option ${a}.`);
    else if (!args.save) args.save = a;
    else throw new Error(`One save at a time (${a}).`);
  }
  if (!args.save) throw new Error('Give the save file.');
  for (const key of ['tolerance', 'budget']) {
    if (args[key] !== undefined) {
      const n = Number(args[key]);
      if (!(n > 0)) throw new Error(`--${key} must be a number above 0.`);
      args[key] = n;
    }
  }
  if (args.overlay && !['realms', 'regions'].includes(args.overlay)) {
    throw new Error('--overlay is realms or regions.');
  }
  return args;
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(1);
  }
  let save;
  try {
    save = layer.readSave(readFileSync(args.save));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const world = args.world ? JSON.parse(readFileSync(args.world, 'utf8')) : undefined;
  const options = { relief: args.relief, world };
  for (const key of ['worldId', 'mapId', 'tolerance', 'budget']) {
    if (args[key] !== undefined) options[key] = args[key];
  }
  const result = layer.convert(save, options);

  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 1));
  if (args.calls) {
    mkdirSync(args.calls, { recursive: true });
    result.calls.forEach((call, i) => {
      const name = `${String(i + 1).padStart(2, '0')}-${call.tool}.json`;
      writeFileSync(join(args.calls, name), JSON.stringify(call, null, 1));
    });
  }
  if (args.preview) {
    writeFileSync(args.preview, layer.previewSvg(result, save, { overlay: args.overlay }));
  }
  for (const line of layer.formatReport(result)) console.log(line);
  process.exit(result.report.problems.length ? 2 : 0);
}

main();
