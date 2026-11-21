'use strict';

/**
 * The Muse's versions as plain data (planning/the-muse.md §3 VR1, VR2, PL2,
 * MS5, §4; M-105 / #893): what a version holds, the last 50 of each thing
 * kept (the 51st deleting the oldest, and no other thing's), names checked,
 * and the page's and the server's copies of the helper identical.
 *
 * Run: cd tests && npx jest muse-versions.test --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const versions = require('../public/apps/muse/js/versions.js');
const model = require('../public/apps/muse/js/model.js');

const PETER = 'muse_projects/p1/elements/el_peter';

// `n` versions of one thing, 10 ms apart from 10, ids v01…
const kept = (n, of = PETER) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'v' + String(i + 1).padStart(2, '0'),
    of,
    at: (i + 1) * 10,
  }));

const save = (existing, extra = {}) =>
  versions.planSave({
    projectId: 'p1',
    id: 'new',
    of: PETER,
    data: { type: 'character', name: 'King Peter' },
    existing,
    by: 'page',
    ...extra,
  });

describe('where a version lives', () => {
  test('the paths of the project, an element and a version', () => {
    expect(versions.ofPath('p1')).toBe('muse_projects/p1');
    expect(versions.ofPath('p1', null, null)).toBe('muse_projects/p1');
    expect(versions.ofPath('p1', 'elements', 'el_peter')).toBe(PETER);
    expect(versions.versionPath('p1', 'v1')).toBe('muse_projects/p1/versions/v1');
  });

  test('the last 50 of each thing are kept', () => {
    expect(versions.KEEP).toBe(50);
  });
});

describe('saving one', () => {
  test('a version holds the thing, its name, who kept it and when', () => {
    const plan = save([], { name: '  Before   the war ' });
    expect(plan.error).toBeUndefined();
    expect(plan.id).toBe('new');
    expect(plan.dropped).toEqual([]);
    expect(plan.writes).toEqual([
      {
        op: 'set',
        path: 'muse_projects/p1/versions/new',
        data: {
          of: PETER,
          snapshot: { type: 'character', name: 'King Peter' },
          name: 'Before the war',
          by: 'page',
          at: versions.NOW,
        },
      },
    ]);
  });

  test('a name is optional, and kept as null', () => {
    expect(save([]).writes[0].data.name).toBeNull();
    expect(save([], { name: '   ' }).writes[0].data.name).toBeNull();
    expect(save([], { name: null }).writes[0].data.name).toBeNull();
  });

  test('a version is by the page or by mcp, and nothing else', () => {
    expect(save([], { by: 'mcp' }).writes[0].data.by).toBe('mcp');
    expect(save([], { by: 'someone' }).error).toMatch(/page or mcp/);
    expect(save([], { by: undefined }).error).toMatch(/page or mcp/);
  });

  test('it needs its project, its id and what it is of', () => {
    expect(save([], { projectId: '' }).error).toBeDefined();
    expect(save([], { id: '' }).error).toBeDefined();
    expect(save([], { of: '' }).error).toBeDefined();
    expect(versions.planSave().error).toBeDefined();
  });

  test('a name is at most 100 characters', () => {
    expect(save([], { name: 'x'.repeat(100) }).error).toBeUndefined();
    expect(save([], { name: 'x'.repeat(101) }).error).toMatch(/at most 100/);
    expect(versions.checkName('x'.repeat(101)).error).toBeDefined();
    expect(versions.checkName(' Kept ').value).toBe('Kept');
  });

  test('its time is the server’s, told by its shape and not only by identity', () => {
    const at = save([]).writes[0].data.at;
    expect(versions.isNow(at)).toBe(true);
    expect(versions.isNow(model.NOW)).toBe(true);
    expect(versions.isNow({ __muse: 'delete' })).toBe(false);
    expect(versions.isNow(null)).toBe(false);
    expect(versions.isNow(5)).toBe(false);
  });
});

describe('the snapshot', () => {
  test('is the whole document, without its id or anything undefined', () => {
    // A time as Firestore keeps it: an instance of a class of its own.
    class Timestamp {
      toMillis() {
        return 5;
      }
    }
    const when = new Timestamp();
    const snapshot = versions.snapshotOf({
      id: 'el_peter',
      name: 'King Peter',
      aliases: ['Peter', undefined],
      fields: { born: { year: 312 }, temper: undefined },
      primary: null,
      createdAt: when,
    });
    expect(snapshot).toEqual({
      name: 'King Peter',
      aliases: ['Peter'],
      fields: { born: { year: 312 } },
      primary: null,
      createdAt: when,
    });
    // Times stay what they were (Firestore keeps them as times).
    expect(snapshot.createdAt).toBe(when);
  });

  test('is a copy: changing the thing afterwards leaves the version alone', () => {
    const data = { name: 'King Peter', aliases: ['Peter'], fields: { born: { year: 312 } } };
    const { writes } = save([], { data });
    data.aliases.push('The Drowned King');
    data.fields.born.year = 999;
    expect(writes[0].data.snapshot).toEqual({
      name: 'King Peter',
      aliases: ['Peter'],
      fields: { born: { year: 312 } },
    });
  });

  test('of nothing is an empty snapshot', () => {
    expect(versions.snapshotOf()).toEqual({});
    expect(versions.snapshotOf(null)).toEqual({});
  });
});

describe('the last 50', () => {
  test('under 50, nothing is deleted', () => {
    expect(save(kept(0)).dropped).toEqual([]);
    expect(save(kept(1)).dropped).toEqual([]);
    expect(save(kept(49)).dropped).toEqual([]);
    expect(save(kept(49)).writes).toHaveLength(1);
  });

  test('the 51st deletes the oldest', () => {
    const plan = save(kept(50));
    expect(plan.dropped).toEqual(['v01']);
    expect(plan.writes.map((w) => [w.op, w.path])).toEqual([
      ['set', 'muse_projects/p1/versions/new'],
      ['delete', 'muse_projects/p1/versions/v01'],
    ]);
    // Fifty are left: the new one and the 49 newest.
    expect(kept(50).length - plan.dropped.length + 1).toBe(50);
  });

  test('the oldest is by time, not by the order they are listed in', () => {
    const shuffled = kept(50).reverse();
    expect(save(shuffled).dropped).toEqual(['v01']);
    const mixed = kept(50).sort((a, b) => (a.id < b.id ? 1 : -1));
    expect(save(mixed).dropped).toEqual(['v01']);
  });

  test('times may be Firestore’s, dates or numbers', () => {
    const existing = kept(50).map((v, i) => ({
      id: v.id,
      at: i % 3 === 0 ? { toMillis: () => v.at } : i % 3 === 1 ? new Date(v.at) : v.at,
    }));
    expect(save(existing).dropped).toEqual(['v01']);
  });

  test('more than that, which piled up, are brought back to 50', () => {
    const plan = save(kept(53));
    expect(plan.dropped).toEqual(['v01', 'v02', 'v03', 'v04']);
    expect(53 - plan.dropped.length + 1).toBe(50);
  });

  test('two at the same time: the later id is kept, so the choice is the same each time', () => {
    const tied = [
      { id: 'b', at: 5 },
      { id: 'a', at: 5 },
      ...kept(48).map((v) => ({ ...v, at: v.at + 100 })),
    ];
    expect(save(tied).dropped).toEqual(['a']);
    expect(save(tied.slice().reverse()).dropped).toEqual(['a']);
  });

  test('which versions are surplus is a question of the one thing’s alone', () => {
    // The caller gives the versions of this one thing: the helper never mixes.
    expect(versions.surplus(kept(50))).toHaveLength(1);
    expect(versions.surplus(kept(10))).toEqual([]);
    expect(versions.surplus()).toEqual([]);
  });
});

describe("the page's and the server's copies", () => {
  const served = path.join(__dirname, '../public/apps/muse/js/versions.js');
  const server = path.join(__dirname, '../functions/muse/versions.js');

  test('are identical, byte for byte', () => {
    expect(fs.readFileSync(served, 'utf8')).toBe(fs.readFileSync(server, 'utf8'));
  });

  test('load as Muse.versions on the page and as a module on the server', () => {
    const page = { window: { Muse: {} } };
    vm.runInNewContext(fs.readFileSync(served, 'utf8'), page);
    expect(page.window.Muse.versions.KEEP).toBe(50);
    expect(page.window.Muse.versions.planSave).toEqual(expect.any(Function));
    expect(require('../functions/muse/versions.js').KEEP).toBe(50);
  });
});

describe('the page', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/apps/muse/index.html'), 'utf8');
  const at = (name) => html.indexOf(`<script src="/apps/muse/js/${name}"></script>`);

  test('loads the helper before the files that use it, and the store before the form', () => {
    ['versions.js', 'version-store.js', 'version-form.js'].forEach((file) =>
      expect(at(file)).toBeGreaterThan(-1)
    );
    expect(at('versions.js')).toBeLessThan(at('elements.js'));
    expect(at('elements.js')).toBeLessThan(at('version-store.js'));
    expect(at('version-store.js')).toBeLessThan(at('version-form.js'));
    expect(at('version-form.js')).toBeLessThan(at('project.js'));
    expect(at('version-form.js')).toBeLessThan(at('element.js'));
    expect(at('version-form.js')).toBeLessThan(at('app.js'));
  });

  test('deletes a project’s versions with it', () => {
    const page = { window: {}, document: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/apps/muse/js/state.js'), 'utf8'), page);
    expect(page.window.Muse.PROJECT_PARTS).toContain('versions');
  });
});
