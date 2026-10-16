'use strict';

/**
 * Game systems as data (planning/game-systems.md §3 SY1–SY7, §4.1; L-801 /
 * #627): functions/loom-canon/systems.js. The checks on a system are pure;
 * saving, copying and loading run against the Firestore emulator.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest loom-systems --verbose"
 */

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { initializeApp } = require(require.resolve('firebase-admin/app', { paths: [functionsDir] }));
const { getFirestore } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);

const systems = require('../functions/loom-canon/systems');
const loomCanon = require('../functions/loom-canon');

const { validateSystem, BUILT_IN, DEFAULT_SYSTEM_ID, SystemError } = systems;

// A small dice-pool system, written as Claude would.
function pirates(overrides = {}) {
  return {
    id: 'pirate-pool',
    name: 'Pirates of the Pool',
    credits: [{ source: 'The Loom', licence: 'Our own' }],
    words: { health: 'Grit' },
    sheet: {
      attributes: [
        { id: 'Brawn', name: 'Brawn', min: 1, max: 5, modifier: 'Brawn' },
        { id: 'Wits', name: 'Wits', min: 1, max: 5, modifier: 'Wits' },
      ],
      resources: [{ id: 'grit', name: 'Grit', max: '3 + Brawn' }],
      level: { min: 1, max: 10 },
      optional: ['skills', 'traits'],
      skills: [
        { id: 'Sailing', name: 'Sailing', attribute: 'Wits' },
        { id: 'Brawling', name: 'Brawling', attribute: 'Brawn' },
      ],
      traits: [{ id: 'swim', name: 'Swimmer' }],
    },
    checks: {
      formula: 'count((attribute + rank)d10, >= 7)',
      degrees: { success: 'result >= difficulty' },
      ladder: [
        { name: 'Easy', value: 1 },
        { name: 'Hard', value: 2 },
        { name: 'Heroic', value: 3 },
      ],
    },
    creation: { method: 'pointBuy', budget: 6 },
    gmNotes: 'Salt, rum and close calls.',
    ...overrides,
  };
}

