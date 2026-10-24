'use strict';

/**
 * Character sheets on saves (planning/game-systems.md §3 CS1–CS4, CS9, SY2,
 * §4.2; L-811 / #638): a sheet shaped by the world's system, checked against
 * it; checks reading its scores, ranks and resources; speed and traits
 * moved in; a sheet a changed system no longer fits, named and told to
 * NARRATE; and the backfill for older saves. By the two-configuration rule
 * (MD2), each runs under both built-in systems.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-sheets --verbose"
 */

const PROJECT = 'demo-loom-sheets';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;

const sheets = require('../functions/loom-canon/sheets');
const checks = require('../functions/loom-canon/checks');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { apOf, makeSave, validateSave } = require('../functions/loom-models');
const town = require('../functions/loom-canon/town');

const FANTASY = BUILT_IN['d20-fantasy'];
const SCIFI = BUILT_IN['pool-scifi'];
const { defaultSheet, validateSheet } = sheets;

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('a sheet under %s', (id, system) => {
  const fantasy = id === 'd20-fantasy';
  const firstAttr = system.sheet.attributes[0];

  test('the defaults: the middle of each range, untrained, the lowest level, full', () => {
    const sheet = defaultSheet(system, { traits: ['swim', 'swim', 'climb'] });
    expect(validateSheet(system, sheet)).toEqual([]);
    expect(sheet.attributes[firstAttr.id]).toBe(fantasy ? 10 : 3);
    expect(Object.values(sheet.skills).every((r) => r === 0)).toBe(true);
    expect(Object.keys(sheet.skills)).toEqual(system.sheet.skills.map((k) => k.id));
    expect(sheet.level).toBe(1);
    // Hit points 6 at level 1 with CON 10; health 3 + Body 3 and stress 3 + Presence 3.
    expect(sheet.resources).toEqual(
      fantasy ? { health: { current: 6 } } : { health: { current: 6 }, stress: { current: 6 } }
    );
    expect(sheet).toMatchObject({ traits: ['swim', 'climb'], conditions: [], ap: 20 });
  });

  test('a bad sheet is refused, each problem named', () => {
    const sheet = defaultSheet(system);
    sheet.attributes[firstAttr.id] = firstAttr.max + 1;
    sheet.attributes.Luck = 3;
    sheet.skills.Stealth = -1;
    sheet.skills.Juggling = 1;
    delete sheet.resources.health;
    sheet.resources.mana = { current: 1 };
    sheet.level = 0;
    sheet.traits = ['swim', 'two words'];
    sheet.conditions = [{}];
    expect(validateSheet(system, sheet)).toEqual([
      `${firstAttr.name} is ${firstAttr.max + 1}; it must be a whole number from ${firstAttr.min} to ${firstAttr.max}.`,
      'There is no attribute "Luck" in this world\'s rules.',
      'Stealth is -1; a rank is a whole number from 0 to 20.',
      'There is no skill "Juggling" in this world\'s rules.',
      `The level is 0; it must be from 1 to ${system.sheet.level.max}.`,
      `${system.sheet.resources[0].name} (health) has no current value.`,
      'There is no resource "mana" in this world\'s rules.',
      'The trait "two words" isn\'t an id (letters, digits, - and _).',
      'conditions[0] needs its condition.',
    ]);
    expect(validateSheet(system, null)).toEqual(['The sheet must be an object.']);
  });

  test('a resource above its maximum is refused; the maximum follows the sheet', () => {
    const sheet = defaultSheet(system);
    const max = sheets.maxima(system, sheet).health;
    sheet.resources.health.current = max + 1;
    expect(validateSheet(system, sheet)).toEqual([
      `${system.sheet.resources[0].name} is ${max + 1}; it must be a whole number from 0 to ${max}.`,
    ]);
    // A tougher character has more.
    const tough = defaultSheet(system);
    if (fantasy) tough.attributes.CON = 16;
    else tough.attributes.Body = 5;
    expect(sheets.maxima(system, tough).health).toBeGreaterThan(max);
  });

  test('a check reads the sheet’s scores, ranks and resources', () => {
    const sheet = defaultSheet(system);
    if (fantasy) sheet.attributes.DEX = 16;
    else sheet.attributes.Reflex = 5;
    sheet.skills.Stealth = 2;
    sheet.resources.health.current = 1;
    const roll = checks.rollCheck(system, {
      check: { skill: 'Stealth', rung: 'Easy' },
      character: { sheet },
      dice: checks.fixedDice(fantasy ? 10 : 7),
    });
    // d20 10 + DEX 16's +3 + Stealth 2; or seven d10s all counting.
    expect(roll.total).toBe(fantasy ? 15 : 7);
    expect(roll.breakdown.named).toBe(
      fantasy ? 'd20 (10) + Dexterity (3) + Stealth (2)' : '(Reflex (5) + Stealth (2))d10 ≥ 7 (7)'
    );
    const { values } = checks.valuesFor(system, { sheet }, { skill: 'Stealth' }, () => 1);
    expect(values.health).toBe(1);
    // Without a sheet: the defaults, every resource full.
    const bare = checks.valuesFor(system, null, { skill: 'Stealth' }, () => 1).values;
    expect(bare.health).toBe(6);
  });

  test('a changed system flags what no longer fits (SY2)', () => {
    const sheet = defaultSheet(system, { traits: ['swim'] });
    const changed = JSON.parse(JSON.stringify(system));
    changed.sheet.attributes = changed.sheet.attributes.slice(1);
    changed.sheet.skills = changed.sheet.skills
      .filter((k) => k.attribute !== firstAttr.id)
      .map((k) => (k.id === 'Stealth' ? { ...k, id: 'Sneak', name: 'Sneak' } : k));
    changed.sheet.attributes[0].max = 2;
    const second = system.sheet.attributes[1];
    expect(require('../functions/loom-canon/systems').misfits(changed, sheet)).toEqual(
      expect.arrayContaining([
        `There is no attribute "${firstAttr.id}" in this world's rules.`,
        `${second.name} is ${sheet.attributes[second.id]}; it must be a whole number from ${second.min} to 2.`,
        'Sneak (Sneak) has no rank.',
        'There is no skill "Stealth" in this world\'s rules.',
      ])
    );
  });
});

