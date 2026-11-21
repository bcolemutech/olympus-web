'use strict';

/**
 * The Muse's elements and custom fields as plain data (planning/the-muse.md
 * §3 EL1, EL2, D2, §4; M-102 / #890): custom fields of each kind checked and
 * saved, and the index kept in step with the elements through create,
 * rename, alias changes, retiring and bringing back, by doing each plan on an
 * in-memory store as a batch would.
 *
 * Run: cd tests && npx jest muse-model --verbose
 */

const fields = require('../public/apps/muse/js/fields.js');
const model = require('../public/apps/muse/js/model.js');

// ── Custom fields ─────────────────────────────────

const DEFS = [
  { key: 'title', label: 'Title', kind: 'text' },
  { key: 'age', label: 'Age', kind: 'number' },
  { key: 'born', label: 'Born', kind: 'date' },
  { key: 'liege', label: 'Liege', kind: 'element', options: ['character', 'faction'] },
  { key: 'temper', label: 'Temper', kind: 'choice', options: ['Calm', 'Fiery'] },
];
const LIVE = { el_peter: 'character', el_crown: 'faction', el_sea: 'location' };
const elementType = (id) => LIVE[id] || null;

describe('custom field definitions', () => {
  test('every kind is accepted, and cleaned', () => {
    const { value, error } = fields.checkDefinitions([
      { key: 'title', label: '  Title ', kind: 'text' },
      { key: 'temper', label: 'Temper', kind: 'choice', options: [' Calm', 'Fiery', 'Calm', ''] },
      { key: 'liege', label: 'Liege', kind: 'element', options: ['faction', 'character'] },
      { key: 'born', label: 'Born', kind: 'date', options: ['ignored'] },
    ]);
    expect(error).toBeUndefined();
    expect(value).toEqual([
      { key: 'title', label: 'Title', kind: 'text' },
      { key: 'temper', label: 'Temper', kind: 'choice', options: ['Calm', 'Fiery'] },
      // Types in the app's order, whatever order they were ticked in.
      { key: 'liege', label: 'Liege', kind: 'element', options: ['character', 'faction'] },
      { key: 'born', label: 'Born', kind: 'date' },
    ]);
  });

  test.each([
    ['no label', [{ key: 'a_x', label: ' ', kind: 'text' }], /label/],
    ['a bad key', [{ key: 'Bad Key', label: 'A', kind: 'text' }], /key/],
    [
      'two fields with one key',
      [
        { key: 'a_x', label: 'A', kind: 'text' },
        { key: 'a_x', label: 'B', kind: 'number' },
      ],
      /share/,
    ],
    ['a kind we don’t know', [{ key: 'a_x', label: 'A', kind: 'colour' }], /kind/],
    ['a choice with no choices', [{ key: 'a_x', label: 'A', kind: 'choice', options: [] }], /choice/],
    [
      'a link to a type we don’t know',
      [{ key: 'a_x', label: 'A', kind: 'element', options: ['dragon'] }],
      /type/,
    ],
    [
      'too many fields',
      Array.from({ length: 31 }, (_, i) => ({ key: `f_${i}`, label: `F${i}`, kind: 'text' })),
      /at most 30/,
    ],
  ])('refused: %s', (_, list, message) => {
    expect(fields.checkDefinitions(list).error).toMatch(message);
  });

  test('the project’s map is by type, and drops empty types', () => {
    expect(fields.checkAll({ character: DEFS, faction: [] }).value).toEqual({
      character: fields.checkDefinitions(DEFS).value,
    });
    expect(fields.checkAll({ dragon: [] }).error).toMatch(/dragon/);
    expect(fields.checkAll(null).value).toEqual({});
  });

  test('a new key is a word from its label with a few letters, unique', () => {
    expect(fields.makeKey('Eye colour', [], 'ab12')).toBe('eye_colour_ab12');
    expect(fields.makeKey('Éclair!', [], 'q')).toBe('eclair_q');
    expect(fields.makeKey('9 lives', [], 'x')).toBe('f_9_lives_x');
    const taken = ['eye_colour_ab12'];
    const again = fields.makeKey('Eye colour', taken, 'ab12');
    expect(again).toMatch(/^eye_colour_[a-z0-9]+$/);
    expect(again).not.toBe('eye_colour_ab12');
    expect(fields.makeKey('Eye colour', [])).toMatch(/^eye_colour_[a-z0-9]{1,6}$/);
  });
});

