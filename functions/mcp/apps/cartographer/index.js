'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { createFirestoreWorldReader } = require('./reader');
const { createFirestoreWorldWriter } = require('./writer');
const { worldId, entityId } = require('./schemas');
const { writeTools } = require('./write-tools');
const { townTools } = require('./town-tools');
const { GRADES } = require('../../../loom-canon/grading');
const { workList } = require('./work');
const views = require('./views');

// The Cartographer's MCP connector (design planning/the-cartographer-design.md
// §4; C-6 / #373, C-7 / #374). Mounted at /mcp/cartographer and gated by the
// `cartographer` claim, it lets Claude explore any imported world — draft or
// published — and build on it: the read tools below, and the write tools in
// write-tools.js.
//
// Read results are sized for a conversation: overviews and rows carry ids for
// follow-up calls, find_locations pages, and long lists are capped. Retired
// entities (soft-removed from a published world) still resolve by id and are
// marked `retired`; find_locations leaves them out unless asked.
//
// Places, realms and regions carry their grade (Unbuilt, Stub, Playable,
// Rich) and what they are missing (planning/the-loom-layered-worlds.md §4),
// and list_work says what to build next (§6; L-323 / #392).

const APP_ID = 'cartographer';
const MAX_WORLDS = 100;
const DEFAULT_FIND_LIMIT = 20;
const MAX_FIND_LIMIT = 100;
const NEEDS = ['description', 'residents', 'lore', 'town', 'battleMap'];
const GRADE_HELP =
  'Grades: unbuilt (a layer it needs is missing), stub (import text only), playable ' +
  '(written up: players may enter), rich (playable, with residents and lore).';

