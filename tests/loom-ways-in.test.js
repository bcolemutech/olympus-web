'use strict';

/**
 * Visits and the way in (planning/journeys-and-arrivals.md §4.1, §4.2; L-381 /
 * #700): a traveller arrives by the way in facing where they came from; in a
 * town with ground they know only the ways in and out they arrived by, stood
 * in or crossed by (or sighted); they leave only by a way out they know; and
 * a save from before keeps knowing what it knew. Pure.
 *
 * Run: cd tests && npx jest loom-ways-in --verbose
 */

const town = require('../functions/loom-canon/town');
const { foundIn } = require('../functions/loom-turn/town-found');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const visits = require('../functions/loom-turn/visits');

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];

// Hatham, with ground: a west gate and an east gate for the roads, a harbour
// to the south for the sea, and a market in the middle. Bridgeford lies east
// by road, Westmere west by road, Keton south by sea.
const settlement = (id, x, y, links, extra = {}) => ({
  id,
  name: id.charAt(0).toUpperCase() + id.slice(1),
  description: 'A town.',
  geo: { kind: 'settlement', x, y, links },
  connections: Object.keys(links),
  ...extra,
});
const place = (id, name, position, entrance = null) => ({
  id,
  locationId: 'hatham',
  name,
  kind: entrance ? 'gate' : 'district',
  description: name + '.',
  connections: [],
  npcIds: [],
  rules: {},
  entrance,
  position,
});
const WORLD = {
  id: 'w',
  locations: {
    hatham: settlement(
      'hatham',
      500,
      500,
      { bridgeford: 'road', westmere: 'road', keton: 'sea' },
      { town: { ground: { buildings: [{ name: 'a shed', points: rect(10, 10, 40, 40) }] } } }
    ),
    bridgeford: settlement('bridgeford', 700, 510, { hatham: 'road' }),
    westmere: settlement('westmere', 300, 480, { hatham: 'road' }),
    keton: settlement('keton', 520, 800, { hatham: 'sea' }),
  },
  places: {
    west: place('west', 'The West Gate', pt(40, 500), { via: ['road'] }),
    east: place('east', 'The East Gate', pt(960, 520), { via: ['road'] }),
    harbour: place('harbour', 'The Harbour', pt(500, 970), { via: ['sea'] }),
    market: place('market', 'The Market', pt(500, 500)),
  },
  factions: {},
  characters: {},
  battleMaps: {},
};

describe('arriving by the most direct way in', () => {
  test('by road from the east, the east gate; from the west, the west gate', () => {
    expect(town.arrivalPlace(WORLD, 'hatham', 'road', 'bridgeford').id).toBe('east');
    expect(town.arrivalPlace(WORLD, 'hatham', 'road', 'westmere').id).toBe('west');
  });

  test('by sea, the harbour, the only way serving the route', () => {
    expect(town.arrivalPlace(WORLD, 'hatham', 'sea', 'keton').id).toBe('harbour');
  });

  test('with nowhere to come from, the first serving the route, as before', () => {
    expect(town.arrivalPlace(WORLD, 'hatham', 'road').id).toBe('east');
    expect(town.arrivalPlace(WORLD, 'hatham', null).id).toBe('east');
  });
});

describe('knowing the ways in and out', () => {
  const at = (extra) => ({ location: 'hatham', placeId: 'market', ...extra });

  test('a save from before L-381 knows them all', () => {
    expect([...foundIn(WORLD, at({}), null)].sort()).toEqual(
      ['east', 'harbour', 'market', 'west'].sort()
    );
  });

  test('a new arrival knows only the way it came by, and where it stands', () => {
    const found = foundIn(WORLD, at({ waysKnown: { hatham: ['west'] } }), null);
    expect([...found].sort()).toEqual(['market', 'west']);
  });

  test("standing in a way in counts; 'all' knows every one", () => {
    expect(foundIn(WORLD, at({ placeId: 'harbour', waysKnown: {} }), null).has('harbour')).toBe(
      true
    );
    expect(foundIn(WORLD, at({ waysKnown: { hatham: 'all' } }), null).size).toBe(4);
  });
});

describe('leaving by a way out you know', () => {
  const save = (known) => ({
    location: 'hatham',
    placeId: 'market',
    waysKnown: { hatham: known },
    character: { name: 'Tam', inventory: [] },
  });
  const leave = (known, to) => {
    const s = save(known);
    return evaluate(
      { verb: 'move', targets: [to], params: {} },
      {},
      s,
      10,
      WORLD,
      null,
      foundIn(WORLD, s, null)
    );
  };

  test('none known serving the route: refused, explore to find one', () => {
    expect(leave(['west'], 'keton')).toMatchObject({
      outcome: 'blocked',
      constraints: ['You know no way out of Hatham by sea. Explore to find one.'],
    });
  });

  test('one known serving it: the walk out goes there', () => {
    const r = leave(['west', 'harbour'], 'keton');
    expect(r.outcome).not.toBe('blocked');
    expect(r.constraints.join(' ')).toContain('The Harbour');
  });
});

describe('visits', () => {
  test('a save from before: where it was and the towns it has records of, all their ways known', () => {
    expect(visits.derived('hatham', ['keton', 'hatham'])).toEqual({
      visited: ['hatham', 'keton'],
      waysKnown: { hatham: 'all', keton: 'all' },
    });
  });

  test('arriving notes the settlement as visited and the way in as known', () => {
    const s = { location: 'hatham', placeId: 'east', visited: ['keton'], waysKnown: {} };
    visits.noteWhereItIs(WORLD, s);
    expect(s.visited).toEqual(['keton', 'hatham']);
    expect(s.waysKnown).toEqual({ hatham: ['east'] });
    // Not a way in: nothing more known.
    visits.noteWhereItIs(WORLD, { ...s, placeId: 'market' });
    expect(s.waysKnown).toEqual({ hatham: ['east'] });
    // A town known whole stays so.
    const old = { location: 'hatham', placeId: 'east', visited: [], waysKnown: { hatham: 'all' } };
    visits.noteWhereItIs(WORLD, old);
    expect(old.waysKnown).toEqual({ hatham: 'all' });
  });
});
