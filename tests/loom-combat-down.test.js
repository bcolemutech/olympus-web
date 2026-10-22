'use strict';

/**
 * Falling to 0, and rest (planning/combat.md §3 DF1–DF3, DF5, §4.7; L-827 /
 * #659), pure, under both built-in systems (MD2): the down and rests
 * settings checked; each down kind; dying saves; the aftermath (helped,
 * alone with death on, a fate with death off); coming round with the
 * system's injury; the fates; the world's death setting; short and long
 * rests, once a day, and broken by danger.
 *
 * Run: cd tests && npx jest loom-combat-down --verbose
 */

const { validateSystem, BUILT_IN } = require('../functions/loom-canon/systems');
const sheets = require('../functions/loom-canon/sheets');
const clock = require('../functions/loom-canon/clock');
const { down, rests } = require('../functions/loom-modules/combat');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const copyOf = (v) => JSON.parse(JSON.stringify(v));

// Dice that roll these faces in turn, then the last one forever.
const faces = (...list) => {
  let i = 0;
  return (sides) => Math.min(sides, list[Math.min(i++, list.length - 1)]);
};

const worldOf = (system, patch = {}) => ({
  id: 'w',
  system,
  rules: {},
  locations: {
    ruin: {
      id: 'ruin',
      name: 'Ruin',
      geo: { kind: 'poi', x: 10, y: 10 },
      connections: [],
      danger: patch.danger,
    },
    far: { id: 'far', name: 'Farhold', geo: { kind: 'settlement', x: 90, y: 90 }, connections: [] },
    near: {
      id: 'near',
      name: 'Nearby',
      geo: { kind: 'settlement', x: 15, y: 12 },
      connections: [],
    },
  },
  places: {},
  characters: {},
  battleMaps: {},
  ...patch,
});
const hurt = (system, health = 0) => {
  const sheet = sheets.defaultSheet(system);
  sheet.resources.health.current = health;
  return sheet;
};

describe('the settings', () => {
  test('the built-ins’ pass', () => {
    for (const system of [FANTASY, SCIFI]) {
      expect(validateSystem(system)).toMatchObject({ errors: [], warnings: [] });
    }
    expect(SCIFI.sheet.conditions.map((c) => c.id)).toContain('wounded');
  });

  test('bad ones are refused, each said', () => {
    const s = { ...copyOf(FANTASY), id: 'my-copy' };
    s.modules.combat.down = {
      kind: 'asleep',
      death: 'maybe',
      stabilise: { skill: 'Juggling', against: 'Easy' },
      need: 0,
      injury: 'cursed',
    };
    s.modules.combat.rests = {
      short: { hours: 0, restore: { mana: '1' } },
      nap: {},
      long: { hours: 8, restore: { health: 'full' }, clears: ['gloomy'] },
    };
    const { errors } = validateSystem(s);
    expect(errors).toEqual(
      expect.arrayContaining([
        'modules.combat.down.kind must be one of dyingWithSaves, wounds, outAtOnce.',
        'modules.combat.down.death must be on or off.',
        'modules.combat.down.stabilise.skill "Juggling" isn\'t one of the system\'s skills.',
        'modules.combat.down.need must be a whole number from 1 to 24.',
        'modules.combat.down.injury "cursed" isn\'t one of the system\'s conditions.',
        'modules.combat.rests.short.hours must be a whole number from 1 to 24.',
        'modules.combat.rests.short.restore: "mana" isn\'t one of the system\'s resources.',
        'modules.combat.rests: "nap" isn\'t a rest (short, long).',
        'modules.combat.rests.long.clears: "gloomy" isn\'t one of the system\'s conditions.',
      ])
    );
    s.modules.combat.down = { kind: 'dyingWithSaves' };
    expect(validateSystem(s).errors).toContain(
      'modules.combat.down.save is needed to roll each round.'
    );
  });
});

