'use strict';

/**
 * Unit tests for functions/loom-turn/adjudicate.js (L-112).
 *
 * evaluate() is a pure function (dice is an already-rolled value), so these
 * tests are fully deterministic without mocking randomness. No Firestore
 * emulator required.
 *
 * Run: cd tests && npx jest loom-adjudicate --verbose
 */

const {
  evaluate,
  adjudicateAction,
  rollDie,
  DEFAULT_DIFFICULTY_CLASS,
} = require('../functions/loom-turn/adjudicate');
const { getWorld } = require('../functions/loom-canon');

const CANON_WORLD = getWorld('shattered-coast');

function makeProposedAction(overrides) {
  return Object.assign({ verb: 'look', targets: [], params: {} }, overrides);
}

function makeCharacterState(overrides) {
  return Object.assign({ location: 'widows-reach', abilities: [] }, overrides);
}

describe('rollDie', () => {
  it('always returns an integer between 1 and 20 inclusive', () => {
    for (let i = 0; i < 200; i++) {
      const value = rollDie();
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(20);
    }
  });
});

describe('evaluate — move verb', () => {
  it('rejects a move with no established current location', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['skeleton-cove'] }),
      {},
      makeCharacterState({ location: null }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('blocked');
  });

  it('rejects a move to an unknown location', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['nonexistent-place'] }),
      {},
      makeCharacterState(),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('invalid_target');
    expect(resolution.mutations).toHaveLength(0);
  });

  it('treats moving to the current location as a no-op', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['widows-reach'] }),
      {},
      makeCharacterState({ location: 'widows-reach' }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('no_op');
  });

  it('rejects a move to a location with no direct connection', () => {
    // widows-reach connects to skeleton-cove and the-drowned-shoals, not fort-augustine directly
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['fort-augustine'] }),
      {},
      makeCharacterState({ location: 'widows-reach' }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('blocked');
    expect(resolution.mutations).toHaveLength(0);
  });

  it('rejects a move requiring an ability the character lacks', () => {
    // the-drowned-shoals requires the 'seaworthy-vessel' ability
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['the-drowned-shoals'] }),
      {},
      makeCharacterState({ location: 'widows-reach', abilities: [] }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('blocked');
    expect(resolution.constraints[0]).toMatch(/seaworthy-vessel/);
    expect(resolution.mutations).toHaveLength(0);
  });

  it('allows a legal move with the required ability and produces the expected mutations', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['the-drowned-shoals'] }),
      {},
      makeCharacterState({ location: 'widows-reach', abilities: ['seaworthy-vessel'] }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('success');
    expect(resolution.mutations).toEqual([
      { target: 'save', op: 'set-flag', path: 'location', value: 'the-drowned-shoals' },
      { op: 'increment', path: 'worldClock', value: 1 },
    ]);
  });

  it('allows a legal move to a location with no ability requirement', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'move', targets: ['skeleton-cove'] }),
      {},
      makeCharacterState({ location: 'widows-reach', abilities: [] }),
      10,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('success');
  });
});

describe('evaluate — generic (dice) verbs', () => {
  it('succeeds when the roll meets the difficulty class', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'search' }),
      {},
      makeCharacterState(),
      DEFAULT_DIFFICULTY_CLASS,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('success');
    expect(resolution.mutations).toHaveLength(0);
  });

  it('fails when the roll is below the difficulty class', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'search' }),
      {},
      makeCharacterState(),
      DEFAULT_DIFFICULTY_CLASS - 1,
      CANON_WORLD
    );
    expect(resolution.outcome).toBe('failure');
    expect(resolution.mutations).toHaveLength(0);
  });

  it('never mutates state for a generic action, win or lose', () => {
    [1, 20].forEach((dice) => {
      const resolution = evaluate(
        makeProposedAction({ verb: 'attack', targets: ['commandant-de-alva'] }),
        {},
        makeCharacterState(),
        dice,
        CANON_WORLD
      );
      expect(resolution.mutations).toEqual([]);
    });
  });
});

describe('evaluate — resolution immutability', () => {
  it('freezes the returned resolution and its arrays', () => {
    const resolution = evaluate(
      makeProposedAction({ verb: 'look' }),
      {},
      makeCharacterState(),
      10,
      CANON_WORLD
    );
    expect(Object.isFrozen(resolution)).toBe(true);
    expect(Object.isFrozen(resolution.mutations)).toBe(true);
    expect(Object.isFrozen(resolution.constraints)).toBe(true);

    expect(() => {
      'use strict';
      resolution.outcome = 'hacked';
    }).toThrow();
    expect(resolution.outcome).toBe('success');
  });
});

describe('adjudicateAction', () => {
  it('uses the injected roll function instead of the real RNG', async () => {
    const resolution = await adjudicateAction(
      {
        proposedAction: makeProposedAction({ verb: 'search' }),
        canonWorld: CANON_WORLD,
        save: makeCharacterState(),
        worldState: {},
      },
      () => DEFAULT_DIFFICULTY_CLASS
    );
    expect(resolution.outcome).toBe('success');
  });

  it('defaults to the real server die when no roll function is provided', async () => {
    const resolution = await adjudicateAction({
      proposedAction: makeProposedAction({ verb: 'search' }),
      canonWorld: CANON_WORLD,
      save: makeCharacterState(),
      worldState: {},
    });
    expect(['success', 'failure']).toContain(resolution.outcome);
  });

  it('routes a move proposedAction through evaluateMove via the same wrapper', async () => {
    const resolution = await adjudicateAction({
      proposedAction: makeProposedAction({ verb: 'move', targets: ['skeleton-cove'] }),
      canonWorld: CANON_WORLD,
      save: makeCharacterState({ location: 'widows-reach' }),
      worldState: {},
    });
    expect(resolution.outcome).toBe('success');
  });
});
