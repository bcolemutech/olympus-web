'use strict';

/**
 * Game time's clock (planning/the-loom-game-time.md §3 T1–T4, R2, §4.1;
 * L-371 / #499): functions/loom-canon/clock.js. Pure; no emulator.
 *
 * Run: cd tests && npx jest loom-clock --verbose
 */

const clock = require('../functions/loom-canon/clock');

const { HOUR, MINUTE, DAY, START } = clock;
const at = (day, hour, minute = 0) => (day - 1) * DAY + hour * HOUR + minute * MINUTE;

test('a game starts on Day 1 at 08:00', () => {
  expect(START).toBe(28800);
  expect(clock.label(START)).toBe('Day 1, morning');
  expect(clock.partOf(START)).toEqual({ day: 1, part: 'morning', hour: 8 });
});

test('the parts of the day, at their edges', () => {
  const cases = [
    [at(1, 0), 'night'],
    [at(1, 4, 59), 'night'],
    [at(1, 5), 'dawn'],
    [at(1, 6, 59), 'dawn'],
    [at(1, 7), 'morning'],
    [at(1, 11, 59), 'morning'],
    [at(1, 12), 'midday'],
    [at(1, 13, 59), 'midday'],
    [at(1, 14), 'afternoon'],
    [at(1, 16, 59), 'afternoon'],
    [at(1, 17), 'evening'],
    [at(1, 19, 59), 'evening'],
    [at(1, 20), 'night'],
    [at(1, 23, 59), 'night'],
  ];
  for (const [seconds, part] of cases)
    expect([seconds, clock.partOf(seconds).part]).toEqual([seconds, part]);
});

test('labels name the day and its part; the day turns at midnight', () => {
  expect(clock.label(at(1, 18))).toBe('Day 1, evening');
  expect(clock.label(at(1, 23, 59) + 59)).toBe('Day 1, night');
  expect(clock.label(at(2, 0))).toBe('Day 2, night');
  expect(clock.label(at(3, 12, 30))).toBe('Day 3, midday');
  expect(clock.label(0)).toBe('Day 1, night');
});

describe('dawn and dusk on the way', () => {
  test('dusk falls at 20:00, dawn breaks at 05:00', () => {
    expect(clock.crossed(at(1, 14), at(1, 21))).toEqual([{ event: 'dusk', day: 1, at: at(1, 20) }]);
    expect(clock.crossed(at(1, 4), at(1, 6))).toEqual([{ event: 'dawn', day: 1, at: at(1, 5) }]);
  });

  test('over midnight: dusk, then the next dawn', () => {
    expect(clock.crossed(at(1, 19), at(2, 6)).map((e) => [e.event, e.day])).toEqual([
      ['dusk', 1],
      ['dawn', 2],
    ]);
  });

  test('over several days, every one in order', () => {
    expect(clock.crossed(at(1, 8), at(3, 21)).map((e) => e.event + ' ' + e.day)).toEqual([
      'dusk 1',
      'dawn 2',
      'dusk 2',
      'dawn 3',
      'dusk 3',
    ]);
  });

  test('none within a part of the day, or for no time at all', () => {
    expect(clock.crossed(at(1, 8), at(1, 16))).toEqual([]);
    expect(clock.crossed(at(1, 8), at(1, 8))).toEqual([]);
    expect(clock.crossed(at(1, 9), at(1, 8))).toEqual([]);
  });

  test('a time exactly at the start is passed; one exactly at the end is reached', () => {
    expect(clock.crossed(at(1, 20), at(1, 22))).toEqual([]);
    expect(clock.crossed(at(1, 18), at(1, 20))).toEqual([{ event: 'dusk', day: 1, at: at(1, 20) }]);
  });
});

test('durations in words', () => {
  const cases = [
    [6, 'a few seconds'],
    [59, 'a few seconds'],
    [60, 'about a minute'],
    [5 * MINUTE, 'about 5 minutes'],
    [9 * MINUTE, 'about 9 minutes'],
    [22 * MINUTE, 'about 20 minutes'],
    [50 * MINUTE, 'about an hour'],
    [HOUR, 'about an hour'],
    [90 * MINUTE, 'about 1½ hours'],
    [6 * HOUR, 'about 6 hours'],
    [6 * HOUR + 10 * MINUTE, 'about 6 hours'],
    [22 * HOUR, 'about 22 hours'],
    [DAY, 'a day'],
    [DAY + 3 * HOUR, 'about a day'],
    [2 * DAY, '2 days'],
    [2.5 * DAY, 'about 2½ days'],
  ];
  for (const [seconds, words] of cases)
    expect([seconds, clock.duration(seconds)]).toEqual([seconds, words]);
});

test('timeRules: the defaults for a world without settings', () => {
  const rules = clock.timeRules({ id: 'nisia', name: 'Nisia' });
  expect(rules).toEqual({
    turnSeconds: { battle: 6, other: 300 },
    travelDayHours: 8,
    routeSpeeds: { road: 3, trail: 2, sea: 5 },
    roundTheClock: ['sea'],
  });
  expect(clock.timeRules(null)).toEqual(rules);
  expect(Object.isFrozen(rules)).toBe(true);
  expect(clock.turnSeconds({}, true)).toBe(6);
  expect(clock.turnSeconds({}, false)).toBe(300);
});

test("a save's time: its own, or 08:00 for an older save", () => {
  expect(clock.timeOf({ time: 1234 })).toBe(1234);
  expect(clock.timeOf({})).toBe(START);
  expect(clock.timeOf({ time: -5 })).toBe(START);
  expect(clock.timeOf({ time: 1.5 })).toBe(START);
  expect(clock.timeOf(null)).toBe(START);
});
