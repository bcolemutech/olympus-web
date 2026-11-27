/* global module, window, require */
(function () {
  'use strict';

  // Elements and the index (planning/the-muse.md §3 EL1, D2, §4; M-102 /
  // #890), as plain data: what an element may hold, and the writes that make,
  // change, retire and bring one back with the index kept in step.
  //
  //   muse_projects/{p}/elements/{id}
  //     type       character, faction, location, object or concept (fixed)
  //     name, aliases, bio (Markdown), fields (EL2, by key; ./fields.js)
  //     images, primary (M-104)
  //     mentions   the ids its bio and appearance link to ([Name](muse:el/id)),
  //                worked out on every save (M-103, ./links.js)
  //     appearance (Markdown), residence (a location's id): characters only
  //     classes    the ids of its classes, at most 50 (M-201, ./classes.js)
  //     shard      the index document that lists it (fixed)
  //     retired    a retired element keeps its page but leaves the index
  //     createdAt, updatedAt
  //
  //   muse_projects/{p}/index/{shard}
  //     entries    { <id>: { type, name, aliases, primary, classes } }, at most
  //                SHARD_SIZE; the page loads every shard once, for lists,
  //                search and links; `classes` (M-201, D3) lets a list be
  //                filtered by a class from the index alone
  //     last       the id this write changed: the rules check that entry
  //                against the element written in the same batch, and the
  //                element against its entry, so neither moves alone
  //
  // A plan is a list of writes, { op, path, data }, done in one batch:
  //   set     the whole document
  //   delete  the document
  //   update  these fields
  //   merge   set, merged into what is there (maps merged, lists replaced)
  // with NOW for the server's time and DELETE to take a map's key away. The
  // page turns them into Firestore calls; the connector (M-106) will too.
  //
  // Concepts are like factions (EL1): every type but the character has the
  // same fields.

  var fields =
    typeof window !== 'undefined' && window.Muse && window.Muse.fields
      ? window.Muse.fields
      : require('./fields.js');

  var links =
    typeof window !== 'undefined' && window.Muse && window.Muse.links
      ? window.Muse.links
      : require('./links.js');

  var classes =
    typeof window !== 'undefined' && window.Muse && window.Muse.classes
      ? window.Muse.classes
      : require('./classes.js');

  var TYPES = fields.TYPES;
  var LIMITS = {
    name: 200,
    aliases: 20,
    alias: 100,
    bio: 200000,
    appearance: 50000,
    images: 200,
    imageId: 200,
  };
  var SHARD_SIZE = 500;
  var NOW = links.NOW;
  var DELETE = { __muse: 'delete' };

  function projectPath(projectId) {
    return 'muse_projects/' + projectId;
  }

  // An element's line in the index.
  function entryOf(element) {
    return {
      type: element.type,
      name: element.name,
      aliases: (element.aliases || []).slice(),
      primary: element.primary === undefined ? null : element.primary,
      classes: (element.classes || []).slice(),
    };
  }

  // A name and its aliases, trimmed; aliases without repeats or the name.
  function checkNames(name, aliases) {
    name = String(name === undefined || name === null ? '' : name)
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) return { error: 'It needs a name.' };
    if (name.length > LIMITS.name) {
      return { error: 'A name is at most ' + LIMITS.name + ' characters.' };
    }
    if (aliases !== undefined && aliases !== null && !Array.isArray(aliases)) {
      return { error: 'Aliases must be a list.' };
    }
    var seen = {};
    seen[name.toLowerCase()] = true;
    var out = [];
    for (var i = 0; i < (aliases || []).length; i++) {
      var alias = String(aliases[i] === null || aliases[i] === undefined ? '' : aliases[i])
        .replace(/\s+/g, ' ')
        .trim();
      if (!alias || seen[alias.toLowerCase()]) continue;
      if (alias.length > LIMITS.alias) {
        return { error: 'An alias is at most ' + LIMITS.alias + ' characters.' };
      }
      seen[alias.toLowerCase()] = true;
      out.push(alias);
    }
    if (out.length > LIMITS.aliases) {
      return { error: 'At most ' + LIMITS.aliases + ' aliases.' };
    }
    return { value: { name: name, aliases: out } };
  }

  function checkText(label, value, max) {
    var text = String(value === undefined || value === null ? '' : value);
    if (text.length > max) return { error: label + ' is too long.' };
    return { value: text };
  }

  // Checks what an element of `type` is to hold. `input` may have any of
  // name, aliases, bio, fields (raw, by key), appearance, residence and
  // classes; what it leaves out is taken from `context.current` (the element
  // now), except classes, which are checked only when given.
  // `context`:
  //   defs              the type's field definitions (the project's)
  //   elementType(id)   the type of a live element, or null
  //   current           the element as stored, when changing one
  //   tree              the project's classifications (./classes.js), when
  //                     classes are given
  //   calendar          the project's calendar (./calendar.js), which reads
  //                     its dates and which a date changed must fit (CA9)
  // Gives back { value } (the element's own fields, cleaned) or { error }.
  function checkElement(type, input, context) {
    context = context || {};
    var current = context.current || {};
    if (TYPES.indexOf(type) === -1) return { error: 'There is no element type “' + type + '”.' };
    var has = function (key) {
      return input && Object.prototype.hasOwnProperty.call(input, key);
    };
    var names = checkNames(
      has('name') ? input.name : current.name,
      has('aliases') ? input.aliases : current.aliases
    );
    if (names.error) return names;
    var bio = checkText('The bio', has('bio') ? input.bio : current.bio, LIMITS.bio);
    if (bio.error) return bio;
    var values = fields.checkValues(
      context.defs || [],
      has('fields') ? input.fields : current.fields,
      {
        elementType: context.elementType,
        calendar: context.calendar,
        kept: current.fields || {},
      }
    );
    if (values.error) return values;
    var out = {
      name: names.value.name,
      aliases: names.value.aliases,
      bio: bio.value,
      fields: values.value,
    };
    if (type === 'character') {
      var appearance = checkText(
        'The appearance',
        has('appearance') ? input.appearance : current.appearance,
        LIMITS.appearance
      );
      if (appearance.error) return appearance;
      out.appearance = appearance.value;
      var residence = has('residence') ? input.residence : current.residence;
      residence = residence === undefined || residence === null ? '' : String(residence).trim();
      if (residence && residence !== current.residence) {
        var at = context.elementType ? context.elementType(residence) : null;
        if (at !== 'location') return { error: 'A residence must be a location in this project.' };
      }
      out.residence = residence || null;
    } else if (has('appearance') || has('residence')) {
      return { error: 'Only characters have an appearance and a residence.' };
    }
    // Its classes (M-201), at any level (CL2).
    if (has('classes')) {
      var held = classes.checkClasses(
        context.tree || classes.emptyTree(),
        type,
        input.classes,
        current.classes
      );
      if (held.error) return held;
      out.classes = held.value;
    }
    // The elements its texts link to (EL6), kept in step with every save.
    out.mentions = links.mentionsOf(out.bio, out.appearance || '');
    return { value: out };
  }

  // ── Photo libraries (IM1; M-104) ────────────────
  // An element keeps which studio images are its own, in order, and which
  // one is primary: { images: [studio image ids], primary: an id in images,
  // or null when there are none }. The images themselves live in the studio;
  // taking one off an element leaves it there. Each operation gives back a
  // new { images, primary }; checkPhotos is what a write is checked by.

  function copyPhotos(photos) {
    var images = Array.isArray(photos && photos.images) ? photos.images.slice() : [];
    var primary = photos && photos.primary !== undefined ? photos.primary : null;
    return { images: images, primary: primary };
  }

  // Adds images to the end (those already there stay where they are). The
  // first image an element gets is its primary.
  function addPhotos(photos, ids) {
    var out = copyPhotos(photos);
    (ids || []).forEach(function (id) {
      if (out.images.indexOf(id) === -1) out.images.push(id);
    });
    if (out.primary === null && out.images.length) out.primary = out.images[0];
    return out;
  }

  // Takes one off. When it was the primary, the one that takes its place in
  // the order is (the one before, if it was last), and none when it was alone.
  function removePhoto(photos, id) {
    var out = copyPhotos(photos);
    var at = out.images.indexOf(id);
    if (at === -1) return out;
    out.images.splice(at, 1);
    if (out.primary === id)
      out.primary = out.images.length ? out.images[at] || out.images[at - 1] : null;
    return out;
  }

  // Moves one earlier (delta -1) or later (+1); the ends stay where they are.
  function movePhoto(photos, id, delta) {
    var out = copyPhotos(photos);
    var at = out.images.indexOf(id);
    var to = at + delta;
    if (at === -1 || to < 0 || to >= out.images.length) return out;
    out.images.splice(at, 1);
    out.images.splice(to, 0, id);
    return out;
  }

  function primaryPhoto(photos, id) {
    var out = copyPhotos(photos);
    if (out.images.indexOf(id) !== -1) out.primary = id;
    return out;
  }

  // Checks what a write would leave: at most LIMITS.images distinct ids, and
  // a primary that is one of them (the first, if none is named). Gives back
  // { value: { images, primary } } or { error }.
  function checkPhotos(photos) {
    var images = photos && photos.images;
    if (images === undefined || images === null) images = [];
    if (!Array.isArray(images)) return { error: 'Images must be a list.' };
    var seen = {};
    var out = [];
    for (var i = 0; i < images.length; i++) {
      var id = typeof images[i] === 'string' ? images[i].trim() : '';
      if (!id) return { error: 'Each image is named by its id.' };
      if (id.length > LIMITS.imageId) return { error: 'An image id is at most 200 characters.' };
      if (seen[id]) continue;
      seen[id] = true;
      out.push(id);
    }
    if (out.length > LIMITS.images) {
      return { error: 'At most ' + LIMITS.images + ' images.' };
    }
    var primary = photos ? photos.primary : null;
    if (primary === undefined || primary === null || primary === '') {
      primary = out.length ? out[0] : null;
    } else if (!seen[primary]) {
      return { error: 'The primary image must be one of the element’s images.' };
    }
    return { value: { images: out, primary: primary } };
  }

  // ── The index in memory ─────────────────────────
  // { entries: { id: entry + shard }, shards: { shard: count } }, read from
  // the index documents ([{ id, data }]).
  function readIndex(docs) {
    var index = { entries: {}, shards: {} };
    (docs || []).forEach(function (doc) {
      var entries = (doc.data && doc.data.entries) || {};
      index.shards[doc.id] = Object.keys(entries).length;
      Object.keys(entries).forEach(function (id) {
        var entry = entryOf(entries[id]);
        entry.shard = doc.id;
        index.entries[id] = entry;
      });
    });
    return index;
  }

  // The shard a new element goes in: the first with room, or a new one.
  function pickShard(index) {
    var shards = (index && index.shards) || {};
    var ids = Object.keys(shards).sort(function (a, b) {
      return Number(a) - Number(b);
    });
    for (var i = 0; i < ids.length; i++) {
      if (shards[ids[i]] < SHARD_SIZE) return ids[i];
    }
    var next = ids.length ? Math.max.apply(null, ids.map(Number)) + 1 : 0;
    return String(isFinite(next) ? next : ids.length);
  }

  // The index after a plan is done, so the page needn't read it again.
  function applyToIndex(index, writes) {
    writes.forEach(function (write) {
      var m = /\/index\/([^/]+)$/.exec(write.path);
      if (!m) return;
      var shard = m[1];
      var entries = write.data.entries || {};
      Object.keys(entries).forEach(function (id) {
        var had = index.entries[id] && index.entries[id].shard === shard;
        if (entries[id] === DELETE) {
          if (had) {
            delete index.entries[id];
            index.shards[shard] = (index.shards[shard] || 1) - 1;
          }
        } else {
          var entry = entryOf(entries[id]);
          entry.shard = shard;
          index.entries[id] = entry;
          if (!had) index.shards[shard] = (index.shards[shard] || 0) + 1;
        }
      });
    });
    return index;
  }

  function indexWrite(projectId, shard, id, entry) {
    var entries = {};
    entries[id] = entry;
    return {
      op: 'merge',
      path: projectPath(projectId) + '/index/' + shard,
      data: { entries: entries, last: id },
    };
  }

  // ── Plans ───────────────────────────────────────
  // A new element: `checked` is checkElement's value.
  function planCreate(projectId, id, type, checked, index) {
    var shard = pickShard(index);
    var element = {
      type: type,
      name: checked.name,
      aliases: checked.aliases,
      bio: checked.bio,
      fields: checked.fields,
      images: [],
      primary: null,
      mentions: checked.mentions || [],
      classes: checked.classes || [],
      shard: shard,
      retired: false,
      createdAt: NOW,
      updatedAt: NOW,
    };
    if (type === 'character') {
      element.appearance = checked.appearance || '';
      element.residence = checked.residence || null;
    }
    return [
      { op: 'set', path: projectPath(projectId) + '/elements/' + id, data: element },
      indexWrite(projectId, shard, id, entryOf(element)),
    ];
  }

  // A change to an element: `current` is it as stored (with its id), and
  // `checked` checkElement's value. Every save of a live element writes its
  // index line, so a line written before M-201 gains its classes (D3); a
  // retired element has none.
  function planUpdate(projectId, current, checked) {
    var data = { updatedAt: NOW };
    Object.keys(checked).forEach(function (key) {
      data[key] = checked[key];
    });
    var writes = [
      { op: 'update', path: projectPath(projectId) + '/elements/' + current.id, data: data },
    ];
    var after = entryOf(Object.assign({}, current, checked));
    if (!current.retired) writes.push(indexWrite(projectId, current.shard, current.id, after));
    return writes;
  }

  // Retiring takes an element out of the index (lists, search and links);
  // its page and what it holds are kept, and it can be brought back.
  function planRetire(projectId, current) {
    return [
      {
        op: 'update',
        path: projectPath(projectId) + '/elements/' + current.id,
        data: { retired: true, updatedAt: NOW },
      },
      indexWrite(projectId, current.shard, current.id, DELETE),
    ];
  }

  function planRestore(projectId, current) {
    var restored = Object.assign({}, current, { retired: false });
    return [
      {
        op: 'update',
        path: projectPath(projectId) + '/elements/' + current.id,
        data: { retired: false, updatedAt: NOW },
      },
      indexWrite(projectId, current.shard, current.id, entryOf(restored)),
    ];
  }

  var api = {
    TYPES: TYPES,
    LIMITS: LIMITS,
    SHARD_SIZE: SHARD_SIZE,
    NOW: NOW,
    DELETE: DELETE,
    entryOf: entryOf,
    checkNames: checkNames,
    checkElement: checkElement,
    addPhotos: addPhotos,
    removePhoto: removePhoto,
    movePhoto: movePhoto,
    primaryPhoto: primaryPhoto,
    checkPhotos: checkPhotos,
    readIndex: readIndex,
    pickShard: pickShard,
    applyToIndex: applyToIndex,
    planCreate: planCreate,
    planUpdate: planUpdate,
    planRetire: planRetire,
    planRestore: planRestore,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.model = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
