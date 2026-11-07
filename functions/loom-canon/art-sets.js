'use strict';

const fs = require('fs');
const path = require('path');
const materials = require('./materials');

/**
 * Art sets on the server (planning/game-art.md §4.3, AR3; L-944 / #798): the
 * manifests of the sets the Loom serves, each a copy of
 * public/apps/loom/art/sets/<set>/manifest.json kept here as <set>.json with
 * the same bytes (functions/ deploys on its own; a test fails if they
 * differ), registered with materials.js when this is loaded.
 *
 *   SETS             { [name]: manifest }
 *   DEFAULT_SET      'classic'
 *   setFor(world)    { name, warning? }: the world's `art.set`, else the
 *                    default; one no set has falls back to the default, with
 *                    a warning
 *   listSets()       [{ name, title, description, default, counts }]
 *   countsOf(set)    how much a set paints: materials, faces, variants,
 *                    objects standing, objects seen from above, atlases
 */

const DIR = path.join(__dirname, 'art-sets');
const { DEFAULT_SET } = materials;

const SETS = {};
fs.readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .forEach((file) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    const problems = materials.registerSet(manifest);
    if (problems.length) {
      throw new Error(`Art set ${file}: ${problems.join(' ')}`);
    }
    SETS[manifest.name] = manifest;
  });

function setFor(world) {
  const named = world && world.art && world.art.set;
  if (!named) return { name: DEFAULT_SET };
  if (Object.prototype.hasOwnProperty.call(SETS, named)) return { name: named };
  return {
    name: DEFAULT_SET,
    warning: `The world names the art set "${named}", which there isn't; it is drawn with "${DEFAULT_SET}".`,
  };
}

function countsOf(manifest) {
  const mats = Object.values(manifest.materials || {});
  const objs = Object.values(manifest.objects || {});
  return {
    materials: mats.filter((e) => e.file || e.atlas).length,
    faces: mats.filter((e) => e.face).length,
    variants: mats.reduce((n, e) => n + (Array.isArray(e.variants) ? e.variants.length : 0), 0),
    standing: objs.filter((e) => e.stand).length,
    fromAbove: objs.filter((e) => e.file || e.atlas).length,
    atlases: Object.keys(manifest.atlases || {}).length,
  };
}

function listSets() {
  return Object.values(SETS).map((m) => ({
    name: m.name,
    title: m.title || m.name,
    ...(m.description ? { description: m.description } : {}),
    default: m.name === DEFAULT_SET,
    counts: countsOf(m),
  }));
}

module.exports = { SETS, DEFAULT_SET, setFor, listSets, countsOf };
