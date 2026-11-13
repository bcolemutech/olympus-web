'use strict';

/**
 * The Loom — grading (planning/the-loom-layered-worlds.md §4; L-321 / #390;
 * the score: planning/the-loom-grading.md, L-691 / #552).
 *
 * The one definition of "built". Every place in a Cartographer world is graded
 * from its content. The grade is the gate, what players may enter:
 *
 *   unbuilt   the layer it needs doesn't exist yet (a town layout, a battle map)
 *   stub      only imported facts: its description is still the import text
 *   playable  meets the bar, so players may enter
 *
 * Above the gate, a score from 0 to 100 says how built it is, from weighted
 * criteria (CRITERIA, WEIGHTS), and puts it in a band: Playable under 40,
 * Rich from 40, Vivid from 70, Legendary from 90 (BANDS). Characters, battle
 * maps, region maps (their painted land), realms, regions and the world are
 * scored too. Each criterion is data
 * in one registry; a feature that adds content adds its criteria there
 * (the-loom-grading.md §4.6), and every change to them bumps RUBRIC_VERSION.
 *
 * The game's gate (L-322), the MCP work list (L-323) and the Cartographer page
 * all grade through this module. Grades are computed, never stored, so they
 * are always current.
 *
 * "Written" means a non-empty description whose recorded source isn't the
 * import: `sources.description` is 'import' (the Cartographer loader), 'mcp'
 * (the MCP write tools) or 'gemini' (reserved; nothing writes it). A description with no
 * recorded source counts as imported.
 *
 * Layer requirements: LAYER_CHECKS.town and LAYER_CHECKS.battleMap say
 * whether a place has the layer it needs to be Playable (null while a layer
 * isn't required). A settlement needs a working town layout (./town.js
 * hasTownLayout; L-342). A point of interest or a place in town needs a
 * battle map, its own or a generic one (./maps.js kindOf; L-622); only its
 * own, with walls, doors or obstacles (./layers.js), scores (L-351, L-628).
 * LAYER_CHECKS.ground is town ground (L-655, ./ground.js), scored for a
 * settlement.
 *
 * Every world is a Cartographer world, with a draft or published status, and
 * is graded (there are no built-in worlds since L-686 / #519). A world object
 * with no status, which only tests build, is exempt and always playable.
 */

// 2: the Rich bar scales with a settlement's size; 3: a Rich settlement's town
// has ground (L-655); 4: the score, its criteria and bands (L-691); 5: a
// world's cover image (L-704); 6: a world's game system (L-801); 7: a named
// character's sheet (L-813); 8: a fighter's attacks (L-822); 9: foes at a
// dangerous place (L-824); 10: templates on a large map's places (L-906).
// 11: a map's data is enough to draw it (L-929); 12: a map's look, and its art
// a bonus (L-947). 13: people's token pictures (L-934). 14: a world's brief and
// its painted land: terrain, shaped regions and realms (L-718).
const RUBRIC_VERSION = 14;
// The gate. Above it, the score's band.
const GRADES = ['unbuilt', 'stub', 'playable'];
const BANDS = ['unbuilt', 'stub', 'playable', 'rich', 'vivid', 'legendary'];
const BAND_FROM = Object.freeze({ rich: 40, vivid: 70, legendary: 90 });

const LAYER_CHECKS = Object.freeze({
  // Required lazily: town.js reads isPlaceOpen from this module.
  town: (world, settlement) => require('./town').hasTownLayout(world, settlement),
  battleMap: (world, entity) => require('./maps').kindOf(world, entity),
  // Town ground (L-655): scored for a settlement.
  ground: (world, settlement) => require('./ground').hasGround(settlement),
});
const IMPORT = 'import';

/**
 * The weights, by kind and criterion, and the quality thresholds: tuning is a
 * change here (and a new RUBRIC_VERSION). Calibrated on Nisia (L-691) so that
 * a place that met rubric 2's Rich bar scores about 40.
 */
const WEIGHTS = Object.freeze({
  settlement: {
    residents: 15,
    lore: 10,
    townArt: 15,
    description: 20,
    loreLinks: 5,
    ground: 10,
    // a bonus too (L-718).
    region: 5,
  },
  place: { ownMap: 15, mapArt: 5, someone: 15, lore: 30, description: 10, foes: 10 },
  // token is a bonus too (L-934).
  character: { description: 25, lore: 15, faction: 10, sheet: 20, attacks: 15, token: 10 },
  // art is a bonus: points over the 100 the rest make, capped at 100 (L-947).
  battleMap: { drawn: 30, look: 30, art: 5, features: 20, exits: 20 },
  // land is a realm's alone: a region's shape is asked of its map (L-718).
  realm: { description: 30, lore: 30, people: 20, land: 20 },
  // A region map's own: its terrain, and its regions' shapes (L-718).
  regionMap: { terrain: 60, regions: 40 },
  world: {
    mapArt: 20,
    lore: 20,
    hook: 10,
    cover: 15,
    system: 15,
    templates: 10,
    tokens: 10,
    brief: 20,
  },
});
const QUALITY = Object.freeze({
  // A region map this many places or more is large: its ordinary places
  // want templates (L-906; map levels TM3).
  largeMap: 25,
  // Words a description needs to count, and a lore entry to count anywhere.
  words: { place: 60, character: 40, realm: 80, lore: 60 },
  // Named features a battle map wants.
  features: 2,
  // People found at a point of interest or a place in town, and lore
  // entries about it, that it wants.
  placePeople: 2,
  placeLore: 2,
  // Lore about realms and regions the world wants.
  worldLore: 3,
  // A realm or region wants one lore entry and one notable person, and one
  // more of each for this many settlements, up to `most`.
  realmPer: 25,
  realmMost: 4,
  // An entity's own score, and the rest (what is in it).
  rollup: { settlement: 0.6, poi: 0.7, place: 0.7, realm: 0.7 },
  // The world: its places, and its own criteria.
  world: { places: 0.8, own: 0.2 },
  // A region map: its places, and the land painted on it (L-718).
  regionMap: { places: 0.8, own: 0.2 },
  // The share of a region map under ground that counts as covered (L-718): a
  // few points short is the sampling and the odd gap between shapes.
  landCover: 0.95,
  // How much a place counts toward the world's score by nearness to play.
  nearness: { play: 3, near: 1, far: 0.25, nearHops: 2 },
});

const rank = (grade) => GRADES.indexOf(grade);
const bandRank = (band) => BANDS.indexOf(band);
const live = (entity) => Boolean(entity) && !entity.retired;
const textOf = (entity) =>
  typeof entity.description === 'string' ? entity.description.trim() : '';
const wordsIn = (text) =>
  (typeof text === 'string' && text.trim() ? text.trim().split(/\s+/) : []).length;
const round1 = (n) => Math.round(n * 10) / 10;

function isGraded(world) {
  return Boolean(world) && (world.status === 'draft' || world.status === 'published');
}

function isWritten(entity) {
  const source = (entity.sources || {}).description;
  return textOf(entity) !== '' && source !== undefined && source !== IMPORT;
}

