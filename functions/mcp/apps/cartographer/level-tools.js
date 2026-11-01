'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const { normalizeName } = require('../../../loom-turn/interpret');
const levels = require('../../../loom-canon/levels');
const frames = require('../../../loom-canon/frames');
const ground = require('../../../loom-canon/ground');
const town = require('../../../loom-canon/town');
const { gradeMaps, isGraded } = require('../../../loom-canon/grading');
const { SOURCES } = require('../../../cartographer/sources');
const { worldId, entityId } = require('./schemas');
const mapTools = require('./map-tools');
const { GROUND_SHAPES, withoutBlanks } = require('./town-tools');

// The Cartographer's map tools at any depth (planning/map-levels.md §4.7,
// UI3; L-905 / #723): Claude builds maps inside maps with tools that take a
// map. They write the levels model (../../../loom-canon/levels.js): maps in
// `maps`, places in the new shape in `places` (a `mapId`, `at`, `opens`,
// `links`, `exits`). Today's tools (add_locations, connect_locations,
// add_place in a town, set_battle_map, set_town_ground) stay as shortcuts:
// they write today's shape, which play and these tools read as the model
// (level-plan.js modelOf), so their changes show up here.
//
// A grid's layers live in its battle map of the same id (as migrated grids'
// do), so every grid tool (set_map_layers, set_hazards, place_figures with
// cell "auto", view_image) works on it at any depth.
//
//   add_map          a region, area or grid map under a place (or the world's
//                    top map), with its space
//   get_map          a map: its space, its places, the maps inside it and its
//                    trail
//   list_maps        the world's maps as a tree, each with its grade
//   add_places       places on a region or area map, linked in one call
//                    (add_place takes a mapId for one)
//   connect_places   (in town-tools.js) links places on a map, too
//   add_exit         an exit from a place to a place on any map (TV3), or
//                    stairs between two grids, one way or both (twoWay) in
//                    one call
//   set_grid         a grid's entries, exits, features and layers
//   set_area_ground  an area map's ground

const MAX_PLACES = 50;
const MAX_LINKS = 12;
const ROUTE = /^[a-z][a-z-]{0,23}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// The world as the model has it: stored maps and places over the plan of
// today's shape, with places in the new shape seen as play sees them.
const modelOf = (world) => frames.playWorld(world);

// A new id for a map or place, unique among both.
function freshId(model, prefix, label) {
  const slug = normalizeName(label).slice(0, 40).replace(/-+$/, '') || prefix;
  const taken = (id) =>
    Boolean(
      (model.maps || {})[id] ||
      (model.places || {})[id] ||
      (model.mapPlaces || {})[id] ||
      (model.locations || {})[id] ||
      (model.battleMaps || {})[id]
    );
  const base = `${prefix}_${slug}`;
  let id = base;
  for (let n = 2; taken(id); n += 1) id = `${base}-${n}`;
  return id;
}

function mapIn(model, mapId) {
  const map = levels.mapOf(model, mapId);
  if (!map) throw new ToolError(`No map "${mapId}". list_maps shows the world's maps.`);
  if (map.retired) throw new ToolError(`${map.name || mapId} is retired.`);
  return map;
}

function placeIn(model, placeId) {
  const place = levels.placeOf(model, placeId);
  if (!place) {
    throw new ToolError(`No place "${placeId}" on any map. get_map lists a map's places.`);
  }
  if (place.retired) throw new ToolError(`${place.name || placeId} is retired.`);
  return place;
}

// A place stored in the new shape (one these tools may change), or why not.
function storedPlace(world, placeId, what) {
  const place = (world.mapPlaces || {})[placeId];
  if (place) return place;
  throw new ToolError(
    `${what} "${placeId}" is a place in today's shape (a location or a place in town): change ` +
      'it with its own tools (connect_locations, add_place with a locationId), or use places ' +
      'made with add_places.'
  );
}

