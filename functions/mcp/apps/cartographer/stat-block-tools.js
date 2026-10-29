'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const { worldId, entityId } = require('./schemas');
const { systemOf } = require('../../../loom-canon/checks');
const statBlocks = require('../../../loom-canon/stat-blocks');
const {
  validateSheet,
  validateStatBlock,
  sheetFromStatBlock,
  apFor,
} = require('../../../loom-canon/sheets');

// Named stat blocks in the Cartographer connector (planning/builders-tools.md
// §4.3; L-393 / #739): set_stat_block and list_stat_blocks, and set_sheets,
// many characters' sheets at once. A character or a group of figures names
// a block (statBlock: id) with overrides for what differs; the world works
// out their sheet when it loads (loom-canon/stat-blocks.js), so a change to
// the block reaches them all.

const MAX_SHEETS = 50;
const MAX_BLOCKS = 20;
const blockId = z
  .string()
  .regex(statBlocks.ID, 'lowercase letters, digits and dashes')
  .describe('Its id: "gate-guard".');
const blockName = z.string().trim().min(1).max(60).describe('Its name: "Gate guard".');

const statBlockShape = z
  .object({})
  .passthrough()
  .describe(
    'A stat block: { attributes (every one), skills?, resources?, level?, traits?, attacks? }.'
  );
const overrides = z
  .object({})
  .passthrough()
  .describe(
    'What differs from the named stat block: a partial one ({ attributes?, skills?, ' +
      'resources?, level?, traits?, attacks? }); attributes, skills and resources merge by id, ' +
      'the rest replace.'
  );
const blockRef = z
  .union([z.string().regex(statBlocks.ID, 'a stat block id'), statBlockShape])
  .describe(
    'A named stat block’s id (list_stat_blocks), so changes to it reach them; or a stat ' +
      'block of their own.'
  );

const noun = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * A character's sheet from what's given (L-393): a whole sheet, a stat block
 * of their own, or a named one with overrides. Returns `{ fields, sheet }`:
 * the fields to write (FieldValue.delete() clearing the others, unless
 * `creating`), and the sheet they stand for. A ToolError when it doesn't fit.
 */
function sheetFields(world, who, { sheet, statBlock, overrides: over }, { creating = false } = {}) {
  const system = systemOf(world);
  const clear = creating ? undefined : FieldValue.delete();
  const fields = {};
  let given;
  if (typeof statBlock === 'string') {
    if (!(world.statBlocks || {})[statBlock]) {
      throw new ToolError(`No stat block "${statBlock}". list_stat_blocks shows them.`);
    }
    const problems = statBlocks.validateOverrides(over);
    if (problems.length) throw new ToolError(problems.join(' '));
    given = sheetFromStatBlock(system, statBlocks.blockOf(world, { statBlock, overrides: over }));
    fields.statBlock = statBlock;
    fields.overrides = over && Object.keys(over).length ? over : clear;
    fields.sheet = clear;
  } else {
    if (over !== undefined) throw new ToolError('overrides go with a named stat block’s id.');
    given = statBlock !== undefined ? sheetFromStatBlock(system, statBlock) : { ...sheet };
    delete given.speed; // worked out by the system (L-811; its pool, L-832)
    delete given.ap;
    fields.sheet = given;
    fields.statBlock = clear;
    fields.overrides = clear;
  }
  const problems = validateSheet(system, given);
  if (problems.length) {
    throw new ToolError(
      `${who}’s sheet doesn’t fit the world’s rules (${system.name}):\n- ` + problems.join('\n- ')
    );
  }
  for (const k of Object.keys(fields)) if (fields[k] === undefined) delete fields[k];
  return { fields, sheet: { ...given, ap: apFor(system, given) } };
}

// A named stat block as list_stat_blocks shows it: who names it, and what of
// it no longer fits the system.
function row(world, entry) {
  const users = statBlocks.usersOf(world, entry.id);
  const misfits = validateStatBlock(systemOf(world), entry.statBlock);
  return {
    id: entry.id,
    name: entry.name,
    statBlock: entry.statBlock,
    usedBy: users,
    ...(misfits.length ? { misfits } : {}),
  };
}

