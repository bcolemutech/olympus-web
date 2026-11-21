/* global module, window */
(function () {
  'use strict';

  // How elements point at each other (planning/the-muse.md §3 EL3–EL6; M-103
  // / #891), as plain data the page and the Muse connector (M-106) share:
  //
  //   relationships  muse_projects/{p}/relationships/{id}
  //     a, b         the two elements' ids (fixed once made)
  //     aToB, bToA   what each is to the other: "mother of" / "daughter of"
  //     description  a few words on it (plain text)
  //     ends         [a, b], for the query "every relationship of X"
  //     createdAt, updatedAt
  //   The time on the timeline (`when`) comes with M-300.
  //
  //   @-links        [Name](muse:el/<id>) in a Markdown text. An element keeps
  //                  `mentions`, the ids its bio and appearance link to, so
  //                  "mentioned in" is a query (array-contains).
  //   auto-links     a name or alias found elsewhere in a shown text is made a
  //                  link when the text is drawn; nothing is stored.
  //   search         names and aliases, ranked, over the index.
  //
  // Checks take raw input and give back { value } or { error }; plans are
  // lists of writes, { op, path, data }, as in ./model.js.

  var LIMITS = { kind: 100, description: 1000, mentions: 1000, query: 200 };
  // The server's time in a plan; ./model.js uses this same object, and the
  // page and the connector turn it into the database's own.
  var NOW = { __muse: 'now' };
  var ID = /^[A-Za-z0-9_-]{1,128}$/;

  function relationshipPath(projectId, id) {
    return 'muse_projects/' + projectId + '/relationships/' + id;
  }

  function tidy(value) {
    return String(value === undefined || value === null ? '' : value)
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ── Relationships (EL3) ─────────────────────────

  // Checks a relationship's words. `input`: { aToB, bToA?, description? };
  // a blank `bToA` means the same from both sides ("friend of").
  function checkKinds(input) {
    var aToB = tidy(input && input.aToB);
    if (!aToB) return { error: 'Say what the first is to the second, like “mother of”.' };
    var bToA = tidy(input && input.bToA) || aToB;
    if (aToB.length > LIMITS.kind || bToA.length > LIMITS.kind) {
      return { error: 'A kind of relationship is at most ' + LIMITS.kind + ' characters.' };
    }
    var description = String(
      input && input.description !== undefined && input.description !== null
        ? input.description
        : ''
    ).trim();
    if (description.length > LIMITS.description) {
      return { error: 'A description is at most ' + LIMITS.description + ' characters.' };
    }
    return { value: { aToB: aToB, bToA: bToA, description: description } };
  }

  // A new relationship from `a` to `b`: `elementType(id)` gives a live
  // element's type, or null. Gives { value: { a, b, aToB, bToA, description } }.
  function checkRelationship(input, context) {
    var elementType = (context && context.elementType) || function () {};
    var a = tidy(input && input.a);
    var b = tidy(input && input.b);
    if (!a || !b) return { error: 'Pick the two elements to relate.' };
    if (a === b) return { error: 'An element can’t be related to itself.' };
    if (!elementType(a) || !elementType(b)) {
      return { error: 'Both elements must be in this project, and not retired.' };
    }
    var kinds = checkKinds(input);
    if (kinds.error) return kinds;
    return {
      value: {
        a: a,
        b: b,
        aToB: kinds.value.aToB,
        bToA: kinds.value.bToA,
        description: kinds.value.description,
      },
    };
  }

  // A relationship as one of its elements reads it: the other end, what this
  // element is to it (`kind`: "mother of") and what it is to this one
  // (`back`: "daughter of"). Gives null when `id` isn't an end of it.
  function sideOf(relationship, id) {
    if (relationship.a === id) {
      return {
        id: relationship.id,
        other: relationship.b,
        kind: relationship.aToB,
        back: relationship.bToA,
        description: relationship.description || '',
      };
    }
    if (relationship.b === id) {
      return {
        id: relationship.id,
        other: relationship.a,
        kind: relationship.bToA,
        back: relationship.aToB,
        description: relationship.description || '',
      };
    }
    return null;
  }

  // The change an element's page makes, in its own terms (`kind` is what it
  // is to the other end), back into the relationship's: { aToB, bToA }.
  function fromSide(relationship, id, kind, back) {
    return relationship.a === id ? { aToB: kind, bToA: back } : { aToB: back, bToA: kind };
  }

  function planRelate(projectId, id, checked) {
    return [
      {
        op: 'set',
        path: relationshipPath(projectId, id),
        data: {
          a: checked.a,
          b: checked.b,
          aToB: checked.aToB,
          bToA: checked.bToA,
          description: checked.description,
          ends: [checked.a, checked.b],
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    ];
  }

  // Words and description only: the ends are fixed. `changes`: { aToB, bToA,
  // description } (checkKinds' value).
  function planRelationshipUpdate(projectId, id, changes) {
    return [
      {
        op: 'update',
        path: relationshipPath(projectId, id),
        data: {
          aToB: changes.aToB,
          bToA: changes.bToA,
          description: changes.description,
          updatedAt: NOW,
        },
      },
    ];
  }

  function planUnrelate(projectId, id) {
    return [{ op: 'delete', path: relationshipPath(projectId, id) }];
  }

  // ── @-links (EL6) ───────────────────────────────

  // The Markdown for a link to an element. Brackets in a name would end the
  // label early, so they are left out of it.
  function linkMarkdown(name, id) {
    var label = String(name || '').replace(/[[\]]/g, '') || 'link';
    return '[' + label + '](muse:el/' + id + ')';
  }

  // The ids a Markdown text links to, as the page would show them: once
  // each, in order, and none inside code (a fenced block or `inline`).
  function mentionsOf() {
    var seen = {};
    var out = [];
    for (var t = 0; t < arguments.length; t++) {
      var text = String(arguments[t] || '')
        .replace(/\r\n?/g, '\n')
        .replace(/^[ \t]*```[\s\S]*?(?:^[ \t]*```|$(?![\s\S]))/gm, '')
        .replace(/`[^`\n]+`/g, '');
      var re = /\[[^\]\n]+\]\(muse:el\/([A-Za-z0-9_-]{1,128})\)/g;
      var m;
      while ((m = re.exec(text))) {
        if (!seen[m[1]]) {
          seen[m[1]] = true;
          out.push(m[1]);
        }
      }
    }
    return out.slice(0, LIMITS.mentions);
  }

  // ── Names ───────────────────────────────────────

  // Case and accents set aside, for matching.
  function fold(text) {
    return String(text === undefined || text === null ? '' : text)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function regexEscape(text) {
    return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }

  // Auto-links (EL6). `entries`: { id: { name, aliases } } (the index).
  // A name or alias is linked only when it is at least two characters with a
  // letter in it, and belongs to one element: when two share it, neither
  // links. The longest wins ("King Peter" over "Peter"), and a match is a
  // whole word, whatever its case.
  //
  //   buildMatcher(entries, { escape })
  //     escape: the Markdown renderer's HTML escape, since the text it
  //             matches in is already escaped (O'Brien is O&#39;Brien there)
  //   matcher.link(segment, hold, except) → segment, with each match held
  //     as `hold(html)` (a placeholder); `except` is an element id not to
  //     link (its own page).
  //   matcher.size → how many names it can link
  var LETTER = /\p{L}/u;

  function buildMatcher(entries, options) {
    var escape = (options && options.escape) || String;
    var owners = {}; // folded term → { id, term } | null when two elements share it
    Object.keys(entries || {}).forEach(function (id) {
      var entry = entries[id];
      [entry.name].concat(entry.aliases || []).forEach(function (term) {
        term = tidy(term);
        if (term.length < 2 || !LETTER.test(term)) return;
        var key = fold(escape(term));
        if (!Object.prototype.hasOwnProperty.call(owners, key)) {
          owners[key] = { id: id, term: escape(term) };
        } else if (owners[key] && owners[key].id !== id) {
          owners[key] = null;
        }
      });
    });
    var terms = Object.keys(owners)
      .filter(function (key) {
        return owners[key];
      })
      .map(function (key) {
        return owners[key].term;
      })
      .sort(function (a, b) {
        return b.length - a.length || (a < b ? -1 : 1);
      });
    var pattern = null;
    if (terms.length) {
      // `&` and `#` before a term would find "amp" in `&amp;` and "39" in
      // `&#39;`, so a term never starts right after one.
      pattern = new RegExp(
        '(^|[^\\p{L}\\p{N}_&#])(' + terms.map(regexEscape).join('|') + ')(?![\\p{L}\\p{N}_])',
        'giu'
      );
    }
    return {
      size: terms.length,
      link: function (segment, hold, except) {
        if (!pattern) return segment;
        pattern.lastIndex = 0;
        return segment.replace(pattern, function (whole, before, match) {
          var owner = owners[fold(match)];
          if (!owner || owner.id === except) return whole;
          return (
            before +
            hold(
              '<a class="muse-el-link muse-auto" href="#" data-el="' +
                owner.id +
                '">' +
                match +
                '</a>'
            )
          );
        });
      },
    };
  }

  // ── Search (EL5) ────────────────────────────────

  // Names and aliases, ranked: an exact name or alias, then one that starts
  // with the query, then a word of one that does, then one that holds it.
  // The name beats its aliases at each rank.
  //   search(entries, query, { limit, types, except })
  //     entries: { id: { type, name, aliases, primary } }
  //     gives [{ id, type, name, aliases, primary, matched }] where `matched`
  //     is the alias that matched when it wasn't the name (else null)
  // An empty query lists the first by name.
  var WORD_START = /[\s\-\u2013\u2014'\u2019.,(]/;
  function rank(term, q) {
    var t = fold(term);
    if (t === q) return 4;
    var at = t.indexOf(q);
    if (at === -1) return 0;
    if (at === 0) return 3;
    while (at !== -1) {
      if (WORD_START.test(t.charAt(at - 1))) return 2;
      at = t.indexOf(q, at + 1);
    }
    return 1;
  }

  function search(entries, query, options) {
    options = options || {};
    var q = fold(tidy(query).slice(0, LIMITS.query));
    var limit = options.limit || 8;
    var found = [];
    Object.keys(entries || {}).forEach(function (id) {
      var entry = entries[id];
      if (options.except && id === options.except) return;
      if (options.types && options.types.length && options.types.indexOf(entry.type) === -1) {
        return;
      }
      var best = 0;
      var matched = null;
      if (!q) {
        best = 1;
      } else {
        best = rank(entry.name, q) * 2 + 1;
        if (best === 1) best = 0;
        (entry.aliases || []).forEach(function (alias) {
          var score = rank(alias, q) * 2;
          if (score > best) {
            best = score;
            matched = alias;
          }
        });
      }
      if (best > 0) {
        found.push({
          id: id,
          type: entry.type,
          name: entry.name,
          aliases: entry.aliases || [],
          primary: entry.primary === undefined ? null : entry.primary,
          matched: matched,
          score: best,
        });
      }
    });
    found.sort(function (a, b) {
      return (
        b.score - a.score ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        (a.id < b.id ? -1 : 1)
      );
    });
    return found.slice(0, limit);
  }

  var api = {
    LIMITS: LIMITS,
    NOW: NOW,
    ID: ID,
    checkKinds: checkKinds,
    checkRelationship: checkRelationship,
    sideOf: sideOf,
    fromSide: fromSide,
    planRelate: planRelate,
    planRelationshipUpdate: planRelationshipUpdate,
    planUnrelate: planUnrelate,
    linkMarkdown: linkMarkdown,
    mentionsOf: mentionsOf,
    fold: fold,
    buildMatcher: buildMatcher,
    search: search,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.links = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
