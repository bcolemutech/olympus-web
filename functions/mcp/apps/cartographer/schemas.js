'use strict';

const { z } = require('zod');
const { MAX_WAYPOINTS, MAX_ABILITY } = require('../../../loom-canon/routes');

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

// A place's table of encounters (L-927; loom-modules/combat/spawns.js): what a
// generic spawn is filled with when an event (a broken rest) fills the map.
const encounters = z
  .array(
    z.strictObject({
      what: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
        .describe('A stat block of the world (list_stat_blocks): "wolf".'),
      count: z.number().int().min(1).max(20).optional().describe('How many (1 by default).'),
      weight: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How likely this row is against the others (1 by default).'),
    })
  )
  .max(20)
  .describe(
    'Rows of { what, count?, weight? }: a spawn on this place’s map that names no one ' +
      '(a generic one) is filled with a row chosen by weight each time an event fills the map ' +
      '(a rest broken somewhere dangerous), so the same map brings different figures. ' +
      '[] removes the table.'
  );

// A table of events on the way across country (L-364; loom-modules/wilds/
// events.js): the encounters format, extended with words, a kind and the
// ground a row fits, set on a region, a region map or the world.
const wildEncounters = z
  .array(
    z.strictObject({
      what: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,39}$/)
        .optional()
        .describe('A stat block of the world (list_stat_blocks): figures to meet. "wolf".'),
      count: z.number().int().min(1).max(20).optional().describe('How many (1 by default).'),
      weight: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .describe('How likely this row is against the others that fit (1 by default).'),
      text: z
        .string()
        .max(400)
        .optional()
        .describe('What happens, in a sentence or two, as the game master is to tell it.'),
      kind: z
        .enum(['travellers', 'creatures', 'hazard', 'weather', 'find'])
        .optional()
        .describe('What sort of event: needed with text and no what; a creature’s with a what.'),
      terrain: z
        .array(z.string().max(40))
        .min(1)
        .max(12)
        .optional()
        .describe('The ground materials it fits ("forest", "swamp"); any ground if left out.'),
      path: z
        .array(z.string().regex(/^[a-z][a-z0-9_-]{0,29}$/, 'wild, or a route kind like road'))
        .min(1)
        .max(6)
        .optional()
        .describe(
          'The paths it fits: "wild" (off the road) or route kinds ("road", "trail", "sea"); ' +
            'any path if left out.'
        ),
      narrated: z
        .boolean()
        .optional()
        .describe('True: only told, with no map, even with a what. Words alone are narrated.'),
    })
  )
  .max(20)
  .describe(
    'Rows of { what?, text?, kind?, terrain?, path?, count?, weight?, narrated? }: each needs a ' +
      'what or a text. After each day’s travel a roll decides whether something happens at ' +
      'the camp (far less likely on a route than off the road); the event is picked by weight from the first of its region’s, ' +
      'its map’s and the world’s tables with a row that fits the ground, else a built-in one. ' +
      '[] removes the table.'
  );

// A route's line and rules (L-715; planning/worlds-without-azgaar.md §4.5).
const routeWaypoints = z
  .array(z.tuple([z.number(), z.number()]))
  .max(MAX_WAYPOINTS)
  .describe(
    'Points [x, y] the route bends through, in order from the first place to the second, in ' +
      'the map’s units and inside the map. The route is drawn along them and its length is ' +
      'the line’s length × the scale (no winding factor). [] takes them away; leave it out to ' +
      'keep them.'
  );
const routeRules = z
  .strictObject({
    requiresAbility: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ABILITY)
      .nullable()
      .optional()
      .describe('An ability needed to take this route, e.g. "swimmer" for a ford.'),
    hostileToFactionId: entityId('faction', 'get_world')
      .nullable()
      .optional()
      .describe('A realm this route is hostile to.'),
  })
  .describe(
    'Rules on the route, read as a place’s are: a move or journey along it is refused when the ' +
      'traveller lacks the ability. A rule set to null is removed; others are left unchanged.'
  );

module.exports = {
  worldId,
  entityId,
  systemId,
  challenge,
  triggers,
  encounters,
  wildEncounters,
  routeWaypoints,
  routeRules,
};
