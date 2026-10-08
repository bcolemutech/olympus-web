'use strict';

/**
 * The Shattered Coast test fixture (tests/fixtures/coast-world.js), for the
 * tests that grew up on it (there are no built-in worlds since L-686 / #519):
 *
 *   - `COAST`, frozen, for pure tests that take a world object;
 *   - `canonWithCoast()`, for tests that play it through the Loom's
 *     callables: the real loom-canon module, whose loadWorld serves the
 *     fixture for its id and loads every other world from Firestore as usual.
 *     Use it as `jest.mock('../functions/loom-canon', () =>
 *     require('./helpers/coast').canonWithCoast())`. Being a world object
 *     with no draft or published status, the fixture isn't graded, as the
 *     Phase 1 pipeline it tests never was.
 */

const COAST_DATA = require('../fixtures/coast-world');

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

const COAST = deepFreeze(JSON.parse(JSON.stringify(COAST_DATA)));

function canonWithCoast() {
  // eslint-disable-next-line no-undef -- run inside a jest.mock factory
  const real = jest.requireActual('../../functions/loom-canon');
  return {
    ...real,
    loadWorld: async (worldId, options) =>
      worldId === COAST.id ? COAST : real.loadWorld(worldId, options),
  };
}

module.exports = { COAST, canonWithCoast };
