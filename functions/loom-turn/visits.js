'use strict';

const town = require('../loom-canon/town');

/**
 * Visits and the ways known (planning/journeys-and-arrivals.md §4.1, §4.2;
 * L-381 / #700). A save keeps:
 *
 *   visited     the settlements it has arrived in, in order of first arrival
 *   waysKnown   by settlement, the ways in and out it knows there: the ids it
 *               arrived by, stood in or crossed by, or 'all' where it knew
 *               the town before L-381
 *
 * A way whose door it has sighted is found too (./town-found.js), from its
 * record of the town, so isn't kept here.
 *
 * A save from before L-381 has neither. Its next turn derives them: it has
 * visited the settlement it was in and every one it has a town record of
 * (`seenTowns`, ./town-seen.js), and knows every way in and out of those, as
 * it did then. A place only seen on the world map (`discovered`) isn't
 * visited.
 */

/**
 * What a save from before L-381 is taken to know: `{ visited, waysKnown }`,
 * from the settlement it was in (`before`) and those it has town records of
 * (`recorded`, their ids).
 */
function derived(before, recorded) {
  const visited = [];
  for (const id of [before, ...(recorded || [])]) {
    if (id && !visited.includes(id)) visited.push(id);
  }
  return { visited, waysKnown: Object.fromEntries(visited.map((id) => [id, 'all'])) };
}

/**
 * Notes on a save (changed in place) where it now is: the settlement it's
 * in as visited, and the way in or out it stands in (its place, in town) as
 * known there. Returns the save.
 */
function noteWhereItIs(canonWorld, save) {
  const id = save.location;
  if (!id || !canonWorld.locations[id]) return save;
  if (!Array.isArray(save.visited)) save.visited = [];
  if (!save.visited.includes(id)) save.visited.push(id);
  const place = save.placeId && (canonWorld.places || {})[save.placeId];
  if (place && place.locationId === id && town.isEntrance(place)) knowWay(save, id, place.id);
  return save;
}

/** Adds a way in or out to those a save knows in a settlement (in place). */
function knowWay(save, locationId, placeId) {
  if (!save.waysKnown || typeof save.waysKnown !== 'object') save.waysKnown = {};
  const here = save.waysKnown[locationId];
  if (here === 'all') return;
  const list = Array.isArray(here) ? here : [];
  if (!list.includes(placeId)) list.push(placeId);
  save.waysKnown[locationId] = list;
}

module.exports = { derived, noteWhereItIs, knowWay };
