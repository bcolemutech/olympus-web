'use strict';

// Town seeds for worlds imported before they existed (planning/the-loom-
// layered-worlds.md §8; L-341 / #395). The mapper now gives every settlement
// `geo.seeds` (Azgaar's type, culture, walls, citadel, plaza, temple, shanty
// town) and the world's map its distance scale; the backfill script
// (scripts/backfill-description-sources.js) adds them to an older world from
// its original Azgaar export. Settlements that already have seeds are left
// alone, so it is safe to run twice. No dependencies (see backfill.js).

/**
 * @param {{ meta: object, entities: { locations }, mapped: object }} input
 *   meta: the world document; entities: raw location documents by id;
 *   mapped: mapToCanon() output for the world's original export.
 * @returns {{ writes: object[], worldFields: object, summary: object }}
 */
function planSeedBackfill({ meta, entities, mapped }) {
  const writes = [];
  const summary = { settlements: 0, toSeed: 0, alreadySeeded: 0, unknown: 0, distance: null };
  for (const place of Object.values(entities.locations || {})) {
    if ((place.geo || {}).kind !== 'settlement') continue;
    summary.settlements += 1;
    if (place.geo.seeds) {
      summary.alreadySeeded += 1;
      continue;
    }
    const original = mapped.canon.locations[place.id];
    const seeds = original && original.geo && original.geo.seeds;
    if (!seeds) {
      summary.unknown += 1;
      continue;
    }
    writes.push({ collection: 'locations', id: place.id, fields: { 'geo.seeds': seeds } });
    summary.toSeed += 1;
  }
  const worldFields = {};
  const distance = mapped.canon.map && mapped.canon.map.distance;
  if (distance && !(meta.map || {}).distance) {
    worldFields['map.distance'] = distance;
    summary.distance = distance;
  }
  return { writes, worldFields, summary };
}

module.exports = { planSeedBackfill };
