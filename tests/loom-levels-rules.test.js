'use strict';

/**
 * Rules at any depth (planning/map-levels.md §4.3, TV1–TV4; L-903 / #721),
 * pure: timeRules by the region map travelled on (a light-year map and a
 * mile map, falling back to the world's, then the defaults); a frame's
 * fields and `at` read each other; and a trip between parents in three
 * stages (out of Vega, across the sector, into Sol), each in its own map's
 * time, under both built-in systems.
 *
 * Run: cd tests && npx jest loom-levels-rules --verbose
 */

const { BUILT_IN } = require('../functions/loom-canon/systems');
const clock = require('../functions/loom-canon/clock');
const travel = require('../functions/loom-canon/travel');
const levels = require('../functions/loom-canon/levels');
const frames = require('../functions/loom-canon/frames');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { andorWorld } = require('./fixtures/andor-world');

const H = clock.HOUR;

describe('timeRules(world, map)', () => {
  const world = andorWorld();

  test('a light-year map: its route kinds and speeds, round the clock', () => {
    const rules = clock.timeRules(world, world.maps.sector);
    expect(rules.routeSpeeds.jump).toBe(2);
    expect(rules.roundTheClock).toEqual(['jump']);
    expect(rules.turnSeconds).toEqual({ battle: 6, other: 300 });
    // A trip across it is in light-years, at its speed: 20 ly at 2 ly an hour.
    const view = frames.viewFor(frames.playWorld(world), 'sector');
    const trip = travel.trip(view, 'pl_vega', 'pl_sol', clock.START);
    expect(trip.seconds).toBe(10 * H);
    expect(trip.nights).toBe(0);
    expect(trip.label).toBe('about 10 hours by jump');
    expect(travel.tripLines(trip, 'you arrive at Sol.')).toEqual([
      'After about 10 hours by jump, you arrive at Sol.',
    ]);
  });

  test('a mile map: the defaults, unless the world or the map set their own', () => {
    const miles = {
      kind: 'region',
      space: { width: 100, height: 100, distance: { unit: 'mi', perUnit: 2 } },
      routeKinds: ['road', 'trail'],
    };
    expect(clock.timeRules({}, miles)).toEqual(clock.timeRules({}));
    // The world's own (rules.time), then the map's over it.
    const w = { rules: { time: { routeSpeeds: { road: 4 }, travelDayHours: 10 } } };
    expect(clock.timeRules(w, miles).routeSpeeds).toEqual({ road: 4, trail: 2, sea: 5 });
    expect(clock.timeRules(w, miles).travelDayHours).toBe(10);
    const fast = { ...miles, routeKinds: { road: { speed: 6 } }, travelDayHours: 12 };
    expect(clock.timeRules(w, fast).routeSpeeds.road).toBe(6);
    expect(clock.timeRules(w, fast).travelDayHours).toBe(12);
    // A grid or an area map sets no travel.
    expect(clock.timeRules({}, { kind: 'grid', routeKinds: { road: { speed: 9 } } })).toEqual(
      clock.timeRules({})
    );
  });

  test('by default, the region map the world is seen from', () => {
    const play = frames.playWorld(world);
    expect(clock.timeRules(frames.viewFor(play, 'vega')).routeSpeeds.sublight).toBe(5);
    expect(clock.timeRules(frames.viewFor(play, 'sector')).routeSpeeds.jump).toBe(2);
  });
});

