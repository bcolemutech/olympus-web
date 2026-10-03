'use strict';

/**
 * Walking a town in one move (planning/the-loom-movement-and-vision.md §2;
 * L-600 / #433): a move to any place in town walks the shortest open way
 * there along the links, around closed places, and names the places passed.
 * Pure, over a hand-built town; no emulator.
 *
 * Run: cd tests && npx jest loom-town-walk --verbose
 */

const town = require('../functions/loom-canon/town');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { townView } = require('../functions/loom-turn/map-view');

// Hollin: a gate, two ways to the square (the lane, the wharf), a temple off
// the square, and a tower you must climb to reach the belfry.
//
//   gate ─ lane ─ square ─ temple
//     └── wharf ──┘  └─ tower ─ belfry
const WRITTEN = { description: 'mcp' };
function hollin(changes = {}) {
  const place = (id, name, connections, extra = {}) => ({
    id,
    name,
    locationId: 'loc_9',
    kind: 'district',
    description: name + ', as the locals know it.',
    sources: WRITTEN,
    connections,
    entrance: null,
    npcIds: [],
    rules: {},
    ...extra,
    ...(changes[id] || {}),
  });
  return {
    status: 'published',
    locations: {
      loc_9: {
        id: 'loc_9',
        name: 'Hollin',
        description: 'A river town.',
        sources: WRITTEN,
        connections: [],
        geo: { kind: 'settlement', links: {} },
      },
    },
    places: {
      plc_gate: place('plc_gate', 'The Gate', ['plc_lane', 'plc_wharf'], {
        kind: 'gate',
        entrance: { via: ['road'] },
      }),
      plc_lane: place('plc_lane', 'The Lane', ['plc_gate', 'plc_square']),
      plc_wharf: place('plc_wharf', 'The Wharf', ['plc_gate', 'plc_square']),
      plc_square: place('plc_square', 'The Square', [
        'plc_lane',
        'plc_wharf',
        'plc_temple',
        'plc_tower',
      ]),
      plc_temple: place('plc_temple', 'The Temple', ['plc_square']),
      plc_tower: place('plc_tower', 'The Tower', ['plc_square', 'plc_belfry'], {
        rules: { requiresAbility: 'climbing' },
      }),
      plc_belfry: place('plc_belfry', 'The Belfry', ['plc_tower']),
    },
    characters: {},
    factions: {},
    lore: {},
  };
}
const CLOSED = { sources: { description: 'import' } };
const at = (placeId, abilities = []) => ({
  location: 'loc_9',
  placeId,
  mapId: null,
  cell: null,
  character: { name: 'Tam', abilities },
});
const moveTo = (world, save, target) =>
  evaluate({ verb: 'move', targets: [target], params: {} }, {}, save, 10, world);

describe('a move to any place in town', () => {
  test('walks there in one move, past the places between', () => {
    expect(moveTo(hollin(), at('plc_gate'), 'plc_temple')).toEqual({
      outcome: 'success',
      mutations: [
        { target: 'save', op: 'set-flag', path: 'placeId', value: 'plc_temple' },
        { op: 'increment', path: 'worldClock', value: 1 },
      ],
      constraints: ['You make your way from The Gate past The Lane and The Square to The Temple.'],
    });
  });

  test('a place next door is walked to as before', () => {
    expect(moveTo(hollin(), at('plc_gate'), 'plc_lane').constraints).toEqual([
      'You make your way to The Lane.',
    ]);
  });

  test('of two equal ways, the same one every time', () => {
    const walk = town.walkTo(hollin(), hollin().places.plc_gate, hollin().places.plc_square);
    expect(walk.map((p) => p.id)).toEqual(['plc_lane', 'plc_square']);
  });

  test('goes around a closed place', () => {
    const world = hollin({ plc_lane: CLOSED });
    expect(moveTo(world, at('plc_gate'), 'plc_temple').constraints).toEqual([
      'You make your way from The Gate past The Wharf and The Square to The Temple.',
    ]);
  });

  test('with every way closed, names the place in the way', () => {
    const world = hollin({ plc_lane: CLOSED, plc_wharf: CLOSED });
    expect(moveTo(world, at('plc_gate'), 'plc_temple')).toEqual({
      outcome: 'blocked',
      mutations: [],
      constraints: ['The way to The Lane is closed. Turn back.'],
    });
  });

  test('a closed destination is reported first, however far', () => {
    const world = hollin({ plc_temple: CLOSED, plc_lane: CLOSED, plc_wharf: CLOSED });
    expect(moveTo(world, at('plc_gate'), 'plc_temple').constraints).toEqual([
      'The way to The Temple is closed. Turn back.',
    ]);
  });

  test('a place you need an ability to pass is in the way without it', () => {
    expect(moveTo(hollin(), at('plc_gate'), 'plc_belfry').constraints).toEqual([
      'You lack what it takes to get past The Tower (requires: climbing).',
    ]);
  });

  test("with the ability (on the save's character), the way is open", () => {
    expect(moveTo(hollin(), at('plc_gate', ['climbing']), 'plc_belfry').constraints).toEqual([
      'You make your way from The Gate past The Lane, The Square and The Tower to The Belfry.',
    ]);
    // A place that itself requires it lets the character in, too.
    expect(moveTo(hollin(), at('plc_square', ['climbing']), 'plc_tower').outcome).toBe('success');
    expect(moveTo(hollin(), at('plc_square'), 'plc_tower').constraints).toEqual([
      'You lack what it takes to get in (requires: climbing).',
    ]);
  });

  test('a retired place, and a place in a town with no way through, are refused', () => {
    expect(
      moveTo(hollin({ plc_temple: { retired: true } }), at('plc_gate'), 'plc_temple').constraints
    ).toEqual(["That place can't be reached anymore."]);
    const cutOff = hollin({ plc_temple: { connections: [] }, plc_square: { connections: [] } });
    expect(moveTo(cutOff, at('plc_gate'), 'plc_temple').constraints).toEqual([
      "You can't get there from here.",
    ]);
  });
});

describe('where a save can walk to', () => {
  const ids = (places) => places.map((p) => p.id);
  const passable = (world, save) => town.passableFor(world, save);

  test('every place there is an open way to, nearest first; closed ones shown', () => {
    const world = hollin({ plc_temple: CLOSED });
    expect(
      ids(town.reachableFrom(world, 'loc_9', world.places.plc_gate, passable(world, at())))
    ).toEqual(['plc_lane', 'plc_wharf', 'plc_square', 'plc_temple', 'plc_tower']);
  });

  test('nothing beyond a place the save may not pass', () => {
    const world = hollin({ plc_square: CLOSED });
    expect(
      ids(town.reachableFrom(world, 'loc_9', world.places.plc_gate, passable(world, at())))
    ).toEqual(['plc_lane', 'plc_wharf', 'plc_square']);
    const climber = at('plc_gate', ['climbing']);
    expect(
      ids(
        town.reachableFrom(hollin(), 'loc_9', hollin().places.plc_gate, passable(hollin(), climber))
      )
    ).toContain('plc_belfry');
  });

  test('standing nowhere in town, the walk starts at its ways in', () => {
    const world = hollin();
    expect(ids(town.reachableFrom(world, 'loc_9', null, passable(world, at())))[0]).toBe(
      'plc_gate'
    );
  });

  test("loomGetMap's `next` lists them, so the town view offers each", () => {
    const view = townView(hollin({ plc_lane: CLOSED }), at('plc_gate'), new Set());
    expect(view.next).toEqual(['plc_lane', 'plc_wharf', 'plc_square', 'plc_temple', 'plc_tower']);
  });
});
