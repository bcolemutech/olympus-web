'use strict';

/**
 * Effects (planning/game-systems.md §3 EF2–EF7, §4.10; L-815 / #642): the
 * system's conditions as data, the effects engine (apply, refresh without
 * stacking, tick by turns and by game time, end by a save), a condition's
 * modifiers named in a check's breakdown, and areas on the grid in line of
 * effect. Under both built-in systems' conditions (MD2). Pure: no emulator.
 *
 * Run: cd tests && npx jest loom-effects --verbose
 */

const effects = require('../functions/loom-canon/effects');
const areas = require('../functions/loom-canon/areas');
const checks = require('../functions/loom-canon/checks');
const sheets = require('../functions/loom-canon/sheets');
const conditions = require('../functions/loom-canon/conditions');
const { BUILT_IN, validateSystem } = require('../functions/loom-canon/systems');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];

// Each system's own: a condition that changes checks, one that hurts each
// turn, one that stops you, the skill a save rolls, and the faces that make
// it or miss it.
const CASE = {
  'd20-fantasy': {
    checksBy: 'poisoned',
    hurts: 'burning',
    stops: 'stunned',
    save: { attribute: 'CON', against: 'Moderate' },
    make: 20,
    miss: 2,
    line: 'd20 (8) + Dexterity (0) + Stealth (0) + Poisoned (-2)',
  },
  'pool-scifi': {
    checksBy: 'rattled',
    hurts: 'bleeding',
    stops: 'stunned',
    save: { attribute: 'Body', against: 'Easy' },
    make: 9,
    miss: 2,
    line: '(Reflex (3) + Stealth (0) + Rattled (-1))d10 ≥ 7 (2)',
  },
};

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('effects under %s', (id, system) => {
  const c = CASE[id];
  const fresh = () => sheets.defaultSheet(system);
  const dice = (face) => checks.fixedDice(face);

  test('the system lists its conditions as data, and they validate (EF3)', () => {
    const { errors, warnings } = validateSystem(system);
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(system.sheet.optional).toContain('conditions');
    expect(conditions.conditionOf(system, c.hurts).each).toBeDefined();
    expect(conditions.conditionOf(system, c.stops)).toMatchObject({ noAction: true, noMove: true });
  });

  test('apply: on, with how long it has left', () => {
    const r = effects.apply(
      system,
      fresh(),
      { condition: c.hurts, duration: { turns: 2 } },
      { now: 100 }
    );
    expect(r.outcome).toBe('applied');
    expect(r.sheet.conditions).toEqual([
      { condition: c.hurts, duration: { turns: 2 }, since: 100 },
    ]);
    expect(r.line).toMatch(/\(2 turns\)\.$/);
    expect(sheets.validateSheet(system, r.sheet)).toEqual([]);
  });

  test('a save when it lands resists it; a missed one lets it on', () => {
    const effect = {
      condition: c.hurts,
      duration: { turns: 2 },
      save: { ...c.save, when: 'apply' },
    };
    const resisted = effects.apply(system, fresh(), effect, { dice: dice(c.make) });
    expect(resisted.outcome).toBe('resisted');
    expect(resisted.roll.success).toBe(true);
    expect(resisted.sheet.conditions).toEqual([]);
    const missed = effects.apply(system, fresh(), effect, { dice: dice(c.miss) });
    expect(missed.outcome).toBe('applied');
    expect(missed.roll.success).toBe(false);
    expect(missed.sheet.conditions[0].save).toMatchObject({
      difficulty: { name: c.save.against },
      when: ['apply'],
    });
  });

  test('refresh, never stacked: longer or harder replaces it, anything else keeps it (EF6)', () => {
    let sheet = effects.apply(system, fresh(), {
      condition: c.hurts,
      duration: { turns: 2 },
    }).sheet;
    const shorter = effects.apply(system, sheet, { condition: c.hurts, duration: { turns: 1 } });
    expect(shorter.outcome).toBe('kept');
    expect(shorter.sheet.conditions).toEqual(sheet.conditions);
    const longer = effects.apply(system, sheet, { condition: c.hurts, duration: { turns: 3 } });
    expect(longer.outcome).toBe('replaced');
    expect(longer.sheet.conditions).toHaveLength(1);
    expect(longer.sheet.conditions[0].duration).toEqual({ turns: 3 });
    sheet = longer.sheet;
    const ladder = system.checks.ladder;
    const harder = effects.apply(system, sheet, {
      condition: c.hurts,
      duration: { turns: 1 },
      save: { ...c.save, against: ladder[ladder.length - 1].name, when: 'endOfTurn' },
    });
    expect(harder.outcome).toBe('replaced');
    expect(harder.sheet.conditions).toHaveLength(1);
  });

  test('ticked by End turn: damage each turn, a turn off, then it wears off', () => {
    let sheet = effects.apply(system, fresh(), {
      condition: c.hurts,
      duration: { turns: 2 },
    }).sheet;
    const full = sheet.resources.health.current;
    let t = effects.endOfTurn(system, sheet, { now: 6, dice: dice(3) });
    const lost = full - t.sheet.resources.health.current;
    expect(lost).toBeGreaterThan(0);
    expect(t.lines[0]).toMatch(new RegExp(`${lost} lost`));
    expect(t.sheet.conditions[0].duration).toEqual({ turns: 1 });
    t = effects.endOfTurn(system, t.sheet, { now: 12, dice: dice(3) });
    expect(t.sheet.conditions).toEqual([]);
    expect(t.lines[t.lines.length - 1]).toMatch(/wears off\.$/);
    // Never below 0.
    sheet = effects.apply(system, fresh(), { condition: c.hurts, duration: { turns: 50 } }).sheet;
    for (let i = 0; i < 20; i++) sheet = effects.endOfTurn(system, sheet, { dice: dice(4) }).sheet;
    expect(sheet.resources.health.current).toBe(0);
  });

  test('ticked by game time: a long wait outlasts it', () => {
    const sheet = effects.apply(
      system,
      fresh(),
      {
        condition: c.checksBy,
        duration: { seconds: 600 },
      },
      { now: 1000 }
    ).sheet;
    expect(effects.expire(system, sheet, 1500).sheet.conditions).toHaveLength(1);
    const done = effects.expire(system, sheet, 1600);
    expect(done.sheet.conditions).toEqual([]);
    expect(done.lines).toEqual([`${conditions.conditionOf(system, c.checksBy).name} wears off.`]);
    // And at the end of a turn that brings the clock past it.
    expect(effects.endOfTurn(system, sheet, { now: 1600, dice: dice(1) }).sheet.conditions).toEqual(
      []
    );
  });

  test('ended by a save at the end of a turn; until saved lasts until then', () => {
    const effect = {
      condition: c.checksBy,
      duration: { untilSaved: true },
      save: { ...c.save, when: 'endOfTurn' },
    };
    expect(effects.validateEffect(system, effect)).toEqual([]);
    const sheet = effects.apply(system, fresh(), effect).sheet;
    const missed = effects.endOfTurn(system, sheet, { dice: dice(c.miss) });
    expect(missed.sheet.conditions).toHaveLength(1);
    expect(missed.rolls).toHaveLength(1);
    expect(missed.rolls[0].roll.success).toBe(false);
    const made = effects.endOfTurn(system, missed.sheet, { dice: dice(c.make) });
    expect(made.sheet.conditions).toEqual([]);
    expect(made.lines).toEqual([
      `You shake off ${conditions.conditionOf(system, c.checksBy).name}.`,
    ]);
  });

  test('a condition’s modifiers join a check, named in its breakdown', () => {
    const sheet = effects.apply(system, fresh(), {
      condition: c.checksBy,
      duration: { turns: 1 },
    }).sheet;
    const plain = checks.rollCheck(system, {
      check: { skill: 'Stealth' },
      character: { sheet: fresh() },
      dice: dice(8),
    });
    const roll = checks.rollCheck(system, {
      check: { skill: 'Stealth' },
      character: { sheet },
      dice: dice(8),
    });
    expect(roll.breakdown.named).toBe(c.line);
    expect(roll.total).toBeLessThan(plain.total + (id === 'pool-scifi' ? 1 : 0));
    if (id === 'd20-fantasy') expect(roll.total).toBe(plain.total - 2);
    else expect(roll.breakdown.terms.find((t) => t.kind === 'count').rolls).toHaveLength(2);
  });

  test('flags: one that stops you is told apart', () => {
    const sheet = effects.apply(system, fresh(), {
      condition: c.stops,
      duration: { turns: 1 },
    }).sheet;
    expect(conditions.flagsOf(system, sheet)).toEqual({
      noAction: ['Stunned'],
      noMove: ['Stunned'],
    });
    expect(conditions.flagsOf(system, fresh())).toEqual({ noAction: [], noMove: [] });
  });

  test('an effect is checked against the system, each problem named', () => {
    expect(
      effects.validateEffect(system, {
        condition: 'zapped',
        duration: { turns: 0 },
        save: { skill: 'Juggling', against: 'Very hard indeed', when: 'never' },
      })
    ).toEqual([
      expect.stringMatching(/^There is no condition "zapped"/),
      'duration.turns must be a whole number from 1 to 100.',
      'save: There is no skill "Juggling" in this world’s rules.',
      expect.stringMatching(/^save.against "Very hard indeed" is no rung/),
      'save.when must be apply, endOfTurn, or both.',
    ]);
    expect(
      effects.validateEffect(system, { condition: c.hurts, duration: { untilSaved: true } })
    ).toEqual(['An effect until saved needs a save at the end of each turn (when: endOfTurn).']);
  });
});