describe('custom field values, each kind checked and saved', () => {
  const check = (key, raw, kept) =>
    fields.checkValue(
      DEFS.find((d) => d.key === key),
      raw,
      { elementType, kept }
    );

  test('text', () => {
    expect(check('title', '  Lord of Tides ')).toEqual({ value: 'Lord of Tides' });
    expect(check('title', 'x'.repeat(10001)).error).toMatch(/at most/);
  });

  test('number', () => {
    expect(check('age', ' 1,204 ')).toEqual({ value: 1204 });
    expect(check('age', -3.5)).toEqual({ value: -3.5 });
    expect(check('age', 'old').error).toMatch(/number/);
    expect(check('age', true).error).toMatch(/number/);
  });

  test('date: a year, a month or a day', () => {
    expect(check('born', { year: '312' })).toEqual({ value: { year: 312 } });
    expect(check('born', { year: -40, month: '3' })).toEqual({ value: { year: -40, month: 3 } });
    expect(check('born', { year: 312, month: 3, day: 14 })).toEqual({
      value: { year: 312, month: 3, day: 14 },
    });
    expect(check('born', { month: 3 }).error).toMatch(/year/);
    expect(check('born', { year: 1.5 }).error).toMatch(/year/);
    expect(check('born', { year: 312, day: 4 }).error).toMatch(/month/);
    expect(check('born', { year: 312, month: 0 }).error).toMatch(/month/);
    expect(check('born', '312').error).toMatch(/date/);
    expect(check('born', { year: '', month: '' })).toEqual({ value: null });
    expect(fields.formatDate({ year: 312, month: 3, day: 14 })).toBe('Year 312, month 3, day 14');
    expect(fields.formatDate({ year: -40 })).toBe('Year 40 before');
  });

  test('element: a live element, of the types allowed', () => {
    expect(check('liege', 'el_crown')).toEqual({ value: 'el_crown' });
    expect(check('liege', 'el_sea').error).toMatch(/location/);
    expect(check('liege', 'el_nobody').error).toMatch(/element/);
    // One since retired is kept while it isn't changed.
    expect(check('liege', 'el_gone', 'el_gone')).toEqual({ value: 'el_gone' });
  });

  test('choice: one of its choices', () => {
    expect(check('temper', 'Fiery')).toEqual({ value: 'Fiery' });
    expect(check('temper', 'Sulky').error).toMatch(/choices/);
    // A choice since taken away is kept while it isn't changed.
    expect(check('temper', 'Sulky', 'Sulky')).toEqual({ value: 'Sulky' });
  });

  test('empty is not set', () => {
    DEFS.forEach((def) => {
      expect(fields.checkValue(def, '', { elementType })).toEqual({ value: null });
      expect(fields.checkValue(def, null, { elementType })).toEqual({ value: null });
    });
  });

  test('saving keeps the defined, set values, and drops a removed field’s', () => {
    const kept = { title: 'Old', gone_field: 'left over', age: 5 };
    const { value } = fields.checkValues(
      DEFS,
      { title: 'Lord', age: '', born: { year: '9' }, liege: 'el_peter', temper: 'Calm', extra: 1 },
      { elementType, kept }
    );
    expect(value).toEqual({
      title: 'Lord',
      born: { year: 9 },
      liege: 'el_peter',
      temper: 'Calm',
    });
    expect(fields.clean(DEFS, kept)).toEqual({ title: 'Old', age: 5 });
    expect(fields.checkValues(DEFS, { age: 'x' }, { elementType }).error).toMatch(/Age/);
  });

  test('values are shown as words', () => {
    const name = (id) => ({ el_peter: 'King Peter' })[id];
    expect(fields.format(DEFS[1], 1204)).toBe((1204).toLocaleString());
    expect(fields.format(DEFS[3], 'el_peter', { elementName: name })).toBe('King Peter');
    expect(fields.format(DEFS[3], 'el_gone', { elementName: name })).toBe('A retired element');
  });
});

// ── Elements ──────────────────────────────────────

