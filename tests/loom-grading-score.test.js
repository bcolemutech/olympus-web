'use strict';

/**
 * The score (planning/the-loom-grading.md §4; L-691 / #552): the criteria
 * registry, quality checks, rollups, bands, the world's score, and the
 * calibration against a copy of Nisia's built places. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-grading-score --verbose
 */

const {
  RUBRIC_VERSION,
  CRITERIA,
  WEIGHTS,
  QUALITY,
  LAYER_CHECKS,
  bandOf,
  gradeLocation,
  gradePlace,
  gradeCharacter,
  gradeBattleMap,
  gradeEntity,
  gradeWorld,
  placeWeights,
  isPlayable,
  isPlaceOpen,
} = require('../functions/loom-canon/grading');
const NISIA = require('./fixtures/nisia-built.json');

const WRITTEN = { description: 'mcp' };
const words = (n) => Array(n).fill('word').join(' ');
const LONG = words(QUALITY.words.lore);
const SHORT = words(QUALITY.words.lore - 1);
const SQUARE = [
  { x: 100, y: 100 },
  { x: 200, y: 100 },
  { x: 200, y: 200 },
];
// Layers without a town layout to build: these tests are about the score.
// A sheet for the built-in fantasy system, the system Nisia plays by (L-813).
const SHEET = require('../functions/loom-canon/sheets').defaultSheet(
  require('../functions/loom-canon/systems').BUILT_IN['d20-fantasy']
);
const layers = { ...LAYER_CHECKS, town: () => true };

const criterion = (id) => CRITERIA.find((c) => c.id === id);
const check = (id, world, entity, kind) => criterion(id).check(world, entity, { kind, layers });

const MAP = {
  id: 'bm_inn',
  name: 'The inn',
  width: 8,
  height: 8,
  image: { path: 'art/inn.png', width: 8, height: 8 },
  entries: [{ id: 'door', x: 0, y: 1 }],
  exits: [{ id: 'out', name: 'the door', x: 0, y: 0, to: 'out' }],
  features: [
    { id: 'bar', name: 'the bar', x: 3, y: 3 },
    { id: 'hearth', name: 'the hearth', x: 5, y: 5 },
  ],
  walls: [{ points: [SQUARE[0], SQUARE[1]] }],
  generic: null,
};

function world(overrides = {}) {
  return {
    id: 'score-test',
    status: 'published',
    tagline: 'Salt and smoke',
    openingHook: 'The bells are ringing.',
    map: { imagePath: 'maps/world.png' },
    // Its cover (L-704): a library image reference.
    cover: { imageId: 'img_00000000000000c0', link: 'https://x/c', width: 600, height: 300 },
    rules: { startingLocationId: 'port' },
    // Its game system (L-801), set and passing its checks.
    systemId: 'pirate-d20',
    system: {
      ...require('../functions/loom-canon/systems').BUILT_IN['d20-fantasy'],
      id: 'pirate-d20',
    },
    locations: {
      port: {
        id: 'port',
        name: 'Port',
        description: words(60),
        sources: WRITTEN,
        connections: ['ruin'],
        factionIds: ['fac_1'],
        npcIds: [],
        geo: { kind: 'settlement', population: 500, regionId: 'reg_1' },
        town: { ground: { buildings: [{ points: SQUARE }] }, image: { path: 'art/port.png' } },
      },
      ruin: {
        id: 'ruin',
        name: 'Ruin',
        description: words(60),
        sources: WRITTEN,
        connections: ['port', 'far'],
        npcIds: [],
        geo: { kind: 'poi' },
        battleMap: { mapId: 'bm_ruin' },
      },
      far: {
        id: 'far',
        name: 'Far',
        description: 'Imported.',
        sources: { description: 'import' },
        connections: ['ruin'],
        geo: { kind: 'poi' },
      },
    },
    places: {
      plc_inn: {
        id: 'plc_inn',
        locationId: 'port',
        name: 'The Inn',
        description: words(60),
        sources: WRITTEN,
        npcIds: ['chr_mara', 'chr_tom'],
        connections: [],
        entrance: { via: ['road'] },
        battleMap: { mapId: 'bm_inn' },
      },
    },
    battleMaps: { bm_inn: MAP, bm_ruin: { ...MAP, id: 'bm_ruin', name: 'The ruin' } },
    characters: {
      chr_mara: {
        id: 'chr_mara',
        name: 'Mara',
        description: words(40),
        factionId: 'fac_1',
        locationId: 'port',
        placeId: 'plc_inn',
      },
      chr_tom: {
        id: 'chr_tom',
        name: 'Tom',
        description: words(40),
        factionId: 'fac_1',
        locationId: 'port',
        placeId: 'plc_inn',
      },
    },
    lore: {
      l_port: { id: 'l_port', title: 'Founding', text: LONG, entityRefs: ['port', 'plc_inn'] },
      l_inn: { id: 'l_inn', title: 'The ale', text: LONG, entityRefs: ['plc_inn', 'chr_mara'] },
      l_tom: { id: 'l_tom', title: 'Tom', text: LONG, entityRefs: ['chr_tom', 'plc_inn'] },
      l_realm: { id: 'l_realm', title: 'Crowns', text: LONG, entityRefs: ['fac_1'] },
      l_reg: { id: 'l_reg', title: 'Fields', text: LONG, entityRefs: ['reg_1'] },
      l_reg2: { id: 'l_reg2', title: 'Hills', text: LONG, entityRefs: ['reg_1', 'fac_1'] },
    },
    factions: {
      fac_1: { id: 'fac_1', name: 'Kingdom', description: words(80), sources: WRITTEN },
    },
    regions: {
      reg_1: {
        id: 'reg_1',
        name: 'County',
        factionId: 'fac_1',
        description: words(80),
        sources: WRITTEN,
      },
    },
    ...overrides,
  };
}

