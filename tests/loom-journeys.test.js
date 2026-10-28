'use strict';

/**
 * Journeys (planning/journeys-and-arrivals.md §4.5; L-384 / #703): the
 * quickest path through settlements visited before, never through one the
 * save hasn't been to (JA1); the time summed, legs and crossings (JA3);
 * crossing a town finds the ways in and out used there (JA5); and with no
 * path, "No way you know leads there." Pure, under both built-in systems.
 *
 * Run: cd tests && npx jest loom-journeys --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const journeys = require('../functions/loom-canon/journeys');
const travel = require('../functions/loom-canon/travel');
const clock = require('../functions/loom-canon/clock');
const { evaluate } = require('../functions/loom-turn/adjudicate');

const pt = (x, y) => ({ x, y });

// West to east: Ashby, Brook, Carrow and Dunmere along the road, Brook a
// little south of the line; Fen, on it, is the shortcut from Ashby to Carrow. Keton lies off Dunmere by sea.
const settlement = (id, name, x, y, links) => ({
  id,
  name,
  description: 'A town.',
  geo: { kind: 'settlement', x, y, links },
  connections: Object.keys(links),
});
const gate = (locationId, id, name, position, via) => ({
  id,
  locationId,
  name,
  kind: 'gate',
  description: name + '.',
  connections: [],
  npcIds: [],
  rules: {},
  entrance: { via },
  position,
});

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('journeys under %s', (id, system) => {
  const WORLD = {
    id: 'w',
    system,
    locations: {
      ashby: settlement('ashby', 'Ashby', 100, 100, { brook: 'road', fen: 'road' }),
      brook: settlement('brook', 'Brook', 110, 104, { ashby: 'road', carrow: 'road' }),
      carrow: settlement('carrow', 'Carrow', 120, 100, {
        brook: 'road',
        fen: 'road',
        dunmere: 'road',
      }),
      fen: settlement('fen', 'Fen', 110, 100, { ashby: 'road', carrow: 'road' }),
      dunmere: settlement('dunmere', 'Dunmere', 130, 100, { carrow: 'road', keton: 'sea' }),
      keton: settlement('keton', 'Keton', 130, 120, { dunmere: 'sea' }),
    },
    places: {
      // Brook: a west gate and an east gate, the market between.
      b_west: gate('brook', 'b_west', 'The West Gate', pt(100, 500), ['road']),
      b_east: gate('brook', 'b_east', 'The East Gate', pt(900, 500), ['road']),
      // Carrow: likewise.
      c_west: gate('carrow', 'c_west', 'The West Gate', pt(100, 500), ['road']),
      c_east: gate('carrow', 'c_east', 'The East Gate', pt(900, 500), ['road']),
      // Dunmere: a west gate, and a quay for the sea.
      d_west: gate('dunmere', 'd_west', 'The West Gate', pt(100, 500), ['road']),
      d_quay: gate('dunmere', 'd_quay', 'The Quay', pt(500, 950), ['sea']),
      k_quay: gate('keton', 'k_quay', 'The Water Gate', pt(500, 50), ['sea']),
    },
    factions: {},
    characters: {},
    battleMaps: {},
  };
  const save = (visited, extra = {}) => ({
    location: 'ashby',
    visited,
    waysKnown: {},
    time: clock.START,
    character: { name: 'Tam', inventory: [] },
    ...extra,
  });

  test('the quickest path, only through settlements visited', () => {
    const all = ['ashby', 'brook', 'carrow', 'fen', 'dunmere'];
    // Through Fen is shorter than through Brook: taken when Fen is visited…
    expect(journeys.routeOf(WORLD, save(all), 'ashby', 'dunmere')).toEqual([
      'ashby',
      'fen',
      'carrow',
      'dunmere',
    ]);
    // …and never when it isn't.
    expect(
      journeys.routeOf(WORLD, save(['ashby', 'brook', 'carrow', 'dunmere']), 'ashby', 'dunmere')
    ).toEqual(['ashby', 'brook', 'carrow', 'dunmere']);
  });

  test('only to a settlement visited, and only by a path of them', () => {
    expect(journeys.routeOf(WORLD, save(['ashby', 'brook']), 'ashby', 'dunmere')).toBeNull();
    // Dunmere visited, but Carrow between not: no way known.
    expect(
      journeys.routeOf(WORLD, save(['ashby', 'brook', 'dunmere']), 'ashby', 'dunmere')
    ).toBeNull();
  });

  test('the time: each leg, plus the walk across each town between', () => {
    const s = save(['ashby', 'brook', 'carrow', 'dunmere', 'keton']);
    const j = journeys.journeyOf(WORLD, s, 'ashby', 'keton', clock.START);
    expect(j.stops).toEqual(['ashby', 'brook', 'carrow', 'dunmere', 'keton']);
    expect(j.through).toEqual(['Brook', 'Carrow', 'Dunmere']);
    expect(j.vias).toEqual(['road', 'sea']);
    let legs = 0;
    for (let i = 1; i < j.stops.length; i++) {
      legs += travel.trip(WORLD, j.stops[i - 1], j.stops[i], clock.START).seconds;
    }
    // Brook and Carrow are crossed west gate to east gate, Dunmere west gate
    // to quay: some minutes' walk each, on top of the legs.
    expect(j.seconds).toBeGreaterThan(legs);
    expect(j.seconds - legs).toBeLessThan(3 * clock.HOUR);
    expect(j.crossings.map((c) => [c.locationId, c.wayIn.id, c.wayOut.id])).toEqual([
      ['brook', 'b_west', 'b_east'],
      ['carrow', 'c_west', 'c_east'],
      ['dunmere', 'd_west', 'd_quay'],
    ]);
    expect(j.arrival.id).toBe('k_quay');
  });

  test('made: one move, the time and the lines, crossing finds the gates', () => {
    const s = save(['ashby', 'brook', 'carrow', 'dunmere', 'keton']);
    const r = evaluate({ verb: 'move', targets: ['keton'], params: {} }, {}, s, 10, WORLD);
    expect(r.outcome).toBe('success');
    const set = (path) => (r.mutations.find((m) => m.path === path) || {}).value;
    expect(set('location')).toBe('keton');
    expect(set('placeId')).toBe('k_quay');
    const j = journeys.journeyOf(WORLD, s, 'ashby', 'keton', clock.START);
    expect(set('time')).toBe(j.to);
    expect(r.constraints[r.constraints.length - 1]).toBe(
      'You journey ' +
        clock.duration(j.seconds) +
        ' by road and sea, through Brook, Carrow and Dunmere, and arrive at Keton, at The Water Gate.'
    );
    const found = r.mutations
      .filter((m) => m.op === 'add' && m.path.startsWith('waysKnown.'))
      .map((m) => m.path.slice(10) + ':' + m.value);
    expect(found).toEqual([
      'brook:b_west',
      'brook:b_east',
      'carrow:c_west',
      'carrow:c_east',
      'dunmere:d_west',
      'dunmere:d_quay',
    ]);
    expect(r.journey).toEqual({
      stops: ['ashby', 'brook', 'carrow', 'dunmere', 'keton'],
      through: ['Brook', 'Carrow', 'Dunmere'],
    });
  });

  test("a town known whole stays so; it isn't given its gates one by one", () => {
    const s = save(['ashby', 'brook', 'carrow', 'dunmere'], {
      waysKnown: { brook: 'all' },
    });
    const r = evaluate({ verb: 'move', targets: ['dunmere'], params: {} }, {}, s, 10, WORLD);
    expect(r.mutations.some((m) => m.path === 'waysKnown.brook')).toBe(false);
  });

  test('no path: "No way you know leads there."; never visited: as before', () => {
    const noPath = evaluate(
      { verb: 'move', targets: ['dunmere'], params: {} },
      {},
      save(['ashby', 'dunmere']),
      10,
      WORLD
    );
    expect(noPath).toMatchObject({
      outcome: 'blocked',
      constraints: ['No way you know leads there.'],
    });
    const never = evaluate(
      { verb: 'move', targets: ['dunmere'], params: {} },
      {},
      save(['ashby']),
      10,
      WORLD
    );
    expect(never.constraints).toEqual(["You can't get there directly from here."]);
  });

  test('the world map offers it: its time and the towns passed', () => {
    const { mapView } = require('../functions/loom-turn/map-view');
    const s = save(['ashby', 'brook', 'carrow', 'dunmere'], {
      discovered: ['ashby', 'brook', 'carrow', 'dunmere', 'fen'],
    });
    const view = mapView(WORLD, s, null, null);
    const row = (id) => view.places.find((p) => p.id === id);
    expect(row('carrow').journey).toMatchObject({ through: ['Brook'], vias: ['road'] });
    expect(row('dunmere').journey.through).toEqual(['Brook', 'Carrow']);
    // A neighbour: travelled to as ever. Not visited: nothing.
    expect(row('brook')).not.toHaveProperty('journey');
    expect(row('fen')).not.toHaveProperty('journey');
  });
});
