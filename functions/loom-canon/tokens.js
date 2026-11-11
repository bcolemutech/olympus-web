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
 * library record (A5).
 *
 * The player's own (planning/tokens.md §4.3, TK2; L-933) is the save's
 * `character.token`: one of the portraits the world offers players
 * (`world.tokens.player`, library references as above), with its crop; or
 * their own upload, a file only they can read:
 *
 *   { file: 'loom_tokens/{uid}/{saveId}.webp', version, width, height,
 *     format: 'webp' }
 *
 * already squared at the crop they chose, so it keeps none. The page is sent
 * `{ file, version, crop }` for it and reads the file as its owner (rules,
 * not a link anyone could open). Pure.
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

/** Where a player's uploaded token is kept (L-933). */
function uploadPath(uid, saveId) {
  return `loom_tokens/${uid}/${saveId}.webp`;
}

/** Whether something stored is a player's own uploaded token (L-933). */
function isUpload(token) {
  return (
    isObject(token) &&
    typeof token.file === 'string' &&
    /^loom_tokens\/[^/]+\/[^/]+\.webp$/.test(token.file)
  );
}

/** The portraits a world offers players for their own token (L-933). */
function playerPortraits(world) {
  const list = ((world && world.tokens) || {}).player;
  return Array.isArray(list) ? list.filter(isToken) : [];
}

/**
 * What the page is sent for a token: its link and its crop; for a player's
 * upload its file, version and crop (L-933); or null.
 */
function forPlayer(token) {
  if (isToken(token)) return { link: token.link, crop: cropOf(token) };
  if (isUpload(token)) {
    return { file: token.file, version: token.version || 0, crop: cropOf(token) };
  }
  return null;
}

const PREVIEW_SHOWN = 24;

/**
 * Who has a token picture and who doesn't (L-934; tokens §4.4), for the
 * Cartographer page's previews: the world's live characters and named stat
 * blocks, each as the Loom would draw it (a character's own, else their stat
 * block's, TK1). Per group: how many there are, those with a picture (link
 * and crop, the page's `forPlayer` shape) and those without, each at most
 * `limit`, in name order. Pure.
 */
function previewsOf(world, limit = PREVIEW_SHOWN) {
  const group = (entries, tokenFor) => {
    const live = entries
      .filter((e) => e && !e.retired)
      .sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    const withPicture = [];
    const without = [];
    for (const e of live) {
      const picture = forPlayer(tokenFor(e));
      const who = { id: e.id, name: e.name || e.id, ...(e.side ? { side: e.side } : {}) };
      if (picture && picture.link) withPicture.push({ ...who, ...picture });
      else without.push(who);
    }
    return {
      total: live.length,
      with: withPicture.slice(0, limit),
      without: without.slice(0, limit),
      withoutCount: without.length,
    };
  };
  return {
    characters: group(Object.values((world && world.characters) || {}), (c) => tokenOf(c, world)),
    statBlocks: group(Object.values((world && world.statBlocks) || {}), (b) =>
      isToken(b.token) ? b.token : null
    ),
  };
}

/**
 * The player's token as they choose it (L-933): `given` is `{ image, crop? }`,
 * one of the world's player portraits by its image id, its crop the one
 * given else the world's; `{ crop }` alone, the circle moved on the token
 * they have (`previous`, a portrait or their upload); or null, none.
 * Returns `{ token }` (null for none) or `{ error }`.
 */
function pickToken(world, given, previous) {
  if (given === null) return { token: null };
  if (!isObject(given)) return { error: 'A token is { image, crop? }, { crop } or null.' };
  for (const key of Object.keys(given)) {
    if (!['image', 'crop'].includes(key)) return { error: `token.${key} isn't part of a token.` };
  }
  const problems = validateCrop(given.crop, 'token.crop');
  if (problems.length) return { error: problems.join(' ') };
  const crop = isObject(given.crop) ? { ...cropOf({ crop: given.crop }) } : null;
  if (given.image === undefined) {
    if (!crop) return { error: 'Give a portrait (image), a crop, or both.' };
    if (!isToken(previous) && !isUpload(previous)) {
      return { error: 'You have no token yet: pick a portrait or upload your own.' };
    }
    return { token: { ...previous, crop } };
  }
  if (typeof given.image !== 'string') return { error: 'token.image is a portrait’s id.' };
  const portrait = playerPortraits(world).find((t) => t.imageId === given.image);
  if (!portrait) return { error: "That portrait isn't one this world offers." };
  const token = { ...portrait };
  if (crop) token.crop = crop;
  return { token };
}

module.exports = {
  pickToken,
  previewsOf,
  PREVIEW_SHOWN,
  KINDS,
  MAX_ZOOM,
  validateCrop,
  cropOf,
  isToken,
  statBlockToken,
  tokenOf,
  forPlayer,
  uploadPath,
  isUpload,
  playerPortraits,
};
