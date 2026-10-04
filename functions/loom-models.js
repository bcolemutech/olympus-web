'use strict';

/**
 * The Loom — §8 data model constructors, validators, and mutation application.
 *
 * Mirrors planning/the-loom-design.md §8. These are pure, framework-free
 * functions (no firebase-admin import) so they can be unit-tested without an
 * emulator; callers pass in timestamps (e.g. FieldValue.serverTimestamp())
 * rather than this module generating them.
 */

// ── Mutation vocabulary (design doc §8, §10 L-401) ─────────────────────────
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

// ── The turn (planning/the-loom-movement-and-vision.md §3; L-611 / #441) ──
//
// A character has a speed: movement points a turn (1 square on a battle map;
// 20 m in town, later). A save has its turn: which turn it is, the movement
// left, whether the turn's one action is used, and the plan (the rest of a
// path, kept for the next turn). End turn refills movement and the action.
// Older saves and characters have none: they read as a fresh turn and the
// default speed. (A save's turn is not a turn record: see makeTurn.)

const DEFAULT_SPEED = 20;
const MAX_SPEED = 1000;

/** A save's character's speed, or the default for older characters. */
function speedOf(save) {
  const speed = save && save.character && save.character.speed;
  return Number.isInteger(speed) && speed > 0 && speed <= MAX_SPEED ? speed : DEFAULT_SPEED;
}

/** What's wrong with a save's turn, given its character's speed. */
function validateTurnState(turn, speed) {
  const errors = [];
  if (!turn || typeof turn !== 'object' || Array.isArray(turn)) return ['turn must be an object'];
  if (!Number.isInteger(turn.n) || turn.n < 1) errors.push('turn.n must be a whole number from 1');
  if (!Number.isInteger(turn.movementLeft) || turn.movementLeft < 0 || turn.movementLeft > speed) {
    errors.push('turn.movementLeft must be a whole number from 0 to the speed (' + speed + ')');
  }
  if (typeof turn.actionUsed !== 'boolean') errors.push('turn.actionUsed must be true or false');
  if (turn.plan !== null && (typeof turn.plan !== 'object' || Array.isArray(turn.plan))) {
    errors.push('turn.plan must be an object or null');
  }
  return errors;
}

/** A new turn `n`: full movement, the action unused, no plan. */
function freshTurnState(save, n = 1) {
  return { n, movementLeft: speedOf(save), actionUsed: false, plan: null };
}

/** A save's turn, or a fresh one for an older save (or one that doesn't check out). */
function turnStateOf(save) {
  const turn = save && save.turn;
  return turn && !validateTurnState(turn, speedOf(save)).length ? turn : freshTurnState(save);
}

/** The turn after this one: movement and the action refilled, the plan kept. */
function nextTurnState(save) {
  const now = turnStateOf(save);
  return { n: now.n + 1, movementLeft: speedOf(save), actionUsed: false, plan: now.plan };
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
  // Movement a turn (L-611); older characters have none and move at the default.
  if (
    character.speed !== undefined &&
    !(Number.isInteger(character.speed) && character.speed > 0 && character.speed <= MAX_SPEED)
  ) {
    errors.push('character.speed must be a whole number from 1 to ' + MAX_SPEED);
  }

  return { valid: errors.length === 0, errors: errors };
}

const DOOR_STATES = ['open', 'closed', 'locked'];
const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function validDoors(doors) {
  return (
    isPlainObject(doors) &&
    Object.values(doors).every(
      (byDoor) =>
        isPlainObject(byDoor) && Object.values(byDoor).every((s) => DOOR_STATES.includes(s))
    )
  );
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
  if (data.placeId !== undefined && data.placeId !== null && typeof data.placeId !== 'string') {
    errors.push('placeId must be a place id or null');
  }
  // Where on a battle map (L-351), if on one.
  if (data.mapId !== undefined && data.mapId !== null && typeof data.mapId !== 'string') {
    errors.push('mapId must be a battle map id or null');
  }
  if (
    data.cell !== undefined &&
    data.cell !== null &&
    !(
      typeof data.cell === 'object' &&
      Number.isInteger(data.cell.x) &&
      Number.isInteger(data.cell.y) &&
      data.cell.x >= 0 &&
      data.cell.y >= 0
    )
  ) {
    errors.push('cell must be { x, y } (whole numbers, 0 or more) or null');
  }
  // Places the save has discovered (world map, L-331); older saves have none.
  if (
    data.discovered !== undefined &&
    (!Array.isArray(data.discovered) ||
      data.discovered.some(function (id) {
        return typeof id !== 'string';
      }))
  ) {
    errors.push('discovered must be an array of location ids');
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
  // The save's doors on battle maps (L-624): { [mapId]: { [doorId]: state } }.
  if (data.doors !== undefined && !validDoors(data.doors)) {
    errors.push("doors must be { mapId: { doorId: 'open' | 'closed' | 'locked' } }");
  }
  // The save's turn (L-611); older saves have none and start a fresh one.
  if (data.turn !== undefined) {
    errors.push.apply(errors, validateTurnState(data.turn, speedOf(data)));
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
    speed: fields.speed === undefined ? DEFAULT_SPEED : fields.speed,
  };
}

function makeSave(fields) {
  fields = fields || {};
  const character = makeCharacter(fields.character);
  const save = {
    ownerUid: fields.ownerUid,
    worldId: fields.worldId,
    name: fields.name,
    character,
    location: fields.location || null,
    placeId: fields.placeId || null, // where in town (L-342), or null
    mapId: fields.mapId || null, // the battle map it is on (L-351), or null
    cell: fields.cell || null, // where on that map: { x, y }, or null
    discovered: fields.discovered || [],
    privateFlags: fields.privateFlags || {},
    relationships: fields.relationships || {},
    recentSummary: fields.recentSummary || '',
    turn: fields.turn || freshTurnState({ character }),
    // Doors this save has opened, closed or unlocked on battle maps (L-624).
    ...(fields.doors !== undefined ? { doors: fields.doors } : {}),
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
  DEFAULT_SPEED,
  speedOf,
  validateTurnState,
  freshTurnState,
  turnStateOf,
  nextTurnState,
};
