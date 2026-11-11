'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const tokens = require('../loom-canon/tokens');
const clock = require('../loom-canon/clock');

/**
 * The player's token chosen in play (planning/tokens.md §4.3, TK2; L-933 /
 * #791): `{ verb: 'token', token }` from the Character panel, one of the
 * world's player portraits with its crop, the crop moved on the token they
 * have, or none (../loom-canon/tokens.js `pickToken`). It costs no AP and no
 * time, records no turn, and leaves anything waiting (a question asked, an
 * action to confirm) as it was. Giving up an upload deletes its file.
 *
 * Returns `{ narration, suggestedActions, time, token }` (`token` as the page
 * draws it, or null), or `{ refused: true, narration }`.
 */
async function tokenTurn({ saveRef, canonWorld }, given) {
  const result = await saveRef.firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(saveRef);
    const save = snap.data();
    const previous = (save.character && save.character.token) || null;
    const picked = tokens.pickToken(canonWorld, given, previous);
    if (picked.error) return { refused: picked.error, save };
    transaction.update(saveRef, {
      'character.token': picked.token || FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // An upload given up for another token, or none, goes (not one re-cropped).
    const dropped =
      tokens.isUpload(previous) && !(picked.token && picked.token.file === previous.file)
        ? previous.file
        : null;
    return { token: picked.token, save, dropped };
  });
  if (result.dropped) await deleteFile(result.dropped);
  const time = clock.timeView(clock.timeOf(result.save));
  if (result.refused) {
    return { narration: result.refused, suggestedActions: [], time, refused: true };
  }
  return {
    narration: result.token ? 'Your token is set.' : 'Your token is taken away.',
    suggestedActions: [],
    time,
    token: tokens.forPlayer(result.token),
  };
}

// A player's uploaded token's file, deleted (gone already is fine).
async function deleteFile(path) {
  try {
    const { getStorage } = require('firebase-admin/storage');
    await getStorage().bucket().file(path).delete();
  } catch (err) {
    if (!err || err.code !== 404) console.error('Could not delete a token file:', err);
  }
}

module.exports = { tokenTurn, deleteFile };