function cartographerApp({ reader, writer }) {
  // Loads a world the tools can read, or explains why it can't.
  async function worldFor(id) {
    const loaded = await reader.loadWorld(id);
    if (!loaded) throw new ToolError(`World "${id}" not found. Use list_worlds to see world ids.`);
    const { meta, world } = loaded;
    if (world) return { meta, world };
    if (meta.status === 'importing') {
      throw new ToolError('This world is still importing. Try again in a minute.');
    }
    if (meta.status === 'failed') {
      throw new ToolError(
        `This world's import failed${meta.error ? `: ${meta.error}` : ''}. Upload the map again in the Cartographer.`
      );
    }
    throw new ToolError(`This world can't be read (status: ${meta.status}).`);
  }

  function entityFor(world, collection, id, what, hint) {
    const entity = (world[collection] || {})[id];
    if (!entity) throw new ToolError(`No ${what} "${id}" in this world. ${hint}`);
    return entity;
  }

  const readOnly = { readOnlyHint: true, openWorldHint: false };

  return {
    tools: [
      {
        name: 'list_worlds',
        title: 'List worlds',
        description:
          'List the worlds imported into the Cartographer, newest first, with each one’s status ' +
          '(draft, published, importing or failed) and what its map contained.',
        annotations: readOnly,
        handler: async () => {
          const worlds = (await reader.listWorlds({ limit: MAX_WORLDS })).map(views.worldRow);
          return { worlds, count: worlds.length };
        },
      },
      {
        name: 'get_world',
        title: 'Get world overview',
        description:
          'Overview of one world: name, tagline, opening hook, status, starting location, whether ' +
          'it is ready to publish, how built it is (places, realms and regions by grade), counts, ' +
          'its realms (factions) with their regions, and its characters and lore. Start here ' +
          'before exploring a world. ' +
          GRADE_HELP,
        inputSchema: { worldId },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { meta, world } = await worldFor(args.worldId);
          return views.worldOverview(meta, world);
        },
      },
      {
        name: 'find_locations',
        title: 'Find locations',
        description:
          'Search a world’s places — settlements and points of interest — by name, region, ' +
          'realm (faction) or kind, or list those nearest another place. Filters combine. ' +
          'Results are paged: pass nextOffset back as offset for more. Largest settlements come ' +
          'first, or nearest first with `near` (distance is in map units, hops counts travel ' +
          'steps along connections). Every row carries its grade, and `grade` filters by one.',
        inputSchema: {
          worldId,
          name: z
            .string()
            .trim()
            .min(1)
            .max(100)
            .optional()
            .describe('Part of the name to look for (case and accents ignored).'),
          regionId: entityId('region', 'get_world').optional(),
          factionId: entityId('faction', 'get_world').optional(),
          near: entityId('location', 'find_locations')
            .optional()
            .describe('A location id: list places nearest to it.'),
          kind: z
            .enum(['settlement', 'poi'])
            .optional()
            .describe('Only settlements, or only points of interest (poi).'),
          grade: z.enum(GRADES).optional().describe('Only places with this grade.'),
          includeRetired: z
            .boolean()
            .optional()
            .describe('Include places retired from a published world (default false).'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_FIND_LIMIT)
            .optional()
            .describe(`Results per page (default ${DEFAULT_FIND_LIMIT}).`),
          offset: z.number().int().min(0).optional().describe('Results to skip (default 0).'),
        },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          if (args.near) {
            entityFor(world, 'locations', args.near, 'location', 'Use find_locations by name.');
          }
          if (args.regionId) {
            entityFor(world, 'regions', args.regionId, 'region', 'Use get_world to see regions.');
          }
          if (args.factionId) {
            entityFor(world, 'factions', args.factionId, 'faction', 'Use get_world to see realms.');
          }
          return {
            worldId: world.id,
            ...views.findLocations(world, {
              ...args,
              limit: args.limit || DEFAULT_FIND_LIMIT,
              offset: args.offset || 0,
            }),
          };
        },
      },
      {
        name: 'list_work',
        title: 'List work to build',
        description:
          'What to build next in a world, most useful first, each item with its grade and what ' +
          'it is missing. A place must be Playable for players to enter it, so the list grows ' +
          'the world outward from where the game is: frontier (closed places next to an open ' +
          'one, or the starting location), then places inside the nearest towns, then other ' +
          'closed places nearest the start, then open places that could be richer, then realms ' +
          'and regions to describe. Write a place ' +
          'up with update_location (setting a description marks it written), add residents ' +
          'with add_character and lore with add_lore. Paged: pass nextOffset back as offset. ' +
          GRADE_HELP,
        inputSchema: {
          worldId,
          kind: z
            .enum(['settlement', 'poi', 'place', 'faction', 'region'])
            .optional()
            .describe('Only this kind of thing (place: a place in town).'),
          grade: z.enum(GRADES).optional().describe('Only items with this grade.'),
          need: z
            .enum(NEEDS)
            .optional()
            .describe('Only items missing this (e.g. description, residents, lore).'),
          near: entityId('location', 'find_locations')
            .optional()
            .describe('Build around this place instead of the starting location.'),
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_FIND_LIMIT)
            .optional()
            .describe(`Items per page (default ${DEFAULT_FIND_LIMIT}).`),
          offset: z.number().int().min(0).optional().describe('Items to skip (default 0).'),
        },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          if (args.near) {
            entityFor(world, 'locations', args.near, 'location', 'Use find_locations by name.');
          }
          return {
            worldId: world.id,
            ...workList(world, {
              ...args,
              limit: args.limit || DEFAULT_FIND_LIMIT,
              offset: args.offset || 0,
            }),
          };
        },
      },
      {
        name: 'get_location',
        title: 'Get location',
        description:
          'One place in full: description, its grade and what it is missing, population, region ' +
          'and realm, its connections (by road, trail or sea, with direction, distance and ' +
          'grade), the characters found there, and the lore about it. A settlement also has ' +
          'seeds: what the map says about the town (type, culture, and whether it has walls, a ' +
          'citadel, a plaza (market square), a temple, a shanty town).',
        inputSchema: { worldId, locationId: entityId('location', 'find_locations') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const location = entityFor(
            world,
            'locations',
            args.locationId,
            'location',
            'Use find_locations to look one up.'
          );
          return { worldId: world.id, ...views.locationDetail(world, location) };
        },
      },
      {
        name: 'get_faction',
        title: 'Get faction',
        description:
          'One realm or faction in full: description, grade, government, capital, largest ' +
          'settlements, regions, relations with other realms, members, and lore.',
        inputSchema: { worldId, factionId: entityId('faction', 'get_world') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const faction = entityFor(
            world,
            'factions',
            args.factionId,
            'faction',
            'Use get_world to see realms.'
          );
          return { worldId: world.id, ...views.factionDetail(world, faction) };
        },
      },
      {
        name: 'get_region',
        title: 'Get region',
        description:
          'One region (province) in full: description, grade, its realm, capital, settlements ' +
          '(largest first, with grades), and lore.',
        inputSchema: { worldId, regionId: entityId('region', 'get_world') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const region = entityFor(
            world,
            'regions',
            args.regionId,
            'region',
            'Use get_world to see regions.'
          );
          return { worldId: world.id, ...views.regionDetail(world, region) };
        },
      },
      {
        name: 'get_town',
        title: 'Get town',
        description:
          'A settlement’s town layout (the places inside it): each place with its kind, links, ' +
          'grade and residents; which places are ways in and out (entranceFor) and which world ' +
          'routes each serves; and whether the layout works (every place reachable from a written-' +
          'up way in). Build towns with add_place, update_place, connect_places and ' +
          'disconnect_places. `art` is the size of the town’s image, if it has one (uploaded on ' +
          'the Cartographer page): the town view draws it fitted to the town’s 0–1000 square, ' +
          'so set place positions to line up with it. ' +
          GRADE_HELP,
        inputSchema: { worldId, locationId: entityId('location', 'find_locations') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const settlement = entityFor(
            world,
            'locations',
            args.locationId,
            'location',
            'Use find_locations to look one up.'
          );
          if ((settlement.geo || {}).kind !== 'settlement') {
            throw new ToolError(`${settlement.name} isn't a settlement, so it has no town.`);
          }
          return { worldId: world.id, ...views.townDetail(world, settlement) };
        },
      },
      {
        name: 'get_character',
        title: 'Get character',
        description: 'One character in full: description, faction, where they are found, and lore.',
        inputSchema: { worldId, characterId: entityId('character', 'get_world') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const character = entityFor(
            world,
            'characters',
            args.characterId,
            'character',
            'Use get_world to see characters.'
          );
          return { worldId: world.id, ...views.characterDetail(world, character) };
        },
      },
      {
        name: 'get_lore',
        title: 'Get lore',
        description:
          'One lore entry in full: its text and the places, realms and people it is about.',
        inputSchema: { worldId, loreId: entityId('lore', 'get_world') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const entry = entityFor(
            world,
            'lore',
            args.loreId,
            'lore entry',
            'Use get_world to see lore.'
          );
          return { worldId: world.id, ...views.loreDetail(world, entry) };
        },
      },
      ...writeTools({ writer }),
      ...townTools({ writer }),
    ],
    resources: [
      {
        name: 'worlds',
        uri: 'cartographer://worlds',
        title: 'Worlds',
        description: 'Every world in the Cartographer, newest first (read-only snapshot).',
        mimeType: 'application/json',
        read: async () => ({
          worlds: (await reader.listWorlds({ limit: MAX_WORLDS })).map(views.worldRow),
        }),
      },
    ],
  };
}

// Registers the Cartographer on the production registry, backed by Firestore.
function register(registry) {
  const { getFirestore } = require('firebase-admin/firestore');
  registry.registerApp(
    APP_ID,
    cartographerApp({
      reader: createFirestoreWorldReader(getFirestore),
      writer: createFirestoreWorldWriter(getFirestore),
    })
  );
}

module.exports = { register, cartographerApp, APP_ID };
