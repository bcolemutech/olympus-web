'use strict';

const crypto = require('crypto');
const { z } = require('zod');
const { ToolError } = require('../../registry');
const geo = require('../../../loom-canon/map-geometry');
const generators = require('../../../loom-canon/map-generators');
const dress = require('../../../loom-canon/dress');
const scale = require('../../../loom-canon/scale');
const patcher = require('../../../loom-canon/geometry-patch');
const materials = require('../../../loom-canon/materials');
const hazards = require('../../../loom-canon/hazards');
const { systemOf } = require('../../../loom-canon/checks');
const { worldId, entityId } = require('./schemas');
const { helpers } = require('./write-tools');
const mapTools = require('./map-tools');
const views = require('./views');

// Seeded map generators over MCP (planning/maps-from-data.md §4.8, AU2;
// L-929 / #733): generate_map makes a first draft of a grid battle map
// (../../../loom-canon/map-generators.js) and writes it as an ordinary battle
// map, for Claude to name and edit with the patch tools (set_zones,
// set_objects, set_hidden…). Decided with the user 2026-11-06: one tool that
// writes a new battle map, or replaces a given map's grid as set_battle_map
// does (players forget what they had seen of it); structure and sparse
// dressing; decks sailing or starship.
//
// The map is generated before the edit (the writer may run its change again
// when the world moves under it, and the same seed makes the same map), and
// its kind, seed and style are kept in `sources.generated`, so it can be made
// again.

const { live, newId } = helpers;

const KIND_WORDS = {
  rooms: 'rooms and corridors cut into rock (a dungeon)',
  caves: 'a cave, its walls at angles, with side passages and rock pillars',
  interior: 'a building’s ground floor in its street, rooms with a door between each',
  deck: 'a ship’s deck: sailing (a wooden deck in the sea) or starship (a metal hull)',
  wilds:
    'the wilderness for an event on the way: a terrain (a ground material) and a scene, ' +
    generators.SCENES.join(', '),
};

