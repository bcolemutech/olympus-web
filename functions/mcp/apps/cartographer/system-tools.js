'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const {
  OPTIONAL_PARTS,
  DEGREES,
  CREATION_METHODS,
  DEFAULT_SYSTEM_ID,
  SystemError,
} = require('../../../loom-canon/systems');

// Game systems in the Cartographer connector (planning/game-systems.md §4.1;
// L-801 / #627): a world plays by one system, a document written here like
// canon. list_systems and get_system read them; set_system creates or
// replaces one, checked first (errors refuse it, warnings come back);
// copy_system makes a new, named system from another, the way to change a
// built-in one (SY5). update_world's systemId points a world at one.
//
// `systems` is the store: functions/loom-canon/systems.js over Firestore.

const { systemId } = require('./schemas');
const checks = require('../../../loom-canon/checks');
const formula = require('../../../loom-canon/formula');

// The formula language (L-802), as Claude needs it to write a system.
const FORMULAS =
  'Formulas: numbers; dice NdX, with khN or klN to keep the highest or lowest N (2d20kh1); ' +
  'a bracket before d is the count ((DEX + Athletics)d10); + - * / and brackets; min, max, ' +
  'floor, ceil; sheet field ids and level; mod(STR), an attribute through its modifier ' +
  'formula; table(name, value); count(dice, >= 7), the dice that meet it; and one ' +
  'comparison (<=, >=, <, >, =) for rolling under (d100 <= Stealth). A modifier reads its ' +
  'own attribute and can’t use mod(). The check formula also reads attribute, modifier and ' +
  'rank (what it is rolled with); each degree is a comparison that also reads result and ' +
  'difficulty (result >= difficulty + 10). Every formula is checked on save.';

const SHAPE =
  'A system is an object: id (lowercase letters, digits and dashes), name, credits ' +
  '([{ source, licence, url? }]: openly licensed text only, credited), words ({ health: ' +
  '"Hull" }: names the Loom shows), sheet, checks, creation, advancement ({} for now), ' +
  'modules ({}: none are built yet) and gmNotes (tone and pacing for the narrator). ' +
  'sheet: attributes [{ id, name, min, max, modifier }] and resources [{ id, name, max }] ' +
  '(at least one of each), level { min, max }, and optional: the optional parts it switches ' +
  `on (${OPTIONAL_PARTS.join(', ')}), each then listed: skills [{ id, name, attribute }], ` +
  'traits [{ id, name }], conditions [{ id, name }], derived [{ id, name, formula }]. Sheet ' +
  'ids are the names formulas use, unique across the sheet. checks: formula, degrees ' +
  `({ ${DEGREES.join(', ')} }: formulas, optional) and ladder [{ name, value }], ` +
  'easiest first, in strict order. creation: { method: ' +
  `${CREATION_METHODS.join(' | ')}, ...its settings }. tables: { name: [{ min?, max?, ` +
  'value }] }, rows tried in order. ' +
  FORMULAS;

const row = (s) => ({
  id: s.id,
  name: s.name,
  version: s.version || 0,
  ...(s.builtIn ? { builtIn: true } : {}),
  attributes: ((s.sheet && s.sheet.attributes) || []).map((a) => a.id),
  optional: (s.sheet && s.sheet.optional) || [],
  modules: Object.keys(s.modules || {}),
});

const view = (s) => {
  const { createdAtMs, updatedAtMs, ...rest } = s;
  const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : undefined);
  return {
    ...rest,
    version: s.version || 0,
    ...(iso(createdAtMs) ? { createdAt: iso(createdAtMs) } : {}),
    ...(iso(updatedAtMs) ? { updatedAt: iso(updatedAtMs) } : {}),
  };
};

// The store's refusals, as tool errors Claude can act on.
async function refusing(work) {
  try {
    return await work();
  } catch (err) {
    if (err instanceof SystemError) {
      throw new ToolError(
        err.errors.length > 1
          ? 'The system has problems:\n- ' + err.errors.join('\n- ')
          : err.message
      );
    }
    throw err;
  }
}

// A sample character for test_roll: scores and ranks by id, and a level.
const SAMPLE = z
  .object({
    attributes: z.record(z.number()).optional().describe('Attribute scores by id.'),
    skills: z.record(z.number()).optional().describe('Skill ranks by id (0: untrained).'),
    level: z.number().int().optional().describe('Its level.'),
  })
  .describe(
    'A sample character’s sheet. Anything left out takes the system’s defaults: each ' +
      'attribute at the middle of its range, untrained, the lowest level.'
  );

