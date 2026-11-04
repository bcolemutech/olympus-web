'use strict';

/**
 * Sight on the geometry (functions/loom-canon/sight.js; planning/maps-from-
 * data.md §4.3, GE3, DA2; L-923 / #727): line of sight against the real
 * lines and shapes from each viewer's eyes, see-through walls and doors,
 * heights (a wall hides what's beyond it when its top reaches the eyes),
 * cover from the geometry, high ground, ledges that can't be walked up and
 * falls from them. Pure; where the rules are a system's, in both built-in
 * systems (MD2).
 *
 * Run: cd tests && npx jest loom-sight-geometry --verbose
 */

const geo = require('../functions/loom-canon/map-geometry');
const mapPaths = require('../functions/loom-canon/map-paths');
const sight = require('../functions/loom-canon/sight');
const sheets = require('../functions/loom-canon/sheets');
const conditions = require('../functions/loom-canon/conditions');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const position = require('../functions/loom-modules/combat/position');
const falls = require('../functions/loom-modules/combat/falls');
const { planStep } = require('../functions/loom-turn/steps');

const sq = (x, y) => ({ x, y });
// A map 12 × 8 squares (60 × 40 ft) drawn from its geometry.
const mapOf = (id, geometry, extra = {}) => ({
  id,
  name: id,
  width: 12,
  height: 8,
  entries: [],
  exits: [],
  features: [],
  geometry: geo.normalize(geometry),
  ...extra,
});
const sees = (map, from, to, states, options) => sight.sees(map, from, to, states || {}, options);

describe('line of sight on the geometry', () => {
  // A wall at an angle, from (20, 5) to (35, 30) ft, across the room.
  const slant = mapOf('slant', {
    walls: [
      {
        id: 'slant',
        material: 'stone',
        points: [
          [20, 5],
          [35, 30],
        ],
      },
    ],
  });

  test('an angled wall hides a figure behind it and not one beside it', () => {
    const from = sq(1, 4);
    // Beside the wall, on this side of it: seen.
    expect(sees(slant, from, sq(5, 4))).toBe(true);
    // Behind it: hidden, though a square-by-square line would pass its end.
    expect(sees(slant, from, sq(8, 4))).toBe(false);
    expect(sees(slant, from, sq(8, 2))).toBe(false);
    // Past its lower end, in the open again: seen.
    expect(sees(slant, from, sq(9, 7))).toBe(true);
    // The same, square by square, as the fog has it.
    const seen = sight.inSight(slant, from, {});
    expect(seen['5,4']).toBe(true);
    expect(seen['8,4']).toBeUndefined();
  });

  test('a figure standing at a point is seen from where they look, not their square', () => {
    // Just round the wall's lower end: from the left of the square, hidden;
    // from its right, seen.
    expect(sees(slant, { cell: sq(6, 6), point: { x: 30.5, y: 32.5 } }, sq(8, 2))).toBe(false);
    expect(sight.sees(slant, sq(1, 4), sq(1, 4), {})).toBe(true);
  });

  // A stone wall down x = 30 with a door in it from y 15 to 25.
  const doorway = (door) =>
    mapOf('doorway', {
      walls: [
        {
          id: 'wall',
          material: 'stone',
          points: [
            [30, 0],
            [30, 40],
          ],
        },
      ],
      doors: [{ id: 'door', from: [30, 15], to: [30, 25], wall: 'wall', ...door }],
    });

  test('a glass door shows what is beyond but cannot be walked through (locked)', () => {
    const glass = doorway({ material: 'glass', state: 'locked' });
    // Seen through, as GE3 has it.
    expect(sees(glass, sq(2, 4), sq(9, 4))).toBe(true);
    // A wooden one, shut, hides it.
    expect(sees(doorway({ material: 'wood', state: 'closed' }), sq(2, 4), sq(9, 4))).toBe(false);
    // Not walked through: there's no way past.
    const plan = mapPaths.planner(glass, {});
    expect(
      mapPaths.pathTo(plan, mapPaths.centreOf(sq(2, 4)), mapPaths.centreOf(sq(9, 4)))
    ).toBeNull();
    // A gate the same: seen through, and opened on the way when it isn't locked.
    const gate = doorway({ material: 'gate', state: 'closed' });
    expect(sees(gate, sq(2, 4), sq(9, 4))).toBe(true);
    expect(sees(gate, sq(2, 4), sq(9, 4), { door: 'open' })).toBe(true);
  });

  test('a glass wall or a window: seen through, never walked through', () => {
    const pane = mapOf('pane', {
      walls: [
        {
          id: 'pane',
          material: 'glass',
          points: [
            [30, 0],
            [30, 40],
          ],
        },
      ],
    });
    expect(Object.keys(sight.inSight(pane, sq(2, 4), {}))).toHaveLength(96);
    const plan = mapPaths.planner(pane, {});
    expect(
      mapPaths.pathTo(plan, mapPaths.centreOf(sq(2, 4)), mapPaths.centreOf(sq(9, 4)))
    ).toBeNull();
  });

  // A 6 ft wall down x = 30, and a ledge 10 ft high over the west quarter.
  const parapet = mapOf('parapet', {
    ground: [
      {
        id: 'ledge',
        material: 'stone',
        shape: { rect: { x: 0, y: 0, w: 15, h: 40 } },
        height: 10,
      },
    ],
    walls: [
      {
        id: 'low',
        material: 'stone',
        points: [
          [30, 0],
          [30, 40],
        ],
        height: 6,
      },
    ],
  });

  test('a figure behind a low wall is hidden from the floor and seen from a ledge', () => {
    // On the floor, eyes at 5 ft: the 6 ft wall hides the far side.
    expect(sees(parapet, sq(4, 4), sq(9, 4))).toBe(false);
    // On the ledge, eyes at 15 ft: over it.
    expect(sees(parapet, sq(1, 4), sq(9, 4))).toBe(true);
    // Someone large on the floor (eyes at 10 ft) sees over it too.
    expect(sees(parapet, { cell: sq(4, 4), size: 'large' }, sq(9, 4))).toBe(true);
    expect(sight.eyeLevel(parapet, sq(1, 4))).toBe(15);
    expect(sight.eyeLevel(parapet, { cell: sq(4, 4), size: 'small' })).toBe(2.5);
  });

  test('objects hide by their kind or their own say, and by their height', () => {
    const room = (object) => mapOf('things', { objects: [{ id: 'thing', ...object }] });
    // A pillar (tall in the catalog) hides what's straight behind it.
    const pillar = room({ kind: 'pillar', at: [32.5, 22.5], size: [5, 5] });
    expect(sees(pillar, sq(2, 4), sq(10, 4))).toBe(false);
    expect(sees(pillar, sq(2, 4), sq(6, 4))).toBe(true); // the pillar itself is seen
    // A crate (low) doesn't; nor a pillar 4 ft high.
    expect(sees(room({ kind: 'crate', at: [32.5, 22.5], size: [5, 5] }), sq(2, 4), sq(10, 4))).toBe(
      true
    );
    expect(
      sees(room({ kind: 'pillar', at: [32.5, 22.5], size: [5, 5], height: 4 }), sq(2, 4), sq(10, 4))
    ).toBe(true);
  });
});