const without = (w, collection, id, patch) => ({
  ...w,
  [collection]: { ...w[collection], [id]: { ...w[collection][id], ...patch } },
});

describe('the registry', () => {
  test('every criterion has an id, kinds, a weight from the table, a need and a tool', () => {
    const ids = new Set();
    for (const c of CRITERIA) {
      expect(c).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          kinds: expect.any(Array),
          weight: expect.any(Number),
          feature: expect.any(String),
          label: expect.any(String),
          need: expect.any(String),
          tool: expect.any(String),
          check: expect.any(Function),
        })
      );
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      const [table, key] = c.id.split('.');
      expect(c.weight).toBe(WEIGHTS[table][key]);
    }
    expect(RUBRIC_VERSION).toBe(9);
  });

  test('the weights in the table are the criteria’s, kind by kind', () => {
    for (const [table, weights] of Object.entries(WEIGHTS)) {
      const ofTable = CRITERIA.filter((c) => c.id.startsWith(table + '.'));
      expect(Object.fromEntries(ofTable.map((c) => [c.id.split('.')[1], c.weight]))).toEqual(
        weights
      );
    }
  });
});

describe('settlement criteria', () => {
  const port = (w) => w.locations.port;

  test('residents for its size: partial progress', () => {
    const w = world();
    // A village of 500 wants 2: Mara and Tom, at the inn.
    expect(check('settlement.residents', w, port(w))).toEqual({ progress: 1 });
    const one = without(w, 'characters', 'chr_tom', { retired: true });
    expect(check('settlement.residents', one, port(one))).toEqual({
      progress: 0.5,
      have: 1,
      want: 2,
      message: 'A village needs 2 residents (it has 1).',
    });
    // A capital counts one size up: a town wants 4.
    const capital = { ...port(w), geo: { ...port(w).geo, capital: true } };
    expect(check('settlement.residents', w, capital)).toMatchObject({
      progress: 0.5,
      want: 4,
    });
  });

  test('lore for its size counts only long entries, and fully only with variety', () => {
    const w = world();
    // Three entries touch the port, the inn, Mara and Tom: varied, and 2 wanted.
    expect(check('settlement.lore', w, port(w))).toEqual({ progress: 1 });
    // Short lore doesn't count.
    const short = world({
      lore: { l: { id: 'l', title: 'F', text: SHORT, entityRefs: ['port'] } },
    });
    expect(check('settlement.lore', short, port(short))).toMatchObject({ progress: 0, have: 0 });
    // Two long entries, both only about the port: half, for want of variety.
    const same = world({
      lore: {
        a: { id: 'a', title: 'A', text: LONG, entityRefs: ['port'] },
        b: { id: 'b', title: 'B', text: LONG, entityRefs: ['port'] },
      },
    });
    expect(check('settlement.lore', same, port(same))).toEqual({
      progress: 0.5,
      have: 2,
      want: 2,
      message: 'Its lore is all about one thing: write some about its places or people.',
    });
    const oneOnly = world({ lore: { a: same.lore.a } });
    expect(check('settlement.lore', oneOnly, port(oneOnly))).toMatchObject({
      progress: 0.25,
      have: 1,
    });
  });

  test('town art, ground, a long description and lore that links', () => {
    const w = world();
    for (const id of [
      'settlement.townArt',
      'settlement.ground',
      'settlement.description',
      'settlement.loreLinks',
    ]) {
      expect(check(id, w, port(w))).toEqual({ progress: 1 });
    }
    const bare = {
      ...port(w),
      description: words(59),
      town: {},
    };
    expect(check('settlement.townArt', w, bare)).toMatchObject({
      progress: 0,
      message: 'Its town has no art.',
    });
    expect(check('settlement.ground', w, bare)).toMatchObject({
      progress: 0,
      message: 'Its town has no ground yet.',
    });
    expect(check('settlement.description', w, bare)).toEqual({
      progress: 0,
      have: 59,
      want: 60,
      message: 'Its description needs at least 60 words (it has 59).',
    });
    // A long imported description doesn't count either.
    const imported = { ...port(w), sources: { description: 'import' } };
    expect(check('settlement.description', w, imported).progress).toBe(0);
    const lonely = world({
      lore: { a: { id: 'a', title: 'A', text: LONG, entityRefs: ['port'] } },
    });
    expect(check('settlement.loreLinks', lonely, port(lonely))).toMatchObject({
      progress: 0,
      message: 'No lore about it names two or more places or people.',
    });
  });
});

