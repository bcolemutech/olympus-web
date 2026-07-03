'use strict';

/**
 * The Loom — §8 data model constructors, validators, and mutation application.
 *
 * Mirrors planning/the-loom-design.md §8. These are pure, framework-free
 * functions (no firebase-admin import) so they can be unit-tested without an
 * emulator; callers pass in timestamps (e.g. FieldValue.serverTimestamp())
 * rather than this module generating them.
 */

// ── Mutation vocabulary (design doc §8, §11 L-401) ─────────────────────────
// state_mutations are deltas, never whole-document overwrites, so retried
// transactional writes (batch tick, concurrent turns) merge cleanly.

const MUTATION_OPS = ['add', 'remove', 'increment', 'set-flag'];

function getAtPath(obj, path) {
  return path.split('.').reduce(function (acc, key) {
    return acc == null ? undefined : acc[key];
  }, obj);
}

function setAtPath(obj, path, value) {
  const keys = path.split('.');
  let target = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (target[key] == null || typeof target[key] !== 'object') {
      target[key] = {};
    }
    target = target[key];
  }
  target[keys[keys.length - 1]] = value;
}

/**
 * Applies a single delta mutation to a state object in place.
 *   { op: 'add',       path, value }  — push value onto the array at path (no-op if already present)
 *   { op: 'remove',    path, value }  — remove the first matching value from the array at path
 *   { op: 'increment', path, value }  — add value (a number) to the number at path (default 0)
 *   { op: 'set-flag',  path, value }  — set path to value verbatim
 */
function applyMutation(state, mutation) {
  if (!mutation || MUTATION_OPS.indexOf(mutation.op) === -1) {
    throw new Error('applyMutation: unknown op ' + (mutation && mutation.op));
  }
  if (typeof mutation.path !== 'string' || mutation.path.length === 0) {
    throw new Error('applyMutation: path is required');
  }

  switch (mutation.op) {
    case 'add': {
      let arr = getAtPath(state, mutation.path);
      if (!Array.isArray(arr)) {
        arr = [];
        setAtPath(state, mutation.path, arr);
      }
      if (arr.indexOf(mutation.value) === -1) {
        arr.push(mutation.value);
      }
      break;
    }
    case 'remove': {
      const arr = getAtPath(state, mutation.path);
      if (Array.isArray(arr)) {
        const idx = arr.indexOf(mutation.value);
        if (idx !== -1) arr.splice(idx, 1);
      }
      break;
    }
    case 'increment': {
      const current = getAtPath(state, mutation.path);
      setAtPath(state, mutation.path, (typeof current === 'number' ? current : 0) + mutation.value);
      break;
    }
    case 'set-flag': {
      setAtPath(state, mutation.path, mutation.value);
      break;
    }
  }

  return state;
}

/** Applies an ordered list of mutations to a state object in place. Returns the same object. */
function applyStateMutations(state, mutations) {
  (mutations || []).forEach(function (mutation) {
    applyMutation(state, mutation);
  });
  return state;
}

// ── Validators ──────────────────────────────────────────────────────────────
// Return { valid: boolean, errors: string[] }. Constructors call these and
// throw on invalid input so a malformed document can never be written.

function validateWorldState(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['not an object'] };

  if (typeof data.worldId !== 'string' || data.worldId.length === 0) {
    errors.push('worldId must be a non-empty string');
  }
  if (
    typeof data.locations !== 'object' ||
    data.locations === null ||
    Array.isArray(data.locations)
  ) {
    errors.push('locations must be an object');
  }
  if (typeof data.factions !== 'object' || data.factions === null || Array.isArray(data.factions)) {
    errors.push('factions must be an object');
  }
  if (
    typeof data.globalFlags !== 'object' ||
    data.globalFlags === null ||
    Array.isArray(data.globalFlags)
  ) {
    errors.push('globalFlags must be an object');
  }
  if (typeof data.worldClock !== 'number') {
    errors.push('worldClock must be a number');
  }

  return { valid: errors.length === 0, errors: errors };
}

function validateCharacter(character) {
  const errors = [];
  if (!character || typeof character !== 'object')
    return { valid: false, errors: ['not an object'] };

  if (typeof character.name !== 'string' || character.name.length === 0) {
    errors.push('character.name must be a non-empty string');
  }
  if (typeof character.condition !== 'string' || character.condition.length === 0) {
    errors.push('character.condition must be a non-empty string');
  }
  if (!Array.isArray(character.inventory)) {
    errors.push('character.inventory must be an array');
  }
  if (!Array.isArray(character.abilities)) {
    errors.push('character.abilities must be an array');
  }
  if (!Array.isArray(character.goals)) {
    errors.push('character.goals must be an array');
  }

  return { valid: errors.length === 0, errors: errors };
}

