'use strict';

/**
 * Objects you can use (planning/maps-from-data.md §3 RD3, §4.4; L-926 /
 * #730), pure, under both built-in systems (MD2):
 *
 *   - an object's settings are checked in its map's geometry;
 *   - what a proposed action at it is, and what its menu offers;
 *   - a locked chest opens with its key and is refused without it; a lock is
 *     picked or forced, a roll against its difficulty, a long action where
 *     the object says so;
 *   - a lever's action unlocks a door elsewhere, and an object;
 *   - what an action costs, in each system, the object's own AP over the
 *     system's price;
 *   - what the page is sent: state and priced actions, never what a closed
 *     container holds, its key or its lock's difficulty;
 *   - "What's here?" on an object, by square and by id; and what the GM and
 *     INTERPRET are told.
 *
 * Run: cd tests && npx jest loom-objects --verbose
 */

const geo = require('../functions/loom-canon/map-geometry');
const objects = require('../functions/loom-canon/objects');
const apRules = require('../functions/loom-canon/ap');
const sheets = require('../functions/loom-canon/sheets');
const { BUILT_IN } = require('../functions/loom-canon/systems');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { lookAt, lookTargetOf } = require('../functions/loom-turn/looking');
const { battleView } = require('../functions/loom-turn/map-view');
const { knownMap } = require('../functions/loom-turn/known-map');
const { buildKnownEntities } = require('../functions/loom-turn/interpret');
const wary = require('../functions/loom-modules/combat/wary');

const SYSTEMS = [
  ['d20-fantasy', BUILT_IN['d20-fantasy']],
  ['pool-scifi', BUILT_IN['pool-scifi']],
];

const { VAULT } = require('./helpers/vault');

const worldOf = (system) => ({
  system,
  battleMaps: { bm_vault: VAULT() },
  characters: {},
  locations: {},
  places: {},
  factions: {},
  regions: {},
  lore: {},
});
// Standing at `cell`, with `inventory`, 20 AP, in `system`.
const standing = (system, cell, inventory = [], more = {}) => ({
  mapId: 'bm_vault',
  cell,
  character: { name: 'Tam', inventory, sheet: sheets.defaultSheet(system) },
  turn: { n: 1, ap: 20, kept: 0, plan: null },
  ...more,
});
const act = (system, save, verb, object, params = {}, dice = 20) =>
  evaluate(
    { verb, targets: ['object:' + object], params },
    {},
    save,
    typeof dice === 'function' ? dice : () => dice,
    worldOf(system)
  );
const flag = (path, value) => ({ target: 'save', op: 'set-flag', path, value });
const turnLeft = (r) => (r.mutations.find((m) => m.path === 'turn') || { value: {} }).value.ap;
const lines = (r) => r.constraints.join(' ');

describe('an object’s settings, in its map’s geometry', () => {
  const bounds = { width: 60, height: 40 };

  test('the vault’s objects are sound', () => {
    expect(geo.check(VAULT().geometry, bounds)).toEqual([]);
  });

  test.each([
    ['a lock that isn’t true or false', { locked: 'yes' }, /locked must be true or false/],
    ['a lock with nothing to open', { container: undefined }, /locked but isn’t a container/],
    ['a lock difficulty out of range', { difficulty: 3 }, /difficulty that isn’t a whole number/],
    ['an ap of 0', { ap: 0 }, /an ap that isn’t a whole number/],
    ['a long action of no size', { long: { ap: 0 } }, /long must be \{ ap \}/],
    ['a container of the wrong sort', { container: 7 }, /container must be true or/],
    ['a description that isn’t text', { description: 4 }, /description that isn’t text/],
    ['an action with no id', { actions: [{ name: 'Pull' }] }, /actions\[0\] needs an id/],
    ['an action named like its own', { actions: [{ id: 'open' }] }, /uses an id the object has/],
    ['two actions the same', { actions: [{ id: 'a' }, { id: 'a' }] }, /two actions "a"/],
    ['unlocks with nothing', { unlocks: {} }, /unlocks must be \{ key \} or \{ action \}/],
  ])('refuses %s', (_label, change, message) => {
    const g = VAULT().geometry;
    const chest = { ...g.objects.find((o) => o.id === 'chest'), ...change };
    Object.keys(change).forEach((k) => change[k] === undefined && delete chest[k]);
    const problems = geo.check(
      { ...g, objects: g.objects.map((o) => (o.id === 'chest' ? chest : o)) },
      bounds
    );
    expect(problems.join('\n')).toMatch(message);
  });

  test('unlocks.action names an object with that action', () => {
    const g = VAULT().geometry;
    const gate = (action) => ({
      ...g,
      doors: [{ ...g.doors[0], unlocks: { action } }],
    });
    expect(geo.check(gate('lever'), bounds)).toEqual([]);
    expect(geo.check(gate('lever.pull'), bounds).join()).toBe('');
    expect(geo.check(gate('nothere'), bounds).join()).toMatch(/no object with actions/);
    expect(geo.check(gate('lever.push'), bounds).join()).toMatch(/an action the object lacks/);
    expect(geo.check(gate('statue'), bounds).join()).toMatch(/no object with actions/);
  });
});

