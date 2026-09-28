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
 * (the MCP write tools) or 'gemini' (the generators). A description with no
 * recorded source counts as imported until the backfill stamps it
 * (scripts/backfill-description-sources.js).
 *
 * Layer requirements switch on as the layers ship: LAYER_CHECKS.town (L-342)
 * and LAYER_CHECKS.battleMap (L-351) become functions that say whether a place
 * has a valid layer. While they are null, the layer isn't required.
 *
 * Only Cartographer worlds, which carry a draft or published status, are
 * graded. Hand-authored static worlds are authored by definition: exempt, and
 * always playable.
 */

const RUBRIC_VERSION = 1;
const GRADES = ['unbuilt', 'stub', 'playable', 'rich'];
const LAYER_CHECKS = Object.freeze({ town: null, battleMap: null });
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

function residentsOf(world, location) {
  const ids = new Set((location.npcIds || []).filter((id) => live((world.characters || {})[id])));
  for (const character of Object.values(world.characters || {})) {
    if (live(character) && character.locationId === location.id) ids.add(character.id);
  }
  return ids.size;
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

/**
 * Grades a place (a settlement or point of interest).
 * @returns {{ grade: string, checklist: { need, for, message }[], exempt?: true }}
 */
function gradeLocation(world, location, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return EXEMPT;
  const kind = (location.geo || {}).kind;
  const checklist = [];

  const layer = kind === 'settlement' ? 'town' : 'battleMap';
  const hasLayer = layers[layer];
  if (hasLayer && !hasLayer(world, location)) {
    checklist.push({
      need: layer,
      for: 'playable',
      message: layer === 'town' ? 'It has no town layout.' : 'It has no battle map.',
    });
  }
  if (!isWritten(location)) checklist.push(descriptionItem(location));
  if (kind === 'settlement' && residentsOf(world, location) === 0) {
    checklist.push({ need: 'residents', for: 'rich', message: 'Nobody lives here yet.' });
  }
  if (loreAbout(world, location.id) === 0) {
    checklist.push({ need: 'lore', for: 'rich', message: 'There is no lore about it.' });
  }
  return { grade: gradeFrom(checklist), checklist };
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

/** Grades an entity of a given kind: 'location', 'faction' or 'region'. */
function gradeEntity(world, kind, entity, options) {
  if (kind === 'location') return gradeLocation(world, entity, options);
  if (kind === 'faction' || kind === 'region') return gradeDescribed(world, entity);
  throw new Error(`gradeEntity: can't grade a ${kind}`);
}

/** Whether players may enter a place: exempt, or graded Playable or better. */
function isPlayable(world, location, options) {
  return rank(gradeLocation(world, location, options).grade) >= rank('playable');
}

const tally = () => ({ unbuilt: 0, stub: 0, playable: 0, rich: 0 });

/**
 * How built a world is: live places, realms and regions counted by grade.
 * `places.open` is the share of places players may enter.
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

  const byGrade = (entities) => {
    const counts = tally();
    for (const entity of entities.filter(live)) counts[gradeDescribed(world, entity).grade] += 1;
    return counts;
  };
  return {
    graded: true,
    rubricVersion: RUBRIC_VERSION,
    places,
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
  gradeLocation,
  gradeEntity,
  gradeWorld,
  isPlayable,
  rank,
};
