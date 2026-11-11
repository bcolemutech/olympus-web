'use strict';

/**
 * Making portraits and grading them (planning/tokens.md §4.4, §4.5; L-934 /
 * #792): the studio asks for a token as a face centred on a plain background,
 * a stat block can be drawn `from`, and people's pictures count in the grade
 * and the work list. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-token-making --verbose
 */

const { buildPrompt, fromData, FROM_KINDS, TOKEN_PROMPT } = require('../functions/studio/jobs');
const {
  RUBRIC_VERSION,
  CRITERIA,
  LAYER_CHECKS,
  gradeCharacter,
  gradeWorld,
} = require('../functions/loom-canon/grading');
const { workList } = require('../functions/mcp/apps/cartographer/work');

const pic = (n) => ({
  imageId: `img_${String(n).padStart(16, '0')}`,
  link: `https://example.test/studio/${n}`,
  width: 512,
  height: 512,
  format: 'png',
});
const criterion = (id) => CRITERIA.find((c) => c.id === id);
const layers = { ...LAYER_CHECKS, town: () => true };

const BLOCK = { attributes: { str: 12, dex: 14, con: 12, int: 10, wis: 10, cha: 8 } };
const world = (extra = {}) => ({
  id: 'w',
  status: 'draft',
  statBlocks: {
    bandit: { id: 'bandit', name: 'Bandit', statBlock: { ...BLOCK, traits: ['sneaky'] } },
    guard: { id: 'guard', name: 'Gate guard', statBlock: BLOCK, token: pic(1) },
    rat: { id: 'rat', name: 'Rat', statBlock: BLOCK },
  },
  characters: {},
  factions: {},
  battleMaps: {
    camp: {
      id: 'camp',
      name: 'Camp',
      width: 10,
      height: 10,
      figures: [
        { id: 'bandits', name: 'Bandits', statBlock: 'bandit', count: 6 },
        { id: 'watch', name: 'The watch', statBlock: 'guard', count: 2 },
      ],
    },
  },
  ...extra,
});

describe('the studio asks for a portrait that crops to a circle', () => {
  test('a token or portrait gets the head-and-shoulders instruction, other kinds do not', () => {
    for (const kind of ['token', 'portrait']) {
      const prompt = buildPrompt('A tired guard.', null, null, kind);
      expect(prompt).toBe(`The image:\nA tired guard.\n\n${TOKEN_PROMPT}`);
      expect(prompt).toMatch(/head-and-shoulders/);
      expect(prompt).toMatch(/face centred/);
      expect(prompt).toMatch(/plain background/);
      expect(prompt).toMatch(/edge/);
    }
    expect(buildPrompt('A harbour.', null, null, 'town')).toBe('A harbour.');
    expect(buildPrompt('A harbour.', null, null)).toBe('A harbour.');
  });

  test('it follows the world’s data and the style, and ends the prompt', () => {
    const prompt = buildPrompt('Mordrake.', { text: 'Mordrake: a bandit.' }, null, 'portrait');
    expect(prompt.startsWith('About what to draw:\nMordrake: a bandit.')).toBe(true);
    expect(prompt.endsWith(TOKEN_PROMPT)).toBe(true);
  });
});

describe('from a stat block', () => {
  test('it is a kind the studio can draw from', () => {
    expect(FROM_KINDS).toContain('statBlock');
  });

  test('its name, traits and who stands for it are in the prompt; it is a square token', () => {
    const info = fromData(world(), { kind: 'statBlock', id: 'bandit' }, { placesOf: () => [] });
    expect(info.kind).toBe('token');
    expect(info.name).toBe('Bandit');
    expect(info.text).toMatch(/Bandit/);
    expect(info.text).toMatch(/sneaky/);
    expect(info.text).toMatch(/Bandits/);
  });

  test('one that is not there is refused', () => {
    expect(() =>
      fromData(world(), { kind: 'statBlock', id: 'dragon' }, { placesOf: () => [] })
    ).toThrow(/No stat block/);
  });
});

