'use strict';

/**
 * Game time (planning/the-loom-game-time.md §4.1; L-371 / #499): each save's
 * clock, in whole seconds since the game began, Day 1 at 00:00 (T1). A new
 * game starts at 08:00 (T2), and an older save reads as that until its next
 * turn gives it the field (T16).
 *
 * The day has named parts, and no hours are shown (T3):
 *   dawn 05–07, morning 07–12, midday 12–14, afternoon 14–17,
 *   evening 17–20, night 20–05.
 * Dawn breaks at 05:00 and dusk falls at 20:00, when night begins.
 *
 * timeRules(world) holds every number time is charged by (R2): turn lengths,
 * the travel day and route speeds. Nothing else holds them, so L-714 (route
 * kinds per world) and Phase 9 (game systems) change only it.
 *
 * Pure: no Firestore, no clock of the machine's.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const START = 8 * HOUR; // Day 1, 08:00 (T2)

// The parts of the day, by the hour each begins (T3). Night runs past midnight.
const PARTS = [
  { name: 'night', from: 0 },
  { name: 'dawn', from: 5 },
  { name: 'morning', from: 7 },
  { name: 'midday', from: 12 },
  { name: 'afternoon', from: 14 },
  { name: 'evening', from: 17 },
  { name: 'night', from: 20 },
];
const DAWN = 5 * HOUR; // dawn breaks
const DUSK = 20 * HOUR; // dusk falls: night begins

// The defaults (R2): 6 s a battle-map turn, about 5 min a town turn (T4);
// 8 hours a day on land (T9); road 3 mph, trail 2, sea 5 (T8); ships sail
// round the clock.
const DEFAULT_RULES = Object.freeze({
  turnSeconds: Object.freeze({ battle: 6, other: 300 }),
  travelDayHours: 8,
  routeSpeeds: Object.freeze({ road: 3, trail: 2, sea: 5 }),
  roundTheClock: Object.freeze(['sea']),
});

/** Whether a value is a save's time: whole seconds, 0 or more. */
function isTime(value) {
  return Number.isInteger(value) && value >= 0;
}

/** A save's time: its own, or the start for an older save without one (T16). */
function timeOf(save) {
  return save && isTime(save.time) ? save.time : START;
}

/** The day (from 1), the part of day and the hour (0–23) for a time. */
function partOf(seconds) {
  const day = Math.floor(seconds / DAY) + 1;
  const hour = Math.floor((seconds % DAY) / HOUR);
  let part = PARTS[0].name;
  for (const p of PARTS) if (hour >= p.from) part = p.name;
  return { day, part, hour };
}

/** "Day 1, evening" (T15). */
function label(seconds) {
  const { day, part } = partOf(seconds);
  return `Day ${day}, ${part}`;
}

/**
 * The dawns and dusks between two times, in order: [{ event: 'dawn' |
 * 'dusk', day, at }], where `at` is the time it came. A time exactly at the
 * start isn't counted; one exactly at the end is.
 */
function crossed(from, to) {
  const events = [];
  if (!(to > from)) return events;
  for (let dayStart = Math.floor(from / DAY) * DAY; dayStart <= to; dayStart += DAY) {
    for (const [event, offset] of [
      ['dawn', DAWN],
      ['dusk', DUSK],
    ]) {
      const at = dayStart + offset;
      if (at > from && at <= to) events.push({ event, day: dayStart / DAY + 1, at });
    }
  }
  return events;
}

// "1", "1½", "2": a number of halves in words.
function halves(n) {
  const whole = Math.floor(n / 2);
  return n % 2 ? `${whole || ''}½` : String(whole);
}

/**
 * How long, in words: "a few seconds", "about 5 minutes", "about an hour",
 * "about 1½ hours", "about 6 hours", "a day", "2 days", "about 2½ days".
 */
