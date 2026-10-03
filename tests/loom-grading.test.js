'use strict';

/**
 * Grading (planning/the-loom-layered-worlds.md §4; L-321 / #390): the one
 * definition of "built". Pure unit tests with hand-built worlds and the Nisia
 * fixture; no emulator.
 *
 * Run: cd tests && npx jest loom-grading --verbose
 */

const fs = require('fs');
const path = require('path');
const {
  GRADES,
  LAYER_CHECKS,
  isWritten,
  gradeLocation,
  gradeEntity,
  gradePlace,
  gradeWorld,
  isPlayable,
} = require('../functions/loom-canon/grading');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { importStamp } = require('../functions/cartographer/sources');
const loomCanon = require('../functions/loom-canon');
const { withTowns, GATEWAY } = require('./helpers/towns');

const WRITTEN = { description: 'mcp' };
const IMPORTED = { description: 'import' };

// A small Cartographer world: a written-up port with a resident and lore, a
// stub town, a written ruin, and a realm and region. Both settlements have a
// town layout (one gate each), as the town requirement asks, and the ruin its
// own walled battle map, as the battle-map requirement asks (L-622).
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
  return {
    ...w,
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
      lore_port: { id: 'lore_port', title: 'Founding', text: '…', entityRefs: ['port'] },
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

const needs = (result) => result.checklist.map((item) => `${item.for}:${item.need}`);

describe('places', () => {
  test('a written settlement with a resident and lore is Rich', () => {
    const w = world();
    expect(gradeLocation(w, w.locations.port)).toEqual({ grade: 'rich', checklist: [] });
  });

  test('import text is a Stub, listing everything it lacks', () => {
    const w = world();
    const result = gradeLocation(w, w.locations.town);
    expect(result.grade).toBe('stub');
    expect(result.checklist).toEqual([
      {
        need: 'description',
        for: 'playable',
        message: 'Its description is still the imported text.',
      },
      { need: 'residents', for: 'rich', message: 'Nobody lives here yet.' },
      { need: 'lore', for: 'rich', message: 'There is no lore about it.' },
    ]);
  });

  test('written but bare is Playable; a point of interest needs only lore to be Rich', () => {
    const w = world();
    expect(needs(gradeLocation(w, w.locations.ruin))).toEqual(['rich:lore']);
    expect(gradeLocation(w, w.locations.ruin).grade).toBe('playable');
    const withLore = world({
      lore: { l: { id: 'l', title: 'Towers', text: '…', entityRefs: ['ruin'] } },
    });
    expect(gradeLocation(withLore, withLore.locations.ruin).grade).toBe('rich');
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
        lore_port: { id: 'lore_port', title: 'F', text: '…', entityRefs: ['port'], retired: true },
      },
    });
    expect(needs(gradeLocation(w, w.locations.port))).toEqual(['rich:residents', 'rich:lore']);
  });

  test('a character living there counts even when not in the cast list', () => {
    const w = world();
    const port = { ...w.locations.port, npcIds: [] };
    expect(gradeLocation(w, port).grade).toBe('rich');
  });
});

describe('residents in town', () => {
  // The case Claude reported: placing a character at a spot in their town
  // must not stop them counting as one of the settlement's residents.
  test('a character given a place in town still counts for the settlement', () => {
    const { settlementProgress } = require('../functions/loom-canon/grading');
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
    };
    const unplaced = { ...base, locations: { ...base.locations, port } };
    const placed = {
      ...unplaced,
      places: { ...unplaced.places, plc_port_tower: harbourTower },
      characters: {
        chr_mara: { id: 'chr_mara', name: 'Mara', locationId: 'port', placeId: 'plc_port_tower' },
      },
    };
    expect(settlementProgress(unplaced, port)).toEqual({
      size: 'town',
      residents: { have: 1, want: 2 },
      lore: { have: 1, want: 1 },
    });
    expect(settlementProgress(placed, port)).toEqual(settlementProgress(unplaced, port));
    expect(gradeLocation(placed, port).checklist).toEqual([
      { need: 'residents', for: 'rich', message: 'A town needs 2 residents (it has 1).' },
    ]);
  });
});

describe('layers switch on as they ship', () => {
  test('towns are required, and battle maps (L-622)', () => {
    expect(typeof LAYER_CHECKS.town).toBe('function');
    expect(typeof LAYER_CHECKS.battleMap).toBe('function');
  });

  test('a written-up settlement without a town layout is Unbuilt, and closed', () => {
    const w = world.bare();
    expect(gradeLocation(w, w.locations.port)).toEqual({
      grade: 'unbuilt',
      checklist: [{ need: 'town', for: 'playable', message: 'It has no town layout.' }],
    });
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
    expect(port).toEqual({
      grade: 'unbuilt',
      checklist: [{ need: 'town', for: 'playable', message: 'It has no town layout.' }],
    });
    expect(gradeLocation(w, w.locations.ruin, { layers }).grade).toBe('playable');
    const noMaps = gradeLocation(w, w.locations.ruin, { layers: { battleMap: () => false } });
    expect(needs(noMaps)).toEqual(['playable:battleMap', 'rich:lore']);
    expect(isPlayable(w, w.locations.port, { layers })).toBe(false);
  });
});

