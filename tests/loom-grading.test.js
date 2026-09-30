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
  gradeWorld,
  isPlayable,
} = require('../functions/loom-canon/grading');
const { parseAzgaarExport } = require('../functions/cartographer/parse');
const { mapToCanon } = require('../functions/cartographer/map');
const { importStamp } = require('../functions/cartographer/sources');
const loomCanon = require('../functions/loom-canon');

const WRITTEN = { description: 'mcp' };
const IMPORTED = { description: 'import' };

// A small Cartographer world: a written-up port with a resident and lore, a
// stub town, a written ruin, and a realm and region.
function world(overrides = {}) {
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
}

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

describe('layers switch on as they ship', () => {
  test('no layer is required yet', () => {
    expect(LAYER_CHECKS).toEqual({ town: null, battleMap: null });
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
      inTown: { total: 0, unbuilt: 0, stub: 0, playable: 0, rich: 0 },
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

  test('a freshly imported Nisia is all Stub, and nothing in it is open', () => {
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
    expect(summary.places).toMatchObject({ total: 719, stub: 719, open: 0 });
    expect(summary.places.settlements.stub).toBe(663);
    expect(summary.places.pointsOfInterest.stub).toBe(56);
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