describe('point of interest and place criteria', () => {
  test('its own map with walls; half without; none for a generic one', () => {
    const w = world();
    expect(check('place.ownMap', w, w.places.plc_inn, 'place')).toEqual({ progress: 1 });
    const bare = without(w, 'battleMaps', 'bm_inn', { walls: [] });
    expect(check('place.ownMap', bare, bare.places.plc_inn, 'place')).toMatchObject({
      progress: 0.5,
      need: 'layers',
    });
    const generic = without(w, 'battleMaps', 'bm_inn', { generic: { kind: 'tavern' } });
    expect(check('place.ownMap', generic, generic.places.plc_inn, 'place')).toEqual({
      progress: 0,
      message: 'It uses a generic battle map.',
    });
  });

  test('art on its own map', () => {
    const w = world();
    expect(check('place.mapArt', w, w.places.plc_inn, 'place')).toEqual({ progress: 1 });
    const plain = without(w, 'battleMaps', 'bm_inn', { image: null });
    expect(check('place.mapArt', plain, plain.places.plc_inn, 'place')).toMatchObject({
      progress: 0,
      message: 'Its battle map has no art.',
    });
    const generic = without(w, 'battleMaps', 'bm_inn', { generic: { kind: 'tavern' } });
    expect(check('place.mapArt', generic, generic.places.plc_inn, 'place').progress).toBe(0);
  });

  test('people there and lore about it: two of each, partial', () => {
    const w = world();
    expect(check('place.someone', w, w.places.plc_inn, 'place')).toEqual({ progress: 1 });
    expect(check('place.lore', w, w.places.plc_inn, 'place')).toEqual({ progress: 1 });
    const one = without(w, 'characters', 'chr_tom', { retired: true });
    const alone = { ...one.places.plc_inn, npcIds: ['chr_mara'] };
    expect(check('place.someone', one, alone, 'place')).toMatchObject({
      progress: 0.5,
      have: 1,
      want: QUALITY.placePeople,
    });
    // A point of interest: people whose home it is.
    expect(check('place.someone', w, w.locations.ruin, 'poi')).toMatchObject({
      progress: 0,
      message: 'Nobody is found here.',
    });
    // Three entries name the inn; with two retired, one is left.
    const fewer = without(without(w, 'lore', 'l_tom', { retired: true }), 'lore', 'l_inn', {
      retired: true,
    });
    expect(check('place.lore', fewer, fewer.places.plc_inn, 'place')).toMatchObject({
      progress: 0.5,
      have: 1,
      want: QUALITY.placeLore,
    });
  });

  test('a long enough description', () => {
    const w = world();
    expect(check('place.description', w, w.places.plc_inn, 'place')).toEqual({
      progress: 1,
      tool: 'update_place',
    });
    const short = { ...w.places.plc_inn, description: words(10) };
    expect(check('place.description', w, short, 'place')).toMatchObject({
      progress: 0,
      have: 10,
      want: QUALITY.words.place,
    });
  });
});