describe('the checks on a system', () => {
  test('a valid system passes, with its defaults filled in', () => {
    const { errors, warnings, system } = validateSystem(pirates());
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(system).toMatchObject({ advancement: {}, modules: {}, id: 'pirate-pool' });
  });

  test('the built-in fantasy placeholder passes its own checks', () => {
    expect(validateSystem(BUILT_IN[DEFAULT_SYSTEM_ID])).toMatchObject({ errors: [], warnings: [] });
  });

  test('a duplicate attribute is refused, by id across the sheet and by name', () => {
    const s = pirates();
    s.sheet.attributes.push({ id: 'brawn', name: 'Muscle', min: 1, max: 5, modifier: 'brawn' });
    expect(validateSystem(s).errors).toEqual([
      'sheet.attributes[2].id "brawn" is already used by sheet.attributes[0].',
    ]);
    const named = pirates();
    named.sheet.attributes.push({ id: 'Grip', name: 'brawn', min: 1, max: 5, modifier: 'Grip' });
    expect(validateSystem(named).errors).toEqual([
      'sheet.attributes[2].name "brawn" is used twice in sheet.attributes.',
    ]);
    // A skill can't share an attribute's id either: formulas name them.
    const clash = pirates();
    clash.sheet.skills.push({ id: 'Wits', name: 'Quick wits', attribute: 'Wits' });
    expect(validateSystem(clash).errors).toEqual([
      'sheet.skills[2].id "Wits" is already used by sheet.attributes[1].',
    ]);
  });

  test('an unordered ladder is refused; one that rolls under is fine', () => {
    const s = pirates();
    s.checks.ladder = [
      { name: 'Easy', value: 1 },
      { name: 'Hard', value: 3 },
      { name: 'Middling', value: 2 },
    ];
    expect(validateSystem(s).errors).toEqual([
      expect.stringMatching(/^checks\.ladder must be in order, easiest first/),
    ]);
    s.checks.ladder = [
      { name: 'Easy', value: 80 },
      { name: 'Hard', value: 50 },
      { name: 'Heroic', value: 20 },
    ];
    expect(validateSystem(s).errors).toEqual([]);
    s.checks.ladder = [{ name: 'Only', value: 10 }];
    expect(validateSystem(s).errors).toEqual([expect.stringMatching(/at least two rungs/)]);
  });

  test('an unknown optional part is refused', () => {
    const s = pirates();
    s.sheet.optional.push('feats');
    expect(validateSystem(s).errors).toEqual([
      'sheet.optional: "feats" isn\'t an optional part (skills, traits, conditions, derived).',
    ]);
  });

  test('every problem is named at once, with where it is', () => {
    const s = pirates({ id: 'Bad Id', creation: { method: 'dice' } });
    s.sheet.resources = [];
    s.sheet.skills[0].attribute = 'Luck';
    s.checks.degrees = { triumph: 'x' };
    delete s.checks.formula;
    expect(validateSystem(s).errors).toEqual([
      'id must be lowercase letters, digits and dashes (e.g. "pirate-d20").',
      'sheet.resources needs at least one.',
      'sheet.skills[0].attribute "Luck" isn\'t one of the system\'s attributes.',
      'checks.formula must be a formula (text, at most 500 characters).',
      expect.stringMatching(/^checks\.degrees: "triumph" isn't a degree/),
      'creation.method must be one of array, pointBuy, rolling.',
    ]);
    expect(validateSystem(null).errors).toEqual(['A system must be an object.']);
  });

  test('warnings: an unused attribute, parts given but off, no creation, unbuilt modules', () => {
    const s = pirates({ modules: { shipBattle: { arcs: 4 } } });
    s.sheet.attributes.push({ id: 'Luck', name: 'Luck', min: 1, max: 5, modifier: 'Luck' });
    s.sheet.derived = [{ id: 'Defence', name: 'Defence', formula: 'Wits + 1' }];
    delete s.creation;
    expect(validateSystem(s)).toMatchObject({
      errors: [],
      warnings: [
        'sheet.derived is given but "derived" isn\'t in sheet.optional: ignored.',
        'No creation method: the Loom can’t walk a player through making a character.',
        'modules.shipBattle: no module by that name is built yet; it is kept, unused.',
        "Attribute Luck isn't used by any skill or formula.",
      ],
    });
  });
});

describe('systems in Firestore', () => {
  const app = initializeApp({ projectId: 'demo-loom-systems' }, 'loom-systems-test');
  const db = getFirestore(app);
  const col = () => db.collection(systems.SYSTEMS_COLLECTION);

  beforeEach(async () => {
    await db.recursiveDelete(col());
    await db.recursiveDelete(db.collection('loom_worlds'));
    loomCanon.clearWorldCache();
  });

  test('a valid system saves, and each change raises its version', async () => {
    const first = await systems.setSystem(db, pirates(), { uid: 'builder', now: 1000 });
    expect(first).toMatchObject({ created: true, warnings: [], system: { version: 1 } });
    const again = await systems.setSystem(db, pirates({ gmNotes: 'Grimmer.' }), {
      uid: 'builder',
      now: 2000,
    });
    expect(again).toMatchObject({ created: false, system: { version: 2, gmNotes: 'Grimmer.' } });
    const stored = (await col().doc('pirate-pool').get()).data();
    expect(stored).toMatchObject({ version: 2, createdAtMs: 1000, updatedAtMs: 2000 });
  });

  test('a system with problems is refused, every problem named, and nothing is written', async () => {
    const bad = pirates();
    bad.sheet.optional = ['skills', 'feats'];
    bad.checks.ladder.reverse().push({ name: 'Odd', value: 9 });
    await expect(systems.setSystem(db, bad, { uid: 'builder' })).rejects.toMatchObject({
      errors: [expect.stringMatching(/feats/), expect.stringMatching(/ladder must be in order/)],
    });
    expect((await col().doc('pirate-pool').get()).exists).toBe(false);
  });

  test('a built-in system can’t be set, only copied', async () => {
    const attempt = systems.setSystem(db, { ...BUILT_IN[DEFAULT_SYSTEM_ID], name: 'Mine' }, {});
    await expect(attempt).rejects.toBeInstanceOf(SystemError);
    await expect(attempt).rejects.toThrow(/copy_system/);
  });

  test('a copy is independent of its source', async () => {
    await systems.setSystem(db, pirates(), { uid: 'builder' });
    const { system: copy } = await systems.copySystem(
      db,
      'pirate-pool',
      { id: 'pirate-pool-grim', name: 'Grim Pirates' },
      { uid: 'builder' }
    );
    expect(copy).toMatchObject({
      id: 'pirate-pool-grim',
      name: 'Grim Pirates',
      version: 1,
      copiedFrom: { id: 'pirate-pool', version: 1 },
    });
    // Changing the source leaves the copy as it was, and the other way round.
    await systems.setSystem(db, pirates({ gmNotes: 'Sunny.' }), { uid: 'builder' });
    const grim = await systems.getSystem(db, 'pirate-pool-grim');
    expect(grim.gmNotes).toBe('Salt, rum and close calls.');
    const changed = { ...grim, gmNotes: 'Grim.' };
    await systems.setSystem(db, changed, { uid: 'builder' });
    expect((await systems.getSystem(db, 'pirate-pool')).gmNotes).toBe('Sunny.');
    expect((await systems.getSystem(db, 'pirate-pool-grim')).copiedFrom).toEqual({
      id: 'pirate-pool',
      version: 1,
    });
    // The built-in can be copied; a taken or built-in id can't be used.
    await expect(
      systems.copySystem(db, DEFAULT_SYSTEM_ID, { id: 'my-fantasy', name: 'My fantasy' }, {})
    ).resolves.toMatchObject({ system: { copiedFrom: { id: DEFAULT_SYSTEM_ID, version: 0 } } });
    await expect(
      systems.copySystem(db, 'pirate-pool', { id: 'pirate-pool-grim', name: 'Again' }, {})
    ).rejects.toThrow(/already a system/);
    await expect(
      systems.copySystem(db, 'pirate-pool', { id: 'pool-scifi', name: 'Mine' }, {})
    ).rejects.toThrow(/built-in/);
    await expect(systems.copySystem(db, 'nope', { id: 'x', name: 'X' }, {})).rejects.toThrow(
      /No system "nope"/
    );
  });

  test('the list has every stored system and the built-ins', async () => {
    await systems.setSystem(db, pirates(), { uid: 'builder' });
    const list = await systems.listSystems(db);
    expect(list.map((s) => [s.id, s.version, Boolean(s.builtIn)])).toEqual([
      [DEFAULT_SYSTEM_ID, 0, true],
      ['pool-scifi', 0, true],
      ['pirate-pool', 1, false],
    ]);
  });

  test('a world loads its system as it is now: latest version, the built-in, or none', async () => {
    const worldRef = db.collection('loom_worlds').doc('w1');
    await worldRef.set({ name: 'W', status: 'published', canonVersion: 1, map: null });
    // No system named: the built-in fantasy system (SY4).
    let world = await loomCanon.loadWorld('w1', { db });
    expect(world).toMatchObject({ systemId: null, system: { id: DEFAULT_SYSTEM_ID } });
    expect(Object.isFrozen(world.system)).toBe(true);
    // Named: the system at its latest version, without the world changing.
    await systems.setSystem(db, pirates(), { uid: 'builder' });
    await worldRef.update({ systemId: 'pirate-pool', canonVersion: 2 });
    world = await loomCanon.loadWorld('w1', { db });
    expect(world.system).toMatchObject({ id: 'pirate-pool', version: 1 });
    await systems.setSystem(db, pirates({ name: 'Pirates, revised' }), { uid: 'builder' });
    world = await loomCanon.loadWorld('w1', { db });
    expect(world.system).toMatchObject({ name: 'Pirates, revised', version: 2 });
    // Named but gone: null, which grading reports.
    await worldRef.update({ systemId: 'gone', canonVersion: 3 });
    world = await loomCanon.loadWorld('w1', { db });
    expect(world.system).toBeNull();
  });

  test('a sheet that no longer fits: nothing yet, until saves have sheets (L-811)', () => {
    expect(systems.misfits(BUILT_IN[DEFAULT_SYSTEM_ID], {})).toEqual([]);
  });
});