describe('falling to 0 (DF1)', () => {
  test('d20 fantasy: dying', () => {
    expect(down.fall(FANTASY, hurt(FANTASY))).toMatchObject({
      down: { kind: 'dying', successes: 0, failures: 0 },
      lines: ['You fall, dying.'],
    });
  });

  test('dice-pool sci-fi: out at once', () => {
    expect(down.fall(SCIFI, hurt(SCIFI))).toMatchObject({
      down: { kind: 'out' },
      lines: ['You fall, out cold.'],
    });
  });

  test('wounds: a wound keeps them up at 1, until the last', () => {
    const s = copyOf(SCIFI);
    s.modules.combat.down = { kind: 'wounds', wounds: 2 };
    let fell = down.fall(s, hurt(s));
    expect(fell.down).toBeNull();
    expect(fell.sheet.resources.health.current).toBe(1);
    expect(fell.lines).toEqual(['You take a wound (1 of 2) and stay on your feet.']);
    fell = down.fall(s, {
      ...fell.sheet,
      resources: { ...fell.sheet.resources, health: { current: 0 } },
    });
    expect(fell.sheet.wounds).toBe(2);
    fell = down.fall(s, {
      ...fell.sheet,
      resources: { ...fell.sheet.resources, health: { current: 0 } },
    });
    expect(fell.down).toEqual({ kind: 'out' });
  });

  test('dying saves: three of one kind decide it', () => {
    let state = { kind: 'dying', successes: 0, failures: 0 };
    const sheet = hurt(FANTASY);
    const rolls = [];
    for (let i = 0; i < 3; i++) {
      const s = down.deathSave(FANTASY, sheet, state, faces(2));
      state = s.down;
      rolls.push(s.outcome);
    }
    expect(rolls).toEqual([null, null, 'dead']);
    expect(state.failures).toBe(3);
    const held = down.deathSave(
      FANTASY,
      sheet,
      { kind: 'dying', successes: 2, failures: 1 },
      faces(15)
    );
    expect(held).toMatchObject({ outcome: 'stable', down: { kind: 'stable', successes: 3 } });
    expect(held.line).toBe('A dying save holds (3 of 3). You are stable.');
  });
});

