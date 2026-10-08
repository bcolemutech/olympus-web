'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { createFirestoreWorldReader } = require('./reader');
const { createFirestoreWorldWriter } = require('./writer');
const { worldId, entityId } = require('./schemas');
const { writeTools } = require('./write-tools');
const { townTools } = require('./town-tools');
const { mapTools } = require('./map-tools');
const { GRADES } = require('../../../loom-canon/grading');
const { workList } = require('./work');
const views = require('./views');
const images = require('./images');
const { MAX_SVG_BYTES } = require('../../../cartographer/svg');
const town = require('../../../loom-canon/town');

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

function cartographerApp({ reader, writer, art }) {
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
        name: 'list_battle_maps',
        title: 'List battle maps',
        description:
          'A world’s battle maps: the grids that points of interest and places in town are ' +
          'walked on in the Loom. Each with its size, whether it is generic (kind and terrain: ' +
          'reusable, for any number of places) and how many places use it. Filter to generic ' +
          'maps, and by kind or terrain, to find one to assign. A generic map opens a place, but ' +
          'only its own map can make it Rich. Make maps with set_battle_map; assign them with ' +
          'assign_battle_map.',
        inputSchema: {
          worldId,
          generic: z.boolean().optional().describe('Only generic maps (true) or only own maps.'),
          kind: z.string().max(40).optional().describe('Generic maps of this kind, e.g. tavern.'),
          terrain: z.string().max(40).optional().describe('Generic maps of this terrain.'),
        },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const lower = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);
          const rows = Object.values(world.battleMaps || {})
            .filter((m) => !m.retired)
            .filter((m) => args.generic === undefined || Boolean(m.generic) === args.generic)
            .filter((m) => !args.kind || lower((m.generic || {}).kind) === lower(args.kind))
            .filter(
              (m) => !args.terrain || lower((m.generic || {}).terrain) === lower(args.terrain)
            )
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((m) => views.battleMapRow(world, m));
          return { worldId: world.id, maps: rows, count: rows.length };
        },
      },
      {
        name: 'get_battle_map',
        title: 'Get battle map',
        description:
          'One battle map in full: its grid size, entries (where players arrive), exits (each ' +
          'leading out to the town or the world, or to an entry on another map), features (named ' +
          'cells such as the bar), whether it is generic, whether it has an image (uploaded on ' +
          'the Cartographer page), which places use it and which characters stand where (set ' +
          'with add_character or update_character). Cells are { x, y } from the top-left, ' +
          '0-based.',
        inputSchema: { worldId, mapId: entityId('battle map', 'list_battle_maps') },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const map = entityFor(
            world,
            'battleMaps',
            args.mapId,
            'battle map',
            'Use list_battle_maps to see them.'
          );
          return { worldId: world.id, ...views.battleMapDetail(world, map) };
        },
      },
      {
        name: 'view_image',
        title: 'View an image',
        description:
          'See an image as players will: a battle map, a town, or the world map, returned as an ' +
          'image you can look at (scaled to at most 1568 px on the long side). Use it to check ' +
          'that what you place lines up with the art. Battle maps come with their grid (every ' +
          'fifth line labelled) and numbered markers for entries, exits and features; towns with ' +
          'numbered markers at their places’ positions, their links, and the 0–1000 grid. The ' +
          'legend ties each number to its id, name and cell or position. Without art, a battle ' +
          'map or town is drawn on a plain background, so its layout can still be checked. Art ' +
          'is uploaded on the Cartographer page.',
        inputSchema: {
          worldId,
          of: z.enum(['battleMap', 'town', 'world']).describe('What to see.'),
          id: entityId('battle map or settlement', 'list_battle_maps or find_locations')
            .optional()
            .describe('The battle map, or the settlement (for its town). Not for the world map.'),
        },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const load = async (path) => {
            try {
              return await art.load(path);
            } catch {
              throw new ToolError('Its image could not be read from storage.');
            }
          };
          const needId = () => {
            if (!args.id)
              throw new ToolError(
                `Give the ${args.of === 'town' ? 'settlement' : 'battle map'} id.`
              );
          };
          let rendered;
          try {
            if (args.of === 'battleMap') {
              needId();
              const map = entityFor(
                world,
                'battleMaps',
                args.id,
                'battle map',
                'Use list_battle_maps to see them.'
              );
              rendered = images.renderBattleMap(map, map.image ? await load(map.image.path) : null);
            } else if (args.of === 'town') {
              needId();
              const settlement = entityFor(
                world,
                'locations',
                args.id,
                'location',
                'Use find_locations to look one up.'
              );
              if ((settlement.geo || {}).kind !== 'settlement') {
                throw new ToolError(`${settlement.name} isn't a settlement, so it has no town.`);
              }
              const townArt = settlement.town && settlement.town.image;
              rendered = images.renderTown(
                world,
                settlement,
                town.placesOf(world, settlement.id),
                townArt ? await load(townArt.path) : null
              );
            } else {
              const path = world.map && world.map.imagePath;
              if (!path)
                throw new ToolError('This world has no map image: it was imported without one.');
              rendered = images.renderWorld(world, await load(path));
            }
          } catch (err) {
            if (err instanceof ToolError) throw err;
            throw new ToolError(`The image can't be shown: ${err.message}.`);
          }
          const legend = { worldId: world.id, ...rendered.legend };
          return {
            content: [
              {
                type: 'image',
                data: Buffer.from(rendered.jpeg).toString('base64'),
                mimeType: 'image/jpeg',
              },
              { type: 'text', text: JSON.stringify(legend, null, 2) },
            ],
            structuredContent: legend,
          };
        },
      },
      {
        name: 'set_art',
        title: 'Draw art (SVG)',
        description:
          'Give a battle map or a town art you draw yourself, as SVG, so it can be stubbed out ' +
          'without another AI. Battle maps: use viewBox="0 0 <width> <height>", one unit per ' +
          'cell, so cell (x, y) is the square from (x, y) to (x+1, y+1); the art is stretched ' +
          'to the grid. Towns: use viewBox="0 0 1000 1000", the same space as place positions. ' +
          'Plain drawing is fine: shapes, paths, text, gradients, patterns, filters, and <use> ' +
          'of things in the same SVG. Scripts, event handlers, links or images from elsewhere, ' +
          'foreignObject and DOCTYPE are refused. Up to 1 MB. The game draws names, exits and ' +
          'features itself, so the art needn’t label them. Check the result with view_image. ' +
          'svg null takes the art away. Replaces any art there, PNG or SVG.',
        inputSchema: {
          worldId,
          of: z.enum(['battleMap', 'town']).describe('What the art is for.'),
          id: entityId('battle map or settlement', 'list_battle_maps or find_locations'),
          svg: z
            .string()
            .max(MAX_SVG_BYTES)
            .nullable()
            .describe('The SVG, or null to take the art away.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          const target =
            args.of === 'battleMap'
              ? entityFor(
                  world,
                  'battleMaps',
                  args.id,
                  'battle map',
                  'Use list_battle_maps to see them.'
                )
              : entityFor(
                  world,
                  'locations',
                  args.id,
                  'location',
                  'Use find_locations to look one up.'
                );
          if (args.of === 'town' && (target.geo || {}).kind !== 'settlement') {
            throw new ToolError(`${target.name} isn't a settlement, so it has no town.`);
          }
          let result;
          try {
            result = await art.draw(ctx.uid, args);
          } catch (err) {
            if (err instanceof ToolError) throw err;
            if (err && typeof err.code === 'string' && err.message)
              throw new ToolError(err.message);
            throw err;
          }
          const warnings = [];
          const size = result.image;
          if (size) {
            const aspect = size.width / size.height;
            if (args.of === 'battleMap') {
              const grid = target.width / target.height;
              if (Math.abs(aspect - grid) / grid > 0.02) {
                warnings.push(
                  `Its shape (${size.width} × ${size.height}) isn't the grid's (${target.width} × ` +
                    `${target.height}), so it is stretched to fit. Use viewBox="0 0 ${target.width} ` +
                    `${target.height}" to line cells up exactly.`
                );
              }
            } else if (Math.abs(aspect - 1) > 0.02) {
              warnings.push(
                `It isn't square (${size.width} × ${size.height}): the town view fits it inside the ` +
                  'town’s square, centred, and place positions are in that square. Use ' +
                  'viewBox="0 0 1000 1000" to line them up exactly.'
              );
            }
          }
          return {
            of: args.of,
            id: args.id,
            name: result.name,
            art: size ? { format: size.format, width: size.width, height: size.height } : null,
            ...(warnings.length ? { warnings } : {}),
            ...(size ? { next: 'Check it with view_image.' } : {}),
          };
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
      ...mapTools({ writer }),
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
  const { getStorage } = require('firebase-admin/storage');
  const writer = createFirestoreWorldWriter(getFirestore);
  // The Cartographer's own service stores art (set_art), as the page does.
  let service;
  const cartographer = () => {
    if (!service) {
      const { createCartographerService } = require('../../../cartographer/service');
      service = createCartographerService({
        db: getFirestore(),
        bucket: getStorage().bucket(),
        writer,
      });
    }
    return service;
  };
  registry.registerApp(
    APP_ID,
    cartographerApp({
      reader: createFirestoreWorldReader(getFirestore),
      writer,
      art: {
        // Read from Cloud Storage for view_image.
        load: async (path) => (await getStorage().bucket().file(path).download())[0],
        // SVG Claude draws (set_art).
        draw: (uid, args) => cartographer().drawArt(uid, args),
      },
    })
  );
}

module.exports = { register, cartographerApp, APP_ID };