function duration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  if (s < MINUTE) return 'a few seconds';
  if (s < 45 * MINUTE) {
    const minutes = Math.round(s / MINUTE);
    if (minutes <= 1) return 'about a minute';
    const rounded = minutes < 10 ? minutes : Math.round(minutes / 5) * 5;
    return `about ${rounded} minutes`;
  }
  if (s < 23 * HOUR) {
    const n = Math.max(2, Math.round(s / (HOUR / 2))); // half hours, from 1 hour
    return n === 2 ? 'about an hour' : `about ${halves(n)} hours`;
  }
  const n = Math.max(2, Math.round(s / (DAY / 2))); // half days, from 1 day
  const exact = s % DAY === 0;
  if (n === 2) return exact ? 'a day' : 'about a day';
  if (n % 2 === 0 && exact) return `${n / 2} days`;
  return `about ${halves(n)} days`;
}

// When each part of the day begins, in hours: night begins at dusk (T3).
const PART_STARTS = Object.freeze({
  dawn: 5,
  morning: 7,
  midday: 12,
  afternoon: 14,
  evening: 17,
  night: 20,
});

/**
 * The next start of a part of the day after `now` (L-374; T12): waiting
 * until it. Already in that part, it is the next one: sleeping until dawn
 * at dawn waits for the next dawn. Null for a name that isn't a part.
 */
function nextStartOf(now, part) {
  const hour = PART_STARTS[part];
  if (hour === undefined) return null;
  const dayStart = Math.floor(now / DAY) * DAY;
  const at = dayStart + hour * HOUR;
  // The first start after now: within that part, its start is behind you.
  return at > now ? at : at + DAY;
}

// What came on the way: "dusk fell on the way", "dusk fell and dawn broke
// on the way", or for more, how many of each and which came last.
function crossedWords(crossed) {
  const said = { dusk: 'dusk fell', dawn: 'dawn broke' };
  if (crossed.length <= 2) return crossed.map((c) => said[c.event]).join(' and ') + ' on the way';
  const count = (event) => crossed.filter((c) => c.event === event).length;
  const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times');
  const last = crossed[crossed.length - 1].event;
  return (
    'on the way, dusk fell ' +
    times(count('dusk')) +
    ' and dawn broke ' +
    times(count('dawn')) +
    ', the last ' +
    (last === 'dusk' ? 'dusk' : 'dawn')
  );
}

/**
 * The TIME line the GM is given (game time T14; L-375): the day and part of
 * day `now`, and, when `spent` is given ({ seconds, crossed }), how much
 * passed and any dusk or dawn on the way: "Day 3, evening. About 6 hours
 * passed; dusk fell on the way." No time spent says so: "No time passed."
 */
function timeLine(now, spent) {
  const at = label(now) + '.';
  if (spent === undefined) return at;
  const seconds = (spent && spent.seconds) || 0;
  if (seconds <= 0) return at + ' No time passed.';
  const passed = duration(seconds);
  const crossed = (spent && spent.crossed) || [];
  return (
    at +
    ' ' +
    passed.charAt(0).toUpperCase() +
    passed.slice(1) +
    ' passed' +
    (crossed.length ? '; ' + crossedWords(crossed) + '.' : '.')
  );
}

/** A time as the play view gets it (L-376; T15): `{ seconds, label }`. */
function timeView(seconds) {
  return { seconds, label: label(seconds) };
}

/**
 * The rules time is charged by, for a world (R2). Today every world takes
 * the defaults; a world's own settings come with L-714 and Phase 9.
 */
// eslint-disable-next-line no-unused-vars
function timeRules(world) {
  return DEFAULT_RULES;
}

/** A turn's length in seconds: on a battle map, or anywhere else (T4). */
function turnSeconds(world, onBattleMap) {
  const turns = timeRules(world).turnSeconds;
  return onBattleMap ? turns.battle : turns.other;
}

module.exports = {
  MINUTE,
  HOUR,
  DAY,
  START,
  PARTS,
  PART_STARTS,
  isTime,
  timeOf,
  partOf,
  label,
  crossed,
  duration,
  timeLine,
  timeView,
  nextStartOf,
  timeRules,
  turnSeconds,
};
