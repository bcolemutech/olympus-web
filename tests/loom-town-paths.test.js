'use strict';

/**
 * The town requirement by paths (planning/the-loom-movement-and-vision.md §7;
 * L-655 / #467): in a town with ground, a place counts as reachable when its
 * door can be walked to from a way in, whatever its links; a town without
 * ground keeps going by its links, as before. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-town-paths --verbose
 */

const town = require('../functions/loom-canon/town');
const { gradeLocation } = require('../functions/loom-canon/grading');
const { GATEWAY } = require('./helpers/towns');

const pt = (x, y) => ({ x, y });
const rect = (x0, y0, x1, y1) => [pt(x0, y0), pt(x1, y0), pt(x1, y1), pt(x0, y1)];
const WALL = {
  name: 'the town wall',
  points: [pt(450, 900), pt(100, 900), pt(100, 100), pt(900, 100), pt(900, 900), pt(550, 900)],
};
const RIVER = { name: 'the Dal', points: rect(0, 480, 1000, 520) };
const BRIDGE = { name: 'the old bridge', points: rect(480, 470, 520, 530) };
const INN = { name: 'the Gull', points: rect(600, 600, 700, 650) };
const GROUND = { buildings: [INN], water: [RIVER], walls: [WALL], crossings: [BRIDGE] };

// An open place in Burdendal: written up, with a battle map.
const place = (id, name, position, extra = {}) => ({
  id,
  locationId: 'loc_1',
  name,
  kind: 'place',
  description: `${name}, as it is.`,
  sources: { description: 'mcp' },
  position,
  connections: [],
  npcIds: [],
  rules: {},
  battleMap: { mapId: GATEWAY.id },
  ...extra,
});

/**
 * Burdendal, published: the south gate, the market and the mill across the
 * river. `links` gives the places' links; `ground` the town's ground.
 */
function burdendal({ ground = null, links = {}, positions = {} } = {}) {
  const places = {
    plc_gate: place('plc_gate', 'The South Gate', pt(500, 900), {
      entrance: { via: ['road', 'trail', 'sea'] },
    }),
    plc_market: place('plc_market', 'Market Square', pt(500, 700)),
    plc_mill: place('plc_mill', 'The Mill', pt(300, 300)),
  };
  for (const [id, connections] of Object.entries(links)) places[id].connections = connections;
  for (const [id, position] of Object.entries(positions)) places[id].position = position;
  const settlement = {
    id: 'loc_1',
    name: 'Burdendal',
    description: 'A river town.',
    sources: { description: 'mcp' },
    geo: { kind: 'settlement', x: 100, y: 100, population: 3000 },
    connections: [],
    ...(ground ? { town: { ground } } : {}),
  };
  const world = {
    id: 'w-paths',
    status: 'published',
    locations: { loc_1: settlement },
    places,
    battleMaps: { [GATEWAY.id]: GATEWAY },
    characters: {},
    factions: {},
    lore: {},
    rules: {},
  };
  return { world, settlement };
}
const LINKED = {
  plc_gate: ['plc_market'],
  plc_market: ['plc_gate', 'plc_mill'],
  plc_mill: ['plc_market'],
};
const needsTown = ({ world, settlement }) =>
  gradeLocation(world, settlement).checklist.some((item) => item.need === 'town');

describe('a town without ground goes by its links, as before', () => {
  test('linked from the gate: a working layout', () => {
    const b = burdendal({ links: LINKED });
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(true);
    expect(town.layoutReport(b.world, b.settlement)).toEqual({
      valid: true,
      problems: [],
      warnings: [],
    });
    expect(needsTown(b)).toBe(false);
  });

  test('a place not linked is unreachable, wherever its door', () => {
    const b = burdendal({ links: { plc_gate: ['plc_market'], plc_market: ['plc_gate'] } });
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(false);
    expect(town.layoutReport(b.world, b.settlement).problems).toEqual([
      'Not reachable from a way in: The Mill (plc_mill).',
    ]);
    expect(needsTown(b)).toBe(true);
  });
});

describe('a town with ground goes by its streets', () => {
  test('no links at all, but every door walkable: a working layout, and no word of links', () => {
    const b = burdendal({ ground: GROUND });
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(true);
    const report = town.layoutReport(b.world, b.settlement);
    expect(report.valid).toBe(true);
    expect(report.problems).toEqual([]);
    // Its links aren't used (L-665), so nothing is said of them.
    expect(report.warnings).toEqual([]);
    expect(needsTown(b)).toBe(false);
  });

  test('linked, but no bridge over the river: the mill can’t be walked to', () => {
    const b = burdendal({ ground: { ...GROUND, crossings: [] }, links: LINKED });
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(false);
    expect(town.layoutReport(b.world, b.settlement)).toEqual({
      valid: false,
      problems: ['Can’t be walked to from a way in: The Mill (plc_mill).'],
      warnings: [],
    });
    expect(needsTown(b)).toBe(true);
  });

  test('a door inside a building, or with no position, keeps the layout from working', () => {
    const inside = burdendal({
      ground: GROUND,
      links: LINKED,
      positions: { plc_mill: pt(650, 625) },
    });
    expect(town.hasTownLayout(inside.world, inside.settlement)).toBe(false);
    expect(town.layoutReport(inside.world, inside.settlement).problems).toEqual([
      'The Mill (plc_mill)’s door (650, 625) is inside the building 1 "the Gull".',
    ]);
    const none = burdendal({ ground: GROUND, links: LINKED, positions: { plc_mill: undefined } });
    expect(town.hasTownLayout(none.world, none.settlement)).toBe(false);
  });

  test('the gate still has to be open', () => {
    const b = burdendal({ ground: GROUND });
    delete b.world.places.plc_gate.battleMap;
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(false);
    expect(town.layoutReport(b.world, b.settlement).problems[0]).toMatch(
      /No way in or out is open/
    );
  });

  test('ground with no shapes left is a town without ground: links again', () => {
    const empty = { buildings: [], water: [], walls: [], crossings: [] };
    const b = burdendal({ ground: empty });
    expect(town.hasTownLayout(b.world, b.settlement)).toBe(false);
    expect(
      town.hasTownLayout(burdendal({ ground: empty, links: LINKED }).world, b.settlement)
    ).toBe(true);
  });
});