describe('character, battle map, realm and world criteria', () => {
  test('a character: a long description, lore about them, a realm, a sheet', () => {
    const w = world();
    const mara = { ...w.characters.chr_mara, sheet: SHEET };
    expect(gradeCharacter(w, mara)).toMatchObject({ score: 100, band: 'legendary' });
    // A sheet for the world's rules (L-813): none, or one they no longer fit.
    const bare = { ...mara };
    delete bare.sheet;
    expect(gradeCharacter(w, bare)).toMatchObject({ score: 71.4, band: 'vivid' });
    expect(check('character.sheet', w, bare)).toMatchObject({
      progress: 0,
      message: 'They have no sheet; give them one with set_sheet.',
    });
    const misfit = { ...mara, sheet: { ...SHEET, level: 0 } };
    expect(check('character.sheet', w, misfit)).toMatchObject({
      progress: 0,
      message:
        'Their sheet no longer fits the world’s rules: The level is 0; it must be from 1 to 20.',
    });
    const thin = { ...mara, description: words(39), factionId: 'fac_gone' };
    expect(check('character.description', w, thin)).toMatchObject({ progress: 0, have: 39 });
    expect(check('character.faction', w, thin)).toMatchObject({
      progress: 0,
      message: 'They belong to no realm.',
    });
    expect(check('character.lore', w, { ...mara, id: 'chr_nobody' })).toMatchObject({
      progress: 0,
    });
  });

  test('a battle map: walls, art, features and exits', () => {
    const w = world();
    expect(gradeBattleMap(w, MAP)).toMatchObject({ score: 100 });
    const bare = { ...MAP, walls: [], image: null, features: [MAP.features[0]], exits: [] };
    expect(check('battleMap.layers', w, bare).progress).toBe(0);
    expect(check('battleMap.art', w, bare).progress).toBe(0);
    expect(check('battleMap.features', w, bare)).toMatchObject({ progress: 0.5, have: 1 });
    expect(check('battleMap.exits', w, bare).progress).toBe(0);
    expect(gradeBattleMap(w, bare).score).toBe(
      Math.round((WEIGHTS.battleMap.features / 2 / 100) * 1000) / 10
    );
  });

  test('a realm and a region: a description, lore and people for their size', () => {
    const w = world();
    expect(check('realm.description', w, w.factions.fac_1, 'realm')).toEqual({ progress: 1 });
    expect(check('realm.lore', w, w.factions.fac_1, 'realm')).toEqual({ progress: 1 });
    expect(check('realm.people', w, w.factions.fac_1, 'realm')).toEqual({ progress: 1 });
    // The region's people are those living in its settlements.
    expect(check('realm.people', w, w.regions.reg_1, 'region')).toEqual({ progress: 1 });
    expect(check('realm.description', w, w.regions.reg_1, 'region')).toEqual({
      progress: 1,
      tool: 'update_region',
    });
    // A realm of 25 settlements or more wants two of each.
    const many = Object.fromEntries(
      Array.from({ length: QUALITY.realmPer }, (_, i) => [
        `s${i}`,
        { id: `s${i}`, name: `S${i}`, factionIds: ['fac_1'], geo: { kind: 'settlement' } },
      ])
    );
    const big = world({ locations: { ...world().locations, ...many } });
    expect(check('realm.lore', big, big.factions.fac_1, 'realm')).toEqual({ progress: 1 });
    const fewLore = { ...big, lore: { l_realm: big.lore.l_realm } };
    expect(check('realm.lore', fewLore, big.factions.fac_1, 'realm')).toMatchObject({
      progress: 0.5,
      have: 1,
      want: 2,
    });
  });

  test('the world: a game system, set and passing its checks (L-801)', () => {
    const { BUILT_IN } = require('../functions/loom-canon/systems');
    const fantasy = BUILT_IN['d20-fantasy'];
    const w = world();
    // None named: it plays by the built-in, but hasn't chosen.
    const unset = { ...w, systemId: null, system: fantasy };
    expect(check('world.system', unset, unset)).toMatchObject({
      progress: 0,
      message: expect.stringMatching(/no game system/),
    });
    const set = { ...w, systemId: 'pirate-d20', system: { ...fantasy, id: 'pirate-d20' } };
    expect(check('world.system', set, set)).toEqual({ progress: 1 });
    const missing = { ...w, systemId: 'gone', system: null };
    expect(check('world.system', missing, missing)).toMatchObject({
      progress: 0,
      message: 'It names the game system "gone", which doesn\'t exist.',
    });
    const broken = { ...set, system: { ...set.system, checks: { formula: 'd20', ladder: [] } } };
    expect(check('world.system', broken, broken)).toMatchObject({
      progress: 0,
      message: expect.stringMatching(/^Its game system fails its checks: checks\.ladder/),
    });
    expect(criterion('world.system')).toMatchObject({ weight: 15, tool: 'update_world' });
  });

  test('the world: map art, world-wide lore, its hook and tagline, and a cover', () => {
    const w = world();
    expect(check('world.mapArt', w, w)).toEqual({ progress: 1 });
    expect(check('world.cover', w, w)).toEqual({ progress: 1 });
    expect(check('world.cover', { ...w, cover: null }, w)).toMatchObject({
      progress: 0,
      message: 'The world has no cover image for the Loom’s world list.',
    });
    // Map art from the library (L-704) counts as an older path does.
    const libraryMap = { ...w, map: { image: { imageId: 'img_00000000000000a0', link: 'x' } } };
    expect(check('world.mapArt', libraryMap, libraryMap)).toEqual({ progress: 1 });
    expect(check('world.lore', w, w)).toEqual({ progress: 1 });
    expect(check('world.hook', w, w)).toEqual({ progress: 1 });
    const bare = world({ map: null, tagline: '', lore: {} });
    expect(check('world.mapArt', bare, bare).progress).toBe(0);
    expect(check('world.lore', bare, bare)).toMatchObject({ progress: 0, want: 3 });
    expect(check('world.hook', bare, bare)).toMatchObject({
      progress: 0.5,
      message: 'It has no tagline.',
    });
  });
});