describe.each([
  ['d20-fantasy', FANTASY],
  ['pool-scifi', SCIFI],
])('the pool of action points, worked out by formula under %s', (id, system) => {
  const fantasy = id === 'd20-fantasy';
  // A copy with a trait that adds AP, taken at creation (L-812).
  const withFleet = () => {
    const copy = JSON.parse(JSON.stringify(system));
    copy.sheet.traits = [{ id: 'fleet', name: 'Fleet of foot', modifiers: { ap: '5' } }];
    return copy;
  };

  test('from attributes and skill ranks: 20 at the defaults, more with training', () => {
    const sheet = defaultSheet(system);
    expect(sheets.apFor(system, sheet)).toBe(20);
    if (fantasy) {
      sheet.attributes.DEX = 16; // +3
      sheet.skills.Athletics = 4; // +2
    } else {
      sheet.attributes.Reflex = 5; // +4
      sheet.skills.Athletics = 1; // +1
    }
    expect(sheets.apFor(system, sheet)).toBe(25);
  });

  test('a trait adds what it says, only while held; a system checks its traits’ bonuses', () => {
    const fleet = withFleet();
    expect(require('../functions/loom-canon/systems').validateSystem(fleet).errors).toEqual([]);
    expect(sheets.apFor(fleet, defaultSheet(fleet, { traits: ['fleet'] }))).toBe(25);
    expect(sheets.apFor(fleet, defaultSheet(fleet))).toBe(20);
    fleet.sheet.traits[0].modifiers = { charm: '2' };
    expect(require('../functions/loom-canon/systems').validateSystem(fleet).errors).toEqual([
      'sheet.traits[0].modifiers: "charm" isn\'t something a trait changes (ap).',
    ]);
  });

  test('worked out again on load, whatever was stored; never below 1', () => {
    const sheet = { ...defaultSheet(system), ap: 99, speed: 98 };
    const save = { character: { name: 'Tam', sheet } };
    const loaded = sheets.withAp(save, system);
    expect(apOf(loaded)).toBe(20);
    // A sheet from before AP has its speed dropped once worked out (L-832).
    expect(loaded.character.sheet.speed).toBeUndefined();
    const crawl = JSON.parse(JSON.stringify(system));
    crawl.sheet.ap = '1 - level * 5';
    expect(sheets.apFor(crawl, sheet)).toBe(1);
    // No AP formula: the default.
    delete crawl.sheet.ap;
    expect(sheets.apFor(crawl, sheet)).toBe(20);
    // A save without a sheet is as it was.
    const older = { character: { name: 'Tam', speed: 4 } };
    expect(sheets.withAp(older, system)).toBe(older);
  });
});

