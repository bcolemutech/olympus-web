'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const paths = require('../loom-canon/town-paths');
const town = require('../loom-canon/town');
const { streetOf } = require('./town-steps');

/**
 * What each save has seen of each town with ground (planning/the-loom-
 * movement-and-vision.md §9; L-671 / #473), as battle maps keep what was seen
 * on them (./seen.js). One document a town, beside the save:
 *
 *   loom_saves/{saveId}/seenTowns/{locationId}
 *     locationId
 *     side      — the walking grid's squares each way it was packed for (200)
 *     squares   — one bit a square of the town's walking grid (town-paths.js:
 *                 5 units a side), in base64: square (x, y) is bit y × side +
 *                 x, the lowest bit of each byte first; 6,668 characters
 *     updatedAt
 *
 * It only ever grows. What's in sight (town-paths.js inSight: about 100 m,
 * buildings and walls block) is added from along every walk on the street,
 * and from wherever the save comes to stand there: stepping out of a place,
 * or a typed walk. No rule lets a player read it; only the server does
 * (what leaves the server is L-672's business).
 */

const SIGHT_METRES = 100;
const SIDE = paths.SIDE / paths.CELL;

/** Packs a grid of squares (a Uint8Array, 1 where seen) into bits, in base64. */
function pack(squares) {
  const bytes = Buffer.alloc(Math.ceil(squares.length / 8));
  for (let i = 0; i < squares.length; i++) if (squares[i]) bytes[i >> 3] |= 1 << (i & 7);
  return bytes.toString('base64');
}

/** The squares packed bits hold: a Uint8Array over the grid, 1 where seen. */
function unpack(packed) {
  const bytes = Buffer.from(packed || '', 'base64');
  const squares = new Uint8Array(SIDE * SIDE);
  for (let i = 0; i < squares.length; i++) if (bytes[i >> 3] & (1 << (i & 7))) squares[i] = 1;
  return squares;
}

/** The squares a record holds: none without a record, or one packed for another grid. */
function squaresOf(record) {
  return record && record.side === SIDE ? unpack(record.squares) : new Uint8Array(SIDE * SIDE);
}

/** The radius of sight in a settlement's town units: 100 m, from its size. */
function radiusIn(settlement) {
  return paths.sightRadius(town.townSize(settlement).metres, SIGHT_METRES);
}

/**
 * What can be seen along a way through a town (its points, town
 * coordinates): looked at from its points, and between them every half
 * radius, so nothing walked past is missed.
 */
function sightAlong(ground, points, radius) {
  const seen = new Uint8Array(SIDE * SIDE);
  const look = (p) => {
    const now = paths.inSight(ground, p, radius);
    for (let i = 0; i < now.length; i++) if (now[i]) seen[i] = 1;
  };
  const every = Math.max(paths.CELL, radius / 2);
  points.forEach((p, i) => {
    if (i) {
      const a = points[i - 1];
      const steps = Math.floor(Math.hypot(p.x - a.x, p.y - a.y) / every);
      for (let s = 1; s <= steps; s++) {
        const t = (s * every) / Math.hypot(p.x - a.x, p.y - a.y);
        look({ x: a.x + (p.x - a.x) * t, y: a.y + (p.y - a.y) * t });
      }
    }
    look(p);
  });
  return seen;
}

/** The record of a town a save has seen. */
function seenTownRef(saveRef, locationId) {
  return saveRef.collection('seenTowns').doc(locationId);
}

/**
 * Reads a save's record of a town (in a transaction, when given one):
 * `{ ref, record }`, record null when it has seen nothing there yet.
 */
async function townRecordOf(transaction, saveRef, locationId) {
  const ref = seenTownRef(saveRef, locationId);
  const snap = transaction ? await transaction.get(ref) : await ref.get();
  return { ref, record: snap.exists ? snap.data() : null };
}

/**
 * A record read (`found`) with what the save, as it now stands on the street,
 * saw along `walked` (town points; else from where it stands) added:
 * `{ ref, value }` to write, or null: not on the street of a town with
 * ground, or nothing new.
 */
function townAdded(found, canonWorld, save, walked) {
  const street = streetOf(canonWorld, save);
  if (!street) return null;
  const points = (walked && walked.length ? walked : []).concat([street.from]);
  const now = sightAlong(street.ground, points, radiusIn(street.settlement));
  const squares = squaresOf(found.record);
  let added = false;
  for (let i = 0; i < now.length; i++) {
    if (now[i] && !squares[i]) {
      squares[i] = 1;
      added = true;
    }
  }
  if (!added) return null;
  return {
    ref: found.ref,
    value: {
      locationId: street.settlement.id,
      side: SIDE,
      squares: pack(squares),
      updatedAt: FieldValue.serverTimestamp(),
    },
  };
}

/**
 * Inside a transaction, before any of its writes: the record of the town the
 * save (as it now stands) is on the street of, with what it sees added.
 * `{ ref, value }` to write once the reads are done, or null.
 */
async function lookInTown(transaction, saveRef, canonWorld, save, walked) {
  if (!streetOf(canonWorld, save)) return null;
  const found = await townRecordOf(transaction, saveRef, save.location);
  return townAdded(found, canonWorld, save, walked);
}

module.exports = {
  SIGHT_METRES,
  SIDE,
  pack,
  unpack,
  squaresOf,
  radiusIn,
  sightAlong,
  seenTownRef,
  townRecordOf,
  townAdded,
  lookInTown,
};
