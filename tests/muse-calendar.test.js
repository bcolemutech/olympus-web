'use strict';

/**
 * A project's own calendar as plain data (planning/the-muse.md §3 TL1,
 * CA1–CA9, EV7, D11, D12; M-301 / #922): the checks, the arithmetic, and
 * writing and reading dates, run on both the page's copy and the server's.
 *
 * Run: cd tests && npx jest muse-calendar --verbose
 */

const page = require('../public/apps/muse/js/calendar.js');
const server = require('../functions/muse/calendar.js');

// A calendar like the Forgotten Realms': two months of 30 days with a
// festival day between them outside the week, a ten-day week, two seasons,
// and two eras, the first counting backward to the second.
const HARPTOS = {
  months: [
    { name: 'Hammer', short: 'Ham', days: 30 },
    { name: 'Midwinter', days: 1, outsideWeek: true },
    { name: 'Alturiak', short: 'Alt', days: 30 },
  ],
  weekdays: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
  firstWeekday: 0,
  seasons: [
    { name: 'Spring', month: 3, day: 10 },
    { name: 'Winter', month: 1, day: 1 },
  ],
  hoursPerDay: 24,
  minutesPerHour: 60,
  eras: [
    { name: 'Third Age', short: 'T.A.', start: 1 },
    { name: 'Before the Founding', short: 'B.F.', start: -5000, backward: true },
  ],
  format: '{d} {M} {y} {E}',
};