describe.each(Object.keys(BUILT_IN))('cover, high ground and falls under %s', (id) => {
  const system = BUILT_IN[id];

  test('cover from a corner: round it heavy, half behind its end partial, clear none', () => {
    // A wall down x = 20 ft from the top to y = 20.
    const corner = mapOf('corner', {
      walls: [
        {
          id: 'corner',
          material: 'stone',
          points: [
            [20, 0],
            [20, 20],
          ],
        },
      ],
    });
    const from = sq(1, 2);
    // Round the corner: in sight past its end, but most of them behind it.
    expect(sight.sees(corner, from, sq(7, 5), {})).toBe(true);
    expect(position.coverOf(corner, {}, from, sq(7, 5))).toBe('heavy');
    // The line between their middles grazes the wall's end: half behind it.
    expect(position.coverOf(corner, {}, sq(1, 1), sq(5, 5))).toBe('partial');
    expect(position.coverOf(corner, {}, from, sq(2, 7))).toBeNull();
  });

  test('a low wall and a table give partial cover; nothing between, none', () => {
    const low = mapOf('low', {
      walls: [
        {
          id: 'low',
          material: 'stone',
          points: [
            [30, 0],
            [30, 40],
          ],
          height: 3,
        },
      ],
    });
    expect(position.coverOf(low, {}, sq(2, 4), sq(9, 4))).toBe('partial');
    const table = mapOf('table', {
      objects: [{ id: 't', kind: 'table', at: [32.5, 22.5], size: [5, 3] }],
    });
    expect(position.coverOf(table, {}, sq(2, 4), sq(9, 4))).toBe('partial');
    expect(position.coverOf(mapOf('open', {}), {}, sq(2, 4), sq(9, 4))).toBeNull();
  });

  test('high ground: from 5 ft or more above, the system’s term is added', () => {
    const ledge = mapOf('ledge', {
      ground: [
        {
          id: 'ledge',
          material: 'stone',
          shape: { rect: { x: 0, y: 0, w: 15, h: 40 } },
          height: 10,
        },
      ],
    });
    const attack = { id: 'bow', name: 'Bow', range: { normal: 20, long: 40 }, attack: '1d20' };
    const up = position.termsFor(system, { map: ledge, attack, from: sq(1, 4), to: sq(8, 4) });
    expect(up.highGround).toBe(true);
    expect(up.bonus).toContainEqual({
      name: 'High ground',
      value: system.modules.combat.highGround,
    });
    // From below, or level: nothing.
    const down = position.termsFor(system, { map: ledge, attack, from: sq(8, 4), to: sq(1, 4) });
    expect(down.highGround).toBe(false);
    expect(down.bonus.map((t) => t.name)).not.toContain('High ground');
  });

  test('a fall: the system’s damage for each 10 ft, then Prone', () => {
    const sheet = sheets.defaultSheet(system);
    const health = () => sheet.resources.health.current;
    const before = health();
    const twenty = falls.fall(system, sheet, 20, { dice: (sides) => Math.min(5, sides), now: 0 });
    const each = system.modules.combat.falls.damage === '1d6' ? 5 : 1;
    expect(twenty.damage).toBe(2 * each);
    expect(twenty.sheet.resources.health.current).toBe(Math.max(0, before - 2 * each));
    expect(twenty.lines).toEqual(expect.arrayContaining(['You fall 20 ft.', 'You land Prone.']));
    expect(conditions.activeOn(system, twenty.sheet).map((a) => a.condition.id)).toContain('prone');
    // No more than `max` times.
    const far = falls.fall(system, sheet, 1000, { dice: () => 1, now: 0 });
    expect(far.damage).toBe(system.modules.combat.falls.max);
    // A system with no falls: Prone, but no harm.
    const soft = {
      ...system,
      modules: { ...system.modules, combat: { ...system.modules.combat } },
    };
    delete soft.modules.combat.falls;
    expect(falls.fall(soft, sheet, 20, { dice: () => 3 }).damage).toBe(0);
  });
});

