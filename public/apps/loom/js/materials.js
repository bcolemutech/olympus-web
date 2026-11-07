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
  // Art sets (planning/game-art.md §4.3, AR3, AR7, EN1, EN2; L-944 / #798):
  // painted pictures for the materials and objects, a folder under
  // public/apps/loom/art/sets/<set>/ with its manifest.json, registered here
  // (registerSet) by the painter as it loads one and by the server
  // (art-sets.js). The built-in set is `classic`; a world names another at
  // `art.set`. Anything a set lacks falls back to the built-in SVG above.
  //
  //   manifest  { name, title?, description?,
  //               atlases?:   { [id]: { file, width, height } },
  //               materials?: { '<kind>/<id>': entry },
  //               objects?:   { '<kind id>': entry } }
  //   entry     a picture (its `art`, seen from above), and
  //               span      a ground picture's width in tiles (5 ft on a grid)
  //               variants  more pictures of a ground (up to three)
  //               face      a wall's face, standing (L-941)
  //               stand     an object standing, with its `foot`: [x, y], the
  //                         point of the picture (0–1 across and down) where
  //                         its footprint's south edge meets the ground at
  //                         its middle; [0.5, 1] unless it says
  //   picture   { file } (under the set's folder) or { atlas, frame: [x, y,
  //             w, h] } (a frame of one of its atlases, in pixels)
  //
  // A set's pictures resolve to { url } or { atlas: url, frame } (picture).
  // A wall with no face shows its top's, darkened; an object with no standing
  // picture is drawn flat from above, as before (standFor; TV5).
  //
  // This file is kept in two places with the same bytes, functions/loom-canon/
  // materials.js and public/apps/loom/js/materials.js (the page loads it as
  // Loom.materials, and map-geometry.js reads its materials from it), and a
  // test fails if they differ: change both.

  var ART_BASE = '/apps/loom/art/';
  var KINDS = ['ground', 'line', 'wall', 'door', 'window'];
  var FALLBACK_ART = 'objects/unknown.svg';
  var DEFAULT_SET = 'classic';
  var SETS = {}; // name → { manifest, base }

  function m(kind, id, name, flags) {
    var out = { kind: kind, id: id, name: name, art: 'materials/' + kind + '-' + id + '.svg' };
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
    var out = { id: id, name: name, group: group, size: size, art: 'objects/' + id + '.svg' };
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

  /** Every built-in art file, once: materials', objects' and the fallback (the SVG every set falls back to). */
  function artFiles() {
    var files = [];
    MATERIALS.forEach(function (item) {
      files.push(item.art);
    });
    OBJECT_KINDS.forEach(function (item) {
      files.push(item.art);
    });
    files.push(FALLBACK_ART);
    return files.filter(function (file, i) {
      return files.indexOf(file) === i;
    });
  }

  // ── Art sets (L-944) ──────────────────────────────────────────────────

  function isPicture(p) {
    return Boolean(
      p &&
      ((typeof p.file === 'string' && p.file) ||
        (typeof p.atlas === 'string' && Array.isArray(p.frame) && p.frame.length === 4))
    );
  }

  /**
   * What's wrong with a manifest, as sentences (none: []): its name, its
   * atlases, and each entry's pictures, span, variants, face and stand.
   */
  function checkManifest(manifest) {
    var out = [];
    var mf = manifest || {};
    if (typeof mf.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(mf.name)) {
      out.push('Its name is lower-case letters, digits and -, up to 40.');
    }
    var atlases = mf.atlases || {};
    Object.keys(atlases).forEach(function (id) {
      var a = atlases[id] || {};
      if (typeof a.file !== 'string' || !(a.width > 0) || !(a.height > 0)) {
        out.push('Atlas "' + id + '" needs its file, width and height.');
      }
    });
    var picture = function (where, p) {
      if (!isPicture(p)) {
        out.push(where + ' is a picture: { file } or { atlas, frame: [x, y, w, h] }.');
        return;
      }
      if (p.atlas) {
        var a = atlases[p.atlas];
        var f = p.frame;
        if (!a) out.push(where + ' names atlas "' + p.atlas + '", which it doesn’t have.');
        else if (
          f.some(function (v) {
            return typeof v !== 'number' || v < 0;
          }) ||
          !(f[2] > 0 && f[3] > 0) ||
          f[0] + f[2] > a.width ||
          f[1] + f[3] > a.height
        ) {
          out.push(where + '’s frame lies outside atlas "' + p.atlas + '".');
        }
      }
    };
    var entries = function (key, known) {
      var list = mf[key] || {};
      Object.keys(list).forEach(function (id) {
        var e = list[id] || {};
        var where = key + ' "' + id + '"';
        if (!known(id)) out.push(where + ' is no built-in ' + key.slice(0, -1) + '.');
        if (e.file || e.atlas) picture(where, e);
        if (e.span !== undefined && !(e.span > 0)) out.push(where + '’s span is a number over 0.');
        if (e.variants !== undefined) {
          if (!Array.isArray(e.variants) || e.variants.length > 3) {
            out.push(where + '’s variants are a list of up to three pictures.');
          } else {
            e.variants.forEach(function (v, i) {
              picture(where + ' variant ' + (i + 1), v);
            });
          }
        }
        if (e.face !== undefined) picture(where + '’s face', e.face);
        if (e.stand !== undefined) {
          picture(where + '’s standing picture', e.stand);
          var foot = e.stand && e.stand.foot;
          if (
            foot !== undefined &&
            !(
              Array.isArray(foot) &&
              foot.length === 2 &&
              foot.every(function (v) {
                return typeof v === 'number' && v >= 0 && v <= 1;
              })
            )
          ) {
            out.push(where + '’s foot is [x, y], each 0–1.');
          }
        }
      });
    };
    entries('materials', function (id) {
      var parts = id.split('/');
      return parts.length === 2 && Boolean(materialOf(parts[0], parts[1]));
    });
    entries('objects', function (id) {
      return Boolean(objectKind(id));
    });
    return out;
  }

  /**
   * Registers a set from its manifest, its pictures served from `base` (its
   * folder's url; ART_BASE + 'sets/<name>/' unless given). Returns its
   * problems (checkManifest); a set with any isn't registered.
   */
  function registerSet(manifest, base) {
    var problems = checkManifest(manifest);
    if (problems.length) return problems;
    SETS[manifest.name] = {
      manifest: manifest,
      base: base || ART_BASE + 'sets/' + manifest.name + '/',
    };
    return [];
  }

  /** A registered set's manifest, or null. */
  function setOf(name) {
    return typeof name === 'string' && has(SETS, name) ? SETS[name].manifest : null;
  }

  /** The registered sets' names. */
  function setNames() {
    return Object.keys(SETS);
  }

  // A set's picture where it's served: { url } or { atlas: url, frame }.
  function resolve(set, p) {
    if (!isPicture(p)) return null;
    if (p.file) return { url: set.base + p.file };
    var a = (set.manifest.atlases || {})[p.atlas];
    return a ? { atlas: set.base + a.file, frame: p.frame.slice() } : null;
  }

  function entryOf(setName, group, id) {
    var set = typeof setName === 'string' && has(SETS, setName) ? SETS[setName] : null;
    var list = set && set.manifest[group];
    var e = list && has(list, id) ? list[id] : null;
    return e ? { set: set, entry: e } : null;
  }

  /**
   * A material's art in a set (L-944): { from: 'set' | 'catalog', picture
   * ({ url } or { atlas, frame }), span, variants: [picture], face?:
   * picture }. What the set lacks is the built-in SVG's: its picture, a span
   * of 1, no variants, no face.
   */
  function materialArt(kind, id, setName) {
    var m = materialOf(kind, id);
    var found = entryOf(setName, 'materials', kind + '/' + id);
    var e = found && found.entry;
    var own = e && isPicture(e) ? resolve(found.set, e) : null;
    var out = {
      from: own ? 'set' : 'catalog',
      picture: own || (m ? { url: artUrl(m.art) } : null),
      span: own && e.span > 0 ? e.span : 1,
      variants: [],
    };
    if (own && Array.isArray(e.variants)) {
      out.variants = e.variants
        .map(function (v) {
          return resolve(found.set, v);
        })
        .filter(Boolean);
    }
    var face = e && e.face ? resolve(found.set, e.face) : null;
    if (face) out.face = face;
    return out;
  }

  /**
   * The art an object is drawn with (RD3, OB1): its own (`object.art`, a
   * library image reference), else its world's art for its kind
   * (`worldKinds[kind].art`), else its set's (L-944), else the catalog's,
   * else a box with a question mark. { from: 'object' | 'world' | 'set' |
   * 'catalog' | 'unknown', ref?, file?, url?, picture? }: a library image has
   * `ref` (its `link` serves it), a set's its `picture`, the others a `file`
   * in the repo's art and its `url`.
   */
  function artFor(object, worldKinds, setName) {
    var item = object || {};
    if (item.art && item.art.imageId) return { from: 'object', ref: item.art };
    var own = worldKinds && has(worldKinds, item.kind) ? worldKinds[item.kind] : null;
    if (own && own.art && own.art.imageId) return { from: 'world', ref: own.art };
    var found = entryOf(setName, 'objects', item.kind);
    var picture = found && isPicture(found.entry) ? resolve(found.set, found.entry) : null;
    if (picture) return { from: 'set', picture: picture };
    var kind = objectKind(item.kind);
    if (kind) return { from: 'catalog', file: kind.art, url: artUrl(kind.art) };
    return { from: 'unknown', file: FALLBACK_ART, url: artUrl(FALLBACK_ART) };
  }

  /**
   * The picture an object stands as in the three-quarter view (TV5; L-941),
   * { picture, foot: [x, y] }, or null when it is drawn flat from above: its
   * set's standing picture (L-944), unless the object or its world gives it
   * art of its own (a library image, drawn as it is, flat).
   */
  function standFor(object, worldKinds, setName) {
    var item = object || {};
    if (item.art && (item.art.imageId || item.art.link)) return null;
    var own = worldKinds && has(worldKinds, item.kind) ? worldKinds[item.kind] : null;
    if (own && own.art && (own.art.imageId || own.art.link)) return null;
    var found = entryOf(setName, 'objects', item.kind);
    var stand = found && found.entry.stand;
    var picture = stand ? resolve(found.set, stand) : null;
    if (!picture) return null;
    var foot = Array.isArray(stand.foot) ? stand.foot.slice() : [0.5, 1];
    return { picture: picture, foot: foot };
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
    DEFAULT_SET: DEFAULT_SET,
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
    standFor: standFor,
    checkManifest: checkManifest,
    registerSet: registerSet,
    setOf: setOf,
    setNames: setNames,
    materialArt: materialArt,
    sizeFor: sizeFor,
  };

  if (typeof window !== 'undefined') {
    window.Loom = window.Loom || {};
    window.Loom.materials = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