describe('scores and rollups', () => {
  test('an entity’s own score is its met weight over its total weight', () => {
    const w = world();
    const port = without(w, 'locations', 'port', {
      town: { ground: w.locations.port.town.ground },
    });
    const graded = gradeLocation(port, port.locations.port, { layers });
    const total = Object.values(WEIGHTS.settlement).reduce((a, b) => a + b, 0);
    expect(graded.ownScore).toBe(
      Math.round(((total - WEIGHTS.settlement.townArt) / total) * 1000) / 10
    );
    expect(graded.checklist).toEqual([
      expect.objectContaining({
        need: 'townArt',
        for: 'score',
        criterion: 'settlement.townArt',
        weight: WEIGHTS.settlement.townArt,
        gain: WEIGHTS.settlement.townArt,
      }),
    ]);
  });

  test('a settlement: 60% its own, 40% its town’s places and its people', () => {
    const w = world();
    const g = gradeLocation(w, w.locations.port, { layers });
    const inside = [
      gradePlace(w, w.places.plc_inn).score,
      gradeCharacter(w, w.characters.chr_mara).score,
      gradeCharacter(w, w.characters.chr_tom).score,
    ];
    const mean = inside.reduce((a, b) => a + b, 0) / inside.length;
    expect(g.score).toBeCloseTo(0.6 * g.ownScore + 0.4 * mean, 1);
  });

  test('a place: 70% its own, 30% its battle map and the people there', () => {
    const w = world();
    const thin = without(w, 'characters', 'chr_tom', { description: words(5) });
    const g = gradePlace(thin, thin.places.plc_inn);
    const inside = [
      gradeBattleMap(thin, MAP).score,
      gradeCharacter(thin, thin.characters.chr_mara).score,
      gradeCharacter(thin, thin.characters.chr_tom).score,
    ];
    const mean = inside.reduce((a, b) => a + b, 0) / inside.length;
    expect(g.score).toBeCloseTo(0.7 * g.ownScore + 0.3 * mean, 1);
    // A point of interest the same way: with nobody there, only its map.
    const ruin = gradeLocation(w, w.locations.ruin);
    expect(ruin.score).toBeCloseTo(0.7 * ruin.ownScore + 0.3 * 100, 1);
  });

  test('a realm: 70% its own, 30% its regions; a region scores only itself', () => {
    const w = world();
    const region = gradeEntity(w, 'region', w.regions.reg_1);
    const realm = gradeEntity(w, 'faction', w.factions.fac_1);
    expect(region.score).toBe(region.ownScore);
    expect(realm.score).toBeCloseTo(0.7 * realm.ownScore + 0.3 * region.score, 1);
    const weak = without(w, 'regions', 'reg_1', { description: '' });
    expect(gradeEntity(weak, 'faction', weak.factions.fac_1).score).toBeLessThan(realm.score);
  });

  test('a place below Playable scores 0 wherever it is averaged', () => {
    const w = world();
    const closed = without(w, 'places', 'plc_inn', { sources: { description: 'import' } });
    expect(gradePlace(closed, closed.places.plc_inn)).toMatchObject({
      grade: 'stub',
      band: 'stub',
      score: 0,
    });
    // The port's town now averages a 0 for its inn.
    expect(gradeLocation(closed, closed.locations.port, { layers }).score).toBeLessThan(
      gradeLocation(w, w.locations.port, { layers }).score
    );
  });

  test('bands: Playable under 40, Rich from 40, Vivid from 70, Legendary from 90', () => {
    expect(bandOf(0)).toBe('playable');
    expect(bandOf(39.9)).toBe('playable');
    expect(bandOf(40)).toBe('rich');
    expect(bandOf(69.9)).toBe('rich');
    expect(bandOf(70)).toBe('vivid');
    expect(bandOf(89.9)).toBe('vivid');
    expect(bandOf(90)).toBe('legendary');
    expect(bandOf(100)).toBe('legendary');
  });
});