describe('an element’s own fields', () => {
  test('names and aliases are trimmed, without repeats or the name', () => {
    expect(model.checkNames('  King   Peter ', ['Peter', ' the Drowned ', 'king peter', 'Peter', ''])).toEqual(
      { value: { name: 'King Peter', aliases: ['Peter', 'the Drowned'] } }
    );
    expect(model.checkNames(' ', []).error).toMatch(/name/);
    expect(model.checkNames('x'.repeat(201)).error).toMatch(/at most/);
    expect(model.checkNames('A', Array.from({ length: 21 }, (_, i) => `a${i}`)).error).toMatch(
      /20/
    );
  });

  test('a character has an appearance and a residence that is a location', () => {
    const ok = model.checkElement(
      'character',
      { name: 'Peter', appearance: 'Tall', residence: 'el_sea', fields: { temper: 'Calm' } },
      { defs: DEFS, elementType }
    );
    expect(ok.value).toEqual({
      name: 'Peter',
      aliases: [],
      bio: '',
      mentions: [],
      fields: { temper: 'Calm' },
      appearance: 'Tall',
      residence: 'el_sea',
    });
    expect(
      model.checkElement('character', { name: 'P', residence: 'el_crown' }, { elementType }).error
    ).toMatch(/location/);
  });

  test('a concept is like a faction: no appearance or residence', () => {
    expect(model.checkElement('concept', { name: 'Tide-magic', bio: '# Rules' }, {}).value).toEqual(
      { name: 'Tide-magic', aliases: [], bio: '# Rules', fields: {}, mentions: [] }
    );
    expect(model.checkElement('concept', { name: 'X', residence: 'el_sea' }, {}).error).toMatch(
      /Only characters/
    );
    expect(model.checkElement('dragon', { name: 'X' }, {}).error).toMatch(/type/);
  });

  test('a change keeps what it leaves out', () => {
    const current = {
      name: 'Peter',
      aliases: ['P'],
      bio: 'Old',
      fields: { gone_field: 1, temper: 'Calm' },
      appearance: 'Tall',
      residence: 'el_old_home', // since retired, kept
    };
    const { value } = model.checkElement(
      'character',
      { bio: 'New' },
      { defs: DEFS, elementType, current }
    );
    expect(value).toEqual({
      name: 'Peter',
      aliases: ['P'],
      bio: 'New',
      mentions: [],
      fields: { temper: 'Calm' },
      appearance: 'Tall',
      residence: 'el_old_home',
    });
  });
});

// ── The index kept in step ────────────────────────

// Does a plan on an in-memory store as Firestore's batch would.
function apply(store, writes, clock) {
  const resolve = (v) => {
    if (v === model.NOW) return clock;
    if (Array.isArray(v)) return v.map(resolve);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
    }
    return v;
  };
  const merge = (into, data) => {
    const out = { ...(into || {}) };
    Object.entries(data).forEach(([k, v]) => {
      if (v === model.DELETE) delete out[k];
      else if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object')
        out[k] = merge(out[k], v);
      else out[k] = resolve(v);
    });
    return out;
  };
  writes.forEach(({ op, path, data }) => {
    if (op === 'set') store[path] = resolve(data);
    else if (op === 'update') {
      if (!store[path]) throw new Error(`No document to update: ${path}`);
      store[path] = { ...store[path], ...resolve(data) };
    } else store[path] = merge(store[path], data);
  });
}

const P = 'p1';
const indexDocs = (store) =>
  Object.entries(store)
    .filter(([path]) => path.startsWith(`muse_projects/${P}/index/`))
    .map(([path, data]) => ({ id: path.split('/').pop(), data }));
const elementOf = (store, id) => ({ id, ...store[`muse_projects/${P}/elements/${id}`] });

// Every live element is listed exactly; no retired or unknown one is.
function expectInStep(store) {
  const index = model.readIndex(indexDocs(store));
  const elements = Object.entries(store)
    .filter(([path]) => path.startsWith(`muse_projects/${P}/elements/`))
    .map(([path, data]) => ({ id: path.split('/').pop(), ...data }));
  const live = elements.filter((e) => !e.retired);
  expect(Object.keys(index.entries).sort()).toEqual(live.map((e) => e.id).sort());
  live.forEach((e) => {
    expect(index.entries[e.id]).toEqual({ ...model.entryOf(e), shard: e.shard });
    // Each write names the line it changed (the rules check it).
    expect(store[`muse_projects/${P}/index/${e.shard}`].entries[e.id]).toEqual(model.entryOf(e));
  });
  return index;
}

