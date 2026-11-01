'use strict';

/**
 * Grading at any depth (planning/map-levels.md §4.8; the-loom-grading.md;
 * L-905 / #723), pure: every map graded by its kind with today's criteria (a
 * region map as the world map, an area map as its settlement's town, a grid
 * as a battle map), and a world's score rolling up its tree, weighted toward
 * the maps players reach. A world with no maps below its top scores as
 * before.
 *
 * Run: cd tests && npx jest loom-levels-grading --verbose
 */

const grading = require('../functions/loom-canon/grading');
const { andorWorld } = require('./fixtures/andor-world');

// A description long enough to count (60 words and more).
const LONG = Array.from({ length: 80 }, (_, i) => 'word' + i).join(' ') + '.';
const written = (name, words = 4) => ({
  description: (name + ' ').repeat(words).trim() + '.',
  sources: { description: 'mcp' },
});

test('each kind graded by its criteria, as a tree', () => {
  const tree = grading.gradeMaps(andorWorld());
  const at = (path) =>
    path.reduce((node, name) => node.children.find((c) => c.name === name), tree);
  expect(tree).toMatchObject({ mapId: 'sector', kind: 'region' });
  // A region map: open when a place on it is; its closed places are what it lacks.
  expect(tree.grade).toBe('playable');
  expect(tree.lacks.join(' ')).toMatch(/Deneb/);
  const vega = at(['Vega']);
  expect(vega.kind).toBe('region');
  expect(vega.lacks.join(' ')).toMatch(/The Outpost/);
  // An area map: graded as its settlement's town.
  const station = at(['Vega', 'Vega Station']);
  expect(station.kind).toBe('area');
  expect(station.grade).toBe('playable');
  // A grid: as a battle map, its own criteria (art, layers, features…).
  const deck = at(['Vega', 'Vega Station', 'The deck']);
  expect(deck.kind).toBe('grid');
  const asBattleMap = grading.gradeBattleMap(andorWorld(), {
    id: 'deck',
    name: 'The deck',
    width: 12,
    height: 8,
    entries: [{ id: 'e1', x: 1, y: 4 }],
    exits: [{ id: 'x1', name: 'The airlock door', x: 0, y: 4 }],
  });
  expect(deck.score).toBe(asBattleMap.score);
  // Sol: a region map whose places are open.
  expect(at(['Sol']).grade).toBe('playable');
});

describe('the roll-up', () => {
  // A sector: Home (the start), Near linked to it, Far closed and linked to
  // nothing. Near and Far each open a region map with one place in it.
  function world({ nearGood, farGood }) {
    const mapPlace = (mapId, name, at, extra = {}) => ({
      mapId,
      name,
      at,
      ...written(name),
      ...extra,
    });
    // A written place in it, or an unwritten one (closed: it scores nothing).
    const inner = (good) => ({
      ...(good ? { description: LONG, sources: { description: 'mcp' } } : {}),
      kind: 'station',
      entrance: true,
    });
    return {
      id: 'w',
      name: 'W',
      status: 'published',
      rules: { startingLocationId: 'home' },
      topMapId: 'sector',
      maps: {
        sector: {
          kind: 'region',
          parent: null,
          name: 'Sector',
          space: { width: 100, height: 100 },
        },
        near_map: {
          kind: 'region',
          parent: { mapId: 'sector', placeId: 'near' },
          name: 'Near system',
          space: { width: 100, height: 100 },
        },
        far_map: {
          kind: 'region',
          parent: { mapId: 'sector', placeId: 'far' },
          name: 'Far system',
          space: { width: 100, height: 100 },
        },
      },
      mapPlaces: {
        home: mapPlace(
          'sector',
          'Home',
          { x: 10, y: 10 },
          { links: [{ placeId: 'near', kind: 'jump' }] }
        ),
        near: mapPlace('sector', 'Near', { x: 20, y: 10 }, { opens: { mapId: 'near_map' } }),
        // Far: closed (not written) and linked to nothing open, so players
        // don't reach it or what it opens.
        far: { mapId: 'sector', name: 'Far', at: { x: 90, y: 90 }, opens: { mapId: 'far_map' } },
        near_in: { mapId: 'near_map', at: { x: 50, y: 50 }, name: 'Near in', ...inner(nearGood) },
        far_in: { mapId: 'far_map', at: { x: 50, y: 50 }, name: 'Far in', ...inner(farGood) },
      },
      locations: {},
      places: {},
      battleMaps: {},
      factions: {},
      characters: {},
      lore: {},
      regions: {},
    };
  }
  const score = (w) => grading.gradeWorld(w).placesScore;

  test('a map players reach counts for more than one they don’t', () => {
    const base = score(world({ nearGood: false, farGood: false }));
    const nearBetter = score(world({ nearGood: true, farGood: false }));
    const farBetter = score(world({ nearGood: false, farGood: true }));
    expect(nearBetter).toBeGreaterThan(base);
    expect(farBetter).toBeGreaterThanOrEqual(base);
    expect(nearBetter - base).toBeGreaterThan(farBetter - base);
  });

  test('the world’s score is its top map’s, rolled up', () => {
    const w = world({ nearGood: true, farGood: true });
    expect(grading.gradeWorld(w).placesScore).toBe(grading.gradeMaps(w).score);
  });
});
