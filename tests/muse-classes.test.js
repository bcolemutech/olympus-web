'use strict';

/**
 * Classifications and classes as plain data (planning/the-muse.md §3 CL1–CL10,
 * D3–D6; M-201 / #914): public/apps/muse/js/classes.js, run on the page's copy
 * and the server's (functions/muse/classes.js). The tree and its paths; finding
 * a class by its path; deleting refused while anything is in a class; a single
 * classification keeping one class; one made single only when no element
 * holds two; refining a class; and an element's classes on its index line.
 *
 * Run: cd tests && npx jest muse-classes.test --verbose
 */

const COPIES = [
  ['the page', '../public/apps/muse/js'],
  ['the server', '../functions/muse'],
];

describe.each(COPIES)('classes.js (%s)', (_, dir) => {
  const classes = require(`${dir}/classes.js`);
  const model = require(`${dir}/model.js`);
  const P = 'p1';

  // Weapons (single): Sword › Double Edge › Longsword, and Axe; Materials
  // (multiple): Steel; Realms for locations.
  function armoury() {
    const tree = classes.emptyTree();
    const run = (plan) => {
      expect(plan.error).toBeUndefined();
      classes.applyToTree(tree, plan.value);
      return plan.value;
    };
    run(classes.planCreateClassification(P, 'cf_w', { type: 'object', name: 'Weapons' }, tree));
    run(
      classes.planCreateClassification(
        P,
        'cf_m',
        { type: 'object', name: 'Materials', multiple: true },
        tree
      )
    );
    run(classes.planCreateClassification(P, 'cf_r', { type: 'location', name: 'Realms' }, tree));
    run(classes.planCreateClass(P, 'cl_sword', { classification: 'cf_w', name: 'Sword' }, tree));
    run(classes.planCreateClass(P, 'cl_edge', { parent: 'cl_sword', name: 'Double Edge' }, tree));
    run(classes.planCreateClass(P, 'cl_long', { parent: 'cl_edge', name: 'Longsword' }, tree));
    run(classes.planCreateClass(P, 'cl_axe', { classification: 'cf_w', name: 'Axe' }, tree));
    run(classes.planCreateClass(P, 'cl_steel', { classification: 'cf_m', name: 'Steel' }, tree));
    run(classes.planCreateClass(P, 'cl_north', { classification: 'cf_r', name: 'North' }, tree));
    return tree;
  }

  describe('the tree', () => {
    test('paths, subclasses by name, everything beneath, and the order a picker lists', () => {
      const tree = armoury();
      expect(classes.pathText(tree, 'cl_long')).toBe('Weapons › Sword › Double Edge › Longsword');
      expect(classes.pathText(tree, 'cl_long', true)).toBe('Sword › Double Edge › Longsword');
      expect(classes.pathText(tree, 'cl_none')).toBe('');
      expect(classes.children(tree, 'cf_w').map((c) => c.name)).toEqual(['Axe', 'Sword']);
      expect(classes.children(tree, 'cf_w', 'cl_sword').map((c) => c.id)).toEqual(['cl_edge']);
      expect(classes.beneath(tree, 'cl_sword').sort()).toEqual(['cl_edge', 'cl_long', 'cl_sword']);
      expect(classes.flatten(tree, 'cf_w').map((c) => [c.name, c.depth])).toEqual([
        ['Axe', 1],
        ['Sword', 1],
        ['Double Edge', 2],
        ['Longsword', 3],
      ]);
      expect(classes.classificationsOf(tree, 'object').map((c) => c.name)).toEqual([
        'Materials',
        'Weapons',
      ]);
      expect(tree.classes.cl_long).toMatchObject({
        classification: 'cf_w',
        parent: 'cl_edge',
        depth: 3,
      });
    });

    test('read from documents, as the page and the connector load it', () => {
      const tree = classes.readTree(
        [{ id: 'cf_w', data: { type: 'object', name: 'Weapons', multiple: false } }],
        [
          { id: 'b', data: { classification: 'cf_w', parent: null, depth: 1, name: 'Bow' } },
          { id: 'a', data: { classification: 'cf_w', parent: null, depth: 1, name: 'axe' } },
          { id: 'c', data: { classification: 'cf_w', parent: 'b', depth: 2, name: 'Long' } },
        ]
      );
      expect(classes.children(tree, 'cf_w').map((c) => c.id)).toEqual(['a', 'b']);
      expect(classes.pathText(tree, 'c')).toBe('Weapons › Bow › Long');
      expect(classes.entriesOf(tree).c).toEqual({
        type: 'class',
        name: 'Long',
        aliases: [],
        primary: null,
        classification: 'cf_w',
      });
    });

    test('a list filtered by a class includes everything beneath it (CL5)', () => {
      const tree = armoury();
      const entries = {
        el_brand: { type: 'object', name: 'Kingsbrand', classes: ['cl_long'] },
        el_blade: { type: 'object', name: 'Blade', classes: ['cl_sword', 'cl_steel'] },
        el_cleaver: { type: 'object', name: 'Cleaver', classes: ['cl_axe'] },
        el_rock: { type: 'object', name: 'Rock' },
      };
      expect(classes.membersOf(tree, entries, 'cl_sword').sort()).toEqual(['el_blade', 'el_brand']);
      expect(classes.membersOf(tree, entries, 'cl_long')).toEqual(['el_brand']);
      expect(classes.membersOf(tree, entries, 'cl_steel')).toEqual(['el_blade']);
    });

    test('a class is found by its id, its path or the end of it, or a name only it has', () => {
      const tree = armoury();
      expect(classes.findClass(tree, 'cl_long').value).toBe('cl_long');
      expect(classes.findClass(tree, 'Longsword').value).toBe('cl_long');
      expect(classes.findClass(tree, 'weapons › sword › double edge › longsword').value).toBe(
        'cl_long'
      );
      expect(classes.findClass(tree, 'Sword > Double Edge').value).toBe('cl_edge');
      expect(classes.findClass(tree, 'Sword/Double Edge/Longsword').value).toBe('cl_long');
      expect(classes.findClass(tree, 'North', 'object').error).toMatch(/No class “North”/);
      expect(classes.findClass(tree, 'cl_north', 'object').error).toMatch(/another type/);
      // Two of the same name: more of the path is asked for.
      classes.applyToTree(
        tree,
        classes.planCreateClass(P, 'cl_x', { parent: 'cl_axe', name: 'Double Edge' }, tree).value
      );
      expect(classes.findClass(tree, 'Double Edge').error).toMatch(
        /could be Weapons › Axe › Double Edge or Weapons › Sword › Double Edge|could be Weapons › Sword › Double Edge or Weapons › Axe › Double Edge/
      );
      expect(classes.findClass(tree, 'Axe › Double Edge').value).toBe('cl_x');
    });
  });

  describe('making and changing them', () => {
    test('a class goes one level below its parent, at most 6 deep, named uniquely among siblings', () => {
      const tree = armoury();
      let parent = 'cl_long';
      ['Four', 'Five', 'Six'].forEach((name, i) => {
        const plan = classes.planCreateClass(P, `cl_${i}`, { parent, name }, tree);
        expect(plan.value[0].data.depth).toBe(4 + i);
        classes.applyToTree(tree, plan.value);
        parent = `cl_${i}`;
      });
      expect(classes.planCreateClass(P, 'cl_7', { parent, name: 'Seven' }, tree).error).toMatch(
        /at most 6 levels deep/
      );
      expect(
        classes.planCreateClass(P, 'cl_s', { classification: 'cf_w', name: 'sword' }, tree).error
      ).toMatch(/already a class called that/);
      expect(
        classes.planCreateClass(
          P,
          'cl_s',
          { parent: 'cl_sword', classification: 'cf_m', name: 'X' },
          tree
        ).error
      ).toMatch(/parent’s classification/);
      expect(
        classes.planCreateClass(P, 'cl_s', { classification: 'cf_none', name: 'X' }, tree).error
      ).toMatch(/no such classification/);
      expect(
        classes.planCreateClassification(P, 'cf_x', { type: 'object', name: 'WEAPONS' }, tree).error
      ).toMatch(/already has a classification/);
      // A location may have its own "Weapons".
      expect(
        classes.planCreateClassification(P, 'cf_x', { type: 'location', name: 'Weapons' }, tree)
          .error
      ).toBeUndefined();
      expect(
        classes.planCreateClassification(P, 'cf_x', { type: 'weapon', name: 'X' }, tree).error
      ).toMatch(/no element type/);
    });

    test('a class is renamed and described, never moved; its links are its mentions', () => {
      const tree = armoury();
      const plan = classes.planUpdateClass(P, tree, 'cl_long', {
        name: 'Greatsword',
        description: 'Kin to the [Axe](muse:cl/cl_axe) and [Hild](muse:el/el_hild).',
        parent: 'cl_axe',
      });
      expect(plan.value).toEqual([
        {
          op: 'update',
          path: 'muse_projects/p1/classes/cl_long',
          data: {
            name: 'Greatsword',
            description: 'Kin to the [Axe](muse:cl/cl_axe) and [Hild](muse:el/el_hild).',
            mentions: ['cl_axe', 'el_hild'],
            updatedAt: model.NOW,
          },
        },
      ]);
      expect(classes.planUpdateClass(P, tree, 'cl_long', { name: 'double edge' }).error).toBe(
        undefined
      );
      expect(classes.planUpdateClass(P, tree, 'cl_sword', { name: 'Axe' }).error).toMatch(
        /already a class/
      );
      expect(classes.planUpdateClass(P, tree, 'cl_sword', {}).error).toMatch(/Say what/);
    });

    test('deleting a class with an element or a subclass in it is refused (CL7)', () => {
      const tree = armoury();
      expect(classes.planDeleteClass(P, tree, 'cl_edge', false).error).toMatch(/subclasses/);
      expect(classes.planDeleteClass(P, tree, 'cl_long', true).error).toMatch(/Elements are in it/);
      expect(classes.planDeleteClass(P, tree, 'cl_long', false).value).toEqual([
        { op: 'delete', path: 'muse_projects/p1/classes/cl_long' },
      ]);
      expect(classes.planDeleteClassification(P, tree, 'cf_w').error).toMatch(/still has classes/);
      classes.applyToTree(tree, classes.planDeleteClass(P, tree, 'cl_north', false).value);
      expect(classes.planDeleteClassification(P, tree, 'cf_r').value).toEqual([
        { op: 'delete', path: 'muse_projects/p1/classifications/cf_r' },
      ]);
    });

    test('a classification is made single only while no element holds two of its classes (D6)', () => {
      const tree = armoury();
      const holders = [
        { id: 'el_a', name: 'Kingsbrand', classes: ['cl_steel'] },
        { id: 'el_b', name: 'Blade', classes: ['cl_steel', 'cl_x'] },
      ];
      expect(
        classes.planUpdateClassification(P, tree, 'cf_m', { multiple: false }, holders).value
      ).toBeDefined();
      classes.applyToTree(
        tree,
        classes.planCreateClass(P, 'cl_iron', { classification: 'cf_m', name: 'Iron' }, tree).value
      );
      holders[1].classes = ['cl_steel', 'cl_iron'];
      expect(
        classes.planUpdateClassification(P, tree, 'cf_m', { multiple: false }, holders).error
      ).toMatch(/Blade holds two of its classes/);
      // Multiple again, or a rename, needs no check.
      expect(
        classes.planUpdateClassification(P, tree, 'cf_w', { multiple: true, name: 'Arms' }, [])
          .value[0].data
      ).toEqual({ multiple: true, name: 'Arms', updatedAt: model.NOW });
    });
  });

  describe('classifying an element', () => {
    test('a single classification keeps one class: a second replaces the first (D6)', () => {
      const tree = armoury();
      expect(classes.classify(tree, ['cl_long'], ['cl_axe'], [])).toEqual(['cl_axe']);
      // Materials is multiple: both stay, with the weapon.
      classes.applyToTree(
        tree,
        classes.planCreateClass(P, 'cl_oak', { classification: 'cf_m', name: 'Oak' }, tree).value
      );
      expect(classes.classify(tree, ['cl_axe', 'cl_steel'], ['cl_oak'], [])).toEqual([
        'cl_axe',
        'cl_steel',
        'cl_oak',
      ]);
      expect(classes.checkClasses(tree, 'object', ['cl_long', 'cl_axe']).error).toMatch(
        /Weapons gives an element only one class/
      );
    });

    test('a class at any level, refined later: the one above makes way (CL2)', () => {
      const tree = armoury();
      expect(classes.classify(tree, [], ['cl_sword'], [])).toEqual(['cl_sword']);
      classes.applyToTree(
        tree,
        classes.planUpdateClassification(P, tree, 'cf_w', { multiple: true }).value
      );
      expect(classes.classify(tree, ['cl_sword', 'cl_axe'], ['cl_long'], [])).toEqual([
        'cl_axe',
        'cl_long',
      ]);
      // And back up: the Longsword makes way for Sword.
      expect(classes.classify(tree, ['cl_long'], ['cl_sword'], [])).toEqual(['cl_sword']);
      expect(classes.classify(tree, ['cl_long', 'cl_axe'], [], ['cl_axe'])).toEqual(['cl_long']);
    });

    test('an element’s classes are its type’s, each once, at most 50', () => {
      const tree = armoury();
      expect(
        classes.checkClasses(tree, 'object', ['cl_long', 'cl_long', ' cl_steel ']).value
      ).toEqual(['cl_long', 'cl_steel']);
      expect(classes.checkClasses(tree, 'object', ['cl_north']).error).toMatch(/another type/);
      expect(classes.checkClasses(tree, 'object', ['cl_none']).error).toMatch(/no such class/);
      // One it already holds may stay, as a field kept.
      expect(classes.checkClasses(tree, 'object', ['cl_gone'], ['cl_gone']).value).toEqual([
        'cl_gone',
      ]);
      expect(classes.checkClasses(tree, 'object', 'cl_long').error).toMatch(/must be a list/);
      for (let i = 0; i < 51; i++) {
        classes.applyToTree(
          tree,
          classes.planCreateClass(P, `cl_m${i}`, { classification: 'cf_m', name: `M${i}` }, tree)
            .value
        );
      }
      const many = Array.from({ length: 51 }, (_, i) => `cl_m${i}`);
      expect(classes.checkClasses(tree, 'object', many).error).toMatch(/at most 50 classes/);
      expect(classes.checkClasses(tree, 'object', many.slice(1)).value).toHaveLength(50);
    });

    test('an element’s classes are on its index line (D3)', () => {
      const tree = armoury();
      const checked = model.checkElement(
        'object',
        { name: 'Kingsbrand', classes: ['cl_long'] },
        { tree }
      );
      const writes = model.planCreate(P, 'el_brand', 'object', checked.value, model.readIndex([]));
      expect(writes[0].data.classes).toEqual(['cl_long']);
      expect(writes[1].data.entries.el_brand.classes).toEqual(['cl_long']);
      expect(
        model.checkElement('object', { name: 'X', classes: ['cl_north'] }, { tree }).error
      ).toMatch(/another type/);
      // An element made without classes holds none.
      const plain = model.planCreate(
        P,
        'el_rock',
        'object',
        model.checkElement('object', { name: 'Rock' }, {}).value,
        model.readIndex([])
      );
      expect(plain[0].data.classes).toEqual([]);
      expect(plain[1].data.entries.el_rock.classes).toEqual([]);
    });
  });
});