describe('afterwards (DF2, DF3)', () => {
  const dying = { kind: 'dying', successes: 0, failures: 0 };

  test('helped: an ally stabilises them, and they come round', () => {
    const after = down.aftermath(worldOf(FANTASY), {
      sheet: hurt(FANTASY),
      down: dying,
      winner: 'party',
      allies: [sheets.defaultSheet(FANTASY)],
      dice: faces(15, 3),
    });
    expect(after).toMatchObject({ outcome: 'wake', hours: 3 });
    expect(after.lines[0]).toBe('Your allies stabilise you.');
  });

  test('alone, death on: their saves decide; failing, they die', () => {
    const world = worldOf(FANTASY);
    expect(down.deathOf(world)).toBe('on');
    const dead = down.aftermath(world, {
      sheet: hurt(FANTASY),
      down: dying,
      winner: 'hostile',
      dice: faces(2),
    });
    expect(dead.outcome).toBe('dead');
    const left = down.aftermath(world, {
      sheet: hurt(FANTASY),
      down: dying,
      winner: 'hostile',
      dice: faces(15),
    });
    expect(left).toMatchObject({ outcome: 'wake' });
    expect(left.lines[left.lines.length - 1]).toMatch(/^Left for dead, you come round/);
  });

  test('out with no one to help: death on, they die; off, a fate', () => {
    const out = { kind: 'out' };
    expect(
      down.aftermath(worldOf(SCIFI, { rules: { death: 'on' } }), {
        sheet: hurt(SCIFI),
        down: out,
        winner: 'hostile',
        dice: faces(5),
      })
    ).toMatchObject({ outcome: 'dead', lines: ['No one comes. You die where you fell.'] });
    expect(down.deathOf(worldOf(SCIFI))).toBe('off');
    expect(
      down.aftermath(worldOf(SCIFI), {
        sheet: hurt(SCIFI),
        down: out,
        winner: 'hostile',
        dice: faces(5),
      })
    ).toMatchObject({ outcome: 'fate', hours: 4 });
    // Death off in a fantasy world: dying alone is a fate too, no saves.
    expect(
      down.aftermath(worldOf(FANTASY, { rules: { death: 'off' } }), {
        sheet: hurt(FANTASY),
        down: dying,
        winner: 'hostile',
        dice: faces(2),
      })
    ).toMatchObject({ outcome: 'fate' });
  });

  test('coming round: 1 health, the system’s injury on, hours later', () => {
    const save = { time: 1000, character: { sheet: hurt(SCIFI) } };
    const muts = down.wakeMutations(worldOf(SCIFI), save, { sheet: hurt(SCIFI), hours: 2 });
    const sheet = muts.find((m) => m.path === 'character.sheet').value;
    expect(sheet.resources.health.current).toBe(1);
    expect(sheet.conditions).toEqual([expect.objectContaining({ condition: 'wounded' })]);
    expect(muts).toContainEqual(expect.objectContaining({ path: 'down', value: null }));
    expect(muts).toContainEqual(
      expect.objectContaining({ path: 'time', value: 1000 + 2 * clock.HOUR })
    );
    // Fantasy has no injury.
    const plain = down.wakeMutations(
      worldOf(FANTASY),
      { time: 0 },
      { sheet: hurt(FANTASY), hours: 1 }
    );
    expect(plain.find((m) => m.path === 'character.sheet').value.conditions).toEqual([]);
  });

  test('the fates: rescued and captured to the nearest settlement; robbed where they fell', () => {
    const world = worldOf(SCIFI);
    const save = {
      time: 0,
      location: 'ruin',
      mapId: 'bm',
      cell: { x: 1, y: 1 },
      character: { sheet: hurt(SCIFI), inventory: ['a lamp'] },
    };
    const rescued = down.fateMutations(world, save, 'rescued', { sheet: hurt(SCIFI) });
    expect(rescued.mutations).toContainEqual(
      expect.objectContaining({ path: 'location', value: 'near' })
    );
    expect(rescued.mutations).toContainEqual(
      expect.objectContaining({ path: 'mapId', value: null })
    );
    expect(rescued.line).toBe('You come round hours later in Nearby: someone carried you there.');
    const captured = down.fateMutations(world, save, 'captured', { sheet: hurt(SCIFI) });
    expect(captured.mutations).toContainEqual(
      expect.objectContaining({ path: 'privateFlags.captured', value: true })
    );
    const robbed = down.fateMutations(world, save, 'robbed', { sheet: hurt(SCIFI) });
    expect(robbed.mutations).toContainEqual(
      expect.objectContaining({ path: 'character.inventory', value: [] })
    );
    expect(robbed.mutations.find((m) => m.path === 'location')).toBeUndefined();
    // Anything else is a rescue.
    expect(down.fateMutations(world, save, 'eaten', { sheet: hurt(SCIFI) }).fate).toBe('rescued');
  });

  test('death ends the save', () => {
    expect(down.deathMutations({ time: 500 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'ended', value: { how: 'died', at: 500 } }),
        expect.objectContaining({ path: 'fight', value: null }),
      ])
    );
  });
});

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('rests under %s (DF5)', (id, system) => {
  const saveOf = (patch = {}) => ({
    location: 'ruin',
    time: 10 * clock.HOUR,
    character: { name: 'Tam', sheet: hurt(system, 1) },
    ...patch,
  });

  test('a short rest: an hour, restoring by its formulas', () => {
    const r = rests.rest(worldOf(system), saveOf(), 'short', { dice: faces(4) });
    expect(r).toMatchObject({ hours: 1, interrupted: null, to: 11 * clock.HOUR });
    if (id === 'd20-fantasy')
      expect(r.sheet.resources.health.current).toBe(5); // 1 + d6 (4)
    else expect(r.sheet.resources.stress.current).toBe(sheets.maxima(system, r.sheet).stress);
  });

  test('a long rest: 8 hours, everything back, once a day; it clears what it says', () => {
    const sheet = hurt(system, 1);
    const clears = system.modules.combat.rests.long.clears[0];
    sheet.conditions = [{ condition: clears, duration: { seconds: 30 * clock.DAY }, since: 0 }];
    const r = rests.rest(worldOf(system), saveOf({ character: { sheet } }), 'long', {
      dice: faces(4),
    });
    expect(r).toMatchObject({ hours: 8, rested: { long: 18 * clock.HOUR } });
    expect(r.sheet.resources.health.current).toBe(sheets.maxima(system, r.sheet).health);
    expect(r.sheet.conditions).toEqual([]);
    const again = rests.rest(
      worldOf(system),
      saveOf({ time: 20 * clock.HOUR, rested: r.rested }),
      'long',
      {
        dice: faces(4),
      }
    );
    expect(again.refused).toMatch(
      /^You've had your long rest today\. You can rest long again from /
    );
    const tomorrow = rests.rest(
      worldOf(system),
      saveOf({ time: 18 * clock.HOUR + clock.DAY, rested: r.rested }),
      'long',
      { dice: faces(4) }
    );
    expect(tomorrow.refused).toBeUndefined();
  });

  test('somewhere dangerous, a roll can break it: no more time, nothing restored', () => {
    const r = rests.rest(worldOf(system, { danger: 'high' }), saveOf(), 'long', {
      dice: faces(6, 6, 2),
    });
    expect(r).toMatchObject({ interrupted: 3, hours: 3, to: 13 * clock.HOUR });
    expect(r.sheet.resources.health.current).toBe(1);
    expect(r.lines[0]).toBe('Your long rest is broken after 2 hours: something is coming.');
    // Nowhere dangerous, no roll.
    expect(
      rests.rest(worldOf(system), saveOf(), 'long', { dice: faces(1) }).interrupted
    ).toBeNull();
  });
});