describe('what an object is, and what is done to it', () => {
  const map = VAULT();
  const o = (id) => objects.objectOf(map, id);

  test('which objects there is something to do with; names; states', () => {
    expect(objects.usableOf(map).map((x) => x.id)).toEqual([
      'chest',
      'crate',
      'shelf',
      'lever',
      'strongbox',
    ]);
    expect(objects.allOf(map).map((x) => x.id)).toContain('statue');
    expect(objects.nameOf(o('chest'))).toBe('the chest');
    expect(objects.nameOf({ kind: 'chest', name: 'Old Nan’s chest' })).toBe('Old Nan’s chest');
    expect(objects.stateOf(o('chest'), {})).toBe('locked');
    expect(objects.stateOf(o('crate'), {})).toBe('closed');
    expect(objects.stateOf(o('chest'), { chest: 'open' })).toBe('open');
    expect(objects.stateOf(o('lever'), {})).toBeNull();
  });

  test('hidden objects aren’t there until found (L-927)', () => {
    const hidden = {
      ...map,
      geometry: { ...map.geometry, hidden: [{ id: 'chest' }] },
    };
    expect(objects.objectOf(hidden, 'chest')).toBeNull();
    expect(objects.usableOf(hidden).map((x) => x.id)).not.toContain('chest');
  });

  test('the squares it covers', () => {
    expect(objects.squaresOf(map, o('chest'))).toEqual([{ x: 1, y: 4 }]);
    expect(objects.squaresOf(map, o('shelf'))).toEqual([
      { x: 3, y: 7 },
      { x: 4, y: 7 },
    ]);
  });

  test('what a proposed action is: by its verb, or the menu’s act', () => {
    const intent = (id, verb, params) => objects.intent(o(id), { verb, params });
    expect(intent('chest', 'open')).toEqual({ act: 'open' });
    expect(intent('chest', 'pick_lock')).toEqual({ act: 'unlock' });
    expect(intent('chest', 'force')).toEqual({ act: 'unlock' });
    expect(intent('chest', 'search')).toEqual({ act: 'search' });
    expect(intent('chest', 'use')).toEqual({ act: 'open' });
    expect(intent('shelf', 'open')).toEqual({ act: 'search' });
    expect(intent('lever', 'pull').action.id).toBe('pull');
    expect(intent('lever', 'push').action.id).toBe('pull'); // its one action
    expect(intent('lever', 'use', { act: 'pull' }).action.id).toBe('pull');
    expect(intent('lever', 'dance')).toBeNull();
    expect(intent('statue', 'open')).toBeNull();
  });

  test('what the menu offers: pick or unlock, open or search, its own', () => {
    expect(objects.actionsOf(o('chest'), 'locked', {})).toEqual([
      { id: 'unlock', name: 'Pick the lock', spend: 'lock', long: 30 },
    ]);
    expect(objects.actionsOf(o('chest'), 'locked', { hasKey: true })).toEqual([
      { id: 'unlock', name: 'Unlock', spend: 'object', key: 'brass key' },
    ]);
    expect(objects.actionsOf(o('crate'), 'closed', {})).toEqual([
      { id: 'open', name: 'Open', spend: 'object', own: 8 },
    ]);
    expect(objects.actionsOf(o('crate'), 'open', {})).toEqual([]);
    expect(objects.actionsOf(o('shelf'), 'closed', {})).toEqual([
      { id: 'search', name: 'Search', spend: 'object' },
    ]);
    expect(objects.actionsOf(o('lever'), null, {})).toEqual([
      { id: 'pull', name: 'Pull', spend: 'object', own: 3 },
    ]);
  });

  test('what using the lever unlocks, and nothing for another action', () => {
    expect(objects.unlockedBy(map, 'lever', 'pull').map((x) => `${x.list}:${x.item.id}`)).toEqual([
      'doors:gate',
      'objects:strongbox',
    ]);
    expect(objects.unlockedBy(map, 'lever', 'push')).toEqual([]);
    expect(objects.unlockedBy(map, 'chest', 'pull')).toEqual([]);
  });

  test('what the page is sent holds no secrets', () => {
    const sent = objects.forPlayer(o('chest'));
    expect(sent).toMatchObject({
      id: 'chest',
      description: 'an iron-bound chest',
      container: true,
    });
    for (const secret of ['unlocks', 'difficulty', 'locked', 'long', 'ap']) {
      expect(sent[secret]).toBeUndefined();
    }
    expect(JSON.stringify(sent)).not.toMatch(/dagger|brass|gold/);
    expect(objects.forPlayer(o('lever')).actions).toEqual([{ id: 'pull', name: 'Pull' }]);
    expect(objects.forPlayer(o('shelf')).container).toEqual({ search: true });
    // And the map a save is sent: art and card art as links only.
    const art = { imageId: 'img-1', link: 'https://x/1', width: 64, height: 64 };
    const withArt = {
      ...map,
      geometry: {
        ...map.geometry,
        objects: map.geometry.objects.map((x) =>
          x.id === 'chest'
            ? { ...x, art, cardArt: { ...art, imageId: 'img-2', link: 'https://x/2' } }
            : x
        ),
      },
    };
    const seen = knownMap(withArt, () => true, {}).geometry.objects.find((x) => x.id === 'chest');
    expect(seen.art).toEqual({ link: 'https://x/1' });
    expect(seen.cardArt).toEqual({ link: 'https://x/2' });
    expect(JSON.stringify(seen)).not.toMatch(/dagger|brass/);
  });

  test('nor does a door: not the key, the lever that unlocks it, or its lock', () => {
    const locked = {
      ...map,
      geometry: {
        ...map.geometry,
        doors: [
          {
            ...map.geometry.doors[0],
            unlocks: { key: 'iron key', action: 'lever.pull' },
            difficulty: 20,
            long: { ap: 40 },
            ap: 4,
          },
        ],
      },
    };
    const sent = knownMap(locked, () => true, {}).geometry.doors[0];
    expect(sent).toMatchObject({ id: 'gate', name: 'the iron gate', state: 'locked', ap: 4 });
    expect(JSON.stringify(sent)).not.toMatch(/iron key|lever|difficulty|long/);
  });
});

