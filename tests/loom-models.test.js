'use strict';

/**
 * Unit tests for functions/loom-models.js (L-102).
 *
 * Pure-function constructors/validators/mutation-application — no
 * Firestore emulator required.
 *
 * Run: cd tests && npx jest loom-models --verbose
 */

const {
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
} = require('../functions/loom-models');

describe('applyMutation', () => {
  it('add: pushes a value onto an array at path', () => {
    const state = { locations: { tavern: { presentEntities: [] } } };
    applyMutation(state, { op: 'add', path: 'locations.tavern.presentEntities', value: 'npc-doral' });
    expect(state.locations.tavern.presentEntities).toEqual(['npc-doral']);
  });

  it('add: is idempotent for an already-present value', () => {
    const state = { locations: { tavern: { presentEntities: ['npc-doral'] } } };
    applyMutation(state, { op: 'add', path: 'locations.tavern.presentEntities', value: 'npc-doral' });
    expect(state.locations.tavern.presentEntities).toEqual(['npc-doral']);
  });

  it('add: creates missing intermediate objects and the array itself', () => {
    const state = {};
    applyMutation(state, { op: 'add', path: 'locations.tavern.presentEntities', value: 'npc-doral' });
    expect(state.locations.tavern.presentEntities).toEqual(['npc-doral']);
  });

  it('remove: removes a matching value from an array at path', () => {
    const state = { locations: { tavern: { presentEntities: ['npc-doral', 'npc-mara'] } } };
    applyMutation(state, { op: 'remove', path: 'locations.tavern.presentEntities', value: 'npc-doral' });
    expect(state.locations.tavern.presentEntities).toEqual(['npc-mara']);
  });

  it('remove: is a no-op when the value is not present', () => {
    const state = { locations: { tavern: { presentEntities: ['npc-mara'] } } };
    applyMutation(state, { op: 'remove', path: 'locations.tavern.presentEntities', value: 'npc-doral' });
    expect(state.locations.tavern.presentEntities).toEqual(['npc-mara']);
  });

  it('increment: adds to an existing number', () => {
    const state = { factions: { pirates: { standing: 5 } } };
    applyMutation(state, { op: 'increment', path: 'factions.pirates.standing', value: 3 });
    expect(state.factions.pirates.standing).toBe(8);
  });

  it('increment: defaults missing values to 0 before adding', () => {
    const state = { factions: { pirates: {} } };
    applyMutation(state, { op: 'increment', path: 'factions.pirates.standing', value: -2 });
    expect(state.factions.pirates.standing).toBe(-2);
  });

  it('set-flag: sets an arbitrary value at path, creating intermediates', () => {
    const state = {};
    applyMutation(state, { op: 'set-flag', path: 'globalFlags.metCaptain', value: true });
    expect(state.globalFlags.metCaptain).toBe(true);
  });

  it('throws on an unknown op', () => {
    expect(() => applyMutation({}, { op: 'overwrite', path: 'x', value: 1 })).toThrow(
      /unknown op/
    );
  });

  it('throws on a missing path', () => {
    expect(() => applyMutation({}, { op: 'set-flag', value: 1 })).toThrow(/path is required/);
  });
});

describe('applyStateMutations', () => {
  it('applies an ordered list of mutations in place and returns the same object', () => {
    const state = { worldClock: 0, globalFlags: {} };
    const result = applyStateMutations(state, [
      { op: 'increment', path: 'worldClock', value: 1 },
      { op: 'set-flag', path: 'globalFlags.stormPassed', value: true },
    ]);
    expect(result).toBe(state);
    expect(state.worldClock).toBe(1);
    expect(state.globalFlags.stormPassed).toBe(true);
  });

  it('treats a missing/empty mutation list as a no-op', () => {
    const state = { worldClock: 0 };
    applyStateMutations(state, undefined);
    expect(state.worldClock).toBe(0);
  });
});

