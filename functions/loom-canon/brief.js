'use strict';

/**
 * A world's brief (L-711; planning/worlds-without-azgaar.md §4.1, W6): what
 * kind of world it is, in four short pieces of text.
 *
 *   world.brief = { genre, tone, era, artDirection }
 *
 * Each is optional and a few words to a few sentences long. The GM is told the
 * brief every turn (`briefLine`), and the image studio uses the art direction
 * as the world's style when it has none of its own (`artStyleOf`).
 *
 * Pure: no Firestore. Shared by the MCP tools (create_world, update_world),
 * the Cartographer page's callables and the turn's prompts.
 */

const FIELDS = ['genre', 'tone', 'era', 'artDirection'];

// The most each may hold, in characters.
const LIMITS = Object.freeze({ genre: 80, tone: 160, era: 120, artDirection: 600 });

// How each reads in a refusal and in the GM's line.
const LABELS = Object.freeze({
  genre: 'genre',
  tone: 'tone',
  era: 'era',
  artDirection: 'art direction',
});

/**
 * Checks a brief given as `{ genre?, tone?, era?, artDirection? }` of text.
 * A field set to "" is a field to clear. Returns the fields given, trimmed,
 * and the reasons any is refused (none when it is good).
 */
function checkBrief(input) {
  const errors = [];
  const fields = {};
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { fields, errors: ['The brief is an object: { genre, tone, era, artDirection }.'] };
  }
  for (const key of Object.keys(input)) {
    if (!FIELDS.includes(key)) {
      errors.push(`The brief has no "${key}"; its fields are ${FIELDS.join(', ')}.`);
      continue;
    }
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') {
      errors.push(`The brief's ${LABELS[key]} must be text.`);
      continue;
    }
    const text = value.trim();
    if (text.length > LIMITS[key]) {
      errors.push(
        `The brief's ${LABELS[key]} is ${text.length} characters; at most ${LIMITS[key]}.`
      );
      continue;
    }
    fields[key] = text;
  }
  return { fields, errors };
}

/** A new world's brief from the fields given: the ones with text, or null. */
function briefFrom(fields) {
  const brief = {};
  for (const key of FIELDS) if (fields && fields[key]) brief[key] = fields[key];
  return Object.keys(brief).length ? brief : null;
}

/**
 * What changing a world's brief by `fields` writes, as dotted field paths:
 * `{ 'brief.tone': 'grim' }`, with `clear` marking those to delete ("" given
 * for a field it has). Fields already as given are left out.
 */
function briefChanges(brief, fields, clear) {
  const had = brief || {};
  const changes = {};
  for (const key of FIELDS) {
    if (fields[key] === undefined) continue;
    if (fields[key] === '') {
      if (had[key]) changes[`brief.${key}`] = clear;
    } else if (fields[key] !== had[key]) {
      changes[`brief.${key}`] = fields[key];
    }
  }
  return changes;
}

/** A world's brief as stored, for display: the fields with text. */
function briefOf(world) {
  return briefFrom((world && world.brief) || null);
}

/** The BRIEF line the GM is told every turn, or '' for a world without one. */
function briefLine(world) {
  const brief = briefOf(world);
  if (!brief) return '';
  const parts = FIELDS.filter((key) => brief[key]).map(
    (key) => `${LABELS[key]}: ${brief[key].replace(/\s+/g, ' ')}`
  );
  return `BRIEF: ${parts.join('. ')}.`.replace(/\.\.$/, '.');
}

/** The art direction the studio uses as a style, or '' when there is none. */
function artStyleOf(world) {
  const brief = briefOf(world);
  return (brief && brief.artDirection) || '';
}

module.exports = {
  FIELDS,
  LIMITS,
  LABELS,
  checkBrief,
  briefFrom,
  briefChanges,
  briefOf,
  briefLine,
  artStyleOf,
};
