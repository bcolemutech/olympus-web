'use strict';

/**
 * The Loom — grading (planning/the-loom-layered-worlds.md §4; L-321 / #390).
 *
 * The one definition of "built". Every place in a Cartographer world is graded
 * from its content, with a checklist of what is missing:
 *
 *   unbuilt   the layer it needs doesn't exist yet (a town layout, a battle map)
 *   stub      only imported facts: its description is still the import text
 *   playable  meets the bar, so players may enter
 *   rich      playable, plus the residents and lore that bring it to life
 *
 * The game's gate (L-322), the MCP work list (L-323) and the Cartographer page
 * all grade through this module. Grades are computed, never stored, so they
 * are always current.
 *
 * "Written" means a non-empty description whose recorded source isn't the
 * import: `sources.description` is 'import' (the Cartographer loader), 'mcp'
 * (the MCP write tools) or 'gemini' (reserved; nothing writes it). A description with no
 * recorded source counts as imported until the backfill stamps it
 * (scripts/backfill-description-sources.js).
 *
 * Layer requirements switch on as the layers ship: LAYER_CHECKS.town and
 * LAYER_CHECKS.battleMap are functions that say whether a place has a valid
 * layer, and null while a layer isn't required. The town requirement is on
 * (L-342, switched on once the MCP town tools (L-343 / #397) had laid out
 * the start town and its open neighbours): a settlement needs a working town
 * layout (./town.js hasTownLayout) to be Playable. The battle-map requirement
 * is on too (L-622 / #447, 2026-10-03): LAYER_CHECKS.battleMap is ./maps.js
 * kindOf, which says 'own', 'generic' or nothing. A point of interest or a
 * place in town needs a map, its own or a generic one, to be Playable, and
 * its own, with walls, doors or obstacles (./layers.js), to be Rich (L-351,
 * L-628; planning/the-loom-layered-worlds.md §9, the-loom-movement-and-
 * vision.md §4).
 *
 * Places in town (L-342) are graded too: Playable once written up, Rich with
 * someone there or lore about them. A settlement's Rich bar grows with its
 * size (SIZE_TIERS).
 *
 * Only Cartographer worlds, which carry a draft or published status, are
 * graded. Hand-authored static worlds are authored by definition: exempt, and
 * always playable.
 */

const RUBRIC_VERSION = 2; // 2: the Rich bar scales with a settlement's size
const GRADES = ['unbuilt', 'stub', 'playable', 'rich'];
const LAYER_CHECKS = Object.freeze({
  // Required lazily: town.js reads isPlaceOpen from this module.
  town: (world, settlement) => require('./town').hasTownLayout(world, settlement),
  battleMap: (world, entity) => require('./maps').kindOf(world, entity),
});
const IMPORT = 'import';

const rank = (grade) => GRADES.indexOf(grade);
const live = (entity) => Boolean(entity) && !entity.retired;
const textOf = (entity) =>
  typeof entity.description === 'string' ? entity.description.trim() : '';

function isGraded(world) {
  return Boolean(world) && (world.status === 'draft' || world.status === 'published');
}

function isWritten(entity) {
  const source = (entity.sources || {}).description;
  return textOf(entity) !== '' && source !== undefined && source !== IMPORT;
}

function descriptionItem(entity) {
  return {
    need: 'description',
    for: 'playable',
    message: textOf(entity)
      ? 'Its description is still the imported text.'
      : 'It has no description.',
  };
}

function loreAbout(world, id) {
  return Object.values(world.lore || {}).filter(
    (entry) => live(entry) && (entry.entityRefs || []).includes(id)
  ).length;
}

// A settlement's town: its live places (L-342), for residents and lore
// found anywhere in it.
function townPlaces(world, locationId) {
  return Object.values(world.places || {}).filter(
    (place) => live(place) && place.locationId === locationId
  );
}

function residentsOf(world, location) {
  const castOf = (entity) =>
    (entity.npcIds || []).filter((id) => live((world.characters || {})[id]));
  const ids = new Set(castOf(location));
  for (const place of townPlaces(world, location.id)) castOf(place).forEach((id) => ids.add(id));
  for (const character of Object.values(world.characters || {})) {
    if (live(character) && character.locationId === location.id) ids.add(character.id);
  }
  return ids.size;
}

