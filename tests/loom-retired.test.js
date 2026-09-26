'use strict';

/**
 * Retired entities in the Loom's turn pipeline (C-4 / #371). A published
 * world's places, characters and lore are retired rather than deleted, so a
 * save that references one still resolves, but nobody can target, meet or
 * travel to it. Pure unit tests with a hand-built world: no emulator.
 *
 * Run: cd tests && npx jest loom-retired --verbose
 */

const mockCallGemini = jest.fn();
jest.mock('../functions/gemini', () => ({
  callGemini: (...args) => mockCallGemini(...args),
}));

const { interpretAction } = require('../functions/loom-turn/interpret');
const { resolveSceneEntityIds } = require('../functions/loom-turn/narrate');
const { evaluate } = require('../functions/loom-turn/adjudicate');
const { entitySnippet, findEntity } = require('../functions/loom-canon');
const { makeWorld } = require('./fixtures/loom');

// A world whose retired place is still listed as a connection, as a static
// world might be; Firestore-backed worlds additionally drop such links.
const WORLD = makeWorld({
  locations: {
    start: {
      id: 'start',
      name: 'Starting Point',
      description: 'Where it all begins.',
      connections: ['next', 'ruined-fort'],
      factionIds: [],
      npcIds: ['old-hermit', 'young-scout'],
      rules: {},
    },
    next: {
      id: 'next',
      name: 'Next Place',
      description: 'Further along.',
      connections: ['start'],
      factionIds: [],
      npcIds: [],
      rules: {},
    },
    'ruined-fort': {
      id: 'ruined-fort',
      name: 'Ruined Fort',
      description: 'Rubble, now.',
      connections: ['start'],
      factionIds: [],
      npcIds: [],
      rules: {},
      retired: true,
    },
  },
  characters: {
    'old-hermit': {
      id: 'old-hermit',
      name: 'Old Hermit',
      description: 'Gone.',
      locationId: 'start',
      retired: true,
    },
    'young-scout': {
      id: 'young-scout',
      name: 'Young Scout',
      description: 'Eager.',
      locationId: 'start',
    },
  },
  lore: {
    fall: {
      id: 'fall',
      title: 'The Fall',
      text: 'The fort fell.',
      entityRefs: ['start'],
      retired: true,
    },
    founding: {
      id: 'founding',
      title: 'The Founding',
      text: 'Settled long ago.',
      entityRefs: ['start'],
    },
  },
});

beforeEach(() => mockCallGemini.mockReset());

test('interpret never offers a retired place or character to the model, or resolves to one', async () => {
  mockCallGemini.mockResolvedValueOnce({ verb: 'move', targets: ['Ruined Fort'], params: {} });
  const action = await interpretAction({
    actionText: 'go to the ruined fort',
    canonWorld: WORLD,
    save: { location: 'start' },
    worldState: {},
  });
  const prompt = JSON.stringify(mockCallGemini.mock.calls[0][0]);
  expect(prompt).toContain('Next Place');
  expect(prompt).toContain('Young Scout');
  expect(prompt).not.toContain('Ruined Fort');
  expect(prompt).not.toContain('Old Hermit');
  expect(action.targets).toEqual(['Ruined Fort']); // left as raw text, not the retired id
});

test('narrate leaves retired characters out of the scene', () => {
  expect(resolveSceneEntityIds(WORLD, { location: 'start' }, { targets: [] })).toEqual([
    'young-scout',
  ]);
});

test('adjudicate blocks travel to a retired place even if a connection still points there', () => {
  const move = (to) =>
    evaluate({ verb: 'move', targets: [to], params: {} }, {}, { location: 'start' }, 10, WORLD);
  expect(move('ruined-fort')).toMatchObject({
    outcome: 'blocked',
    constraints: ["That place can't be reached anymore."],
  });
  expect(move('next').outcome).toBe('success');
});

test('a save standing in a retired place still resolves it', () => {
  expect(findEntity(WORLD, 'ruined-fort')).toMatchObject({ type: 'location' });
  expect(entitySnippet(WORLD, 'ruined-fort')).toMatch(/^Ruined Fort — Rubble, now\./);
});

test('retired lore is left out of snippets', () => {
  const snippet = entitySnippet(WORLD, 'start');
  expect(snippet).toContain('The Founding');
  expect(snippet).not.toContain('The Fall');
});