describe('battle maps and their layers (L-622, L-628)', () => {
  const ruinWith = (battleMap, map) => {
    const w = world();
    const ruin = { ...w.locations.ruin, battleMap };
    const lore = { l: { id: 'l', title: 'Towers', text: '…', entityRefs: ['ruin'] } };
    const v = { ...w, lore, locations: { ...w.locations, ruin } };
    if (map) v.battleMaps = { ...v.battleMaps, [map.id]: map };
    return gradeLocation(v, ruin);
  };

  test('no map: Unbuilt, however well written', () => {
    expect(ruinWith(undefined)).toMatchObject({ grade: 'unbuilt' });
    expect(needs(ruinWith(undefined))).toEqual(['playable:battleMap']);
  });

  test('a generic map opens it, but stops it short of Rich', () => {
    expect(ruinWith({ mapId: GATEWAY.id })).toEqual({
      grade: 'playable',
      checklist: [{ need: 'battleMap', for: 'rich', message: 'It uses a generic battle map.' }],
    });
  });

  test('its own map without walls or obstacles stops it short of Rich too', () => {
    const bare = { ...RUIN_MAP, id: 'bm_bare', walls: [] };
    expect(ruinWith({ mapId: 'bm_bare' }, bare)).toEqual({
      grade: 'playable',
      checklist: [
        { need: 'layers', for: 'rich', message: 'Its battle map has no walls or obstacles.' },
      ],
    });
    const blocked = {
      ...bare,
      id: 'bm_rubble',
      obstacles: [{ id: 'r', kind: 'difficult', x: 3, y: 3 }],
    };
    expect(ruinWith({ mapId: 'bm_rubble' }, blocked).grade).toBe('rich');
  });

  test('its own walled map, and lore: Rich', () => {
    expect(ruinWith({ mapId: 'bm_ruin' })).toEqual({ grade: 'rich', checklist: [] });
  });

  test('places in town are graded the same way', () => {
    const w = world();
    const gate = Object.values(w.places)[0];
    expect(needs(gradePlace(w, gate))).toEqual(['rich:residents', 'rich:battleMap']);
    expect(gradePlace(w, { ...gate, battleMap: null }).grade).toBe('unbuilt');
  });
});

describe('realms and regions', () => {
  test('are graded on description and lore', () => {
    const w = world();
    expect(gradeEntity(w, 'faction', w.factions.fac_1).grade).toBe('stub');
    expect(gradeEntity(w, 'region', w.regions.reg_1).checklist[0].message).toBe(
      'It has no description.'
    );
    const written = { ...w.factions.fac_1, sources: WRITTEN };
    expect(gradeEntity(w, 'faction', written).grade).toBe('playable');
    expect(() => gradeEntity(w, 'character', w.characters.chr_mara)).toThrow(/can't grade/);
  });
});

describe('whole worlds', () => {
  test('counts live places, realms and regions by grade, and the open share', () => {
    const w = world();
    w.locations.gone = { id: 'gone', name: 'Gone', retired: true, geo: { kind: 'poi' } };
    expect(gradeWorld(w)).toEqual({
      graded: true,
      rubricVersion: 2,
      inTown: { total: 2, unbuilt: 0, stub: 0, playable: 2, rich: 0 },
      places: {
        total: 3,
        unbuilt: 0,
        stub: 1,
        playable: 1,
        rich: 1,
        settlements: { unbuilt: 0, stub: 1, playable: 0, rich: 1 },
        pointsOfInterest: { unbuilt: 0, stub: 0, playable: 1, rich: 0 },
        open: 0.667,
      },
      factions: { unbuilt: 0, stub: 1, playable: 0, rich: 0 },
      regions: { unbuilt: 0, stub: 1, playable: 0, rich: 0 },
    });
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
  });
});

test('static, hand-authored worlds are exempt and always playable', () => {
  const coast = loomCanon.getWorld('shattered-coast');
  const place = Object.values(coast.locations)[0];
  expect(gradeLocation(coast, place)).toMatchObject({ grade: 'playable', exempt: true });
  expect(isPlayable(coast, place, { layers: { town: () => false, battleMap: () => false } })).toBe(
    true
  );
  expect(gradeWorld(coast)).toEqual({ graded: false });
  expect(GRADES).toEqual(['unbuilt', 'stub', 'playable', 'rich']);
});
