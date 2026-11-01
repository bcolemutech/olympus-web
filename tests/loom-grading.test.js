'use strict';

/**
 * Grading (planning/the-loom-layered-worlds.md §4; L-321 / #390): the one
 * definition of "built", and its gate. Pure unit tests with hand-built worlds
 * and the Nisia fixture; no emulator. The score above the gate (L-691) is
 * tested in loom-grading-score.test.js.
 *
 * Run: cd tests && npx jest loom-grading --verbose
 */

const fs = require('fs');
const path = require('path');
const {
  GRADES,
  BANDS,
  LAYER_CHECKS,
  isWritten,
  gradeLocation,
  gradeEntity,
  gradePlace,
  gradeWorld,
  isPlayable,
  settlementProgress,
} = require('../functions/loom-canon/grading');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { importStamp } = require('../functions/cartographer/sources');
const loomCanon = require('../functions/loom-canon');
const { COAST } = require('./helpers/coast');
const { withTowns, gateId, GATEWAY } = require('./helpers/towns');

const WRITTEN = { description: 'mcp' };
// Lore long enough to count (60 words; L-691).
const LONG = Array(60).fill('word').join(' ');
const IMPORTED = { description: 'import' };

// A small Cartographer world: a written-up port with a resident and lore, a
// stub town, a written ruin, and a realm and region. Both settlements have a
// town layout (one gate each), as the town requirement asks, and the ruin its
// own walled battle map, as the battle-map requirement asks (L-622). The
// port's town has ground (L-655), as Rich asks: one building, its gate's door
// on the open ground beside it.
const PORT_GROUND = {
  buildings: [
    {
      name: 'the harbour master’s',
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
        { x: 200, y: 200 },
        { x: 100, y: 200 },
      ],
    },
  ],
};
const RUIN_MAP = {
  id: 'bm_ruin',
  name: 'The ruin',
  width: 4,
  height: 4,
  entries: [{ id: 'gap', x: 0, y: 1 }],
  exits: [{ id: 'out', name: 'the gap', x: 0, y: 0, to: 'out' }],
  features: [],
  walls: [
    {
      points: [
        { x: 2, y: 0 },
        { x: 2, y: 3 },
      ],
    },
  ],
  generic: null,
};
function world(overrides = {}) {
  const w = withTowns(world.bare(overrides), 'port', 'town');
  const gate = w.places[gateId('port')];
  return {
    ...w,
    places: { ...w.places, [gate.id]: { ...gate, position: { x: 500, y: 900 } } },
    locations: { ...w.locations, ruin: { ...w.locations.ruin, battleMap: { mapId: 'bm_ruin' } } },
    battleMaps: { ...w.battleMaps, bm_ruin: RUIN_MAP },
  };
}
world.bare = (overrides = {}) => {
  return {
    id: 'test-coast',
    status: 'published',
    locations: {
      port: {
        id: 'port',
        name: 'Port',
        description: 'Salt, tar and gulls.',
        sources: WRITTEN,
        connections: ['town', 'ruin'],
        npcIds: ['chr_mara'],
        geo: { kind: 'settlement' },
        town: { ground: PORT_GROUND },
      },
      town: {
        id: 'town',
        name: 'Town',
        description: 'Town of about 900; grassland.',
        sources: IMPORTED,
        connections: ['port'],
        npcIds: [],
        geo: { kind: 'settlement' },
      },
      ruin: {
        id: 'ruin',
        name: 'Ruin',
        description: 'Broken towers above the bay.',
        sources: WRITTEN,
        connections: ['port'],
        npcIds: [],
        geo: { kind: 'poi' },
      },
    },
    characters: {
      chr_mara: { id: 'chr_mara', name: 'Mara', locationId: 'port' },
    },
    lore: {
      lore_port: { id: 'lore_port', title: 'Founding', text: LONG, entityRefs: ['port'] },
    },
    factions: {
      fac_1: { id: 'fac_1', name: 'Kingdom', description: 'A monarchy.', sources: IMPORTED },
    },
    regions: {
      reg_1: { id: 'reg_1', name: 'County' },
    },
    ...overrides,
  };
};

// The gate's items: what a place needs to be Playable.
const gate = (result) =>
  result.checklist.filter((item) => item.for === 'playable').map((item) => item.need);
// The criteria a place hasn't met (L-691).
const unmet = (result) =>
  result.checklist.filter((item) => item.for === 'score').map((item) => item.criterion);

