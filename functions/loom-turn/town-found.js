'use strict';

const ground = require('../loom-canon/ground');
const town = require('../loom-canon/town');
const paths = require('../loom-canon/town-paths');
const { squaresOf } = require('./town-seen');

/**
 * The places a save has found in a town with ground (planning/the-loom-
 * movement-and-vision.md §9; L-673 / #475). A place is found once its door
 * has been in sight: its square is in the save's record of the town
 * (./town-seen.js), which only grows, so it stays found. Some are known from
 * the start: the ways in and out, and the place the save is at (where it
 * arrived, or stands).
 *
 * Only found places are sent to the town view, and INTERPRET and NARRATE
 * are given a world without the others (knownWorld); a move to one is turned
 * down (UNKNOWN). Hidden places, and places learned of from a map or a
 * conversation, will join the "known" ways here.
 *
 * A town without ground is known whole, as before: null.
 */

const UNKNOWN = "You don't know where that is.";

/** The ids of the places the save knows in the town it's in, or null: all of them. */
function foundIn(canonWorld, save, record) {
  const settlement = save && save.location && canonWorld.locations[save.location];
  if (!settlement || !ground.hasGround(settlement)) return null;
  const g = ground.groundOf(settlement);
  const seen = squaresOf(record);
  const side = paths.SIDE / paths.CELL;
  const sighted = (square) => Boolean(square) && seen[square.y * side + square.x] === 1;
  const found = new Set();
  for (const place of town.placesOf(canonWorld, settlement.id)) {
    const known = town.isEntrance(place) || place.id === save.placeId;
    const door = place.position;
    const doorSeen =
      door &&
      Number.isFinite(door.x) &&
      Number.isFinite(door.y) &&
      (sighted(paths.squareAt(door)) || sighted(paths.squareFor(g, door)));
    if (known || doorSeen) found.add(place.id);
  }
  // Where it stands, even a place since retired.
  if (save.placeId) found.add(save.placeId);
  return found;
}

/**
 * The world as the GM may know it (INTERPRET and NARRATE): without the
 * places of the save's town it hasn't found. The world itself when it knows
 * the town whole.
 */
function knownWorld(canonWorld, save, found) {
  if (!found) return canonWorld;
  const places = {};
  for (const [id, place] of Object.entries(canonWorld.places || {})) {
    if (place.locationId !== save.location || found.has(id)) places[id] = place;
  }
  return { ...canonWorld, places };
}

module.exports = { UNKNOWN, foundIn, knownWorld };
