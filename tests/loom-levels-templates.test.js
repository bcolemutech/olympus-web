'use strict';

/**
 * Templates (planning/map-levels.md §4.6, TM1–TM4; L-906 / #724), pure: each
 * place using a template gets its own instance, filled from it ({place}) and
 * by fill tables rolled for it, the same place always the same and two
 * places differing; and grading: a templated place counts as Playable and no
 * more, and the world criterion for a large map's places counts.
 *
 * Run: cd tests && npx jest loom-levels-templates --verbose
 */

const templates = require('../functions/loom-canon/templates');
const frames = require('../functions/loom-canon/frames');
const grading = require('../functions/loom-canon/grading');
const { andorWithTemplates } = require('./fixtures/andor-world');

describe('fill tables', () => {
  const fill = {
    stall: ['a smithy', 'a chandler', 'a bakery', 'a cooper', 'a tannery', 'a weaver'],
  };

  test('the same place rolls the same fill, and places differ', () => {
    const once = templates.rollFill('pl_ashby', 'market', fill);
    expect(templates.rollFill('pl_ashby', 'market', fill)).toEqual(once);
    const rolled = new Set(
      Array.from({ length: 12 }, (_, i) => templates.rollFill('pl_' + i, 'market', fill).stall)
    );
    expect(rolled.size).toBeGreaterThan(1);
    expect(fill.stall).toEqual(expect.arrayContaining([...rolled]));
  });

  test('{place} and the slots filled; a slot with no value left as it is', () => {
    expect(
      templates.fillText('In {place}, {stall} keeps {nobody}.', {
        place: 'Ashby',
        stall: 'a smithy',
      })
    ).toBe('In Ashby, a smithy keeps {nobody}.');
  });
});

describe('instances', () => {
  const play = frames.playWorld(andorWithTemplates());

  test('each place using a template opens its own copy, filled from it', () => {
    expect(play.maps['tpl_moon__pl_io']).toMatchObject({
      kind: 'grid',
      name: 'The surface of Io',
      parent: { mapId: 'sol', placeId: 'pl_io' },
      instanceOf: 'tpl_moon',
    });
    expect(play.maps['tpl_moon__pl_europa'].name).toBe('The surface of Europa');
    expect(play.mapPlaces.pl_io.opens).toEqual({ mapId: 'tpl_moon__pl_io', template: 'tpl_moon' });
    // As play sees it: Io's battle map is its instance, with the template's layers.
    const sol = frames.viewFor(play, 'sol');
    expect(sol.locations.pl_io.battleMap).toEqual({ mapId: 'tpl_moon__pl_io' });
    expect(sol.battleMaps['tpl_moon__pl_io'].doors[0].id).toBe('hatch');
    expect(play.maps.tpl_moon.template).toBe(true);
  });

  test('a template area’s places are copied with their fill rolled per place', () => {
    const w = andorWithTemplates();
    w.mapPlaces.pl_sol_port = { ...w.mapPlaces.pl_sol_port, opens: { template: 'tpl_hamlet' } };
    w.mapPlaces.pl_rigel = { ...w.mapPlaces.pl_rigel, opens: { template: 'tpl_hamlet' } };
    const p = frames.playWorld(w);
    const port = p.mapPlaces['tpl_hamlet_market__pl_sol_port'];
    const rigel = p.mapPlaces['tpl_hamlet_market__pl_rigel'];
    expect(port.description).toMatch(/^In Sol Port, a [a-z]+ keeps the square\.$/);
    expect(rigel.description).toMatch(/^In Rigel, a [a-z]+ keeps the square\.$/);
    expect(port.fill).toBeUndefined();
    expect(p.mapPlaces['tpl_hamlet_gate__pl_rigel']).toMatchObject({
      name: 'The gate of Rigel',
      links: [{ placeId: 'tpl_hamlet_market__pl_rigel' }],
    });
    // Played as a town: Rigel a settlement with its instance's places.
    const sector = frames.viewFor(p, 'sector');
    expect(sector.locations.pl_rigel.geo.kind).toBe('settlement');
    expect(sector.places['tpl_hamlet_market__pl_rigel'].locationId).toBe('pl_rigel');
  });
});

describe('grading', () => {
  test('a templated place counts as Playable, and its template adds nothing', () => {
    const play = frames.playWorld(andorWithTemplates());
    const sol = frames.viewFor(play, 'sol');
    const io = grading.gradeLocation(sol, sol.locations.pl_io);
    expect(io.grade).toBe('playable');
    expect(grading.isPlayable(sol, sol.locations.pl_io)).toBe(true);
    // Its own criteria only: no description of its own, so the description
    // criterion is unmet; nothing inside counts.
    expect(io.checklist.map((c) => c.need)).toContain('description');
    // Its instance stays out of the tree of maps.
    const tree = grading.gradeMaps(andorWithTemplates());
    const names = [];
    const walk = (n) => {
      names.push(n.mapId);
      (n.children || []).forEach(walk);
    };
    walk(tree);
    expect(names.some((id) => id.includes('__'))).toBe(false);
  });

  test('the world criterion: a large map’s places, open by hand or from a template', () => {
    // A sector of 30 places, 27 of them unwritten: closed, until a template
    // opens them. (The world as loaded is fixed: each variant is its own.)
    const sector = (templated) => {
      const w = andorWithTemplates();
      for (let i = 0; i < 26; i++) {
        w.mapPlaces['pl_star' + i] = {
          mapId: 'sector',
          name: 'Star ' + i,
          kind: 'star',
          at: { x: (i * 3) % 100, y: 50 },
          ...(templated ? { opens: { template: 'tpl_moon' } } : {}),
        };
      }
      if (templated)
        w.mapPlaces.pl_deneb = { ...w.mapPlaces.pl_deneb, opens: { template: 'tpl_moon' } };
      return w;
    };
    const criterion = (world) =>
      grading.gradeWorld(world).criteria.find((c) => c.id === 'world.templates');
    const before = criterion(sector(false));
    expect(before).toMatchObject({ weight: 10, met: false });
    const after = criterion(sector(true));
    expect(after.progress).toBeGreaterThan(before.progress);
    expect(after.met).toBe(true);
    // A world with no large map isn't graded on it.
    expect(criterion(andorWithTemplates())).toBeUndefined();
  });
});