// What a place says to a builder.
function placeRow(model, id) {
  const p = levels.placeOf(model, id) || {};
  return {
    id,
    name: p.name || id,
    kind: p.kind || null,
    ...(p.at ? { at: p.at } : {}),
    ...(p.entrance ? { wayInAndOut: true } : {}),
    ...(isObject(p.opens) ? { opens: p.opens.mapId || p.opens.template } : {}),
    ...((p.links || []).length
      ? { links: p.links.map((l) => ({ placeId: l.placeId, kind: l.kind || null })) }
      : {}),
    ...((p.exits || []).length ? { exits: p.exits } : {}),
    ...(p.retired ? { retired: true } : {}),
  };
}

function mapRow(model, mapId) {
  const m = levels.mapOf(model, mapId) || {};
  return {
    mapId,
    kind: m.kind || null,
    name: m.name || mapId,
    parent: m.parent || null,
    space: m.space || null,
    ...(m.routeKinds ? { routeKinds: m.routeKinds } : {}),
    ...(m.backdrop ? { backdrop: m.backdrop } : {}),
    ...(m.retired ? { retired: true } : {}),
  };
}

// The node of a map in the graded tree, or null.
function findNode(node, mapId) {
  if (!node) return null;
  if (node.mapId === mapId) return node;
  for (const child of node.children || []) {
    const found = findNode(child, mapId);
    if (found) return found;
  }
  return null;
}

// The places to add, checked against their map: names unique on it, points
// inside it, links to places on it or in the batch. Queues their writes.
function addPlacesTo(e, mapId, list) {
  const { world } = e;
  const model = modelOf(world);
  const map = mapIn(model, mapId);
  if (map.kind === 'grid') {
    throw new ToolError(
      `${map.name} is a grid: give it entries, exits and features with set_grid, not places.`
    );
  }
  const { width, height } = map.space || {};
  const onMap = new Map(levels.placesOn(model, mapId).map((id) => [id, levels.placeOf(model, id)]));
  const names = new Set([...onMap.values()].map((p) => normalizeName(p.name || '')));
  const made = [];
  const byName = new Map();
  for (const item of list) {
    const key = normalizeName(item.name);
    if (names.has(key))
      throw new ToolError(`${map.name} already has a place named "${item.name}".`);
    names.add(key);
    if (item.at && (item.at.x > width || item.at.y > height)) {
      throw new ToolError(
        `"${item.name}" at (${item.at.x}, ${item.at.y}) is off ${map.name} (0–${width}, 0–${height}).`
      );
    }
    const id = freshId(
      { ...model, places: { ...model.places, ...Object.fromEntries(made.map((m) => [m.id, 1])) } },
      'pl',
      item.name
    );
    made.push({ id, item });
    byName.set(key, id);
  }
  const resolve = (to) => {
    if (onMap.has(to) || made.some((m) => m.id === to)) return to;
    const id = byName.get(normalizeName(to));
    if (id) return id;
    const other = levels.placeOf(model, to);
    if (other) {
      throw new ToolError(
        `"${to}" is on another map (${other.mapId}): links stay on one map; use add_exit to ` +
          'go between maps.'
      );
    }
    throw new ToolError(`No place "${to}" on ${map.name} or in this call to link to.`);
  };
  const docs = {};
  const back = [];
  for (const { id, item } of made) {
    const links = (item.links || []).map((l) => ({
      placeId: resolve(typeof l === 'string' ? l : l.to),
      kind: (typeof l === 'string' ? null : l.kind) || null,
    }));
    docs[id] = {
      id,
      mapId,
      name: item.name,
      kind: item.kind,
      description: item.description,
      sources: { description: SOURCES.MCP },
      ...(item.at ? { at: { x: item.at.x, y: item.at.y } } : {}),
      ...(item.entrance ? { entrance: map.kind === 'area' ? { via: [] } : true } : {}),
      links,
      npcIds: [],
      rules: {},
    };
    for (const l of links) back.push([l.placeId, { placeId: id, kind: l.kind }]);
  }
  // Links both ways: on places of this call, and on those already there.
  for (const [to, link] of back) {
    if (docs[to]) {
      if (!docs[to].links.some((l) => l.placeId === link.placeId)) docs[to].links.push(link);
    } else {
      storedPlace(world, to, 'The place to link to');
      e.update(e.ref('places', to), 'links', FieldValue.arrayUnion(link));
    }
  }
  const check = {
    ...model,
    mapPlaces: { ...(model.mapPlaces || {}), ...docs },
  };
  for (const [id, doc] of Object.entries(docs)) {
    const errors = levels.validatePlace(check, doc, id);
    if (errors.length) throw new ToolError(errors.join(' '));
    e.create(e.ref('places', id), doc);
  }
  return {
    map: { mapId, name: map.name, kind: map.kind },
    places: Object.keys(docs).map((id) => placeRow(check, id)),
  };
}

