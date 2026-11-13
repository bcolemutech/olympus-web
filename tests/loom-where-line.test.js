'use strict';

/**
 * The WHERE line the GM is told every turn (L-716; planning/worlds-without-
 * azgaar.md §4.6), pure: the terrain, region and realm at the player's place
 * on the lowest region map of their path, with the first sentence of each
 * description; the place's own position inside a town or on a grid; none
 * where nothing is painted; a world's own terrain named by its own name.
 *
 * Mocks Gemini and retrieval as loom-narrate.test.js does; no emulator.
 * Run: cd tests && npx jest loom-where-line --verbose
 */

jest.mock('../functions/gemini', () => ({ callGemini: jest.fn() }));
jest.mock('../functions/loom-turn/retrieval', () => ({
  retrieveContextForEntities: jest.fn(),
}));

const realms = require('../functions/loom-canon/realms');
const frames = require('../functions/loom-canon/frames');
const { buildWhereSection, buildUserMessage } = require('../functions/loom-turn/narrate');

// A 1000 × 1000 region map: the ashwaste (the world's own terrain, which
// behaves as desert) over the east, hills under the rest, the Keld
// region and the Duchy of Keld over the east, a Barrens region with no realm
// over the west, and the south left bare.
function world() {
  return {
    id: 'w',
    topMapId: 'map_world',
    materials: [{ id: 'ashwaste', name: 'Ashwaste', like: 'desert' }],
    maps: {
      map_world: {
        kind: 'region',
        parent: null,
        name: 'The world',
        space: { width: 1000, height: 1000 },
        geometry: {
          ground: [
            { id: 'hills', material: 'hills', shape: { rect: { x: 0, y: 0, w: 1000, h: 800 } } },
            { id: 'ash', material: 'ashwaste', shape: { rect: { x: 500, y: 0, w: 500, h: 800 } } },
          ],
          zones: [
            { id: 'keld', region: 'reg_keld', shape: { rect: { x: 500, y: 0, w: 500, h: 800 } } },
            {
              id: 'barrens',
              region: 'reg_barrens',
              shape: { rect: { x: 0, y: 0, w: 500, h: 800 } },
            },
          ],
        },
      },
    },
    regions: {
      reg_keld: {
        id: 'reg_keld',
        name: 'The Cinder Reach',
        factionId: 'fac_keld',
        description: 'A scorched plain under a red sky. Few come back from it.',
      },
      reg_barrens: { id: 'reg_barrens', name: 'The Barrens' },
    },
    characters: {},
    places: {},
    factions: {
      fac_keld: {
        id: 'fac_keld',
        name: 'The Duchy of Keld',
        description: 'Ruled from a fortress at Keld   Hold!  Its taxes are heavy.',
      },
    },
    locations: {
      loc_keld: { id: 'loc_keld', name: 'Keld', geo: { x: 700, y: 300, kind: 'settlement' } },
      loc_hill: { id: 'loc_hill', name: 'Hillfoot', geo: { x: 100, y: 300, kind: 'settlement' } },
      loc_far: { id: 'loc_far', name: 'Southwatch', geo: { x: 100, y: 900, kind: 'tower' } },
    },
  };
}

// The world as the turn plays it: the frame on its region map.
function frame(w = world()) {
  return frames.viewFor(frames.playWorld(w), 'map_world');
}

const at = (location, more = {}) => ({
  location,
  placeId: null,
  mapId: null,
  cell: null,
  ...more,
});

describe('whereLine', () => {
  test('names the terrain, region and realm, with each description’s first sentence', () => {
    expect(realms.whereLine(world(), 'map_world', [700, 300])).toBe(
      'WHERE: terrain: Ashwaste; region: The Cinder Reach — A scorched plain under a red sky; ' +
        'realm: The Duchy of Keld — Ruled from a fortress at Keld Hold.'
    );
  });

  test('a world’s own terrain is named by its own name, not the material it behaves as', () => {
    const line = realms.whereLine(world(), 'map_world', [700, 300]);
    expect(line).toContain('terrain: Ashwaste');
    expect(line).not.toMatch(/desert/i);
  });

  test('leaves out what is not known there', () => {
    // Hills and a region, but no description and no realm.
    expect(realms.whereLine(world(), 'map_world', [100, 300])).toBe(
      'WHERE: terrain: Hills; region: The Barrens.'
    );
    // Hills only: the region is not set out here.
    const w = world();
    w.maps.map_world.geometry.zones = [];
    expect(realms.whereLine(w, 'map_world', [100, 300])).toBe('WHERE: terrain: Hills.');
  });

  test('is empty where nothing is painted', () => {
    expect(realms.whereLine(world(), 'map_world', [100, 900])).toBe('');
    const bare = world();
    delete bare.maps.map_world.geometry;
    expect(realms.whereLine(bare, 'map_world', [700, 300])).toBe('');
    expect(realms.whereLine(world(), 'map_nowhere', [700, 300])).toBe('');
    expect(realms.whereLine(world(), 'map_world', null)).toBe('');
  });

  test('says which place’s land it is when the player is inside it', () => {
    expect(realms.whereLine(world(), 'map_world', [700, 300], 'Keld')).toMatch(
      /^WHERE \(the land around Keld\): terrain: Ashwaste;/
    );
  });

  test('keeps a long first sentence short', () => {
    expect(realms.firstSentence('x'.repeat(300))).toHaveLength(200);
    expect(realms.firstSentence('  ')).toBe('');
    expect(realms.firstSentence(undefined)).toBe('');
    expect(realms.firstSentence('Is it? Yes.')).toBe('Is it');
  });
});