describe.each([
  ['the page’s copy', page],
  ['the server’s copy', server],
])('%s', (_, C) => {
  const cal = C.check(HARPTOS).value;

  describe('checking a calendar', () => {
    test('cleans one, ordering eras and seasons', () => {
      expect(cal.eras.map((e) => e.short)).toEqual(['B.F.', 'T.A.']);
      expect(cal.seasons.map((s) => s.name)).toEqual(['Winter', 'Spring']);
      expect(cal.months[1]).toEqual({ name: 'Midwinter', short: '', days: 1, outsideWeek: true });
      expect(C.check(C.gregorian()).value).toEqual(C.gregorian());
      expect(C.check(C.blank()).value).toEqual(C.blank());
    });

    test('refuses one of the wrong shape or past its bounds', () => {
      const bad = (changes) => C.check({ ...HARPTOS, ...changes }).error;
      expect(C.check([]).error).toMatch(/object/);
      expect(bad({ moons: [] })).toMatch(/moons/);
      expect(bad({ months: 'Hammer' })).toMatch(/list/);
      expect(bad({ months: [{ name: 'Hammer', days: 0 }] })).toMatch(/days/);
      expect(bad({ months: [{ name: 'Hammer', days: 1001 }] })).toMatch(/days/);
      expect(bad({ months: Array.from({ length: 101 }, (_, i) => ({ name: `M${i}`, days: 1 })) })).toMatch(
        /at most 100/
      );
      expect(bad({ months: [{ name: '12', days: 3 }] })).toMatch(/letter/);
      expect(bad({ firstWeekday: 10 })).toMatch(/first weekday/);
      expect(bad({ seasons: [{ name: 'Spring', month: 4, day: 1 }] })).toMatch(/months/);
      expect(bad({ seasons: [{ name: 'Spring', month: 2, day: 2 }] })).toMatch(/Midwinter/);
      expect(bad({ hoursPerDay: 0 })).toMatch(/hours/);
      expect(bad({ minutesPerHour: 101 })).toMatch(/minutes/);
      expect(bad({ eras: [{ name: 'A', start: 1 }, { name: 'B', start: 1 }] })).toMatch(/same year/);
      expect(bad({ eras: [{ name: 'Long Night', start: 1, backward: true }] })).toMatch(/follow/);
      expect(bad({ weekdays: ['Hammer'] })).toMatch(/names two/);
      expect(bad({ format: '{d} {M}' })).toMatch(/year/);
      expect(bad({ format: '{d} {Month} {y}' })).toMatch(/\{Month\}/);
      expect(bad({ format: 'x'.repeat(101) })).toMatch(/at most 100/);
    });
  });

  describe('arithmetic', () => {
    test('days in a year and a month; no leap years (CA2)', () => {
      expect(C.daysInYear(cal)).toBe(61);
      expect(C.daysInMonth(cal, 2)).toBe(1);
      expect(C.daysInYear(C.gregorian())).toBe(365);
      expect(C.daysInMonth(C.gregorian(), 2)).toBe(28);
    });

    test('day counts across month and year ends', () => {
      expect(C.dayCount(cal, { year: 1, month: 1, day: 1 })).toBe(0);
      expect(C.dayCount(cal, { year: 1, month: 1, day: 30 })).toBe(29);
      expect(C.dayCount(cal, { year: 1, month: 2, day: 1 })).toBe(30);
      expect(C.dayCount(cal, { year: 1, month: 3, day: 1 })).toBe(31);
      expect(C.dayCount(cal, { year: 1, month: 3, day: 30 })).toBe(60);
      expect(C.dayCount(cal, { year: 2, month: 1, day: 1 })).toBe(61);
      expect(C.dayCount(cal, { year: 0, month: 3, day: 30 })).toBe(-1);
      expect(C.dayCount(cal, { year: 2 })).toBe(61);
      expect(C.dayCount(C.blank(), { year: 2 })).toBeNull();
    });

    test('weekdays run on across months and years, skipping days outside the week (CA4)', () => {
      const day = (date) => (C.weekday(cal, date) || { name: null }).name;
      expect(day({ year: 1, month: 1, day: 1 })).toBe('One');
      expect(day({ year: 1, month: 1, day: 30 })).toBe('Ten');
      expect(day({ year: 1, month: 2, day: 1 })).toBeNull();
      expect(day({ year: 1, month: 3, day: 1 })).toBe('One');
      // 60 days in the week a year: year 2 starts on One again, year 0 too.
      expect(day({ year: 2, month: 1, day: 1 })).toBe('One');
      expect(day({ year: 0, month: 3, day: 30 })).toBe('Ten');
      expect(day({ year: 1, month: 1 })).toBeNull();
      expect(C.weekday(C.blank(), { year: 1 })).toBeNull();
    });

    test('the Gregorian calendar’s weekday for a known date', () => {
      const g = C.gregorian();
      expect(C.weekday(g, { year: 2026, month: 1, day: 1 }).name).toBe('Thursday');
      expect(C.weekday(g, { year: 2026, month: 11, day: 26 }).name).toBe('Thursday');
      expect(C.weekday(g, { year: 2026, month: 12, day: 25 }).name).toBe('Friday');
    });

    test('seasons, wrapping round the year end', () => {
      const season = (date) => C.season(cal, date).name;
      expect(season({ year: 1, month: 1, day: 1 })).toBe('Winter');
      expect(season({ year: 1, month: 3, day: 9 })).toBe('Winter');
      expect(season({ year: 1, month: 3, day: 10 })).toBe('Spring');
      const g = C.gregorian();
      expect(C.season(g, { year: 2026, month: 1, day: 5 }).name).toBe('Winter');
      expect(C.season(g, { year: 2026, month: 7, day: 1 }).name).toBe('Summer');
      expect(C.season(cal, { year: 1, month: 1 })).toBeNull();
    });

    test('eras: one counting backward before one counting forward (CA1)', () => {
      expect(C.eraOf(cal, 1)).toMatchObject({ year: 1, era: { short: 'T.A.' } });
      expect(C.eraOf(cal, 1492)).toMatchObject({ year: 1492, era: { short: 'T.A.' } });
      expect(C.eraOf(cal, 0)).toMatchObject({ year: 1, era: { short: 'B.F.' } });
      expect(C.eraOf(cal, -199)).toMatchObject({ year: 200, era: { short: 'B.F.' } });
      // The first era reaches back before its start.
      expect(C.eraOf(cal, -9000)).toMatchObject({ year: 9001, era: { short: 'B.F.' } });
      expect(C.runningYear(cal, 0, 200)).toBe(-199);
      expect(C.runningYear(cal, 1, 1492)).toBe(1492);
      expect(C.eraOf(C.blank(), 5)).toBeNull();
    });

    test('dates compare, "200 B.F." before "1 T.A."', () => {
      const a = C.read(cal, '200 B.F.').value;
      const b = C.read(cal, '1 T.A.').value;
      expect(C.compare(a, b)).toBe(-1);
      expect(C.compare({ year: 5 }, { year: 5, month: 1 })).toBe(-1);
      expect(C.compare({ year: 5, month: 2, day: 1 }, { year: 5, month: 1, day: 30 })).toBe(1);
      expect(C.compare({ year: 5, circa: true }, { year: 5 })).toBe(0);
    });
  });

  describe('writing and reading dates', () => {
    const dates = [
      { year: 1492 },
      { year: 1492, month: 1 },
      { year: 1492, month: 1, day: 3 },
      { year: 1492, month: 2, day: 1 },
      { year: 1492, month: 3, day: 3, hour: 14, minute: 5 },
      { year: 1492, month: 3, day: 3, hour: 7 },
      { year: -199, circa: true },
      { year: -199, month: 3, day: 21, hour: 0, minute: 0, circa: true },
    ];

    test.each(C.FORMATS)('pattern %s: every precision, with time and circa, round trip', (format) => {
      const c = { ...cal, format };
      dates.forEach((date) => {
        const text = C.write(c, date);
        expect({ text, read: C.read(c, text) }).toEqual({ text, read: { value: date } });
      });
    });

    test('each pattern writes as it shows', () => {
      const date = { year: 1492, month: 1, day: 3 };
      const write = (format, d = date) => C.write({ ...cal, format }, d);
      expect(write('{d} {M} {y} {E}')).toBe('3 Hammer 1492 T.A.');
      expect(write('the {do} of {M}, {y} {E}')).toBe('the 3rd of Hammer, 1492 T.A.');
      expect(write('the {do} of {M}, {y}')).toBe('the 3rd of Hammer, 1492');
      expect(write('{M} {d}, {y} {E}')).toBe('Hammer 3, 1492 T.A.');
      expect(write('{W}, {d} {M} {y} {E}')).toBe('Three, 3 Hammer 1492 T.A.');
      expect(write('{Y}-{mm}-{dd}')).toBe('1492-01-03');
      expect(write('{dd}/{mm}/{Y} ({EE})')).toBe('03/01/1492 (Third Age)');
      expect(write('{d} {Ms} {y}')).toBe('3 Ham 1492');
      // Taken out with what joins them, at lower precision.
      expect(write('the {do} of {M}, {y} {E}', { year: 1492, month: 1 })).toBe('Hammer, 1492 T.A.');
      expect(write('the {do} of {M}, {y} {E}', { year: 1492 })).toBe('1492 T.A.');
      expect(write('{Y}-{mm}-{dd}', { year: 1492, month: 1 })).toBe('1492-01');
      expect(write('{dd}/{mm}/{Y} ({EE})', { year: 1492 })).toBe('1492 (Third Age)');
      // A day outside the week has no weekday.
      expect(write('{W}, {d} {M} {y} {E}', { year: 1492, month: 2, day: 1 })).toBe(
        '1 Midwinter 1492 T.A.'
      );
      expect(C.write(cal, { year: 1492, month: 3, day: 3, hour: 9, minute: 5, circa: true })).toBe(
        'c. 3 Alturiak 1492 T.A., 09:05'
      );
      // No eras: the running year, plainly.
      expect(C.write({ ...cal, eras: [] }, { year: -4, month: 1 })).toBe('Hammer -4');
      expect(C.write(C.gregorian(), { year: 0 })).toBe('1 BCE');
    });

    test('reads text in other ways of writing it', () => {
      const read = (text) => C.read(cal, text);
      expect(read('3 hammer 1492')).toEqual({ value: { year: 1492, month: 1, day: 3 } });
      expect(read('the 3rd of Hammer, 1492 T.A.')).toEqual({ value: { year: 1492, month: 1, day: 3 } });
      expect(read('Ham 3 1492 Third Age')).toEqual({ value: { year: 1492, month: 1, day: 3 } });
      expect(read('3 1 1492')).toEqual({ value: { year: 1492, month: 1, day: 3 } });
      expect(read('circa 200 Before the Founding')).toEqual({ value: { year: -199, circa: true } });
      expect(read('Three, 3 Hammer 1492')).toEqual({ value: { year: 1492, month: 1, day: 3 } });
      expect(read('')).toEqual({ value: null });
      expect(read('3 Hamer 1492').error).toMatch(/not a month/);
      expect(read('31 Hammer 1492').error).toMatch(/Hammer has 30 days/);
      expect(read('Hammer').error).toMatch(/year/);
      expect(read('1 2 3 4').error).toMatch(/more numbers/);
      expect(read('1492, 25:00').error).toMatch(/time needs its day/);
      expect(read('3 Hammer 1492, 25:00').error).toMatch(/24 hours/);
    });

    test('reads numbers, the running year or an era’s', () => {
      expect(C.parse(cal, { year: 1492, month: 1, day: 3 })).toEqual({
        value: { year: 1492, month: 1, day: 3 },
      });
      expect(C.parse(cal, { era: 'B.F.', year: 200 })).toEqual({ value: { year: -199 } });
      expect(C.parse(cal, { era: 'Third Age', year: 3, month: 2, day: 1 })).toEqual({
        value: { year: 3, month: 2, day: 1 },
      });
      expect(C.parse(cal, 1492)).toEqual({ value: { year: 1492 } });
      expect(C.parse(cal, { era: 'Fourth Age', year: 1 }).error).toMatch(/no era/);
      expect(C.parse(cal, { year: 1, month: 4 }).error).toMatch(/3 months/);
    });

    test('ranges, open at the end or not', () => {
      expect(C.parseRange(cal, '1190 – 1210', false)).toEqual({
        value: { from: { year: 1190 }, to: { year: 1210 } },
      });
      expect(C.parseRange(cal, '1190 to ongoing', true)).toEqual({
        value: { from: { year: 1190 }, to: null },
      });
      expect(C.parseRange(cal, '1190 – ongoing', false).error).toMatch(/last date/);
      expect(C.parseRange(cal, '1210 – 1190', false).error).toMatch(/before it starts/);
      expect(C.writeRange(cal, { from: { year: 1190 }, to: null })).toBe('1190 T.A. – ongoing');
    });
  });

  describe('whether a date fits (CA9)', () => {
    test('a date is flagged when a month is shortened past it', () => {
      const date = { year: 1492, month: 3, day: 30 };
      expect(C.misfit(cal, date)).toBeNull();
      const shorter = C.check({
        ...HARPTOS,
        months: HARPTOS.months.map((m) => (m.name === 'Alturiak' ? { ...m, days: 28 } : m)),
      }).value;
      expect(C.misfit(shorter, date)).toBe('Alturiak has 28 days, not 30.');
      expect(C.fits(shorter, date)).toBe(false);
      // Its numbers are kept, and it is still written.
      expect(C.write(shorter, date)).toBe('30 Alturiak 1492 T.A.');
      const fewer = { ...shorter, months: shorter.months.slice(0, 2) };
      expect(C.misfit(fewer, date)).toMatch(/2 months, not 3/);
      expect(C.misfit({ ...cal, hoursPerDay: 10 }, { year: 1, month: 1, day: 1, hour: 12 })).toMatch(
        /10 hours/
      );
    });
  });
});
