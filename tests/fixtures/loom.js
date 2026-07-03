'use strict';

/**
 * Fixture factories for Loom turn-pipeline tests (L-130 / #307).
 *
 * Mirrors the style of the removed tests/fixtures/void-odyssey.js factory
 * pattern for this project's turn-test convention: small, override-friendly
 * builders rather than hand-rolled literals scattered across test files.
 */

/** A minimal but structurally complete canon world (functions/loom-canon shape). */
function makeWorld(overrides) {
  var base = {
    id: 'test-world',
    name: 'Test World',
    tagline: 'A test world.',
    openingHook: 'You begin.',
    locations: {
      start: {
        id: 'start',
        name: 'Starting Point',
        description: 'Where it all begins.',
        connections: ['next'],
        factionIds: [],
        npcIds: [],
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
    },
    factions: {},
    characters: {},
    lore: {},
    rules: { startingLocationId: 'start', startingAbilities: [] },
  };
  return Object.assign({}, base, overrides || {});
}

function makeCharacter(overrides) {
  return Object.assign(
    { name: 'Test Character', condition: 'healthy', inventory: [], abilities: [], goals: [] },
    overrides || {}
  );
}

/** A loom_saves-shaped document. Timestamps are left for the caller to fill in. */
function makeSave(overrides) {
  var base = {
    ownerUid: 'test-uid',
    worldId: 'test-world',
    name: 'Test Save',
    character: makeCharacter(),
    location: 'start',
    privateFlags: {},
    relationships: {},
    recentSummary: '',
  };
  return Object.assign({}, base, overrides || {});
}

/** A loom_turns-shaped document. */
function makeTurn(overrides) {
  return Object.assign(
    {
      index: 0,
      actionText: 'look around',
      proposedAction: { verb: 'look', targets: [], params: {} },
      resolution: { outcome: 'acknowledged', mutations: [], constraints: [] },
      narration: 'Nothing happens.',
      entityRefs: [],
    },
    overrides || {}
  );
}

/** An ADJUDICATE-shaped Resolution. */
function makeResolution(overrides) {
  return Object.assign({ outcome: 'success', mutations: [], constraints: [] }, overrides || {});
}

/** An INTERPRET-shaped proposedAction. */
function makePlayerAction(overrides) {
  return Object.assign({ verb: 'look', targets: [], params: {} }, overrides || {});
}

/** A mocked callGemini response for the NARRATE stage's JSON contract. */
function makeAiResponse(overrides) {
  return Object.assign(
    { narration: 'Default narration.', inventedEntities: [], suggestedActions: [] },
    overrides || {}
  );
}

module.exports = {
  makeWorld,
  makeCharacter,
  makeSave,
  makeTurn,
  makeResolution,
  makePlayerAction,
  makeAiResponse,
};
