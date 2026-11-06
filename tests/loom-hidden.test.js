'use strict';

/**
 * Hidden things and spawns (planning/maps-from-data.md §3 DA1b, DA3, DA4,
 * §4.5; L-927 / #731), pure, under both built-in systems (MD2), on the crypt
 * (./helpers/crypt.js):
 *
 *   - a passive check finds a secret door, or misses it, once, and says
 *     nothing of a miss; Search then finds what it missed;
 *   - a found thing is found for that save only (the map is laid over with
 *     what a save has found, the world's map is never changed);
 *   - a hard thing is harder, a thing with no `dc` is Moderate; only what is
 *     in sight is rolled for; a trap is hidden by its own setting and not
 *     drawn until found;
 *   - the noticing skill is the system's `checks.notice`, checked on save;
 *   - a spawn places its count within its area, a generic one takes a row of
 *     its place's table, one standing isn't filled twice, a save's spawned
 *     figures stand on its map and no other save's.
 *
 * Run: cd tests && npx jest loom-hidden --verbose
 */

const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const maps = require('../functions/loom-canon/maps');
const mapDoors = require('../functions/loom-canon/doors');
const mapObjects = require('../functions/loom-canon/objects');
const hidden = require('../functions/loom-canon/hidden');
const secrets = require('../functions/loom-canon/secrets');
const hazards = require('../functions/loom-canon/hazards');
const checks = require('../functions/loom-canon/checks');
const combat = require('../functions/loom-modules/combat');
const { applyStateMutations, validateSave } = require('../functions/loom-models');
const { CRYPT } = require('./helpers/crypt');

const CASES = {
  'd20-fantasy': {
    trap: { condition: 'poisoned', save: { attribute: 'CON', against: 'Easy' } },
    skill: 'Perception',
  },
  'pool-scifi': {
    trap: { condition: 'bleeding', save: { attribute: 'Body', against: 'Easy' } },
    skill: 'Notice',
  },
};

// The dice: every die at its highest, or at 1.
const high = (sides) => sides;
const low = () => 1;
// The values given in turn, each held to 1..sides.
const sequence = (...values) => {
  let i = 0;
  return (sides) => Math.min(sides, Math.max(1, values[i++ % values.length]));
};

const key = (cell) => cell.x + ',' + cell.y;
const squares = (...cells) => Object.fromEntries(cells.map((c) => [key(c), true]));
// What the player sees of the whole crypt: everything.
const everything = (map) => {
  const all = {};
  for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) all[x + ',' + y] = true;
  return all;
};

