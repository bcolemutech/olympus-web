'use strict';

/**
 * Named stat blocks (planning/builders-tools.md §4.3, BT4; L-393 / #739): a
 * world's own ("gate guard", "innkeeper"), kept at
 * `loom_worlds/{worldId}/statBlocks/{id}` as `{ id, name, statBlock }`, the
 * stat block in L-813's short form (./sheets.js), checked against the
 * world's system. They're content, like characters; the system stays rules.
 *
 * A named character names one with `statBlock: id`, and a group of figures
 * with `statBlock: 'id'` in place of the block itself; either may add
 * `overrides`, a partial stat block for what differs (an attribute, a skill,
 * its attacks). The sheet they stand for is worked out when the world loads
 * (`resolve`), so a change to the block reaches everyone who names it, and
 * their overrides stay. A save keeps its own copy of a figure's sheet once
 * fought (L-822), as before.
 *
 * Pure.
 */

const sheets = require('./sheets');

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_NAME = 60;
const OVERRIDABLE = ['attributes', 'skills', 'resources', 'level', 'traits', 'attacks'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * A block with overrides on it: attributes, skills and resources merged by
 * id; level, traits and attacks replaced.
 */
function merge(block, overrides) {
  if (!isObject(overrides)) return block;
  const out = { ...block };
  for (const key of ['attributes', 'skills', 'resources']) {
    if (isObject(overrides[key])) out[key] = { ...(block[key] || {}), ...overrides[key] };
  }
  for (const key of ['level', 'traits', 'attacks']) {
    if (overrides[key] !== undefined) out[key] = overrides[key];
  }
  return out;
}

/** What's wrong with overrides, each named (their values are checked with the sheet). */
function validateOverrides(overrides, where = 'overrides') {
  if (overrides === undefined || overrides === null) return [];
  if (!isObject(overrides)) return [`${where} must be a partial stat block.`];
  return Object.keys(overrides)
    .filter((k) => !OVERRIDABLE.includes(k))
    .map((k) => `${where}: "${k}" can't be overridden (${OVERRIDABLE.join(', ')}).`);
}

/** The stat block a character or group names, as an object: theirs, or the world's named one with overrides; null when it names one that doesn't exist. */
function blockOf(world, holder) {
  const named = holder && holder.statBlock;
  if (typeof named !== 'string') return isObject(named) ? merge(named, holder.overrides) : null;
  const entry = ((world && world.statBlocks) || {})[named];
  return entry && isObject(entry.statBlock) ? merge(entry.statBlock, holder.overrides) : null;
}

/**
 * The world with every named character that names a stat block given the
 * sheet it stands for, for this system. The world as it was when nobody
 * names one.
 */
function resolve(world, system) {
  const chars = (world && world.characters) || {};
  const naming = Object.values(chars).filter((c) => typeof c.statBlock === 'string');
  if (!naming.length || !system) return world;
  const characters = { ...chars };
  for (const c of naming) {
    const block = blockOf(world, c);
    if (block)
      characters[c.id] = Object.freeze({ ...c, sheet: sheets.sheetFromStatBlock(system, block) });
  }
  return Object.freeze({ ...world, characters: Object.freeze(characters) });
}

/** What's wrong with a named stat block for this system, each named. */
function validateEntry(system, entry) {
  const errors = [];
  if (!isObject(entry)) return ['A stat block must be { id, name, statBlock }.'];
  if (typeof entry.id !== 'string' || !ID.test(entry.id)) {
    errors.push('id must be lowercase letters, digits and dashes ("gate-guard").');
  }
  if (typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > MAX_NAME) {
    errors.push(`name is required (at most ${MAX_NAME} characters).`);
  }
  errors.push(...sheets.validateStatBlock(system, entry.statBlock));
  return errors;
}

/** Who names a stat block: characters' ids and figure groups (`mapId/groupId`). */
function usersOf(world, id) {
  const characters = Object.values((world && world.characters) || {})
    .filter((c) => !c.retired && c.statBlock === id)
    .map((c) => ({ id: c.id, name: c.name }));
  const groups = [];
  for (const map of Object.values((world && world.battleMaps) || {})) {
    for (const g of map.figures || []) {
      if (g.statBlock === id) groups.push({ mapId: map.id, id: g.id, name: g.name });
    }
  }
  return { characters, groups };
}

module.exports = {
  ID,
  OVERRIDABLE,
  merge,
  validateOverrides,
  blockOf,
  resolve,
  validateEntry,
  usersOf,
};
