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

// Wary figures (L-392; loom-modules/combat/wary.js): what they say first,
// and what turns them.
const { EVENTS, THEN, MAX_TRIGGERS } = require('../../../loom-modules/combat/wary');
const checkId = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);
const challenge = z
  .strictObject({
    says: z.string().trim().min(1).max(300).describe('What they say: "Halt. Name your business."'),
    check: z
      .union([z.strictObject({ skill: checkId }), z.strictObject({ attribute: checkId })])
      .optional()
      .describe(
        'The check that answers it, { skill } or { attribute } of the world’s system: failing ' +
          'it against them turns them hostile (a Deception check against a gate guard).'
      ),
  })
  .describe('A wary figure’s challenge (L-392).');
const triggers = z
  .array(
    z.strictObject({
      on: z
        .enum(EVENTS)
        .describe(
          'doorOpened, doorForced (unlocked without its key), featureTouched, allyAttacked or ' +
            'enteredArea.'
        ),
      target: z
        .string()
        .regex(/^[A-Za-z0-9_:-]{1,80}$/)
        .optional()
        .describe(
          'The door, feature or area id on their map; for allyAttacked, a character or figure ' +
            'group id (none: anyone else on the map attacked).'
        ),
      then: z.enum(THEN).describe('hostile, or neutral to calm a hostile.'),
    })
  )
  .max(MAX_TRIGGERS)
  .describe('What turns them (L-392): each { on, target?, then }.');

module.exports = { worldId, entityId, systemId, challenge, triggers };
