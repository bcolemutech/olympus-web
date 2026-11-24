/* global module, window, require */
(function () {
  'use strict';

  // Classifications and their classes (planning/the-muse.md §3 CL1–CL10,
  // D3–D6, D9, §4; M-201 / #914), as plain data: what they may hold, the
  // tree they make, and the writes that make, change and delete them and
  // classify an element. This file is the same, byte for byte, in
  // functions/muse/classes.js (a test fails if the copies differ), so the
  // page and the Muse connector make the same checks and the same writes.
  //
  //   muse_projects/{p}/classifications/{id}
  //     type       the element type it belongs to (CL1; fixed)
  //     name       "Weapons"; unique among its type's
  //     multiple   true: an element may hold several of its classes; false:
  //                one, and a second replaces the first (D6)
  //     createdAt, updatedAt
  //
  //   muse_projects/{p}/classes/{id}
  //     classification, parent (a class id, or null at the top), depth (1–6;
  //                CL4): all three fixed once made, so a class is renamed,
  //                never moved (CL8)
  //     name       unique among its siblings
  //     description (Markdown, with @-links), images and primary (as an
  //                element's), mentions (the ids its description links to)
  //     createdAt, updatedAt
  //
  // An element holds `classes`, at most 50 ids, at any level (CL2), and its
  // index line holds them too (D3), so a list filtered by a class, with
  // everything beneath it (CL5), comes from the index alone. A class's id is
  // from the same space as an element's (D5): a text links one as
  // [Longsword](muse:cl/<id>), and its "mentioned in" is the same query.
  //
  // The page loads a project's classifications and classes once (D4), into a
  // tree (readTree); a class's path, its subclasses and the instant search
  // come from it. Checks give { value } or { error }; plans are lists of
  // writes, { op, path, data }, as in ./model.js.

  var fields =
    typeof window !== 'undefined' && window.Muse && window.Muse.fields
      ? window.Muse.fields
      : require('./fields.js');

  var links =
    typeof window !== 'undefined' && window.Muse && window.Muse.links
      ? window.Muse.links
      : require('./links.js');

  var TYPES = fields.TYPES;
  var NOW = links.NOW;
  var LIMITS = {
    name: 100,
    description: 200000,
    depth: 6, // CL4
    classes: 2000, // a project's (D4)
    classifications: 100, // a project's
    perElement: 50, // an element's classes
  };
  var SEPARATOR = ' › ';

  function projectPath(projectId) {
    return 'muse_projects/' + projectId;
  }

  function classificationPath(projectId, id) {
    return projectPath(projectId) + '/classifications/' + id;
  }

  function classPath(projectId, id) {
    return projectPath(projectId) + '/classes/' + id;
  }

  function tidy(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  function byName(a, b) {
    return (
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1)
    );
  }

  function has(map, key) {
    return !!map && Object.prototype.hasOwnProperty.call(map, key);
  }

  // ── The tree in memory ──────────────────────────
  // { classifications: { id: { id, type, name, multiple } },
  //   classes: { id: { id, classification, parent, depth, name, description,
  //                    images, primary, mentions } },
  //   kids: { parent key: [ids] } }, read from the documents ([{ id, data }]).
  // A parent key is the classification's id for its top classes, and the
  // class's id for those beneath it.
  function readTree(classificationDocs, classDocs) {
    var tree = { classifications: {}, classes: {}, kids: {} };
    (classificationDocs || []).forEach(function (doc) {
      var data = doc.data || {};
      tree.classifications[doc.id] = {
        id: doc.id,
        type: data.type,
        name: data.name || '',
        multiple: data.multiple === true,
      };
    });
    (classDocs || []).forEach(function (doc) {
      tree.classes[doc.id] = classOf(doc.id, doc.data || {});
    });
    return index(tree);
  }

  function classOf(id, data) {
    return {
      id: id,
      classification: data.classification,
      parent: data.parent || null,
      depth: data.depth || 1,
      name: data.name || '',
      description: data.description || '',
      images: Array.isArray(data.images) ? data.images.slice() : [],
      primary: data.primary === undefined ? null : data.primary,
      mentions: Array.isArray(data.mentions) ? data.mentions.slice() : [],
    };
  }

  // Works out each class's subclasses, by name.
  function index(tree) {
    tree.kids = {};
    Object.keys(tree.classes).forEach(function (id) {
      var c = tree.classes[id];
      var key = c.parent || c.classification;
      (tree.kids[key] = tree.kids[key] || []).push(id);
    });
    Object.keys(tree.kids).forEach(function (key) {
      tree.kids[key].sort(function (a, b) {
        return byName(tree.classes[a], tree.classes[b]);
      });
    });
    return tree;
  }

  function emptyTree() {
    return { classifications: {}, classes: {}, kids: {} };
  }

  // The tree after a plan is done, so the page needn't read it again.
  function applyToTree(tree, writes) {
    writes.forEach(function (write) {
      var m = /\/(classifications|classes)\/([^/]+)$/.exec(write.path);
      if (!m) return;
      var map = m[1] === 'classes' ? tree.classes : tree.classifications;
      var id = m[2];
      if (write.op === 'delete') {
        delete map[id];
        return;
      }
      var before = write.op === 'set' ? {} : map[id] || {};
      var data = Object.assign({}, before, write.data);
      if (m[1] === 'classes') {
        map[id] = classOf(id, data);
      } else {
        map[id] = { id: id, type: data.type, name: data.name || '', multiple: !!data.multiple };
      }
    });
    return index(tree);
  }

  // A classification's (no `parent`) or a class's subclasses, by name.
  function children(tree, classificationId, parentId) {
    return ((tree && tree.kids[parentId || classificationId]) || []).map(function (id) {
      return tree.classes[id];
    });
  }

  // A type's classifications, by name.
  function classificationsOf(tree, type) {
    return Object.keys((tree && tree.classifications) || {})
      .map(function (id) {
        return tree.classifications[id];
      })
      .filter(function (c) {
        return !type || c.type === type;
      })
      .sort(byName);
  }

  // A class and its ancestors, from the top down ([] when it isn't there).
  function chain(tree, id) {
    var out = [];
    var seen = {};
    var at = tree && tree.classes[id];
    while (at && !seen[at.id] && out.length < LIMITS.depth + 1) {
      seen[at.id] = true;
      out.unshift(at);
      at = at.parent ? tree.classes[at.parent] : null;
    }
    return out;
  }

  // A class's path as names: its classification's, then each class down to
  // it ("Weapons", "Sword", "Double Edge", "Longsword"). `short` leaves the
  // classification's out.
  function pathOf(tree, id, short) {
    var classes = chain(tree, id);
    if (!classes.length) return [];
    var names = classes.map(function (c) {
      return c.name;
    });
    var classification = tree.classifications[classes[0].classification];
    return short || !classification ? names : [classification.name].concat(names);
  }

  function pathText(tree, id, short) {
    return pathOf(tree, id, short).join(SEPARATOR);
  }

  // A class and every class beneath it, as ids.
  function beneath(tree, id) {
    var out = [];
    var stack = tree && tree.classes[id] ? [id] : [];
    while (stack.length) {
      var at = stack.pop();
      out.push(at);
      stack = stack.concat((tree.kids[at] || []).slice().reverse());
    }
    return out;
  }

  // Every class of a classification, from the top down, each with its depth:
  // the order a picker lists them in.
  function flatten(tree, classificationId) {
    var out = [];
    (function walk(key) {
      ((tree && tree.kids[key]) || []).forEach(function (id) {
        out.push(tree.classes[id]);
        walk(id);
      });
    })(classificationId);
    return out;
  }

  // Classes as lines the instant search and the auto-links read, as the
  // index's are: { id: { type: 'class', name, aliases, primary, classification } }.
  function entriesOf(tree) {
    var out = {};
    Object.keys((tree && tree.classes) || {}).forEach(function (id) {
      var c = tree.classes[id];
      out[id] = {
        type: 'class',
        name: c.name,
        aliases: [],
        primary: c.primary,
        classification: c.classification,
      };
    });
    return out;
  }

  // The live elements (index entries, { id: { type, classes } }) in a class
  // or beneath it (CL5), as ids.
  function membersOf(tree, entries, id) {
    var wanted = {};
    beneath(tree, id).forEach(function (c) {
      wanted[c] = true;
    });
    return Object.keys(entries || {}).filter(function (eid) {
      return (entries[eid].classes || []).some(function (c) {
        return wanted[c];
      });
    });
  }

  // A class named by its id, its path ("Weapons › Sword › Longsword", with
  // or without the classification's name; › > or / between), or a name only
  // one class has. `type` keeps to that element type's classifications.
  // Gives { value: id } or { error }.
  function findClass(tree, ref, type) {
    var text = tidy(ref);
    if (!text) return { error: 'Name a class.' };
    var inType = function (c) {
      var classification = tree.classifications[c.classification];
      return !type || (classification && classification.type === type);
    };
    if (tree.classes[text]) {
      return inType(tree.classes[text])
        ? { value: text }
        : { error: 'That class is for another type of element.' };
    }
    var parts = text
      .split(/\s*(?:›|>|\/)\s*/)
      .map(function (p) {
        return links.fold(p);
      })
      .filter(Boolean);
    var matches = Object.keys(tree.classes).filter(function (id) {
      var c = tree.classes[id];
      if (!inType(c)) return false;
      var full = pathOf(tree, id).map(links.fold);
      if (parts.length > full.length) return false;
      // The end of its path, from a class (or the classification) down.
      var tail = full.slice(full.length - parts.length);
      return tail.every(function (name, i) {
        return name === parts[i];
      });
    });
    if (matches.length === 1) return { value: matches[0] };
    if (!matches.length) return { error: 'No class “' + text + '”.' };
    return {
      error:
        '“' +
        text +
        '” could be ' +
        matches
          .slice(0, 5)
          .map(function (id) {
            return pathText(tree, id);
          })
          .join(' or ') +
        ': give more of its path.',
    };
  }

  // ── Checks ──────────────────────────────────────

  function checkName(name, what) {
    var text = tidy(name);
    if (!text) return { error: (what || 'It') + ' needs a name.' };
    if (text.length > LIMITS.name) {
      return { error: 'A name is at most ' + LIMITS.name + ' characters.' };
    }
    return { value: text };
  }

  function sameName(a, b) {
    return links.fold(a) === links.fold(b);
  }

  // ── Classifications ─────────────────────────────

  // A new classification: `input` { type, name, multiple }.
  function planCreateClassification(projectId, id, input, tree) {
    tree = tree || emptyTree();
    var type = input && input.type;
    if (TYPES.indexOf(type) === -1) return { error: 'There is no element type “' + type + '”.' };
    var name = checkName(input.name, 'A classification');
    if (name.error) return name;
    var all = classificationsOf(tree);
    if (all.length >= LIMITS.classifications) {
      return { error: 'A project has at most ' + LIMITS.classifications + ' classifications.' };
    }
    var clash = classificationsOf(tree, type).some(function (c) {
      return sameName(c.name, name.value);
    });
    if (clash) return { error: 'This type already has a classification called that.' };
    return {
      value: [
        {
          op: 'set',
          path: classificationPath(projectId, id),
          data: {
            type: type,
            name: name.value,
            multiple: input.multiple === true,
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      ],
    };
  }

  // A classification renamed, or made single or multiple. `holders`: the
  // elements of its type, live and retired, as [{ id, name, classes }], for
  // making it single: refused while one holds two of its classes (D6).
  function planUpdateClassification(projectId, tree, id, input, holders) {
    var current = tree.classifications[id];
    if (!current) return { error: 'There is no such classification.' };
    var data = {};
    if (has(input, 'name')) {
      var name = checkName(input.name, 'A classification');
      if (name.error) return name;
      var clash = classificationsOf(tree, current.type).some(function (c) {
        return c.id !== id && sameName(c.name, name.value);
      });
      if (clash) return { error: 'This type already has a classification called that.' };
      data.name = name.value;
    }
    if (has(input, 'multiple')) {
      var multiple = input.multiple === true;
      if (!multiple && current.multiple) {
        var mine = {};
        flatten(tree, id).forEach(function (c) {
          mine[c.id] = true;
        });
        var two = (holders || []).find(function (h) {
          return (
            (h.classes || []).filter(function (c) {
              return mine[c];
            }).length > 1
          );
        });
        if (two) {
          return {
            error:
              (two.name || 'An element') +
              ' holds two of its classes: leave it one before making it single.',
          };
        }
      }
      data.multiple = multiple;
    }
    if (!Object.keys(data).length) return { error: 'Say what to change.' };
    data.updatedAt = NOW;
    return { value: [{ op: 'update', path: classificationPath(projectId, id), data: data }] };
  }

  // Deleting a classification is refused while it has classes.
  function planDeleteClassification(projectId, tree, id) {
    if (!tree.classifications[id]) return { error: 'There is no such classification.' };
    if (children(tree, id).length) {
      return { error: 'It still has classes: delete them first.' };
    }
    return { value: [{ op: 'delete', path: classificationPath(projectId, id) }] };
  }

  // ── Classes ─────────────────────────────────────

  function checkDescription(text) {
    var value = String(text === undefined || text === null ? '' : text);
    if (value.length > LIMITS.description) return { error: 'The description is too long.' };
    return { value: value };
  }

  function siblingClash(tree, classificationId, parentId, name, except) {
    return children(tree, classificationId, parentId).some(function (c) {
      return c.id !== except && sameName(c.name, name);
    });
  }

  // A new class: `input` { classification, parent (a class id or null), name,
  // description }. It goes one level below its parent, at most 6 deep (CL4).
  function planCreateClass(projectId, id, input, tree) {
    input = input || {};
    var parent = input.parent ? tree.classes[input.parent] : null;
    if (input.parent && !parent) return { error: 'There is no such class to put it under.' };
    var classificationId = parent ? parent.classification : input.classification;
    if (!tree.classifications[classificationId]) {
      return { error: 'There is no such classification.' };
    }
    if (input.classification && input.classification !== classificationId) {
      return { error: 'A subclass is in its parent’s classification.' };
    }
    var depth = parent ? parent.depth + 1 : 1;
    if (depth > LIMITS.depth) {
      return { error: 'A classification is at most ' + LIMITS.depth + ' levels deep.' };
    }
    if (Object.keys(tree.classes).length >= LIMITS.classes) {
      return { error: 'A project has at most ' + LIMITS.classes + ' classes.' };
    }
    var name = checkName(input.name, 'A class');
    if (name.error) return name;
    if (siblingClash(tree, classificationId, parent && parent.id, name.value)) {
      return { error: 'There is already a class called that here.' };
    }
    var description = checkDescription(input.description);
    if (description.error) return description;
    return {
      value: [
        {
          op: 'set',
          path: classPath(projectId, id),
          data: {
            classification: classificationId,
            parent: parent ? parent.id : null,
            depth: depth,
            name: name.value,
            description: description.value,
            images: [],
            primary: null,
            mentions: links.mentionsOf(description.value),
            createdAt: NOW,
            updatedAt: NOW,
          },
        },
      ],
    };
  }

  // A class renamed or described (never moved: CL8). `input` { name,
  // description }; `photos`, when given, is model.checkPhotos' value.
  function planUpdateClass(projectId, tree, id, input, photos) {
    var current = tree.classes[id];
    if (!current) return { error: 'There is no such class.' };
    var data = {};
    if (has(input, 'name')) {
      var name = checkName(input.name, 'A class');
      if (name.error) return name;
      if (siblingClash(tree, current.classification, current.parent, name.value, id)) {
        return { error: 'There is already a class called that here.' };
      }
      data.name = name.value;
    }
    if (has(input, 'description')) {
      var description = checkDescription(input.description);
      if (description.error) return description;
      data.description = description.value;
      data.mentions = links.mentionsOf(description.value);
    }
    if (photos) {
      data.images = photos.images;
      data.primary = photos.primary;
    }
    if (!Object.keys(data).length) return { error: 'Say what to change.' };
    data.updatedAt = NOW;
    return { value: [{ op: 'update', path: classPath(projectId, id), data: data }] };
  }

  // Deleting a class is refused while anything is in it (CL7): a subclass,
  // or an element, live or retired (`held`: true when one holds it).
  function planDeleteClass(projectId, tree, id, held) {
    if (!tree.classes[id]) return { error: 'There is no such class.' };
    if ((tree.kids[id] || []).length) {
      return { error: 'It has subclasses: delete or empty them first.' };
    }
    if (held) {
      return { error: 'Elements are in it: move them to another class first.' };
    }
    return { value: [{ op: 'delete', path: classPath(projectId, id) }] };
  }

  // ── Classifying ─────────────────────────────────

  // An element's classes, checked for an element of `type`: each a class of
  // one of its type's classifications (one it holds already may stay, as a
  // field kept), each once, at most 50, and at most one of a single
  // classification. Gives { value: [ids] } or { error }.
  function checkClasses(tree, type, list, kept) {
    if (list === undefined || list === null) list = [];
    if (!Array.isArray(list)) return { error: 'Classes must be a list.' };
    var had = {};
    (kept || []).forEach(function (id) {
      had[id] = true;
    });
    var out = [];
    var seen = {};
    var single = {};
    for (var i = 0; i < list.length; i++) {
      var id = typeof list[i] === 'string' ? list[i].trim() : '';
      if (!id || seen[id]) continue;
      var c = tree.classes[id];
      var classification = c && tree.classifications[c.classification];
      if (!classification) {
        if (had[id]) {
          seen[id] = true;
          out.push(id);
          continue;
        }
        return { error: 'There is no such class.' };
      }
      if (classification.type !== type) {
        return { error: '“' + c.name + '” is a class for another type of element.' };
      }
      if (!classification.multiple) {
        if (single[classification.id]) {
          return { error: classification.name + ' gives an element only one class.' };
        }
        single[classification.id] = true;
      }
      seen[id] = true;
      out.push(id);
    }
    if (out.length > LIMITS.perElement) {
      return { error: 'An element has at most ' + LIMITS.perElement + ' classes.' };
    }
    return { value: out };
  }

  // An element's classes with some added and some taken off. A class added
  // takes the place of one in its line (its ancestor, refined, or a
  // descendant) and, in a single classification, of any other of it (D6).
  function classify(tree, held, add, remove) {
    var out = (held || []).filter(function (id) {
      return (remove || []).indexOf(id) === -1;
    });
    (add || []).forEach(function (id) {
      var c = tree.classes[id];
      if (!c) {
        if (out.indexOf(id) === -1) out.push(id);
        return;
      }
      var classification = tree.classifications[c.classification];
      var line = {};
      chain(tree, id).forEach(function (a) {
        line[a.id] = true;
      });
      beneath(tree, id).forEach(function (b) {
        line[b] = true;
      });
      out = out.filter(function (other) {
        var o = tree.classes[other];
        if (!o || o.classification !== c.classification) return true;
        if (classification && !classification.multiple) return false;
        return !line[other];
      });
      out.push(id);
    });
    return out;
  }

  var api = {
    LIMITS: LIMITS,
    SEPARATOR: SEPARATOR,
    classificationPath: classificationPath,
    classPath: classPath,
    readTree: readTree,
    emptyTree: emptyTree,
    applyToTree: applyToTree,
    children: children,
    classificationsOf: classificationsOf,
    chain: chain,
    pathOf: pathOf,
    pathText: pathText,
    beneath: beneath,
    flatten: flatten,
    entriesOf: entriesOf,
    membersOf: membersOf,
    findClass: findClass,
    checkName: checkName,
    planCreateClassification: planCreateClassification,
    planUpdateClassification: planUpdateClassification,
    planDeleteClassification: planDeleteClassification,
    planCreateClass: planCreateClass,
    planUpdateClass: planUpdateClass,
    planDeleteClass: planDeleteClass,
    checkClasses: checkClasses,
    classify: classify,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.classes = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
