'use strict';

const { z } = require('zod');

// Input schemas shared by the Cartographer's read and write tools.

const worldId = z
  .string()
  .regex(/^[a-z0-9-]{1,64}$/, 'worldId must be a world id returned by list_worlds')
  .describe('The world id, from list_worlds.');

const entityId = (what, from) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,80}$/, `must be a ${what} id`)
    .describe(`The ${what} id, from ${from}.`);

// A game system (L-801).
const systemId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'a system id: lowercase letters, digits and dashes')
  .describe('The system id, from list_systems.');

module.exports = { worldId, entityId, systemId };