describe('a condition that changes the sheet (both systems)', () => {
  test('Prone slows you; an attribute penalty is read by a check and the sheet', () => {
    const prone = effects.apply(FANTASY, sheets.defaultSheet(FANTASY), {
      condition: 'prone',
      duration: { turns: 1 },
    }).sheet;
    expect(sheets.apFor(FANTASY, prone)).toBe(10);
    const weak = {
      ...SCIFI,
      sheet: {
        ...SCIFI.sheet,
        conditions: [
          ...SCIFI.sheet.conditions,
          { id: 'drained', name: 'Drained', modifiers: { Body: '-1', health: '-2' } },
        ],
      },
    };
    expect(validateSystem(weak).errors).toEqual([]);
    const sheet = effects.apply(weak, sheets.defaultSheet(weak), {
      condition: 'drained',
      duration: { turns: 1 },
    }).sheet;
    // Health 3 + Body: Body 3 → 2, then 2 less: 3, and the current is held to it.
    expect(sheets.maxima(weak, sheet).health).toBe(3);
    expect(sheet.resources.health.current).toBe(3);
    expect(sheets.validateSheet(weak, sheet)).toEqual([]);
    const roll = checks.rollCheck(weak, {
      check: { skill: 'Athletics' },
      character: { sheet },
      dice: () => 9,
    });
    expect(roll.breakdown.named).toBe('(Body (2) + Athletics (0))d10 ≥ 7 (2)');
  });

  test('rolling under: a penalty lowers what the roll must be under', () => {
    const under = {
      ...FANTASY,
      id: 'under',
      checks: { ...FANTASY.checks, formula: 'd100 <= Stealth * 10', degrees: {} },
    };
    const sheet = effects.apply(under, sheets.defaultSheet(under), {
      condition: 'poisoned',
      duration: { turns: 1 },
    }).sheet;
    const roll = checks.rollCheck(under, {
      check: { skill: 'Stealth' },
      character: { sheet },
      dice: () => 1,
    });
    expect(roll.breakdown.named).toBe('d100 (1) <= Stealth (0) * 10 + Poisoned (-2)');
    expect(roll.success).toBe(false);
  });
});

