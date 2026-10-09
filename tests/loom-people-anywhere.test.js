'use strict';

/**
 * Play with people anywhere (planning/the-loom-movement-and-vision.md §6a;
 * L-685 / #517): someone at a town point is "about town" for the GM, as
 * residents with no place are; someone in the wilderness (no locationId) is
 * never in a scene, a cast list or a place's grading, even when named, until
 * wilderness travel (L-360); and nothing in play breaks on them. The
 * pipeline's stages with Gemini stubbed; no emulator (the emulator side, new
 * games and the map, is in loom-battle-maps.test.js).
 *
 * Run: cd tests && npx jest loom-people-anywhere --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: async () => [],
}));

const { interpretAction } = require('../functions/loom-turn/interpret');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { narrateResolution, resolveSceneEntityIds } = require('../functions/loom-turn/narrate');
const { settlementProgress, gradePlace } = require('../functions/loom-canon/grading');
const { positionOf } = require('../functions/loom-canon/positions');

const INN = {
  id: 'bm_inn',
  name: 'The inn',
  width: 6,
  height: 4,
  entries: [{ id: 'door', x: 0, y: 1 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 2, to: 'out' }],
  features: [],
};
// Burdendal: a gate, a market with no map, an inn with one. Daldockley next
// door. Out in the wilds, a wanderer.
const WORLD = {
  id: 'w-anywhere',
  name: 'Anywhere',
  map: { width: 1000, height: 600 },
  locations: {
    loc_1: {
      id: 'loc_1',
      name: 'Burdendal',
      geo: { kind: 'settlement', x: 100, y: 100 },
      connections: ['loc_2'],
      npcIds: ['chr_crier', 'chr_seller', 'chr_barkeep'],
      factionIds: [],
    },
    loc_2: {
      id: 'loc_2',
      name: 'Daldockley',
      geo: { kind: 'settlement', x: 300, y: 120 },
      connections: ['loc_1'],
      npcIds: ['chr_far'],
      factionIds: [],
    },
  },
  places: {
    plc_gate: {
      id: 'plc_gate',
      locationId: 'loc_1',
      name: 'The gate',
      entrance: { via: ['road'] },
      position: { x: 50, y: 900 },
      connections: ['plc_market', 'plc_inn'],
      npcIds: [],
    },
    plc_market: {
      id: 'plc_market',
      locationId: 'loc_1',
      name: 'Market Square',
      position: { x: 400, y: 500 },
      connections: ['plc_gate'],
      npcIds: [],
    },
    plc_inn: {
      id: 'plc_inn',
      locationId: 'loc_1',
      name: 'The inn',
      position: { x: 600, y: 300 },
      connections: ['plc_gate'],
      npcIds: [],
      battleMap: { mapId: 'bm_inn' },
    },
  },
  battleMaps: { bm_inn: INN },
  factions: {},
  lore: {},
  rules: {},
  characters: {
    chr_crier: {
      id: 'chr_crier',
      name: 'The town crier',
      description: 'Bellows the news.',
      locationId: 'loc_1',
      townPoint: { x: 500, y: 500 },
    },
    chr_seller: {
      id: 'chr_seller',
      name: 'Fen the Fishwife',
      description: 'Sells eels.',
      locationId: 'loc_1',
      placeId: 'plc_market',
      townPoint: { x: 400, y: 500 },
    },
    chr_barkeep: {
      id: 'chr_barkeep',
      name: 'Tobin',
      description: 'Keeps the inn.',
      locationId: 'loc_1',
      placeId: 'plc_inn',
      cell: { x: 3, y: 1 },
    },
    chr_far: {
      id: 'chr_far',
      name: 'Ada Brine',
      description: 'Of Daldockley.',
      locationId: 'loc_2',
      townPoint: { x: 10, y: 10 },
    },
    chr_wanderer: {
      id: 'chr_wanderer',
      name: 'The Wanderer',
      description: 'A grey cloak on the moor road, never seen in town.',
      worldPoint: { x: 812, y: 400 },
    },
  },
};
const at = (placeId) => ({
  location: 'loc_1',
  placeId,
  mapId: null,
  cell: null,
  character: { name: 'Tam', speed: 20 },
  turn: { n: 1, movementLeft: 20, actionUsed: false, plan: null },
  recentSummary: '',
});
const talkTo = (targets) => ({ verb: 'talk', targets, params: {} });

beforeEach(() => mockCallGemini.mockReset());

test('every character in this world has a valid position', () => {
  for (const character of Object.values(WORLD.characters)) {
    expect(positionOf(WORLD, character).problem).toBeUndefined();
  }
});

describe('the scene the narrator is given', () => {
  test('at the gate: the crier, about town; not the fishwife, who keeps to the market', () => {
    const ids = resolveSceneEntityIds(WORLD, at('plc_gate'), talkTo([]));
    expect(ids).toContain('chr_crier');
    expect(ids).not.toContain('chr_seller');
    expect(ids).not.toContain('chr_far');
  });

  test('at the market: the fishwife, and the crier about town', () => {
    const ids = resolveSceneEntityIds(WORLD, at('plc_market'), talkTo([]));
    expect(ids).toEqual(expect.arrayContaining(['chr_seller', 'chr_crier']));
  });

  test('the wanderer, in the wilderness, is never in the scene, even when named', () => {
    expect(resolveSceneEntityIds(WORLD, at('plc_gate'), talkTo(['chr_wanderer']))).not.toContain(
      'chr_wanderer'
    );
    // Someone in another town, named, is as before.
    expect(resolveSceneEntityIds(WORLD, at('plc_gate'), talkTo(['chr_far']))).toContain('chr_far');
  });
});

describe('a turn that names the wanderer: nothing breaks, and nothing is told of them', () => {
  test('INTERPRET knows the name; ADJUDICATE rules; NARRATE is not given them', async () => {
    let narratorTold = '';
    mockCallGemini.mockImplementation(async (options) => {
      if (options.systemInstruction.includes('INTERPRET stage')) {
        return { verb: 'talk', targets: ['the wanderer'], params: {} };
      }
      narratorTold += options.userMessage;
      return { narration: 'Nobody answers.', inventedEntities: [], suggestedActions: [] };
    });
    const save = at('plc_gate');
    const proposed = await interpretAction({
      actionText: 'call out to the wanderer',
      canonWorld: WORLD,
      save,
      known: null,
    });
    expect(proposed.targets).toEqual(['chr_wanderer']);
    const resolution = evaluate(proposed, {}, save, 10, WORLD);
    expect(resolution).toMatchObject({ outcome: expect.any(String) });
    const narrated = await narrateResolution({
      actionText: 'call out to the wanderer',
      proposedAction: proposed,
      resolution,
      canonWorld: WORLD,
      save,
      worldState: {},
    });
    expect(narrated.entityRefs).not.toContain('chr_wanderer');
    expect(narratorTold).not.toContain('A grey cloak on the moor road');
  });
});

describe('grading: residents are those in town, never the wilderness', () => {
  test('a settlement counts its people at town points, places and squares', () => {
    expect(settlementProgress(WORLD, WORLD.locations.loc_1).residents.have).toBe(3);
    expect(settlementProgress(WORLD, WORLD.locations.loc_2).residents.have).toBe(1);
  });

  test('a place in town is peopled by whoever keeps to it', () => {
    const graded = { ...WORLD, status: 'published' };
    const missing = (placeId) =>
      gradePlace(graded, graded.places[placeId]).checklist.map((item) => item.need);
    expect(missing('plc_market')).not.toContain('residents');
    expect(missing('plc_gate')).toContain('residents');
  });

  test('the wanderer counts for no settlement', () => {
    const without = {
      ...WORLD,
      characters: Object.fromEntries(
        Object.entries(WORLD.characters).filter(([id]) => id !== 'chr_wanderer')
      ),
    };
    for (const id of ['loc_1', 'loc_2']) {
      expect(settlementProgress(WORLD, WORLD.locations[id]).residents.have).toBe(
        settlementProgress(without, without.locations[id]).residents.have
      );
    }
  });
});
