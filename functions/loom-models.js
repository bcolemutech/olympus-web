'use strict';

/**
 * The Loom — §8 data model constructors, validators, and mutation application.
 *
 * Mirrors planning/the-loom-design.md §8. These are pure, framework-free
 * functions (no firebase-admin import) so they can be unit-tested without an
 * emulator; callers pass in timestamps (e.g. FieldValue.serverTimestamp())
 * rather than this module generating them.
 */

const clock = require('./loom-canon/clock');
const { DEFAULT_AP, MAX_AP, sheetOf } = require('./loom-canon/sheets');

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
// A character has a pool of action points (planning/action-points.md; L-830):
// what a turn pays for moving (a square 1 AP on a battle map; 20 m a point
// in town) and, on a grid, every action. A save has its turn (L-832; §4.3):
//
//   { n, ap, kept, plan, reserved?, moved?, long?, withdrawn? }
//     n          which turn it is
//     ap         AP left this turn
//     kept       AP kept from the last turn, for off-turn reactions (L-833;
//                in a fight it is the player's entry's `kept`, set at End
//                turn and gone when their next turn starts)
//     reserved   AP set aside for a readied attack (L-833; KP3), lost at
//                the next turn if it never fires
//     plan       the rest of a path, kept for the next turn
//     moved      squares walked this turn, for End turn's line
//     long       a long action under way (CT4): { key, name, put, need }
//     withdrawn  moving out of reach draws no attacks this turn (L-823)
//     acted      with AP off (L-838; `ap: false`): the turn's action is
//                used; `actionsUsed` counts them when a fight's turn rule
//                gives more than one. `ap` is then only the town walk's
//                points (20 m each); grid steps and actions cost no AP
//
// End turn refills the pool and keeps the plan and any long action. Older
// saves have none, or the turn from before AP ({ movementLeft, actionUsed }):
// they read as a fresh turn, or as that one on AP, the movement left as AP.
// (A save's turn is not a turn record: see makeTurn.)

/**
 * A save's character's pool of action points: its sheet's (L-832; `speed`
 * on a sheet from before AP, L-811), an older character's own speed, or
 * the default.
 */
function apOf(save) {
  const sheet = sheetOf(save);
  const own = save && save.character && save.character.speed;
  const pool = sheet ? (sheet.ap !== undefined ? sheet.ap : sheet.speed) : own;
  return Number.isInteger(pool) && pool >= 0 && pool <= MAX_AP ? pool : DEFAULT_AP;
}

const whole = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/** What's wrong with a save's turn. */
function validateTurnState(turn) {
  const errors = [];
  if (!isObject(turn)) return ['turn must be an object'];
  if (!Number.isInteger(turn.n) || turn.n < 1) errors.push('turn.n must be a whole number from 1');
  if (!whole(turn.ap, MAX_AP)) errors.push('turn.ap must be a whole number from 0 to ' + MAX_AP);
  if (!whole(turn.kept, MAX_AP)) {
    errors.push('turn.kept must be a whole number from 0 to ' + MAX_AP);
  }
  if (turn.plan !== null && !isObject(turn.plan)) {
    errors.push('turn.plan must be an object or null');
  }
  if (turn.acted !== undefined && typeof turn.acted !== 'boolean') {
    errors.push('turn.acted must be true or false');
  }
  if (turn.actionsUsed !== undefined && !whole(turn.actionsUsed, 5)) {
    errors.push('turn.actionsUsed must be a whole number from 0 to 5');
  }
  if (turn.reserved !== undefined && !whole(turn.reserved, MAX_AP)) {
    errors.push('turn.reserved must be a whole number from 0 to ' + MAX_AP);
  }
  if (turn.moved !== undefined && !whole(turn.moved, 100000)) {
    errors.push('turn.moved must be a whole number of squares');
  }
  if (
    turn.long !== undefined &&
    turn.long !== null &&
    !(
      isObject(turn.long) &&
      typeof turn.long.key === 'string' &&
      whole(turn.long.put, 100000) &&
      Number.isInteger(turn.long.need) &&
      turn.long.need > 0
    )
  ) {
    errors.push('turn.long must be { key, name, put, need } or null');
  }
  return errors;
}

/** A new turn `n`: a full pool, nothing kept, no plan. */
function freshTurnState(save, n = 1) {
  return { n, ap: apOf(save), kept: 0, plan: null };
}

// A turn from before AP (L-611): its movement left becomes its AP (MG1).
function fromMovement(turn) {
  if (!isObject(turn) || turn.ap !== undefined) return null;
  if (!Number.isInteger(turn.n) || turn.n < 1) return null;
  if (!whole(turn.movementLeft, MAX_AP)) return null;
  const plan = isObject(turn.plan) ? turn.plan : null;
  return { n: turn.n, ap: turn.movementLeft, kept: 0, plan };
}

/**
 * A save's turn: its own, one from before AP converted, or a fresh one for
 * an older save (or one that doesn't check out).
 */
function turnStateOf(save) {
  const turn = save && save.turn;
  if (turn && !validateTurnState(turn).length) return turn;
  return fromMovement(turn) || freshTurnState(save);
}

/** The turn after this one: the pool refilled, the plan and any long action kept. */
function nextTurnState(save) {
  const now = turnStateOf(save);
  return {
    n: now.n + 1,
    ap: apOf(save),
    kept: 0,
    plan: now.plan,
    ...(now.long ? { long: now.long } : {}),
  };
}

