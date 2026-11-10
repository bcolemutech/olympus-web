'use strict';

/**
 * Token pictures (planning/tokens.md §4.1, TK1; L-931 / #789): the picture a
 * person shows on a battle map, in a circular frame.
 *
 * A token is a library image (kind `token` or `portrait`) held as art is
 * (./art.js), with where the circle sits on it:
 *
 *   { imageId, link, width, height, format, crop? }
 *   crop: { x, y, zoom }   the circle's centre on the image (0–1 each way)
 *                          and how far in (1 fits the circle to the
 *                          image's shorter side; 2 is twice as close).
 *                          Left out: centred and fitted.
 *
 * It is kept on a character (`character.token`), a named stat block
 * (`statBlock.token`) and a group of placed figures (`token` beside its
 * `statBlock`). Which one a person shows (`tokenOf`): their own (a figure
 * group's, or a character's), else their stat block's, else none, drawn as
 * their initials. Every figure of a group shares the group's, so six bandits
 * from one stat block share its picture. A template instance's figures are
 * copies of the template's, and a spawned group (L-927) names its stat block,
 * so both come out the same way.
 *
 * The page is sent the link and the crop only (`forPlayer`), never the
 * library record (A5). Pure.
 */

const MAX_ZOOM = 10;
const KINDS = Object.freeze(['token', 'portrait']);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isFraction = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** What's wrong with a crop, each named (none for a good one, or none given). */
function validateCrop(crop, where = 'crop') {
  if (crop === undefined || crop === null) return [];
  if (!isObject(crop)) return [`${where} must be { x, y, zoom }.`];
  const errors = [];
  for (const key of Object.keys(crop)) {
    if (!['x', 'y', 'zoom'].includes(key)) errors.push(`${where}.${key} isn't part of a crop.`);
  }
  for (const key of ['x', 'y']) {
    if (crop[key] !== undefined && !isFraction(crop[key])) {
      errors.push(
        `${where}.${key} is where the circle's centre sits, from 0 to 1 (0.5 the middle).`
      );
    }
  }
  if (
    crop.zoom !== undefined &&
    !(typeof crop.zoom === 'number' && crop.zoom >= 1 && crop.zoom <= MAX_ZOOM)
  ) {
    errors.push(`${where}.zoom is how far in, from 1 (the circle fits the image) to ${MAX_ZOOM}.`);
  }
  return errors;
}

/** A crop with its defaults filled in: centred and fitted. */
function cropOf(token) {
  const crop = isObject(token && token.crop) ? token.crop : {};
  return {
    x: isFraction(crop.x) ? crop.x : 0.5,
    y: isFraction(crop.y) ? crop.y : 0.5,
    zoom: typeof crop.zoom === 'number' && crop.zoom >= 1 ? Math.min(crop.zoom, MAX_ZOOM) : 1,
  };
}

/** Whether something stored is a token picture: a library image with its link. */
function isToken(token) {
  return isObject(token) && typeof token.imageId === 'string' && typeof token.link === 'string';
}

/** A named stat block's token, for whoever names it by id. */
function statBlockToken(world, holder) {
  const named = holder && holder.statBlock;
  if (typeof named !== 'string') return null;
  const entry = ((world && world.statBlocks) || {})[named];
  return entry && isToken(entry.token) ? entry.token : null;
}

/**
 * The token a person shows (TK1): their own (a figure group's or a
 * character's), else their stat block's, else null.
 */
function tokenOf(person, world) {
  if (!person) return null;
  if (isToken(person.token)) return person.token;
  return statBlockToken(world, person);
}

/** What the page is sent for a token: its link and its crop, or null. */
function forPlayer(token) {
  return isToken(token) ? { link: token.link, crop: cropOf(token) } : null;
}

module.exports = {
  KINDS,
  MAX_ZOOM,
  validateCrop,
  cropOf,
  isToken,
  statBlockToken,
  tokenOf,
  forPlayer,
};
