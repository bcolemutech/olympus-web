/* global module, window, require */
(function () {
  'use strict';

  // Schematics (planning/the-muse.md §3 SC1–SC9, D7–D10, §4; M-202 / #915), as
  // plain data: a picture of a location or an object (a floor plan, a ship's
  // decks, a machine's parts) with numbered points on it, and the writes that
  // make, change, order and delete them. This file is the same, byte for byte,
  // in functions/muse/schematics.js (a test fails if the copies differ), so
  // the page and the Muse connector make the same checks and the same writes.
  //
  //   muse_projects/{p}/schematics/{id}
  //     element   the location or object it belongs to (fixed)
  //     name      "Ground floor"
  //     order     its place among that element's schematics (SC4)
  //     image     a studio image id (kind `schematic`, D8)
  //     points    an ordered list, at most 200, of
  //               { id, name, description, x, y, link }: x and y fractions of
  //               the picture from its top left; link an element's id or null.
  //               A point's number is its place in the list (D7).
  //     links     the ids its points link to, for "marked on" (SC9)
  //     createdAt, updatedAt
  //
  // Checks give { value } or { error }; plans are lists of writes,
  // { op, path, data }, as in ./model.js, done in one batch. A version is kept
  // before each change (D9) by ./versions.js.

  var links =
    typeof window !== 'undefined' && window.Muse && window.Muse.links
      ? window.Muse.links
      : require('./links.js');

  var NOW = links.NOW;
  var TYPES = ['location', 'object']; // SC3
  var LIMITS = {
    name: 100,
    description: 5000, // a point's, Markdown
    points: 200,
    perElement: 30, // schematics of one element
    image: 200,
  };
  var ID = /^[A-Za-z0-9_-]{1,128}$/;

  function projectPath(projectId) {
    return 'muse_projects/' + projectId;
  }

  function schematicPath(projectId, id) {
    return projectPath(projectId) + '/schematics/' + id;
  }

  function tidy(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function has(map, key) {
    return !!map && Object.prototype.hasOwnProperty.call(map, key);
  }

  // A schematic as stored, with its id, as plain values.
  function read(id, data) {
    data = data || {};
    return {
      id: id,
      element: data.element,
      name: data.name || '',
      order: typeof data.order === 'number' ? data.order : 0,
      image: data.image || null,
      points: (Array.isArray(data.points) ? data.points : []).map(pointOf),
      links: Array.isArray(data.links) ? data.links.slice() : [],
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    };
  }

  function pointOf(p) {
    return {
      id: p.id,
      name: p.name || '',
      description: p.description || '',
      x: p.x,
      y: p.y,
      link: p.link || null,
    };
  }

  // A schematic's elements', in their order.
  function inOrder(list) {
    return (list || []).slice().sort(function (a, b) {
      return a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    });
  }

  // The ids the points link to, each once, in point order.
  function linksOf(points) {
    var out = [];
    (points || []).forEach(function (p) {
      if (p.link && out.indexOf(p.link) === -1) out.push(p.link);
    });
    return out;
  }

  // ── Checks ──────────────────────────────────────

  function checkName(name, what) {
    var text = tidy(name);
    if (!text) return { error: (what || 'A schematic') + ' needs a name.' };
    if (text.length > LIMITS.name) {
      return { error: 'A name is at most ' + LIMITS.name + ' characters.' };
    }
    return { value: text };
  }

  function checkImage(image) {
    var text = typeof image === 'string' ? image.trim() : '';
    if (!text) return { error: 'A schematic needs a picture.' };
    if (text.length > LIMITS.image) return { error: 'That isn’t a studio image id.' };
    return { value: text };
  }

  // A fraction of the picture, 0 to 1, kept to four decimals.
  function checkFraction(value, what) {
    var n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 1) {
      return { error: what + ' is a fraction of the picture, from 0 to 1.' };
    }
    return { value: Math.round(n * 10000) / 10000 };
  }

  // A point's fields, `input` merged over `current` (a point as stored, or
  // none for a new one). `options.elementType(id)` gives a live element's type
  // (null when there is none): a link must be to one, unless it is already the
  // point's. Gives { value: { name, description, x, y, link } } (no id).
  function checkPoint(input, current, options) {
    input = input || {};
    options = options || {};
    var base = current || { name: '', description: '', x: null, y: null, link: null };
    var name = checkName(has(input, 'name') ? input.name : base.name, 'A point');
    if (name.error) return name;
    var description = has(input, 'description') ? input.description : base.description;
    description = String(description === undefined || description === null ? '' : description);
    if (description.length > LIMITS.description) {
      return { error: 'A point’s description is at most ' + LIMITS.description + ' characters.' };
    }
    var x = checkFraction(has(input, 'x') ? input.x : base.x, 'x');
    if (x.error) return x;
    var y = checkFraction(has(input, 'y') ? input.y : base.y, 'y');
    if (y.error) return y;
    var link = has(input, 'link') ? input.link : base.link;
    link = link === undefined || link === '' ? null : link;
    if (link !== null) {
      if (typeof link !== 'string' || !ID.test(link)) {
        return { error: 'A link is an element’s id.' };
      }
      var unchanged = !!current && current.link === link;
      if (!unchanged && options.elementType && !options.elementType(link)) {
        return { error: 'A point can only link to an element of this project.' };
      }
    }
    return {
      value: {
        name: name.value,
        description: description.trim() ? description : '',
        x: x.value,
        y: y.value,
        link: link,
      },
    };
  }

  // A new point's id: "p" and the next number not used in the list.
  function newPointId(points) {
    var top = 0;
    (points || []).forEach(function (p) {
      var m = /^p(\d+)$/.exec(p.id);
      if (m) top = Math.max(top, Number(m[1]));
    });
    return 'p' + (top + 1);
  }

  // A point named by its id, its number ("3", "#3") or a name only one has.
  // Gives { value: point, number } or { error }.
  function findPoint(points, ref) {
    var text = tidy(ref);
    if (!text) return { error: 'Name a point.' };
    var list = points || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === text) return { value: list[i], number: i + 1 };
    }
    var folded = links.fold(text);
    var named = [];
    list.forEach(function (p, i) {
      if (links.fold(p.name) === folded) named.push({ value: p, number: i + 1 });
    });
    if (named.length === 1) return named[0];
    if (named.length > 1) {
      return {
        error: '“' + text + '” names ' + named.length + ' points: give one’s id or its number.',
      };
    }
    var m = /^#?(\d+)$/.exec(text);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= list.length) {
      return { value: list[Number(m[1]) - 1], number: Number(m[1]) };
    }
    return { error: 'No point “' + text + '”.' };
  }

  // ── Plans ───────────────────────────────────────

  // A new schematic of an element. `input`: { element, name, image }; `context`:
  //   elementType  the element's type (it must be a location or an object)
  //   siblings     the element's schematics now (read()), for its order
  function planCreate(projectId, id, input, context) {
    context = context || {};
    if (!input || !input.element) return { error: 'A schematic belongs to an element.' };
    if (TYPES.indexOf(context.elementType) === -1) {
      return { error: 'Only locations and objects have schematics.' };
    }
    var name = checkName(input.name);
    if (name.error) return name;
    var image = checkImage(input.image);
    if (image.error) return image;
    var siblings = context.siblings || [];
    if (siblings.length >= LIMITS.perElement) {
      return { error: 'An element has at most ' + LIMITS.perElement + ' schematics.' };
    }
    var order = siblings.reduce(function (top, s) {
      return Math.max(top, s.order + 1);
    }, 0);
    return {
      value: [
        {
          op: 'set',
          path: schematicPath(projectId, id),
          data: {
            element: input.element,
            name: name.value,
            order: order,
            image: image.value,
            points: [],
            links: [],
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      ],
    };
  }

  // A change to a schematic: `changes` { name?, image?, points? } (a whole
  // new list of points, each { id, name, description, x, y, link }).
  function planUpdate(projectId, current, changes) {
    var data = { updatedAt: NOW };
    if (has(changes, 'name')) {
      var name = checkName(changes.name);
      if (name.error) return name;
      data.name = name.value;
    }
    if (has(changes, 'image')) {
      var image = checkImage(changes.image);
      if (image.error) return image;
      data.image = image.value;
    }
    if (has(changes, 'points')) {
      if (changes.points.length > LIMITS.points) {
        return { error: 'A schematic has at most ' + LIMITS.points + ' points.' };
      }
      data.points = changes.points.map(pointOf);
      data.links = linksOf(data.points);
    }
    return {
      value: [{ op: 'update', path: schematicPath(projectId, current.id), data: data }],
    };
  }

  // A point added at the end (its number is the next), from `input`
  // { name, description?, x, y, link? }. Gives { value: writes, id, number }.
  function planAddPoint(projectId, current, input, options) {
    if (current.points.length >= LIMITS.points) {
      return { error: 'A schematic has at most ' + LIMITS.points + ' points.' };
    }
    var checked = checkPoint(input, null, options);
    if (checked.error) return checked;
    var id = newPointId(current.points);
    var point = Object.assign({ id: id }, checked.value);
    var plan = planUpdate(projectId, current, { points: current.points.concat([point]) });
    return plan.error ? plan : { value: plan.value, id: id, number: current.points.length + 1 };
  }

  // A change to point `id`, the fields of `input` merged over it.
  function planChangePoint(projectId, current, id, input, options) {
    var at = current.points.findIndex(function (p) {
      return p.id === id;
    });
    if (at === -1) return { error: 'That point is no longer there.' };
    var checked = checkPoint(input, current.points[at], options);
    if (checked.error) return checked;
    var points = current.points.slice();
    points[at] = Object.assign({ id: id }, checked.value);
    return planUpdate(projectId, current, { points: points });
  }

  // Takes point `id` off; those after it are numbered one less.
  function planRemovePoint(projectId, current, id) {
    var points = current.points.filter(function (p) {
      return p.id !== id;
    });
    if (points.length === current.points.length) return { error: 'That point is no longer there.' };
    return planUpdate(projectId, current, { points: points });
  }

  function planDelete(projectId, id) {
    return { value: [{ op: 'delete', path: schematicPath(projectId, id), data: {} }] };
  }

  // Puts a schematic at `position` (from 1) among its element's `siblings`
  // (read()), the others keeping their order: every one whose `order` is no
  // longer its place is rewritten, so ties and gaps are mended too.
  function planPlace(projectId, siblings, id, position) {
    var list = inOrder(siblings);
    var at = list.findIndex(function (s) {
      return s.id === id;
    });
    if (at === -1) return { error: 'That schematic is no longer there.' };
    var to = Math.max(0, Math.min(list.length - 1, Math.round(Number(position) || 1) - 1));
    var moved = list.splice(at, 1)[0];
    list.splice(to, 0, moved);
    var writes = [];
    list.forEach(function (s, n) {
      if (s.order !== n) {
        writes.push({
          op: 'update',
          path: schematicPath(projectId, s.id),
          data: { order: n, updatedAt: NOW },
        });
      }
    });
    return { value: writes };
  }

  // Moves a schematic earlier (-1) or later (1) among its element's.
  function planMove(projectId, siblings, id, direction) {
    var at = inOrder(siblings).findIndex(function (s) {
      return s.id === id;
    });
    if (at === -1) return { error: 'That schematic is no longer there.' };
    return planPlace(projectId, siblings, id, at + 1 + (direction < 0 ? -1 : 1));
  }

  // Where an element is marked (SC9): of every schematic ([read()]) the
  // points linking to `id`, as [{ schematic, points: [{ id, number, name }] }],
  // by schematic name.
  function markedOn(schematics, id) {
    var out = [];
    (schematics || []).forEach(function (s) {
      var points = [];
      s.points.forEach(function (p, i) {
        if (p.link === id) points.push({ id: p.id, number: i + 1, name: p.name });
      });
      if (points.length) out.push({ schematic: s, points: points });
    });
    return out.sort(function (a, b) {
      return a.schematic.name.localeCompare(b.schematic.name, undefined, { sensitivity: 'base' });
    });
  }

  var api = {
    TYPES: TYPES,
    LIMITS: LIMITS,
    read: read,
    inOrder: inOrder,
    linksOf: linksOf,
    schematicPath: schematicPath,
    checkName: checkName,
    checkImage: checkImage,
    checkFraction: checkFraction,
    checkPoint: checkPoint,
    newPointId: newPointId,
    findPoint: findPoint,
    planCreate: planCreate,
    planUpdate: planUpdate,
    planAddPoint: planAddPoint,
    planChangePoint: planChangePoint,
    planRemovePoint: planRemovePoint,
    planDelete: planDelete,
    planPlace: planPlace,
    planMove: planMove,
    markedOn: markedOn,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.schematics = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