function systemTools({ systems }) {
  const readOnly = { readOnlyHint: true, openWorldHint: false };
  return [
    {
      name: 'test_roll',
      title: 'Test a roll',
      description:
        'Roll a check in a game system for a sample character (FX3), to see a system’s check ' +
        'formula, ladder and degrees at work: the total, its breakdown (every die, kept and ' +
        'dropped, and each term), the rung and its number, and the degree it comes to ' +
        '(criticalSuccess, success, successAtCost, failure, criticalFailure). Give a seed ' +
        'to roll the same dice again. Nothing is saved.',
      inputSchema: {
        systemId,
        skill: z.string().max(32).optional().describe('The skill rolled, from get_system.'),
        attribute: z
          .string()
          .max(32)
          .optional()
          .describe('The attribute rolled, when no skill is (a skill uses its own).'),
        rung: z.string().max(40).optional().describe('The difficulty rung, by name.'),
        sheet: SAMPLE.optional(),
        seed: z.number().int().min(0).optional().describe('A seed for the dice (any number).'),
      },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const system = await systems.get(args.systemId);
        if (!system) throw new ToolError(`No system "${args.systemId}". list_systems shows them.`);
        const check = { skill: args.skill, attribute: args.attribute, rung: args.rung };
        const why = checks.refusal(system, check);
        if (why) throw new ToolError(why);
        const seed = args.seed !== undefined ? args.seed : Math.floor(Math.random() * 2 ** 31);
        const roll = checks.rollCheck(system, {
          check,
          character: { sheet: args.sheet || {} },
          dice: formula.seeded(seed),
        });
        return {
          system: { id: system.id, version: system.version || 0 },
          seed,
          formula: roll.formula,
          rolledWith: { attribute: roll.attributeId, skill: roll.skillId },
          total: roll.total,
          rung: roll.rung,
          difficulty: roll.difficulty,
          degree: roll.degree,
          success: roll.success,
          breakdown: roll.breakdown,
        };
      },
    },
    {
      name: 'list_systems',
      title: 'List game systems',
      description:
        'Every game system a world can play by: its id, name, version, attributes, the ' +
        'optional sheet parts it switches on, and its modules. Two are built in: ' +
        `"${DEFAULT_SYSTEM_ID}", a d20 fantasy (worlds that name no system play by it), and ` +
        '"pool-scifi", a dice-pool sci-fi; built-in systems are changed by copying them ' +
        '(copy_system).',
      inputSchema: {},
      annotations: readOnly,
      handler: async () => ({ systems: (await systems.list()).map(row) }),
    },
    {
      name: 'get_system',
      title: 'Get game system',
      description:
        'One game system in full: its sheet, checks and difficulty ladder, creation method, ' +
        'modules, words, credits and notes for the narrator, at its current version (every ' +
        'game uses the latest).',
      inputSchema: { systemId },
      annotations: readOnly,
      handler: async (ctx, args) => {
        const system = await systems.get(args.systemId);
        if (!system) {
          throw new ToolError(`No system "${args.systemId}". list_systems shows them.`);
        }
        return { system: view(system) };
      },
    },
    {
      name: 'set_system',
      title: 'Set game system',
      description:
        'Create a game system, or replace one whole (its version goes up; every game using it ' +
        'plays by the new version from its next turn). It is checked first: problems refuse ' +
        'it, each named; warnings (unused attributes, parts given but not switched on) come ' +
        'back with it. Built-in systems can’t be set: copy one with copy_system. ' +
        SHAPE,
      inputSchema: {
        system: z.object({}).passthrough().describe('The whole system, as described above.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) =>
        refusing(async () => {
          const { system, warnings, created } = await systems.set(args.system, { uid: ctx.uid });
          return {
            created,
            system: row(system),
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
    {
      name: 'copy_system',
      title: 'Copy game system',
      description:
        'Make a new, named game system from another, built-in or not, to change it: the copy ' +
        'is independent of its source from then on. Then set_system the copy, and point a ' +
        'world at it with update_world (systemId).',
      inputSchema: {
        fromSystemId: systemId.describe('The system to copy, from list_systems.'),
        id: systemId.describe('The new system’s id: lowercase letters, digits and dashes.'),
        name: z.string().trim().min(1).max(80).describe('The new system’s name.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      handler: (ctx, args) =>
        refusing(async () => {
          const { system, warnings } = await systems.copy(
            args.fromSystemId,
            { id: args.id, name: args.name },
            { uid: ctx.uid }
          );
          return {
            system: { ...row(system), copiedFrom: system.copiedFrom },
            ...(warnings.length ? { warnings } : {}),
          };
        }),
    },
  ];
}

module.exports = { systemTools };