describe.each(SYSTEMS)('using objects under %s', (_id, system) => {
  const prices = () => apRules.pricesOf(system, sheets.defaultSheet(system));
  // Beside the chest (1, 4): from (2, 4). Beside the lever (4, 0): from (4, 1).
  const atChest = (inv) => standing(system, { x: 2, y: 4 }, inv);
  const atLever = (more) => standing(system, { x: 4, y: 1 }, [], more);

  test('a locked chest opens with its key, for the price of handling an object', () => {
    const r = act(system, atChest(['A Brass Key']), 'open', 'chest');
    expect(r.outcome).toBe('success');
    expect(r.mutations).toContainEqual(flag('objects.bm_vault.chest', 'open'));
    expect(lines(r)).toContain('You unlock the chest with brass key and open it.');
    expect(lines(r)).toContain('It holds a silver dagger and 12 gold pieces.');
    expect(r.roll).toBeUndefined();
    expect(turnLeft(r)).toBe(20 - prices().of('object'));
  });

  test('and is refused without it, spending nothing', () => {
    const r = act(system, atChest(['a lantern']), 'open', 'chest');
    expect(r).toMatchObject({
      outcome: 'blocked',
      mutations: [],
      constraints: ['The chest is locked.'],
    });
    expect(act(system, atChest([]), 'search', 'chest').outcome).toBe('blocked');
  });

  test('picked or forced: a roll against its lock; a success unlocks it, for the lock’s price', () => {
    // The lock’s difficulty of 18, on the system’s ladder; its long action of
    // 30 AP is worked at over turns, so a short turn only puts AP in.
    const rich = standing(system, { x: 2, y: 4 }, [], {
      turn: { n: 1, ap: 40, kept: 0, plan: null },
    });
    const done = act(system, rich, 'pick_lock', 'chest', {}, 20);
    expect(done.outcome).toBe('success');
    expect(done.roll).toMatchObject({ against: 'the lock on the chest', success: true });
    expect(done.mutations).toContainEqual(flag('objects.bm_vault.chest', 'closed'));
    expect(lines(done)).toContain('The lock gives way: the chest is unlocked.');
    const failed = act(system, rich, 'force', 'chest', {}, 1);
    expect(failed.outcome).toBe('failure');
    expect(failed.mutations.some((m) => /^objects\./.test(m.path))).toBe(false);
    expect(lines(failed)).toContain('The lock on the chest holds.');
  });

  test('a long lock is put in over turns: a turn’s AP is progress, not the roll', () => {
    const r = act(system, atChest([]), 'pick_lock', 'chest', {}, 20);
    expect(r.ruled).toBe(true);
    expect(r.roll).toBeUndefined();
    expect(r.mutations.some((m) => /^objects\./.test(m.path))).toBe(false);
    expect(turnLeft(r)).toBe(0);
  });

  test('a closed one opens for its own AP over the system’s, and tells what it holds', () => {
    const r = act(system, standing(system, { x: 2, y: 1 }), 'open', 'crate');
    expect(r.outcome).toBe('success');
    expect(r.mutations).toContainEqual(flag('objects.bm_vault.crate', 'open'));
    expect(lines(r)).toContain('You open the crate.');
    expect(lines(r)).toContain('It holds straw.');
    expect(turnLeft(r)).toBe(20 - prices().of('object', 8));
    // Opened, it is open: nothing more to do, nothing spent.
    const again = act(
      system,
      standing(system, { x: 2, y: 1 }, [], { objects: { bm_vault: { crate: 'open' } } }),
      'open',
      'crate'
    );
    expect(again).toMatchObject({ outcome: 'no_op', mutations: [] });
    expect(lines(again)).toContain('already open');
  });

  test('a bookshelf is searched, and says what it holds', () => {
    const r = act(system, standing(system, { x: 3, y: 6 }), 'open', 'shelf');
    expect(r.outcome).toBe('success');
    expect(lines(r)).toContain('You search the bookshelf.');
    expect(lines(r)).toContain('It is empty.');
  });

  test('a lever unlocks a door elsewhere, and an object, for its own AP', () => {
    const r = act(system, atLever(), 'use', 'lever', { act: 'pull' });
    expect(r.outcome).toBe('success');
    expect(r.mutations).toContainEqual(flag('doors.bm_vault.gate', 'closed'));
    expect(r.mutations).toContainEqual(flag('objects.bm_vault.strongbox', 'closed'));
    expect(lines(r)).toContain('The lever grinds down.');
    expect(turnLeft(r)).toBe(20 - prices().of('object', 3));
    // The gate is in sight, through its bars: named. The strongbox, behind
    // the wall: only a lock giving way.
    expect(lines(r)).toContain('The iron gate unlocks.');
    expect(lines(r)).toContain('Somewhere nearby, a lock gives way.');
    expect(lines(r)).not.toContain('strongbox');
  });

  test('and what is already unlocked stays as it is', () => {
    const r = act(
      system,
      atLever({
        doors: { bm_vault: { gate: 'open' } },
        objects: { bm_vault: { strongbox: 'open' } },
      }),
      'pull',
      'lever'
    );
    expect(r.outcome).toBe('success');
    expect(r.mutations.some((m) => /^(doors|objects)\./.test(m.path))).toBe(false);
  });

  test('out of reach, turned down; something that isn’t there; not an action of its own', () => {
    expect(act(system, standing(system, { x: 5, y: 4 }), 'open', 'chest')).toMatchObject({
      outcome: 'blocked',
      constraints: ['You need to be beside the chest.'],
    });
    expect(act(system, atChest(), 'open', 'nothing')).toMatchObject({ outcome: 'invalid_target' });
    expect(act(system, atLever(), 'dance', 'lever')).toMatchObject({ outcome: 'no_op' });
    expect(act(system, standing(system, { x: 2, y: 1 }), 'unlock', 'crate').outcome).toBe('no_op');
  });

  test('too little AP: turned down with its cost, nothing changed', () => {
    const r = act(
      system,
      standing(system, { x: 2, y: 1 }, [], { turn: { n: 1, ap: 2, kept: 0, plan: null } }),
      'open',
      'crate'
    );
    expect(r.outcome).toBe('blocked');
    expect(r.mutations).toEqual([]);
  });

  test('the same under a trigger: touching an object counts as touching a feature', () => {
    const map = VAULT();
    expect(
      wary.validate(system, map, [
        { id: 'g', on: 'featureTouched', target: 'lever', then: 'hostile' },
      ])
    ).toEqual([]);
    expect(
      wary.validate(system, map, [
        { id: 'g', on: 'featureTouched', target: 'altar', then: 'hostile' },
      ])
    ).toEqual([]);
  });
});

