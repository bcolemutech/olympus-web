'use strict';

const { z } = require('zod');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const { normalizeName } = require('../../../loom-turn/interpret');
const { worldId, entityId, systemId, challenge, triggers } = require('./schemas');
const { SOURCES } = require('../../../cartographer/sources');
const { isPlayable } = require('../../../loom-canon/grading');
const town = require('../../../loom-canon/town');
const maps = require('../../../loom-canon/maps');
const positions = require('../../../loom-canon/positions');
const layers = require('../../../loom-canon/layers');
const ground = require('../../../loom-canon/ground');
const { whyClosed } = require('../../../cartographer/service');
const { validateSheet } = require('../../../loom-canon/sheets');
const { systemOf } = require('../../../loom-canon/checks');

// The Cartographer's MCP write tools (design planning/the-cartographer-
// design.md §4.1, §4.2; C-7 / #374): Claude adds to, fixes and changes worlds,
// drafts and published alike, and publishes them.
//
// Every edit goes through writer.edit(), which validates against the world
// and commits in a transaction that bumps canonVersion (see writer.js), so a
// change reaches every game on its next turn. The rules each edit keeps:
//
//   - Ids exist. New links, realms, homes and lore subjects must be live
//     (not retired).
//   - Names players use — places, realms, characters — stay unique among the
//     live ones, compared the way the Loom matches names.
//   - Connections stay symmetric: both ends list each other, with the same
//     road, trail or sea link.
//   - Realm relations stay symmetric (vassal ↔ suzerain mirror each other).
//   - A character's home and the cast lists (npcIds) the Loom reads agree.
//   - Every character has a position (L-680; loom-canon/positions.js): a
//     square on their place's map (on nothing that blocks, on no entry or
//     exit, nobody else's), a town point, or a world point in the
//     wilderness. Adding someone, or changing where they are, needs a valid
//     one; a refusal suggests a default.
//   - A description set here is stamped `sources.description: 'mcp'`, which is
//     what grading counts as written up (functions/loom-canon/grading.js).
//     Sending the current text again stamps it too: an approval of it.
//   - Published worlds never lose anything: removal is `retired: true`, so a
//     save that references it keeps working. Drafts delete, and every
//     reference to what was deleted is cleaned up.

const MAX_NAME = 100;
const MAX_DESCRIPTION = 4000;
const MAX_TAGLINE = 200;
const MAX_HOOK = 2000;
const MAX_TITLE = 200;
const MAX_TEXT = 8000;
const MAX_ABILITY = 60;
const MAX_REFS = 20;
const MAX_FACTIONS = 10;
const MAX_RELATIONS = 50;
const LINKS = ['road', 'trail', 'sea'];
const RELATIONS = [
  'ally',
  'friendly',
  'neutral',
  'suspicion',
  'enemy',
  'rival',
  'vassal',
  'suzerain',
  'unknown',
];
const INVERSE_RELATION = { vassal: 'suzerain', suzerain: 'vassal' };
const DISPOSITIONS = ['friendly', 'neutral', 'hostile'];
// A character's side in a fight (L-821; planning/combat.md EN1), and how
// they fight (L-824).
const SIDES = ['party', 'hostile', 'neutral', 'wary'];
const wary = require('../../../loom-modules/combat/wary');
const { sheetFields, blockRef, overrides } = require('./stat-block-tools');
const figureRules = require('../../../loom-modules/combat/figures');
const { ROLES, POSTURES } = figureRules;
const COLLECTION = {
  location: 'locations',
  faction: 'factions',
  region: 'regions',
  character: 'characters',
  lore: 'lore',
  place: 'places',
  battleMap: 'battleMaps',
};
const HINT = {
  location: 'Use find_locations to look one up.',
  faction: 'Use get_world to see realms.',
  region: 'Use get_world to see regions.',
  character: 'Use get_world to see characters.',
  lore: 'Use get_world to see lore.',
  place: 'Use get_town to see a town’s places.',
  battleMap: 'Use list_battle_maps to see them.',
};
const UNREACHABLE_SHOWN = 5;
// Worlds from scratch (L-391): the backdrop's default size, in map units (as
// an Azgaar world's), and how many locations or links one call may add.
const DEFAULT_MAP = Object.freeze({ width: 1600, height: 1200 });
const MIN_MAP = 100;
const MAX_MAP = 10000;
const MAX_NEW_LOCATIONS = 50;
const MAX_LINKS = 100;
const COLOUR = /^#[0-9a-fA-F]{6}$/;
const SLICE_NOTE =
  'The first slice of worlds without Azgaar (L-710): the brief, realms, regions, waypoints ' +
  'and map units come later.';

const text = (max, what) =>
  z
    .string()
    .trim()
    .min(1, `${what} must not be empty`)
    .max(max, `${what} must be ${max} characters or fewer`);
const name = text(MAX_NAME, 'name');

// ── Validation against the loaded world ───────────────────────────────

const labelOf = (entity) => entity.name || entity.title || entity.id;

function existing(world, kind, id) {
  const entity = (world[COLLECTION[kind]] || {})[id];
  if (!entity) throw new ToolError(`No ${kind} "${id}" in this world. ${HINT[kind]}`);
  return entity;
}

function live(world, kind, id) {
  const entity = existing(world, kind, id);
  if (entity.retired) {
    throw new ToolError(`The ${kind} "${labelOf(entity)}" (${id}) has been retired.`);
  }
  return entity;
}

// The kind of an entity id that lore can be about, or null: places in town
// too (L-691), whose score asks for lore about them.
function subjectKind(world, id) {
  return ['location', 'place', 'faction', 'region', 'character'].find((kind) =>
    Boolean((world[COLLECTION[kind]] || {})[id])
  );
}

function liveSubjects(world, ids) {
  return [...new Set(ids)].map((id) => {
    const kind = subjectKind(world, id);
    if (!kind) {
      throw new ToolError(
        `No place, place in town, realm, region or character "${id}" in this world.`
      );
    }
    const entity = live(world, kind, id);
    return { id, type: kind, name: entity.name };
  });
}

// Players name places, realms and characters to act on them, so a name must
// pick out one live entity the way the Loom matches names.
function checkName(world, wanted, selfId) {
  const key = normalizeName(wanted);
  if (!key) throw new ToolError('A name needs at least one letter or digit.');
  for (const kind of ['location', 'faction', 'character']) {
    for (const entity of Object.values(world[COLLECTION[kind]] || {})) {
      if (entity.id !== selfId && !entity.retired && normalizeName(entity.name) === key) {
        throw new ToolError(
          `The ${kind} "${entity.name}" (${entity.id}) already has that name. Names must be ` +
            'unique in a world so players can refer to them.'
        );
      }
    }
  }
  return wanted;
}

// A readable id that has never been used in this world: chr_mara-quill.
function newId(world, kind, prefix, label) {
  const slug = normalizeName(label).slice(0, 40).replace(/-+$/, '') || kind;
  const base = `${prefix}_${slug}`;
  let id = base;
  for (let n = 2; world[COLLECTION[kind]][id]; n += 1) id = `${base}-${n}`;
  return id;
}