describe('the world’s score', () => {
  test('places weigh by nearness to play: 3, then 1 within two steps, then 0.25', () => {
    const chain = {};
    // start (open) – a (frontier) – b – c – d
    const ids = ['start', 'a', 'b', 'c', 'd'];
    ids.forEach((id, i) => {
      chain[id] = {
        id,
        name: id,
        connections: [ids[i - 1], ids[i + 1]].filter(Boolean),
        geo: { kind: 'poi' },
      };
    });
    const w = { status: 'published', rules: { startingLocationId: 'start' }, locations: chain };
    const grades = new Map(ids.map((id) => [id, { grade: id === 'start' ? 'playable' : 'stub' }]));
    expect(Object.fromEntries(placeWeights(w, grades))).toEqual({
      start: 3,
      a: 3,
      b: 1,
      c: 1,
      d: 0.25,
    });
  });

  test('80% its places, weighted, and 20% its own criteria', () => {
    const w = world();
    const summary = gradeWorld(w);
    const weights = placeWeights(
      w,
      new Map(Object.values(w.locations).map((l) => [l.id, gradeLocation(w, l)]))
    );
    let sum = 0;
    let weighed = 0;
    for (const l of Object.values(w.locations)) {
      sum += weights.get(l.id) * gradeLocation(w, l).score;
      weighed += weights.get(l.id);
    }
    expect(summary.placesScore).toBeCloseTo(sum / weighed, 1);
    expect(summary.ownScore).toBe(100);
    expect(summary.score).toBeCloseTo(0.8 * (sum / weighed) + 0.2 * 100, 1);
    expect(summary.band).toBe(bandOf(summary.score));
    // Far, imported, is a closed frontier place: it weighs 3 and scores 0.
    expect(weights.get('far')).toBe(3);
  });
});

// ── Calibration: a copy of Nisia's built places (L-691) ───────────────────
// tests/fixtures/nisia-built.json holds what was built in Nisia when rubric
// 4 was tuned: its twelve written-up towns, their places, maps, people and
// lore, as counts (words, walls, features), read over MCP. Every one of its
// settlements, and the places marked rubric2Rich, met rubric 2's Rich bar.