function validateCharacter(character) {
  const errors = [];
  if (!character || typeof character !== 'object')
    return { valid: false, errors: ['not an object'] };

  if (typeof character.name !== 'string' || character.name.length === 0) {
    errors.push('character.name must be a non-empty string');
  }
  // A sheet (L-811) holds the condition, traits and speed; it is checked
  // against the world's system (./loom-canon/sheets.js), not here. A
  // character made before sheets has them itself.
  const sheet = character.sheet !== undefined;
  if (sheet && (!character.sheet || typeof character.sheet !== 'object')) {
    errors.push('character.sheet must be an object');
  }
  if (!sheet && (typeof character.condition !== 'string' || character.condition.length === 0)) {
    errors.push('character.condition must be a non-empty string');
  }
  if (!Array.isArray(character.inventory)) {
    errors.push('character.inventory must be an array');
  }
  if (!sheet && !Array.isArray(character.abilities)) {
    errors.push('character.abilities must be an array');
  }
  if (!Array.isArray(character.goals)) {
    errors.push('character.goals must be an array');
  }
  // Movement a turn (L-611), its pool of AP (L-832); older characters have
  // none and move at the default.
  if (
    character.speed !== undefined &&
    !(Number.isInteger(character.speed) && character.speed > 0 && character.speed <= MAX_AP)
  ) {
    errors.push('character.speed must be a whole number from 1 to ' + MAX_AP);
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
  // On the street in a town with ground (L-662).
  if (
    data.townPoint !== undefined &&
    data.townPoint !== null &&
    !(
      typeof data.townPoint === 'object' &&
      [data.townPoint.x, data.townPoint.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1000)
    )
  ) {
    errors.push('townPoint must be { x, y } (0 to 1000 each way) or null');
  }
  // Places the save has discovered (world map, L-331); older saves have none.
  // Kept by map in the levels model (L-901): { [mapId]: [placeId] }.
  const idList = function (v) {
    return (
      Array.isArray(v) &&
      v.every(function (id) {
        return typeof id === 'string';
      })
    );
  };
  if (
    data.discovered !== undefined &&
    !idList(data.discovered) &&
    !(
      data.discovered !== null &&
      typeof data.discovered === 'object' &&
      Object.values(data.discovered).every(idList)
    )
  ) {
    errors.push('discovered must be an array of location ids, or place ids by map');
  }
  // Where it stands in the levels model (L-901; ../loom-canon/levels.js): a
  // path of steps from the top map down, each checked against canon there.
  if (
    data.at !== undefined &&
    data.at !== null &&
    !(
      Array.isArray(data.at) &&
      data.at.length > 0 &&
      data.at.every(function (step) {
        return step !== null && typeof step === 'object' && typeof step.mapId === 'string';
      })
    )
  ) {
    errors.push('at must be a path of { mapId, placeId | point | cell } steps, or null');
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
    errors.push.apply(errors, validateTurnState(data.turn));
  }
  // The save's clock (L-371): seconds since the game began; older saves have
  // none and read as Day 1, 08:00 until their next turn.
  if (data.time !== undefined && !clock.isTime(data.time)) {
    errors.push('time must be whole seconds, 0 or more');
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
  // With a sheet (L-811): its condition, traits and pool of AP are in it.
  if (fields.sheet) {
    return {
      name: fields.name,
      inventory: fields.inventory || [],
      goals: fields.goals || [],
      sheet: fields.sheet,
    };
  }
  return {
    name: fields.name,
    condition: fields.condition || 'healthy',
    inventory: fields.inventory || [],
    abilities: fields.abilities || [],
    goals: fields.goals || [],
    speed: fields.speed === undefined ? DEFAULT_AP : fields.speed,
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
    // On the street in a town with ground (L-662): a point in its 0–1000
    // square, with no place (placeId null) and no map.
    ...(fields.townPoint ? { townPoint: fields.townPoint } : {}),
    discovered: fields.discovered || [],
    // Where it stands in the levels model (L-901), once worlds move onto it.
    ...(fields.at ? { at: fields.at } : {}),
    // The settlements arrived in, and the ways in and out known in each
    // (L-381; journeys and arrivals §4.1, §4.2). A save without them is from
    // before L-381: its next turn derives them (../loom-turn/visits.js).
    ...(fields.visited ? { visited: fields.visited } : {}),
    ...(fields.waysKnown ? { waysKnown: fields.waysKnown } : {}),
    privateFlags: fields.privateFlags || {},
    relationships: fields.relationships || {},
    recentSummary: fields.recentSummary || '',
    turn: fields.turn || freshTurnState({ character }),
    time: fields.time === undefined ? clock.START : fields.time, // Day 1, 08:00 (L-371)
    // Doors this save has opened, closed or unlocked on battle maps (L-624).
    ...(fields.doors !== undefined ? { doors: fields.doors } : {}),
    // The foes and story moments it has been paid experience for (L-841,
    // L-842; advancement XP3): ids, each paid once. None yet reads as [].
    ...(fields.earned ? { earned: fields.earned } : {}),
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
  DEFAULT_AP,
  apOf,
  validateTurnState,
  freshTurnState,
  turnStateOf,
  nextTurnState,
};