function statBlockTools({ writer, worldFor }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const editNote =
    'Works on drafts and published worlds; a change to a published world reaches games on ' +
    'their next turn.';
  return [
    {
      name: 'list_stat_blocks',
      title: 'List stat blocks',
      description:
        'A world’s named stat blocks (L-393): each one’s id, name and stat block, who names ' +
        'it (characters, and groups of figures by map), and what of it no longer fits the ' +
        'world’s system, if anything.',
      inputSchema: { worldId },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      handler: async (ctx, args) => {
        const { world } = await worldFor(args.worldId);
        const rows = Object.values(world.statBlocks || {})
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => row(world, e));
        return { worldId: world.id, statBlocks: rows, count: rows.length };
      },
    },
    {
      name: 'set_stat_block',
      title: 'Set stat blocks',
      description:
        'Create or replace a world’s named stat blocks (L-393): "gate guard", "innkeeper"; ' +
        'one (id, name, statBlock) or up to ' +
        MAX_BLOCKS +
        ' at once (blocks). A stat block is the short form of a sheet (set_sheet), checked ' +
        'against the world’s system. Characters (add_character, update_character, ' +
        'set_sheets) and figures (place_figures) name it by id, with overrides for what ' +
        'differs; a change here reaches them all, and their overrides stay. statBlock null ' +
        'deletes one, once nobody names it. All are checked first; if any is refused, ' +
        'nothing is written and each problem is named. ' +
        editNote,
      inputSchema: {
        worldId,
        id: blockId.optional(),
        name: blockName.optional(),
        statBlock: statBlockShape.nullable().optional(),
        blocks: z
          .array(
            z.strictObject({
              id: blockId,
              name: blockName.optional(),
              statBlock: statBlockShape.nullable(),
            })
          )
          .min(1)
          .max(MAX_BLOCKS)
          .optional()
          .describe('Many at once, instead of id, name and statBlock.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) => {
        const single = args.id !== undefined || args.statBlock !== undefined;
        if (single && args.blocks)
          throw new ToolError('Give id and statBlock, or blocks, not both.');
        if (!single && !args.blocks) throw new ToolError('Give id and statBlock, or blocks.');
        if (single && (args.id === undefined || args.statBlock === undefined)) {
          throw new ToolError('A stat block needs its id and statBlock (null to delete it).');
        }
        const list = single
          ? [{ id: args.id, name: args.name, statBlock: args.statBlock }]
          : args.blocks;
        return edit(ctx, args, (e) => {
          const { world } = e;
          const system = systemOf(world);
          const problems = [];
          const writes = [];
          const ids = new Set();
          list.forEach((item, i) => {
            const at = single ? '' : `blocks[${i}] (${item.id}): `;
            if (ids.has(item.id)) return problems.push(`${at}given twice.`);
            ids.add(item.id);
            const before = (world.statBlocks || {})[item.id];
            if (item.statBlock === null) {
              if (!before) return problems.push(`${at}there is no stat block "${item.id}".`);
              const users = statBlocks.usersOf(world, item.id);
              const names = users.characters
                .map((c) => c.name)
                .concat(users.groups.map((g) => `${g.name} (${g.mapId})`));
              if (names.length) {
                return problems.push(
                  `${at}${before.name} is named by ${names.join(', ')}. Give them another first.`
                );
              }
              return writes.push({ id: item.id, name: before.name, deleted: true });
            }
            const entry = {
              id: item.id,
              name: item.name || (before && before.name),
              statBlock: item.statBlock,
            };
            if (!entry.name) return problems.push(`${at}a new stat block needs its name.`);
            const wrong = statBlocks.validateEntry(system, entry);
            if (wrong.length) {
              return problems.push(
                `${at}it doesn’t fit the world’s rules (${system.name}): ${wrong.join(' ')}`
              );
            }
            writes.push({ id: item.id, name: entry.name, entry, created: !before });
          });
          if (problems.length) throw new ToolError(problems.join('\n'));
          for (const w of writes) {
            const ref = e.ref('statBlocks', w.id);
            if (w.deleted) e.remove(ref);
            else e.set(ref, w.entry);
          }
          const rows = writes.map((w) => {
            if (w.deleted) return { id: w.id, name: w.name, deleted: true };
            const users = statBlocks.usersOf(world, w.id);
            const reach = users.characters.length + users.groups.length;
            return {
              id: w.id,
              name: w.name,
              created: w.created,
              ...(reach
                ? {
                    reaches:
                      noun(users.characters.length, 'character', 'characters') +
                      ' and ' +
                      noun(users.groups.length, 'group of figures', 'groups of figures'),
                  }
                : {}),
            };
          });
          return single ? { statBlock: rows[0] } : { statBlocks: rows, count: rows.length };
        });
      },
    },
    {
      name: 'set_sheets',
      title: 'Set many character sheets',
      description:
        `Give up to ${MAX_SHEETS} named characters their sheets in one call (L-393): each a ` +
        'whole sheet, a stat block of their own, or a named stat block’s id with overrides ' +
        '(set_sheet takes one). All are checked first; if any doesn’t fit, nothing is ' +
        'written and each problem is named. ' +
        editNote,
      inputSchema: {
        worldId,
        sheets: z
          .array(
            z.strictObject({
              characterId: entityId('character', 'get_world'),
              sheet: z.object({}).passthrough().optional().describe('A whole sheet.'),
              statBlock: blockRef.optional(),
              overrides: overrides.optional(),
            })
          )
          .min(1)
          .max(MAX_SHEETS),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const problems = [];
          const writes = [];
          const seen = new Set();
          args.sheets.forEach((item, i) => {
            const at = `sheets[${i}]`;
            const c = (world.characters || {})[item.characterId];
            if (!c) return problems.push(`${at}: no character "${item.characterId}".`);
            if (seen.has(c.id)) return problems.push(`${at}: ${c.name} is given twice.`);
            seen.add(c.id);
            if ((item.sheet === undefined) === (item.statBlock === undefined)) {
              return problems.push(`${at}: give sheet or statBlock.`);
            }
            try {
              writes.push({ c, ...sheetFields(world, c.name, item) });
            } catch (err) {
              if (!(err instanceof ToolError)) throw err;
              problems.push(`${at}: ${err.message}`);
            }
          });
          if (problems.length) throw new ToolError(problems.join('\n'));
          for (const w of writes) e.update(e.ref('characters', w.c.id), w.fields);
          return {
            set: writes.map((w) => ({
              id: w.c.id,
              name: w.c.name,
              ...(typeof w.fields.statBlock === 'string' ? { statBlock: w.fields.statBlock } : {}),
            })),
            count: writes.length,
          };
        }),
    },
  ];
}

module.exports = { statBlockTools, sheetFields, blockRef, overrides };