function reachableFrom(world, origin, { cut, removed } = {}) {
  const isCut = (a, b) => cut && ((a === cut[0] && b === cut[1]) || (a === cut[1] && b === cut[0]));
  const seen = new Set([origin]);
  const queue = [origin];
  while (queue.length) {
    const id = queue.shift();
    for (const next of world.locations[id].connections || []) {
      const place = world.locations[next];
      if (!place || place.retired || next === removed || seen.has(next) || isCut(id, next)) {
        continue;
      }
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

// Places that a change would newly cut off from the starting location (or,
// without one, from `fallbackOrigin`), as warnings for Claude to act on.
function reachWarnings(world, change, fallbackOrigin) {
  const start = (world.rules || {}).startingLocationId;
  const usable = (id) => id && world.locations[id] && !world.locations[id].retired;
  const origin = usable(start) && start !== change.removed ? start : fallbackOrigin;
  if (!usable(origin) || origin === change.removed) return [];
  const before = reachableFrom(world, origin);
  const after = reachableFrom(world, origin, change);
  const lost = [...before].filter((id) => id !== change.removed && !after.has(id));
  if (!lost.length) return [];
  const names = lost
    .slice(0, UNREACHABLE_SHOWN)
    .map((id) => `${world.locations[id].name} (${id})`)
    .join(', ');
  const more =
    lost.length > UNREACHABLE_SHOWN ? `, and ${lost.length - UNREACHABLE_SHOWN} more` : '';
  return [
    `${lost.length} place(s) can no longer be reached from ${world.locations[origin].name}: ` +
      `${names}${more}. Connect them with connect_locations if that wasn't intended.`,
  ];
}

// Groups field changes per document, so each document gets one update.
function patcher(e) {
  const docs = new Map();
  const patch = (kind, id, field, value) => {
    const key = `${COLLECTION[kind]}/${id}`;
    if (!docs.has(key)) docs.set(key, { kind, id, pairs: [] });
    docs.get(key).pairs.push(field, value);
  };
  patch.commit = () => {
    for (const { kind, id, pairs } of docs.values()) {
      e.update(e.ref(COLLECTION[kind], id), ...pairs);
    }
    return docs.size;
  };
  return patch;
}

const link = (id) => new FieldPath('geo', 'links', id);
const relation = (id) => new FieldPath('politics', 'relations', id);

// A description set over MCP: the new text if it changed, and the 'mcp' stamp
// whenever it isn't stamped so already (re-sending the text approves it).
function describe(entity, description) {
  const changes = {};
  if (description === undefined) return changes;
  if (description !== entity.description) changes.description = description;
  if (changes.description !== undefined || (entity.sources || {}).description !== SOURCES.MCP) {
    changes['sources.description'] = SOURCES.MCP;
  }
  return changes;
}

const changedFields = (fields) => [
  ...new Set(Object.keys(fields).map((f) => (f === 'sources.description' ? 'description' : f))),
];

// A live place of a settlement's town (L-343).
function placeIn(world, settlement, placeId) {
  const place = live(world, 'place', placeId);
  if (!settlement || place.locationId !== settlement.id) {
    throw new ToolError(
      `${place.name} (${place.id}) is not in ${settlement ? settlement.name : 'that town'}.`
    );
  }
  return place;
}

// The town's layout report as it will be after a change (L-343).
function layoutAfter(world, settlement, { set = {}, remove = [] } = {}) {
  const places = { ...(world.places || {}) };
  for (const id of remove) delete places[id];
  Object.assign(places, set);
  return town.layoutReport({ ...world, places }, settlement);
}

// In a town with ground (L-653), a change to its places mustn't add a
// ground problem: a door off open ground, a place nobody can walk to. Any it
// had already are left to set_town_ground and the places' own fixes.
function keepsGround(world, settlement, { set = {}, remove = [] } = {}) {
  if (!settlement || !ground.hasGround(settlement)) return;
  const before = new Set(ground.check(world, settlement));
  const places = { ...(world.places || {}) };
  for (const id of remove) delete places[id];
  Object.assign(places, set);
  const added = ground.check({ ...world, places }, settlement).filter((p) => !before.has(p));
  if (added.length) {
    throw new ToolError(
      `${settlement.name}'s town has ground (set_town_ground), so its doors must be on open ` +
        'ground and walkable from a way in. ' +
        added.join(' ')
    );
  }
}

// A town with places keeps at least one way in and out (L-343).
function keepsAWayIn(world, place, { removing = false, entranceAfter = null } = {}) {
  const others = town.placesOf(world, place.locationId).filter((p) => p.id !== place.id);
  const stillAnEntrance = !removing && entranceAfter !== false && town.isEntrance(place);
  if (!town.isEntrance(place) || stillAnEntrance || !others.length) return;
  if (others.some(town.isEntrance)) return;
  throw new ToolError(
    `${place.name} is the town's only way in and out. Make another place a way in ` +
      '(update_place with entranceFor) first.'
  );
}

// A character's square (L-641): { x, y }, or a feature of the map.
const square = z
  .union([
    z.strictObject({
      x: z
        .number()
        .int()
        .min(0)
        .max(maps.MAX_SIDE - 1),
      y: z
        .number()
        .int()
        .min(0)
        .max(maps.MAX_SIDE - 1),
      nearest: z
        .boolean()
        .optional()
        .describe('true: the nearest open square to this one, if it is taken (L-394).'),
    }),
    z.strictObject({
      feature: z.string().trim().min(1).max(60).describe('A feature’s id or name: "bar".'),
    }),
    z.literal('auto').describe('The nearest open square to the map’s entry (L-394).'),
  ])
  .describe(
    'Where they stand on the battle map of the place they are found at: { x, y } (0-based from ' +
      'the top-left; nearest: true takes the nearest open square to it), { feature } to stand ' +
      'at it, or at the nearest open square to it, or "auto", the nearest open square to the ' +
      'entry. Not on a wall, an obstacle, an entry or an exit, and one character a square; a ' +
      'refusal names the nearest open square.'
  );

// A town point (L-682): in the settlement's 0–1000 square.
const townPoint = z
  .strictObject({
    x: z.number().min(0).max(positions.TOWN_SIDE),
    y: z.number().min(0).max(positions.TOWN_SIDE),
  })
  .describe(
    'Where they are about a settlement, in its town’s 0–1000 square (as places’ positions): ' +
      'for someone in town but not at a place with a battle map.'
  );
// A world point (L-682): in the world map's own units, for the wilderness.
const worldPoint = z
  .strictObject({ x: z.number().min(0), y: z.number().min(0) })
  .describe(
    'Where they are in the wilderness, in the world map’s units (as locations’ geo x, y): ' +
      'for someone in no settlement or point of interest (no locationId).'
  );
const POSITIONS = positions.FIELDS;

const NEIGHBOURS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

// Where a character asked to stand at a place stands: { map, cell, warning }.
// A feature gives its own square, else the nearest free one beside it with
// no wall or door between them, else the nearest open one (L-394); "auto"
// the nearest open square to the entry; { x, y, nearest } the nearest to
// that square. A refusal names the nearest open square.
function squareFor(world, host, spec, selfId) {
  const map = maps.mapOf(world, host);
  if (!map) {
    throw new ToolError(
      `${host.name} has no battle map, so there is no square to stand on. Give it one with ` +
        'assign_battle_map, or leave out cell.'
    );
  }
  const nearest = (from) => maps.nearestFree(world, map, host, from, { selfId });
  const named = (c) => (c ? ` The nearest open square is (${c.x}, ${c.y}).` : '');
  let cell;
  if (spec === 'auto') {
    cell = nearest(null);
    if (!cell) throw new ToolError(`Every square of ${map.name} is blocked or taken.`);
  } else if (spec.feature === undefined) {
    const problem = maps.squareProblem(world, map, host, spec, selfId);
    if (problem && spec.nearest && maps.inBounds(map, spec)) {
      cell = nearest(spec);
      if (!cell) throw new ToolError(`Every square of ${map.name} is blocked or taken.`);
    } else if (problem) {
      const near = maps.inBounds(map, spec) ? nearest(spec) : null;
      throw new ToolError(`They can't stand there: ${problem}.${named(near)}`);
    } else cell = { x: spec.x, y: spec.y };
  } else {
    const wanted = spec.feature.toLowerCase();
    const feature = (map.features || []).find(
      (f) => f.id === spec.feature || f.name.toLowerCase() === wanted
    );
    if (!feature) {
      throw new ToolError(
        `${map.name} has no feature "${spec.feature}". get_battle_map lists its features.`
      );
    }
    const beside = NEIGHBOURS.map(([dx, dy]) => ({ x: feature.x + dx, y: feature.y + dy })).filter(
      (c) => {
        if (!maps.inBounds(map, c)) return false;
        const edge = layers.between(map, c, feature);
        return !edge.wall && !edge.door;
      }
    );
    cell =
      [{ x: feature.x, y: feature.y }, ...beside].find(
        (c) => !maps.squareProblem(world, map, host, c, selfId)
      ) || nearest(feature);
    if (!cell) {
      throw new ToolError(`Every square at and beside ${feature.name} is blocked or taken.`);
    }
  }
  return { map, cell, warning: reachWarning(map, cell, `(${cell.x}, ${cell.y})`) };
}

// Whether a square can be walked to from an entry (L-394): a warning when
// it can only through a locked door, or not at all.
function reachWarning(map, cell, what) {
  const key = `${cell.x},${cell.y}`;
  if (layers.reachable(map, map.entries || [])[key]) return null;
  if (layers.reachable(map, map.entries || [], () => true)[key]) {
    return `${what} on ${map.name} is behind a locked door: only someone who opens it gets there.`;
  }
  return `Nobody can reach ${what} from an entry of ${map.name}: it's walled in.`;
}

// The suggestion a refusal offers (L-682): a default position there.
function suggestion(world, at) {
  const fallback = positions.defaultPosition(world, at);
  const [field, point] = Object.entries(fallback || {})[0] || [];
  return field ? ` For example ${field}: { x: ${point.x}, y: ${point.y} }.` : '';
}

// The position a character will have where `at` (the character as they will
// be, without a position) is found, from the cell, townPoint or worldPoint
// given in `args` (at most one; none at a point of interest without a map),
// checked by loom-canon/positions.js. Returns { fields, warning, view }.
function positionFor(world, at, args) {
  const given = POSITIONS.filter((field) => args[field] != null);
  if (given.length > 1) {
    throw new ToolError(`Give one position, not both ${given.join(' and ')}.`);
  }
  const fields = {};
  let warning = null;
  if (given[0] === 'cell') {
    const host = maps.characterHost(world, at);
    if (host && maps.mapOf(world, host)) {
      const stand = squareFor(world, host, args.cell, at.id);
      fields.cell = stand.cell;
      warning = stand.warning;
    } else if (args.cell === 'auto' || args.cell.nearest !== undefined) {
      throw new ToolError(
        `${host ? host.name : 'Where they are'} has no battle map, so there is no square to ` +
          'find: give it one with assign_battle_map, or leave out cell.'
      );
    } else {
      fields.cell = args.cell; // the wrong level: positionOf says so
    }
  } else if (given.length) {
    fields[given[0]] = { x: args[given[0]].x, y: args[given[0]].y };
  }
  const placed = { ...at, ...fields };
  const position = positions.positionOf(world, placed);
  if (position.problem) {
    throw new ToolError(
      `${at.name} needs a position: ${position.problem}.${suggestion(world, at)}`
    );
  }
  return { fields, warning, view: positions.positionView(world, placed) };
}

// A character as they are found, without their position.
const unplaced = (character) => {
  const rest = { ...character };
  for (const field of POSITIONS) delete rest[field];
  return rest;
};

function requireSome(args, fields) {
  if (!fields.some((field) => args[field] !== undefined)) {
    throw new ToolError(`Nothing to change: give at least one of ${fields.join(', ')}.`);
  }
}

// ── Draft deletions: an entity and every reference to it ─────────────

function deleteFromDraft(e, kind, entity) {
  const { world } = e;
  const id = entity.id;
  const patch = patcher(e);
  const locations = Object.values(world.locations);

  for (const entry of Object.values(world.lore || {})) {
    if ((entry.entityRefs || []).includes(id)) {
      patch('lore', entry.id, 'entityRefs', FieldValue.arrayRemove(id));
    }
  }

  if (kind === 'location') {
    const inTown = town.placesOf(world, id);
    if (inTown.length) {
      throw new ToolError(
        `It has a town of ${inTown.length} place(s). Remove them with retire_entity ` +
          '(type place) first.'
      );
    }
    const residents = Object.values(world.characters || {}).filter((c) => c.locationId === id);
    if (residents.length) {
      throw new ToolError(
        `Characters live here: ${residents.map((c) => `${c.name} (${c.id})`).join(', ')}. ` +
          'Move them with update_character or remove them first.'
      );
    }
    for (const place of locations) {
      if (place.id !== id && (place.connections || []).includes(id)) {
        patch('location', place.id, 'connections', FieldValue.arrayRemove(id));
        patch('location', place.id, link(id), FieldValue.delete());
      }
    }
    for (const region of Object.values(world.regions || {})) {
      if ((region.locationIds || []).includes(id)) {
        patch('region', region.id, 'locationIds', FieldValue.arrayRemove(id));
      }
      if (region.capitalLocationId === id) patch('region', region.id, 'capitalLocationId', null);
    }
    for (const faction of Object.values(world.factions)) {
      if ((faction.politics || {}).capitalLocationId === id) {
        patch('faction', faction.id, new FieldPath('politics', 'capitalLocationId'), null);
      }
    }
    if ((world.rules || {}).startingLocationId === id) {
      e.updateWorld({ 'rules.startingLocationId': FieldValue.delete() });
    }
  }

  if (kind === 'faction') {
    for (const place of locations) {
      if ((place.factionIds || []).includes(id)) {
        patch('location', place.id, 'factionIds', FieldValue.arrayRemove(id));
      }
      if ((place.rules || {}).hostileToFactionId === id) {
        patch('location', place.id, 'rules.hostileToFactionId', FieldValue.delete());
      }
    }
    for (const region of Object.values(world.regions || {})) {
      if (region.factionId === id) patch('region', region.id, 'factionId', null);
    }
    for (const character of Object.values(world.characters || {})) {
      if (character.factionId === id) {
        patch('character', character.id, 'factionId', FieldValue.delete());
      }
    }
    for (const other of Object.values(world.factions)) {
      if (other.id !== id && ((other.politics || {}).relations || {})[id]) {
        patch('faction', other.id, relation(id), FieldValue.delete());
      }
    }
  }

  if (kind === 'place') {
    const here = Object.values(world.characters || {}).filter((c) => c.placeId === id);
    if (here.length) {
      throw new ToolError(
        `Characters are found here: ${here.map((c) => `${c.name} (${c.id})`).join(', ')}. ` +
          'Move them with update_character first.'
      );
    }
    for (const other of Object.values(world.places || {})) {
      if (other.id !== id && (other.connections || []).includes(id)) {
        patch('place', other.id, 'connections', FieldValue.arrayRemove(id));
      }
    }
  }

  if (kind === 'character') {
    for (const place of locations) {
      if ((place.npcIds || []).includes(id) || place.id === entity.locationId) {
        patch('location', place.id, 'npcIds', FieldValue.arrayRemove(id));
      }
    }
  }

  const references = patch.commit();
  e.remove(e.ref(COLLECTION[kind], id));
  return references;
}

// ── The tools ──────────────────────────────────────────────────────────

// A character's challenge and triggers (L-392), checked against the world's
// system and the map where they stand (`at`: their place), or refused.
function checkWary(world, at, args) {
  if (args.challenge == null && args.triggers == null) return;
  const host = at.placeId
    ? (world.places || {})[at.placeId]
    : at.locationId
      ? world.locations[at.locationId]
      : null;
  const map = host ? maps.mapOf(world, host) : null;
  const errors = wary.validateAgainst(systemOf(world), map, {
    challenge: args.challenge || undefined,
    triggers: args.triggers || undefined,
  });
  if (errors.length) throw new ToolError(errors.join(' '));
}

function writeTools({ writer, systems, studio }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
  const removing = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
  const editNote =
    'Works on drafts and published worlds; a change to a published world reaches games on ' +
    'their next turn.';
  const sideNote =
    'Their side in a fight (L-821): hostile starts one when the player comes into sight of ' +
    'them on a battle map; party fights beside the player; neutral (the default) stays out ' +
    'unless attacked; wary (L-392) challenges first (challenge: what they say, and the check ' +
    'that answers it) and turns hostile when attacked, when that check fails, or by a trigger ' +
    '(triggers: [{ on, target?, then }]).';

  return [
    {
      name: 'create_world',
      title: 'Create world',
      description:
        'Start a new draft world from scratch, with no Azgaar map: a name, its game system ' +
        '(systemId, from list_systems; the built-in d20 Fantasy when omitted) and a backdrop ' +
        'for the world map, a plain colour or a studio image (imageId, of kind worldMap). The ' +
        'map is width × height map units (default 1600 × 1200, the size of an imported map); ' +
        'milesPerUnit sets how far one unit is (default 3), so route lengths and travel time ' +
        'come from distance as in any world. Then add places with add_locations, link them ' +
        'with connect_locations (links: many in one call), open towns with add_place, and ' +
        'publish with publish_world. ' +
        SLICE_NOTE,
      inputSchema: {
        name,
        systemId: systemId.optional().describe('The game system it plays by, from list_systems.'),
        backdrop: z
          .union([
            z.strictObject({
              colour: z
                .string()
                .regex(COLOUR, 'colour must be #rrggbb')
                .describe('A plain colour, #rrggbb.'),
            }),
            z.strictObject({
              imageId: z
                .string()
                .trim()
                .min(1)
                .max(80)
                .describe('A worldMap image, from studio_find.'),
            }),
          ])
          .optional()
          .describe('The world map’s backdrop (default a plain dark green, #26332a).'),
        width: z.number().int().min(MIN_MAP).max(MAX_MAP).optional().describe('Map units across.'),
        height: z.number().int().min(MIN_MAP).max(MAX_MAP).optional().describe('Map units down.'),
        milesPerUnit: z
          .number()
          .positive()
          .max(1000)
          .optional()
          .describe('Miles per map unit (default 3).'),
      },
      annotations: additive,
      handler: async (ctx, args) => {
        const system = args.systemId ? systems && (await systems.get(args.systemId)) : null;
        if (args.systemId && !system) {
          throw new ToolError(`No system "${args.systemId}". list_systems shows them.`);
        }
        const backdrop = args.backdrop || { colour: '#26332a' };
        if (backdrop.imageId && !studio) {
          throw new ToolError('The image studio isn’t available here; give a colour instead.');
        }
        const map = {
          width: args.width || DEFAULT_MAP.width,
          height: args.height || DEFAULT_MAP.height,
          imagePath: null,
          backdrop: backdrop.colour || '#26332a',
          ...(args.milesPerUnit ? { distance: { unit: 'mi', perMapUnit: args.milesPerUnit } } : {}),
        };
        const { worldId: id } = await writer.create(ctx.uid, {
          name: args.name,
          systemId: system ? system.id : null,
          map,
        });
        // A studio image as its art, the way studio_assign sets a world's map.
        let image = null;
        if (backdrop.imageId) {
          try {
            const assigned = await studio.assign(ctx.uid, {
              worldId: id,
              target: 'map',
              imageId: backdrop.imageId,
            });
            image = {
              imageId: backdrop.imageId,
              ...(assigned.warnings ? { warnings: assigned.warnings } : {}),
            };
          } catch (err) {
            // The world stands; the art can be set again with studio_assign.
            return {
              worldId: id,
              name: args.name,
              warnings: [
                `The world was made, but its image wasn't set: ${err.message} Try studio_assign.`,
              ],
            };
          }
        }
        return {
          worldId: id,
          name: args.name,
          status: 'draft',
          ...(system ? { system: { id: system.id, name: system.name } } : {}),
          map: { width: map.width, height: map.height, backdrop: image || map.backdrop },
          next: 'Add places with add_locations, then link them with connect_locations.',
        };
      },
    },
    {
      name: 'update_world',
      title: 'Update world',
      description:
        'Change a world’s name, tagline, opening hook (the scene every new game opens with), ' +
        'starting location (where new games begin) or game system (systemId, from ' +
        'list_systems: the rules every game in it plays by, at the system’s latest version), ' +
        'or a premade character (startingSheet: every new game starts with this sheet and ' +
        'skips making a character; null removes it), or death (on: a character with no one ' +
        'to help dies; off: they come round captured, robbed or rescued; null: the system’s ' +
        'default). Fields you omit are left unchanged. ' +
        editNote,
      inputSchema: {
        worldId,
        name: name.optional().describe('New world name.'),
        tagline: z
          .string()
          .trim()
          .max(MAX_TAGLINE)
          .optional()
          .describe('New one-line tagline ("" clears it).'),
        openingHook: text(MAX_HOOK, 'openingHook').optional().describe('New opening hook.'),
        startingLocationId: entityId('location', 'find_locations')
          .optional()
          .describe('Where new games begin.'),
        systemId: systemId.optional().describe('The game system it plays by, from list_systems.'),
        startingSheet: z
          .object({})
          .passthrough()
          .nullable()
          .optional()
          .describe(
            'A premade character’s sheet for every new game (L-812): { attributes: { [id]: ' +
              'score }, skills: { [id]: rank }, resources: { [id]: { current } }, level, ' +
              'traits: [id], conditions: [] }, checked against the world’s system. Speed is ' +
              'worked out by the system. null removes it.'
          ),
        death: z
          .enum(['on', 'off'])
          .nullable()
          .optional()
          .describe(
            'Whether a character down with no one to help dies (L-827): on, the save ends ' +
              'with an epilogue; off, they come round captured, robbed or rescued. null: the ' +
              'system’s default (on in d20 Fantasy, off in Dice-pool Sci-fi).'
          ),
      },
      annotations: replacing,
      handler: async (ctx, args) => {
        requireSome(args, [
          'name',
          'tagline',
          'openingHook',
          'startingLocationId',
          'systemId',
          'startingSheet',
          'death',
        ]);
        // The system must exist (L-801), read before the edit's transaction.
        const system =
          args.systemId === undefined ? null : systems && (await systems.get(args.systemId));
        if (args.systemId !== undefined && !system) {
          throw new ToolError(`No system "${args.systemId}". list_systems shows them.`);
        }
        return edit(ctx, args, (e) => {
          const { world } = e;
          const fields = {};
          if (args.name !== undefined && args.name !== world.name) fields.name = args.name;
          if (args.tagline !== undefined && args.tagline !== (world.tagline || '')) {
            fields.tagline = args.tagline;
          }
          if (args.openingHook !== undefined && args.openingHook !== world.openingHook) {
            fields.openingHook = args.openingHook;
          }
          const start = args.startingLocationId;
          const warnings = [];
          if (start !== undefined) {
            live(world, 'location', start);
            if (start !== (world.rules || {}).startingLocationId) {
              fields['rules.startingLocationId'] = start;
            }
            // New games begin here, and players can only enter Playable places.
            if (!isPlayable(world, world.locations[start])) {
              warnings.push(
                `The start isn't open to players yet (${whyClosed(world, start)}). ` +
                  (world.status === 'published'
                    ? "New games can't begin until it is open; get_location lists what it needs."
                    : 'Open it before publishing; get_location lists what it needs.')
              );
            }
          }
          if (system && system.id !== world.systemId) fields.systemId = system.id;
          // A premade character (L-812), checked against the system it will play by.
          if (args.startingSheet === null) {
            if ((world.rules || {}).startingSheet) {
              fields['rules.startingSheet'] = FieldValue.delete();
            }
          } else if (args.startingSheet !== undefined) {
            const sheet = { ...args.startingSheet };
            delete sheet.speed; // worked out by the system (L-811; its pool, L-832)
            delete sheet.ap;
            const problems = validateSheet(system || systemOf(world), sheet);
            if (problems.length) {
              throw new ToolError(
                'The starting sheet doesn’t fit the world’s rules:\n- ' + problems.join('\n- ')
              );
            }
            fields['rules.startingSheet'] = sheet;
          }
          // Its death setting (L-827).
          const death = (world.rules || {}).death;
          if (args.death === null && death !== undefined) {
            fields['rules.death'] = FieldValue.delete();
          } else if (args.death && args.death !== death) fields['rules.death'] = args.death;
          if (Object.keys(fields).length) e.updateWorld(fields);
          return {
            updated: Object.keys(fields).map((f) => f.replace('rules.', '')),
            world: {
              name: fields.name || world.name,
              ...(system ? { system: { id: system.id, name: system.name } } : {}),
              ...(start
                ? { startingLocation: { id: start, name: world.locations[start].name } }
                : {}),
            },
            ...(warnings.length ? { warnings } : {}),
          };
        });
      },
    },
    {
      name: 'update_location',
      title: 'Update location',
      description:
        'Change a place’s name, description, the realms present there (factionIds, replacing ' +
        'the list), or its rules: requiresAbility (an ability a traveller needs to get in) and ' +
        'hostileToFactionId. A rule set to null is removed. Names stay unique in the world. ' +
        'Setting a description, even the current text, marks the place as written up. For a ' +
        'settlement, townSize sets how many metres its town’s 0–1000 square spans (null goes ' +
        'back to the default for its size: village 300, town 600, city 1200, great city 2500; ' +
        'a capital one size larger); get_town shows it. danger (none, low, high) says how ' +
        'dangerous it is. ' +
        editNote,
      inputSchema: {
        worldId,
        locationId: entityId('location', 'find_locations'),
        name: name.optional().describe('New name.'),
        description: text(MAX_DESCRIPTION, 'description')
          .optional()
          .describe('New description: what a traveller finds here.'),
        factionIds: z
          .array(entityId('faction', 'get_world'))
          .max(MAX_FACTIONS)
          .optional()
          .describe('The realms present here (replaces the list; [] for none).'),
        rules: z
          .strictObject({
            requiresAbility: z
              .string()
              .trim()
              .min(1)
              .max(MAX_ABILITY)
              .nullable()
              .optional()
              .describe('An ability needed to travel here, e.g. "seaworthy-vessel".'),
            hostileToFactionId: entityId('faction', 'get_world')
              .nullable()
              .optional()
              .describe('A realm this place is hostile to.'),
          })
          .optional()
          .describe('Rule hooks to set or (with null) remove; others are left unchanged.'),
        townSize: z
          .number()
          .int()
          .min(town.MIN_TOWN_SIZE)
          .max(town.MAX_TOWN_SIZE)
          .nullable()
          .optional()
          .describe(
            'A settlement only: its town’s width in metres (L-651); null for the default by size.'
          ),
        danger: z
          .enum(['none', 'low', 'high'])
          .optional()
          .describe(
            'How dangerous it is (L-824): a dangerous place is graded on having hostile figures ' +
              'or characters placed there; none is the default.'
          ),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'description', 'factionIds', 'rules', 'townSize', 'danger']);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const place = existing(world, 'location', args.locationId);
          const fields = {};
          if (args.name !== undefined && args.name !== place.name) {
            fields.name = checkName(world, args.name, place.id);
          }
          Object.assign(fields, describe(place, args.description));
          if (args.factionIds !== undefined) {
            const ids = [...new Set(args.factionIds)];
            ids.forEach((id) => live(world, 'faction', id));
            if (ids.join() !== (place.factionIds || []).join()) fields.factionIds = ids;
          }
          // Its danger (L-824): none is the default, so it isn't kept.
          if (args.danger !== undefined && args.danger !== (place.danger || 'none')) {
            fields.danger = args.danger === 'none' ? FieldValue.delete() : args.danger;
          }
          const rules = place.rules || {};
          for (const [key, value] of Object.entries(args.rules || {})) {
            if (value === undefined) continue;
            if (value === null) {
              if (rules[key] !== undefined) fields[`rules.${key}`] = FieldValue.delete();
              continue;
            }
            if (key === 'hostileToFactionId') live(world, 'faction', value);
            if (rules[key] !== value) fields[`rules.${key}`] = value;
          }
          // A town's real size (L-651), on the settlement beside its art.
          if (args.townSize !== undefined) {
            if ((place.geo || {}).kind !== 'settlement') {
              throw new ToolError(`${place.name} isn't a settlement, so it has no town to size.`);
            }
            const current = place.town && place.town.size;
            if (args.townSize === null) {
              if (current) fields['town.size'] = FieldValue.delete();
            } else if (args.townSize !== current) {
              fields['town.size'] = args.townSize;
            }
          }
          if (Object.keys(fields).length) {
            e.update(e.ref('locations', place.id), fields);
          }
          return {
            location: { id: place.id, name: fields.name || place.name },
            updated: changedFields(fields),
          };
        });
      },
    },
    {
      name: 'add_locations',
      title: 'Add locations',
      description:
        'Add places to the world map, up to ' +
        MAX_NEW_LOCATIONS +
        ' in one call: settlements (kind settlement; a town to open with add_place) or points ' +
        'of interest (kind poi; a site with a battle map), each at { x, y } in map units, with ' +
        'its name, description and, for a settlement, its facts (population, port, capital, ' +
        'biome). Names stay unique in the world. Returns each one’s id, for connect_locations; ' +
        'a new place has no links yet. Works on any world, imported or made with create_world. ' +
        editNote +
        ' ' +
        SLICE_NOTE,
      inputSchema: {
        worldId,
        locations: z
          .array(
            z.strictObject({
              name,
              kind: z
                .enum(['settlement', 'poi'])
                .optional()
                .describe('settlement (default) or poi, a point of interest.'),
              x: z.number().min(0).describe('Map units from the left.'),
              y: z.number().min(0).describe('Map units from the top.'),
              description: text(MAX_DESCRIPTION, 'description')
                .optional()
                .describe('What a traveller finds here; marks it written up.'),
              population: z.number().int().min(0).max(10000000).optional(),
              port: z.boolean().optional().describe('A settlement on the water, for sea routes.'),
              capital: z.boolean().optional(),
              biome: z
                .string()
                .trim()
                .min(1)
                .max(MAX_NAME)
                .optional()
                .describe('e.g. "Grassland".'),
              markerType: z
                .string()
                .trim()
                .min(1)
                .max(MAX_NAME)
                .optional()
                .describe('A point of interest’s kind, e.g. "fort", "ruins", "camp".'),
              factionIds: z.array(entityId('faction', 'get_world')).max(MAX_FACTIONS).optional(),
              danger: z.enum(['none', 'low', 'high']).optional(),
            })
          )
          .min(1)
          .max(MAX_NEW_LOCATIONS),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const size = world.map || {};
          // Names unique among the world's and each other's.
          const taken = new Set();
          const ids = new Set();
          const added = args.locations.map((spec, i) => {
            const at = `Location ${i + 1} (${spec.name})`;
            checkName(world, spec.name);
            const key = normalizeName(spec.name);
            if (taken.has(key)) throw new ToolError(`${at}: that name is given twice.`);
            taken.add(key);
            if ((size.width && spec.x > size.width) || (size.height && spec.y > size.height)) {
              throw new ToolError(
                `${at}: { x: ${spec.x}, y: ${spec.y} } is off the map (${size.width} × ${size.height}).`
              );
            }
            const kind = spec.kind || 'settlement';
            if (kind === 'poi') {
              for (const fact of ['population', 'port', 'capital']) {
                if (spec[fact] !== undefined) {
                  throw new ToolError(`${at}: ${fact} is for settlements, not points of interest.`);
                }
              }
            } else if (spec.markerType !== undefined) {
              throw new ToolError(`${at}: markerType is for points of interest.`);
            }
            (spec.factionIds || []).forEach((id) => live(world, 'faction', id));
            let id = newId(world, 'location', kind === 'poi' ? 'poi' : 'loc', spec.name);
            for (let n = 2; ids.has(id); n += 1) id = `${id}-${n}`;
            ids.add(id);
            const geo =
              kind === 'poi'
                ? { kind, x: spec.x, y: spec.y, markerType: spec.markerType || 'site', links: {} }
                : {
                    kind,
                    x: spec.x,
                    y: spec.y,
                    population: spec.population || 0,
                    port: Boolean(spec.port),
                    capital: Boolean(spec.capital),
                    biome: spec.biome || null,
                    regionId: null,
                    links: {},
                  };
            const location = {
              id,
              name: spec.name,
              description: spec.description || '',
              connections: [],
              factionIds: [...new Set(spec.factionIds || [])],
              npcIds: [],
              rules: {},
              geo,
              ...(spec.danger && spec.danger !== 'none' ? { danger: spec.danger } : {}),
              ...(spec.description ? { sources: { description: SOURCES.MCP } } : {}),
            };
            e.create(e.ref('locations', id), location);
            return { id, name: spec.name, kind };
          });
          return {
            added,
            next:
              'Link them with connect_locations (links: [{ fromId, toId, via }]); open a ' +
              'settlement’s town with add_place, a point of interest with a battle map.',
          };
        }),
    },
    {
      name: 'connect_locations',
      title: 'Connect locations',
      description:
        'Link places so players can travel directly between them, by road, trail or sea ' +
        '(default road): one pair (fromId, toId, via), or many in one call (links, up to ' +
        MAX_LINKS +
        '). Links are two-way; connecting places that are already linked changes how. A ' +
        'route’s length comes from the distance between them. ' +
        editNote,
      inputSchema: {
        worldId,
        fromId: entityId('location', 'find_locations').optional(),
        toId: entityId('location', 'find_locations').optional(),
        via: z.enum(LINKS).optional().describe('road, trail or sea (default road).'),
        links: z
          .array(
            z.strictObject({
              fromId: entityId('location', 'find_locations'),
              toId: entityId('location', 'find_locations'),
              via: z.enum(LINKS).optional().describe('road, trail or sea (default road).'),
            })
          )
          .min(1)
          .max(MAX_LINKS)
          .optional()
          .describe('Many links in one call, instead of fromId and toId.'),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        const single = args.fromId !== undefined || args.toId !== undefined;
        if (single && args.links) throw new ToolError('Give fromId and toId, or links, not both.');
        if (!single && !args.links) throw new ToolError('Give fromId and toId, or links.');
        if (single && !(args.fromId && args.toId)) {
          throw new ToolError('A link needs both fromId and toId.');
        }
        const wanted = single
          ? [{ fromId: args.fromId, toId: args.toId, via: args.via }]
          : args.links;
        return edit(ctx, args, (e) => {
          const { world } = e;
          // Each pair once: the last one given decides how.
          const pairs = new Map();
          wanted.forEach((l, i) => {
            const at = single ? '' : `Link ${i + 1}: `;
            if (l.fromId === l.toId) throw new ToolError(`${at}A place can’t connect to itself.`);
            const a = live(world, 'location', l.fromId);
            const b = live(world, 'location', l.toId);
            pairs.set([a.id, b.id].sort().join('|'), { a, b, via: l.via || 'road' });
          });
          // One update per place: its new neighbours and how each is linked.
          const changes = new Map();
          const change = (x, y, via) => {
            if (!changes.has(x.id)) changes.set(x.id, { ids: [], links: [] });
            changes.get(x.id).ids.push(y.id);
            changes.get(x.id).links.push(link(y.id), via);
          };
          const connections = [];
          for (const { a, b, via } of pairs.values()) {
            const linked = (x, y) =>
              (x.connections || []).includes(y.id) && ((x.geo || {}).links || {})[y.id] === via;
            if (!(linked(a, b) && linked(b, a))) {
              change(a, b, via);
              change(b, a, via);
            }
            connections.push({
              from: { id: a.id, name: a.name },
              to: { id: b.id, name: b.name },
              via,
            });
          }
          for (const [id, { ids, links }] of changes) {
            e.update(
              e.ref('locations', id),
              'connections',
              FieldValue.arrayUnion(...ids),
              ...links
            );
          }
          return single ? { connection: connections[0] } : { connections };
        });
      },
    },
    {
      name: 'disconnect_locations',
      title: 'Disconnect locations',
      description:
        'Remove the direct link between two places, in both directions. Warns if that cuts ' +
        'places off from the starting location. ' +
        editNote,
      inputSchema: {
        worldId,
        fromId: entityId('location', 'find_locations'),
        toId: entityId('location', 'find_locations'),
      },
      annotations: removing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const a = existing(world, 'location', args.fromId);
          const b = existing(world, 'location', args.toId);
          const connected =
            (a.connections || []).includes(b.id) || (b.connections || []).includes(a.id);
          // A link to a retired place is hidden from the loaded world, so
          // remove it regardless.
          if (!connected && !a.retired && !b.retired) {
            return { note: `${a.name} and ${b.name} are not connected.` };
          }
          for (const [x, y] of [
            [a, b],
            [b, a],
          ]) {
            e.update(
              e.ref('locations', x.id),
              'connections',
              FieldValue.arrayRemove(y.id),
              link(y.id),
              FieldValue.delete()
            );
          }
          const warnings = reachWarnings(world, { cut: [a.id, b.id] }, a.id);
          return {
            disconnected: { from: { id: a.id, name: a.name }, to: { id: b.id, name: b.name } },
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
    {
      name: 'update_faction',
      title: 'Update faction',
      description:
        'Change a realm or faction’s name, description, disposition toward the player ' +
        '(friendly, neutral or hostile), or its relations with other realms. Relations are ' +
        'kept mutual: setting A vassal of B makes B suzerain of A; other stances are the same ' +
        'both ways. ' +
        editNote,
      inputSchema: {
        worldId,
        factionId: entityId('faction', 'get_world'),
        name: name.optional().describe('New name.'),
        description: text(MAX_DESCRIPTION, 'description').optional().describe('New description.'),
        disposition: z.enum(DISPOSITIONS).optional().describe('Default stance toward the player.'),
        relations: z
          .record(entityId('faction', 'get_world'), z.enum(RELATIONS))
          .optional()
          .describe(
            `Stances toward other realms, by faction id: ${RELATIONS.join(', ')}. Others are ` +
              'left unchanged.'
          ),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'description', 'disposition', 'relations']);
        if (Object.keys(args.relations || {}).length > MAX_RELATIONS) {
          throw new ToolError(`Change at most ${MAX_RELATIONS} relations at a time.`);
        }
        return edit(ctx, args, (e) => {
          const { world } = e;
          const faction = existing(world, 'faction', args.factionId);
          const patch = patcher(e);
          const updated = [];
          if (args.name !== undefined && args.name !== faction.name) {
            patch('faction', faction.id, 'name', checkName(world, args.name, faction.id));
            updated.push('name');
          }
          const described = describe(faction, args.description);
          for (const [field, value] of Object.entries(described)) {
            patch('faction', faction.id, field, value);
          }
          if (Object.keys(described).length) updated.push('description');
          if (args.disposition !== undefined && args.disposition !== faction.disposition) {
            patch('faction', faction.id, 'disposition', args.disposition);
            updated.push('disposition');
          }
          const current = (faction.politics || {}).relations || {};
          for (const [otherId, stance] of Object.entries(args.relations || {})) {
            if (otherId === faction.id) throw new ToolError('A realm has no relation to itself.');
            const other = live(world, 'faction', otherId);
            const mirror = INVERSE_RELATION[stance] || stance;
            if (
              current[otherId] === stance &&
              ((other.politics || {}).relations || {})[faction.id] === mirror
            ) {
              continue;
            }
            patch('faction', faction.id, relation(otherId), stance);
            patch('faction', otherId, relation(faction.id), mirror);
            updated.push(`relations.${otherId}`);
          }
          patch.commit();
          return { faction: { id: faction.id, name: args.name || faction.name }, updated };
        });
      },
    },
    {
      name: 'update_region',
      title: 'Update region',
      description:
        'Change a region’s (province’s) name or description. Regions arrive from the map with ' +
        'no description; writing one, or sending the current text again, marks it as written ' +
        'up. ' +
        editNote,
      inputSchema: {
        worldId,
        regionId: entityId('region', 'get_world'),
        name: name.optional().describe('New name.'),
        description: text(MAX_DESCRIPTION, 'description')
          .optional()
          .describe('New description: the land, its people, what it is known for.'),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'description']);
        return edit(ctx, args, (e) => {
          const region = existing(e.world, 'region', args.regionId);
          const fields = describe(region, args.description);
          if (args.name !== undefined && args.name !== region.name) fields.name = args.name;
          if (Object.keys(fields).length) e.update(e.ref('regions', region.id), fields);
          return {
            region: { id: region.id, name: fields.name || region.name },
            updated: changedFields(fields),
          };
        });
      },
    },
    {
      name: 'add_character',
      title: 'Add character',
      description:
        'Add a character, optionally belonging to a realm or faction. Every character has a ' +
        'position, exactly one, at the most precise level that applies: at a place in town or ' +
        'a point of interest with a battle map, a square on it (cell, or a feature to stand ' +
        'at); about a settlement, or at a place in town without a map, a townPoint in the ' +
        'town’s 0–1000 square; at a point of interest without a map, none (its own position ' +
        'counts); in the wilderness (no locationId), a worldPoint on the world map. The name ' +
        'must be unique in the world. Returns the new id and the position. ' +
        editNote,
      inputSchema: {
        worldId,
        name: name.describe('The character’s name.'),
        description: text(MAX_DESCRIPTION, 'description').describe(
          'Who they are: appearance, manner, what they want.'
        ),
        locationId: entityId('location', 'find_locations')
          .optional()
          .describe(
            'The settlement or point of interest they are found at; leave out for the wilderness.'
          ),
        placeId: entityId('place', 'get_town')
          .optional()
          .describe('Where in that town they are found, if it has a layout.'),
        factionId: entityId('faction', 'get_world').optional().describe('Their realm or faction.'),
        side: z.enum(SIDES).optional().describe(sideNote),
        challenge: challenge.optional(),
        triggers: triggers.optional(),
        statBlock: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .optional()
          .describe('A named stat block’s id (L-393; list_stat_blocks): their sheet.'),
        overrides: overrides.optional(),
        cell: square.optional(),
        townPoint: townPoint.optional(),
        worldPoint: worldPoint.optional(),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          checkName(world, args.name);
          const home = args.locationId ? live(world, 'location', args.locationId) : null;
          if (!home && args.placeId) {
            throw new ToolError('A place in town needs its settlement: give locationId too.');
          }
          const place = args.placeId ? placeIn(world, home, args.placeId) : null;
          const faction = args.factionId ? live(world, 'faction', args.factionId) : null;
          const id = newId(world, 'character', 'chr', args.name);
          const at = {
            id,
            name: args.name,
            ...(home ? { locationId: home.id } : {}),
            ...(place ? { placeId: place.id } : {}),
          };
          const { fields, warning, view } = positionFor(world, at, args);
          checkWary(world, at, args);
          // Their sheet from a named stat block (L-393).
          const named = args.statBlock
            ? sheetFields(world, args.name, args, { creating: true }).fields
            : args.overrides !== undefined
              ? (() => {
                  throw new ToolError('overrides go with statBlock.');
                })()
              : {};
          e.create(e.ref('characters', id), {
            ...named,
            ...at,
            description: args.description,
            sources: { description: SOURCES.MCP },
            ...(faction ? { factionId: faction.id } : {}),
            ...(args.side && args.side !== 'neutral' ? { side: args.side } : {}),
            ...(args.challenge ? { challenge: args.challenge } : {}),
            ...(args.triggers && args.triggers.length ? { triggers: args.triggers } : {}),
            ...fields,
          });
          if (home) e.update(e.ref('locations', home.id), 'npcIds', FieldValue.arrayUnion(id));
          return {
            character: {
              id,
              name: args.name,
              location: home ? { id: home.id, name: home.name } : null,
              ...(place ? { place: { id: place.id, name: place.name } } : {}),
              faction: faction ? { id: faction.id, name: faction.name } : null,
              side: args.side || 'neutral',
              position: view,
            },
            ...(warning ? { warnings: [warning] } : {}),
          };
        }),
    },
    {
      name: 'update_character',
      title: 'Update character',
      description:
        'Change a character’s name, description, where they are found (moves them: locationId, ' +
        'or null for the wilderness; placeId in their town, or null for about town), their ' +
        'position there (cell, townPoint or worldPoint, as add_character), or realm (null ' +
        'removes it), or side in a fight. Moving them needs a position where they go, unless a point of interest ' +
        'without a map; a refusal suggests one. Fields you omit are left unchanged. ' +
        editNote,
      inputSchema: {
        worldId,
        characterId: entityId('character', 'get_world'),
        name: name.optional().describe('New name.'),
        description: text(MAX_DESCRIPTION, 'description').optional().describe('New description.'),
        locationId: entityId('location', 'find_locations')
          .nullable()
          .optional()
          .describe('Move them to this settlement or point of interest; null for the wilderness.'),
        placeId: entityId('place', 'get_town')
          .nullable()
          .optional()
          .describe('Where in their town they are found; null for anywhere about town.'),
        factionId: entityId('faction', 'get_world')
          .nullable()
          .optional()
          .describe('Their realm or faction; null for none.'),
        side: z.enum(SIDES).optional().describe(sideNote),
        challenge: challenge.nullable().optional().describe('A wary challenge; null removes it.'),
        triggers: triggers
          .nullable()
          .optional()
          .describe('What turns them; null or [] removes them.'),
        statBlock: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
          .optional()
          .describe(
            'A named stat block’s id (L-393): their sheet from now on, with any overrides ' +
              '(set_sheet gives a sheet of their own).'
          ),
        overrides: overrides.nullable().optional().describe('What differs; null clears them.'),
        cell: square.nullable().optional(),
        townPoint: townPoint.nullable().optional(),
        worldPoint: worldPoint.nullable().optional(),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, [
          'name',
          'description',
          'locationId',
          'placeId',
          'factionId',
          'side',
          'challenge',
          'triggers',
          'statBlock',
          'overrides',
          ...POSITIONS,
        ]);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const character = existing(world, 'character', args.characterId);
          const id = character.id;
          const fields = {};
          if (args.name !== undefined && args.name !== character.name) {
            fields.name = checkName(world, args.name, id);
          }
          Object.assign(fields, describe(character, args.description));

          // Where they are found: a settlement or point of interest, or the
          // wilderness (null), and the cast lists that follow it.
          let homeId = character.locationId || null;
          if (args.locationId !== undefined && (args.locationId || null) !== homeId) {
            if (args.locationId) live(world, 'location', args.locationId);
            homeId = args.locationId || null;
            fields.locationId = homeId || FieldValue.delete();
            for (const location of Object.values(world.locations)) {
              if (location.id === homeId) continue;
              if (location.id === character.locationId || (location.npcIds || []).includes(id)) {
                e.update(e.ref('locations', location.id), 'npcIds', FieldValue.arrayRemove(id));
              }
            }
            if (homeId) e.update(e.ref('locations', homeId), 'npcIds', FieldValue.arrayUnion(id));
          }
          // Their place in town (L-343): in their (new) settlement, or cleared
          // when they move to another one without a new place.
          let placeId = character.placeId || null;
          if (args.placeId) {
            if (!homeId) throw new ToolError('The wilderness has no places in town.');
            const place = placeIn(world, world.locations[homeId], args.placeId);
            placeId = place.id;
            if (place.id !== character.placeId) fields.placeId = place.id;
          } else if (
            character.placeId &&
            (args.placeId === null || fields.locationId !== undefined)
          ) {
            placeId = null;
            fields.placeId = FieldValue.delete();
          }

          // Their position (L-682): kept while they stay where they are and
          // none is given; otherwise checked where they now are.
          const moved =
            homeId !== (character.locationId || null) || placeId !== (character.placeId || null);
          const given = POSITIONS.some((field) => args[field] !== undefined);
          let view = null;
          let warning = null;
          if (moved || given) {
            const at = {
              ...unplaced(character),
              ...(homeId ? { locationId: homeId } : { locationId: undefined }),
              ...(placeId ? { placeId } : { placeId: undefined }),
            };
            const placed = positionFor(world, at, args);
            warning = placed.warning;
            view = placed.view;
            for (const field of POSITIONS) {
              const next = placed.fields[field];
              if (next && !(character[field] && maps.sameCell(next, character[field]))) {
                fields[field] = next;
              } else if (!next && character[field] != null) {
                fields[field] = FieldValue.delete();
              }
            }
          }

          if (args.factionId === null && character.factionId) {
            fields.factionId = FieldValue.delete();
          } else if (args.factionId && args.factionId !== character.factionId) {
            live(world, 'faction', args.factionId);
            fields.factionId = args.factionId;
          }
          // Their side (L-821): neutral is the default, so it isn't kept.
          if (args.side !== undefined && args.side !== (character.side || 'neutral')) {
            fields.side = args.side === 'neutral' ? FieldValue.delete() : args.side;
          }
          // What a wary one says, and what turns them (L-392).
          checkWary(world, { locationId: homeId, placeId }, args);
          if (args.challenge === null && character.challenge) {
            fields.challenge = FieldValue.delete();
          } else if (args.challenge) fields.challenge = args.challenge;
          if (
            (args.triggers === null || (args.triggers && !args.triggers.length)) &&
            character.triggers
          ) {
            fields.triggers = FieldValue.delete();
          } else if (args.triggers && args.triggers.length) fields.triggers = args.triggers;
          // Their named stat block, and what differs from it (L-393).
          if (args.statBlock !== undefined || args.overrides !== undefined) {
            const blockId = args.statBlock || character.statBlock;
            if (typeof blockId !== 'string') {
              throw new ToolError('overrides go with a named stat block: give statBlock.');
            }
            const over =
              args.overrides === null
                ? undefined
                : args.overrides !== undefined
                  ? args.overrides
                  : character.overrides;
            const named = sheetFields(world, fields.name || character.name, {
              statBlock: blockId,
              overrides: over,
            }).fields;
            Object.assign(fields, named);
          }
          if (Object.keys(fields).length) e.update(e.ref('characters', id), fields);
          const result = {
            character: {
              id,
              name: fields.name || character.name,
              ...(view ? { position: view } : {}),
            },
            updated: changedFields(fields),
          };
          if (warning) result.warnings = [warning];
          // Someone made before positions were required (L-683 places them).
          if (!view) {
            const now = positions.positionOf(world, character);
            if (now.problem) {
              result.warnings = [
                `${character.name} has no position yet: ${now.problem}.` +
                  suggestion(world, unplaced(character)),
              ];
            }
          }
          return result;
        });
      },
    },
    {
      name: 'set_sheet',
      title: 'Set character sheet',
      description:
        'Give a named character their sheet (L-813), checked against the world’s game system ' +
        '(get_system shows its attributes, skills and resources): a full sheet, or a stat ' +
        'block, the short form, where every attribute is given and skills left out are ' +
        'untrained, resources full and the level the lowest. Opposed checks against them ' +
        'roll it (test_roll with characterId tries it). A fighter lists their attacks ' +
        '(L-822): [{ id, name, reach | range: { normal, long }, attack, damage, type, ' +
        'lethal?, ammo?, onHit?, area? }], attack and damage formulas of their sheet, type ' +
        'one of the system’s damage types (get_system: modules.combat). null removes it. A ' +
        'sheet that no longer fits after the system changes shows in get_character and ' +
        'list_work. ' +
        editNote,
      inputSchema: {
        worldId,
        characterId: entityId('character', 'get_world'),
        sheet: z
          .object({})
          .passthrough()
          .nullable()
          .optional()
          .describe(
            'The whole sheet: { attributes: { [id]: score }, skills: { [id]: rank }, ' +
              'resources: { [id]: { current } }, level, traits: [id], conditions: [], ' +
              'attacks?: [attack] }. Speed is worked out by the system. null removes it.'
          ),
        statBlock: blockRef
          .optional()
          .describe(
            'Or the short form: { attributes (every one), skills?, resources?, level?, traits?, ' +
              'attacks? }; or a named stat block’s id (L-393; list_stat_blocks), whose changes ' +
              'reach them.'
          ),
        overrides: overrides.optional(),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        if ((args.sheet === undefined) === (args.statBlock === undefined)) {
          throw new ToolError('Give either sheet (or null to remove it) or statBlock.');
        }
        if (args.overrides !== undefined && typeof args.statBlock !== 'string') {
          throw new ToolError('overrides go with a named stat block’s id.');
        }
        return edit(ctx, args, (e) => {
          const { world } = e;
          const character = existing(world, 'character', args.characterId);
          const ref = e.ref('characters', character.id);
          if (args.sheet === null) {
            const had = character.sheet || character.statBlock;
            if (had) {
              e.update(ref, {
                sheet: FieldValue.delete(),
                statBlock: FieldValue.delete(),
                overrides: FieldValue.delete(),
              });
            }
            return {
              character: { id: character.id, name: character.name },
              changed: Boolean(had),
              sheet: null,
            };
          }
          const { fields, sheet } = sheetFields(world, character.name, args);
          e.update(ref, fields);
          return {
            character: { id: character.id, name: character.name },
            changed: true,
            ...(typeof args.statBlock === 'string' ? { statBlock: args.statBlock } : {}),
            sheet,
          };
        });
      },
    },
    {
      name: 'set_tactics',
      title: 'Set how a character fights',
      description:
        'Set how a named character fights when the rules play their turns (L-824): role ' +
        '(brute: closes and strikes; skirmisher: strikes and steps back; archer: keeps its ' +
        'distance and shoots; guard: holds its square; caster: areas first; leader: fights ' +
        'as an archer or a brute, and its fall shakes the rest), posture (cowardly, ' +
        'cautious, steady, bold, reckless: whom they go for and when they break), and ' +
        'leader. null clears a role or posture back to its default (archer with a ranged ' +
        'attack, else brute; steady). combatNotes (L-825): how they fight in their own ' +
        'terms, for the model that chooses a named character’s turn from the moves the ' +
        'rules allow ("protects the smith’s daughter first; never fights in the dark"); ' +
        'null clears them. Their role’s tactics are what they fall back on. Figures placed ' +
        'with place_figures carry their own. ' +
        editNote,
      inputSchema: {
        worldId,
        characterId: entityId('character', 'get_world'),
        role: z.enum(ROLES).nullable().optional(),
        posture: z.enum(POSTURES).nullable().optional(),
        leader: z.boolean().optional(),
        combatNotes: z.string().trim().max(1000).nullable().optional(),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['role', 'posture', 'leader', 'combatNotes']);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const character = existing(world, 'character', args.characterId);
          const fields = {};
          for (const part of ['role', 'posture']) {
            if (args[part] === undefined) continue;
            if (args[part] === null) {
              if (character[part] !== undefined) fields[part] = FieldValue.delete();
            } else if (args[part] !== character[part]) fields[part] = args[part];
          }
          if (args.leader !== undefined && args.leader !== Boolean(character.leader)) {
            fields.leader = args.leader ? true : FieldValue.delete();
          }
          if (args.combatNotes !== undefined) {
            const notes = args.combatNotes || null;
            if (notes !== (character.combatNotes || null)) {
              fields.combatNotes = notes || FieldValue.delete();
            }
          }
          if (Object.keys(fields).length) e.update(e.ref('characters', character.id), fields);
          // The character as they will be, for their tactics with the defaults.
          const after = { ...character };
          for (const part of ['role', 'posture']) {
            if (args[part] === null) delete after[part];
            else if (args[part] !== undefined) after[part] = args[part];
          }
          if (args.leader !== undefined) after.leader = args.leader;
          if (args.combatNotes !== undefined) after.combatNotes = args.combatNotes || null;
          return {
            character: { id: character.id, name: character.name },
            tactics: {
              role: figureRules.roleOf(systemOf(world), after),
              posture: figureRules.postureOf(after),
              ...(after.leader ? { leader: true } : {}),
              ...(after.combatNotes ? { combatNotes: after.combatNotes } : {}),
            },
            updated: changedFields(fields),
          };
        });
      },
    },
    {
      name: 'add_lore',
      title: 'Add lore',
      description:
        'Add a piece of lore — history, legend, custom, rumour — about one or more places, ' +
        'places in town, realms, regions or characters. The Loom’s narrator draws on it whenever those come ' +
        'up in play. Returns the new id. ' +
        editNote,
      inputSchema: {
        worldId,
        title: text(MAX_TITLE, 'title').describe('A short title.'),
        text: text(MAX_TEXT, 'text').describe('The lore itself.'),
        about: z
          .array(entityId('entity', 'find_locations or get_world'))
          .min(1)
          .max(MAX_REFS)
          .describe(
            'Ids of the places, places in town, realms, regions or characters it is about.'
          ),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const about = liveSubjects(world, args.about);
          const id = newId(world, 'lore', 'lore', args.title);
          e.create(e.ref('lore', id), {
            id,
            title: args.title,
            text: args.text,
            entityRefs: about.map((subject) => subject.id),
          });
          return { lore: { id, title: args.title, about } };
        }),
    },
    {
      name: 'update_lore',
      title: 'Update lore',
      description:
        'Change a lore entry’s title, text, or what it is about (replaces the list). Fields ' +
        'you omit are left unchanged. ' +
        editNote,
      inputSchema: {
        worldId,
        loreId: entityId('lore', 'get_world'),
        title: text(MAX_TITLE, 'title').optional().describe('New title.'),
        text: text(MAX_TEXT, 'text').optional().describe('New text.'),
        about: z
          .array(entityId('entity', 'find_locations or get_world'))
          .min(1)
          .max(MAX_REFS)
          .optional()
          .describe('Ids of what it is about (replaces the list).'),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['title', 'text', 'about']);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const entry = existing(world, 'lore', args.loreId);
          const fields = {};
          if (args.title !== undefined && args.title !== entry.title) fields.title = args.title;
          if (args.text !== undefined && args.text !== entry.text) fields.text = args.text;
          if (args.about !== undefined) {
            const ids = liveSubjects(world, args.about).map((subject) => subject.id);
            if (ids.join() !== (entry.entityRefs || []).join()) fields.entityRefs = ids;
          }
          if (Object.keys(fields).length) e.update(e.ref('lore', entry.id), fields);
          return {
            lore: { id: entry.id, title: fields.title || entry.title },
            updated: Object.keys(fields),
          };
        });
      },
    },
    {
      name: 'retire_entity',
      title: 'Retire or remove',
      description:
        'Remove a place, realm, character, lore entry or battle map. In a published world it ' +
        'is retired: kept, so saves that reference it keep working, but players can no longer ' +
        'reach, meet or hear of it. In a draft it is deleted, along with every reference to it. ' +
        'The starting location of a published world can’t be retired, nor a battle map that a ' +
        'place still uses or another map’s exit leads to.',
      inputSchema: {
        worldId,
        type: z
          .enum(['location', 'faction', 'character', 'lore', 'place', 'battleMap'])
          .describe('What kind it is (place: a place in town).'),
        id: entityId('entity', 'get_world or find_locations'),
      },
      annotations: removing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const entity = existing(world, args.type, args.id);
          const subject = { type: args.type, id: entity.id, name: labelOf(entity) };
          if (args.type === 'place') {
            keepsAWayIn(world, entity, { removing: true });
            keepsGround(world, world.locations[entity.locationId], { remove: [entity.id] });
          }
          if (args.type === 'battleMap') mapStillNeeded(world, entity);
          const warnings =
            args.type === 'location'
              ? reachWarnings(world, { removed: entity.id }, (entity.connections || [])[0])
              : args.type === 'place'
                ? layoutAfter(world, world.locations[entity.locationId], {
                    remove: [entity.id],
                  }).problems
                : [];

          if (world.status === 'published') {
            if (entity.retired) return { note: 'Already retired.', entity: subject };
            if (args.type === 'location' && (world.rules || {}).startingLocationId === entity.id) {
              throw new ToolError(
                'This is where new games begin. Set another starting location with update_world first.'
              );
            }
            e.update(e.ref(COLLECTION[args.type], entity.id), { retired: true });
            return { retired: subject, ...(warnings.length ? { warnings } : {}) };
          }

          const references = deleteFromDraft(e, args.type, entity);
          if (args.type === 'location' && (world.rules || {}).startingLocationId === entity.id) {
            warnings.push('It was the starting location; choose another with update_world.');
          }
          return {
            deleted: subject,
            referencesCleaned: references,
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
    {
      name: 'publish_world',
      title: 'Publish world',
      description:
        'Publish a draft to the Loom, where players can then start games in it. It needs an ' +
        'opening hook and a starting location (see get_world’s readyToPublish); set them with ' +
        'update_world. Publishing can’t be undone, and from then on removals are retirements.',
      inputSchema: { worldId },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: async (ctx, args) => ({
        ...(await writer.publish(ctx.uid, args.worldId)),
        note: 'Published. Players can now start games in this world from the Loom.',
      }),
    },
  ];
}