// Schemas.
const point = z.strictObject({ x: z.number().min(0), y: z.number().min(0) });
const square = z.strictObject({
  x: z.number().int().min(0).max(63),
  y: z.number().int().min(0).max(63),
});
const placeKind = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z -]{1,29}$/, 'kind must be a word or two, e.g. planet, station, dock')
  .describe('What it is: star, planet, station, dock, market, …');
const linkTo = z.union([
  z.string().trim().min(1).max(80),
  z.strictObject({
    to: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe('A place on the map, by id, or by name in this call.'),
    kind: z.string().regex(ROUTE).optional().describe('The route kind: road, sea, jump, …'),
  }),
]);
const newPlace = z.strictObject({
  name: z.string().trim().min(1).max(80),
  kind: placeKind,
  description: z.string().trim().min(1).max(4000).describe('What a visitor finds here.'),
  at: point.describe('Where on the map, in its units.'),
  entrance: z
    .boolean()
    .optional()
    .describe('A way in and out of the map: travellers coming down arrive here, and leave by it.'),
  links: z
    .array(linkTo)
    .max(MAX_LINKS)
    .optional()
    .describe('Places on the same map it links to (two-way), by id or by name in this call.'),
});
const routeKinds = z
  .record(
    z.string().regex(ROUTE),
    z.strictObject({
      speed: z.number().positive().max(1e9).describe('Map units an hour.'),
      roundTheClock: z.boolean().optional().describe('Travelled through the night (the sea).'),
    })
  )
  .describe('Route kinds on a region map and their speeds (TV1): { jump: { speed: 2 } }.');

