'use strict';

const travel = require('./travel');
const town = require('./town');
const clock = require('./clock');
const { isPlayable } = require('./grading');

/**
 * Journeys (planning/journeys-and-arrivals.md §4.5; L-384 / #703): from where
 * a save is to any settlement it has arrived in before, in one move, along
 * the quickest path by travel time whose every stop it has also arrived in
 * (JA1). The towns between are passed straight through (JA3): each leg's
 * trip time (./travel.js trip), plus each crossed town's walk from the way in
 * to the way out, summed. Crossing a town finds the ways used there (JA5).
 *
 * Pure.
 */

/** Whether a save can make a leg into a settlement: there, open, nothing it lacks. */
function legOpen(world, state, toId) {
  const to = world.locations[toId];
  if (!to || to.retired || !isPlayable(world, to)) return false;
  return !town.missingAbility(to, state);
}

/**
 * The quickest path from `fromId` to `toId` through settlements the save has
 * visited (`state.visited`), by travel time: `[fromId, …, toId]`, or null
 * (not visited, or no such path).
 */
function routeOf(world, state, fromId, toId) {
  const visited = new Set(Array.isArray(state.visited) ? state.visited : []);
  if (!visited.has(toId) || fromId === toId || !world.locations[fromId]) return null;
  const best = { [fromId]: 0 };
  const back = {};
  const done = new Set();
  for (;;) {
    let here = null;
    for (const id of Object.keys(best)) {
      if (!done.has(id) && (here === null || best[id] < best[here])) here = id;
    }
    if (here === null) return null;
    if (here === toId) break;
    done.add(here);
    for (const next of world.locations[here].connections || []) {
      if (!visited.has(next) || done.has(next) || !legOpen(world, state, next)) continue;
      const leg = travel.trip(world, here, next, clock.START);
      if (!leg) continue;
      const cost = best[here] + leg.seconds;
      if (best[next] === undefined || cost < best[next]) {
        best[next] = cost;
        back[next] = here;
      }
    }
  }
  const stops = [toId];
  while (stops[0] !== fromId) stops.unshift(back[stops[0]]);
  return stops;
}

// The walk across a crossed town, from its way in to its way out: seconds.
function crossingSeconds(world, settlement, wayIn, wayOut) {
  const a = wayIn && wayIn.position;
  const b = wayOut && wayOut.position;
  if (!a || !b || wayIn.id === wayOut.id) return 0;
  const metres = town.townMetres(settlement, a, b);
  return Math.round((metres / travel.TOWN_METRES_A_MINUTE) * clock.MINUTE);
}

/**
 * A journey from `fromId` to `toId`, setting out at `start`: `{ stops, legs:
 * [{ from, to, via }], crossings: [{ locationId, wayIn, wayOut }], arrival
 * (the way in at the end, or null), through (the crossed towns' names),
 * vias (the kinds of route, in order, each once), nights, seconds, from, to,
 * label }`, or null when there is no such journey (./journeys.js routeOf).
 */
function journeyOf(world, state, fromId, toId, start) {
  const stops = routeOf(world, state, fromId, toId);
  if (!stops) return null;
  const legs = stops.slice(1).map((to, i) => ({
    from: stops[i],
    to,
    via: town.routeBetween(world, stops[i], to),
  }));
  const from = clock.isTime(start) ? start : clock.START;
  let t = from;
  let nights = 0;
  const crossings = [];
  legs.forEach((leg, i) => {
    if (i > 0) {
      // Across the town between: in by the way facing where you came from,
      // out by the way facing where you're going (L-381).
      const id = leg.from;
      const wayIn = town.arrivalPlace(world, id, legs[i - 1].via, legs[i - 1].from);
      const wayOut = town.arrivalPlace(world, id, leg.via, leg.to);
      crossings.push({ locationId: id, wayIn, wayOut });
      t += crossingSeconds(world, world.locations[id], wayIn, wayOut);
    }
    const trip = travel.trip(world, leg.from, leg.to, t);
    nights += trip.nights;
    t = trip.to;
  });
  const last = legs[legs.length - 1];
  const vias = [];
  for (const leg of legs) if (leg.via && !vias.includes(leg.via)) vias.push(leg.via);
  return {
    stops,
    legs,
    crossings,
    arrival: town.arrivalPlace(world, toId, last.via, last.from),
    through: crossings.map((c) => world.locations[c.locationId].name),
    vias,
    nights,
    seconds: t - from,
    from,
    to: t,
    label:
      clock.duration(t - from) +
      (crossings.length
        ? ', through ' + andList(crossings.map((c) => world.locations[c.locationId].name))
        : ''),
  };
}

// "A", "A and B", "A, B and C".
function andList(names) {
  return names.length < 2
    ? names.join('')
    : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * The rules' line for a journey made: "You journey 3 days by road and sea,
 * through Hatham and Bridgeford, and arrive at Keton, at the Water Gate."
 */
function journeyLines(world, journey) {
  const to = world.locations[journey.stops[journey.stops.length - 1]];
  const lines = [];
  if (journey.nights === 1) lines.push('You make camp for a night on the way.');
  if (journey.nights > 1) lines.push('You make camp ' + journey.nights + ' nights on the way.');
  lines.push(
    'You journey ' +
      clock.duration(journey.seconds) +
      (journey.vias.length ? ' by ' + andList(journey.vias) : '') +
      (journey.through.length ? ', through ' + andList(journey.through) + ',' : '') +
      ' and arrive at ' +
      to.name +
      (journey.arrival ? ', at ' + journey.arrival.name : '') +
      '.'
  );
  return lines;
}

module.exports = { routeOf, journeyOf, journeyLines, legOpen };
