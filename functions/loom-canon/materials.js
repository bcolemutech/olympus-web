/* global module, window */
(function () {
  'use strict';

  // Materials and the object catalog (planning/maps-from-data.md §3 RD1, RD3,
  // OB1; §4.4, §4.6; L-925 / #729): the built-in set a map's floors, walls,
  // doors and windows are made of, and the common objects a map can hold,
  // each with its art. The set is fixed: a world can't add a material over
  // MCP (RD1). A world can give its own art to an object kind, or to a single
  // object (an object's art, else its world's art for its kind, else the
  // catalog's, else a box with a question mark; artFor).
  //
  // The art is in the repo, under public/apps/loom/art/ (the engine draws it
  // from there, with no call on the library; scripts/build-art.js makes it):
  // a material's as a tile, `art` its path under that folder, an object's as
  // a transparent picture in its own shape, `size` its default size in feet
  // ([width, depth]; a square is 5 ft).
  //
  //   MATERIALS      [{ kind, id, name, art, seeThrough?, water? }]
  //                    kind: ground | line | wall | door | window; a
  //                    see-through wall, door or window lets sight through
  //                    by default (GE3); water takes a depth
  //   OBJECT_KINDS   [{ id, name, group, size, art, blocksMove?, blocksSight? }]
  //                    movement is blocked and sight isn't unless it says
  //   FALLBACK_ART   the box with a question mark
  //
  // This file is kept in two places with the same bytes, functions/loom-canon/
  // materials.js and public/apps/loom/js/materials.js (the page loads it as
  // Loom.materials, and map-geometry.js reads its materials from it), and a
  // test fails if they differ: change both.

  var ART_BASE = '/apps/loom/art/';
  var KINDS = ['ground', 'line', 'wall', 'door', 'window'];
  var FALLBACK_ART = 'objects/unknown.svg';
  // Art made as pictures (with the image studio; planning/art-spike.md §5.4)
  // rather than drawn by scripts/build-art.js: its path, without the
  // extension, listed here when its file is a PNG, with how many tiles a
  // ground picture spans (a 15 ft picture of flagstones spans 3; strips and
  // objects 1). Everything else is SVG, a ground tile spanning 1. The painter
  // scales each picture by its own size, so a PNG can be sharper than 64 px.
  var PNG_ART = {
    'materials/ground-flagstone': 5,
    'materials/ground-stone': 5,
    'materials/ground-marble': 5,
    'materials/ground-rock': 5,
    'materials/ground-dirt': 5,
    'materials/ground-wood': 5,
    'materials/ground-water': 5,
    'materials/wall-stone': 1,
    'materials/wall-rock': 1,
    'materials/door-wood': 1,
    'materials/door-iron': 1,
    'materials/wall-brick': 1,
    'materials/line-stream': 1,
    'materials/window-glass': 1,
    'objects/crate': 1,
    'objects/brazier': 1,
    'objects/statue': 1,
    'objects/pillar': 1,
    'objects/chest': 1,
    'objects/barrel': 1,
    'objects/bed': 1,
    'objects/sarcophagus': 1,
    'objects/cauldron': 1,
    'objects/rug': 1,
    'objects/table': 1,
    'objects/chair': 1,
    'objects/wardrobe': 1,
    'objects/bench': 1,
    'objects/bookshelf': 1,
    'objects/altar': 1,
    'objects/anvil': 1,
    'objects/well': 1,
    'objects/lever': 1,
  };

  function artFile(base) {
    return base + (PNG_ART[base] ? '.png' : '.svg');
  }

  function spanOf(base) {
    return PNG_ART[base] || 1;
  }

  function m(kind, id, name, flags) {
    var base = 'materials/' + kind + '-' + id;
    var out = { kind: kind, id: id, name: name, art: artFile(base), span: spanOf(base) };
    if (flags)
      Object.keys(flags).forEach(function (k) {
        out[k] = flags[k];
      });
    return out;
  }
  var WATER = { water: true };
  var SEE = { seeThrough: true };

  var MATERIALS = [
    // Floors and terrain: on a grid or an area map, and (the last dozen,
    // Azgaar's biomes) on a region map.
    m('ground', 'stone', 'Stone'),
    m('ground', 'flagstone', 'Flagstone'),
    m('ground', 'cobble', 'Cobblestone'),
    m('ground', 'marble', 'Marble'),
    m('ground', 'tile', 'Tile'),
    m('ground', 'wood', 'Wood planks'),
    m('ground', 'carpet', 'Carpet'),
    m('ground', 'dirt', 'Dirt'),
    m('ground', 'grass', 'Grass'),
    m('ground', 'sand', 'Sand'),
    m('ground', 'gravel', 'Gravel'),
    m('ground', 'mud', 'Mud'),
    m('ground', 'rock', 'Cave rock'),
    m('ground', 'snow', 'Snow'),
    m('ground', 'ice', 'Ice'),
    m('ground', 'lava', 'Lava'),
    m('ground', 'roof', 'Roof'),
    m('ground', 'metal', 'Metal deck'),
    m('ground', 'water', 'Water', WATER),
    m('ground', 'deep-water', 'Deep water', WATER),
    m('ground', 'swamp', 'Swamp', WATER),
    m('ground', 'ocean', 'Ocean', WATER),
    m('ground', 'lake', 'Lake', WATER),
    m('ground', 'marsh', 'Marsh', WATER),
    m('ground', 'grassland', 'Grassland'),
    m('ground', 'farmland', 'Farmland'),
    m('ground', 'forest', 'Forest'),
    m('ground', 'jungle', 'Jungle'),
    m('ground', 'savanna', 'Savanna'),
    m('ground', 'desert', 'Desert'),
    m('ground', 'hills', 'Hills'),
    m('ground', 'mountains', 'Mountains'),
    m('ground', 'tundra', 'Tundra'),
    m('ground', 'taiga', 'Taiga'),
    m('ground', 'glacier', 'Glacier'),
    // Rivers and roads, as lines.
    m('line', 'river', 'River'),
    m('line', 'stream', 'Stream'),
    m('line', 'canal', 'Canal'),
    m('line', 'road', 'Road'),
    m('line', 'track', 'Track'),
    m('line', 'street', 'Street'),
    m('line', 'path', 'Path'),
    // Walls.
    m('wall', 'stone', 'Stone'),
    m('wall', 'brick', 'Brick'),
    m('wall', 'wood', 'Timber'),
    m('wall', 'rock', 'Cave rock'),
    m('wall', 'metal', 'Metal bulkhead'),
    m('wall', 'ice', 'Ice'),
    m('wall', 'hedge', 'Hedge'),
    m('wall', 'palisade', 'Palisade'),
    m('wall', 'glass', 'Glass', SEE),
    m('wall', 'bars', 'Bars', SEE),
    m('wall', 'fence', 'Fence', SEE),
    // Doors.
    m('door', 'wood', 'Wooden door'),
    m('door', 'iron', 'Iron door'),
    m('door', 'stone', 'Stone door'),
    m('door', 'metal', 'Metal hatch'),
    m('door', 'curtain', 'Curtain'),
    m('door', 'glass', 'Glass door', SEE),
    m('door', 'bars', 'Barred door', SEE),
    m('door', 'gate', 'Gate', SEE),
    // Windows.
    m('window', 'glass', 'Glass window', SEE),
    m('window', 'bars', 'Barred window', SEE),
    m('window', 'opening', 'Open window', SEE),
    m('window', 'shutters', 'Shuttered window'),
  ];

  function o(id, name, group, size, flags) {
    var out = { id: id, name: name, group: group, size: size, art: artFile('objects/' + id) };
    if (flags)
      Object.keys(flags).forEach(function (k) {
        out[k] = flags[k];
      });
    return out;
  }
  var WALK = { blocksMove: false };
  var TALL = { blocksSight: true };

  var OBJECT_KINDS = [
    o('chest', 'Chest', 'furniture', [3, 2]),
    o('table', 'Table', 'furniture', [5, 3]),
    o('chair', 'Chair', 'furniture', [2, 2]),
    o('bench', 'Bench', 'furniture', [5, 2]),
    o('bed', 'Bed', 'furniture', [3, 6]),
    o('desk', 'Desk', 'furniture', [5, 2.5]),
    o('bookshelf', 'Bookshelf', 'furniture', [5, 2], TALL),
    o('wardrobe', 'Wardrobe', 'furniture', [3, 2], TALL),
    o('rug', 'Rug', 'furniture', [8, 6], WALK),
    o('barrel', 'Barrel', 'containers', [2.5, 2.5]),
    o('crate', 'Crate', 'containers', [3, 3]),
    o('sarcophagus', 'Sarcophagus', 'containers', [3, 7]),
    o('altar', 'Altar', 'sacred', [5, 3]),
    o('statue', 'Statue', 'sacred', [3, 3]),
    o('pillar', 'Pillar', 'sacred', [2, 2], TALL),
    o('fountain', 'Fountain', 'sacred', [6, 6]),
    o('console', 'Console', 'machines', [4, 2]),
    o('lever', 'Lever', 'machines', [1, 1]),
    o('brazier', 'Brazier', 'light and craft', [2, 2]),
    o('cauldron', 'Cauldron', 'light and craft', [3, 3]),
    o('anvil', 'Anvil', 'light and craft', [2, 3]),
    o('campfire', 'Campfire', 'outdoors', [3, 3]),
    o('tree', 'Tree', 'outdoors', [8, 8], TALL),
    o('boulder', 'Boulder', 'outdoors', [5, 5], TALL),
    o('well', 'Well', 'outdoors', [4, 4]),
    o('cart', 'Cart', 'outdoors', [5, 10]),
    o('tent', 'Tent', 'outdoors', [8, 8], TALL),
    o('stairs', 'Stairs', 'ways', [5, 10], WALK),
    o('trapdoor', 'Trapdoor', 'ways', [3, 3], WALK),
  ];

  function by(list, key) {
    var out = {};
    list.forEach(function (item) {
      out[item[key]] = item;
    });
    return out;
  }
  var OBJECT_BY_ID = by(OBJECT_KINDS, 'id');

  function has(o2, k) {
    return Object.prototype.hasOwnProperty.call(o2, k);
  }

  /** The materials of one kind: ground, line, wall, door or window. */
  function materialsOf(kind) {
    return MATERIALS.filter(function (item) {
      return item.kind === kind;
    });
  }

  /** A material by kind and id, or null. */
  function materialOf(kind, id) {
    for (var i = 0; i < MATERIALS.length; i++) {
      if (MATERIALS[i].kind === kind && MATERIALS[i].id === id) return MATERIALS[i];
    }
    return null;
  }

  /** A catalog object kind by id, or null. */
  function objectKind(id) {
    return typeof id === 'string' && has(OBJECT_BY_ID, id) ? OBJECT_BY_ID[id] : null;
  }

  /** Where a catalog art file is served from. */
  function artUrl(file) {
    return ART_BASE + file;
  }

  /** Every art file the set names, once: materials', objects' and the fallback. */
  function artFiles() {
    var files = MATERIALS.map(function (item) {
      return item.art;
    }).concat(
      OBJECT_KINDS.map(function (item) {
        return item.art;
      }),
      [FALLBACK_ART]
    );
    return files.filter(function (file, i) {
      return files.indexOf(file) === i;
    });
  }

  /**
   * The art an object is drawn with (RD3, OB1): its own (`object.art`, a
   * library image reference), else its world's art for its kind
   * (`worldKinds[kind].art`), else the catalog's, else a box with a question
   * mark. { from: 'object' | 'world' | 'catalog' | 'unknown', ref?, file?,
   * url? }: a library image has `ref` (its `link` serves it), the others a
   * `file` in the repo's art and its `url`.
   */
  function artFor(object, worldKinds) {
    var item = object || {};
    if (item.art && item.art.imageId) return { from: 'object', ref: item.art };
    var own = worldKinds && has(worldKinds, item.kind) ? worldKinds[item.kind] : null;
    if (own && own.art && own.art.imageId) return { from: 'world', ref: own.art };
    var kind = objectKind(item.kind);
    if (kind) return { from: 'catalog', file: kind.art, url: artUrl(kind.art) };
    return { from: 'unknown', file: FALLBACK_ART, url: artUrl(FALLBACK_ART) };
  }

  /**
   * An object kind's default size in feet, [width, depth]: the world's own
   * (`worldKinds[kind].size`), else the catalog's, else null.
   */
  function sizeFor(kindId, worldKinds) {
    var own = worldKinds && has(worldKinds, kindId) ? worldKinds[kindId] : null;
    if (own && Array.isArray(own.size) && own.size.length === 2) return own.size.slice();
    var kind = objectKind(kindId);
    return kind ? kind.size.slice() : null;
  }

  var api = {
    ART_BASE: ART_BASE,
    KINDS: KINDS,
    FALLBACK_ART: FALLBACK_ART,
    MATERIALS: MATERIALS,
    OBJECT_KINDS: OBJECT_KINDS,
    materialsOf: materialsOf,
    materialOf: materialOf,
    objectKind: objectKind,
    artUrl: artUrl,
    artFiles: artFiles,
    artFor: artFor,
    sizeFor: sizeFor,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.materials = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
