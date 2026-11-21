'use strict';

const links = require('./links');

/**
 * Full-text search of a project (planning/the-muse.md §3 EL5; M-106 / #894).
 * Names and aliases are searched on the page from the index (./links.js
 * search); bios, appearances and text fields are searched here, on the
 * server, for the Muse connector's `search` tool and the page's "Search all
 * text" box (the museSearch callable), so both find the same things.
 *
 * Every word of the query must be found in an element (in any of its texts);
 * words in "double quotes" are found as a phrase. Case and accents are set
 * aside, and Markdown is read as a reader sees it (a link by its words).
 *
 *   searchText(elements, query, { fields, types, limit })
 *     elements  [{ id, type, name, aliases, bio, appearance, fields, primary }]
 *     fields    the project's field definitions by type (text fields are searched)
 *   → { terms, total, results: [{ id, type, name, aliases, primary, where, snippet }] }
 *     where     the texts it was found in: name, aliases, bio, appearance, or a
 *               field's label
 *     snippet   { in, text, marks: [[start, end], …] } around the first match in
 *               a longer text, or null when only the name or aliases matched
 */

const LIMITS = { query: 200, terms: 12, results: 50, snippet: 200 };
const BEFORE = 60; // characters of a snippet before its first match

// Markdown as a reader sees it, on one line: links and images by their words,
// headings, quotes and emphasis marks left out.
function plainText(markdown) {
  return String(markdown === undefined || markdown === null ? '' : markdown)
    .replace(/!\[([^\]\n]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]\n]+)\]\([^)\s]*\)/g, '$1')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// The words and "phrases" of a query, folded, without repeats.
function termsOf(query) {
  const text = String(query === undefined || query === null ? '' : query).slice(0, LIMITS.query);
  const out = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    const term = links.fold((m[1] || m[2]).replace(/\s+/g, ' ').trim());
    if (term && !out.includes(term)) out.push(term);
  }
  return out.slice(0, LIMITS.terms);
}

// A text folded, with where each folded character came from in the text.
function foldMap(text) {
  let folded = '';
  const at = [];
  let i = 0;
  for (const ch of text) {
    const f = links.fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(i);
  return { folded, at };
}

// Every place `term` is found in `folded`, as [start, end] in the text.
function hits(map, term) {
  const out = [];
  let from = map.folded.indexOf(term);
  while (from !== -1) {
    out.push([map.at[from], map.at[from + term.length]]);
    from = map.folded.indexOf(term, from + term.length);
  }
  return out;
}

// A window of `text` around its first hit, with every hit inside it marked.
function snippetOf(where, text, found) {
  const first = found.reduce((min, h) => (h[0] < min ? h[0] : min), Infinity);
  let start = Math.max(0, first - BEFORE);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space !== -1 && space < first) start = space + 1;
  }
  let end = Math.min(text.length, start + LIMITS.snippet);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > first) end = space;
  }
  const lead = start > 0 ? '…' : '';
  const marks = found
    .filter(([s, e]) => s >= start && e <= end)
    .sort((a, b) => a[0] - b[0])
    .filter((h, i, all) => i === 0 || h[0] >= all[i - 1][1])
    .map(([s, e]) => [s - start + lead.length, e - start + lead.length]);
  return { in: where, text: lead + text.slice(start, end) + (end < text.length ? '…' : ''), marks };
}

// An element's texts to search, in the order a match is reported.
function partsOf(element, defs) {
  const parts = [
    { where: 'name', text: String(element.name || '') },
    { where: 'aliases', text: (element.aliases || []).join(', ') },
    { where: 'bio', text: plainText(element.bio) },
    { where: 'appearance', text: plainText(element.appearance) },
  ];
  (defs || []).forEach((def) => {
    const value = element.fields && element.fields[def.key];
    if (def.kind === 'text' && typeof value === 'string' && value) {
      parts.push({ where: def.label, text: value.replace(/\s+/g, ' ').trim() });
    }
  });
  return parts.filter((part) => part.text);
}

function searchText(elements, query, options = {}) {
  const terms = termsOf(query);
  if (!terms.length) return { terms, total: 0, results: [] };
  const limit = Math.min(options.limit || 20, LIMITS.results);
  const types = options.types && options.types.length ? options.types : null;
  const found = [];
  (elements || []).forEach((element) => {
    if (element.retired) return;
    if (types && !types.includes(element.type)) return;
    const parts = partsOf(element, (options.fields || {})[element.type]).map((part) => {
      const map = foldMap(part.text);
      return { ...part, found: terms.map((term) => hits(map, term)) };
    });
    // Every term somewhere.
    if (!terms.every((_, t) => parts.some((part) => part.found[t].length))) return;
    let score = 0;
    parts.forEach((part) => {
      part.found.forEach((list) => {
        if (!list.length) return;
        if (part.where === 'name') score += 10;
        else if (part.where === 'aliases') score += 6;
        else score += Math.min(list.length, 5);
      });
    });
    const where = parts.filter((part) => part.found.some((l) => l.length)).map((p) => p.where);
    // The snippet from the longer text with the most terms in it.
    let best = null;
    parts.forEach((part) => {
      if (part.where === 'name' || part.where === 'aliases') return;
      const count = part.found.filter((l) => l.length).length;
      if (count && (!best || count > best.count)) best = { part, count };
    });
    found.push({
      id: element.id,
      type: element.type,
      name: element.name,
      aliases: element.aliases || [],
      primary: element.primary === undefined ? null : element.primary,
      where,
      snippet: best ? snippetOf(best.part.where, best.part.text, best.part.found.flat()) : null,
      score,
    });
  });
  found.sort(
    (a, b) =>
      b.score - a.score ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      (a.id < b.id ? -1 : 1)
  );
  return {
    terms,
    total: found.length,
    results: found.slice(0, limit).map(({ score, ...row }) => {
      void score;
      return row;
    }),
  };
}

module.exports = { LIMITS, plainText, termsOf, searchText };