describe('the index kept in step', () => {
  test('through create, rename, alias changes, a bio, retiring and bringing back', () => {
    const store = {};
    let index = model.readIndex([]);
    let clock = 0;
    const run = (writes) => {
      apply(store, writes, ++clock);
      model.applyToIndex(index, writes);
      // The page's index in memory matches the one read back.
      expect(index).toEqual(expectInStep(store));
    };
    const make = (id, type, input) =>
      run(
        model.planCreate(P, id, type, model.checkElement(type, input, { elementType }).value, index)
      );
    const change = (id, input) => {
      const current = elementOf(store, id);
      const checked = model.checkElement(current.type, input, { elementType, current });
      const writes = model.planUpdate(P, current, checked.value);
      run(writes);
      return writes;
    };

    make('el_peter', 'character', { name: 'Peter', residence: 'el_sea' });
    make('el_crown', 'faction', { name: 'The Crown' });
    expect(store[`muse_projects/${P}/elements/el_peter`]).toMatchObject({
      type: 'character',
      name: 'Peter',
      aliases: [],
      appearance: '',
      residence: 'el_sea',
      shard: '0',
      retired: false,
      createdAt: 1,
      updatedAt: 1,
    });
    expect(store[`muse_projects/${P}/elements/el_crown`]).not.toHaveProperty('residence');
    expect(index.shards).toEqual({ 0: 2 });

    // Rename.
    let writes = change('el_peter', { name: 'King Peter' });
    expect(writes.map((w) => w.op)).toEqual(['update', 'merge']);
    expect(writes[1].data.last).toBe('el_peter');
    expect(index.entries.el_peter.name).toBe('King Peter');

    // Aliases added, then one taken away.
    change('el_peter', { aliases: ['Peter', 'The Drowned King'] });
    expect(index.entries.el_peter.aliases).toEqual(['Peter', 'The Drowned King']);
    change('el_peter', { aliases: ['The Drowned King'] });
    expect(index.entries.el_peter.aliases).toEqual(['The Drowned King']);

    // A bio alone leaves the index alone.
    writes = change('el_peter', { bio: 'A king under the sea.' });
    expect(writes.map((w) => w.op)).toEqual(['update']);

    // Retired: out of the index, kept in its collection.
    run(model.planRetire(P, elementOf(store, 'el_peter')));
    expect(index.entries.el_peter).toBeUndefined();
    expect(store[`muse_projects/${P}/elements/el_peter`]).toMatchObject({
      retired: true,
      name: 'King Peter',
    });
    expect(index.shards).toEqual({ 0: 1 });

    // A retired element's change leaves the index alone.
    writes = change('el_peter', { name: 'Peter the Lost' });
    expect(writes.map((w) => w.op)).toEqual(['update']);
    expect(index.entries.el_peter).toBeUndefined();

    // Brought back, under its new name.
    run(model.planRestore(P, elementOf(store, 'el_peter')));
    expect(index.entries.el_peter).toMatchObject({
      name: 'Peter the Lost',
      aliases: ['The Drowned King'],
    });
    expect(store[`muse_projects/${P}/elements/el_peter`].createdAt).toBe(1);
  });

  test('a full shard sends new elements to the next', () => {
    const shards = { 0: model.SHARD_SIZE, 1: model.SHARD_SIZE - 1 };
    expect(model.pickShard({ shards })).toBe('1');
    expect(model.pickShard({ shards: { 0: model.SHARD_SIZE, 1: model.SHARD_SIZE } })).toBe('2');
    expect(model.pickShard({ shards: {} })).toBe('0');
    expect(model.pickShard({ shards: { 0: 3 } })).toBe('0');
  });
});

// ── Photo libraries (M-104) ───────────────────────