// The Rich bar grows with a settlement (requested 2026-09-29): a city needs
// more people and lore than a village before it feels alive. A capital counts
// as one size larger. Residents and lore anywhere in its town count.
const SIZE_TIERS = Object.freeze([
  { name: 'village', from: 0, residents: 1, lore: 1 },
  { name: 'town', from: 1000, residents: 2, lore: 1 },
  { name: 'city', from: 10000, residents: 4, lore: 2 },
  { name: 'great city', from: 30000, residents: 6, lore: 3 },
]);

function sizeTier(location) {
  const geo = location.geo || {};
  let index = 0;
  SIZE_TIERS.forEach((tier, i) => {
    if ((geo.population || 0) >= tier.from) index = i;
  });
  if (geo.capital) index = Math.min(index + 1, SIZE_TIERS.length - 1);
  return SIZE_TIERS[index];
}

function richItem(need, count, wanted, tier) {
  if (count >= wanted) return null;
  if (wanted === 1) {
    return need === 'residents'
      ? { need, for: 'rich', message: 'Nobody lives here yet.' }
      : { need, for: 'rich', message: 'There is no lore about it.' };
  }
  const what = need === 'residents' ? 'residents' : 'lore entries';
  return {
    need,
    for: 'rich',
    message: `A ${tier.name} needs ${wanted} ${what} (it has ${count}).`,
  };
}

// The grade a checklist allows: the lowest bar it fails.
function gradeFrom(checklist) {
  if (checklist.some((item) => item.for === 'playable' && item.need !== 'description')) {
    return 'unbuilt';
  }
  if (checklist.some((item) => item.for === 'playable')) return 'stub';
  return checklist.length ? 'playable' : 'rich';
}

const EXEMPT = Object.freeze({ grade: 'playable', checklist: [], exempt: true });

function layerItem(layers, layer, world, entity) {
  const hasLayer = layers[layer];
  if (!hasLayer || hasLayer(world, entity)) return null;
  return {
    need: layer,
    for: 'playable',
    message: layer === 'town' ? 'It has no town layout.' : 'It has no battle map.',
  };
}

// A generic battle map opens a place, but only its own map makes it Rich
// (decision 2026-10-01): the work list keeps showing places still on one.
// Its own map needs walls, doors or obstacles too (L-628; decision B8).
function ownMapItem(layers, world, entity) {
  const kindOf = layers.battleMap;
  const kind = kindOf ? kindOf(world, entity) : null;
  if (kind === 'generic') {
    return { need: 'battleMap', for: 'rich', message: 'It uses a generic battle map.' };
  }
  if (kind === 'own' && !require('./layers').hasLayers(require('./maps').mapOf(world, entity))) {
    return { need: 'layers', for: 'rich', message: 'Its battle map has no walls or obstacles.' };
  }
  return null;
}

/**
 * How far a settlement is toward Rich: its size, and the residents and lore it
 * has against what its size needs (anyone or anything anywhere in its town
 * counts). Grading and the MCP work list both read this, so they never
 * disagree about a count.
 */
function settlementProgress(world, location) {
  const tier = sizeTier(location);
  const lore =
    loreAbout(world, location.id) +
    townPlaces(world, location.id).reduce((n, place) => n + loreAbout(world, place.id), 0);
  return {
    size: tier.name,
    residents: { have: residentsOf(world, location), want: tier.residents },
    lore: { have: lore, want: tier.lore },
  };
}

/**
 * Grades a place on the world map (a settlement or point of interest).
 * @returns {{ grade: string, checklist: { need, for, message }[], exempt?: true }}
 */
function gradeLocation(world, location, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return EXEMPT;
  const settlement = (location.geo || {}).kind === 'settlement';
  const checklist = [layerItem(layers, settlement ? 'town' : 'battleMap', world, location)];
  if (!isWritten(location)) checklist.push(descriptionItem(location));
  if (settlement) {
    const tier = sizeTier(location);
    const { residents, lore } = settlementProgress(world, location);
    checklist.push(richItem('residents', residents.have, residents.want, tier));
    checklist.push(richItem('lore', lore.have, lore.want, tier));
  } else {
    checklist.push(richItem('lore', loreAbout(world, location.id), 1));
    checklist.push(ownMapItem(layers, world, location));
  }
  const items = checklist.filter(Boolean);
  return { grade: gradeFrom(items), checklist: items };
}

