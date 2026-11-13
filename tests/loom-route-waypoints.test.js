'use strict';

/**
 * Routes with waypoints and rules (planning/worlds-without-azgaar.md §4.5, PL4,
 * PL7; L-715 / #820), pure, under both built-in systems: a route's length with
 * and without waypoints (and from either end, and in a map's own unit); the
 * waypoints checked inside the map; a link's line and rules merged; a move and
 * a journey turned back by a rule the traveller can't meet, and a journey
 * going the long way round instead; the places of a map in the new shape
 * carrying them; and the world map sending them.
 *
 * Run: cd tests && npx jest loom-route-waypoints --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const routes = require('../functions/loom-canon/routes');
const travel = require('../functions/loom-canon/travel');
const journeys = require('../functions/loom-canon/journeys');
const clock = require('../functions/loom-canon/clock');
const frames = require('../functions/loom-canon/frames');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { mapView } = require('../functions/loom-turn/map-view');

const settlement = (id, name, x, y, links, routesOf) => ({
  id,
  name,
  description: 'A town.',
  geo: { kind: 'settlement', x, y, links, ...(routesOf ? { routes: routesOf } : {}) },
  connections: Object.keys(links),
});

// 2 miles to a map unit.
const MAP = { width: 1000, height: 1000, distance: { unit: 'mi', perMapUnit: 2 } };

describe('a route’s length', () => {
  const bare = {
    map: MAP,
    locations: {
      a: settlement('a', 'A', 0, 0, { b: 'road' }),
      b: settlement('b', 'B', 40, 0, { a: 'road' }),
    },
  };
  const bent = {
    map: MAP,
    locations: {
      a: settlement(
        'a',
        'A',
        0,
        0,
        { b: 'road' },
        {
          b: {
            waypoints: [
              [0, 30],
              [40, 30],
            ],
          },
        }
      ),
      b: settlement('b', 'B', 40, 0, { a: 'road' }),
    },
  };

  test('without waypoints, the straight line × the scale × 1.25 for winding, as it was', () => {
    expect(routes.routeMiles(bare, 'a', 'b')).toBe(40 * 2 * routes.WINDING);
    expect(routes.waypointsOf(bare, 'a', 'b')).toEqual([]);
  });

  test('with waypoints, the length of the line through them × the scale, no winding', () => {
    // 30 up, 40 across, 30 down.
    expect(routes.routeMiles(bent, 'a', 'b')).toBe((30 + 40 + 30) * 2);
    expect(routes.pathOf(bent, 'a', 'b')).toEqual([
      [0, 0],
      [0, 30],
      [40, 30],
      [40, 0],
    ]);
  });

  test('from either end: stored on one place, read from the other with the line turned round', () => {
    expect(routes.routeMiles(bent, 'b', 'a')).toBe(200);
    expect(routes.waypointsOf(bent, 'b', 'a')).toEqual([
      [40, 30],
      [0, 30],
    ]);
    expect(routes.pathOf(bent, 'b', 'a')[1]).toEqual([40, 30]);
  });

  test('stored on each end, each in its own direction', () => {
    const both = JSON.parse(JSON.stringify(bent));
    both.locations.b.geo.routes = {
      a: {
        waypoints: [
          [40, 30],
          [0, 30],
        ],
      },
    };
    expect(routes.waypointsOf(both, 'b', 'a')).toEqual([
      [40, 30],
      [0, 30],
    ]);
    expect(routes.routeMiles(both, 'b', 'a')).toBe(200);
  });

  test('waypoints stored as { x, y } are read as pairs, and either form', () => {
    const stored = JSON.parse(JSON.stringify(bent));
    stored.locations.a.geo.routes.b.waypoints = [
      { x: 0, y: 30 },
      { x: 40, y: 30 },
    ];
    expect(routes.routeMiles(stored, 'a', 'b')).toBe(200);
    expect(routes.waypointsOf(stored, 'b', 'a')).toEqual([
      [40, 30],
      [0, 30],
    ]);
    expect(routes.pairsOf([{ x: 1, y: 2 }, [3, 4], 'bad', { x: 'q' }])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });

  test('objects as well as ids, and none without a position', () => {
    expect(routes.routeMiles(bent, bent.locations.a, bent.locations.b)).toBe(200);
    const lost = { map: MAP, locations: { a: { id: 'a', geo: {} }, b: bent.locations.b } };
    expect(routes.routeMiles(lost, 'a', 'b')).toBeNull();
    expect(routes.pathOf(lost, 'a', 'b')).toBeNull();
  });

  test('in a map’s own unit, the line’s length in it', () => {
    const lanes = {
      map: { width: 100, height: 100, distance: { unit: 'ly', perMapUnit: 3, own: true } },
      locations: { ...bent.locations },
    };
    expect(routes.routeMiles(lanes, 'a', 'b')).toBe(100 * 3);
    const straight = { ...lanes, locations: bare.locations };
    expect(routes.routeMiles(straight, 'a', 'b')).toBe(40 * 3);
  });

  test('a trip takes the time its length does', () => {
    const w = { ...bare, system: BUILT_IN['d20-fantasy'] };
    const wBent = { ...bent, system: BUILT_IN['d20-fantasy'] };
    const straight = travel.trip(w, 'a', 'b', clock.START);
    const winding = travel.trip(wBent, 'a', 'b', clock.START);
    expect(straight.miles).toBe(100);
    expect(winding.miles).toBe(200);
    expect(winding.seconds).toBeGreaterThan(straight.seconds);
    // And the same back.
    expect(travel.trip(wBent, 'b', 'a', clock.START).miles).toBe(200);
  });
});

describe('waypoints checked', () => {
  test('points as [x, y] or { x, y }, in order, kept as { x, y } (Firestore holds no array in an array)', () => {
    expect(routes.checkWaypoints([[1, 2], { x: 3, y: 4 }], { width: 10, height: 10 })).toEqual({
      points: [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
      ],
      errors: [],
    });
    expect(routes.checkWaypoints([]).points).toEqual([]);
  });

  test('refused when not a point, off the map, too many, or not a list', () => {
    const bounds = { width: 10, height: 10 };
    expect(routes.checkWaypoints([[1, 'x']], bounds).errors[0]).toMatch(
      /Waypoint 1 is not a point/
    );
    expect(
      routes.checkWaypoints(
        [
          [1, 1],
          [11, 1],
        ],
        bounds
      ).errors[0]
    ).toMatch(/Waypoint 2 \(11, 1\) is off the map \(0–10, 0–10\)/);
    expect(routes.checkWaypoints([[-1, 1]], bounds).errors[0]).toMatch(/off the map/);
    expect(
      routes.checkWaypoints(Array(routes.MAX_WAYPOINTS + 1).fill([1, 1]), bounds).errors[0]
    ).toMatch(/at most 40 waypoints/);
    expect(routes.checkWaypoints('north').errors[0]).toMatch(/list of points/);
    // With no bounds, only the shape is checked.
    expect(routes.checkWaypoints([[1e6, 1e6]]).errors).toEqual([]);
  });
});

describe('what a link holds, changed', () => {
  const had = {
    waypoints: [[1, 1]],
    rules: { requiresAbility: 'swimmer', hostileToFactionId: 'fac_1' },
  };

  test('waypoints replace, [] clears, and leaving them out keeps them', () => {
    expect(routes.applyExtras(had, { waypoints: [[2, 2]] }).waypoints).toEqual([[2, 2]]);
    expect(routes.applyExtras(had, { waypoints: [] }).waypoints).toBeUndefined();
    expect(routes.applyExtras(had, {}).waypoints).toEqual([[1, 1]]);
  });

  test('rules merge key by key, and null takes one away', () => {
    expect(routes.applyExtras(had, { rules: { requiresAbility: 'climber' } }).rules).toEqual({
      requiresAbility: 'climber',
      hostileToFactionId: 'fac_1',
    });
    expect(routes.applyExtras(had, { rules: { requiresAbility: null } }).rules).toEqual({
      hostileToFactionId: 'fac_1',
    });
  });

  test('nothing left is null', () => {
    expect(routes.applyExtras(null, {})).toBeNull();
    expect(
      routes.applyExtras(
        { rules: { requiresAbility: 'swimmer' } },
        { rules: { requiresAbility: null } }
      )
    ).toBeNull();
    expect(routes.applyExtras(null, { waypoints: [], rules: {} })).toBeNull();
  });
});

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('a rule on a route under %s', (id, system) => {
  // Ashby to Dunmere by the ford (short, needs a swimmer) or round by
  // Carrow (long, open to all).
  const ford = { rules: { requiresAbility: 'swimmer' } };
  const WORLD = {
    id: 'w',
    system,
    map: MAP,
    locations: {
      ashby: settlement(
        'ashby',
        'Ashby',
        100,
        100,
        { dunmere: 'road', carrow: 'road' },
        { dunmere: ford }
      ),
      carrow: settlement('carrow', 'Carrow', 100, 200, { ashby: 'road', dunmere: 'road' }),
      dunmere: settlement(
        'dunmere',
        'Dunmere',
        200,
        100,
        { ashby: 'road', carrow: 'road', far: 'road' },
        { ashby: ford }
      ),
      far: settlement('far', 'Far', 300, 100, { dunmere: 'road' }),
    },
    places: {},
    factions: {},
    characters: {},
    battleMaps: {},
  };
  const save = (abilities = [], extra = {}) => ({
    location: 'ashby',
    visited: ['ashby', 'carrow', 'dunmere', 'far'],
    waysKnown: {},
    time: clock.START,
    character: { name: 'Tam', inventory: [], abilities },
    ...extra,
  });
  const move = (to, s, world = WORLD) =>
    evaluate({ verb: 'move', targets: [to], params: {} }, {}, s, 10, world);

  test('a move along it is refused to a traveller without the ability, with the reason', () => {
    const r = move('dunmere', save());
    expect(r.outcome).toBe('blocked');
    expect(r.mutations).toEqual([]);
    expect(r.constraints).toEqual([
      'You lack what it takes to go that way (the route requires: swimmer).',
    ]);
  });

  test('and made by one with it', () => {
    const r = move('dunmere', save(['swimmer']));
    expect(r.outcome).toBe('success');
    expect(r.mutations.find((m) => m.path === 'location').value).toBe('dunmere');
  });

  test('the other way along it, too', () => {
    const r = move('ashby', save([], { location: 'dunmere' }));
    expect(r.outcome).toBe('blocked');
    expect(r.constraints[0]).toMatch(/requires: swimmer/);
  });

  test('other routes from the same place are open', () => {
    expect(move('carrow', save()).outcome).toBe('success');
  });

  test('a rule on the place itself is still its own: the place’s message', () => {
    const closed = JSON.parse(JSON.stringify(WORLD));
    closed.locations.dunmere.rules = { requiresAbility: 'flyer' };
    expect(move('dunmere', save(['swimmer'])).outcome).toBe('success');
    expect(move('dunmere', save(['swimmer']), closed).constraints[0]).toMatch(
      /crossing \(requires: flyer\)/
    );
  });

  test('a journey goes the long way round when it can’t take the ford', () => {
    expect(journeys.routeOf(WORLD, save(), 'ashby', 'far')).toEqual([
      'ashby',
      'carrow',
      'dunmere',
      'far',
    ]);
    // A swimmer takes the shorter way by the ford.
    expect(journeys.routeOf(WORLD, save(['swimmer']), 'ashby', 'far')).toEqual([
      'ashby',
      'dunmere',
      'far',
    ]);
  });

  test('and has no way at all when the ford is the only one', () => {
    const only = JSON.parse(JSON.stringify(WORLD));
    only.locations.ashby.connections = ['dunmere'];
    delete only.locations.ashby.geo.links.carrow;
    only.locations.carrow.connections = ['dunmere'];
    delete only.locations.carrow.geo.links.ashby;
    expect(journeys.routeOf(only, save(), 'ashby', 'far')).toBeNull();
    expect(journeys.routeOf(only, save(['swimmer']), 'ashby', 'far')).toEqual([
      'ashby',
      'dunmere',
      'far',
    ]);
    const r = move('far', save(), only);
    expect(r).toMatchObject({ outcome: 'blocked', constraints: ['No way you know leads there.'] });
  });

  test('a journey made takes the way round: the time of its legs', () => {
    const s = save();
    const r = move('far', s);
    expect(r.outcome).toBe('success');
    expect(r.journey.stops).toEqual(['ashby', 'carrow', 'dunmere', 'far']);
  });

  test('hostileToFactionId is stored beside it and changes nothing, as on a place', () => {
    const hostile = JSON.parse(JSON.stringify(WORLD));
    hostile.locations.ashby.geo.routes.carrow = { rules: { hostileToFactionId: 'fac_1' } };
    expect(routes.rulesOf(hostile, 'ashby', 'carrow')).toEqual({ hostileToFactionId: 'fac_1' });
    expect(routes.missingAbility(hostile, 'ashby', 'carrow', save())).toBeNull();
    expect(move('carrow', save(), hostile).outcome).toBe('success');
  });

  test('a rule is read from the character’s sheet traits too', () => {
    const sheeted = save();
    delete sheeted.character.abilities;
    sheeted.character.sheet = { traits: ['swimmer'] };
    expect(routes.missingAbility(WORLD, 'ashby', 'dunmere', sheeted)).toBeNull();
    expect(routes.missingAbility(WORLD, 'ashby', 'dunmere', save())).toBe('swimmer');
  });
});

describe('a map in the new shape', () => {
  // Two places on a region map linked with a line and a rule, and the legacy
  // world map's migrated link carrying the same.
  const space = { width: 1000, height: 1000 };
  const world = () => ({
    id: 'w',
    topMapId: 'map_isles',
    maps: {
      map_isles: {
        id: 'map_isles',
        kind: 'region',
        name: 'The isles',
        parent: null,
        space: { ...space, distance: { unit: 'mi', perUnit: 2 } },
      },
    },
    mapPlaces: {
      pl_a: {
        id: 'pl_a',
        mapId: 'map_isles',
        name: 'Alder',
        at: { x: 0, y: 0 },
        links: [
          {
            placeId: 'pl_b',
            kind: 'sea',
            waypoints: [
              [0, 30],
              [40, 30],
            ],
            rules: { requiresAbility: 'seaworthy-vessel' },
          },
        ],
      },
      pl_b: {
        id: 'pl_b',
        mapId: 'map_isles',
        name: 'Birch',
        at: { x: 40, y: 0 },
        links: [],
      },
    },
    locations: {},
    places: {},
  });

  test('the links carry their line and rules into the play model, both ways', () => {
    const play = frames.playWorld(world());
    const here = play.regionLocations.map_isles;
    expect(here.pl_a.geo.routes.pl_b).toEqual({
      waypoints: [
        [0, 30],
        [40, 30],
      ],
      rules: { requiresAbility: 'seaworthy-vessel' },
    });
    // The place that wasn't given the link has it, the line turned round.
    expect(here.pl_b.connections).toEqual(['pl_a']);
    expect(here.pl_b.geo.routes.pl_a.waypoints).toEqual([
      [40, 30],
      [0, 30],
    ]);
    expect(here.pl_b.geo.routes.pl_a.rules).toEqual({ requiresAbility: 'seaworthy-vessel' });
    const view = frames.viewFor(play, 'map_isles');
    expect(routes.missingAbility(view, 'pl_b', 'pl_a', { character: { abilities: [] } })).toBe(
      'seaworthy-vessel'
    );
    expect(routes.routeMiles(view, 'pl_a', 'pl_b')).toBeGreaterThan(0);
  });

  test('a place with no line or rules has no routes entry', () => {
    const w = world();
    w.mapPlaces.pl_a.links = [{ placeId: 'pl_b', kind: 'sea' }];
    const here = frames.playWorld(w).regionLocations.map_isles;
    expect(here.pl_a.geo.routes).toBeUndefined();
    expect(here.pl_b.geo.routes).toBeUndefined();
  });

  test('today’s world map migrates its links with their line and rules', () => {
    const plan = require('../functions/loom-canon/level-plan');
    const out = plan.plan({
      id: 'w',
      meta: { name: 'W', map: { width: 1000, height: 1000 } },
      locations: {
        a: settlement(
          'a',
          'A',
          0,
          0,
          { b: 'road' },
          { b: { waypoints: [[5, 5]], rules: { requiresAbility: 'x' } } }
        ),
        b: settlement('b', 'B', 40, 0, { a: 'road' }),
      },
      places: {},
      battleMaps: {},
    });
    expect(out.places.a.links).toEqual([
      { placeId: 'b', kind: 'road', waypoints: [[5, 5]], rules: { requiresAbility: 'x' } },
    ]);
    expect(out.places.b.links).toEqual([{ placeId: 'a', kind: 'road' }]);
  });
});

describe('the world map sends the bends', () => {
  const WORLD = {
    id: 'w',
    system: BUILT_IN['d20-fantasy'],
    map: MAP,
    locations: {
      a: settlement(
        'a',
        'A',
        100,
        100,
        { b: 'road', c: 'trail' },
        {
          b: {
            waypoints: [
              [100, 200],
              [200, 200],
            ],
          },
        }
      ),
      b: settlement('b', 'B', 200, 100, { a: 'road' }),
      c: settlement('c', 'C', 100, 50, { a: 'trail' }),
    },
    places: {},
    factions: {},
    characters: {},
    battleMaps: {},
  };
  const save = {
    location: 'a',
    visited: ['a'],
    discovered: ['a', 'b', 'c'],
    waysKnown: {},
    time: clock.START,
    character: { name: 'Tam', inventory: [] },
  };

  test('a link carries its waypoints from its first place, and the trip its length', () => {
    const view = mapView(WORLD, save, null, null);
    const ab = view.links.find((l) => l.from === 'a' && l.to === 'b');
    expect(ab.waypoints).toEqual([
      [100, 200],
      [200, 200],
    ]);
    expect(ab.travel.miles).toBe((100 + 100 + 100) * 2);
    const ac = view.links.find((l) => l.to === 'c' || l.from === 'c');
    expect(ac.waypoints).toBeUndefined();
    expect(ac.travel.miles).toBe(50 * 2 * routes.WINDING);
  });

  test('the line runs the way the link does: from its first place', () => {
    const bent = JSON.parse(JSON.stringify(WORLD));
    bent.locations.a.geo.routes.b.waypoints = [
      [120, 200],
      [180, 250],
    ];
    for (const here of ['a', 'b']) {
      const view = mapView(bent, { ...save, location: here, discovered: ['a', 'b'] }, null, null);
      const link = view.links.find((l) => [l.from, l.to].sort().join() === 'a,b');
      const along =
        link.from === 'a'
          ? [
              [120, 200],
              [180, 250],
            ]
          : [
              [180, 250],
              [120, 200],
            ];
      expect(link.waypoints).toEqual(along);
    }
  });
});
