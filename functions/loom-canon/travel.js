'use strict';

/**
 * Travel takes time (planning/the-loom-game-time.md §4.2, T8–T11, R2, R3;
 * L-373 / #501): how long a trip along a world route takes, and how long a
 * walk through a town without ground takes. One function works out each, so
 * the estimate the map shows before you go (loomGetMap) is the time the trip
 * then takes (ADJUDICATE).
 *
 * A world trip: the route's miles (./routes.js) at its kind's speed, from
 * timeRules(world) (road 3 mph, trail 2, sea 5). On land a day's travel is 8
 * hours, and each travel day past the first adds a night camped, 16 hours:
 * a 10-hour trail is two days on the road, with a night between (T9, T10).
 * Routes in `roundTheClock` (the sea) go on through the night. When the trip
 * starts or how late it is doesn't change its length (T10); the narrator
 * covers the dark.
 *
 * A town walk without ground: the walk's length in metres (place positions
 * on the town's 0–1000 square, scaled by its size, ./town.js townMetres) at
 * the town turn's 80 m a minute (T11). Towns with ground are walked by
 * turns, which End turn charges (L-371).
 *
 * Pure: no Firestore.
 */

const clock = require('./clock');
const routes = require('./routes');
const town = require('./town');

const NIGHT_HOURS = 16; // a night camped: the rest of a 24-hour day (T10)
const TOWN_METRES_A_MINUTE = 80; // the town turn's pace: 400 m in 5 min (T11)
const FALLBACK_ROUTE = 'trail'; // a link with no kind travels as the slowest

// "on the trail", "on the road", "at sea": where a traveller is on the way.
// A map's own kinds (L-903: a jump lane) are "by jump".
function onThe(via) {
  if (via === 'sea') return 'at sea';
  if (via && via !== 'road' && via !== 'trail') return 'by ' + via;
  return 'on the ' + (via === 'road' ? 'road' : 'trail');
}

/**
 * A trip along the world route from one place to another, setting out at
 * `start` (seconds): `{ via, miles, hours, nights, seconds, from, to,
 * crossed, label, arrives }`, or null when the route has no length (a place
 * with no position). `seconds` is the whole trip, nights included; `crossed`
 * the dawns and dusks on the way (./clock.js); `label` "about 6 hours by
 * trail"; `arrives` the day and part of day on arrival when it differs from
 * the start ("Day 1, afternoon"), else null.
 */
function trip(world, fromId, toId, start) {
  const miles = routes.routeMiles(world, fromId, toId);
  if (miles === null) return null;
  const rules = clock.timeRules(world);
  const kind = town.routeBetween(world, fromId, toId);
  const via = rules.routeSpeeds[kind] ? kind : FALLBACK_ROUTE;
  const hours = miles / rules.routeSpeeds[via];
  const day = rules.travelDayHours;
  // A day on the road past the first starts after a night camped. A hair
  // over a whole day (floating point) is still that day.
  const nights = rules.roundTheClock.includes(via)
    ? 0
    : Math.max(0, Math.ceil(hours / day - 1e-9) - 1);
  const seconds = Math.round((hours + nights * NIGHT_HOURS) * clock.HOUR);
  const from = clock.isTime(start) ? start : clock.START;
  const to = from + seconds;
  const before = clock.partOf(from);
  const after = clock.partOf(to);
  return {
    via: kind,
    miles,
    hours,
    nights,
    seconds,
    from,
    to,
    crossed: clock.crossed(from, to),
    label: clock.duration(seconds) + ' by ' + (kind || FALLBACK_ROUTE),
    arrives: before.day === after.day && before.part === after.part ? null : clock.label(to),
  };
}

/**
 * What a trip's narration must say (T14): night falling on the way, nights
 * camped, and the arrival after how long. `arrival` ends the last line ("you
 * arrive at Daldockley, at the Trailhead.").
 */
function tripLines(t, arrival) {
  const where = onThe(t.via);
  const lines = [];
  if (t.crossed.some((c) => c.event === 'dusk')) lines.push('Night falls ' + where + '.');
  if (t.nights === 1) lines.push('You make camp for the night ' + where + '.');
  if (t.nights > 1) lines.push('You make camp ' + t.nights + ' nights ' + where + '.');
  lines.push('After ' + clock.duration(t.seconds) + ' ' + where + ', ' + arrival);
  return lines;
}

/**
 * A walk through a town without ground: the places in `walk` (the places
 * passed, then the one reached; ./town.js walkTo) from `here` (a place, or
 * null). `{ metres, seconds }`; a place without a position adds nothing.
 */
function townWalk(world, settlement, here, walk) {
  let metres = 0;
  let at = here && here.position;
  for (const place of walk) {
    const next = place.position;
    if (at && next) metres += town.townMetres(settlement, at, next);
    if (next) at = next;
  }
  return { metres, seconds: Math.round((metres / TOWN_METRES_A_MINUTE) * clock.MINUTE) };
}

/** The resolution's account of the time (for L-375): from, to, how long, and what it crossed. */
function timeSpent(from, seconds) {
  return { from, to: from + seconds, seconds, crossed: clock.crossed(from, from + seconds) };
}

module.exports = {
  onThe,
  NIGHT_HOURS,
  TOWN_METRES_A_MINUTE,
  trip,
  tripLines,
  townWalk,
  timeSpent,
};
