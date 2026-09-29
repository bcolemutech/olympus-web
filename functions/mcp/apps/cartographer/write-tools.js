'use strict';

const { z } = require('zod');
const { FieldValue, FieldPath } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const { normalizeName } = require('../../../loom-turn/interpret');
const { worldId, entityId } = require('./schemas');
const { SOURCES } = require('../../../cartographer/sources');
const { isPlayable } = require('../../../loom-canon/grading');
const { whyClosed } = require('../../../cartographer/service');

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
const COLLECTION = {
  location: 'locations',
  faction: 'factions',
  region: 'regions',
  character: 'characters',
  lore: 'lore',
};
const HINT = {
  location: 'Use find_locations to look one up.',
  faction: 'Use get_world to see realms.',
  region: 'Use get_world to see regions.',
  character: 'Use get_world to see characters.',
  lore: 'Use get_world to see lore.',
};
const UNREACHABLE_SHOWN = 5;

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

// The kind of an entity id that lore can be about, or null.
function subjectKind(world, id) {
  return ['location', 'faction', 'region', 'character'].find((kind) =>
    Boolean((world[COLLECTION[kind]] || {})[id])
  );
}

function liveSubjects(world, ids) {
  return [...new Set(ids)].map((id) => {
    const kind = subjectKind(world, id);
    if (!kind) throw new ToolError(`No place, realm, region or character "${id}" in this world.`);
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

function writeTools({ writer }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
  const removing = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
  const editNote =
    'Works on drafts and published worlds; a change to a published world reaches games on ' +
    'their next turn.';

  return [
    {
      name: 'update_world',
      title: 'Update world',
      description:
        'Change a world’s name, tagline, opening hook (the scene every new game opens with) ' +
        'or starting location (where new games begin). Fields you omit are left unchanged. ' +
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
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'tagline', 'openingHook', 'startingLocationId']);
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
                    ? "New games can't begin until it is written up."
                    : 'Write it up before publishing.')
              );
            }
          }
          if (Object.keys(fields).length) e.updateWorld(fields);
          return {
            updated: Object.keys(fields).map((f) => f.replace('rules.', '')),
            world: {
              name: fields.name || world.name,
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
        'Setting a description, even the current text, marks the place as written up. ' +
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
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'description', 'factionIds', 'rules']);
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
      name: 'connect_locations',
      title: 'Connect locations',
      description:
        'Link two places so players can travel directly between them, by road, trail or sea ' +
        '(default road). Links are two-way; connecting places that are already linked changes ' +
        'how. ' +
        editNote,
      inputSchema: {
        worldId,
        fromId: entityId('location', 'find_locations'),
        toId: entityId('location', 'find_locations'),
        via: z.enum(LINKS).optional().describe('road, trail or sea (default road).'),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const via = args.via || 'road';
          if (args.fromId === args.toId) throw new ToolError('A place can’t connect to itself.');
          const a = live(world, 'location', args.fromId);
          const b = live(world, 'location', args.toId);
          const linked = (x, y) =>
            (x.connections || []).includes(y.id) && ((x.geo || {}).links || {})[y.id] === via;
          if (!(linked(a, b) && linked(b, a))) {
            for (const [x, y] of [
              [a, b],
              [b, a],
            ]) {
              e.update(
                e.ref('locations', x.id),
                'connections',
                FieldValue.arrayUnion(y.id),
                link(y.id),
                via
              );
            }
          }
          return {
            connection: { from: { id: a.id, name: a.name }, to: { id: b.id, name: b.name }, via },
          };
        }),
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
        'Add a character who lives at a place — players meet them there — optionally belonging ' +
        'to a realm or faction. The name must be unique in the world. Returns the new id. ' +
        editNote,
      inputSchema: {
        worldId,
        name: name.describe('The character’s name.'),
        description: text(MAX_DESCRIPTION, 'description').describe(
          'Who they are: appearance, manner, what they want.'
        ),
        locationId: entityId('location', 'find_locations').describe('Where they are found.'),
        factionId: entityId('faction', 'get_world').optional().describe('Their realm or faction.'),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          checkName(world, args.name);
          const home = live(world, 'location', args.locationId);
          const faction = args.factionId ? live(world, 'faction', args.factionId) : null;
          const id = newId(world, 'character', 'chr', args.name);
          e.create(e.ref('characters', id), {
            id,
            name: args.name,
            description: args.description,
            sources: { description: SOURCES.MCP },
            locationId: home.id,
            ...(faction ? { factionId: faction.id } : {}),
          });
          e.update(e.ref('locations', home.id), 'npcIds', FieldValue.arrayUnion(id));
          return {
            character: {
              id,
              name: args.name,
              location: { id: home.id, name: home.name },
              faction: faction ? { id: faction.id, name: faction.name } : null,
            },
          };
        }),
    },
    {
      name: 'update_character',
      title: 'Update character',
      description:
        'Change a character’s name, description, where they are found (moves them), or realm ' +
        '(null removes it). Fields you omit are left unchanged. ' +
        editNote,
      inputSchema: {
        worldId,
        characterId: entityId('character', 'get_world'),
        name: name.optional().describe('New name.'),
        description: text(MAX_DESCRIPTION, 'description').optional().describe('New description.'),
        locationId: entityId('location', 'find_locations')
          .optional()
          .describe('Move them to this place.'),
        factionId: entityId('faction', 'get_world')
          .nullable()
          .optional()
          .describe('Their realm or faction; null for none.'),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'description', 'locationId', 'factionId']);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const character = existing(world, 'character', args.characterId);
          const id = character.id;
          const fields = {};
          if (args.name !== undefined && args.name !== character.name) {
            fields.name = checkName(world, args.name, id);
          }
          Object.assign(fields, describe(character, args.description));
          if (args.locationId !== undefined && args.locationId !== character.locationId) {
            live(world, 'location', args.locationId);
            fields.locationId = args.locationId;
            for (const place of Object.values(world.locations)) {
              if (place.id === args.locationId) continue;
              if (place.id === character.locationId || (place.npcIds || []).includes(id)) {
                e.update(e.ref('locations', place.id), 'npcIds', FieldValue.arrayRemove(id));
              }
            }
            e.update(e.ref('locations', args.locationId), 'npcIds', FieldValue.arrayUnion(id));
          }
          if (args.factionId === null && character.factionId) {
            fields.factionId = FieldValue.delete();
          } else if (args.factionId && args.factionId !== character.factionId) {
            live(world, 'faction', args.factionId);
            fields.factionId = args.factionId;
          }
          if (Object.keys(fields).length) e.update(e.ref('characters', id), fields);
          return {
            character: { id, name: fields.name || character.name },
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
        'realms, regions or characters. The Loom’s narrator draws on it whenever those come ' +
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
          .describe('Ids of the places, realms, regions or characters it is about.'),
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
        'Remove a place, realm, character or lore entry. In a published world it is retired: ' +
        'kept, so saves that reference it keep working, but players can no longer reach, meet ' +
        'or hear of it. In a draft it is deleted, along with every reference to it. The ' +
        'starting location of a published world can’t be retired.',
      inputSchema: {
        worldId,
        type: z.enum(['location', 'faction', 'character', 'lore']).describe('What kind it is.'),
        id: entityId('entity', 'get_world or find_locations'),
      },
      annotations: removing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const entity = existing(world, args.type, args.id);
          const subject = { type: args.type, id: entity.id, name: labelOf(entity) };
          const warnings =
            args.type === 'location'
              ? reachWarnings(world, { removed: entity.id }, (entity.connections || [])[0])
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

module.exports = { writeTools };