// ── Areas (EF2, EF7) ──────────────────────────────────────────────────

describe('areas on a grid, in line of effect', () => {
  const open = { width: 9, height: 9, walls: [], doors: [], obstacles: [] };
  const picture = (squares) =>
    Array.from({ length: open.height }, (_, y) =>
      Array.from({ length: open.width }, (_, x) => (squares[`${x},${y}`] ? '#' : '.')).join('')
    );

  test('a burst: every square within its radius, as movement counts squares', () => {
    expect(picture(areas.squaresOf(open, { shape: 'burst', x: 4, y: 4, radius: 1 }))).toEqual([
      '.........',
      '.........',
      '.........',
      '...###...',
      '...###...',
      '...###...',
      '.........',
      '.........',
      '.........',
    ]);
  });

  test('a cone: a quarter out from beside its origin, 90° wide', () => {
    expect(
      picture(areas.squaresOf(open, { shape: 'cone', x: 4, y: 4, length: 2, facing: 'north' }))
    ).toEqual([
      '.........',
      '.........',
      '..#####..',
      '...###...',
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
  });

  test('a line: a strip out from beside its origin, diagonals counted as one square', () => {
    expect(
      picture(
        areas.squaresOf(open, { shape: 'line', x: 0, y: 4, length: 3, facing: 'east', width: 1 })
      )
    ).toEqual([
      '.........',
      '.........',
      '.........',
      '.........',
      '.###.....',
      '.........',
      '.........',
      '.........',
      '.........',
    ]);
    const diagonal = areas.squaresOf(open, {
      shape: 'line',
      x: 0,
      y: 0,
      length: 3,
      facing: 'southeast',
    });
    expect(Object.keys(diagonal).sort()).toEqual(['1,1', '2,2', '3,3']);
  });

  test('a square (or a cube): its origin the top-left', () => {
    expect(
      Object.keys(areas.squaresOf(open, { shape: 'square', x: 7, y: 7, size: 3 })).sort()
    ).toEqual(['7,7', '7,8', '8,7', '8,8']);
  });

  test('a wall blocks it, and a closed door does until it is open', () => {
    // A wall down the line x = 5, with a door in it at y 4.
    const walled = {
      ...open,
      walls: [
        {
          points: [
            { x: 5, y: 0 },
            { x: 5, y: 4 },
          ],
        },
        {
          points: [
            { x: 5, y: 5 },
            { x: 5, y: 9 },
          ],
        },
      ],
      doors: [{ id: 'door', name: 'the door', from: { x: 5, y: 4 }, to: { x: 5, y: 5 } }],
    };
    const burst = { shape: 'burst', x: 4, y: 4, radius: 2 };
    const shut = areas.squaresOf(walled, burst);
    expect(Object.keys(shut).filter((k) => Number(k.split(',')[0]) >= 5)).toEqual([]);
    expect(shut['3,4'] && shut['4,6']).toBe(true);
    const opened = areas.squaresOf(walled, burst, { states: { door: 'open' } });
    expect(opened['5,4'] && opened['6,4']).toBe(true);
  });

  test('an aura moves with its source; the source is left out of who it catches', () => {
    const aura = { shape: 'aura', radius: 1 };
    const here = areas.squaresOf(open, aura, { at: { x: 1, y: 1 } });
    const there = areas.squaresOf(open, aura, { at: { x: 6, y: 6 } });
    expect(here['0,0'] && !here['6,6']).toBe(true);
    expect(there['6,6'] && there['7,7'] && !there['1,1']).toBe(true);
    const people = [
      { id: 'source', cell: { x: 6, y: 6 } },
      { id: 'near', cell: { x: 7, y: 6 } },
      { id: 'far', cell: { x: 0, y: 0 } },
    ];
    expect(areas.caught(there, people, { sourceId: 'source' }).map((p) => p.id)).toEqual(['near']);
    expect(
      areas.caught(there, people, { sourceId: 'source', includeSource: true }).map((p) => p.id)
    ).toEqual(['source', 'near']);
  });

  test('a bad area is refused, each problem named', () => {
    expect(areas.validateArea(open, { shape: 'blob' })).toEqual([
      'area.shape must be one of burst, cone, line, square, aura.',
    ]);
    expect(
      areas.validateArea(open, { shape: 'cone', x: 20, y: 0, length: 0, facing: 'up' })
    ).toEqual([
      'area x, y must be a square on the 9 × 9 grid.',
      'area.length must be a whole number of squares from 1 to 30.',
      'area.facing must be one of north, south, east, west, northeast, northwest, southeast, southwest.',
    ]);
  });
});
