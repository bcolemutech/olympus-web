'use strict';

const crypto = require('crypto');

/**
 * Named styles (planning/the-image-studio.md §3 M4, §4.2; L-709 / #545): saved
 * prompt text plus reference images, named in a generation or an edit so a
 * world's art keeps one look. A world can name a default style
 * (`world.studio.styleId`), used when a request is about that world.
 *
 *   studio_styles/{styleId}
 *     id, name, prompt, references[] (library image ids), createdBy,
 *     createdAt, updatedBy, updatedAt
 *
 * A style holds at most MAX_STYLE_REFERENCES images, so a request still has
 * room for its own.
 */

const MAX_NAME = 60;
const MAX_STYLE_PROMPT = 2000;
const MAX_STYLE_REFERENCES = 3;
const STYLE_ID = /^sty_[0-9a-f]{16}$/;

class StyleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const invalid = (message) => new StyleError('invalid-argument', message);

function createStyles({ db, library, now = () => Date.now() }) {
  const styles = () => db.collection('studio_styles');

  /** Every style, by name. */
  async function list() {
    const snap = await styles().get();
    return snap.docs
      .map((doc) => doc.data())
      .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  }

  async function get(styleId) {
    const snap =
      typeof styleId === 'string' && STYLE_ID.test(styleId)
        ? await styles().doc(styleId).get()
        : null;
    if (!snap || !snap.exists) {
      throw new StyleError('not-found', `No style "${styleId}"; see studio_styles.`);
    }
    return snap.data();
  }

  /**
   * Makes a style (no styleId) or changes one: its name, prompt or
   * references, each replaced when given.
   */
  async function set(uid, { styleId, name, prompt, references } = {}) {
    const existing = styleId ? await get(styleId) : null;
    const fields = {};
    if (name !== undefined || !existing) {
      const clean = typeof name === 'string' ? name.trim() : '';
      if (!clean) throw invalid('Name the style (name).');
      if (clean.length > MAX_NAME)
        throw invalid(`A style's name is at most ${MAX_NAME} characters.`);
      fields.name = clean;
    }
    if (prompt !== undefined || !existing) {
      const clean = typeof prompt === 'string' ? prompt.trim() : '';
      if (!clean) throw invalid('Say what the style looks like (prompt).');
      if (clean.length > MAX_STYLE_PROMPT) {
        throw invalid(`A style's prompt is at most ${MAX_STYLE_PROMPT} characters.`);
      }
      fields.prompt = clean;
    }
    if (references !== undefined || !existing) {
      const list = references || [];
      if (!Array.isArray(list) || list.length > MAX_STYLE_REFERENCES) {
        throw invalid(`A style has at most ${MAX_STYLE_REFERENCES} reference images.`);
      }
      for (const id of list) await library.getImage(id); // each must exist
      fields.references = [...new Set(list)];
    }
    if (fields.name) {
      const taken = (await list()).find(
        (s) => s.id !== styleId && s.name.toLowerCase() === fields.name.toLowerCase()
      );
      if (taken) {
        throw new StyleError('already-exists', `There is a style named "${taken.name}" already.`);
      }
    }
    const at = now();
    if (existing) {
      const update = { ...fields, updatedBy: uid, updatedAt: at };
      await styles().doc(existing.id).update(update);
      return { ...existing, ...update };
    }
    const style = {
      id: `sty_${crypto.randomBytes(8).toString('hex')}`,
      ...fields,
      createdBy: uid,
      createdAt: at,
      updatedBy: uid,
      updatedAt: at,
    };
    await styles().doc(style.id).set(style);
    return style;
  }

  return { list, get, set };
}

/**
 * The style a request uses: the one it names, none when it asks for none
 * ('none' or null), else its world's default when it is about a world.
 * Returns the style id, or null.
 */
function chooseStyle(requested, world) {
  if (requested === null || requested === 'none') return null;
  if (requested !== undefined) return requested;
  return (world && world.studio && world.studio.styleId) || null;
}

/** A style as a request carries it: what is sent, kept as it was then. */
const snapshot = (style) =>
  style
    ? { id: style.id, name: style.name, prompt: style.prompt, references: style.references }
    : null;

module.exports = {
  createStyles,
  chooseStyle,
  snapshot,
  StyleError,
  STYLE_ID,
  MAX_NAME,
  MAX_STYLE_PROMPT,
  MAX_STYLE_REFERENCES,
};
