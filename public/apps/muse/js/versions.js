/* global module, window */
(function () {
  'use strict';

  // Versions (planning/the-muse.md §3 VR1, VR2, PL2, MS5, §4; M-105 / #893),
  // as plain data: what a version holds, and the writes that keep one and
  // delete the oldest past the last 50 of that thing. This file is the same,
  // byte for byte, in functions/muse/versions.js (a test fails if the copies
  // differ): the page keeps a version when you save one by hand, and the
  // Muse connector (M-106) keeps one before every write it makes.
  //
  //   muse_projects/{p}/versions/{id}
  //     of        the path of the thing: muse_projects/{p} for the project,
  //               muse_projects/{p}/elements/{id} for an element (the later
  //               epics add classes, events and chapters)
  //     snapshot  the thing's document as it was stored, whole
  //     name      what the writer called it, or null
  //     by        page (saved by hand) or mcp (kept before a connector write)
  //     at        when it was kept
  //
  // A plan is a list of writes, { op, path, data }, done in one batch, in the
  // form model.js uses (`set` and `delete`), with NOW for the server's time.
  // NOW is told by its shape (isNow), so it needn't be the same object as
  // model.NOW. Browsing and reverting come with M-400.

  var KEEP = 50;
  var LIMITS = { name: 100 };
  var BY = ['page', 'mcp'];
  var NOW = { __muse: 'now' };

  function isNow(value) {
    return !!value && typeof value === 'object' && value.__muse === 'now';
  }

  function projectPath(projectId) {
    return 'muse_projects/' + projectId;
  }

  // The path a version's `of` names: the project, or one of its documents in
  // `collection` (elements) by id.
  function ofPath(projectId, collection, id) {
    return collection
      ? projectPath(projectId) + '/' + collection + '/' + id
      : projectPath(projectId);
  }

  function versionPath(projectId, id) {
    return projectPath(projectId) + '/versions/' + id;
  }

  // A document's data kept whole, as plain values: no `id` (it is the
  // document's, not its data's), nothing undefined (Firestore refuses it),
  // and other objects (times, kept by Firestore) as they are.
  function copy(value) {
    if (Array.isArray(value)) {
      return value
        .filter(function (item) {
          return item !== undefined;
        })
        .map(copy);
    }
    if (value && typeof value === 'object' && value.constructor === Object) {
      var out = {};
      Object.keys(value).forEach(function (key) {
        if (value[key] !== undefined) out[key] = copy(value[key]);
      });
      return out;
    }
    return value;
  }

  function snapshotOf(data) {
    var out = copy(data || {});
    delete out.id;
    return out;
  }

  // The name given to a version: trimmed, empty meaning none, at most
  // LIMITS.name. Gives back { value } (a string or null) or { error }.
  function checkName(name) {
    if (name === undefined || name === null) return { value: null };
    var text = String(name).replace(/\s+/g, ' ').trim();
    if (!text) return { value: null };
    if (text.length > LIMITS.name) {
      return { error: 'A version’s name is at most ' + LIMITS.name + ' characters.' };
    }
    return { value: text };
  }

  // A time as milliseconds: a Firestore Timestamp, a Date or a number.
  function millis(value) {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (value instanceof Date) return value.getTime();
    return typeof value === 'number' ? value : 0;
  }

  // The versions to delete when one more is kept: of `existing` ([{ id, at }],
  // every version of the one thing), the oldest, so that with the new one
  // there are KEEP, the oldest first. (More are dropped if more had piled up.)
  function surplus(existing) {
    var newest = (existing || []).slice().sort(function (a, b) {
      return millis(b.at) - millis(a.at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);
    });
    return newest.slice(KEEP - 1).reverse();
  }

  // Keeps a version of one thing. `request`:
  //   projectId, id (the new version's id), of (see ofPath),
  //   data (the thing's document as stored), existing ([{ id, at }]: the
  //   versions of that thing now), by (page or mcp) and name (optional).
  // Gives back { id, writes, dropped } (the ids deleted), or { error }.
  function planSave(request) {
    request = request || {};
    if (!request.projectId || !request.id || !request.of) {
      return { error: 'A version needs its project, its id and the thing it is of.' };
    }
    if (BY.indexOf(request.by) === -1) return { error: 'A version is by the page or mcp.' };
    var named = checkName(request.name);
    if (named.error) return named;
    var dropped = surplus(request.existing).map(function (version) {
      return version.id;
    });
    var writes = [
      {
        op: 'set',
        path: versionPath(request.projectId, request.id),
        data: {
          of: request.of,
          snapshot: snapshotOf(request.data),
          name: named.value,
          by: request.by,
          at: NOW,
        },
      },
    ];
    dropped.forEach(function (id) {
      writes.push({ op: 'delete', path: versionPath(request.projectId, id) });
    });
    return { id: request.id, writes: writes, dropped: dropped };
  }

  var api = {
    KEEP: KEEP,
    LIMITS: LIMITS,
    BY: BY,
    NOW: NOW,
    isNow: isNow,
    ofPath: ofPath,
    versionPath: versionPath,
    snapshotOf: snapshotOf,
    checkName: checkName,
    surplus: surplus,
    planSave: planSave,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.versions = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
