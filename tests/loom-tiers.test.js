'use strict';

/**
 * Typed actions by tier (planning/action-points.md §3 CT3, §4.6; L-835 /
 * #685): INTERPRET names a tier (minor, standard or major), never a number;
 * ADJUDICATE charges the system's cost for it, a tier it doesn't know as
 * standard; with too little AP it's refused, spending nothing; plausibility
 * comes first (L-826), its refusals and questions spending nothing; actions
 * with a cost of their own keep it. Pure, under both built-in systems (MD2).
 *
 * Run: cd tests && npx jest loom-tiers.test --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const { evaluate, priceOf } = require('../functions/loom-turn/adjudicate');

const copyOf = (v) => JSON.parse(JSON.stringify(v));

const HALL = {
  id: 'bm',
  name: 'The hall',
  width: 10,
  height: 5,
  entries: [{ id: 'in', x: 0, y: 2 }],
  exits: [{ id: 'out', name: 'the way out', x: 0, y: 4, to: 'out' }],
  features: [{ id: 'chest', name: 'the chest', x: 3, y: 2 }],
};

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('typed actions by tier under %s', (id, built) => {
  const worldOf = (system = built) => ({
    id: 'w',
    system,
    locations: { hall: { id: 'hall', name: 'The hall', battleMap: { mapId: 'bm' } } },
    battleMaps: { bm: HALL },
    characters: {},
  });
  const standing = (ap = 20) => ({
    location: 'hall',
    mapId: 'bm',
    cell: { x: 2, y: 2 },
    character: { name: 'Tam', sheet: sheets.defaultSheet(built), inventory: [] },
    turn: { n: 1, ap, kept: 0, plan: null },
  });
  const typed = (params, save = standing(), system = built, verb = 'barricade') =>
    evaluate({ verb, targets: [], params }, {}, save, 15, worldOf(system));
  const left = (r) => (r.mutations.find((m) => m.path === 'turn') || {}).value.ap;

  test('each tier charged: minor 3, standard 10, major 20', () => {
    expect(left(typed({ tier: 'minor' }))).toBe(17);
    expect(left(typed({ tier: 'standard' }))).toBe(10);
    expect(left(typed({ tier: 'major' }))).toBe(0);
  });

  test('no tier, or one it doesn’t know, is standard', () => {
    expect(left(typed({}))).toBe(10);
    expect(left(typed({ tier: 'epic' }))).toBe(10);
  });

  test('a system’s own tiers', () => {
    const own = {
      ...copyOf(built),
      ap: { ...built.ap, tiers: { minor: 2, standard: 8, major: 15 } },
    };
    expect(left(typed({ tier: 'major' }, standing(), own))).toBe(5);
  });

  test('refused when short, spending nothing', () => {
    expect(typed({ tier: 'major' }, standing(12))).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['That costs 20 AP; you have 12.'],
      plain: true,
    });
  });

  test('plausibility first: refusals and questions spend nothing', () => {
    const refused = typed({ tier: 'major', plausibility: 'extraordinary', why: 'You cannot fly.' });
    expect(refused).toMatchObject({ outcome: 'blocked', constraints: ['You cannot fly.'] });
    expect(refused.mutations).toEqual([]);
    const asked = typed({ tier: 'major', plausibility: 'complicated', question: 'How?' });
    expect(asked).toMatchObject({ outcome: 'blocked', ask: 'How?' });
    expect(asked.mutations).toEqual([]);
    // Improbable: still tried, at its tier.
    expect(left(typed({ tier: 'minor', plausibility: 'improbable' }))).toBe(17);
  });

  test('actions with a cost of their own keep it: the tier is for everything else', () => {
    // Handling an object is 5, whatever tier the model named.
    const opened = evaluate(
      { verb: 'open', targets: ['feature:chest'], params: { tier: 'major' } },
      {},
      { ...standing(), cell: { x: 2, y: 2 } },
      15,
      worldOf()
    );
    expect(left(opened)).toBe(15);
  });

  test('the confirm card’s price is the tier’s', () => {
    const at = { verb: 'barricade', targets: [], params: { tier: 'major' } };
    expect(priceOf(at, standing(), worldOf())).toEqual({ cost: 20 });
    expect(priceOf({ ...at, params: { tier: 'minor' } }, standing(), worldOf())).toEqual({
      cost: 3,
    });
  });
});

describe('INTERPRET names a tier (L-835)', () => {
  const mockState = { reply: null, prompt: null };
  jest.resetModules();
  jest.doMock('../functions/gemini', () => ({
    callGemini: async (options) => {
      mockState.prompt = options.systemInstruction + '\n' + options.userMessage;
      return mockState.reply;
    },
  }));
  const { interpretAction } = require('../functions/loom-turn/interpret');
  const world = {
    id: 'w',
    system: BUILT_IN['d20-fantasy'],
    locations: {},
    factions: {},
    characters: {},
  };
  const save = {
    location: null,
    character: { name: 'Tam', sheet: sheets.defaultSheet(world.system) },
  };

  test('the prompt says each tier and its cost; the tier is kept, anything else dropped', async () => {
    mockState.reply = { verb: 'barricade', targets: [], params: { tier: 'Major' } };
    const action = await interpretAction({
      actionText: 'barricade the door',
      canonWorld: world,
      save,
    });
    expect(mockState.prompt).toContain('TIER: add params.tier');
    expect(mockState.prompt).toContain('"minor" (3 AP)');
    expect(mockState.prompt).toContain('"major" (20 AP)');
    expect(action.params.tier).toBe('major');
    mockState.reply = { verb: 'barricade', targets: [], params: { tier: 12 } };
    expect(
      (await interpretAction({ actionText: 'barricade the door', canonWorld: world, save })).params
    ).not.toHaveProperty('tier');
  });

  test('with AP off (L-838) there are no tiers to name', async () => {
    mockState.reply = { verb: 'search', targets: [], params: {} };
    await interpretAction({
      actionText: 'search',
      canonWorld: { ...world, system: { ...world.system, ap: false } },
      save,
    });
    expect(mockState.prompt).not.toContain('TIER:');
  });
});