describe.each(Object.keys(CASES))('hidden things under %s', (id) => {
  const system = BUILT_IN[id];
  const { trap, skill } = CASES[id];
  const world = (rows) => ({
    system,
    battleMaps: { bm_crypt: CRYPT(trap) },
    characters: {},
    locations: {
      crypt: {
        id: 'crypt',
        name: 'The crypt',
        battleMap: { mapId: 'bm_crypt' },
        danger: 'high',
        ...(rows ? { encounters: rows } : {}),
      },
    },
    places: {},
    factions: {},
    regions: {},
    lore: {},
    statBlocks: {
      goblin: { id: 'goblin', name: 'Goblin', statBlock: sheets.defaultSheet(system) },
      wolf: { id: 'wolf', name: 'Wolf', statBlock: sheets.defaultSheet(system) },
      bandit: { id: 'bandit', name: 'Bandit', statBlock: sheets.defaultSheet(system) },
    },
  });
  const save = (more = {}) => ({
    mapId: 'bm_crypt',
    cell: { x: 1, y: 6 },
    location: 'crypt',
    character: { name: 'Tam', inventory: [], sheet: sheets.defaultSheet(system) },
    turn: { n: 1, ap: 20, kept: 0, plan: null },
    ...more,
  });
  const seenBy = (state, w = world()) => maps.positionOf(w, state).map;
  const doorIds = (state, w = world()) => mapDoors.doorsOf(seenBy(state, w)).map((d) => d.id);

  describe('noticing', () => {
    test('the system names what is rolled: checks.notice, its surprise skill', () => {
      expect(system.checks.notice).toEqual({ skill });
      expect(hidden.checkOf(system)).toEqual({ skill });
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
      const bad = JSON.parse(JSON.stringify(system));
      bad.checks.notice = { skill: 'Nope' };
      expect(validateSystem(bad).errors.join(' ')).toContain('checks.notice.skill "Nope"');
      // A system with none rolls the surprise skill of its combat module.
      const bare = JSON.parse(JSON.stringify(system));
      delete bare.checks.notice;
      expect(hidden.checkOf(bare)).toEqual({ skill });
    });

    test('what a map hides: its geometry’s hidden things and its hidden traps', () => {
      const map = seenBy(save());
      const things = hidden.thingsOf(map);
      expect(things.map((t) => [t.key, t.list, t.name])).toEqual([
        ['secret', 'doors', 'a secret door'],
        ['cache', 'objects', 'a cache'],
        ['hazard:pit', 'hazards', 'the pit trap'],
      ]);
      // Not seen, not usable: no door, no cache, no trap to the player.
      expect(mapDoors.doorsOf(map)).toEqual([]);
      expect(mapObjects.allOf(map).map((o) => o.id)).toEqual([]);
      expect(hazards.seenOn(map, everything(map))).toEqual([]);
    });

    test('a passive check finds a secret door; it is told, once, as noticed', () => {
      const map = seenBy(save());
      const found = hidden.notice(system, map, save(), {
        dice: high,
        inSight: squares({ x: 5, y: 3 }),
      });
      expect(found.found.map((t) => t.id)).toEqual(['secret']);
      expect(found.lines).toEqual(['You notice a secret door.']);
      expect(found.mutations).toEqual([
        { target: 'save', op: 'set-flag', path: 'secrets.bm_crypt.secret', value: 'found' },
      ]);
    });

    test('or misses it: remembered, said nothing of, and not rolled again', () => {
      const state = save();
      const map = seenBy(state);
      const sight = { inSight: squares({ x: 5, y: 3 }) };
      const missed = hidden.notice(system, map, state, { dice: low, ...sight });
      expect(missed.found).toEqual([]);
      expect(missed.lines).toEqual([]);
      expect(missed.mutations).toEqual([
        { target: 'save', op: 'set-flag', path: 'secrets.bm_crypt.secret', value: 'missed' },
      ]);
      // Remembered: a passive check doesn't try again, however well it would roll.
      applyStateMutations(state, missed.mutations);
      let rolled = 0;
      const again = hidden.notice(system, seenBy(state), state, {
        dice: (sides) => {
          rolled++;
          return sides;
        },
        ...sight,
      });
      expect(again.mutations).toEqual([]);
      expect(rolled).toBe(0);
    });

    test('Search finds what the passive check missed', () => {
      const state = save({ secrets: { bm_crypt: { secret: 'missed' } } });
      const searched = hidden.notice(system, seenBy(state), state, {
        dice: high,
        inSight: everything(seenBy(state)),
        search: true,
      });
      expect(searched.found.map((t) => t.id)).toContain('secret');
      expect(searched.lines).toContain('You find a secret door.');
      expect(searched.mutations).toContainEqual({
        target: 'save',
        op: 'set-flag',
        path: 'secrets.bm_crypt.secret',
        value: 'found',
      });
    });

    test('only what is in sight is rolled for; with nothing hidden, nothing is rolled', () => {
      let rolled = 0;
      const counted = (sides) => {
        rolled++;
        return sides;
      };
      const map = seenBy(save());
      const blind = hidden.notice(system, map, save(), {
        dice: counted,
        inSight: squares({ x: 9, y: 0 }),
      });
      expect(blind.mutations).toEqual([]);
      expect(rolled).toBe(0);
      // The sight is worked out only when something is left to roll for.
      const w = world();
      w.battleMaps.bm_crypt.geometry = { ...w.battleMaps.bm_crypt.geometry, hidden: [] };
      w.battleMaps.bm_crypt.hazards = [];
      let worked = 0;
      const none = hidden.notice(system, maps.positionOf(w, save()).map, save(), {
        dice: counted,
        inSight: () => worked++,
      });
      expect(none.mutations).toEqual([]);
      expect(worked).toBe(0);
    });

    test('a hard thing is harder; one with no dc is Moderate', () => {
      const things = hidden.thingsOf(seenBy(save()));
      const door = things.find((t) => t.id === 'secret');
      const cache = things.find((t) => t.id === 'cache');
      expect(hidden.difficultyOf(system, cache).value).toBeGreaterThan(
        hidden.difficultyOf(system, door).value
      );
      const moderate = system.checks.ladder.find((r) => r.name === 'Moderate');
      expect(hidden.difficultyOf(system, { dc: undefined })).toEqual(moderate);
      expect(hidden.difficultyOf(system, { dc: 'Hard' })).toEqual(
        system.checks.ladder.find((r) => r.name === 'Hard')
      );
    });

    test('a hidden trap is found as the rest are, and then it is drawn', () => {
      const state = save();
      const map = seenBy(state);
      const found = hidden.notice(system, map, state, {
        dice: high,
        inSight: squares({ x: 3, y: 4 }),
      });
      expect(found.lines).toEqual(['You notice the pit trap.']);
      expect(found.mutations).toEqual([
        { target: 'save', op: 'set-flag', path: 'secrets.bm_crypt.hazard:pit', value: 'found' },
      ]);
      applyStateMutations(state, found.mutations);
      const after = seenBy(state);
      expect(hazards.seenOn(after, everything(after)).map((h) => h.hazard.id)).toEqual(['pit']);
      // It was always there to walk into.
      expect(hazards.enteredBy(map, { x: 2, y: 4 }, { x: 3, y: 4 })).toMatchObject({ id: 'pit' });
    });

    test('a hazard’s hidden setting is checked: true, or { dc } of a number or a rung', () => {
      const map = seenBy(save());
      const pit = map.hazards[0];
      const errors = (hiddenValue) =>
        hazards.validate(system, map, [{ ...pit, hidden: hiddenValue }]).errors;
      expect(errors(true)).toEqual([]);
      expect(errors({ dc: 14 })).toEqual([]);
      expect(errors({ dc: 'Hard' })).toEqual([]);
      expect(errors({})).toEqual([]);
      for (const bad of ['yes', 0, { dc: -1 }, { dc: '' }, { dc: 10, more: 1 }]) {
        expect(errors(bad).join(' ')).toContain('hidden must be true or { dc }');
      }
    });

    test('a thing found stays found, for that save only', () => {
      const w = world();
      const mine = save();
      applyStateMutations(mine, [
        { target: 'save', op: 'set-flag', path: 'secrets.bm_crypt.secret', value: 'found' },
      ]);
      expect(doorIds(mine, w)).toEqual(['secret']);
      // Another save of the same world finds none of it; nor does the world.
      expect(doorIds(save(), w)).toEqual([]);
      expect(doorIds(save({ secrets: { bm_crypt: { secret: 'missed' } } }), w)).toEqual([]);
      expect(doorIds(mine, w)).toEqual(['secret']);
      expect(mapDoors.doorsOf(w.battleMaps.bm_crypt)).toEqual([]);
      // The same map found the same things is the same object (what is worked out from it is kept).
      expect(seenBy(mine, w)).toBe(seenBy(mine, w));
      expect(secrets.foundIn(mine, 'bm_crypt')).toEqual(['secret']);
    });

    test('what a save has found is kept in a valid save', () => {
      const ok = validateSave({
        ...fullSave(),
        secrets: { bm_crypt: { secret: 'found', 'hazard:pit': 'missed' } },
      });
      expect(ok.errors).toEqual([]);
      const bad = validateSave({ ...fullSave(), secrets: { bm_crypt: { secret: 'maybe' } } });
      expect(bad.errors.join(' ')).toContain('secrets must be');
    });
  });

  describe('spawns', () => {
    const rowsOf = (w) => combat.spawns.encountersOf(w.locations.crypt);
    const inside = (cell, rect) =>
      cell.x * 5 + 2.5 >= rect.x &&
      cell.x * 5 + 2.5 <= rect.x + rect.w &&
      cell.y * 5 + 2.5 >= rect.y &&
      cell.y * 5 + 2.5 <= rect.y + rect.h;
    const DEN = { x: 40, y: 5, w: 15, h: 15 };
    const CORNER = { x: 5, y: 30, w: 15, h: 10 };

    test('a spawn that names its figures places its count within its area', () => {
      const w = world();
      const filled = combat.spawns.fill(w, save(), { dice: sequence(1, 4, 2, 5, 3) });
      const den = filled.groups.find((g) => g.spawn === 'den');
      expect(den).toMatchObject({
        id: 'spawn-den-1',
        name: 'Goblin',
        statBlock: 'goblin',
        side: 'hostile',
      });
      expect(den.cells).toHaveLength(2);
      // On two squares of the den, not one, and not on the entry or the player.
      expect(new Set(den.cells.map(key)).size).toBe(2);
      den.cells.forEach((cell) => expect(inside(cell, DEN)).toBe(true));
      expect(filled.mutations).toEqual([
        { target: 'save', op: 'set-flag', path: 'spawned.bm_crypt', value: filled.all },
      ]);
    });

    test('where they stand follows the dice, and differs with them', () => {
      const w = world();
      const a = combat.spawns.fill(w, save(), { dice: sequence(1, 1) });
      const b = combat.spawns.fill(w, save(), { dice: sequence(9, 7) });
      const cells = (f) => f.groups.find((g) => g.spawn === 'den').cells.map(key);
      expect(cells(a)).not.toEqual(cells(b));
    });

    test('with fewer free squares than its count it places what fits', () => {
      const w = world();
      // The player stands in the den; a count of 20 asks for more than its 9 squares hold.
      w.battleMaps.bm_crypt.geometry.spawns.find((s) => s.id === 'den').count = 20;
      const filled = combat.spawns.fill(w, save({ cell: { x: 8, y: 1 } }), { dice: high });
      const den = filled.groups.find((g) => g.spawn === 'den');
      expect(den.cells).toHaveLength(8);
      expect(den.cells.map(key)).not.toContain('8,1');
    });

    test('a generic spawn takes a row of its place’s table, by weight, so the map changes', () => {
      const rows = [
        { what: 'wolf', count: 3, weight: 1 },
        { what: 'bandit', weight: 3 },
      ];
      const w = world(rows);
      expect(rowsOf(w)).toHaveLength(2);
      // The den (first on the map) takes two dice for its goblins' squares; the table's roll is the third.
      const first = combat.spawns.fill(w, save(), { dice: sequence(1, 1, 1, 1, 1, 1) });
      const second = combat.spawns.fill(w, save(), { dice: sequence(1, 1, 4, 1, 1, 1) });
      const corner = (f) => f.groups.find((g) => g.spawn === 'corner');
      // The first roll of the table (1 of 4) is the wolves; the next (4 of 4) the bandit.
      expect(corner(first)).toMatchObject({ statBlock: 'wolf', name: 'Wolf' });
      expect(corner(first).cells).toHaveLength(3);
      corner(first).cells.forEach((cell) => expect(inside(cell, CORNER)).toBe(true));
      expect(corner(second)).toMatchObject({ statBlock: 'bandit', name: 'Bandit' });
      expect(corner(second).cells).toHaveLength(1);
      // The same map, two events, different figures.
      expect(corner(first).statBlock).not.toBe(corner(second).statBlock);
    });

    test('a generic spawn with no table, or a row naming no stat block, stays empty', () => {
      const none = combat.spawns.fill(world(), save(), { dice: sequence(1) });
      expect(none.groups.map((g) => g.spawn)).toEqual(['den']);
      const lost = combat.spawns.fill(world([{ what: 'dragon' }]), save(), { dice: sequence(1) });
      expect(lost.groups.map((g) => g.spawn)).toEqual(['den']);
    });

    test('a spawn whose figures still stand is not filled again; one whose are down is', () => {
      const w = world();
      const first = combat.spawns.fill(w, save(), { dice: high });
      const state = save({ spawned: { bm_crypt: first.all } });
      expect(combat.spawns.fill(w, state, { dice: high }).groups).toEqual([]);
      const some = save({
        spawned: { bm_crypt: first.all },
        figures: { 'fig-spawn-den-1-1': { down: 'dead' } },
      });
      expect(combat.spawns.fill(w, some, { dice: high }).groups).toEqual([]);
      const all = save({
        spawned: { bm_crypt: first.all },
        figures: {
          'fig-spawn-den-1-1': { down: 'dead' },
          'fig-spawn-den-1-2': { gone: 'fled' },
        },
      });
      const again = combat.spawns.fill(w, all, { dice: high });
      expect(again.groups.map((g) => g.id)).toEqual(['spawn-den-2']);
      expect(again.all.map((g) => g.id)).toEqual(['spawn-den-1', 'spawn-den-2']);
    });

    test('a save’s spawned figures stand on its map, and on no other save’s', () => {
      const w = world();
      const filled = combat.spawns.fill(w, save(), { dice: high });
      const mine = save({ spawned: { bm_crypt: filled.all } });
      const seen = combat.figures.withFigures(w, mine);
      const standing = Object.values(seen.characters).filter((c) => c.figure === 'spawn-den-1');
      expect(standing.map((c) => c.id)).toEqual(['fig-spawn-den-1-1', 'fig-spawn-den-1-2']);
      expect(standing[0]).toMatchObject({ name: 'Goblin 1', side: 'hostile', locationId: 'crypt' });
      standing.forEach((c) => expect(inside(c.cell, DEN)).toBe(true));
      // Not another save's, nor the world's.
      expect(Object.keys(combat.figures.withFigures(w, save()).characters)).toEqual([]);
      expect(w.characters).toEqual({});
    });

    test('an encounter table is checked against the world’s stat blocks', () => {
      const w = world();
      expect(combat.spawns.validateEncounters(w, [{ what: 'wolf', count: 3, weight: 2 }])).toEqual(
        []
      );
      expect(combat.spawns.validateEncounters(w, [{ what: 'dragon' }]).join(' ')).toContain(
        '"dragon" isn\'t one of the world\'s stat blocks'
      );
      const bad = combat.spawns.validateEncounters(w, [{ what: 'wolf', count: 0, extra: 1 }]);
      expect(bad.join(' ')).toContain('count must be a whole number from 1 to 20');
      expect(bad.join(' ')).toContain("extra isn't a field of a row");
      expect(combat.spawns.validateEncounters(w, 'wolf')).toEqual(['encounters must be a list.']);
    });

    test('spawned figures are kept in a valid save', () => {
      const filled = combat.spawns.fill(world(), save(), { dice: high });
      expect(validateSave({ ...fullSave(), spawned: { bm_crypt: filled.all } }).errors).toEqual([]);
      expect(
        validateSave({ ...fullSave(), spawned: { bm_crypt: 'goblins' } }).errors.join(' ')
      ).toContain('spawned must be');
    });
  });

  // A save the model accepts, to add one field to.
  function fullSave() {
    const { makeSave } = require('../functions/loom-models');
    return makeSave({
      ownerUid: 'player-001',
      worldId: 'crypt-world',
      name: 'Voyage',
      character: { name: 'Tam', inventory: [], sheet: sheets.defaultSheet(system) },
      location: 'crypt',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }
});

describe('a roll that finds nothing says nothing', () => {
  test('checks.notice, the skill rolled, reads as a skill check', () => {
    // The same roll a lock's is: rollCheck against the rung, the character's own skill.
    const system = BUILT_IN['d20-fantasy'];
    const roll = checks.rollCheck(system, {
      check: hidden.checkOf(system),
      character: { sheet: sheets.defaultSheet(system) },
      difficulty: hidden.difficultyOf(system, { dc: 8 }),
      dice: high,
    });
    expect(roll.success).toBe(true);
  });
});