describe('ledges and drops', () => {
  // A ledge 10 ft high over x 0–15, a step 2 ft high over x 40–60.
  const terrace = mapOf('terrace', {
    ground: [
      {
        id: 'ledge',
        material: 'stone',
        shape: { rect: { x: 0, y: 0, w: 15, h: 40 } },
        height: 10,
      },
      { id: 'step', material: 'wood', shape: { rect: { x: 40, y: 0, w: 20, h: 40 } }, height: 2 },
    ],
  });
  const way = (plan, a, b) => mapPaths.pathTo(plan, mapPaths.centreOf(a), mapPaths.centreOf(b));

  test('a ledge can’t be walked up; a low step can', () => {
    const plan = mapPaths.planner(terrace, {});
    expect(way(plan, sq(5, 4), sq(1, 4))).toBeNull();
    expect(way(plan, sq(5, 4), sq(10, 4))).not.toBeNull();
    expect(mapPaths.floorAt(terrace, mapPaths.centreOf(sq(1, 4)))).toBe(10);
    expect(mapPaths.floorAt(terrace, mapPaths.centreOf(sq(10, 4)))).toBe(2);
  });

  test('walked off by the player, a drop is a fall; foes never walk off one', () => {
    const plan = mapPaths.planner(terrace, {});
    expect(way(plan, sq(1, 4), sq(5, 4))).not.toBeNull();
    expect(way(mapPaths.planner(terrace, { drops: 'never' }), sq(1, 4), sq(5, 4))).toBeNull();
  });

  test('a walk off the ledge stops where it lands, with the fall', () => {
    const world = {
      battleMaps: {
        terrace: { ...terrace, exits: [{ id: 'out', name: 'the stair', x: 11, y: 7 }] },
      },
    };
    const save = {
      mapId: 'terrace',
      cell: sq(1, 4),
      character: { name: 'Tam' },
      turn: { n: 1, ap: 20, kept: 0, plan: null },
    };
    const step = planStep(world, save, { cell: sq(8, 4) });
    expect(step.fall).toEqual({ feet: 10, mapId: 'terrace' });
    // Stopped just past the ledge's edge, the rest kept as the plan.
    expect(step.cell).toEqual(sq(3, 4));
    expect(step.turn.plan).toMatchObject({ to: sq(8, 4) });
    expect(step.lines).not.toContain("That's as far as your AP takes you. End your turn to go on.");
  });
});