describe('the WHERE section of the turn', () => {
  test('on a region map, it is the land at the player’s place', () => {
    const view = frame();
    const line = buildWhereSection(view, at('loc_keld'), { location: 'loc_keld' });
    expect(line).toMatch(/^WHERE: terrain: Ashwaste; region: The Cinder Reach/);
  });

  test('in a town, it is the town’s own position on the map above', () => {
    const view = frame();
    const save = { location: 'loc_keld', townPoint: { x: 10, y: 10 } };
    expect(buildWhereSection(view, at('loc_keld', { placeId: 'pl_inn' }), save)).toMatch(
      /^WHERE \(the land around Keld\): terrain: Ashwaste; region: The Cinder Reach/
    );
    expect(buildWhereSection(view, at('loc_keld'), save)).toMatch(/the land around Keld/);
    // A move out of town onto the map is no longer inside it.
    expect(buildWhereSection(view, at('loc_hill'), save)).toBe(
      'WHERE: terrain: Hills; region: The Barrens.'
    );
  });

  test('on a grid, it is the place’s own position on the map above', () => {
    const view = frame();
    const line = buildWhereSection(
      view,
      at('loc_keld', { mapId: 'grid_keep', cell: { x: 1, y: 1 } }),
      { location: 'loc_keld' }
    );
    expect(line).toMatch(/^WHERE \(the land around Keld\): terrain: Ashwaste/);
  });

  test('there is none where nothing is painted, or off a place', () => {
    const view = frame();
    expect(buildWhereSection(view, at('loc_far'), { location: 'loc_far' })).toBeNull();
    expect(buildWhereSection(view, at(null), { location: null })).toBeNull();
    expect(buildWhereSection(view, at('loc_gone'), {})).toBeNull();
    const bare = world();
    delete bare.maps.map_world.geometry;
    expect(buildWhereSection(frame(bare), at('loc_keld'), {})).toBeNull();
  });

  test('is in the GM’s message every turn it exists, and absent otherwise', () => {
    const base = {
      actionText: 'look around',
      resolution: { outcome: 'success', constraints: [] },
      canonWorld: world(),
      entityContexts: [],
      recentSummary: '',
    };
    const where = 'WHERE: terrain: Ashwaste.';
    const withLine = buildUserMessage({ ...base, whereSection: where });
    expect(withLine).toContain(where);
    expect(withLine.indexOf(where)).toBeLessThan(withLine.indexOf('ROLLING SUMMARY'));
    expect(buildUserMessage(base)).not.toContain('WHERE');
  });
});

describe('narrateResolution', () => {
  test('tells the model the land the player stands in', async () => {
    const { callGemini } = require('../functions/gemini');
    const { retrieveContextForEntities } = require('../functions/loom-turn/retrieval');
    const { narrateResolution } = require('../functions/loom-turn/narrate');
    retrieveContextForEntities.mockResolvedValue([]);
    callGemini.mockResolvedValueOnce({ narration: 'Ash drifts.', inventedEntities: [] });
    await narrateResolution({
      actionText: 'look around',
      proposedAction: { verb: 'look' },
      resolution: { outcome: 'success', mutations: [], constraints: [] },
      canonWorld: frame(),
      save: { location: 'loc_keld', recentSummary: '' },
      saveRef: null,
    });
    const { userMessage } = callGemini.mock.calls[0][0];
    expect(userMessage).toContain('WHERE: terrain: Ashwaste; region: The Cinder Reach');
  });
});