describe('frames', () => {
  const play = frames.playWorld(andorWorld());

  test('each region map seen as a world map: its places as locations', () => {
    const vega = frames.viewFor(play, 'vega', [{ mapId: 'sector', placeId: 'pl_vega' }]);
    expect(Object.keys(vega.locations).sort()).toEqual([
      'pl_outpost',
      'pl_station',
      'pl_vega_gate',
    ]);
    expect(vega.locations.pl_station.geo.kind).toBe('settlement');
    // Links both ways.
    expect(vega.locations.pl_station.connections).toEqual(['pl_vega_gate']);
    expect(vega.places.pl_dock).toMatchObject({
      locationId: 'pl_station',
      battleMap: { mapId: 'deck' },
    });
    expect(vega.battleMaps.deck).toMatchObject({ width: 12, height: 8 });
    expect(frames.viewFor(play, 'sector').locations.pl_vega.region).toEqual({ mapId: 'vega' });
  });

  test('at and the frame fields read each other, three maps deep', () => {
    const at = [
      { mapId: 'sector', placeId: 'pl_vega' },
      { mapId: 'vega', placeId: 'pl_station' },
      { mapId: 'station', placeId: 'pl_dock' },
      { mapId: 'deck', cell: { x: 3, y: 4 } },
    ];
    expect(levels.validateAt(play, at)).toEqual([]);
    const framed = frames.frameOf(play, { at });
    expect(framed.view.frame).toEqual({ mapId: 'vega', prefix: [at[0]] });
    expect(framed.save).toMatchObject({
      location: 'pl_station',
      placeId: 'pl_dock',
      townPoint: null,
      mapId: 'deck',
      cell: { x: 3, y: 4 },
    });
    expect(frames.atOf(framed.view, framed.save)).toEqual(at);
    // A save from before at: its fields give it.
    const street = frames.frameOf(play, { location: 'pl_station', townPoint: { x: 500, y: 700 } });
    expect(street.at).toEqual([
      { mapId: 'sector', placeId: 'pl_vega' },
      { mapId: 'vega', placeId: 'pl_station' },
      { mapId: 'station', point: { x: 500, y: 700 } },
    ]);
    expect(frames.trailOf(play, at).map((t) => t.name)).toEqual([
      'Andor sector',
      'Vega',
      'Vega Station',
      'The deck',
    ]);
  });
});

describe.each([
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
])('a trip between parents under %s', (id, system) => {
  const play = frames.playWorld({ ...andorWorld(), system });
  const from = (at, extra = {}) => {
    const framed = frames.frameOf(play, {
      at,
      time: clock.START,
      discovered: ['pl_vega', 'pl_sol', 'pl_rigel', 'pl_sol_port', 'pl_deneb'],
      character: { name: 'Ash', inventory: [] },
      ...extra,
    });
    return framed;
  };
  const move = (framed, target) =>
    evaluate({ verb: 'move', targets: [target], params: {} }, {}, framed.save, 10, framed.view);
  const set = (r, path) => (r.mutations.find((m) => m.path === path) || {}).value;

  test('in three stages: out of Vega, across the sector, into Sol', () => {
    const framed = from([
      { mapId: 'sector', placeId: 'pl_vega' },
      { mapId: 'vega', placeId: 'pl_station' },
    ]);
    const r = move(framed, 'pl_sol_port');
    expect(r.outcome).toBe('success');
    // 45 AU across Vega to its gate, 20 ly across the sector, 45 AU into Sol.
    expect(r.journey.stages).toEqual([
      { mapId: 'vega', through: ['pl_station', 'pl_vega_gate'], seconds: 9 * H },
      { mapId: 'sector', through: ['pl_vega', 'pl_sol'], seconds: 10 * H },
      { mapId: 'sol', through: ['pl_sol_gate', 'pl_sol_port'], seconds: 9 * H },
    ]);
    expect(set(r, 'time')).toBe(clock.START + 28 * H);
    expect(set(r, 'at')).toEqual([
      { mapId: 'sector', placeId: 'pl_sol' },
      { mapId: 'sol', placeId: 'pl_sol_port' },
    ]);
    expect(r.constraints).toEqual([
      'You leave Vega by Vega Gate.',
      'You come into Sol by Sol Gate.',
      'After about a day in all, across Vega, Andor sector and Sol, you arrive at Sol Port.',
    ]);
  });

  test('to a closed place, or one not discovered, it is turned down', () => {
    const gate = from([
      { mapId: 'sector', placeId: 'pl_vega' },
      { mapId: 'vega', placeId: 'pl_vega_gate' },
    ]);
    expect(move(gate, 'pl_deneb').constraints).toEqual(['The way to Deneb is closed. Turn back.']);
    const unknown = from(gate.at, { discovered: [] });
    expect(move(unknown, 'pl_sol_port').constraints).toEqual([
      "You can't get there directly from here.",
    ]);
  });
});