describe('places', () => {
  test('a written settlement with a town is Playable, with a score, a band and what it lacks', () => {
    const w = world();
    const port = gradeLocation(w, w.locations.port);
    expect(port).toMatchObject({ grade: 'playable', band: 'playable' });
    expect(gate(port)).toEqual([]);
    expect(port.score).toBeGreaterThan(0);
    expect(port.score).toBeLessThan(40);
    expect(unmet(port)).toEqual(
      expect.arrayContaining(['settlement.residents', 'settlement.townArt'])
    );
    // Its town has ground (L-655), and its lore is long enough to count.
    expect(unmet(port)).not.toContain('settlement.ground');
  });

  test('import text is a Stub: band stub, score 0, the gate first', () => {
    const w = world();
    const result = gradeLocation(w, w.locations.town);
    expect(result).toMatchObject({ grade: 'stub', band: 'stub', score: 0 });
    expect(result.checklist[0]).toEqual({
      need: 'description',
      for: 'playable',
      message: 'Its description is still the imported text.',
    });
    // The gate's need is not listed again by a criterion.
    expect(result.checklist.filter((item) => item.need === 'description')).toHaveLength(1);
    expect(unmet(result)).toEqual(
      expect.arrayContaining(['settlement.residents', 'settlement.lore', 'settlement.ground'])
    );
  });

  test('town ground is a criterion (L-655): without it, it is unmet', () => {
    const w = world();
    const bare = { ...w.locations.port, town: {} };
    expect(gradeLocation(w, bare).grade).toBe('playable');
    expect(gradeLocation(w, bare).checklist).toContainEqual(
      expect.objectContaining({
        need: 'ground',
        for: 'score',
        criterion: 'settlement.ground',
        message: 'Its town has no ground yet.',
      })
    );
    // Ground with no shapes left is none.
    const emptied = { ...w.locations.port, town: { ground: { buildings: [] } } };
    expect(unmet(gradeLocation(w, emptied))).toContain('settlement.ground');
  });

  test('written but bare is Playable; lore about a point of interest raises its score', () => {
    const w = world();
    const ruin = gradeLocation(w, w.locations.ruin);
    expect(ruin.grade).toBe('playable');
    expect(unmet(ruin)).toContain('place.lore');
    const withLore = world({
      lore: { l: { id: 'l', title: 'Towers', text: LONG, entityRefs: ['ruin'] } },
    });
    const lored = gradeLocation(withLore, withLore.locations.ruin);
    // One entry of the two a place wants (L-691).
    expect(lored.checklist).toContainEqual(
      expect.objectContaining({ criterion: 'place.lore', have: 1, want: 2 })
    );
    expect(lored.score).toBeGreaterThan(ruin.score);
  });

  test('a description with no recorded source, or none at all, is not written', () => {
    expect(isWritten({ description: 'Hand-typed?' })).toBe(false);
    expect(isWritten({ description: '   ', sources: WRITTEN })).toBe(false);
    expect(isWritten({ description: 'By Gemini.', sources: { description: 'gemini' } })).toBe(true);
    const w = world();
    const blank = { ...w.locations.ruin, description: '', sources: IMPORTED };
    expect(gradeLocation(w, blank).checklist[0].message).toBe('It has no description.');
  });

  test('retired residents and retired lore don’t count', () => {
    const w = world({
      characters: { chr_mara: { id: 'chr_mara', name: 'Mara', locationId: 'port', retired: true } },
      lore: {
        lore_port: { id: 'lore_port', title: 'F', text: LONG, entityRefs: ['port'], retired: true },
      },
    });
    expect(settlementProgress(w, w.locations.port)).toMatchObject({
      residents: { have: 0 },
      lore: { have: 0 },
    });
  });

  test('a character living there counts even when not in the cast list', () => {
    const w = world();
    const port = { ...w.locations.port, npcIds: [] };
    expect(settlementProgress(w, port).residents.have).toBe(1);
  });
});

describe('residents in town', () => {
  // The case Claude reported: placing a character at a spot in their town
  // must not stop them counting as one of the settlement's residents.
  test('a character given a place in town still counts for the settlement', () => {
    const base = world();
    const port = {
      ...base.locations.port,
      npcIds: [],
      geo: { kind: 'settlement', population: 5000 },
    };
    const harbourTower = {
      id: 'plc_port_tower',
      locationId: 'port',
      name: 'Harbour Tower',
      description: 'A tower.',
      sources: WRITTEN,
      connections: [],
      entrance: { via: ['sea'] }, // its own way in, so the layout stays valid
      position: { x: 800, y: 300 }, // its door, on the port's open ground (L-655)
    };
    const unplaced = { ...base, locations: { ...base.locations, port } };
    const placed = {
      ...unplaced,
      places: { ...unplaced.places, plc_port_tower: harbourTower },
      characters: {
        chr_mara: { id: 'chr_mara', name: 'Mara', locationId: 'port', placeId: 'plc_port_tower' },
      },
    };
    // A town wants 4 residents and 3 lore entries (L-691).
    expect(settlementProgress(unplaced, port)).toEqual({
      size: 'town',
      residents: { have: 1, want: 4 },
      lore: { have: 1, want: 3 },
    });
    expect(settlementProgress(placed, port)).toEqual(settlementProgress(unplaced, port));
    expect(gradeLocation(placed, port).checklist).toContainEqual(
      expect.objectContaining({
        need: 'residents',
        for: 'score',
        message: 'A town needs 4 residents (it has 1).',
        have: 1,
        want: 4,
      })
    );
  });
});