describe('grading: a character’s token picture', () => {
  const w = world({
    characters: {
      own: { id: 'own', name: 'Mordrake', token: pic(2) },
      shared: { id: 'shared', name: 'Captain', statBlock: 'guard' },
      bare: { id: 'bare', name: 'Hermit' },
      blockless: { id: 'blockless', name: 'Cook', statBlock: 'rat' },
    },
  });
  const met = (id) => criterion('character.token').check(w, w.characters[id], { layers }).progress;

  test('a character with a picture meets it, one without does not', () => {
    expect(met('own')).toBe(1);
    expect(met('bare')).toBe(0);
  });

  test('a stat block’s picture counts for those who name it', () => {
    expect(met('shared')).toBe(1);
    expect(met('blockless')).toBe(0);
  });

  test('it is on the checklist, with the tool, and the rubric moved on', () => {
    const graded = gradeCharacter(w, w.characters.bare);
    const item = graded.checklist.find((i) => i.criterion === 'character.token');
    expect(item).toMatchObject({ need: 'token', tool: 'set_token', for: 'score' });
    expect(gradeCharacter(w, w.characters.own).checklist.map((i) => i.criterion)).not.toContain(
      'character.token'
    );
    expect(RUBRIC_VERSION).toBeGreaterThanOrEqual(13);
    expect(criterion('character.token').bonus).toBe(true);
    expect(gradeCharacter(w, w.characters.own).score).toBeGreaterThan(
      gradeCharacter(w, w.characters.bare).score
    );
  });
});

describe('grading: the world’s placed stat blocks', () => {
  const c = criterion('world.tokens');

  test('it counts the stat blocks the figures on battle maps stand for', () => {
    const w = world();
    expect(c.applies(w)).toBe(true);
    const result = c.check(w);
    expect(result.progress).toBe(0.5);
    expect(result.have).toBe(1);
    expect(result.want).toBe(2);
    expect(result.lacking).toEqual(['Bandit']);
    expect(result.message).toMatch(/Bandit/);
  });

  test('a stat block nobody places is not asked for, and all pictured is met', () => {
    const w = world();
    w.statBlocks.bandit.token = pic(3);
    expect(c.check(w).progress).toBe(1);
  });

  test('a world that places none is not graded on it', () => {
    const w = world();
    w.battleMaps = {};
    expect(c.applies(w)).toBe(false);
    expect(gradeWorld(w).criteria.map((x) => x.id)).not.toContain('world.tokens');
    expect(gradeWorld(world()).criteria.map((x) => x.id)).toContain('world.tokens');
  });

  test('a retired map’s figures are not counted', () => {
    const w = world();
    w.battleMaps.camp.retired = true;
    expect(c.applies(w)).toBe(false);
  });
});

describe('the work list', () => {
  const full = () => {
    const w = world({
      locations: {
        town: {
          id: 'town',
          name: 'Town',
          description: 'A town.',
          connections: [],
          geo: { kind: 'settlement', population: 100, regionId: 'reg' },
        },
      },
      places: {},
      factions: {},
      regions: { reg: { id: 'reg', name: 'Reg' } },
      lore: {},
      rules: { startingLocationId: 'town' },
      characters: {
        mara: { id: 'mara', name: 'Mara', locationId: 'town', description: 'A cook.' },
        pic: { id: 'pic', name: 'Pic', locationId: 'town', token: pic(9) },
      },
    });
    return w;
  };

  test('names the characters without pictures, and how to give one', () => {
    const list = workList(full(), { need: 'token', limit: 50, offset: 0 });
    expect(list.items).toHaveLength(1);
    const group = list.items[0];
    expect(group).toMatchObject({ criterion: 'character.token', tool: 'set_token' });
    expect(group.entities.map((e) => e.id)).toEqual(['mara']);
    expect(list.howTo.token).toMatch(/set_token/);
  });

  test('names the stat blocks placed without pictures', () => {
    const list = workList(full(), { need: 'tokens', limit: 50, offset: 0 });
    expect(list.items).toHaveLength(1);
    const [entity] = list.items[0].entities;
    expect(entity.lacking).toEqual(['Bandit']);
    expect(entity.message).toMatch(/Bandit/);
    expect(list.howTo.tokens).toMatch(/set_token/);
  });
});
