'use strict';

/**
 * The GM sees what you see (planning/the-loom-movement-and-vision.md §5;
 * L-636 / #459): on a battle map, INTERPRET is told only the features, exits
 * and doors the player has seen; ADJUDICATE turns down actions aimed at
 * something out of sight, and physical ones at something out of reach; and
 * NARRATE's ON THE MAP lists what's in sight and what's remembered, nothing
 * else. The pipeline's stages, with Gemini stubbed; no emulator.
 *
 * Run: cd tests && npx jest loom-gm-sight --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: async () => [],
}));

const { interpretAction } = require('../functions/loom-turn/interpret');
const { evaluate, NOT_SEEN, NOBODY_SEEN } = require('../functions/loom-turn/adjudicate');
const { narrateResolution } = require('../functions/loom-turn/narrate');
const { knownTo } = require('../functions/loom-turn/seen');

const sq = (x, y) => ({ x, y });
const run = (a, b) => ({ points: [a, b] });

// A vault under a ruin: the stair room (x < 6), with the chest, and behind
// the iron door the inner room (x ≥ 6), with the altar and a tunnel out.
const VAULT = {
  id: 'bm_vault',
  name: 'The vault',
  width: 10,
  height: 6,
  image: null,
  entries: [{ id: 'stairs', x: 0, y: 2 }],
  exits: [
    { id: 'stairs-up', name: 'the stairs up', x: 0, y: 3, to: 'out' },
    { id: 'tunnel', name: 'a tunnel', x: 9, y: 0, to: 'out' },
  ],
  features: [
    { id: 'chest', name: 'the chest', x: 4, y: 4 },
    { id: 'altar', name: 'the altar', x: 8, y: 2 },
  ],
  walls: [run(sq(6, 0), sq(6, 2)), run(sq(6, 3), sq(6, 6))],
  doors: [{ id: 'iron-door', name: 'the iron door', from: sq(6, 2), to: sq(6, 3) }],
};
const WORLD = {
  id: 'w-ruin',
  name: 'The Ruin',
  locations: {
    loc_9: {
      id: 'loc_9',
      name: 'The ruin',
      battleMap: { mapId: 'bm_vault' },
      connections: [],
      npcIds: [],
      factionIds: [],
    },
  },
  places: {},
  factions: {},
  lore: {},
  rules: {},
  battleMaps: { bm_vault: VAULT },
  characters: {
    chr_hermit: { id: 'chr_hermit', name: 'the hermit', locationId: 'loc_9', cell: sq(2, 4) },
    chr_ghost: { id: 'chr_ghost', name: 'a ghost', locationId: 'loc_9', cell: sq(8, 4) },
  },
};
// The player, by the stairs (or elsewhere), the iron door as given.
const standing = (cell = sq(1, 2), doors = {}) => ({
  location: 'loc_9',
  placeId: null,
  mapId: 'bm_vault',
  cell,
  doors: { bm_vault: doors },
  character: { name: 'Tam', speed: 20 },
  turn: { n: 1, movementLeft: 20, actionUsed: false, plan: null },
  recentSummary: '',
});
// Every square, as if all of the vault had been seen before.
const everything = () => {
  const all = {};
  for (let x = 0; x < VAULT.width; x++)
    for (let y = 0; y < VAULT.height; y++) all[x + ',' + y] = true;
  return all;
};
const act = (verb, target, save = standing(), dice = 20) =>
  evaluate({ verb, targets: [target], params: {} }, {}, save, dice, WORLD);

beforeEach(() => mockCallGemini.mockReset());

describe('INTERPRET is told only what the player has seen', () => {
  const prompts = [];
  beforeEach(() => {
    prompts.length = 0;
    mockCallGemini.mockImplementation(async (options) => {
      prompts.push(options.systemInstruction);
      return { verb: 'search', targets: ['the altar'], params: {} };
    });
  });

  test('the stair room, not the inner room behind the shut door', async () => {
    const save = standing();
    await interpretAction({
      actionText: 'search the altar',
      canonWorld: WORLD,
      save,
      known: knownTo(WORLD, save, null),
    });
    const prompt = prompts[0];
    expect(prompt).toContain('- feature:chest (feature here): the chest');
    expect(prompt).toContain('- exit:stairs-up (way out of here): the stairs up');
    expect(prompt).toContain('- door:iron-door (door here): the iron door');
    expect(prompt).not.toMatch(/altar|tunnel/);
  });

  test('an unseen thing named is still matched, here, for ADJUDICATE to turn down', async () => {
    const save = standing();
    const proposed = await interpretAction({
      actionText: 'search the altar',
      canonWorld: WORLD,
      save,
      known: knownTo(WORLD, save, null),
    });
    expect(proposed.targets).toEqual(['feature:altar']);
    expect(act('search', 'feature:altar')).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: [NOT_SEEN],
    });
  });

  test('what was seen before is named again', async () => {
    const save = standing();
    await interpretAction({
      actionText: 'search the altar',
      canonWorld: WORLD,
      save,
      known: everything(),
    });
    expect(prompts[0]).toContain('- feature:altar (feature here): the altar');
  });
});

describe('ADJUDICATE: out of sight, out of reach', () => {
  test('an action at something out of sight is turned down, and uses nothing', () => {
    expect(NOT_SEEN).toBe("You don't see that here.");
    for (const target of ['feature:altar', 'exit:tunnel']) {
      expect(act('search', target)).toEqual(expect.objectContaining({ constraints: [NOT_SEEN] }));
    }
    // Seen before is not in sight now: the door shut, the altar is hidden.
    expect(act('look', 'feature:altar').constraints).toEqual([NOT_SEEN]);
  });

  test('so is one at someone out of sight', () => {
    expect(NOBODY_SEEN).toBe("You don't see anyone like that here.");
    expect(act('talk', 'chr_ghost').constraints).toEqual([NOBODY_SEEN]);
  });

  test('a chest across the room is out of reach; beside it, it opens', () => {
    expect(act('open', 'feature:chest')).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['You need to be beside the chest.'],
    });
    const beside = act('open', 'feature:chest', standing(sq(3, 3)));
    expect(beside.outcome).toBe('success');
    expect(beside.constraints).toEqual(['The attempt to open succeeds.']);
    expect(beside.mutations).toContainEqual(
      expect.objectContaining({
        path: 'turn',
        value: expect.objectContaining({ actionUsed: true }),
      })
    );
    // On its square counts too.
    expect(act('open', 'feature:chest', standing(sq(4, 4))).outcome).toBe('success');
  });

  test('looking and talking need only sight', () => {
    expect(act('look', 'feature:chest').outcome).toBe('success');
    expect(act('talk', 'chr_hermit').outcome).toBe('success');
    expect(act('shove', 'chr_hermit').constraints).toEqual(['You need to be beside the hermit.']);
  });

  test('through the open door, the altar is in sight but still out of reach', () => {
    const atTheDoor = standing(sq(5, 2), { 'iron-door': 'open' });
    expect(act('look', 'feature:altar', atTheDoor).outcome).toBe('success');
    expect(act('search', 'feature:altar', atTheDoor).constraints).toEqual([
      'You need to be beside the altar.',
    ]);
  });
});

describe("NARRATE's ON THE MAP: what's in sight, what's remembered, nothing else", () => {
  let told;
  beforeEach(() => {
    told = '';
    mockCallGemini.mockImplementation(async (options) => {
      told += options.systemInstruction + '\n' + options.userMessage;
      return { narration: 'The vault is quiet.', inventedEntities: [], suggestedActions: [] };
    });
  });
  const narrate = (save, known, mutations = []) =>
    narrateResolution({
      actionText: 'look around',
      proposedAction: { verb: 'look', targets: [], params: {} },
      resolution: { outcome: 'success', mutations, constraints: [] },
      canonWorld: WORLD,
      save,
      worldState: {},
      known,
    });

  test('from the stairs, the stair room only: never the altar or the tunnel', async () => {
    const save = standing();
    await narrate(save, knownTo(WORLD, save, null));
    expect(told).toContain('Features: the chest (4, 4).');
    expect(told).toContain('Doors: the iron door (closed).');
    expect(told).toContain('- the stairs up (0, 3): out of The ruin');
    expect(told).not.toMatch(/altar|tunnel/);
  });

  test('seen before, out of sight now: told as remembered', async () => {
    await narrate(standing(), everything());
    expect(told).toContain('Features: the chest (4, 4).');
    expect(told).toContain('Features remembered, out of sight now: the altar (8, 2).');
    expect(told).toContain('- a tunnel (9, 0): out of The ruin (remembered, out of sight now)');
  });

  test('a door opened this turn shows what is beyond it', async () => {
    const save = standing(sq(5, 2));
    await narrate(save, knownTo(WORLD, save, null), [
      { target: 'save', op: 'set-flag', path: 'doors.bm_vault.iron-door', value: 'open' },
    ]);
    expect(told).toContain('Features: the chest (4, 4); the altar (8, 2).');
    expect(told).toContain('Doors: the iron door (open).');
  });
});

describe('the GM knows who is where (L-643)', () => {
  let told;
  beforeEach(() => {
    told = '';
    mockCallGemini.mockImplementation(async (options) => {
      told += options.systemInstruction + '\n' + options.userMessage + '\n';
      return options.systemInstruction.includes('INTERPRET stage')
        ? { verb: 'talk', targets: ['the hermit'], params: {} }
        : { narration: 'The vault is quiet.', inventedEntities: [], suggestedActions: [] };
    });
  });
  const narrate = (save, targets = [], mutations = []) =>
    narrateResolution({
      actionText: 'talk',
      proposedAction: { verb: 'talk', targets, params: {} },
      resolution: { outcome: 'success', mutations, constraints: [] },
      canonWorld: WORLD,
      save,
      worldState: {},
      known: knownTo(WORLD, save, null),
    });

  test('INTERPRET is told who is in sight, and who is beside the player', async () => {
    const beside = standing(sq(1, 3));
    const proposed = await interpretAction({
      actionText: 'talk to the hermit',
      canonWorld: WORLD,
      save: beside,
      known: knownTo(WORLD, beside, null),
    });
    expect(proposed.targets).toEqual(['chr_hermit']);
    expect(told).toContain(
      '- chr_hermit (person in sight here, at (2, 4), beside the player): the hermit'
    );
    // The ghost behind the shut door is a name in the world, never placed.
    expect(told).toContain('- chr_ghost (character): a ghost');
    expect(told).not.toMatch(/chr_ghost \(person in sight/);

    told = '';
    const across = standing(sq(1, 1));
    await interpretAction({
      actionText: 'talk to the hermit',
      canonWorld: WORLD,
      save: across,
      known: knownTo(WORLD, across, null),
    });
    expect(told).toContain('- chr_hermit (person in sight here, at (2, 4)): the hermit');
  });

  test("NARRATE's ON THE MAP names the people in sight, and who is beside the player", async () => {
    await narrate(standing(sq(1, 3)));
    expect(told).toContain('People in sight: the hermit (2, 4), beside the player.');
    expect(told).toContain('Nobody else on this map is in sight');
    expect(told).not.toMatch(/ghost \(8, 4\)/);
  });

  test('someone out of sight is left out of the scene, even when named', async () => {
    const { entityRefs } = await narrate(standing(sq(1, 3)), ['chr_ghost', 'chr_hermit']);
    expect(entityRefs).toEqual(['chr_hermit']);
  });

  test('a door opened this turn brings the ghost into sight, and into the scene', async () => {
    const { entityRefs } = await narrate(
      standing(sq(5, 2)),
      ['chr_ghost'],
      [{ target: 'save', op: 'set-flag', path: 'doors.bm_vault.iron-door', value: 'open' }]
    );
    expect(told).toMatch(/People in sight: .*a ghost \(8, 4\)/);
    expect(entityRefs).toEqual(['chr_ghost']);
  });

  test('beside counts as reach for a hand on someone; across the room only talk', () => {
    expect(act('shove', 'chr_hermit', standing(sq(1, 3))).outcome).toBe('success');
    expect(act('shove', 'chr_hermit').constraints).toEqual(['You need to be beside the hermit.']);
    expect(act('talk', 'chr_hermit').outcome).toBe('success');
    expect(act('talk', 'chr_ghost', standing(sq(1, 3))).constraints).toEqual([NOBODY_SEEN]);
  });
});
