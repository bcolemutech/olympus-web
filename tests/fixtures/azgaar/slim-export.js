#!/usr/bin/env node
'use strict';

/**
 * Produces a slim Azgaar "Save as JSON" fixture for Cartographer tests
 * (C-2 / #369): the same structure as a real full export, keeping only the
 * sections and fields the Cartographer reads (design §3.2). Drops `grid`,
 * `vertices`, economy data (deals, goods, markets, …), coats of arms, and
 * name bases — about 5.4 MB → 0.4 MB for the Nisia map.
 *
 * Usage:
 *   node tests/fixtures/azgaar/slim-export.js <full-export.json> <out.json>
 *
 * Full exports live in the gitignored maps/ folder; only the slim output is
 * committed.
 */

const fs = require('fs');

const pick = (obj, keys) =>
  obj ? Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]])) : obj;

function slim(full) {
  const { info, settings, pack } = full;
  return {
    info: pick(info, [
      'version',
      'description',
      'exportedAt',
      'mapName',
      'width',
      'height',
      'seed',
    ]),
    settings: pick(settings, ['populationRate', 'urbanization', 'distanceUnit', 'distanceScale']),
    pack: {
      cells: pack.cells.map((c) => pick(c, ['i', 'h', 'biome', 'province', 'state', 'burg'])),
      biomes: pack.biomes.map((b) => pick(b, ['i', 'name', 'color'])),
      burgs: pack.burgs.map((b) =>
        pick(b, [
          'i',
          'name',
          'x',
          'y',
          'cell',
          'state',
          'population',
          'port',
          'capital',
          'type',
          'group',
          'removed',
        ])
      ),
      states: pack.states.map((s) =>
        pick(s, [
          'i',
          'name',
          'fullName',
          'form',
          'formName',
          'capital',
          'color',
          'diplomacy',
          'removed',
        ])
      ),
      provinces: pack.provinces.map((p) =>
        pick(p, ['i', 'name', 'fullName', 'formName', 'state', 'burg', 'color', 'removed'])
      ),
      routes: pack.routes.map((r) => pick(r, ['i', 'group', 'feature', 'name', 'points'])),
      markers: pack.markers.map((m) =>
        pick(m, ['i', 'type', 'icon', 'name', 'note', 'x', 'y', 'cell'])
      ),
    },
  };
}

if (require.main === module) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) {
    console.error('Usage: node tests/fixtures/azgaar/slim-export.js <full-export.json> <out.json>');
    process.exit(1);
  }
  const result = slim(JSON.parse(fs.readFileSync(input, 'utf8')));
  fs.writeFileSync(output, JSON.stringify(result));
  console.log(`Wrote ${output} (${Math.round(fs.statSync(output).size / 1024)} KB)`);
}

module.exports = { slim };