describe('what the player and the GM are told', () => {
  const system = BUILT_IN['d20-fantasy'];
  const sheet = sheets.defaultSheet(system);
  const world = () => worldOf(system);
  const save = (cell, more = {}) => ({
    ...standing(system, cell, [], more),
    location: 'x',
    character: { name: 'Tam', inventory: ['brass key'], sheet },
  });

  test('"What\'s here?" on the chest: what it is, locked, never what it holds', () => {
    const look = lookAt(world(), save({ x: 2, y: 4 }), { object: 'chest' });
    expect(look).toMatchObject({ at: 'the chest', empty: false, inSight: true });
    expect(look.facts).toEqual(['An object: the chest, an iron-bound chest.', 'It is locked.']);
    expect(JSON.stringify(look)).not.toMatch(/dagger|brass|difficulty/);
  });

  test('opened, it says what it holds; and by its square', () => {
    const opened = save({ x: 2, y: 4 }, { objects: { bm_vault: { chest: 'open' } } });
    expect(lookAt(world(), opened, { object: 'chest' }).facts).toContain(
      'It is open: it holds a silver dagger and 12 gold pieces.'
    );
    const byCell = lookAt(world(), opened, { cell: { x: 1, y: 4 } });
    expect(byCell.facts.slice(0, 2)).toEqual([
      'An object: the chest, an iron-bound chest.',
      'It is open: it holds a silver dagger and 12 gold pieces.',
    ]);
    // Said once: its blocking isn't also an obstacle.
    expect(byCell.facts.join(' ')).not.toMatch(/An obstacle/);
  });

  test('a lever says what can be done with it; scenery just what it is', () => {
    expect(lookAt(world(), save({ x: 4, y: 1 }), { object: 'lever' }).facts).toEqual([
      'An object: the lever.',
      'It can be used: pull.',
    ]);
    expect(lookAt(world(), save({ x: 4, y: 1 }), { object: 'statue' }).facts).toEqual([
      'An object: the statue, a stern king.',
    ]);
  });

  test('not seen, not looked at; typed "look at the chest" by its id', () => {
    const unseen = lookAt(world(), save({ x: 2, y: 4 }), { object: 'chest' }, { known: {} });
    expect(unseen).toEqual({ refused: "You haven't seen that." });
    expect(
      lookTargetOf(world(), save({ x: 2, y: 4 }), { verb: 'look', targets: ['object:chest'] })
    ).toEqual({
      object: 'chest',
    });
  });

  test('the page: each seen object with its state and its priced actions', () => {
    const view = battleView(world(), save({ x: 2, y: 4 }), null);
    const chest = view.objects.find((x) => x.id === 'chest');
    expect(chest).toEqual({
      id: 'chest',
      name: 'the chest',
      state: 'locked',
      description: 'an iron-bound chest',
      // Has the key: unlocks and opens it, for handling an object.
      actions: [
        { id: 'unlock', name: 'Unlock', cost: apRules.pricesOf(system, sheet).of('object') },
      ],
    });
    expect(view.objects.map((x) => x.id)).not.toContain('statue');
    expect(JSON.stringify(view.objects)).not.toMatch(/dagger|difficulty/);
    // Without the key: pick the lock, a long action.
    const noKey = battleView(
      world(),
      { ...save({ x: 2, y: 4 }), character: { name: 'Tam', inventory: [], sheet } },
      null
    );
    expect(noKey.objects.find((x) => x.id === 'chest').actions).toEqual([
      {
        id: 'unlock',
        name: 'Pick the lock',
        cost: apRules.pricesOf(system, sheet).of('lock'),
        long: 30,
      },
    ]);
    // Opened, what it holds is sent.
    const opened = battleView(
      world(),
      save({ x: 2, y: 4 }, { objects: { bm_vault: { chest: 'open' } } }),
      null
    );
    expect(opened.objects.find((x) => x.id === 'chest')).toMatchObject({
      state: 'open',
      contents: 'a silver dagger and 12 gold pieces',
      actions: [],
    });
  });

  test('INTERPRET is told the objects there is something to do with', () => {
    const known = buildKnownEntities(world(), save({ x: 2, y: 4 }), null);
    const objectsKnown = known.filter((e) => /^object:/.test(e.id));
    expect(objectsKnown.map((e) => e.id)).toEqual([
      'object:chest',
      'object:crate',
      'object:shelf',
      'object:lever',
      'object:strongbox',
    ]);
    expect(objectsKnown[0]).toMatchObject({ id: 'object:chest', name: 'the chest' });
    // Only what the save has seen: here, the chest's square alone.
    const some = buildKnownEntities(world(), save({ x: 2, y: 4 }), { '1,4': true });
    expect(some.filter((e) => /^object:/.test(e.id)).map((e) => e.id)).toEqual(['object:chest']);
  });
});
