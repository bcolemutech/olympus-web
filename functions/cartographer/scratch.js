'use strict';

/**
 * A world from scratch (L-391; L-711): one place that makes a draft world with
 * no Azgaar map, for the Cartographer connector's create_world and the
 * Cartographer page's New world.
 *
 * createScratchWorld({ writer, systems, studio }, uid, args) →
 *   { worldId, name, status, system?, map, brief?, next, warnings? }
 *
 *   args: { name, systemId?, backdrop?: { colour } | { imageId }, width?, height?,
 *           milesPerUnit?, brief? }
 *
 * It throws ToolError (functions/mcp/registry.js) for what it refuses. The
 * brief is checked here too (../loom-canon/brief.js), so a caller that skipped
 * its own check can't store a bad one.
 */

const { ToolError } = require('../mcp/registry');
const brief = require('../loom-canon/brief');

// The backdrop's default size, in map units (as an Azgaar world's), and its
// limits.
const DEFAULT_MAP = Object.freeze({ width: 1600, height: 1200 });
const MIN_MAP = 100;
const MAX_MAP = 10000;
const DEFAULT_BACKDROP = '#26332a';
const MAX_MILES_PER_UNIT = 1000;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

async function createScratchWorld({ writer, systems, studio }, uid, args) {
  const system = args.systemId ? systems && (await systems.get(args.systemId)) : null;
  if (args.systemId && !system) {
    throw new ToolError(`No system "${args.systemId}". list_systems shows them.`);
  }
  const backdrop = args.backdrop || { colour: DEFAULT_BACKDROP };
  if (backdrop.imageId && !studio) {
    throw new ToolError('The image studio isn’t available here; give a colour instead.');
  }
  if (backdrop.colour !== undefined && !COLOUR.test(backdrop.colour)) {
    throw new ToolError('The backdrop colour must be #rrggbb.');
  }
  for (const [what, value] of [
    ['width', args.width],
    ['height', args.height],
  ]) {
    if (value !== undefined && !(Number.isInteger(value) && value >= MIN_MAP && value <= MAX_MAP)) {
      throw new ToolError(`The map's ${what} is a whole number from ${MIN_MAP} to ${MAX_MAP}.`);
    }
  }
  const miles = args.milesPerUnit;
  if (
    miles !== undefined &&
    !(typeof miles === 'number' && miles > 0 && miles <= MAX_MILES_PER_UNIT)
  ) {
    throw new ToolError(`milesPerUnit is more than 0 and at most ${MAX_MILES_PER_UNIT}.`);
  }
  let worldBrief = null;
  if (args.brief !== undefined) {
    const checked = brief.checkBrief(args.brief);
    if (checked.errors.length) throw new ToolError(checked.errors.join(' '));
    worldBrief = brief.briefFrom(checked.fields);
  }

  const map = {
    width: args.width || DEFAULT_MAP.width,
    height: args.height || DEFAULT_MAP.height,
    imagePath: null,
    backdrop: backdrop.colour || DEFAULT_BACKDROP,
    ...(args.milesPerUnit ? { distance: { unit: 'mi', perMapUnit: args.milesPerUnit } } : {}),
  };
  const { worldId: id } = await writer.create(uid, {
    name: args.name,
    systemId: system ? system.id : null,
    map,
    ...(worldBrief ? { brief: worldBrief } : {}),
  });
  const made = {
    worldId: id,
    name: args.name,
    ...(worldBrief ? { brief: worldBrief } : {}),
  };
  // A studio image as its art, the way studio_assign sets a world's map.
  let image = null;
  if (backdrop.imageId) {
    try {
      const assigned = await studio.assign(uid, {
        worldId: id,
        target: 'map',
        imageId: backdrop.imageId,
      });
      image = {
        imageId: backdrop.imageId,
        ...(assigned.warnings ? { warnings: assigned.warnings } : {}),
      };
    } catch (err) {
      // The world stands; the art can be set again with studio_assign.
      return {
        ...made,
        warnings: [
          `The world was made, but its image wasn't set: ${err.message} Try studio_assign.`,
        ],
      };
    }
  }
  return {
    ...made,
    status: 'draft',
    ...(system ? { system: { id: system.id, name: system.name } } : {}),
    map: { width: map.width, height: map.height, backdrop: image || map.backdrop },
    next: 'Add places with add_locations, then link them with connect_locations.',
  };
}

module.exports = { createScratchWorld, DEFAULT_MAP, MIN_MAP, MAX_MAP };