// `sheets`: Nisia's people with their sheets (L-813, rubric 7), as a built
// Nisia has them; without, as it was built before sheets.
function nisia({ sheets = true } = {}) {
  const many = (n, make) => Array.from({ length: n || 0 }, (_, i) => make(i));
  const w = {
    id: 'nisia',
    status: 'published',
    tagline: NISIA.world.tagline ? 'Explore' : '',
    openingHook: NISIA.world.openingHook ? 'Out your door.' : '',
    map: { hasImage: NISIA.world.mapHasImage },
    rules: { startingLocationId: NISIA.world.startingLocationId },
    locations: {},
    places: {},
    battleMaps: {},
    characters: {},
    lore: {},
    factions: {},
    regions: {},
  };
  for (const s of NISIA.settlements) {
    w.locations[s.id] = {
      id: s.id,
      name: s.name,
      description: words(s.descriptionWords),
      sources: WRITTEN,
      connections: s.connections,
      factionIds: [s.factionId],
      npcIds: s.npcIds,
      geo: {
        kind: 'settlement',
        population: s.population,
        capital: s.capital,
        regionId: s.regionId,
      },
      town: {
        ...(s.hasGround ? { ground: { buildings: [{ points: SQUARE }] } } : {}),
        ...(s.hasTownArt ? { image: { path: 'art' } } : {}),
      },
    };
    w.factions[s.factionId] = { id: s.factionId, name: s.factionId };
    w.regions[s.regionId] = { id: s.regionId, name: s.regionId, factionId: s.factionId };
  }
  for (const p of NISIA.places) {
    w.places[p.id] = {
      id: p.id,
      name: p.name,
      locationId: p.locationId,
      description: words(p.descriptionWords),
      sources: WRITTEN,
      npcIds: p.npcIds,
      connections: [],
      ...(p.mapId ? { battleMap: { mapId: p.mapId } } : {}),
    };
  }
  for (const [id, m] of Object.entries(NISIA.battleMaps)) {
    w.battleMaps[id] = {
      id,
      width: m.width,
      height: m.height,
      image: m.hasImage ? { path: 'art', width: m.width, height: m.height } : null,
      walls: many(m.walls, () => ({ points: [] })),
      doors: many(m.doors, () => ({})),
      obstacles: many(m.obstacles, () => ({})),
      features: many(m.features, (i) => ({ id: `f${i}` })),
      exits: many(m.exits, (i) => ({ id: `e${i}` })),
      entries: many(m.entries, (i) => ({ id: `n${i}` })),
      generic: m.generic ? { kind: 'generic' } : null,
    };
  }
  for (const c of NISIA.characters) {
    w.characters[c.id] = {
      ...c,
      description: words(c.descriptionWords),
      ...(sheets ? { sheet: SHEET } : {}),
    };
  }
  for (const l of NISIA.lore) {
    w.lore[l.id] = { id: l.id, title: l.id, text: words(l.words), entityRefs: l.entityRefs };
  }
  return w;
}

describe('calibrated on Nisia', () => {
  const w = nisia();

  test('the gate is unchanged: every place open under rubric 3 is open still', () => {
    for (const location of Object.values(w.locations)) {
      expect(isPlayable(w, location, { layers })).toBe(true);
    }
    for (const place of Object.values(w.places)) {
      expect(isPlaceOpen(w, place, { layers })).toBe(true);
    }
  });

  test('settlements that met rubric 2’s Rich bar score Rich (40–69)', () => {
    const scores = NISIA.settlements
      .filter((s) => s.rubric2Rich)
      .map((s) => [s.name, gradeLocation(w, w.locations[s.id], { layers })]);
    expect(scores).toHaveLength(12);
    for (const [name, graded] of scores) {
      expect({ name, band: graded.band }).toEqual({ name, band: 'rich' });
    }
  });

  test('its people’s sheets count: without them, every town scores lower (rubric 7)', () => {
    const bare = nisia({ sheets: false });
    for (const s of NISIA.settlements.filter((x) => x.rubric2Rich)) {
      const withSheets = gradeLocation(w, w.locations[s.id], { layers }).score;
      const without = gradeLocation(bare, bare.locations[s.id], { layers }).score;
      expect([s.name, without < withSheets]).toEqual([s.name, true]);
    }
  });

  test('places that met it score Rich too, and what Vivid needs shows', () => {
    const rich = NISIA.places.filter((p) => p.rubric2Rich);
    expect(rich.length).toBeGreaterThan(0);
    for (const p of rich) {
      const graded = gradePlace(w, w.places[p.id], { layers });
      expect({ name: p.name, band: graded.band }).toEqual({ name: p.name, band: 'rich' });
      // Lore about it is what each lacks most.
      expect(graded.checklist[0]).toMatchObject({ criterion: 'place.lore' });
    }
  });

  test('places that didn’t meet it score lower', () => {
    const below = NISIA.places
      .filter((p) => !p.rubric2Rich)
      .map((p) => gradePlace(w, w.places[p.id], { layers }).score);
    const above = NISIA.places
      .filter((p) => p.rubric2Rich)
      .map((p) => gradePlace(w, w.places[p.id], { layers }).score);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(below)).toBeLessThan(mean(above) - 20);
  });
});
