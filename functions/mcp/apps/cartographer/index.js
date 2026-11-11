'use strict';

const { z } = require('zod');
const artSets = require('../../../loom-canon/art-sets');
const { ToolError } = require('../../registry');
const { createFirestoreWorldReader } = require('./reader');
const { createFirestoreWorldWriter } = require('./writer');
const { worldId, entityId } = require('./schemas');
const { writeTools } = require('./write-tools');
const { townTools } = require('./town-tools');
const { mapTools } = require('./map-tools');
const { levelTools } = require('./level-tools');
const { patchTools } = require('./patch-tools');
const { generatorTools } = require('./generator-tools');
const { studioTools } = require('./studio-tools');
const { materialTools } = require('./material-tools');
const { systemTools } = require('./system-tools');
const { statBlockTools } = require('./stat-block-tools');
const { tokenTools, portraitRows } = require('./token-tools');
const artOf = require('../../../loom-canon/art');
const { currentPath } = require('../../../studio/library');
const { GRADES, BANDS } = require('../../../loom-canon/grading');
const { workList } = require('./work');
const views = require('./views');
const images = require('./images');
const { MAX_SVG_BYTES, isSvg } = require('../../../cartographer/svg');
const { rasterSvg } = require('./svg-raster');
const town = require('../../../loom-canon/town');
const maps = require('../../../loom-canon/maps');
const positions = require('../../../loom-canon/positions');
const sightOf = require('../../../loom-canon/sight');
const levels = require('../../../loom-canon/levels');
const { modelOf } = require('./level-tools');
const figures = require('../../../loom-modules/combat/figures');
const { systemOf } = require('../../../loom-canon/checks');
const tokens = require('../../../loom-canon/tokens');
const sheets = require('../../../loom-canon/sheets');

// The live characters whose position is at `level` and passes `keep`, as
// view_image draws them (L-684): [{ id, name, x, y, place? }].
function peopleAt(world, level, keep) {
  return Object.values(world.characters || {})
    .filter((character) => !character.retired)
    .map((character) => ({ character, at: positions.positionOf(world, character) }))
    .filter(({ at }) => at.level === level && keep(at))
    .map(({ character, at }) => ({
      id: character.id,
      name: character.name,
      x: at.point.x,
      y: at.point.y,
      ...(at.place ? { place: { id: at.place.id, name: at.place.name } } : {}),
    }));
}

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
// Places, realms and regions carry their grade (Unbuilt, Stub, Playable),
// their score and band (Playable, Rich, Vivid, Legendary; L-691) and what
// they are missing (planning/the-loom-layered-worlds.md §4, the-loom-
// grading.md),
// and list_work says what to build next (§6; L-323 / #392).

const APP_ID = 'cartographer';
const MAX_WORLDS = 100;
const DEFAULT_FIND_LIMIT = 20;
const MAX_FIND_LIMIT = 100;
const NEEDS = [
  'description',
  'residents',
  'lore',
  'town',
  'battleMap',
  'ground',
  'drawn',
  'look',
  'townArt',
  'mapArt',
  'features',
  'exits',
  'faction',
  'people',
  'hook',
  'cover',
  'system',
];
const GRADE_HELP =
  'Grades: unbuilt (a layer it needs is missing), stub (import text only), playable ' +
  '(written up: players may enter). Past the gate, a score from 0 to 100 from weighted ' +
  'criteria puts it in a band: playable (under 40), rich (40), vivid (70), legendary (90).';