describe('an element’s photos', () => {
  const none = { images: [], primary: null };

  test('the first photo added is the primary, and later ones go to the end', () => {
    let photos = model.addPhotos(none, ['a']);
    expect(photos).toEqual({ images: ['a'], primary: 'a' });
    photos = model.addPhotos(photos, ['b', 'c', 'a']);
    expect(photos).toEqual({ images: ['a', 'b', 'c'], primary: 'a' });
    // Nothing is changed in place.
    expect(none).toEqual({ images: [], primary: null });
  });

  test('moving earlier and later stops at the ends, and never changes the primary', () => {
    const photos = { images: ['a', 'b', 'c'], primary: 'b' };
    expect(model.movePhoto(photos, 'c', -1)).toEqual({ images: ['a', 'c', 'b'], primary: 'b' });
    expect(model.movePhoto(photos, 'a', 1)).toEqual({ images: ['b', 'a', 'c'], primary: 'b' });
    expect(model.movePhoto(photos, 'a', -1)).toEqual(photos);
    expect(model.movePhoto(photos, 'c', 1)).toEqual(photos);
    expect(model.movePhoto(photos, 'zzz', 1)).toEqual(photos);
  });

  test('a primary is one of the photos', () => {
    const photos = { images: ['a', 'b'], primary: 'a' };
    expect(model.primaryPhoto(photos, 'b')).toEqual({ images: ['a', 'b'], primary: 'b' });
    expect(model.primaryPhoto(photos, 'zzz')).toEqual(photos);
  });

  test('removing the primary hands it to the next one, or the one before the last', () => {
    expect(model.removePhoto({ images: ['a', 'b', 'c'], primary: 'a' }, 'a')).toEqual({
      images: ['b', 'c'],
      primary: 'b',
    });
    expect(model.removePhoto({ images: ['a', 'b', 'c'], primary: 'c' }, 'c')).toEqual({
      images: ['a', 'b'],
      primary: 'b',
    });
    expect(model.removePhoto({ images: ['a', 'b', 'c'], primary: 'b' }, 'a')).toEqual({
      images: ['b', 'c'],
      primary: 'b',
    });
    expect(model.removePhoto({ images: ['a'], primary: 'a' }, 'a')).toEqual(none);
    expect(model.removePhoto({ images: ['a'], primary: 'a' }, 'zzz')).toEqual({
      images: ['a'],
      primary: 'a',
    });
  });

  test('a write is checked: distinct ids, a limit, and a primary among them', () => {
    expect(model.checkPhotos({ images: [' a ', 'b', 'a'], primary: 'b' }).value).toEqual({
      images: ['a', 'b'],
      primary: 'b',
    });
    // No primary named: the first.
    expect(model.checkPhotos({ images: ['a', 'b'] }).value).toEqual({
      images: ['a', 'b'],
      primary: 'a',
    });
    expect(model.checkPhotos({}).value).toEqual(none);
    expect(model.checkPhotos({ images: ['a'], primary: 'b' }).error).toMatch(/primary/);
    expect(model.checkPhotos({ images: 'a' }).error).toMatch(/list/);
    expect(model.checkPhotos({ images: ['a', ''] }).error).toMatch(/id/);
    expect(model.checkPhotos({ images: [7] }).error).toMatch(/id/);
    expect(model.checkPhotos({ images: ['x'.repeat(201)] }).error).toMatch(/200/);
    const many = Array.from({ length: 201 }, (_, i) => `img_${i}`);
    expect(model.checkPhotos({ images: many }).error).toMatch(/200/);
    expect(model.checkPhotos({ images: many.slice(0, 200) }).error).toBeUndefined();
  });

  test('a change of primary writes the index line; moving the order does not', () => {
    const current = {
      id: 'el_x',
      type: 'faction',
      name: 'Guild',
      aliases: [],
      shard: '0',
      retired: false,
      images: ['a', 'b'],
      primary: 'a',
    };
    const moved = model.planUpdate('p1', current, model.checkPhotos(model.movePhoto(current, 'b', -1)).value);
    expect(moved.map((w) => w.path)).toEqual(['muse_projects/p1/elements/el_x']);
    const primary = model.planUpdate('p1', current, model.checkPhotos(model.primaryPhoto(current, 'b')).value);
    expect(primary.map((w) => w.path)).toEqual([
      'muse_projects/p1/elements/el_x',
      'muse_projects/p1/index/0',
    ]);
    expect(primary[1].data.entries.el_x.primary).toBe('b');
    // A retired element has no index line to keep.
    const retired = model.planUpdate(
      'p1',
      { ...current, retired: true },
      model.checkPhotos(model.primaryPhoto(current, 'b')).value
    );
    expect(retired).toHaveLength(1);
  });
});
