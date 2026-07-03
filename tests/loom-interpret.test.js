'use strict';

/**
 * Unit tests for functions/loom-turn/interpret.js (L-111).
 *
 * Mocks functions/gemini.js's callGemini to test INTERPRET in isolation.
 * Does not require the Firestore emulator.
 *
 * Run: cd tests && npx jest loom-interpret --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const {
  interpretAction,
  resolveTarget,
  buildKnownEntities,
} = require('../functions/loom-turn/interpret');
const { getWorld } = require('../functions/loom-canon');

const CANON_WORLD = getWorld('shattered-coast');

const MINI_WORLD = {
  locations: {
    tavern: { id: 'tavern', name: 'The Rusty Anchor Tavern' },
  },
  factions: {
    'pirate-brethren': { id: 'pirate-brethren', name: 'The Pirate Brethren' },
  },
  characters: {
    'captain-orla-vance': { id: 'captain-orla-vance', name: 'Captain Orla Vance' },
  },
};

beforeEach(() => {
  mockCallGemini.mockReset();
});

describe('buildKnownEntities', () => {
  it('includes locations, factions, and characters from the canon world', () => {
    const entities = buildKnownEntities(MINI_WORLD);
    expect(entities).toEqual(
      expect.arrayContaining([
        { id: 'tavern', name: 'The Rusty Anchor Tavern', kind: 'location' },
        { id: 'pirate-brethren', name: 'The Pirate Brethren', kind: 'faction' },
        { id: 'captain-orla-vance', name: 'Captain Orla Vance', kind: 'character' },
      ])
    );
  });
});

describe('resolveTarget', () => {
  const knownEntities = buildKnownEntities(MINI_WORLD);

  it('resolves an exact id match', () => {
    expect(resolveTarget('captain-orla-vance', knownEntities)).toBe('captain-orla-vance');
  });

  it('resolves a case/whitespace-insensitive name match', () => {
    expect(resolveTarget('Captain Orla Vance', knownEntities)).toBe('captain-orla-vance');
  });

  it('resolves a fuzzy substring match', () => {
    expect(resolveTarget('orla', knownEntities)).toBe('captain-orla-vance');
  });

  it('returns the raw text unchanged when nothing matches', () => {
    expect(resolveTarget('a mysterious stranger', knownEntities)).toBe('a mysterious stranger');
  });
});

describe('interpretAction', () => {
  it('maps a well-formed model response, resolving targets to canon ids', async () => {
    mockCallGemini.mockResolvedValueOnce({
      verb: 'talk',
      targets: ['Captain Orla Vance'],
      params: { topic: 'the job' },
    });

    const result = await interpretAction({
      actionText: 'talk to captain orla vance about the job',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result).toEqual({
      verb: 'talk',
      targets: ['captain-orla-vance'],
      params: { topic: 'the job' },
    });
  });

  it('leaves an unresolvable target as raw text rather than dropping it', async () => {
    mockCallGemini.mockResolvedValueOnce({
      verb: 'talk',
      targets: ['a passing stranger'],
      params: {},
    });

    const result = await interpretAction({
      actionText: 'talk to the stranger',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result.targets).toEqual(['a passing stranger']);
  });

  it('lowercases and truncates an overly long verb', async () => {
    mockCallGemini.mockResolvedValueOnce({
      verb: 'A'.repeat(80),
      targets: [],
      params: {},
    });

    const result = await interpretAction({
      actionText: 'do something',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result.verb).toHaveLength(50);
    expect(result.verb).toBe('a'.repeat(50));
  });

  it('defaults params to {} when the model omits it or returns a non-object', async () => {
    mockCallGemini.mockResolvedValueOnce({ verb: 'look', targets: [] });

    const result = await interpretAction({
      actionText: 'look around',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result.params).toEqual({});
  });

  it('falls back to a safe passthrough when callGemini throws', async () => {
    mockCallGemini.mockRejectedValueOnce(new Error('AI unavailable'));

    const result = await interpretAction({
      actionText: 'set sail',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result).toEqual({ verb: 'unknown', targets: [], params: { raw: 'set sail' } });
  });

  it('falls back to a safe passthrough when the model omits verb', async () => {
    mockCallGemini.mockResolvedValueOnce({ targets: [] });

    const result = await interpretAction({
      actionText: 'set sail',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result).toEqual({ verb: 'unknown', targets: [], params: { raw: 'set sail' } });
  });

  it('falls back to a safe passthrough when targets is not an array', async () => {
    mockCallGemini.mockResolvedValueOnce({ verb: 'look', targets: 'everywhere' });

    const result = await interpretAction({
      actionText: 'look everywhere',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result).toEqual({ verb: 'unknown', targets: [], params: { raw: 'look everywhere' } });
  });

  it('falls back to a safe passthrough when the model returns null', async () => {
    mockCallGemini.mockResolvedValueOnce(null);

    const result = await interpretAction({
      actionText: 'wait',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(result).toEqual({ verb: 'unknown', targets: [], params: { raw: 'wait' } });
  });

  it('never returns an outcome or mutation-shaped field — intent only', async () => {
    mockCallGemini.mockResolvedValueOnce({
      verb: 'attack',
      targets: ['captain-orla-vance'],
      params: {},
      outcome: 'success',
      mutations: [{ op: 'increment', path: 'x', value: 1 }],
    });

    const result = await interpretAction({
      actionText: 'attack orla',
      canonWorld: MINI_WORLD,
      save: {},
      worldState: {},
    });

    expect(Object.keys(result).sort()).toEqual(['params', 'targets', 'verb']);
  });

  it('works against the real Shattered Coast canon world end-to-end', async () => {
    mockCallGemini.mockResolvedValueOnce({
      verb: 'move',
      targets: ["Widow's Reach"],
      params: {},
    });

    const result = await interpretAction({
      actionText: 'head back to the cove',
      canonWorld: CANON_WORLD,
      save: {},
      worldState: {},
    });

    expect(result.targets).toEqual(['widows-reach']);
  });
});