describe('moved in: the pool, traits and condition (CS4)', () => {
  const sheet = { ...defaultSheet(FANTASY, { traits: ['climbing'] }), ap: 6 };

  test('the pool (as worked out) and traits come from the sheet, or an older character’s own', () => {
    expect(apOf({ character: { name: 'Tam', sheet } })).toBe(6);
    expect(apOf({ character: { name: 'Tam', speed: 4 } })).toBe(4);
    expect(apOf({ character: { name: 'Tam' } })).toBe(20);
    expect(sheets.traitsOf({ character: { sheet } })).toEqual(['climbing']);
    expect(sheets.traitsOf({ character: { abilities: ['swim'] } })).toEqual(['swim']);
    const tower = { rules: { requiresAbility: 'climbing' } };
    expect(town.missingAbility(tower, { character: { sheet } })).toBeNull();
    expect(town.missingAbility(tower, { character: { abilities: [] } })).toBe('climbing');
  });

  test('a save with a sheet is valid without the old fields; an older one still is', () => {
    const withSheet = makeSave({
      ownerUid: 'u',
      worldId: 'w',
      name: 'S',
      character: { name: 'Tam', sheet },
      location: 'loc',
    });
    expect(withSheet.character).toEqual({ name: 'Tam', inventory: [], goals: [], sheet });
    expect(validateSave(withSheet).valid).toBe(true);
    const older = makeSave({
      ownerUid: 'u',
      worldId: 'w',
      name: 'S',
      character: { name: 'Tam', abilities: ['swim'] },
      location: 'loc',
    });
    expect(older.character).toMatchObject({ condition: 'healthy', abilities: ['swim'] });
    expect(validateSave(older).valid).toBe(true);
  });
});

// ── NARRATE is told what no longer fits ───────────────────────────────

const mockNarrate = [];
jest.mock('../functions/gemini', () => ({
  callGemini: async (options) => {
    if (options.systemInstruction.includes('summarizer')) return 'A summary.';
    if (options.systemInstruction.includes('INTERPRET stage')) {
      return { verb: 'look', targets: [], params: {} };
    }
    mockNarrate.push(options);
    return { narration: 'It happens.', inventedEntities: [], suggestedActions: [] };
  },
}));
jest.mock('../functions/loom-canon', () => require('./helpers/coast').canonWithCoast());

describe('a sheet that no longer fits, in play', () => {
  const path = require('path');
  const functionsDir = path.resolve(__dirname, '../functions');
  const { getFirestore } = require(
    require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
  );
  const functionsTest = require('firebase-functions-test')({ projectId: PROJECT }, null);
  const { loomPlayTurn, loomCreateSave } = require('../functions/index');
  const db = getFirestore();
  const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

  afterAll(async () => {
    await db.recursiveDelete(db.collection('loom_saves'));
    functionsTest.cleanup();
  });

  test('a new save’s sheet fits, and NARRATE hears nothing; a broken one is named', async () => {
    const { saveId } = await loomCreateSave.run({
      data: { worldId: 'shattered-coast', name: 'Voyage', characterName: 'Tam' },
      auth: PLAYER,
    });
    const ref = db.collection('loom_saves').doc(saveId);
    expect(validateSheet(FANTASY, (await ref.get()).data().character.sheet)).toEqual([]);

    mockNarrate.length = 0;
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId, actionText: 'look around' },
      auth: PLAYER,
    });
    expect(mockNarrate[0].userMessage).not.toContain("THE PLAYER'S SHEET");

    // As if the rules changed under it: a score out of range, a skill gone.
    await ref.update({
      'character.sheet.attributes.STR': 30,
      'character.sheet.skills.Juggling': 2,
    });
    await ref.update({ 'turn.ap': 20 });
    mockNarrate.length = 0;
    await loomPlayTurn.run({
      data: { worldId: 'shattered-coast', saveId, actionText: 'look again' },
      auth: PLAYER,
    });
    const message = mockNarrate[0].userMessage;
    expect(message).toContain("THE PLAYER'S SHEET no longer fits this world's rules");
    expect(message).toContain('- Strength is 30; it must be a whole number from 3 to 18.');
    expect(message).toContain('- There is no skill "Juggling" in this world\'s rules.');
  });
});