describe('layers switch on as they ship', () => {
  test('towns are required, and battle maps (L-622)', () => {
    expect(typeof LAYER_CHECKS.town).toBe('function');
    expect(typeof LAYER_CHECKS.battleMap).toBe('function');
  });

  test('a written-up settlement without a town layout is Unbuilt, and closed', () => {
    const w = world.bare();
    const port = gradeLocation(w, w.locations.port);
    expect(port).toMatchObject({ grade: 'unbuilt', band: 'unbuilt', score: 0 });
    expect(port.checklist[0]).toEqual({
      need: 'town',
      for: 'playable',
      message: 'It has no town layout.',
    });
    expect(gate(port)).toEqual(['town']);
    expect(isPlayable(w, w.locations.port)).toBe(false);
    // Points of interest need a battle map, not a town: without one, Unbuilt too.
    expect(gradeLocation(w, w.locations.ruin).checklist[0]).toEqual({
      need: 'battleMap',
      for: 'playable',
      message: 'It has no battle map.',
    });
    expect(isPlayable(w, w.locations.ruin)).toBe(false);
    expect(isPlayable(world(), world().locations.port)).toBe(true);
    expect(isPlayable(world(), world().locations.ruin)).toBe(true);
  });

  test('a required layer that is missing makes a place Unbuilt, however well written', () => {
    const w = world();
    const layers = { town: () => false, battleMap: () => true };
    const port = gradeLocation(w, w.locations.port, { layers });
    expect(port.grade).toBe('unbuilt');
    expect(gate(port)).toEqual(['town']);
    expect(gradeLocation(w, w.locations.ruin, { layers }).grade).toBe('playable');
    const noMaps = gradeLocation(w, w.locations.ruin, { layers: { battleMap: () => false } });
    expect(gate(noMaps)).toEqual(['battleMap']);
    // The gate names the battle map; its criterion isn't listed twice.
    expect(noMaps.checklist.filter((item) => item.need === 'battleMap')).toHaveLength(1);
    expect(isPlayable(w, w.locations.port, { layers })).toBe(false);
  });
});

describe('battle maps and their layers (L-622, L-628)', () => {
  const ruinWith = (battleMap, map) => {
    const w = world();
    const ruin = { ...w.locations.ruin, battleMap };
    const lore = { l: { id: 'l', title: 'Towers', text: LONG, entityRefs: ['ruin'] } };
    const v = { ...w, lore, locations: { ...w.locations, ruin } };
    if (map) v.battleMaps = { ...v.battleMaps, [map.id]: map };
    return gradeLocation(v, ruin);
  };
  const ownMap = (result) => result.criteria.find((c) => c.id === 'place.ownMap');

  test('no map: Unbuilt, however well written', () => {
    expect(ruinWith(undefined)).toMatchObject({ grade: 'unbuilt' });
    expect(gate(ruinWith(undefined))).toEqual(['battleMap']);
  });

  test('a generic map opens it, but earns nothing for its own map', () => {
    const generic = ruinWith({ mapId: GATEWAY.id });
    expect(generic.grade).toBe('playable');
    expect(ownMap(generic)).toMatchObject({ met: false, progress: 0 });
    expect(generic.checklist).toContainEqual(
      expect.objectContaining({ need: 'battleMap', message: 'It uses a generic battle map.' })
    );
  });

  test('its own map without walls or obstacles earns half', () => {
    const bare = { ...RUIN_MAP, id: 'bm_bare', walls: [] };
    const result = ruinWith({ mapId: 'bm_bare' }, bare);
    expect(result.grade).toBe('playable');
    expect(ownMap(result)).toMatchObject({ met: false, progress: 0.5 });
    expect(result.checklist).toContainEqual(
      expect.objectContaining({
        need: 'layers',
        tool: 'set_map_layers',
        message: 'Its battle map has no walls or obstacles.',
      })
    );
    const blocked = {
      ...bare,
      id: 'bm_rubble',
      obstacles: [{ id: 'r', kind: 'difficult', x: 3, y: 3 }],
    };
    expect(ownMap(ruinWith({ mapId: 'bm_rubble' }, blocked)).met).toBe(true);
  });

  test('its own walled map scores above a generic one', () => {
    expect(ruinWith({ mapId: 'bm_ruin' }).score).toBeGreaterThan(
      ruinWith({ mapId: GATEWAY.id }).score
    );
  });

  test('places in town are graded the same way', () => {
    const w = world();
    const town = Object.values(w.places)[0];
    const graded = gradePlace(w, town);
    expect(graded.grade).toBe('playable');
    expect(unmet(graded)).toEqual(
      expect.arrayContaining(['place.someone', 'place.ownMap', 'place.lore'])
    );
    expect(gradePlace(w, { ...town, battleMap: null }).grade).toBe('unbuilt');
  });
});