// A battle map can't go while a place uses it or another map's exit leads to
// it (L-352): players would land nowhere.
function mapStillNeeded(world, map) {
  const uses = (e) => !e.retired && e.battleMap && e.battleMap.mapId === map.id;
  const users = [
    ...Object.values(world.locations).filter(uses),
    ...Object.values(world.places || {}).filter(uses),
  ];
  if (users.length) {
    throw new ToolError(
      `It is the battle map of ${users.map((u) => `${u.name} (${u.id})`).join(', ')}. ` +
        'Give them another map (assign_battle_map) first.'
    );
  }
  const linking = Object.values(world.battleMaps || {}).filter(
    (other) =>
      other.id !== map.id &&
      !other.retired &&
      (other.exits || []).some((e) => e.to && e.to !== 'out' && e.to.map === map.id)
  );
  if (linking.length) {
    throw new ToolError(
      `Exits on ${linking.map((m) => `${m.name} (${m.id})`).join(', ')} lead to it. Change ` +
        'them (set_battle_map) first.'
    );
  }
}

// Shared with the town tools (./town-tools.js).
const helpers = {
  COLLECTION,
  text,
  name,
  existing,
  live,
  checkName,
  newId,
  describe,
  changedFields,
  requireSome,
  placeIn,
  keepsAWayIn,
  keepsGround,
  layoutAfter,
  MAX_DESCRIPTION,
};

module.exports = { writeTools, helpers };