describe('validateWorldState', () => {
  it('accepts a well-formed world state', () => {
    const result = validateWorldState({
      worldId: 'world-001',
      locations: {},
      factions: {},
      globalFlags: {},
      worldClock: 0,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects a missing worldId', () => {
    const result = validateWorldState({
      locations: {},
      factions: {},
      globalFlags: {},
      worldClock: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('worldId must be a non-empty string');
  });

  it('rejects worldClock as a non-number', () => {
    const result = validateWorldState({
      worldId: 'world-001',
      locations: {},
      factions: {},
      globalFlags: {},
      worldClock: '0',
    });
    expect(result.valid).toBe(false);
  });
});

describe('validateCharacter', () => {
  it('accepts a well-formed character', () => {
    const result = validateCharacter({
      name: 'Ishmael',
      condition: 'healthy',
      inventory: [],
      abilities: [],
      goals: [],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a character missing name', () => {
    const result = validateCharacter({
      condition: 'healthy',
      inventory: [],
      abilities: [],
      goals: [],
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('character.name must be a non-empty string');
  });
});

describe('validateSave', () => {
  const validSave = {
    ownerUid: 'uid-001',
    worldId: 'world-001',
    name: 'My Save',
    character: { name: 'Ishmael', condition: 'healthy', inventory: [], abilities: [], goals: [] },
    location: 'tavern',
    privateFlags: {},
    relationships: {},
    recentSummary: '',
  };

  it('accepts a well-formed save', () => {
    expect(validateSave(validSave).valid).toBe(true);
  });

  it('rejects a save missing ownerUid', () => {
    const data = Object.assign({}, validSave);
    delete data.ownerUid;
    const result = validateSave(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('ownerUid must be a non-empty string');
  });

  it('surfaces nested character validation errors', () => {
    const data = Object.assign({}, validSave, { character: {} });
    const result = validateSave(data);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('character.name must be a non-empty string');
  });
});

describe('validateTurn', () => {
  const validTurn = {
    index: 0,
    actionText: 'look around',
    proposedAction: { verb: 'look', targets: [], params: {} },
    resolution: { outcome: 'success', mutations: [], constraints: [] },
    narration: 'You see a dimly lit tavern.',
    entityRefs: [],
  };

  it('accepts a well-formed turn', () => {
    expect(validateTurn(validTurn).valid).toBe(true);
  });

  it('rejects a negative index', () => {
    const result = validateTurn(Object.assign({}, validTurn, { index: -1 }));
    expect(result.valid).toBe(false);
  });

  it('rejects a malformed proposedAction', () => {
    const result = validateTurn(Object.assign({}, validTurn, { proposedAction: { verb: 'look' } }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('proposedAction.targets must be an array');
  });

  it('rejects a malformed resolution', () => {
    const result = validateTurn(
      Object.assign({}, validTurn, { resolution: { outcome: 'success' } })
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('resolution.mutations must be an array');
  });
});

describe('makeWorldState', () => {
  it('fills in §8 defaults for omitted fields', () => {
    const worldState = makeWorldState({ worldId: 'world-001' });
    expect(worldState).toEqual({
      worldId: 'world-001',
      updatedAt: undefined,
      locations: {},
      factions: {},
      globalFlags: {},
      worldClock: 0,
    });
  });

  it('throws when worldId is missing', () => {
    expect(() => makeWorldState({})).toThrow(/invalid world state/);
  });
});

describe('makeCharacter', () => {
  it('fills in §8 defaults for omitted fields', () => {
    expect(makeCharacter({ name: 'Ishmael' })).toEqual({
      name: 'Ishmael',
      condition: 'healthy',
      inventory: [],
      abilities: [],
      goals: [],
    });
  });
});

describe('makeSave', () => {
  it('builds a valid save with default character/flags/relationships', () => {
    const save = makeSave({
      ownerUid: 'uid-001',
      worldId: 'world-001',
      name: 'My Save',
      character: { name: 'Ishmael' },
    });
    expect(save.ownerUid).toBe('uid-001');
    expect(save.character).toEqual({
      name: 'Ishmael',
      condition: 'healthy',
      inventory: [],
      abilities: [],
      goals: [],
    });
    expect(save.privateFlags).toEqual({});
    expect(save.relationships).toEqual({});
    expect(save.recentSummary).toBe('');
  });

  it('throws when the character is missing a name', () => {
    expect(() =>
      makeSave({ ownerUid: 'uid-001', worldId: 'world-001', name: 'My Save', character: {} })
    ).toThrow(/invalid save/);
  });

  it('throws when ownerUid is missing', () => {
    expect(() =>
      makeSave({ worldId: 'world-001', name: 'My Save', character: { name: 'Ishmael' } })
    ).toThrow(/invalid save/);
  });
});

describe('makeTurn', () => {
  it('builds a valid turn with default nested shapes', () => {
    const turn = makeTurn({ index: 0, actionText: 'look around' });
    expect(turn.proposedAction).toEqual({ verb: '', targets: [], params: {} });
    expect(turn.resolution).toEqual({ outcome: '', mutations: [], constraints: [] });
    expect(turn.entityRefs).toEqual([]);
  });

  it('throws when actionText is missing', () => {
    expect(() => makeTurn({ index: 0 })).toThrow(/invalid turn/);
  });

  it('throws when index is missing', () => {
    expect(() => makeTurn({ actionText: 'look around' })).toThrow(/invalid turn/);
  });
});
