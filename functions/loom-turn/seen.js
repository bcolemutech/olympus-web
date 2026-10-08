'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const maps = require('../loom-canon/maps');
const sight = require('../loom-canon/sight');
const { doorStatesOf } = require('./steps');

/**
 * What each save has seen on each battle map (planning/the-loom-movement-and-
 * vision.md §5; L-632 / #455). Kept beside the save rather than in it, one
 * document a map, so the save stays small however many maps it walks:
 *
 *   loom_saves/{saveId}/seen/{mapId}
 *     mapId, width, height   — the grid the squares were packed for
 *     revision               — the map's revision they were seen on (L-641);
 *                              left out for a map never redrawn
 *     squares                — one bit a square, in base64: square (x, y) is
 *                              bit y × width + x, the lowest bit of each byte
 *                              first; 684 characters for a 64 × 64 map
 *     updatedAt
 *
 * No rule lets a player read it; only the server does (what leaves the
 * server is L-633's business).
 *
 * It only ever grows. What's in sight (../loom-canon/sight.js) is added when a
 * save arrives on a map (a new game, a place, an exit onto another map), from
 * every square of a walk on it, and when a door opens or closes. Squares
 * walked through are looked from with the doors as they were; where the save
 * ends, with the doors as they are now. A map redrawn over MCP (its grid
 * replaced, which bumps its `revision`) is forgotten: a record from an older
 * revision counts as nothing seen, and is replaced on the next look.
 * Otherwise, a grid of another size keeps the squares still on it.
 *
 * A walk that leaves by an exit isn't recorded: the save is off that map.
 */

/** Packs squares (an object keyed "x,y") into a grid's bits, in base64. */
function pack(squares, width, height) {
  const bytes = Buffer.alloc(Math.ceil((width * height) / 8));
  Object.keys(squares).forEach((key) => {
    const [x, y] = key.split(',').map(Number);
    if (!(x >= 0 && y >= 0 && x < width && y < height)) return;
    const i = y * width + x;
    bytes[i >> 3] |= 1 << (i & 7);
  });
  return bytes.toString('base64');
}

/** The squares a grid's packed bits hold, keyed "x,y". */
function unpack(packed, width, height) {
  const bytes = Buffer.from(packed || '', 'base64');
  const squares = {};
  for (let i = 0; i < width * height; i++) {
    if (bytes[i >> 3] & (1 << (i & 7))) squares[(i % width) + ',' + Math.floor(i / width)] = true;
  }
  return squares;
}

/**
 * The squares a record holds for a map, keyed "x,y": none without a record,
 * or once the map has been redrawn since (its revision moved on; L-641).
 */
function squaresOf(record, map) {
  if (!record || (record.revision || 0) !== (map.revision || 0)) return {};
  return unpack(record.squares, record.width, record.height);
}

/**
 * What a save sees on the map it stands on: from where it stands, with its
 * doors as they are, and from each square walked through to get there, with
 * the doors as they were (`doorsBefore`). `{ map, squares }`, squares keyed
 * "x,y"; no map off one.
 */
function inSightNow(canonWorld, save, walked, doorsBefore) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map) return { map: null, squares: {} };
  const doors = doorStatesOf(save, map.id);
  const squares = sight.inSight(map, cell, doors);
  (walked || []).forEach((square) => {
    Object.assign(squares, sight.inSight(map, square, doorsBefore || doors));
  });
  return { map, squares };
}

/**
 * Who stands in sight of a save on its map (planning/the-loom-movement-and-
 * vision.md §6; L-643 / #462): `[{ character, cell, beside }]`, nearest
 * first, `beside` when on a square next to the save's. `squares` is what is
 * in sight, keyed "x,y" (by default, from where the save stands now). Those
 * out of sight are left out: nobody is remembered on a square.
 */
function peopleInSight(canonWorld, save, squares) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map) return [];
  const inSight = squares || inSightNow(canonWorld, save).squares;
  const far = (c) => Math.max(Math.abs(c.x - cell.x), Math.abs(c.y - cell.y));
  return maps
    .standingAt(canonWorld, maps.hostOf(canonWorld, save))
    .filter((c) => inSight[c.cell.x + ',' + c.cell.y])
    .map((c) => ({ character: c, cell: c.cell, beside: far(c.cell) === 1 }))
    .sort((a, b) => far(a.cell) - far(b.cell) || a.character.name.localeCompare(b.character.name));
}

/**
 * A map's record with `squares` added: `{ mapId, width, height, squares }`, or
 * null when the record already holds them all.
 */
function withSquares(record, map, squares) {
  const known = squaresOf(record, map);
  const changed =
    Boolean(record) &&
    (record.width !== map.width ||
      record.height !== map.height ||
      (record.revision || 0) !== (map.revision || 0));
  const added = Object.keys(squares).filter((key) => !known[key]);
  if (record && !changed && !added.length) return null;
  added.forEach((key) => {
    known[key] = true;
  });
  return {
    mapId: map.id,
    width: map.width,
    height: map.height,
    squares: pack(known, map.width, map.height),
    ...(map.revision ? { revision: map.revision } : {}),
  };
}

const seenRef = (saveRef, mapId) => saveRef.collection('seen').doc(mapId);

/**
 * A save's record for a map, read inside `transaction` (or directly, without
 * one): `{ ref, record }`, the record null if there is none yet.
 */
async function recordOf(transaction, saveRef, mapId) {
  const ref = seenRef(saveRef, mapId);
  const snap = await (transaction ? transaction.get(ref) : ref.get());
  return { ref, record: snap.exists ? snap.data() : null };
}

/**
 * What a save knows of the map it stands on (L-635 / #458): the squares in
 * its record and those in sight now, keyed "x,y". What its moves may head
 * for and walk over.
 */
function knownTo(canonWorld, save, record) {
  const { map, squares } = inSightNow(canonWorld, save);
  return map ? Object.assign(squaresOf(record, map), squares) : squares;
}

/**
 * A record read (`found`, as recordOf gives it) with what the save, as it now
 * stands, sees added: `{ ref, value }` to write, or null: off a map, or
 * nothing new.
 */
function added(found, canonWorld, save, walked, doorsBefore) {
  const { map, squares } = inSightNow(canonWorld, save, walked, doorsBefore);
  if (!map) return null;
  const value = withSquares(found.record, map, squares);
  return value
    ? { ref: found.ref, value: { ...value, updatedAt: FieldValue.serverTimestamp() } }
    : null;
}

/**
 * Inside a transaction, before any of its writes: the record for the map the
 * save (as it now stands) is on, with what it sees added (inSightNow).
 * Returns `{ ref, value }` to write once the transaction's reads are done, or
 * null: off a map, or nothing new.
 */
async function look(transaction, saveRef, canonWorld, save, walked, doorsBefore) {
  const { map } = maps.positionOf(canonWorld, save);
  if (!map) return null;
  const found = await recordOf(transaction, saveRef, map.id);
  return added(found, canonWorld, save, walked, doorsBefore);
}

/** A new save's first look, if it starts on a map: `{ ref, value }`, or null. */
function firstLook(saveRef, canonWorld, save) {
  const { map, squares } = inSightNow(canonWorld, save);
  if (!map) return null;
  const value = withSquares(null, map, squares);
  return {
    ref: seenRef(saveRef, map.id),
    value: { ...value, updatedAt: FieldValue.serverTimestamp() },
  };
}

module.exports = {
  pack,
  unpack,
  squaresOf,
  inSightNow,
  peopleInSight,
  withSquares,
  seenRef,
  recordOf,
  knownTo,
  added,
  look,
  firstLook,
};