/** The band a score puts something in, once it is past the gate. */
function bandOf(score) {
  if (score >= BAND_FROM.legendary) return 'legendary';
  if (score >= BAND_FROM.vivid) return 'vivid';
  if (score >= BAND_FROM.rich) return 'rich';
  return 'playable';
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

// ── What a world holds ────────────────────────────────────────────────────

// Lore counts once it is long enough (QUALITY.words.lore).
const counted = (entry) => live(entry) && wordsIn(entry.text) >= QUALITY.words.lore;

function loreOn(world, ids) {
  const wanted = new Set(ids);
  return Object.values(world.lore || {}).filter(
    (entry) => counted(entry) && (entry.entityRefs || []).some((id) => wanted.has(id))
  );
}

// A settlement's town: its live places (L-342), for residents and lore
// found anywhere in it.
function townPlaces(world, locationId) {
  return Object.values(world.places || {}).filter(
    (place) => live(place) && place.locationId === locationId
  );
}

const castOf = (world, entity) =>
  (entity.npcIds || []).filter((id) => live((world.characters || {})[id]));

function residentIds(world, location) {
  const ids = new Set(castOf(world, location));
  for (const place of townPlaces(world, location.id))
    castOf(world, place).forEach((id) => ids.add(id));
  for (const character of Object.values(world.characters || {})) {
    if (live(character) && character.locationId === location.id) ids.add(character.id);
  }
  return [...ids];
}

// The people at a point of interest or a place in town.
function peopleAt(world, entity, isPlace) {
  const ids = new Set(castOf(world, entity));
  for (const character of Object.values(world.characters || {})) {
    if (!live(character)) continue;
    if (isPlace ? character.placeId === entity.id : character.locationId === entity.id) {
      if (isPlace || !character.placeId) ids.add(character.id);
    }
  }
  return [...ids];
}

// A settlement wants more people and lore the bigger it is (requested
// 2026-09-29; raised in L-691). A capital counts as one size larger.
const SIZE_TIERS = Object.freeze([
  { name: 'village', from: 0, residents: 2, lore: 2 },
  { name: 'town', from: 1000, residents: 4, lore: 3 },
  { name: 'city', from: 10000, residents: 8, lore: 5 },
  { name: 'great city', from: 30000, residents: 12, lore: 8 },
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

// Lore about a settlement, its places or its people.
function settlementLore(world, location) {
  const subjects = [location.id]
    .concat(townPlaces(world, location.id).map((place) => place.id))
    .concat(residentIds(world, location));
  const entries = loreOn(world, subjects);
  const wanted = new Set(subjects);
  const touched = new Set();
  for (const entry of entries) {
    (entry.entityRefs || []).filter((id) => wanted.has(id)).forEach((id) => touched.add(id));
  }
  return { entries, touched: touched.size };
}

/**
 * How far a settlement is toward its size's people and lore (anyone or
 * anything anywhere in its town counts). Grading and the MCP work list both
 * read this, so they never disagree about a count.
 */
function settlementProgress(world, location) {
  const tier = sizeTier(location);
  return {
    size: tier.name,
    residents: { have: residentIds(world, location).length, want: tier.residents },
    lore: { have: settlementLore(world, location).entries.length, want: tier.lore },
  };
}

// The settlements of a realm or region.
function settlementsOf(world, kind, entity) {
  return Object.values(world.locations || {}).filter(
    (location) =>
      live(location) &&
      (location.geo || {}).kind === 'settlement' &&
      (kind === 'realm'
        ? (location.factionIds || []).includes(entity.id)
        : (location.geo || {}).regionId === entity.id ||
          (entity.locationIds || []).includes(location.id))
  );
}

function realmWant(world, kind, entity) {
  const n = settlementsOf(world, kind, entity).length;
  return Math.min(QUALITY.realmMost, 1 + Math.floor(n / QUALITY.realmPer));
}

// ── Criteria ──────────────────────────────────────────────────────────────

const share = (have, want) => (want > 0 ? Math.min(1, have / want) : 1);
const met = () => ({ progress: 1 });

function longEnough(entity, kind, words, { written = true } = {}) {
  const have = wordsIn(entity.description);
  if ((!written || isWritten(entity)) && have >= words) return met();
  const who = kind === 'character' ? 'Their' : 'Its';
  return {
    progress: 0,
    have,
    want: words,
    message: `${who} description needs at least ${words} words (it has ${have}).`,
  };
}

function ownMap(world, entity, layers) {
  const kindOf = layers.battleMap;
  const kind = kindOf ? kindOf(world, entity) : null;
  return kind === 'own' ? require('./maps').mapOf(world, entity) : null;
}

// Art is a library image (L-704) or, from before the library, a Storage path
// (./art.js).
const hasArt = (thing) => Boolean(thing && require('./art').fromRef(thing.image));

// What a grid with no art and not enough data to draw lacks (PL2; L-929): the
// tool that would give it.
function undrawn(map) {
  const how = require('./layer-geometry').drawnOf(map);
  const g = (map && map.geometry) || {};
  if (how === 'part' && (g.ground || []).length) {
    return {
      need: 'drawn',
      tool: 'set_walls',
      message: 'Its battle map has floors but no walls: draw them (set_walls), or give it art.',
    };
  }
  if (how === 'part') {
    return {
      need: 'drawn',
      tool: 'set_ground',
      message: 'Its battle map has walls but no floors: draw them (set_ground), or give it art.',
    };
  }
  return {
    need: 'drawn',
    tool: 'set_ground',
    message: 'Its battle map is not drawn: it has no floors or walls, and no art.',
  };
}

// A map's look (GR1; L-947): the share of its materials and object kinds with
// painted art, and what lacks it.
function lookCheck(world, map) {
  const look = require('./look').unpainted(world, map, { ownArt: hasArt(map) });
  const lacking = look.materials.concat(look.objects);
  // Nothing drawn, nothing to paint: it earns the look once it is drawn.
  if (!look.total && !hasArt(map)) {
    return { progress: 0, ...undrawn(map) };
  }
  if (!lacking.length) return met();
  const shown = lacking.slice(0, 6).join(', ') + (lacking.length > 6 ? ', …' : '');
  return {
    progress: share(look.painted, look.total),
    have: look.painted,
    want: look.total,
    lacking,
    message: `${lacking.length} of the ${look.total} materials and objects on its battle map have no painted art: ${shown}. Give them art (set_object_art, or an art set that paints them).`,
  };
}

/**
 * The criteria registry (planning/the-loom-grading.md §4.1). Each is
 * { id, kinds, weight, feature, label, need, tool, check }: `check(world,
 * entity, context)` is pure and says { progress (0–1), have?, want?, message }
 * (the message only when not met). Partial progress earns that share of the
 * weight. `need` names the work for the work list; `tool` the MCP tool that
 * does it.
 */
const CRITERIA = Object.freeze([
  // Settlements.
  {
    id: 'settlement.residents',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.residents,
    feature: 'L-321',
    label: 'Residents for its size',
    need: 'residents',
    tool: 'add_character',
    check: (world, settlement) => {
      const tier = sizeTier(settlement);
      const have = residentIds(world, settlement).length;
      if (have >= tier.residents) return met();
      return {
        progress: share(have, tier.residents),
        have,
        want: tier.residents,
        message: `A ${tier.name} needs ${tier.residents} residents (it has ${have}).`,
      };
    },
  },
  {
    id: 'settlement.lore',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.lore,
    feature: 'L-321',
    label: 'Lore for its size, about more than one thing in it',
    need: 'lore',
    tool: 'add_lore',
    check: (world, settlement) => {
      const tier = sizeTier(settlement);
      const { entries, touched } = settlementLore(world, settlement);
      const have = entries.length;
      // Variety: lore counts fully only if it touches more than one of the
      // settlement, its places and its people.
      const varied = touched > 1;
      const progress = share(have, tier.lore) * (varied ? 1 : 0.5);
      if (progress >= 1) return met();
      return {
        progress,
        have,
        want: tier.lore,
        message:
          have >= tier.lore
            ? 'Its lore is all about one thing: write some about its places or people.'
            : `A ${tier.name} needs ${tier.lore} lore entries of ${QUALITY.words.lore} words or ` +
              `more, about its places and people (it has ${have}).`,
      };
    },
  },
  {
    id: 'settlement.townArt',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.townArt,
    feature: 'L-347',
    label: 'Town art',
    need: 'townArt',
    tool: 'studio_assign',
    check: (world, settlement) =>
      hasArt(settlement.town) ? met() : { progress: 0, message: 'Its town has no art.' },
  },
  {
    id: 'settlement.description',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.description,
    feature: 'L-321',
    label: 'A description long enough',
    need: 'description',
    tool: 'update_location',
    check: (world, settlement) => longEnough(settlement, 'place', QUALITY.words.place),
  },
  {
    id: 'settlement.loreLinks',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.loreLinks,
    feature: 'L-691',
    label: 'Lore that links two or more',
    need: 'lore',
    tool: 'add_lore',
    check: (world, settlement) =>
      settlementLore(world, settlement).entries.some((entry) => (entry.entityRefs || []).length > 1)
        ? met()
        : { progress: 0, message: 'No lore about it names two or more places or people.' },
  },
  {
    id: 'settlement.ground',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.ground,
    feature: 'L-655',
    label: 'Town ground',
    need: 'ground',
    tool: 'set_town_ground',
    check: (world, settlement, { layers }) =>
      !layers.ground || layers.ground(world, settlement)
        ? met()
        : { progress: 0, message: 'Its town has no ground yet.' },
  },
  {
    // Inside a region (GR1; L-718): in one of the world's live regions, set
    // by hand or taken from the zone it sits in (R6), and that region painted:
    // a region with no shape is a name only. A bonus, as a token picture is
    // (L-934): points over the rest, so a settlement built before the land was
    // painted is not marked down and the Nisia calibration stands.
    id: 'settlement.region',
    kinds: ['settlement'],
    weight: WEIGHTS.settlement.region,
    bonus: true,
    feature: 'L-718',
    label: 'Inside a painted region',
    need: 'region',
    tool: 'update_location',
    check: (world, settlement) => {
      const region = ((world && world.regions) || {})[(settlement.geo || {}).regionId];
      if (!live(region)) {
        return {
          progress: 0,
          message:
            'It is in no region: shape a region over it (add_regions, then set_zones with ' +
            'region), or name one with update_location regionId.',
        };
      }
      if (require('./land').regionHasShape(world, region.id)) return met();
      return {
        progress: 0,
        tool: 'set_zones',
        message: `Its region, ${region.name || region.id}, has no shape: give it a zone (set_zones with region).`,
      };
    },
  },

  // Points of interest and places in town.
  {
    id: 'place.ownMap',
    kinds: ['poi', 'place'],
    weight: WEIGHTS.place.ownMap,
    feature: 'L-628',
    label: 'Its own battle map, drawn',
    need: 'battleMap',
    tool: 'set_battle_map',
    check: (world, entity, { layers }) => {
      const kind = layers.battleMap ? layers.battleMap(world, entity) : null;
      if (kind === 'generic') {
        return { progress: 0, message: 'It uses a generic battle map.' };
      }
      if (kind !== 'own') return { progress: 0, message: 'It has no battle map.' };
      const map = require('./maps').mapOf(world, entity);
      // Drawn from its data, or art (PL2; L-929): half without.
      if (map && !hasArt(map) && require('./layer-geometry').drawnOf(map) !== 'full') {
        return { progress: 0.5, ...undrawn(map) };
      }
      return met();
    },
  },
  {
    id: 'place.mapArt',
    kinds: ['poi', 'place'],
    bonus: true,
    weight: WEIGHTS.place.mapArt,
    feature: 'L-351',
    label: 'Art on its battle map',
    need: 'mapArt',
    tool: 'studio_assign',
    check: (world, entity, { layers }) => {
      const map = ownMap(world, entity, layers);
      if (hasArt(map)) return met();
      return {
        progress: 0,
        message: map ? 'Its battle map has no art.' : 'It has no battle map of its own to paint.',
      };
    },
  },
  {
    id: 'place.someone',
    kinds: ['poi', 'place'],
    weight: WEIGHTS.place.someone,
    feature: 'L-342',
    label: 'Someone there',
    need: 'residents',
    tool: 'add_character',
    check: (world, entity, { kind }) => {
      const want = QUALITY.placePeople;
      const have = peopleAt(world, entity, kind === 'place').length;
      if (have >= want) return met();
      return {
        progress: share(have, want),
        have,
        want,
        message: have
          ? `It wants ${want} people found here (it has ${have}).`
          : 'Nobody is found here.',
      };
    },
  },
  {
    // Foes at a dangerous place (L-824; combat GR1): one with danger set has
    // hostile figures on its battle map or hostile characters found there.
    // Encounter tables join it with wilderness travel and rests (L-827).
    id: 'place.foes',
    kinds: ['poi', 'place'],
    weight: WEIGHTS.place.foes,
    feature: 'L-824',
    label: 'Foes at a dangerous place',
    need: 'foes',
    tool: 'place_figures',
    applies: (world, entity) => entity.danger === 'low' || entity.danger === 'high',
    check: (world, entity, { kind }) => {
      const map = require('./maps').mapOf(world, entity);
      const figures = ((map && map.figures) || []).filter((g) =>
        ['hostile', 'wary'].includes(g.side || 'hostile')
      );
      // The wary count (L-392): guards who challenge before they fight.
      const people = peopleAt(world, entity, kind === 'place').filter((id) =>
        ['hostile', 'wary'].includes(((world.characters || {})[id] || {}).side)
      );
      return figures.length || people.length
        ? met()
        : {
            progress: 0,
            message:
              'It is dangerous but no foes are here: place some with place_figures, or make ' +
              'someone here hostile (update_character side).',
          };
    },
  },
  {
    id: 'place.lore',
    kinds: ['poi', 'place'],
    weight: WEIGHTS.place.lore,
    feature: 'L-321',
    label: 'Lore about it',
    need: 'lore',
    tool: 'add_lore',
    check: (world, entity) => {
      const want = QUALITY.placeLore;
      const have = loreOn(world, [entity.id]).length;
      if (have >= want) return met();
      return {
        progress: share(have, want),
        have,
        want,
        message: have
          ? `It wants ${want} lore entries about it (it has ${have}).`
          : `There is no lore about it of ${QUALITY.words.lore} words or more.`,
      };
    },
  },
  {
    id: 'place.description',
    kinds: ['poi', 'place'],
    weight: WEIGHTS.place.description,
    feature: 'L-321',
    label: 'A description long enough',
    need: 'description',
    tool: 'update_location',
    check: (world, entity, { kind }) => ({
      ...longEnough(entity, 'place', QUALITY.words.place),
      ...(kind === 'place' ? { tool: 'update_place' } : {}),
    }),
  },

  // Characters.
  {
    id: 'character.description',
    kinds: ['character'],
    weight: WEIGHTS.character.description,
    feature: 'L-691',
    label: 'A description long enough',
    need: 'description',
    tool: 'update_character',
    // Characters are only ever written over MCP: no source to check.
    check: (world, character) =>
      longEnough(character, 'character', QUALITY.words.character, { written: false }),
  },
  {
    id: 'character.lore',
    kinds: ['character'],
    weight: WEIGHTS.character.lore,
    feature: 'L-691',
    label: 'Lore about them',
    need: 'lore',
    tool: 'add_lore',
    check: (world, character) =>
      loreOn(world, [character.id]).length
        ? met()
        : { progress: 0, message: 'There is no lore about them.' },
  },
  {
    id: 'character.faction',
    kinds: ['character'],
    weight: WEIGHTS.character.faction,
    feature: 'L-691',
    label: 'A realm',
    need: 'faction',
    tool: 'update_character',
    check: (world, character) =>
      live((world.factions || {})[character.factionId])
        ? met()
        : { progress: 0, message: 'They belong to no realm.' },
  },
  {
    // A sheet that fits the world's game system (L-813; game systems GR3),
    // so checks against them roll fairly; one the system no longer fits
    // (SY2) is listed for repair.
    id: 'character.sheet',
    kinds: ['character'],
    weight: WEIGHTS.character.sheet,
    feature: 'L-813',
    label: 'A sheet for the world’s rules',
    need: 'sheet',
    tool: 'set_sheet',
    check: (world, character) => {
      if (!character.sheet) {
        return { progress: 0, message: 'They have no sheet; give them one with set_sheet.' };
      }
      const misfits = require('./sheets').validateSheet(
        require('./checks').systemOf(world),
        character.sheet
      );
      return misfits.length
        ? {
            progress: 0,
            message: `Their sheet no longer fits the world’s rules: ${misfits[0]}`,
          }
        : met();
    },
  },

  {
    // A fighter's attacks (L-822; combat GR1): someone on a side in a fight,
    // with or against the player, has attacks of their own on their sheet,
    // not only the system's unarmed one. Neutral characters are not graded
    // on it.
    id: 'character.attacks',
    kinds: ['character'],
    weight: WEIGHTS.character.attacks,
    feature: 'L-822',
    label: 'Attacks for a fighter',
    need: 'attacks',
    tool: 'set_sheet',
    applies: (world, character) => ['hostile', 'party', 'wary'].includes(character.side),
    check: (world, character) => {
      const list = character.sheet && character.sheet.attacks;
      if (!Array.isArray(list) || !list.length) {
        return {
          progress: 0,
          message: 'They fight but have no attacks; give their sheet some with set_sheet.',
        };
      }
      const errors = require('../loom-modules/combat/attacks').validateAttacks(
        require('./checks').systemOf(world),
        list
      );
      return errors.length
        ? { progress: 0, message: `Their attacks don’t fit the world’s rules: ${errors[0]}` }
        : met();
    },
  },

  {
    // A picture in the circle on a battle map (L-934; tokens §4.5): their
    // own, else their stat block's (TK1). A bonus, as map art is (L-947):
    // points over the rest, so a character built without one is not marked
    // down, and one with it gets closer to the top.
    id: 'character.token',
    kinds: ['character'],
    weight: WEIGHTS.character.token,
    bonus: true,
    feature: 'L-934',
    label: 'A token picture',
    need: 'token',
    tool: 'set_token',
    check: (world, character) =>
      require('./tokens').tokenOf(character, world)
        ? met()
        : { progress: 0, message: 'They have no token picture; give them one with set_token.' },
  },

  // Battle maps.
  {
    // Its data is enough to draw it, or it has art (PL2; L-929): floors and
    // walls drawn from the geometry, half for one of them.
    id: 'battleMap.drawn',
    kinds: ['battleMap'],
    weight: WEIGHTS.battleMap.drawn,
    feature: 'L-929',
    label: 'Drawn: floors and walls, or art',
    need: 'drawn',
    tool: 'set_ground',
    check: (world, map) => {
      if (hasArt(map)) return met();
      const how = require('./layer-geometry').drawnOf(map);
      if (how === 'full') return met();
      return { progress: how === 'part' ? 0.5 : 0, ...undrawn(map) };
    },
  },
  {
    // Everything on it has painted art (GR1; L-947): in its world's set, or
    // its own. A map with artwork of its own is drawn from that.
    id: 'battleMap.look',
    kinds: ['battleMap'],
    weight: WEIGHTS.battleMap.look,
    feature: 'L-947',
    label: 'Its look: everything on it painted',
    need: 'look',
    tool: 'set_object_art',
    check: (world, map) => lookCheck(world, map),
  },
  {
    // A small bonus for a map with its own artwork (GR2; L-947): "art-based
    // maps still look best". Not part of the 100 a map's data can earn, so a
    // map drawn from data, large or small, loses nothing for having none.
    id: 'battleMap.art',
    kinds: ['battleMap'],
    bonus: true,
    weight: WEIGHTS.battleMap.art,
    feature: 'L-351',
    label: 'Art (a bonus)',
    need: 'mapArt',
    tool: 'studio_assign',
    check: (world, map) => (hasArt(map) ? met() : { progress: 0, message: 'It has no art.' }),
  },
  {
    id: 'battleMap.features',
    kinds: ['battleMap'],
    weight: WEIGHTS.battleMap.features,
    feature: 'L-351',
    label: 'Named features',
    need: 'features',
    tool: 'set_battle_map',
    check: (world, map) => {
      const have = (map.features || []).length;
      if (have >= QUALITY.features) return met();
      return {
        progress: share(have, QUALITY.features),
        have,
        want: QUALITY.features,
        message: `It needs ${QUALITY.features} named features (it has ${have}).`,
      };
    },
  },
  {
    id: 'battleMap.exits',
    kinds: ['battleMap'],
    weight: WEIGHTS.battleMap.exits,
    feature: 'L-351',
    label: 'Exits placed',
    need: 'exits',
    tool: 'set_battle_map',
    check: (world, map) =>
      (map.exits || []).length ? met() : { progress: 0, message: 'It has no exits.' },
  },

  // Realms and regions.
  {
    id: 'realm.description',
    kinds: ['realm', 'region'],
    weight: WEIGHTS.realm.description,
    feature: 'L-321',
    label: 'A description long enough',
    need: 'description',
    tool: 'update_faction',
    check: (world, entity, { kind }) => ({
      ...longEnough(entity, 'realm', QUALITY.words.realm),
      ...(kind === 'region' ? { tool: 'update_region' } : {}),
    }),
  },
  {
    id: 'realm.lore',
    kinds: ['realm', 'region'],
    weight: WEIGHTS.realm.lore,
    feature: 'L-321',
    label: 'Lore for its size',
    need: 'lore',
    tool: 'add_lore',
    check: (world, entity, { kind }) => {
      const want = realmWant(world, kind, entity);
      const have = loreOn(world, [entity.id]).length;
      if (have >= want) return met();
      return {
        progress: share(have, want),
        have,
        want,
        message: `It needs ${want} lore ${want === 1 ? 'entry' : 'entries'} of ${
          QUALITY.words.lore
        } words or more about it (it has ${have}).`,
      };
    },
  },
  {
    id: 'realm.people',
    kinds: ['realm', 'region'],
    weight: WEIGHTS.realm.people,
    feature: 'L-691',
    label: 'Notable people',
    need: 'people',
    tool: 'add_character',
    check: (world, entity, { kind }) => {
      const want = realmWant(world, kind, entity);
      const homes =
        kind === 'region' ? new Set(settlementsOf(world, kind, entity).map((l) => l.id)) : null;
      const have = Object.values(world.characters || {}).filter(
        (character) =>
          live(character) &&
          (homes ? homes.has(character.locationId) : character.factionId === entity.id)
      ).length;
      if (have >= want) return met();
      return {
        progress: share(have, want),
        have,
        want,
        message: `It needs ${want} notable ${want === 1 ? 'person' : 'people'} (it has ${have}).`,
      };
    },
  },

  {
    // A realm's land is its regions' shapes together (GR1; R3; L-718): at
    // least one of its regions has a zone on a region map.
    id: 'realm.land',
    kinds: ['realm'],
    weight: WEIGHTS.realm.land,
    feature: 'L-718',
    label: 'Land: a region with a shape',
    need: 'land',
    tool: 'set_zones',
    check: (world, realm) => {
      const { regions } = require('./realms').realmLand(world, realm.id);
      if (require('./land').realmHasLand(world, realm.id)) return met();
      return regions.length
        ? {
            progress: 0,
            message: `None of its ${regions.length} regions has a shape: give one a zone naming it (set_zones with region).`,
          }
        : {
            progress: 0,
            tool: 'add_regions',
            message: 'It has no regions, so no land: add_regions with factionId, then shape them.',
          };
    },
  },

  // Region maps (GR1; L-718).
  {
    // Terrain covers its land: the share of its area under ground, water
    // counting (R1). Partial, up to the cover that counts.
    id: 'regionMap.terrain',
    kinds: ['regionMap'],
    weight: WEIGHTS.regionMap.terrain,
    feature: 'L-718',
    label: 'Terrain covering its land',
    need: 'terrain',
    tool: 'set_ground',
    check: (world, map) => {
      const share = require('./land').terrainCover(world, map.id);
      if (share >= QUALITY.landCover) return met();
      const have = Math.round(share * 100);
      return {
        progress: share / QUALITY.landCover,
        have,
        want: Math.round(QUALITY.landCover * 100),
        message: share
          ? `Its ground covers ${have}% of it: paint the rest (set_ground; view_image shows what is bare).`
          : 'Its land has no terrain: paint it with set_ground (grassland, forest, ocean, …; list_materials).',
      };
    },
  },
  {
    // Every region on it has a shape (GR1): a zone naming it. A map with no
    // regions isn't graded on it.
    id: 'regionMap.regions',
    kinds: ['regionMap'],
    weight: WEIGHTS.regionMap.regions,
    feature: 'L-718',
    label: 'Every region on it shaped',
    need: 'shapes',
    tool: 'set_zones',
    applies: (world, map) => require('./land').regionsOnMap(world, map.id).length > 0,
    check: (world, map) => {
      const land = require('./land');
      const ids = land.regionsOnMap(world, map.id);
      const lacking = ids
        .filter((id) => !land.regionHasShape(world, id))
        .map((id) => world.regions[id].name || id);
      if (!lacking.length) return met();
      const shown = lacking.slice(0, 6).join(', ') + (lacking.length > 6 ? ', …' : '');
      return {
        progress: (ids.length - lacking.length) / ids.length,
        have: ids.length - lacking.length,
        want: ids.length,
        lacking,
        message: `${lacking.length} of the ${ids.length} regions on it have no shape: ${shown}. Give each a zone naming it (set_zones with region).`,
      };
    },
  },

  // The world.
  {
    // The brief (GR1; L-711): genre, tone, era and art direction, the share
    // of the four written.
    id: 'world.brief',
    kinds: ['world'],
    weight: WEIGHTS.world.brief,
    feature: 'L-718',
    label: 'A brief: genre, tone, era and art direction',
    need: 'brief',
    tool: 'update_world',
    check: (world) => {
      const brief = require('./brief');
      const have = brief.briefOf(world) || {};
      const missing = brief.FIELDS.filter((key) => !have[key]);
      if (!missing.length) return met();
      const written = brief.FIELDS.length - missing.length;
      return {
        progress: written / brief.FIELDS.length,
        have: written,
        want: brief.FIELDS.length,
        message: written
          ? `Its brief lacks ${missing.map((key) => brief.LABELS[key]).join(', ')}.`
          : 'The world has no brief: set its genre, tone, era and art direction with update_world.',
      };
    },
  },
  {
    id: 'world.mapArt',
    kinds: ['world'],
    weight: WEIGHTS.world.mapArt,
    feature: 'C-4',
    label: 'Map art',
    need: 'mapArt',
    tool: 'studio_assign',
    check: (world) =>
      require('./art').worldMapArt(world) || (world.map && world.map.hasImage)
        ? met()
        : { progress: 0, message: 'The world map has no art.' },
  },
  {
    id: 'world.cover',
    kinds: ['world'],
    weight: WEIGHTS.world.cover,
    feature: 'L-704',
    label: 'A cover image',
    need: 'cover',
    tool: 'studio_assign',
    check: (world) =>
      require('./art').coverArt(world)
        ? met()
        : { progress: 0, message: 'The world has no cover image for the Loom’s world list.' },
  },
  {
    id: 'world.lore',
    kinds: ['world'],
    weight: WEIGHTS.world.lore,
    feature: 'L-691',
    label: 'World-wide lore (about realms and regions)',
    need: 'lore',
    tool: 'add_lore',
    check: (world) => {
      const broad = new Set(
        Object.keys(world.factions || {}).concat(Object.keys(world.regions || {}))
      );
      const have = Object.values(world.lore || {}).filter(
        (entry) => counted(entry) && (entry.entityRefs || []).some((id) => broad.has(id))
      ).length;
      if (have >= QUALITY.worldLore) return met();
      return {
        progress: share(have, QUALITY.worldLore),
        have,
        want: QUALITY.worldLore,
        message: `It needs ${QUALITY.worldLore} lore entries about its realms and regions (it has ${have}).`,
      };
    },
  },
  {
    // A game system (L-801; planning/game-systems.md §4.9): named, and
    // passing its checks. A world without one plays by the built-in fantasy
    // system (SY4), but hasn't chosen.
    id: 'world.system',
    kinds: ['world'],
    weight: WEIGHTS.world.system,
    feature: 'L-801',
    label: 'A game system',
    need: 'system',
    tool: 'update_world',
    check: (world) => {
      if (!world.systemId) {
        return {
          progress: 0,
          message:
            'The world has no game system; choose one (list_systems) and set it with update_world.',
        };
      }
      if (!world.system) {
        return {
          progress: 0,
          message: `It names the game system "${world.systemId}", which doesn't exist.`,
        };
      }
      const { errors } = require('./systems').validateSystem(world.system);
      return errors.length
        ? { progress: 0, message: `Its game system fails its checks: ${errors[0]}` }
        : met();
    },
  },
  {
    id: 'world.hook',
    kinds: ['world'],
    weight: WEIGHTS.world.hook,
    feature: 'L-691',
    label: 'An opening hook and a tagline',
    need: 'hook',
    tool: 'publish_world',
    check: (world) => {
      const has = (text) => typeof text === 'string' && text.trim() !== '';
      const have = [world.openingHook, world.tagline].filter(has).length;
      if (have === 2) return met();
      return {
        progress: have / 2,
        have,
        want: 2,
        message: has(world.openingHook) ? 'It has no tagline.' : 'It has no opening hook.',
      };
    },
  },
  {
    // Every stat block placed on a map has a token picture (L-934; tokens
    // §4.5): the groups of figures on its battle maps, by the stat block
    // they name. A world that places none isn't graded on it.
    id: 'world.tokens',
    kinds: ['world'],
    weight: WEIGHTS.world.tokens,
    feature: 'L-934',
    label: 'Token pictures for the stat blocks placed on maps',
    need: 'tokens',
    tool: 'set_token',
    applies: (world) => placedStatBlocks(world).length > 0,
    check: (world) => {
      const placed = placedStatBlocks(world);
      const lacking = placed.filter((entry) => !require('./tokens').isToken(entry.token));
      if (!lacking.length) return met();
      const names = lacking.map((entry) => entry.name || entry.id);
      const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ', …' : '');
      return {
        progress: (placed.length - lacking.length) / placed.length,
        have: placed.length - lacking.length,
        want: placed.length,
        lacking: names,
        message: `${lacking.length} of the ${placed.length} stat blocks placed on maps have no token picture: ${shown}. Give each one with set_token.`,
      };
    },
  },
  {
    // Its large maps' ordinary places open, by hand or from a template
    // (L-906; map levels §4.8, TM3; decided with the user 2026-11-01:
    // weight 10, a region map of 25 places or more is large).
    id: 'world.templates',
    kinds: ['world'],
    weight: WEIGHTS.world.templates,
    feature: 'L-906',
    label: 'Templates on a large map’s ordinary places',
    need: 'templates',
    tool: 'assign_template',
    applies: (world) => largeMaps(world).length > 0,
    check: (world) => {
      let total = 0;
      let open = 0;
      for (const view of largeMaps(world)) {
        for (const place of Object.values(view.locations).filter(live)) {
          total += 1;
          if (isPlayable(view, place)) open += 1;
        }
      }
      if (total && open === total) return met();
      return {
        progress: total ? open / total : 1,
        have: open,
        want: total,
        message: `${total - open} of the ${total} places on its large maps are closed: give the ordinary ones a template (assign_template).`,
      };
    },
  },
]);

// The named stat blocks that groups of figures on a world's battle maps
// stand for (L-934): each once, as the world holds it.
function placedStatBlocks(world) {
  const named = new Set();
  for (const map of Object.values((world && world.battleMaps) || {}).filter(live)) {
    for (const group of map.figures || []) {
      if (typeof group.statBlock === 'string') named.add(group.statBlock);
    }
  }
  return [...named]
    .map((id) => ((world && world.statBlocks) || {})[id])
    .filter((entry) => live(entry));
}

// The frames of a world's large region maps (L-906): 25 places or more.
function largeMaps(world) {
  const frames = require('./frames');
  const play = frames.playWorld(world);
  return Object.entries(play.maps || {})
    .filter(([, m]) => m.kind === 'region' && !m.template && !m.instanceOf)
    .map(([id]) => frames.viewFor(play, id))
    .filter((view) => Object.values(view.locations).filter(live).length >= QUALITY.largeMap);
}

/**
 * An entity's own score: the met weight of its criteria (with partial
 * progress) over their total weight, 0–100, and the unmet ones as checklist
 * items.
 */
function ownScore(world, kind, entity, layers) {
  const context = { kind, layers };
  let total = 0;
  let earned = 0;
  // Bonus criteria (L-947) add points over the rest, up to 100.
  let bonus = 0;
  const criteria = [];
  const unmet = [];
  for (const criterion of CRITERIA) {
    if (!criterion.kinds.includes(kind)) continue;
    // A criterion only some of a kind are graded on (L-822: fighters).
    if (criterion.applies && !criterion.applies(world, entity)) continue;
    const result = criterion.check(world, entity, context);
    const progress = Math.max(0, Math.min(1, result.progress));
    if (criterion.bonus) bonus += criterion.weight * progress;
    else {
      total += criterion.weight;
      earned += criterion.weight * progress;
    }
    const need = result.need || criterion.need;
    const tool = result.tool || criterion.tool;
    // The whole checklist, met or not, with each criterion's weight and
    // progress, and for what is unmet the work and the tool that does it.
    criteria.push({
      id: criterion.id,
      label: criterion.label,
      weight: criterion.weight,
      ...(criterion.bonus ? { bonus: true } : {}),
      met: progress >= 1,
      progress: round1(progress * 100) / 100,
      ...(result.have !== undefined ? { have: result.have, want: result.want } : {}),
      ...(progress < 1 ? { need, tool, message: result.message } : {}),
      ...(progress < 1 && result.lacking ? { lacking: result.lacking } : {}),
    });
    if (progress < 1) {
      unmet.push({
        need,
        for: 'score',
        criterion: criterion.id,
        weight: criterion.weight,
        gain: round1(criterion.weight * (1 - progress)),
        tool,
        message: result.message,
        ...(result.have !== undefined ? { have: result.have, want: result.want } : {}),
        ...(result.lacking ? { lacking: result.lacking } : {}),
      });
    }
  }
  return {
    score: total ? round1(Math.min(100, (earned / total) * 100 + bonus)) : 0,
    criteria,
    unmet,
  };
}

const mean = (scores) => (scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0);

// The grade a gate checklist allows: the lowest bar it fails.
function gradeFrom(checklist) {
  if (checklist.some((item) => item.need !== 'description')) return 'unbuilt';
  if (checklist.length) return 'stub';
  return 'playable';
}

const EXEMPT = Object.freeze({
  grade: 'playable',
  band: 'playable',
  score: 0,
  checklist: [],
  exempt: true,
});

function layerItem(layers, layer, world, entity) {
  const hasLayer = layers[layer];
  if (!hasLayer || hasLayer(world, entity)) return null;
  return {
    need: layer,
    for: 'playable',
    message: layer === 'town' ? 'It has no town layout.' : 'It has no battle map.',
  };
}

// A graded result: the gate's grade, the band, the score (0 below the gate:
// a closed place counts for nothing yet), and the checklist (the gate's
// items, then the unmet criteria, most score first).
function result(gate, own, score) {
  const grade = gradeFrom(gate);
  const open = rank(grade) >= rank('playable');
  const final = round1(score);
  // The gate's work comes first; a criterion it already names is left out.
  const named = new Set(gate.map((item) => item.need));
  const unmet = own.unmet.filter((item) => !named.has(item.need)).sort((a, b) => b.gain - a.gain);
  return {
    grade,
    band: open ? bandOf(final) : grade,
    score: open ? final : 0,
    ownScore: own.score,
    criteria: own.criteria,
    checklist: gate.concat(unmet),
  };
}

// Character, battle map and region scores, for the rollups.
const characterScore = (world, id) => {
  const character = (world.characters || {})[id];
  return live(character) ? gradeCharacter(world, character).score : 0;
};

/**
 * Grades a place on the world map (a settlement or point of interest).
 * @returns {{ grade, band, score, ownScore, criteria, checklist: { need, for, message }[], exempt? }}
 */
function gradeLocation(world, location, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return EXEMPT;
  const settlement = (location.geo || {}).kind === 'settlement';
  const gate = location.templated
    ? []
    : location.native
      ? nativeGateItems(world, location)
      : [layerItem(layers, settlement ? 'town' : 'battleMap', world, location)];
  if (!location.templated && !location.native && !isWritten(location)) {
    gate.push(descriptionItem(location));
  }
  const kind = settlement ? 'settlement' : 'poi';
  const own = ownScore(world, kind, location, layers);
  let inside;
  // A templated place counts as Playable and no more: what its template
  // holds adds nothing; only its own content raises it (L-906; TM3).
  if (location.templated) {
    inside = [];
  } else if (settlement) {
    // What is in it: its town's places (closed ones count 0) and its people.
    inside = townPlaces(world, location.id)
      .map((place) => gradePlace(world, place, { layers }).score)
      .concat(residentIds(world, location).map((id) => characterScore(world, id)));
  } else {
    inside = placeInside(world, location, false, layers);
  }
  const keep = QUALITY.rollup[kind];
  return result(gate.filter(Boolean), own, keep * own.score + (1 - keep) * mean(inside));
}

// What is in a point of interest or a place: its own battle map, and the
// people there.
function placeInside(world, entity, isPlace, layers) {
  const map = ownMap(world, entity, layers);
  return [map ? gradeBattleMap(world, map).score : 0].concat(
    peopleAt(world, entity, isPlace).map((id) => characterScore(world, id))
  );
}

/**
 * Grades a place in town (L-342): Playable once written up and mapped; its
 * score from its criteria, its battle map and the people there.
 */
function gradePlace(world, place, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return EXEMPT;
  const gate = place.templated
    ? []
    : place.native
      ? nativeGateItems(world, place)
      : [layerItem(layers, 'battleMap', world, place)];
  if (!place.templated && !place.native && !isWritten(place)) gate.push(descriptionItem(place));
  const own = ownScore(world, 'place', place, layers);
  const keep = QUALITY.rollup.place;
  const inside = place.templated ? [] : placeInside(world, place, true, layers);
  return result(gate.filter(Boolean), own, keep * own.score + (1 - keep) * mean(inside));
}

/** Grades a realm or region: its description, lore and people. Never gated. */
function gradeDescribed(world, entity, kind = 'realm') {
  if (!isGraded(world)) return EXEMPT;
  const gate = isWritten(entity) ? [] : [descriptionItem(entity)];
  const own = ownScore(world, kind, entity, LAYER_CHECKS);
  let score = own.score;
  if (kind === 'realm') {
    const regions = Object.values(world.regions || {}).filter(
      (region) => live(region) && region.factionId === entity.id
    );
    if (regions.length) {
      const keep = QUALITY.rollup.realm;
      score =
        keep * own.score +
        (1 - keep) * mean(regions.map((region) => gradeDescribed(world, region, 'region').score));
    }
  }
  // Realms and regions are never gated: their score stands as it is.
  const graded = result(gate, own, score);
  return { ...graded, score: round1(score), band: gate.length ? graded.band : bandOf(score) };
}

/** Grades a character: never gated, scored on their own criteria. */
function gradeCharacter(world, character) {
  if (!isGraded(world)) return EXEMPT;
  const own = ownScore(world, 'character', character, LAYER_CHECKS);
  return result([], own, own.score);
}

/**
 * Grades a region map's own land (GR1; L-718): its terrain and its regions'
 * shapes. Never gated, scored on its own criteria. `world` is the world or its
 * play shape (./frames.js).
 */
function gradeRegionMap(world, map) {
  if (!isGraded(world)) return EXEMPT;
  const play = require('./frames').playWorld(world);
  const own = ownScore(play, 'regionMap', map, LAYER_CHECKS);
  return result([], own, own.score);
}

// A region map's score with the land painted on it (QUALITY.regionMap): its
// places' score, and its own criteria's.
function withLand(play, mapId, placesScore) {
  const map = (play.maps || {})[mapId];
  if (!map) return { score: placesScore, own: null };
  const own = ownScore(play, 'regionMap', { ...map, id: mapId }, LAYER_CHECKS);
  const keep = QUALITY.regionMap;
  return { score: keep.places * placesScore + keep.own * own.score, own };
}

/** Grades a battle map: never gated, scored on its own criteria. */
function gradeBattleMap(world, map) {
  if (!isGraded(world)) return EXEMPT;
  const own = ownScore(world, 'battleMap', map, LAYER_CHECKS);
  return result([], own, own.score);
}

/**
 * Grades an entity of a given kind: 'location', 'place', 'faction' (a realm),
 * 'region', 'character', 'battleMap' or 'regionMap'.
 */
function gradeEntity(world, kind, entity, options) {
  if (kind === 'location') return gradeLocation(world, entity, options);
  if (kind === 'place') return gradePlace(world, entity, options);
  if (kind === 'faction') return gradeDescribed(world, entity, 'realm');
  if (kind === 'region') return gradeDescribed(world, entity, 'region');
  if (kind === 'character') return gradeCharacter(world, entity);
  if (kind === 'battleMap') return gradeBattleMap(world, entity);
  if (kind === 'regionMap') return gradeRegionMap(world, entity);
  throw new Error(`gradeEntity: can't grade a ${kind}`);
}

/** Whether players may enter a place on the map: exempt, or Playable or better. */
function isPlayable(world, location, options) {
  return rank(gateOf(world, location, options)) >= rank('playable');
}

/** Whether players may enter a place in town. */
function isPlaceOpen(world, place, options) {
  return rank(placeGateOf(world, place, options)) >= rank('playable');
}

// The gate alone, without the score: the game asks this on every turn.
function gateOf(world, location, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return 'playable';
  // A place using a template counts as Playable (L-906; TM3).
  if (location.templated) return 'playable';
  if (location.native) return nativeGate(world, location);
  const settlement = (location.geo || {}).kind === 'settlement';
  const gate = [layerItem(layers, settlement ? 'town' : 'battleMap', world, location)];
  if (!isWritten(location)) gate.push(descriptionItem(location));
  return gradeFrom(gate.filter(Boolean));
}

function placeGateOf(world, place, { layers = LAYER_CHECKS } = {}) {
  if (!isGraded(world)) return 'playable';
  if (place.templated) return 'playable';
  if (place.native) return nativeGate(world, place);
  const gate = [layerItem(layers, 'battleMap', world, place)];
  if (!isWritten(place)) gate.push(descriptionItem(place));
  return gradeFrom(gate.filter(Boolean));
}

// The gate of a place in the levels model with no doc of today's shape
// (planning/map-levels.md LV4, MP6; L-903; ./frames.js): written, its town
// laid out if it opens one, its region map with a way in if it opens one;
// a place with no map below is stood at, so needs no layer.
function nativeGate(world, place) {
  return gradeFrom(nativeGateItems(world, place));
}

function nativeGateItems(world, place) {
  if (place.templated) return [];
  const gate = [];
  if (place.town) gate.push(layerItem(LAYER_CHECKS, 'town', world, place));
  if (place.region && !require('./frames').waysOf(world, place.region.mapId).length) {
    gate.push({ need: 'wayIn', for: 'playable', message: 'Its map has no way in.' });
  }
  if (!isWritten(place)) gate.push(descriptionItem(place));
  return gate.filter(Boolean);
}

// ── Maps at any depth (planning/map-levels.md §4.8; L-905) ─────────────

/**
 * Every map of a world graded by its kind with today's criteria, as a tree
 * from its top map: `{ mapId, kind, name, grade, band, score, lacks,
 * children }`, `lacks` the first few things its checklist asks for.
 *
 *   region  its places graded as the world map's are, their scores averaged
 *           with today's weights for nearness to play (placeWeights, in that
 *           map's own frame); a place that opens a region map counts half
 *           its own score and half that map's, so a world's score rolls up
 *           its tree, weighted toward the maps players reach (through the
 *           weight of the place that opens each). Open when any place on it is.
 *   area    as a town: the grade of the settlement it is the town of
 *   grid    as a battle map (gradeBattleMap)
 *
 * Null for a world with no maps, or one that isn't graded.
 */
function gradeMaps(world, options) {
  if (!isGraded(world)) return null;
  const frames = require('./frames');
  const play = frames.playWorld(world);
  if (!play.topMapId || !(play.maps || {})[play.topMapId]) return null;
  const lacksOf = (graded) =>
    (graded.checklist || []).slice(0, 3).map((item) => item.message || item.need);
  const seen = new Set();
  const node = (mapId, host) => {
    seen.add(mapId);
    const map = play.maps[mapId];
    // A templated place's instance counts for nothing more (TM3): left out.
    const childIds = Object.keys(play.maps)
      .filter((id) => {
        const m = play.maps[id];
        const parent = m.parent;
        return parent && parent.mapId === mapId && !seen.has(id) && !m.instanceOf && !m.template;
      })
      .sort();
    const base = { mapId, kind: map.kind, name: map.name || mapId };
    if (map.kind === 'region') {
      const view = frames.viewFor(play, mapId);
      const located = Object.values(view.locations).filter(live);
      const grades = new Map(located.map((l) => [l.id, gradeLocation(view, l, options)]));
      const children = childIds.map((id) => node(id, view.locations[play.maps[id].parent.placeId]));
      const below = new Map();
      for (const child of children) {
        const opener = play.maps[child.mapId].parent.placeId;
        if (child.kind === 'region') below.set(opener, child.score);
      }
      const weights = placeWeights(view, grades);
      let weighed = 0;
      let sum = 0;
      for (const l of located) {
        const own = grades.get(l.id).score;
        const score = below.has(l.id) ? (own + below.get(l.id)) / 2 : own;
        weighed += weights.get(l.id);
        sum += weights.get(l.id) * score;
      }
      // Its places' score, with the land painted on it (L-718).
      const land = withLand(play, mapId, weighed ? sum / weighed : 0);
      const score = round1(land.score);
      const open = [...grades.values()].some((g) => rank(g.grade) >= rank('playable'));
      const closed = located.filter((l) => rank(grades.get(l.id).grade) < rank('playable'));
      return {
        ...base,
        grade: open ? 'playable' : located.length ? 'stub' : 'unbuilt',
        band: open ? bandOf(score) : located.length ? 'stub' : 'unbuilt',
        score,
        lacks: (located.length
          ? closed.slice(0, 3).map((l) => l.name + ': ' + lacksOf(grades.get(l.id)).join(' '))
          : ['It has no places.']
        ).concat(land.own ? land.own.unmet.map((item) => item.message) : []),
        children,
      };
    }
    const children = childIds.map((id) => node(id, null));
    if (map.kind === 'grid') {
      const bm = (play.battleMaps || {})[mapId];
      const graded = bm ? gradeBattleMap(play, bm) : null;
      return {
        ...base,
        grade: graded ? graded.grade : 'unbuilt',
        band: graded ? graded.band : 'unbuilt',
        score: graded ? graded.score : 0,
        lacks: graded ? lacksOf(graded) : ['It has no layers.'],
        children,
      };
    }
    // An area map: as the town of the place that opens it.
    const graded = host
      ? gradeLocation(frames.viewFor(play, map.parent.mapId), host, options)
      : null;
    return {
      ...base,
      grade: graded ? graded.grade : 'unbuilt',
      band: graded ? graded.band : 'unbuilt',
      score: graded ? graded.score : 0,
      lacks: graded ? lacksOf(graded) : [],
      children,
    };
  };
  return node(play.topMapId, null);
}

/**
 * How much each place on the map counts toward the world's score (§4.4): the
 * start, open places and the frontier next to them 3; places within two
 * travel steps beyond 1; the rest 0.25.
 */
function placeWeights(world, grades) {
  const { play, near, far, nearHops } = QUALITY.nearness;
  const places = Object.values(world.locations || {}).filter(live);
  const isOpen = (id) => grades.has(id) && rank(grades.get(id).grade) >= rank('playable');
  const start = (world.rules || {}).startingLocationId;
  const hops = new Map();
  let ring = [];
  for (const place of places) {
    if (place.id === start || isOpen(place.id)) {
      hops.set(place.id, 0);
      ring.push(place);
    }
  }
  // The frontier: closed places next to an open one.
  for (const place of ring.slice()) {
    for (const id of place.connections || []) {
      const next = world.locations[id];
      if (live(next) && !hops.has(id)) {
        hops.set(id, 0);
        ring.push(next);
      }
    }
  }
  for (let step = 1; step <= nearHops && ring.length; step += 1) {
    const next = [];
    for (const place of ring) {
      for (const id of place.connections || []) {
        const other = world.locations[id];
        if (live(other) && !hops.has(id)) {
          hops.set(id, step);
          next.push(other);
        }
      }
    }
    ring = next;
  }
  return new Map(
    places.map((place) => [
      place.id,
      !hops.has(place.id) ? far : hops.get(place.id) === 0 ? play : near,
    ])
  );
}

const tally = () => ({ unbuilt: 0, stub: 0, playable: 0, rich: 0, vivid: 0, legendary: 0 });
const isOpenBand = (band) => bandRank(band) >= bandRank('playable');

/**
 * How built a world is: live places, places in town, realms, regions,
 * characters and battle maps counted by band; `places.open` is the share of
 * map places players may enter. The world's score (§4.4) is 80% its places,
 * weighted by nearness to play, and 20% its own criteria.
 */
function gradeWorld(world, options) {
  if (!isGraded(world)) return { graded: false };
  // Its top map's places, as play sees them (L-905; ./frames.js): today's
  // locations, and places in the new shape on it.
  const frames = require('./frames');
  const play = frames.playWorld(world);
  const top = play.topMapId && play.maps && play.maps[play.topMapId] ? play.topMapId : null;
  const seen = top ? frames.viewFor(play, top) : world;
  const located = Object.values(seen.locations || {}).filter(live);
  const grades = new Map(located.map((l) => [l.id, gradeLocation(seen, l, options)]));
  const places = { total: 0, ...tally(), settlements: tally(), pointsOfInterest: tally() };
  for (const location of located) {
    const { band } = grades.get(location.id);
    places.total += 1;
    places[band] += 1;
    const kind = (location.geo || {}).kind === 'settlement' ? 'settlements' : 'pointsOfInterest';
    places[kind][band] += 1;
  }
  const open = BANDS.filter(isOpenBand).reduce((n, band) => n + places[band], 0);
  places.open = places.total ? Math.round((open / places.total) * 1000) / 1000 : 0;

  const inTown = { total: 0, ...tally() };
  for (const place of Object.values(world.places || {}).filter(live)) {
    inTown.total += 1;
    inTown[gradePlace(world, place, options).band] += 1;
  }

  const byBand = (entities, grade) => {
    const counts = tally();
    for (const entity of entities.filter(live)) counts[grade(entity).band] += 1;
    return counts;
  };

  const weights = placeWeights(seen, grades);
  let weighed = 0;
  let sum = 0;
  for (const location of located) {
    const weight = weights.get(location.id);
    weighed += weight;
    sum += weight * grades.get(location.id).score;
  }
  const own = ownScore(world, 'world', world, LAYER_CHECKS);
  // With region maps below the top (L-905), its places' score rolls up the
  // tree (gradeMaps); a world without them scores as before.
  const deeper =
    top &&
    Object.entries(play.maps).some(([id, m]) => id !== top && m.kind === 'region' && m.parent);
  const tree = deeper ? gradeMaps(world, options) : null;
  // Without region maps below the top, the top map's places, with the land
  // painted on it (L-718).
  const placesScore = tree
    ? tree.score
    : top
      ? withLand(play, top, weighed ? sum / weighed : 0).score
      : weighed
        ? sum / weighed
        : 0;
  const score = round1(QUALITY.world.places * placesScore + QUALITY.world.own * own.score);
  return {
    graded: true,
    rubricVersion: RUBRIC_VERSION,
    score,
    band: bandOf(score),
    placesScore: round1(placesScore),
    ownScore: own.score,
    criteria: own.criteria,
    checklist: own.unmet.sort((a, b) => b.gain - a.gain),
    places,
    inTown,
    factions: byBand(Object.values(world.factions), (e) => gradeDescribed(world, e, 'realm')),
    regions: byBand(Object.values(world.regions || {}), (e) => gradeDescribed(world, e, 'region')),
    characters: byBand(Object.values(world.characters || {}), (e) => gradeCharacter(world, e)),
    battleMaps: byBand(Object.values(world.battleMaps || {}), (e) => gradeBattleMap(world, e)),
  };
}

module.exports = {
  RUBRIC_VERSION,
  GRADES,
  BANDS,
  BAND_FROM,
  WEIGHTS,
  QUALITY,
  CRITERIA,
  LAYER_CHECKS,
  isGraded,
  isWritten,
  SIZE_TIERS,
  gradeLocation,
  gradePlace,
  gradeCharacter,
  gradeBattleMap,
  gradeRegionMap,
  gradeEntity,
  gradeWorld,
  gradeMaps,
  placeWeights,
  isPlayable,
  isPlaceOpen,
  sizeTier,
  settlementProgress,
  bandOf,
  rank,
  bandRank,
  wordsIn,
};