function validateSave(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['not an object'] };

  if (typeof data.ownerUid !== 'string' || data.ownerUid.length === 0) {
    errors.push('ownerUid must be a non-empty string');
  }
  if (typeof data.worldId !== 'string' || data.worldId.length === 0) {
    errors.push('worldId must be a non-empty string');
  }
  if (typeof data.name !== 'string' || data.name.length === 0) {
    errors.push('name must be a non-empty string');
  }
  const characterResult = validateCharacter(data.character);
  if (!characterResult.valid) {
    errors.push.apply(errors, characterResult.errors);
  }
  if (
    typeof data.privateFlags !== 'object' ||
    data.privateFlags === null ||
    Array.isArray(data.privateFlags)
  ) {
    errors.push('privateFlags must be an object');
  }
  if (
    typeof data.relationships !== 'object' ||
    data.relationships === null ||
    Array.isArray(data.relationships)
  ) {
    errors.push('relationships must be an object');
  }
  if (typeof data.recentSummary !== 'string') {
    errors.push('recentSummary must be a string');
  }

  return { valid: errors.length === 0, errors: errors };
}

function validateTurn(data) {
  const errors = [];
  if (!data || typeof data !== 'object') return { valid: false, errors: ['not an object'] };

  if (typeof data.index !== 'number' || data.index < 0) {
    errors.push('index must be a non-negative number');
  }
  if (typeof data.actionText !== 'string' || data.actionText.length === 0) {
    errors.push('actionText must be a non-empty string');
  }
  if (!data.proposedAction || typeof data.proposedAction !== 'object') {
    errors.push('proposedAction must be an object');
  } else {
    if (typeof data.proposedAction.verb !== 'string')
      errors.push('proposedAction.verb must be a string');
    if (!Array.isArray(data.proposedAction.targets))
      errors.push('proposedAction.targets must be an array');
    if (typeof data.proposedAction.params !== 'object' || data.proposedAction.params === null) {
      errors.push('proposedAction.params must be an object');
    }
  }
  if (!data.resolution || typeof data.resolution !== 'object') {
    errors.push('resolution must be an object');
  } else {
    if (typeof data.resolution.outcome !== 'string')
      errors.push('resolution.outcome must be a string');
    if (!Array.isArray(data.resolution.mutations))
      errors.push('resolution.mutations must be an array');
    if (!Array.isArray(data.resolution.constraints)) {
      errors.push('resolution.constraints must be an array');
    }
  }
  if (typeof data.narration !== 'string') {
    errors.push('narration must be a string');
  }
  if (!Array.isArray(data.entityRefs)) {
    errors.push('entityRefs must be an array');
  }

  return { valid: errors.length === 0, errors: errors };
}

// ── Constructors ──────────────────────────────────────────────────────────
// Build a valid document shape from caller-supplied fields, applying §8
// defaults for anything omitted. Throw on invalid input so a malformed
// document can never reach a write.

function makeWorldState(fields) {
  fields = fields || {};
  const worldState = {
    worldId: fields.worldId,
    updatedAt: fields.updatedAt,
    locations: fields.locations || {},
    factions: fields.factions || {},
    globalFlags: fields.globalFlags || {},
    worldClock: typeof fields.worldClock === 'number' ? fields.worldClock : 0,
  };

  const result = validateWorldState(worldState);
  if (!result.valid) {
    throw new Error('makeWorldState: invalid world state — ' + result.errors.join('; '));
  }
  return worldState;
}

function makeCharacter(fields) {
  fields = fields || {};
  return {
    name: fields.name,
    condition: fields.condition || 'healthy',
    inventory: fields.inventory || [],
    abilities: fields.abilities || [],
    goals: fields.goals || [],
  };
}

function makeSave(fields) {
  fields = fields || {};
  const save = {
    ownerUid: fields.ownerUid,
    worldId: fields.worldId,
    name: fields.name,
    character: makeCharacter(fields.character),
    location: fields.location || null,
    privateFlags: fields.privateFlags || {},
    relationships: fields.relationships || {},
    recentSummary: fields.recentSummary || '',
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };

  const result = validateSave(save);
  if (!result.valid) {
    throw new Error('makeSave: invalid save — ' + result.errors.join('; '));
  }
  return save;
}

function makeTurn(fields) {
  fields = fields || {};
  const turn = {
    index: fields.index,
    actionText: fields.actionText,
    proposedAction: fields.proposedAction || { verb: '', targets: [], params: {} },
    resolution: fields.resolution || { outcome: '', mutations: [], constraints: [] },
    narration: fields.narration || '',
    entityRefs: fields.entityRefs || [],
    createdAt: fields.createdAt,
  };

  const result = validateTurn(turn);
  if (!result.valid) {
    throw new Error('makeTurn: invalid turn — ' + result.errors.join('; '));
  }
  return turn;
}

module.exports = {
  MUTATION_OPS,
  applyMutation,
  applyStateMutations,
  validateWorldState,
  validateCharacter,
  validateSave,
  validateTurn,
  makeWorldState,
  makeCharacter,
  makeSave,
  makeTurn,
};