function generatorTools({ writer }) {
  const sizes = Object.entries(generators.SIZES)
    .map(
      ([kind, s]) => `${kind} ${s.width} × ${s.height} (at least ${s.min.width} × ${s.min.height})`
    )
    .join(', ');
  return [
    {
      name: 'generate_map',
      title: 'Generate a battle map',
      description:
        'Make a first draft of a battle map from a seed, as ordinary data to edit. Kinds: ' +
        Object.entries(KIND_WORDS)
          .map(([k, w]) => `${k}, ${w}`)
          .join('; ') +
        '. The same kind, seed, size and style always make the same map; leave out the seed ' +
        'for a new one (the answer says the seed used). It comes with floors, walls, doors ' +
        'and windows, its rooms as zones with no name (room-1…, cabin, bridge), a light or two ' +
        'and a little furniture, one entry and one exit "out". Every map is playable: the ' +
        'entry reaches the exit and every room. No hidden things, spawns or features: add ' +
        'them, name the rooms (set_zones), move the exit (set_exits) and change anything ' +
        'with the set_ tools; view_image draws it. Sizes in squares of 5 ft, by default ' +
        sizes +
        ', at most 64. Leave out mapId to make a new map; give it to replace that map’s grid ' +
        '(players forget what they had seen of it, as with set_battle_map). Assign it with ' +
        'assign_battle_map. A wilds map (L-365) is open country: its terrain (' +
        generators.TERRAINS.join(', ') +
        ') is its ground, with patches of a neighbour; its scene (clearing, forest-track, ford, ' +
        'ridge, marsh-path or ruins; by default its terrain’s likeliest) its shape: trees, ' +
        'bushes, rocks and fallen logs, a path or track, a river crossed only at its ford, a ' +
        'ridge’s slope and cliff, a marsh’s pools, broken walls. It has a way in and an exit on ' +
        'two or three edges, each reaching the others, three-square spawn areas (spawn-1…) away ' +
        'from them, and its scene’s zone (clearing, track, ford, ridge, cliff-foot, causeway, ' +
        'ruins); no lights but a campfire’s. It is made generic for its scene and terrain ' +
        '(generic: { kind: scene, terrain }) unless you say otherwise. Works on drafts and ' +
        'published worlds; a change to a published world reaches games on their next turn.',
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps')
          .optional()
          .describe('The map whose grid to replace; leave out to make a new one.'),
        name: mapTools.shapes.label.describe('e.g. "The drowned crypt".'),
        kind: z.enum(generators.KINDS),
        seed: z
          .union([z.number().int().min(0).max(2147483647), z.string().trim().min(1).max(60)])
          .optional()
          .describe('A number or a word: the same seed, the same map.'),
        width: z.number().int().min(10).max(64).optional().describe('In squares.'),
        height: z.number().int().min(10).max(64).optional().describe('In squares.'),
        style: z
          .enum(generators.STYLES.deck)
          .optional()
          .describe('A deck’s: sailing (the default) or starship.'),
        terrain: z
          .enum(generators.TERRAINS)
          .optional()
          .describe('A wilds map’s ground: grass by default.'),
        scene: z
          .enum(generators.SCENES)
          .optional()
          .describe('A wilds map’s scene: by default its terrain’s likeliest.'),
        generic: mapTools.shapes.generic.nullable().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: (ctx, args) => {
        const seed = args.seed === undefined ? crypto.randomInt(1, 1000000) : args.seed;
        let made;
        try {
          made = generators.generate(args.kind, {
            seed,
            width: args.width,
            height: args.height,
            style: args.style,
            terrain: args.terrain,
            scene: args.scene,
          });
        } catch (err) {
          throw new ToolError(err.message);
        }
        return writer.edit(args.worldId, ctx.uid, (e) => {
          const { world } = e;
          const before = args.mapId ? live(world, 'battleMap', args.mapId) : null;
          const id = before ? before.id : newId(world, 'battleMap', 'bm', args.name);
          const def = {
            name: args.name,
            width: made.width,
            height: made.height,
            entries: made.entries,
            exits: made.exits,
            features: [],
          };
          mapTools.checkMap(world, id, def);
          def.geometry = geo.normalize(made.geometry);
          def.areas = [];
          // Its hazards and figures are kept, as set_battle_map keeps them,
          // and any hazard that no longer fits is said.
          def.hazards = (before && before.hazards) || [];
          def.figures = (before && before.figures) || [];
          const misfit = def.hazards.length
            ? hazards.validate(systemOf(world), def, def.hazards).errors
            : [];
          const generated = {
            kind: made.kind,
            seed: made.seed,
            ...(made.style ? { style: made.style } : {}),
            ...(made.scene ? { terrain: made.terrain, scene: made.scene } : {}),
            version: generators.VERSION,
          };
          // A wilds map serves any place of its scene and terrain (EV5).
          const ownGeneric = made.scene ? { kind: made.scene, terrain: made.terrain } : null;
          const doc = {
            id,
            ...mapTools.stored(def),
            image: before ? before.image || null : null,
            generic:
              args.generic === undefined
                ? before
                  ? before.generic || ownGeneric
                  : ownGeneric
                : args.generic,
            sources: { map: 'mcp', generated },
            // A replaced grid is a new map to players (loom-turn/seen.js).
            ...(before ? { revision: (before.revision || 0) + 1 } : {}),
          };
          e.set(e.ref('battleMaps', id), doc);
          const result = {
            map: views.battleMapRow(
              { ...world, battleMaps: { ...world.battleMaps, [id]: doc } },
              doc
            ),
            generated: { ...generated, width: made.width, height: made.height },
            counts: Object.fromEntries(
              Object.entries(def.geometry).map(([k, list]) => [k, list.length])
            ),
            rooms: (def.geometry.zones || []).map((z) => z.id),
            ...(made.scene ? { spawns: (def.geometry.spawns || []).map((sp) => sp.id) } : {}),
            entries: made.entries,
            exits: made.exits,
            next:
              'view_image it; name its rooms (set_zones), its doors and objects (set_doors, ' +
              'set_objects); add features, hidden things and spawns; move the exit or point ' +
              'it at another map (set_exits); assign it to a place (assign_battle_map).',
          };
          if (!before) result.created = true;
          const warnings = [
            ...mapTools.standingWarnings(world, doc),
            ...scale.warnings(def.geometry, { worldKinds: world.objectKinds }),
          ];
          if (misfit.length) {
            warnings.push(
              `Its hazards no longer fit it: ${misfit.join(' ')} Fix them with set_hazards.`
            );
          }
          if (before && (before.areas || []).length) {
            warnings.push(
              'Its old areas are gone: its rooms are zones now (set_zones names them).'
            );
          }
          if (before) {
            warnings.unshift(
              'Players who had explored it start over: what they had seen of it is forgotten.'
            );
          }
          if (warnings.length) result.warnings = warnings;
          return result;
        });
      },
    },
    {
      name: 'dress_room',
      title: 'Dress a room with decor',
      description:
        'Fill a zone of a battle map with decor (rubble, bones, candles, cobwebs, sacks, a pile ' +
        'of crates, a tapestry, a banner, a plant, books, bottles, straw, a puddle, chains), ' +
        'seeded, so a room built from data isn’t empty. Decor only dresses: no click menu, ' +
        'never noticed or searched, and it blocks the way only when it’s over 2.5 ft both ways ' +
        '(a pile of crates does). `zone` is a zone of the map (set_zones; generate_map’s rooms ' +
        'are room-1…). Themes: ' +
        dress.themeNames().join(', ') +
        '. Density: sparse, lived-in or cluttered, for the room’s size. The same seed makes the ' +
        'same dressing; leave out the seed for a new one (the answer says the seed used). It ' +
        'keeps clear of doors, windows, entries, exits, features, walls and the objects already ' +
        'there, hangs tapestries, banners and chains on walls, and never closes the room: a ' +
        'piece that blocks is put down only if a medium character still crosses from the ' +
        'room’s middle to every way in and out. Dressing the zone again replaces what an ' +
        'earlier dressing put there (ids "<zone>-decor-1…"); everything it made is ordinary ' +
        'objects, to edit with set_objects (remove what you don’t want, move or add). Works on ' +
        'drafts and published worlds; a change to a published world reaches games on their ' +
        'next turn, and never makes players forget what they have seen.',
      inputSchema: {
        worldId,
        mapId: entityId('battle map', 'list_battle_maps'),
        zone: z
          .string()
          .regex(/^[a-z0-9][a-z0-9-]{0,39}$/, 'a zone’s id: "room-1", "cellar"')
          .describe('The zone to dress (set_zones, get_geometry).'),
        theme: z.enum(dress.themeNames()),
        density: z.enum(Object.keys(dress.DENSITIES)),
        seed: z
          .union([z.number().int().min(0).max(2147483647), z.string().trim().min(1).max(60)])
          .optional()
          .describe('A number or a word: the same seed, the same dressing.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: (ctx, args) => {
        const seed = args.seed === undefined ? crypto.randomInt(1, 1000000) : args.seed;
        return writer.edit(args.worldId, ctx.uid, (e) => {
          const { world } = e;
          const before = live(world, 'battleMap', args.mapId);
          let made;
          try {
            made = dress.dress(before, {
              zone: args.zone,
              theme: args.theme,
              density: args.density,
              seed,
              worldKinds: world.objectKinds,
            });
          } catch (err) {
            throw new ToolError(err.message);
          }
          const bounds = { width: before.width * 5, height: before.height * 5 };
          const stored = before.geometry || {};
          // What an earlier dressing of the zone put there goes first.
          const old = (stored.objects || [])
            .filter(
              (o) =>
                typeof o.id === 'string' && o.id.indexOf(made.prefix) === 0 && materials.isDecor(o)
            )
            .map((o) => o.id);
          let geometry = stored;
          if (old.length) {
            const cleared = patcher.patch(geometry, 'objects', { remove: old }, bounds);
            if (cleared.problems) throw new ToolError(cleared.problems.slice(0, 10).join(' '));
            geometry = cleared.geometry;
          }
          if (made.objects.length) {
            const done = patcher.patch(geometry, 'objects', { set: made.objects }, bounds);
            if (done.problems) throw new ToolError(done.problems.slice(0, 10).join(' '));
            geometry = done.geometry;
          }
          e.update(e.ref('battleMaps', before.id), { geometry });
          const after = { ...before, geometry };
          const warnings = [...mapTools.standingWarnings(world, after)];
          if (made.skipped) {
            warnings.push(
              `${made.skipped} of ${made.wanted} pieces had no room that kept clear of the doors, ` +
                'walls and what is there: a bigger zone or a lower density fits more.'
            );
          }
          return {
            map: { mapId: before.id, name: before.name, kind: 'grid' },
            zone: made.zone,
            theme: made.theme,
            density: made.density,
            seed: made.seed,
            wanted: made.wanted,
            placed: made.objects.length,
            skipped: made.skipped,
            byKind: made.byKind,
            replaced: old.length,
            objects: made.objects.map((o) => o.id),
            ...(warnings.length ? { warnings } : {}),
            next:
              'view_image the map (sizes: true shows each footprint); edit with set_objects ' +
              '(remove what you don’t want); dress another zone.',
          };
        });
      },
    },
  ];
}

module.exports = { generatorTools };