describe('realms and regions', () => {
  test('are gated on a written description, and scored', () => {
    const w = world();
    expect(gradeEntity(w, 'faction', w.factions.fac_1)).toMatchObject({
      grade: 'stub',
      band: 'stub',
    });
    expect(gradeEntity(w, 'region', w.regions.reg_1).checklist[0].message).toBe(
      'It has no description.'
    );
    const written = { ...w.factions.fac_1, sources: WRITTEN };
    expect(gradeEntity(w, 'faction', written).grade).toBe('playable');
    expect(() => gradeEntity(w, 'lore', w.lore.lore_port)).toThrow(/can't grade/);
  });
});

describe('whole worlds', () => {
  test('counts live places, realms and regions by band, and the open share', () => {
    const w = world();
    w.locations.gone = { id: 'gone', name: 'Gone', retired: true, geo: { kind: 'poi' } };
    const none = { unbuilt: 0, stub: 0, playable: 0, rich: 0, vivid: 0, legendary: 0 };
    const summary = gradeWorld(w);
    expect(summary).toMatchObject({
      graded: true,
      rubricVersion: 10,
      inTown: { total: 2, ...none, playable: 2 },
      places: {
        total: 3,
        ...none,
        stub: 1,
        playable: 2,
        settlements: { ...none, stub: 1, playable: 1 },
        pointsOfInterest: { ...none, playable: 1 },
        open: 0.667,
      },
      factions: { ...none, stub: 1 },
      regions: { ...none, stub: 1 },
      characters: { ...none, playable: 1 },
    });
    expect(summary.score).toBeGreaterThan(0);
    expect(summary.band).toBe('playable');
  });

  test('a freshly imported Nisia: settlements Unbuilt, the rest Stub, nothing open', () => {
    const parsed = parseAzgaarExport(
      fs.readFileSync(path.join(__dirname, 'fixtures/azgaar/nisia.json'))
    );
    const { canon } = mapToCanon(parsed);
    const stamp = (entities) =>
      Object.fromEntries(
        Object.entries(entities).map(([id, e]) => [id, { ...e, sources: importStamp(e) }])
      );
    const nisia = {
      ...canon,
      id: 'nisia',
      status: 'draft',
      locations: stamp(canon.locations),
      factions: stamp(canon.factions),
    };
    const summary = gradeWorld(nisia);
    // No settlement has a town yet, and no point of interest a battle map
    // (L-622): all Unbuilt.
    expect(summary.places).toMatchObject({ total: 719, unbuilt: 719, stub: 0, open: 0 });
    expect(summary.places.settlements.unbuilt).toBe(663);
    expect(summary.places.pointsOfInterest.unbuilt).toBe(56);
    expect(summary.factions.stub).toBe(23);
    expect(summary.regions.stub).toBe(145);
    // Nothing open scores: the world's score is only its own criteria's share.
    expect(summary.placesScore).toBe(0);
  });
});

test('a world object with no status (a test fixture) is exempt and always playable', () => {
  const coast = COAST;
  const place = Object.values(coast.locations)[0];
  expect(gradeLocation(coast, place)).toMatchObject({ grade: 'playable', exempt: true });
  expect(isPlayable(coast, place, { layers: { town: () => false, battleMap: () => false } })).toBe(
    true
  );
  expect(gradeWorld(coast)).toEqual({ graded: false });
  expect(GRADES).toEqual(['unbuilt', 'stub', 'playable']);
  expect(BANDS).toEqual(['unbuilt', 'stub', 'playable', 'rich', 'vivid', 'legendary']);
});
