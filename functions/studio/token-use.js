'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const tokens = require('../loom-canon/tokens');
const { refOf } = require('./assign-targets');

/**
 * Token pictures as the world keeps them (planning/tokens.md §4.1; L-931 /
 * #789): a library image's reference with its crop, on a character, a named
 * stat block or a group of figures. Shared by the studio's assigner and the
 * Cartographer's tools that take `token` (add_character, update_character,
 * set_stat_block, set_sheets, place_figures), so both keep the image's
 * `usedIn` ("in use") right.
 */

/** Why a library image can't be a token, or null. */
function kindProblem(record) {
  if (tokens.KINDS.includes(record.kind)) return null;
  return (
    `"${record.title}" is a ${record.kind} image; a token takes a token or portrait image ` +
    '(studio_update can change its kind).'
  );
}

/** The token kept for a library image and a crop (none: centred and fitted). */
function tokenRefOf(record, crop) {
  return { ...refOf(record), ...(crop ? { crop: { ...crop } } : {}) };
}

/**
 * The crop a token keeps: the one given; none when null is given; when none
 * is given, the one it had, if it's the same image.
 */
function keptCrop(previous, imageId, crop) {
  if (crop !== undefined) return crop || null;
  return previous && previous.imageId === imageId && previous.crop ? previous.crop : null;
}

/**
 * Queues the writes to images' `usedIn` for a use whose token goes from
 * `before` to `after` (either may be null): `update(ref, fields)` and
 * `imageRef(imageId)` as the writer's edit gives them.
 */
function queueUse({ update, imageRef }, use, before, after) {
  const was = before && before.imageId;
  const now = after && after.imageId;
  if (was === now) return;
  if (was) update(imageRef(was), { usedIn: FieldValue.arrayRemove(use) });
  if (now) update(imageRef(now), { usedIn: FieldValue.arrayUnion(use) });
}

/**
 * A token as a tool gives it, `{ image, crop? }` or null, read inside the
 * writer's edit (`e.readImage`): the token to keep, or null to clear it. A
 * problem (a bad crop, no such image, the wrong kind) is thrown as `fail`
 * makes it, `where` naming what it's for.
 */
async function tokenFromTool(e, given, previous, { where = 'token', fail }) {
  if (given === null) return null;
  const problems = tokens.validateCrop(given.crop, `${where}.crop`);
  if (problems.length) throw fail(problems.join(' '));
  const record = await e.readImage(given.image);
  if (!record) {
    throw fail(`${where}: no image "${given.image}" in the library (studio_find lists them).`);
  }
  const wrong = kindProblem(record);
  if (wrong) throw fail(`${where}: ${wrong}`);
  return tokenRefOf(record, keptCrop(previous, record.id, given.crop));
}

module.exports = { kindProblem, tokenRefOf, keptCrop, queueUse, tokenFromTool };