function cartographerApp({ reader, writer, art, studio, systems }) {
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
          'it is ready to publish, its score and band, how built it is (places, places in town, ' +
          'realms, regions, characters and battle maps counted by band, and the world’s own ' +
          'checklist), counts, ' +
          'its realms (factions) with their regions, its characters and lore, and the art set ' +
          'its maps are drawn with (list_art_sets) and the portraits it offers players for their ' +
          'own token (set_world_tokens). Start here ' +
          'before exploring a world. ' +
          GRADE_HELP,
        inputSchema: { worldId },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { meta, world } = await worldFor(args.worldId);
          // The art set its maps are drawn with (L-944), and a warning when it
          // names one there isn't.
          const art = artSets.setFor(meta);
          return {
            ...views.worldOverview(meta, world),
            art: { set: art.name, ...(art.warning ? { warning: art.warning } : {}) },
            // The portraits it offers players for their own token (L-933).
            tokens: { player: portraitRows(world) },
          };
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
          'steps along connections). Every row carries its grade, score and band; `grade` and ' +
          '`band` filter by one. ' +
          GRADE_HELP,
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
          grade: z.enum(GRADES).optional().describe('Only places with this grade (the gate).'),
          band: z
            .enum(BANDS)
            .optional()
            .describe('Only places in this band (unbuilt and stub are below the gate).'),
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
          'What to build next in a world, most useful first. A place must be Playable for ' +
          'players to enter it, so closed places come first, growing the world outward from ' +
          'where the game is: frontier (closed places next to an open one, the starting ' +
          'location, or places in an open town), then other closed places nearest the start, ' +
          'each with what opens it. Then the work that raises the world’s score most, grouped ' +
          'across places, people, maps, realms and the world ("12 settlements: town art · 90 ' +
          'points · the Cartographer page"): each group names its criterion, the tool that ' +
          'does it, and the entities it is for, most points first. Points are the weight a ' +
          'piece of work adds times how near play its place is. Write a place up with ' +
          'update_location (setting a description marks it written), add residents with ' +
          'add_character and lore with add_lore. Paged: pass nextOffset back as offset; within a ' +
          'criterion, its entities page by entityLimit and entityOffset (nextEntityOffset). ' +
          'unplaced lists the characters still without a position (a square, a town point or a ' +
          'world point), each with a suggested one: publishing refuses the world until ' +
          'everyone has one. ' +
          GRADE_HELP,
        inputSchema: {
          worldId,
          kind: z
            .enum([
              'settlement',
              'poi',
              'place',
              'character',
              'battleMap',
              'faction',
              'region',
              'world',
              'map',
            ])
            .optional()
            .describe(
              'Only this kind of thing (place: a place in town; faction: a realm; map: a map ' +
                'made with add_map, still closed, L-905).'
            ),
          grade: z.enum(GRADES).optional().describe('Only things with this grade (the gate).'),
          band: z
            .enum(BANDS)
            .optional()
            .describe('Only things in this band (unbuilt and stub are below the gate).'),
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
          entityLimit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Entities shown within each criterion (default 10; L-395).'),
          entityOffset: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe(
              'Entities to skip within each criterion: pass a group’s nextEntityOffset back.'
            ),
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
          'One place in full: description, its grade, score and band, what it is missing (most ' +
          'score first) and its checklist (every criterion with its weight and progress), ' +
          'population, region ' +
          'and realm, its connections (by road, trail or sea, with direction, length in miles ' +
          '(from the map: the straight line at its scale, × 1.25 for winding; null if either ' +
          'place has no position) and grade), the characters found there, and the lore about it. A settlement also has ' +
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
          'One realm or faction in full: description, grade, score, band and checklist, ' +
          'government, capital, largest ' +
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
          'One region (province) in full: description, grade, score, band and checklist, its ' +
          'realm, capital, settlements ' +
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
          'grade, residents and lore (loreCount; the town’s coverage in lore: about the town, ' +
          'its places’, and the places with none); which places are ways in and out ' +
          '(entranceFor, and entranceTo for one serving only certain places) and which world ' +
          'routes each serves; and whether the layout works (every place reachable from a written-' +
          'up way in). Build towns with add_place, update_place, connect_places and ' +
          'disconnect_places. `art` is the size of the town’s image, if it has one (uploaded on ' +
          'the Cartographer page): the town view draws it fitted to the town’s 0–1000 square, ' +
          'so set place positions to line up with it. `ground` sums up its buildings, water, ' +
          'walls and crossings (set_town_ground) and what is wrong with the town on them; ' +
          'groundShapes: true adds the shapes themselves, to change a list and send it back. ' +
          GRADE_HELP,
        inputSchema: {
          worldId,
          locationId: entityId('location', 'find_locations'),
          groundShapes: z
            .boolean()
            .optional()
            .describe('Include the ground’s shapes in full (default false: counts and names).'),
        },
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
          return {
            worldId: world.id,
            ...views.townDetail(world, settlement, { groundShapes: Boolean(args.groundShapes) }),
          };
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
          'only its own map adds to its score. Make maps with set_battle_map; assign them with ' +
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
          'spots such as the lever), areas (named stretches such as the back room, each with how ' +
          'many squares it holds), whether it is generic, whether it has an image (uploaded on ' +
          'the Cartographer page), which places use it and which characters stand where (set ' +
          'with add_character or update_character), and its score, band, what it is missing and ' +
          'its checklist (every criterion with its weight and progress). Cells are { x, y } ' +
          'from the top-left, 0-based.',
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
          'fifth line labelled), numbered markers for entries, exits, features, the people ' +
          'standing on it and its figures (coloured by side: red hostile, green party, yellow ' +
          'wary, teal neutral; sightFrom an entry shades what can’t be seen from it), and its ' +
          'areas outlined with their names; its geometry (L-929) is drawn as it is built: ' +
          'floors by material, brighter the higher, walls at any angle, doors by state, ' +
          'windows, objects, zones, spawns, lights, notes and what is hidden, each numbered ' +
          'with the id to patch it by (get_geometry, set_ground and the rest); hidden false ' +
          'draws it as players see it, and from shades what a player standing at a point in ' +
          'feet can’t see. of map draws any grid, or a region or area map made with ' +
          'add_map, in its own units with its places; towns with numbered markers at their places’ positions, the people ' +
          'about town at their town points, their links, the 0–1000 grid, and their ground ' +
          '(set_town_ground: buildings, water, walls and crossings, see-through over the art); ' +
          'the world map with ' +
          'the people in the wilderness at their world points. People are teal diamonds. The ' +
          'legend ties each number to its id, name and cell or position. Without art, a battle ' +
          'map or town is drawn on a plain background, so its layout can still be checked. Art ' +
          'is uploaded on the Cartographer page. Tracing art into data (L-928): look at the ' +
          'map, read where its walls, doors, furniture, streets, houses and water fall on the ' +
          'grid, set them (set_map_layers on a battle map, set_town_ground or set_area_ground on ' +
          'a town), then look again and move what doesn’t sit on the art. A map keeps its art, ' +
          'drawn in place of its floors and walls, so tracing it only makes play match what ' +
          'players see; without art, the data is drawn from its materials.',
        inputSchema: {
          worldId,
          of: z
            .enum(['battleMap', 'map', 'town', 'world'])
            .describe(
              'What to see. map: any grid, or a region or area map made with add_map, drawn ' +
                'from its geometry (list_maps).'
            ),
          id: entityId(
            'battle map, map or settlement',
            'list_battle_maps, list_maps or find_locations'
          )
            .optional()
            .describe(
              'The battle map or map, or the settlement (for its town). Not for the world map.'
            ),
          heights: z
            .boolean()
            .optional()
            .describe('Shade floors by height: higher brighter, lower darker (default true).'),
          sizes: z
            .boolean()
            .optional()
            .describe(
              'A grid: draw each object’s footprint in white with its size in feet ' +
                '("6x4", width x depth), to check the scale of what you placed (L-945; ' +
                'default false).'
            ),
          hidden: z
            .boolean()
            .optional()
            .describe(
              'Draw what is hidden (L-927), marked in magenta (default true: you built it); ' +
                'false draws the map as players see it, without them.'
            ),
          from: z
            .strictObject({ x: z.number().min(0).max(320), y: z.number().min(0).max(320) })
            .optional()
            .describe(
              'A battle map only: a point in feet. Shades what can’t be seen from there, as a ' +
                'player standing there sees it with doors as the map has them (sightFrom does ' +
                'the same from an entry).'
            ),
          sightFrom: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,40}$/)
            .optional()
            .describe(
              'A battle map’s entry id: shade what can’t be seen from it (L-394), as a player ' +
                'arriving there sees it, closed doors shut.'
            ),
        },
        annotations: readOnly,
        handler: async (ctx, args) => {
          const { world } = await worldFor(args.worldId);
          // Art is a library image (its current version, L-704) or an older
          // Storage path.
          const load = async (piece) => {
            let bytes;
            try {
              bytes = await art.load(piece.path || currentPath(piece.imageId));
            } catch {
              throw new ToolError('Its image could not be read from storage.');
            }
            // SVG is drawn in a worker, with a time limit (#744): a drawing
            // that fails says so instead of the request failing.
            if (!isSvg(bytes)) return bytes;
            try {
              return await rasterSvg(Buffer.from(bytes).toString('utf8'), {
                maxSide: images.MAX_SIDE,
              });
            } catch (err) {
              throw new ToolError(`The image can't be shown: ${err.message}.`);
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
            if (args.of === 'battleMap' || args.of === 'map') {
              needId();
              // Any grid is a battle map; a region or area map is drawn from its
              // geometry, in its own units (L-929).
              const grid = (world.battleMaps || {})[args.id];
              const stored = !grid && args.of === 'map' ? (world.maps || {})[args.id] : null;
              const options = {
                heights: args.heights !== false,
                hidden: args.hidden !== false,
                sizes: args.sizes === true,
              };
              if (stored && !stored.retired && ['region', 'area'].includes(stored.kind)) {
                const model = modelOf(world);
                const places = levels
                  .placesOn(model, args.id)
                  .map((id) => ({ id, ...(levels.placeOf(model, id) || {}) }))
                  .filter((p) => !p.retired);
                rendered = images.renderMap(stored, places, options);
              } else {
                if (args.of === 'map' && !grid) {
                  throw new ToolError(
                    `"${args.id}" is no grid, or region or area map made with add_map. ` +
                      'list_maps shows them; a world map or town in today’s shape is seen with ' +
                      'of world or town.'
                  );
                }
                const map = entityFor(
                  world,
                  'battleMaps',
                  args.id,
                  'battle map',
                  'Use list_battle_maps to see them.'
                );
                // Who stands on it (L-684), at whichever place's copy, and its
                // figures (L-394), each with their side.
                const people = maps
                  .standingOn(world, map)
                  .map(({ character, host, cell }) => ({
                    id: character.id,
                    name: character.name,
                    x: cell.x,
                    y: cell.y,
                    side: character.side || 'neutral',
                    at: { id: host.id, name: host.name },
                    width: sheets.widthOf(character.sheet),
                    token: tokens.tokenOf(character, world),
                  }))
                  .concat(
                    (map.figures || []).flatMap((g) =>
                      figures.instancesOf(systemOf(world), g, world).map((f) => ({
                        id: f.id,
                        name: f.name,
                        x: f.cell.x,
                        y: f.cell.y,
                        side: f.side,
                        figure: g.id,
                        width: sheets.widthOf(f.sheet),
                        token: f.token || null,
                      }))
                    )
                  );
                // Their token pictures (L-932), each image read once; one
                // that can't be read is drawn plain.
                const pictures = {};
                for (const p of people) {
                  const t = p.token;
                  if (!t || pictures[t.imageId] !== undefined) continue;
                  try {
                    pictures[t.imageId] = await images.tokenPixels(
                      await art.load(currentPath(t.imageId))
                    );
                  } catch {
                    pictures[t.imageId] = null;
                  }
                }
                people.forEach((p) => {
                  p.token =
                    p.token && pictures[p.token.imageId]
                      ? { image: pictures[p.token.imageId], crop: tokens.cropOf(p.token) }
                      : null;
                });
                // What can be seen from an entry (L-394), or from a point in feet.
                let sight = null;
                if (args.sightFrom && args.from) {
                  throw new ToolError('Give sightFrom (an entry) or from (a point), not both.');
                }
                if (args.sightFrom) {
                  const entry = (map.entries || []).find((e) => e.id === args.sightFrom);
                  if (!entry) {
                    throw new ToolError(
                      `${map.name} has no entry "${args.sightFrom}" (` +
                        ((map.entries || []).map((e) => e.id).join(', ') || 'none') +
                        ').'
                    );
                  }
                  sight = { from: entry.id, seen: sightOf.inSight(map, entry, {}) };
                } else if (args.from) {
                  const cell = { x: Math.floor(args.from.x / 5), y: Math.floor(args.from.y / 5) };
                  if (!maps.inBounds(map, cell)) {
                    throw new ToolError(
                      `(${args.from.x}, ${args.from.y}) ft is off ${map.name}'s ${map.width} × ` +
                        `${map.height} grid (${map.width * 5} × ${map.height * 5} ft).`
                    );
                  }
                  sight = {
                    from: `${args.from.x}, ${args.from.y} ft`,
                    seen: sightOf.inSight(map, { cell, point: args.from }, {}),
                  };
                }
                const mapPiece = artOf.mapArt(map);
                rendered = images.renderBattleMap(
                  map,
                  mapPiece ? await load(mapPiece) : null,
                  people,
                  { sight, ...options }
                );
              }
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
              const townArt = artOf.townArt(settlement);
              rendered = images.renderTown(
                world,
                settlement,
                town.placesOf(world, settlement.id),
                townArt ? await load(townArt) : null,
                peopleAt(world, 'town', (at) => at.settlement.id === settlement.id)
              );
            } else {
              const worldArt = artOf.worldMapArt(world);
              if (!worldArt) {
                throw new ToolError(
                  'This world has no map image: it was imported without one. Assign one with ' +
                    'studio_assign (target map).'
                );
              }
              rendered = images.renderWorld(
                world,
                await load(worldArt),
                peopleAt(world, 'world', (at) => !at.location)
              );
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
          // The art is a library image now (L-704), with the studio's shape
          // checks.
          const warnings = result.warnings || [];
          const size = result.image;
          return {
            of: args.of,
            id: args.id,
            name: result.name,
            art: size
              ? {
                  imageId: size.imageId,
                  format: size.format,
                  width: size.width,
                  height: size.height,
                }
              : null,
            ...(warnings.length ? { warnings } : {}),
            ...(size ? { next: 'Check it with view_image.' } : {}),
          };
        },
      },
      {
        name: 'get_character',
        title: 'Get character',
        description:
          'One character in full: description, faction, where they are found, their score and ' +
          'band, what they are missing and their checklist (every criterion with its weight and ' +
          'progress), and lore.',
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
      ...writeTools({ writer, systems, studio }),
      // Named stat blocks and sheets in bulk (L-393).
      ...statBlockTools({ writer, worldFor }),
      ...townTools({ writer }),
      ...mapTools({ writer }),
      ...levelTools({ writer, worldFor }),
      ...patchTools({ writer, worldFor }),
      // Seeded generators (L-929): a first draft of a battle map to edit.
      ...generatorTools({ writer }),
      // Materials and the object catalog (L-925): list them, give a world's own art.
      ...materialTools({ studio, writer, worldFor }),
      ...tokenTools({ studio, writer, worldFor }),
      ...(studio ? studioTools({ studio, reader, writer }) : []),
      // Game systems (L-801): list, get, set and copy them.
      ...(systems ? systemTools({ systems, reader }) : []),
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
  // The image studio, built once on first use (functions/studio/index.js).
  const studio = () => require('../../../studio').studio();
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
      // The image studio: assigning library images to worlds (L-704), the
      // library itself (L-703), its costs (L-706), generation (L-707) and
      // styles (L-709).
      studio: {
        assign: (uid, args) => cartographer().assignImage(uid, args),
        library: () => studio().library,
        costs: () => studio().costs,
        jobs: () => studio().jobs,
        styles: () => studio().styles,
        load: async (path) => (await getStorage().bucket().file(path).download())[0],
      },
      // Game systems (L-801), in loom_systems.
      systems: require('../../../loom-canon/systems').createSystemStore(getFirestore),
    })
  );
}

module.exports = { register, cartographerApp, APP_ID };