/**
 * Grades a place in town (L-342): Playable once written up (and, when battle
 * maps ship, mapped); Rich with someone found there, or lore about it.
 */
function gradePlace(world, place, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return EXEMPT;
  const checklist = [layerItem(layers, 'battleMap', world, place)];
  if (!isWritten(place)) checklist.push(descriptionItem(place));
  const someone =
    (place.npcIds || []).some((id) => live((world.characters || {})[id])) ||
    Object.values(world.characters || {}).some((c) => live(c) && c.placeId === place.id);
  if (!someone && loreAbout(world, place.id) === 0) {
    checklist.push({
      need: 'residents',
      for: 'rich',
      message: 'Nobody is found here and there is no lore about it: add either.',
    });
  }
  checklist.push(ownMapItem(layers, world, place));
  const items = checklist.filter(Boolean);
  return { grade: gradeFrom(items), checklist: items };
}

/** Grades a realm or region: its description and lore. Never gated. */
function gradeDescribed(world, entity) {
  if (!isGraded(world)) return EXEMPT;
  const checklist = [];
  if (!isWritten(entity)) checklist.push(descriptionItem(entity));
  if (loreAbout(world, entity.id) === 0) {
    checklist.push({ need: 'lore', for: 'rich', message: 'There is no lore about it.' });
  }
  return { grade: gradeFrom(checklist), checklist };
}

/** Grades an entity of a given kind: 'location', 'place', 'faction' or 'region'. */
function gradeEntity(world, kind, entity, options) {
  if (kind === 'location') return gradeLocation(world, entity, options);
  if (kind === 'place') return gradePlace(world, entity, options);
  if (kind === 'faction' || kind === 'region') return gradeDescribed(world, entity);
  throw new Error(`gradeEntity: can't grade a ${kind}`);
}

/** Whether players may enter a place on the map: exempt, or Playable or better. */
function isPlayable(world, location, options) {
  return rank(gradeLocation(world, location, options).grade) >= rank('playable');
}

/** Whether players may enter a place in town. */
function isPlaceOpen(world, place, options) {
  return rank(gradePlace(world, place, options).grade) >= rank('playable');
}

const tally = () => ({ unbuilt: 0, stub: 0, playable: 0, rich: 0 });

/**
 * How built a world is: live places, places in town, realms and regions
 * counted by grade. `places.open` is the share of map places players may enter.
 */
function gradeWorld(world, options) {
  if (!isGraded(world)) return { graded: false };
  const places = { total: 0, ...tally(), settlements: tally(), pointsOfInterest: tally() };
  for (const location of Object.values(world.locations).filter(live)) {
    const { grade } = gradeLocation(world, location, options);
    places.total += 1;
    places[grade] += 1;
    const kind = (location.geo || {}).kind === 'settlement' ? 'settlements' : 'pointsOfInterest';
    places[kind][grade] += 1;
  }
  places.open = places.total
    ? Math.round(((places.playable + places.rich) / places.total) * 1000) / 1000
    : 0;

  const inTown = { total: 0, ...tally() };
  for (const place of Object.values(world.places || {}).filter(live)) {
    inTown.total += 1;
    inTown[gradePlace(world, place, options).grade] += 1;
  }

  const byGrade = (entities) => {
    const counts = tally();
    for (const entity of entities.filter(live)) counts[gradeDescribed(world, entity).grade] += 1;
    return counts;
  };
  return {
    graded: true,
    rubricVersion: RUBRIC_VERSION,
    places,
    inTown,
    factions: byGrade(Object.values(world.factions)),
    regions: byGrade(Object.values(world.regions || {})),
  };
}

module.exports = {
  RUBRIC_VERSION,
  GRADES,
  LAYER_CHECKS,
  isGraded,
  isWritten,
  SIZE_TIERS,
  gradeLocation,
  gradePlace,
  gradeEntity,
  gradeWorld,
  isPlayable,
  isPlaceOpen,
  sizeTier,
  settlementProgress,
  rank,
};