function levelTools({ writer, worldFor }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
  const readOnly = { readOnlyHint: true };
  const editNote =
    'Changes the world for everyone at once, published or not (games see it on their next turn).';
  const read = async (ctx, args, fn) => fn((await worldFor(args.worldId)).world);

  return [
    {
      name: 'add_map',
      title: 'Add a map',
      description:
        'Add a map inside a place, at any depth (a star system inside a sector, a station ' +
        'inside a system, a deck inside a station): kind region (places and routes, its own ' +
        'unit and route kinds: light-years and jump lanes), area (places and paths, a size in ' +
        'metres; ground with set_area_ground) or grid (squares, at most 64 × 64; its entries ' +
        'and exits here or with set_grid). parentPlaceId is the place it opens from; a world ' +
        'with no maps yet takes its first region map as its top. Under a place in today’s ' +
        'shape (a location or a place in town) only a grid can be added: it becomes that ' +
        'place’s battle map. A region map is entered by its ways in (add_places with ' +
        'entrance). ' +
        editNote,
      inputSchema: {
        worldId,
        kind: z.enum(['region', 'area', 'grid']),
        name: z.string().trim().min(1).max(80),
        parentPlaceId: entityId('place', 'get_map').optional(),
        width: z
          .number()
          .positive()
          .max(100000)
          .describe('Across, in map units (a grid: squares).'),
        height: z.number().positive().max(100000).describe('Down, in map units (a grid: squares).'),
        unit: z
          .string()
          .trim()
          .min(1)
          .max(12)
          .optional()
          .describe('A region map’s unit: mi, km, ly, AU …'),
        perUnit: z.number().positive().optional().describe('How many units one map unit is.'),
        routeKinds: routeKinds.optional(),
        size: z.number().positive().max(20000).optional().describe('An area map’s metres across.'),
        backdrop: z.string().regex(COLOUR).optional().describe('A plain colour, #rrggbb.'),
        entries: z.array(mapTools.shapes.entry).max(20).optional(),
        exits: z.array(mapTools.shapes.exit).max(20).optional(),
        features: z.array(mapTools.shapes.feature).max(60).optional(),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const model = modelOf(world);
          const hasTop = Boolean(model.topMapId && levels.mapOf(model, model.topMapId));
          if (!args.parentPlaceId && hasTop) {
            throw new ToolError(
              'Give parentPlaceId, the place it opens from (the world has a top map already).'
            );
          }
          if (!args.parentPlaceId && args.kind !== 'region') {
            throw new ToolError('A world’s top map is a region map.');
          }
          const parent = args.parentPlaceId ? placeIn(model, args.parentPlaceId) : null;
          const legacyHost =
            parent &&
            ((world.locations || {})[args.parentPlaceId] ||
              ((world.places || {})[args.parentPlaceId] &&
                (world.places || {})[args.parentPlaceId].locationId));
          if (legacyHost && args.kind !== 'grid') {
            throw new ToolError(
              `${parent.name} is in today’s shape: give it a grid (its battle map), or open a ` +
                'town in it with add_place.'
            );
          }
          if (
            args.kind === 'grid' &&
            (!Number.isInteger(args.width) ||
              !Number.isInteger(args.height) ||
              args.width > 64 ||
              args.height > 64)
          ) {
            throw new ToolError('A grid is whole squares, at most 64 × 64.');
          }
          const id =
            args.kind === 'grid'
              ? freshId(model, 'bm', args.name)
              : freshId(model, 'map', args.name);
          const space = { width: args.width, height: args.height };
          if (args.kind === 'region' && args.unit) {
            space.distance = { unit: args.unit, perUnit: args.perUnit || 1 };
          }
          if (args.kind === 'area' && args.size) space.size = args.size;
          if (args.kind === 'grid') space.squareSize = 1.5;
          const doc = {
            kind: args.kind,
            parent: parent ? { mapId: parent.mapId, placeId: args.parentPlaceId } : null,
            name: args.name,
            space,
            ...(args.kind === 'region' && args.routeKinds ? { routeKinds: args.routeKinds } : {}),
            ...(args.backdrop ? { backdrop: args.backdrop } : {}),
            sources: { map: SOURCES.MCP },
          };
          const errors = levels.validateMap(doc, id);
          if (errors.length) throw new ToolError(errors.join(' '));
          e.set(e.ref('maps', id), doc);
          if (!parent) e.updateWorld({ topMapId: id });
          // A grid's layers: its battle map of the same id.
          let warnings = [];
          if (args.kind === 'grid') {
            const def = {
              name: args.name,
              width: args.width,
              height: args.height,
              entries: args.entries || [{ id: 'in', x: 0, y: Math.floor(args.height / 2) }],
              exits: args.exits || [],
              features: args.features || [],
            };
            mapTools.checkMap(world, id, def);
            const bm = {
              id,
              ...def,
              walls: [],
              doors: [],
              obstacles: [],
              areas: [],
              hazards: [],
              figures: [],
              image: null,
              generic: null,
              sources: { map: SOURCES.MCP },
            };
            e.set(e.ref('battleMaps', id), bm);
            if (!def.exits.length) {
              warnings.push('It has no exits yet: add them with set_grid or add_exit.');
            }
            // Under a place in today's shape: its battle map.
            if (legacyHost && !(legacyHost.battleMap && legacyHost.battleMap.mapId)) {
              const collection = (world.locations || {})[args.parentPlaceId]
                ? 'locations'
                : 'places';
              e.update(e.ref(collection, args.parentPlaceId), 'battleMap', { mapId: id });
            }
          }
          // The place it opens from opens it (the first map under a place).
          const stored = parent && (world.mapPlaces || {})[args.parentPlaceId];
          if (stored && !isObject(stored.opens)) {
            e.update(e.ref('places', args.parentPlaceId), 'opens', { mapId: id });
          } else if (stored && isObject(stored.opens)) {
            warnings.push(
              `${parent.name} already opens ${stored.opens.mapId}: this map sits under it too, ` +
                'reached by exits (add_exit).'
            );
          }
          return {
            map: { mapId: id, kind: args.kind, name: args.name, parent: doc.parent },
            created: true,
            ...(!parent ? { top: true } : {}),
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
    {
      name: 'get_map',
      title: 'Get a map',
      description:
        'A map at any depth: its kind and space, its places (where, links, exits, what they ' +
        'open), the maps inside it, its trail from the top map down, and its grade and what ' +
        'it lacks. A world in today’s shape reads as maps too: its world map is map_world, ' +
        'each town map_town_<location>, each battle map a grid of the same id.',
      inputSchema: { worldId, mapId: entityId('map', 'list_maps') },
      annotations: readOnly,
      handler: (ctx, args) =>
        read(ctx, args, (world) => {
          const model = modelOf(world);
          mapIn(model, args.mapId);
          const chain = levels.parentChain(model, args.mapId);
          const node = isGraded(world) ? findNode(gradeMaps(world), args.mapId) : null;
          return {
            map: mapRow(model, args.mapId),
            trail: chain.map((id) => ({ mapId: id, name: (model.maps[id] || {}).name || id })),
            places: levels.placesOn(model, args.mapId).map((id) => placeRow(model, id)),
            children: levels.childrenOf(model, args.mapId).map((id) => ({
              mapId: id,
              kind: model.maps[id].kind,
              name: model.maps[id].name || id,
              opensFrom: model.maps[id].parent.placeId,
            })),
            ...(node
              ? {
                  grade: {
                    grade: node.grade,
                    band: node.band,
                    score: node.score,
                    lacks: node.lacks,
                  },
                }
              : {}),
            ...((model.battleMaps || {})[args.mapId]
              ? {
                  grid: {
                    entries: model.battleMaps[args.mapId].entries || [],
                    exits: model.battleMaps[args.mapId].exits || [],
                    features: (model.battleMaps[args.mapId].features || []).length,
                  },
                }
              : {}),
          };
        }),
    },
    {
      name: 'list_maps',
      title: 'List maps',
      description:
        'The world’s maps as a tree from its top map, each with its kind and, for a draft or ' +
        'published world, its grade, band and what it lacks; maps no place opens are listed ' +
        'as orphans.',
      inputSchema: { worldId },
      annotations: readOnly,
      handler: (ctx, args) =>
        read(ctx, args, (world) => {
          const model = modelOf(world);
          const graded = isGraded(world) ? gradeMaps(world) : null;
          const tree = levels.treeOf(model);
          return {
            topMapId: model.topMapId || null,
            tree: graded || tree.top,
            orphans: tree.orphans.map((o) => ({ mapId: o.mapId, kind: o.kind, name: o.name })),
          };
        }),
    },
    {
      name: 'add_places',
      title: 'Add places to a map',
      description:
        'Add places to a region or area map in one call (up to 50): each with its name, kind, ' +
        'description (written up, so it opens once anything below it is built), where it is ' +
        '(at, in the map’s units), whether it is a way in and out of the map (entrance), and ' +
        'links (two-way, by id or by the name of a place in this call, with a route kind on a ' +
        'region map). Then add_map under one to open it into a map below. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('map', 'list_maps'),
        places: z.array(newPlace).min(1).max(MAX_PLACES),
      },
      annotations: additive,
      handler: (ctx, args) => edit(ctx, args, (e) => addPlacesTo(e, args.mapId, args.places)),
    },
    {
      name: 'add_exit',
      title: 'Add an exit between maps',
      description:
        'An exit across maps (TV3), one way or both (twoWay) in one call. Between places on ' +
        'any maps ({ placeId } each): going from one arrives at the other, taking `seconds` ' +
        '(a jump gate, a portal). Between two grids ({ mapId, x, y } each: stairs, a ladder, ' +
        'a lift): an exit square on one leading to an entry square on the other, and back with ' +
        'twoWay. ' +
        editNote,
      inputSchema: {
        worldId,
        from: z.union([
          z.strictObject({ placeId: entityId('place', 'get_map') }),
          z.strictObject({
            mapId: entityId('grid', 'list_maps'),
            x: square.shape.x,
            y: square.shape.y,
          }),
        ]),
        to: z.union([
          z.strictObject({ placeId: entityId('place', 'get_map') }),
          z.strictObject({
            mapId: entityId('grid', 'list_maps'),
            x: square.shape.x,
            y: square.shape.y,
          }),
        ]),
        name: z.string().trim().min(1).max(60).describe('As players say it: "the stairs down".'),
        backName: z
          .string()
          .trim()
          .min(1)
          .max(60)
          .optional()
          .describe('The way back’s name, with twoWay: "the stairs up".'),
        seconds: z
          .number()
          .int()
          .min(0)
          .max(31536000)
          .optional()
          .describe('Between places: how long it takes.'),
        twoWay: z.boolean().optional(),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const model = modelOf(world);
          const back = args.backName || args.name;
          if (args.from.placeId && args.to.placeId) {
            if (args.from.placeId === args.to.placeId)
              throw new ToolError('An exit leads somewhere else.');
            const a = storedPlace(world, args.from.placeId, 'The place');
            const b = storedPlace(world, args.to.placeId, 'The place');
            placeIn(model, args.to.placeId);
            const seconds = args.seconds || 0;
            const add = (from, to, name) => {
              const exits = (from.exits || []).filter((x) => x.placeId !== to);
              exits.push({ placeId: to, seconds, name });
              e.update(
                e.ref('places', from === a ? args.from.placeId : args.to.placeId),
                'exits',
                exits
              );
            };
            add(a, args.to.placeId, args.name);
            if (args.twoWay) add(b, args.from.placeId, back);
            return {
              exits: [
                { from: args.from.placeId, to: args.to.placeId, name: args.name, seconds },
                ...(args.twoWay
                  ? [{ from: args.to.placeId, to: args.from.placeId, name: back, seconds }]
                  : []),
              ],
            };
          }
          if (args.from.mapId && args.to.mapId) {
            const bm = (id) => {
              const map = (world.battleMaps || {})[id];
              if (!map || map.retired) {
                throw new ToolError(`"${id}" is no grid with layers. list_maps shows the grids.`);
              }
              return map;
            };
            const a = bm(args.from.mapId);
            const b = bm(args.to.mapId);
            const slug = (s) => normalizeName(s).slice(0, 30).replace(/-+$/, '') || 'way';
            const unique = (list, base) => {
              let id = base;
              for (let n = 2; list.some((x) => x.id === id); n += 1) id = `${base}-${n}`;
              return id;
            };
            const next = { [a.id]: { ...a }, [b.id]: { ...b } };
            const link = (fromMap, at, toMap, toAt, name) => {
              const f = next[fromMap];
              const t = next[toMap];
              const entryId = unique(t.entries || [], 'from-' + slug(f.name));
              t.entries = [...(t.entries || []), { id: entryId, x: toAt.x, y: toAt.y }];
              const exitId = unique(f.exits || [], slug(name));
              f.exits = [
                ...(f.exits || []),
                { id: exitId, name, x: at.x, y: at.y, to: { map: toMap, entry: entryId } },
              ];
            };
            link(a.id, args.from, b.id, args.to, args.name);
            if (args.twoWay) link(b.id, args.to, a.id, args.from, back);
            const check = { ...world, battleMaps: { ...world.battleMaps, ...next } };
            for (const id of Object.keys(next)) {
              const m = next[id];
              mapTools.checkMap(check, id, {
                name: m.name,
                width: m.width,
                height: m.height,
                entries: m.entries,
                exits: m.exits,
                features: m.features || [],
              });
              e.update(e.ref('battleMaps', id), { entries: m.entries, exits: m.exits });
            }
            return {
              exits: Object.values(next).flatMap((m) =>
                (m.exits || [])
                  .filter((x) => !(world.battleMaps[m.id].exits || []).some((y) => y.id === x.id))
                  .map((x) => ({ mapId: m.id, ...x }))
              ),
            };
          }
          throw new ToolError(
            'An exit goes place to place ({ placeId } each) or grid to grid ({ mapId, x, y } each).'
          );
        }),
    },
    {
      name: 'set_grid',
      title: 'Set a grid',
      description:
        'A grid map’s entries, exits, features, walls, doors, obstacles and areas, at any ' +
        'depth: each list given replaces it, one left out is kept (as set_battle_map and ' +
        'set_map_layers, which work on it too). ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('grid', 'list_maps'),
        entries: z.array(mapTools.shapes.entry).min(1).max(20).optional(),
        exits: z.array(mapTools.shapes.exit).max(20).optional(),
        features: z.array(mapTools.shapes.feature).max(60).optional(),
        walls: mapTools.shapes.LAYER_SHAPES.walls.optional(),
        doors: mapTools.shapes.LAYER_SHAPES.doors.optional(),
        obstacles: mapTools.shapes.LAYER_SHAPES.obstacles.optional(),
        areas: mapTools.shapes.AREAS.optional(),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const before = (world.battleMaps || {})[args.mapId];
          if (!before || before.retired) {
            throw new ToolError(`"${args.mapId}" is no grid. list_maps shows the grids.`);
          }
          const LISTS = ['entries', 'exits', 'features', 'walls', 'doors', 'obstacles', 'areas'];
          const given = LISTS.filter((k) => args[k] !== undefined);
          if (!given.length) throw new ToolError(`Give one of ${LISTS.join(', ')}.`);
          const def = { name: before.name, width: before.width, height: before.height };
          for (const k of LISTS) def[k] = args[k] !== undefined ? args[k] : before[k] || [];
          mapTools.checkMap(world, args.mapId, def);
          mapTools.checkLayers(def);
          mapTools.checkAreas(def);
          const fields = Object.fromEntries(given.map((k) => [k, def[k]]));
          fields.revision = (before.revision || 0) + 1;
          e.update(e.ref('battleMaps', args.mapId), fields);
          const warnings = mapTools.layerWarnings({ ...before, ...def });
          return {
            grid: { mapId: args.mapId, name: before.name },
            updated: given,
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
    {
      name: 'set_area_ground',
      title: 'Set an area map’s ground',
      description:
        'An area map’s ground, as set_town_ground gives a town’s: buildings and water as ' +
        'polygons, walls as lines, crossings over water, in its 0–1000 square; every place’s ' +
        'position its door, on open ground and walkable from a way in. Each list given ' +
        'replaces it, one left out is kept. For a town in today’s shape, set_town_ground. ' +
        editNote,
      inputSchema: {
        worldId,
        mapId: entityId('area map', 'list_maps'),
        buildings: GROUND_SHAPES.buildings.optional(),
        water: GROUND_SHAPES.water.optional(),
        walls: GROUND_SHAPES.walls.optional(),
        crossings: GROUND_SHAPES.crossings.optional(),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const stored = (world.maps || {})[args.mapId];
          if (!stored || stored.kind !== 'area') {
            throw new ToolError(
              `"${args.mapId}" is no area map made with add_map. A town in today’s shape takes ` +
                'set_town_ground.'
            );
          }
          if (!stored.parent) throw new ToolError(`${stored.name} opens from no place.`);
          const given = ground.KINDS.filter((kind) => args[kind] !== undefined);
          if (!given.length) {
            throw new ToolError(
              'Give buildings, water, walls or crossings (an empty list clears them).'
            );
          }
          const beforeGround = stored.ground || {};
          const next = {};
          for (const kind of ground.KINDS) {
            const list = args[kind] !== undefined ? args[kind] : beforeGround[kind] || [];
            next[kind] = list.map((shape) => withoutBlanks(shape));
          }
          const model = modelOf(world);
          const view = frames.viewFor(model, stored.parent.mapId);
          const settlement = view.locations[stored.parent.placeId];
          const after = settlement
            ? { ...settlement, town: { ...(settlement.town || {}), ground: next } }
            : null;
          const empty = !ground.hasGround({ town: { ground: next } });
          const problems = empty || !after ? [] : ground.check(view, after, next);
          if (problems.length) {
            throw new ToolError(
              `That ground won’t do for ${stored.name}: ${problems.slice(0, 10).join(' ')}`
            );
          }
          e.update(e.ref('maps', args.mapId), { ground: empty ? FieldValue.delete() : next });
          return {
            map: { mapId: args.mapId, name: stored.name },
            updated: given,
            ...(after
              ? {
                  layout: town.layoutReport(
                    { ...view, locations: { ...view.locations, [after.id]: after } },
                    after
                  ),
                }
              : {}),
          };
        }),
    },
  ];
}

module.exports = { levelTools, addPlacesTo, modelOf };
