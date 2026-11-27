/* global module, window */
(function () {
  'use strict';

  // A project's own calendar and the dates written in it (planning/the-muse.md
  // §3 TL1, CA1–CA9, EV7, D11, D12; M-301 / #922). The same file is in
  // public/apps/muse/js/ and functions/muse/ (a test fails if they differ), so
  // the page and the connector work dates out the same way.
  //
  // The calendar, the project's `calendar`:
  //
  //   months          [{ name, short, days, outsideWeek }]: a "month" may be a
  //                   festival day or a few days, and may stand outside the
  //                   week (CA3). None: dates are years only.
  //   weekdays        names, possibly none (CA4)
  //   firstWeekday    the weekday (its place in `weekdays`, from 0) of the
  //                   first day in the week of year 1
  //   seasons         [{ name, month, day }], each where it starts
  //   hoursPerDay, minutesPerHour (CA6)
  //   eras            [{ name, short, start, backward }], in order of `start`,
  //                   a running year (CA1). Each era runs from its start to
  //                   the next one's, and the first reaches back before its
  //                   start too. A forward era counts its start as its year 1;
  //                   a backward one (like BC) counts its last year as 1, and
  //                   so can't be the last era.
  //   format          the pattern dates are written by (CA8; TOKENS below)
  //
  // Every year is the same length: there are no leap years (CA2).
  //
  // A date (D12): { year, month?, day?, hour?, minute?, circa? }, `year` the
  // running year, which counts on through every era (0 and below are the
  // years before year 1). A day needs its month, an hour its day and a minute
  // its hour. A range: { from, to }, `to` a date, or null for one still going.
  //
  // Pure: checks give back { value } or { error }.

  var LIMITS = {
    months: 100,
    monthDays: 1000,
    weekdays: 30,
    seasons: 24,
    eras: 20,
    name: 40,
    eraName: 60,
    short: 12,
    hours: 100,
    minutes: 100,
    format: 100,
    year: 1e9,
  };

  // The tokens a pattern is made of. Day tokens drop out of a date without a
  // day, month tokens out of one without a month, era tokens when the calendar
  // has no eras, and the weekday when the day has none.
  var TOKENS = [
    { id: 'd', name: 'Day', example: '3' },
    { id: 'dd', name: 'Day, two digits', example: '03' },
    { id: 'do', name: 'Day as an ordinal', example: '3rd' },
    { id: 'W', name: 'Weekday', example: 'Thursday' },
    { id: 'M', name: 'Month', example: 'Hammer' },
    { id: 'Ms', name: 'Month, short', example: 'Ham' },
    { id: 'm', name: 'Month as a number', example: '3' },
    { id: 'mm', name: 'Month as a number, two digits', example: '03' },
    { id: 'y', name: 'Year of its era', example: '1492' },
    { id: 'Y', name: 'Running year', example: '1492' },
    { id: 'E', name: 'Era, short', example: 'T.A.' },
    { id: 'EE', name: 'Era', example: 'Third Age' },
  ];
  var TOKEN = /\{(dd|do|d|W|Ms|M|mm|m|y|Y|EE|E)\}/g;
  var DAY_TOKENS = { d: 1, dd: 1, do: 1, W: 1 };
  var MONTH_TOKENS = { M: 1, Ms: 1, m: 1, mm: 1 };
  var ERA_TOKENS = { E: 1, EE: 1 };

  // The patterns offered (CA8); any other is made of the tokens.
  var FORMATS = [
    '{d} {M} {y} {E}',
    'the {do} of {M}, {y} {E}',
    '{M} {d}, {y} {E}',
    '{W}, {d} {M} {y} {E}',
    '{Y}-{mm}-{dd}',
  ];

  var GREGORIAN_MONTHS = [
    ['January', 'Jan', 31],
    ['February', 'Feb', 28],
    ['March', 'Mar', 31],
    ['April', 'Apr', 30],
    ['May', 'May', 31],
    ['June', 'Jun', 30],
    ['July', 'Jul', 31],
    ['August', 'Aug', 31],
    ['September', 'Sep', 30],
    ['October', 'Oct', 31],
    ['November', 'Nov', 30],
    ['December', 'Dec', 31],
  ];

  // The Gregorian calendar without leap days (CA2, CA7). With no leap days its
  // weekdays drift from the real ones by a day every four years; the first
  // weekday is set so that 2026's are right (1 January 2026 a Thursday).
  function gregorian() {
    return {
      months: GREGORIAN_MONTHS.map(function (m) {
        return { name: m[0], short: m[1], days: m[2], outsideWeek: false };
      }),
      weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      firstWeekday: 1,
      seasons: [
        { name: 'Spring', month: 3, day: 20 },
        { name: 'Summer', month: 6, day: 21 },
        { name: 'Autumn', month: 9, day: 22 },
        { name: 'Winter', month: 12, day: 21 },
      ],
      hoursPerDay: 24,
      minutesPerHour: 60,
      eras: [
        { name: 'Before the Common Era', short: 'BCE', start: 0, backward: true },
        { name: 'Common Era', short: 'CE', start: 1, backward: false },
      ],
      format: '{d} {M} {y} {E}',
    };
  }

  // A calendar with nothing in it yet: years only, a day of 24 hours (CA7).
  function blank() {
    return {
      months: [],
      weekdays: [],
      firstWeekday: 0,
      seasons: [],
      hoursPerDay: 24,
      minutesPerHour: 60,
      eras: [],
      format: '{d} {M} {y} {E}',
    };
  }

  // The calendar a project's dates are in: its own, or until it has one, the
  // Gregorian (without leap days).
  function of(project) {
    return project && isPlainObject(project.calendar) ? project.calendar : gregorian();
  }

  // ── Helpers ─────────────────────────────────────
  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function whole(value) {
    if (value === undefined || value === null || value === '') return undefined;
    var n = typeof value === 'number' ? value : Number(String(value).trim());
    return typeof value !== 'boolean' && isFinite(n) && Math.floor(n) === n ? n : NaN;
  }

  function mod(a, n) {
    return ((a % n) + n) % n;
  }

  function pad(n, width) {
    var s = String(Math.abs(n));
    while (s.length < width) s = '0' + s;
    return (n < 0 ? '-' : '') + s;
  }

  // Lower case, accents set aside, dots and spaces evened out: for matching
  // names in text.
  function fold(text) {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function ordinal(n) {
    var tens = Math.abs(n) % 100;
    var ones = Math.abs(n) % 10;
    if (tens >= 11 && tens <= 13) return n + 'th';
    return n + (ones === 1 ? 'st' : ones === 2 ? 'nd' : ones === 3 ? 'rd' : 'th');
  }

  // ── Checking a calendar ─────────────────────────
  function cleanName(raw, max, what) {
    var name = String(raw === undefined || raw === null ? '' : raw)
      .replace(/\s+/g, ' ')
      .trim();
    if (!name) return { error: what + ' needs a name.' };
    if (name.length > max) return { error: what + '’s name is at most ' + max + ' characters.' };
    if (!/\p{L}/u.test(name)) return { error: '“' + name + '” needs a letter in it.' };
    if (/[{}]/.test(name)) return { error: '“' + name + '” can’t have { or } in it.' };
    return { value: name };
  }

  function cleanShort(raw, what) {
    var short = String(raw === undefined || raw === null ? '' : raw)
      .replace(/\s+/g, ' ')
      .trim();
    if (short.length > LIMITS.short) {
      return { error: what + '’s short name is at most ' + LIMITS.short + ' characters.' };
    }
    if (short && !/\p{L}/u.test(short)) {
      return { error: '“' + short + '” needs a letter in it.' };
    }
    if (/[{}]/.test(short)) return { error: '“' + short + '” can’t have { or } in it.' };
    return { value: short };
  }

  function inRange(raw, lo, hi) {
    var n = whole(raw);
    return n !== undefined && !isNaN(n) && n >= lo && n <= hi ? n : null;
  }

  // Checks a pattern: at most 100 characters, a year in it, and no token we
  // don't know.
  function checkFormat(raw) {
    var format = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!format) return { error: 'The pattern can’t be empty.' };
    if (format.length > LIMITS.format) {
      return { error: 'The pattern is at most ' + LIMITS.format + ' characters.' };
    }
    var rest = format.replace(TOKEN, '');
    var stray = rest.match(/\{[^}]*\}?/);
    if (stray) return { error: 'The pattern has “' + stray[0] + '”, a token we don’t know.' };
    if (format.indexOf('{y}') === -1 && format.indexOf('{Y}') === -1) {
      return { error: 'The pattern needs the year: {y} or {Y}.' };
    }
    return { value: format };
  }

  // Checks a whole calendar; gives back { value } (cleaned) or { error }.
  function check(raw) {
    if (!isPlainObject(raw)) return { error: 'A calendar must be an object.' };
    var known = [
      'months',
      'weekdays',
      'firstWeekday',
      'seasons',
      'hoursPerDay',
      'minutesPerHour',
      'eras',
      'format',
    ];
    var extra = Object.keys(raw).filter(function (k) {
      return known.indexOf(k) === -1;
    });
    if (extra.length) return { error: 'A calendar has no “' + extra[0] + '”.' };
    var names = {}; // every month's, era's and weekday's names, folded
    function claim(name, what) {
      var key = fold(name);
      if (!key) return null;
      if (names[key]) return { error: '“' + name + '” names two things: ' + names[key] + '.' };
      names[key] = what;
      return null;
    }

    // Months (CA3).
    var months = raw.months === undefined || raw.months === null ? [] : raw.months;
    if (!Array.isArray(months)) return { error: 'The months must be a list.' };
    if (months.length > LIMITS.months) {
      return { error: 'A calendar has at most ' + LIMITS.months + ' months.' };
    }
    var outMonths = [];
    for (var i = 0; i < months.length; i++) {
      var m = months[i];
      if (!isPlainObject(m)) return { error: 'A month must be an object.' };
      var mName = cleanName(m.name, LIMITS.name, 'Month ' + (i + 1));
      if (mName.error) return mName;
      var mShort = cleanShort(m.short, mName.value);
      if (mShort.error) return mShort;
      var days = inRange(m.days, 1, LIMITS.monthDays);
      if (days === null) {
        return { error: mName.value + ' needs from 1 to ' + LIMITS.monthDays + ' days.' };
      }
      var clash =
        claim(mName.value, 'a month') ||
        (mShort.value && fold(mShort.value) !== fold(mName.value)
          ? claim(mShort.value, 'a month')
          : null);
      if (clash) return clash;
      outMonths.push({
        name: mName.value,
        short: mShort.value,
        days: days,
        outsideWeek: m.outsideWeek === true,
      });
    }

    // Weekdays (CA4).
    var weekdays = raw.weekdays === undefined || raw.weekdays === null ? [] : raw.weekdays;
    if (!Array.isArray(weekdays)) return { error: 'The weekdays must be a list.' };
    if (weekdays.length > LIMITS.weekdays) {
      return { error: 'A week has at most ' + LIMITS.weekdays + ' days.' };
    }
    var outWeekdays = [];
    for (var w = 0; w < weekdays.length; w++) {
      var wName = cleanName(weekdays[w], LIMITS.name, 'Weekday ' + (w + 1));
      if (wName.error) return wName;
      var wClash = claim(wName.value, 'a weekday');
      if (wClash) return wClash;
      outWeekdays.push(wName.value);
    }
    var firstWeekday = 0;
    if (outWeekdays.length) {
      firstWeekday = inRange(
        raw.firstWeekday === undefined ? 0 : raw.firstWeekday,
        0,
        outWeekdays.length - 1
      );
      if (firstWeekday === null) return { error: 'The first weekday must be one of the week’s.' };
    }

    // Seasons, each where it starts.
    var seasons = raw.seasons === undefined || raw.seasons === null ? [] : raw.seasons;
    if (!Array.isArray(seasons)) return { error: 'The seasons must be a list.' };
    if (seasons.length > LIMITS.seasons) {
      return { error: 'A calendar has at most ' + LIMITS.seasons + ' seasons.' };
    }
    var outSeasons = [];
    for (var s = 0; s < seasons.length; s++) {
      var se = seasons[s];
      if (!isPlainObject(se)) return { error: 'A season must be an object.' };
      var sName = cleanName(se.name, LIMITS.name, 'Season ' + (s + 1));
      if (sName.error) return sName;
      var sMonth = inRange(se.month, 1, outMonths.length);
      if (sMonth === null) return { error: sName.value + ' must start in one of the months.' };
      var sDay = inRange(se.day === undefined ? 1 : se.day, 1, outMonths[sMonth - 1].days);
      if (sDay === null) {
        return {
          error: sName.value + ' must start on a day of ' + outMonths[sMonth - 1].name + '.',
        };
      }
      outSeasons.push({ name: sName.value, month: sMonth, day: sDay });
    }
    outSeasons.sort(function (a, b) {
      return a.month - b.month || a.day - b.day;
    });

    // Hours and minutes (CA6).
    var hours = inRange(raw.hoursPerDay === undefined ? 24 : raw.hoursPerDay, 1, LIMITS.hours);
    if (hours === null) return { error: 'A day has from 1 to ' + LIMITS.hours + ' hours.' };
    var minutes = inRange(
      raw.minutesPerHour === undefined ? 60 : raw.minutesPerHour,
      1,
      LIMITS.minutes
    );
    if (minutes === null) {
      return { error: 'An hour has from 1 to ' + LIMITS.minutes + ' minutes.' };
    }

    // Eras (CA1).
    var eras = raw.eras === undefined || raw.eras === null ? [] : raw.eras;
    if (!Array.isArray(eras)) return { error: 'The eras must be a list.' };
    if (eras.length > LIMITS.eras) {
      return { error: 'A calendar has at most ' + LIMITS.eras + ' eras.' };
    }
    var outEras = [];
    for (var e = 0; e < eras.length; e++) {
      var er = eras[e];
      if (!isPlainObject(er)) return { error: 'An era must be an object.' };
      var eName = cleanName(er.name, LIMITS.eraName, 'Era ' + (e + 1));
      if (eName.error) return eName;
      var eShort = cleanShort(er.short, eName.value);
      if (eShort.error) return eShort;
      var start = inRange(er.start, -LIMITS.year, LIMITS.year);
      if (start === null) return { error: eName.value + ' needs a whole year to start at.' };
      var eClash =
        claim(eName.value, 'an era') ||
        (eShort.value && fold(eShort.value) !== fold(eName.value)
          ? claim(eShort.value, 'an era')
          : null);
      if (eClash) return eClash;
      outEras.push({
        name: eName.value,
        short: eShort.value,
        start: start,
        backward: er.backward === true,
      });
    }
    outEras.sort(function (a, b) {
      return a.start - b.start;
    });
    for (var k = 0; k < outEras.length; k++) {
      if (k > 0 && outEras[k].start === outEras[k - 1].start) {
        return { error: outEras[k - 1].name + ' and ' + outEras[k].name + ' start the same year.' };
      }
    }
    if (outEras.length && outEras[outEras.length - 1].backward) {
      return {
        error:
          outEras[outEras.length - 1].name +
          ' counts backward, so an era must follow it: it counts down to the year before the next one.',
      };
    }

    var format = checkFormat(raw.format === undefined ? '{d} {M} {y} {E}' : raw.format);
    if (format.error) return format;

    return {
      value: {
        months: outMonths,
        weekdays: outWeekdays,
        firstWeekday: firstWeekday,
        seasons: outSeasons,
        hoursPerDay: hours,
        minutesPerHour: minutes,
        eras: outEras,
        format: format.value,
      },
    };
  }

  // ── Arithmetic ──────────────────────────────────
  function monthsOf(cal) {
    return (cal && cal.months) || [];
  }

  function daysInMonth(cal, month) {
    var m = monthsOf(cal)[month - 1];
    return m ? m.days : 0;
  }

  // Every year the same (CA2).
  function daysInYear(cal) {
    return monthsOf(cal).reduce(function (sum, m) {
      return sum + m.days;
    }, 0);
  }

  // Days before a month in its year, counting only those in the week when
  // `inWeek` is set.
  function daysBefore(cal, month, inWeek) {
    var sum = 0;
    var months = monthsOf(cal);
    for (var i = 0; i < month - 1 && i < months.length; i++) {
      if (!inWeek || !months[i].outsideWeek) sum += months[i].days;
    }
    return sum;
  }

  // The day of its year, from 1 (a date without a day: its first).
  function dayOfYear(cal, date) {
    return daysBefore(cal, date.month || 1) + (date.day || 1);
  }

  // A date's day count from the first day of year 1 (0), so dates compare: a
  // date without a day or a month counts from its first. Null in a calendar
  // with no months, where a date is a year.
  function dayCount(cal, date) {
    var perYear = daysInYear(cal);
    if (!perYear) return null;
    return (date.year - 1) * perYear + dayOfYear(cal, date) - 1;
  }

  // Its weekday (CA4): { index, name }, running on across months and years
  // and skipping the days outside the week; null without a day, in a calendar
  // with no week, or on a day outside it.
  function weekday(cal, date) {
    var names = (cal && cal.weekdays) || [];
    if (!names.length || !date || date.day === undefined || date.month === undefined) return null;
    var month = monthsOf(cal)[date.month - 1];
    if (!month || month.outsideWeek) return null;
    var perYear = monthsOf(cal).reduce(function (sum, m) {
      return sum + (m.outsideWeek ? 0 : m.days);
    }, 0);
    var count = (date.year - 1) * perYear + daysBefore(cal, date.month, true) + date.day - 1;
    var index = mod((cal.firstWeekday || 0) + count, names.length);
    return { index: index, name: names[index] };
  }

  // Its season: { index, name }, the last to start on or before its day,
  // else the year's last (it began the year before); null without a day.
  function season(cal, date) {
    var seasons = (cal && cal.seasons) || [];
    if (!seasons.length || !date || date.day === undefined) return null;
    var today = dayOfYear(cal, date);
    var found = -1;
    var last = -1;
    seasons.forEach(function (s, i) {
      var starts = dayOfYear(cal, s);
      if (last === -1 || starts >= dayOfYear(cal, seasons[last])) last = i;
      if (starts <= today && (found === -1 || starts >= dayOfYear(cal, seasons[found]))) {
        found = i;
      }
    });
    var index = found === -1 ? last : found;
    return { index: index, name: seasons[index].name };
  }

  // The era a running year falls in, and its year in that era (CA1):
  // { index, era, year }; null in a calendar without eras.
  function eraOf(cal, year) {
    var eras = (cal && cal.eras) || [];
    if (!eras.length) return null;
    var index = 0;
    for (var i = 1; i < eras.length; i++) {
      if (year >= eras[i].start) index = i;
    }
    var era = eras[index];
    var next = eras[index + 1];
    var eraYear = era.backward && next ? next.start - year : year - era.start + 1;
    return { index: index, era: era, year: eraYear };
  }

  // The running year of a year in an era (the era's place in `eras`).
  function runningYear(cal, index, eraYear) {
    var eras = (cal && cal.eras) || [];
    var era = eras[index];
    if (!era) return eraYear;
    var next = eras[index + 1];
    return era.backward && next ? next.start - eraYear : era.start + eraYear - 1;
  }

  // Orders two dates: by year, then month, day, hour and minute, a date
  // without one of them coming first (it starts there). The calendar isn't
  // needed: every date stores the running year.
  function compare(a, b) {
    var parts = ['year', 'month', 'day', 'hour', 'minute'];
    for (var i = 0; i < parts.length; i++) {
      var x = a[parts[i]] === undefined ? -Infinity : a[parts[i]];
      var y = b[parts[i]] === undefined ? -Infinity : b[parts[i]];
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  // ── Dates ───────────────────────────────────────
  // A date's shape (D12), whatever the calendar: whole numbers, each part
  // needing the one above it. Gives back { value } (cleaned; null when it is
  // empty) or { error }.
  function checkShape(raw, label) {
    label = label || 'The date';
    if (!isPlainObject(raw)) return { error: label + ' must be a date.' };
    var year = whole(raw.year);
    var month = whole(raw.month);
    var day = whole(raw.day);
    var hour = whole(raw.hour);
    var minute = whole(raw.minute);
    var none = [year, month, day, hour, minute].every(function (v) {
      return v === undefined;
    });
    if (none) return { value: null };
    if (year === undefined || isNaN(year) || Math.abs(year) > LIMITS.year) {
      return { error: label + ' needs a whole year.' };
    }
    var out = { year: year };
    if (month !== undefined) {
      if (isNaN(month) || month < 1 || month > LIMITS.months) {
        return { error: label + ': the month is a whole number from 1.' };
      }
      out.month = month;
    }
    if (day !== undefined) {
      if (out.month === undefined) return { error: label + ': a day needs its month.' };
      if (isNaN(day) || day < 1 || day > LIMITS.monthDays) {
        return { error: label + ': the day is a whole number from 1.' };
      }
      out.day = day;
    }
    if (hour !== undefined) {
      if (out.day === undefined) return { error: label + ': a time needs its day.' };
      if (isNaN(hour) || hour < 0 || hour >= LIMITS.hours) {
        return { error: label + ': the hour is a whole number from 0.' };
      }
      out.hour = hour;
    }
    if (minute !== undefined) {
      if (out.hour === undefined) return { error: label + ': a minute needs its hour.' };
      if (isNaN(minute) || minute < 0 || minute >= LIMITS.minutes) {
        return { error: label + ': the minute is a whole number from 0.' };
      }
      out.minute = minute;
    }
    if (raw.circa === true) out.circa = true;
    return { value: out };
  }

  // Why a date doesn't fit the calendar (CA9), or null when it does: its
  // numbers are kept when the calendar changes, so one may come to name a
  // month or a day the calendar no longer has.
  function misfit(cal, date) {
    if (!isPlainObject(date)) return 'It isn’t a date.';
    var months = monthsOf(cal);
    if (date.month !== undefined) {
      if (!months.length) return 'This calendar has no months.';
      if (date.month > months.length) {
        return 'This calendar has ' + months.length + ' months, not ' + date.month + '.';
      }
      var m = months[date.month - 1];
      if (date.day !== undefined && date.day > m.days) {
        return (
          m.name + ' has ' + m.days + (m.days === 1 ? ' day' : ' days') + ', not ' + date.day + '.'
        );
      }
    }
    if (date.hour !== undefined && date.hour >= (cal.hoursPerDay || 24)) {
      return 'A day has ' + (cal.hoursPerDay || 24) + ' hours, from 0.';
    }
    if (date.minute !== undefined && date.minute >= (cal.minutesPerHour || 60)) {
      return 'An hour has ' + (cal.minutesPerHour || 60) + ' minutes, from 0.';
    }
    return null;
  }

  function fits(cal, date) {
    return misfit(cal, date) === null;
  }

  // ── Writing ─────────────────────────────────────
  // A pattern as its parts: literal text and tokens in turn,
  // [text, token, text, token, …, text].
  function partsOf(format) {
    var parts = [];
    var last = 0;
    String(format).replace(TOKEN, function (whole, id, at) {
      parts.push(format.slice(last, at));
      parts.push({ token: id });
      last = at + whole.length;
      return whole;
    });
    parts.push(String(format).slice(last));
    return parts;
  }

  // The parts with the tokens a date lacks taken out, each with the text
  // that joins it to the rest: the text before it, or for the first token the
  // text around it, and for the last the text after it too.
  function dropMissing(parts, missing) {
    var out = parts.slice();
    for (var i = 1; i < out.length; i += 2) {
      if (!missing(out[i].token)) continue;
      var first = i === 1;
      var lastToken = i === out.length - 2;
      if (first) {
        out.splice(0, 3, '');
      } else if (lastToken) {
        out.splice(i - 1, 3, '');
      } else {
        out.splice(i - 1, 2);
      }
      i -= 2;
    }
    return out;
  }

  // A date written by the calendar's pattern (CA8), at its precision, with
  // its time after a comma and "c." before when it is approximate (EV7).
  // `format` may stand in for the calendar's (the page's live example).
  function write(cal, date, format) {
    if (!isPlainObject(date) || typeof date.year !== 'number') return '';
    var months = monthsOf(cal);
    var month = date.month !== undefined ? months[date.month - 1] : null;
    var era = eraOf(cal, date.year);
    var day = weekday(cal, date);
    var parts = dropMissing(partsOf(format || cal.format || FORMATS[0]), function (token) {
      if (DAY_TOKENS[token] && date.day === undefined) return true;
      if (token === 'W' && !day) return true;
      if (MONTH_TOKENS[token] && date.month === undefined) return true;
      if (ERA_TOKENS[token] && !era) return true;
      return false;
    });
    var text = parts
      .map(function (part) {
        if (typeof part === 'string') return part;
        switch (part.token) {
          case 'd':
            return String(date.day);
          case 'dd':
            return pad(date.day, 2);
          case 'do':
            return ordinal(date.day);
          case 'W':
            return day.name;
          case 'M':
            return month ? month.name : 'Month ' + date.month;
          case 'Ms':
            return month ? month.short || month.name : 'Month ' + date.month;
          case 'm':
            return String(date.month);
          case 'mm':
            return pad(date.month, 2);
          case 'y':
            return String(era ? era.year : date.year);
          case 'Y':
            return String(date.year);
          case 'E':
            return era.era.short || era.era.name;
          case 'EE':
            return era.era.name;
          default:
            return '';
        }
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (date.hour !== undefined) {
      var hourWidth = String((cal.hoursPerDay || 24) - 1).length;
      text +=
        ', ' +
        (date.minute !== undefined
          ? pad(date.hour, hourWidth) +
            ':' +
            pad(date.minute, String((cal.minutesPerHour || 60) - 1).length)
          : pad(date.hour, hourWidth) + 'h');
    }
    return (date.circa ? 'c. ' : '') + text;
  }

  // A range: "from – to", or "from – ongoing" while it goes on.
  function writeRange(cal, range) {
    if (!isPlainObject(range) || !range.from) return '';
    var from = write(cal, range.from);
    if (range.to === null || range.to === undefined) return from + ' – ongoing';
    return from + ' – ' + write(cal, range.to);
  }

  // ── Reading ─────────────────────────────────────
  function escape(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Finds the longest of `names` (each [folded text, what it stands for]) in
  // `text` as words of their own; gives back { what, text (with it taken
  // out) } or null.
  function findName(text, names) {
    var best = null;
    names.forEach(function (n) {
      if (!n[0]) return;
      var re = new RegExp('(^|[^\\p{L}\\p{N}])' + escape(n[0]) + '(?=$|[^\\p{L}\\p{N}])', 'u');
      var match = re.exec(text);
      if (match && (!best || n[0].length > best.length)) {
        best = {
          length: n[0].length,
          what: n[1],
          at: match.index + match[1].length,
        };
      }
    });
    if (!best) return null;
    return {
      what: best.what,
      text: text.slice(0, best.at) + ' ' + text.slice(best.at + best.length),
    };
  }

  // Reads a date from text in the project's form ("3 Hammer 1492 T.A.",
  // "the 3rd of Hammer, 1492", "1492-03-03"), at any precision, with a time
  // ("14:05", or "14h" for the hour) and "c." or "circa". The numbers are
  // taken in the order the calendar's pattern puts them; a year with no era
  // named is in the last era, unless the pattern writes the running year.
  // Gives back { value } or { error }; an empty text is { value: null }.
  function read(cal, text) {
    var source = String(text === undefined || text === null ? '' : text).trim();
    if (!source) return { value: null };
    var t = ' ' + fold(source) + ' ';
    var out = {};

    var circa = /^\s*(c\.|ca\.|c|ca|circa|about)\s+/.exec(t);
    if (circa) {
      out.circa = true;
      t = ' ' + t.slice(circa[0].length);
    }

    var time = /[,\s]\s*(\d{1,3})\s*(?::\s*(\d{1,3})|h)\s*$/.exec(t);
    if (time) {
      out.hour = Number(time[1]);
      if (time[2] !== undefined) out.minute = Number(time[2]);
      t = t.slice(0, time.index) + ' ';
    }

    var eras = (cal && cal.eras) || [];
    var eraIndex = null;
    var foundEra = findName(
      t,
      eras
        .map(function (e, i) {
          return [fold(e.name), i];
        })
        .concat(
          eras.map(function (e, i) {
            return [fold(e.short), i];
          })
        )
    );
    if (foundEra) {
      eraIndex = foundEra.what;
      t = foundEra.text;
    }

    var months = monthsOf(cal);
    var foundMonth = findName(
      t,
      months
        .map(function (m, i) {
          return [fold(m.name), i + 1];
        })
        .concat(
          months.map(function (m, i) {
            return [fold(m.short), i + 1];
          })
        )
    );
    var monthByName = null;
    if (foundMonth) {
      monthByName = foundMonth.what;
      t = foundMonth.text;
    }

    // A weekday says nothing a date doesn't: it is read past.
    var names = ((cal && cal.weekdays) || []).map(function (w) {
      return [fold(w), true];
    });
    for (var guard = 0; guard < 3; guard++) {
      var foundDay = findName(t, names);
      if (!foundDay) break;
      t = foundDay.text;
    }

    // The numbers, a minus sign counting only before one standing alone
    // (so "1492-03-03" is three).
    var numbers = [];
    t = t.replace(/(^|[\s(])-(\d)/g, '$1~$2');
    t = t.replace(/~?\d+(?:st|nd|rd|th)?/g, function (found) {
      var negative = found.charAt(0) === '~';
      var n = Number(found.replace(/^~/, '').replace(/(st|nd|rd|th)$/, ''));
      numbers.push(negative ? -n : n);
      return ' ';
    });
    var words = t
      .replace(/[^\p{L}\s]/gu, ' ')
      .split(/\s+/)
      .filter(function (w) {
        return w && ['the', 'of', 'in', 'on', 'year', 'day', 'month', 'and'].indexOf(w) === -1;
      });
    if (words.length) {
      return { error: '“' + words[0] + '” is not a month or an era of this calendar.' };
    }
    if (!numbers.length) return { error: 'A date needs a year.' };

    // The order the pattern puts the numbers in: a month named in the
    // pattern may come as a number where its name would be.
    var order = [];
    partsOf((cal && cal.format) || FORMATS[0]).forEach(function (part) {
      if (typeof part === 'string') return;
      var id = part.token;
      var kind = id === 'W' ? null : DAY_TOKENS[id] ? 'd' : MONTH_TOKENS[id] ? 'm' : id;
      if (['d', 'm', 'y', 'Y'].indexOf(kind) !== -1 && order.indexOf(kind) === -1) {
        order.push(kind);
      }
    });
    if (order.indexOf('y') !== -1 && order.indexOf('Y') !== -1) {
      order.splice(order.indexOf('y'), 1);
    }
    if (monthByName !== null && order.indexOf('m') !== -1) order.splice(order.indexOf('m'), 1);
    // Fewer numbers: a date without its day, then without its month.
    ['d', 'm'].forEach(function (drop) {
      if (numbers.length < order.length && order.indexOf(drop) !== -1) {
        order.splice(order.indexOf(drop), 1);
      }
    });
    if (numbers.length !== order.length) {
      return {
        error:
          'That has ' +
          (numbers.length > order.length ? 'more' : 'fewer') +
          ' numbers than a date here: write it like “' +
          write(cal, example(cal)) +
          '”.',
      };
    }
    var got = {};
    order.forEach(function (kind, i) {
      got[kind] = numbers[i];
    });
    var yearNumber = got.y !== undefined ? got.y : got.Y;
    var running;
    if (eraIndex !== null) running = runningYear(cal, eraIndex, yearNumber);
    else if (got.Y !== undefined || !eras.length) running = yearNumber;
    else running = runningYear(cal, eras.length - 1, yearNumber);
    out.year = running;
    if (monthByName !== null) out.month = monthByName;
    else if (got.m !== undefined) out.month = got.m;
    if (got.d !== undefined) {
      if (out.month === undefined) return { error: 'A day needs its month.' };
      out.day = got.d;
    }
    if (out.hour !== undefined && out.day === undefined) {
      return { error: 'A time needs its day.' };
    }
    return checked(cal, out);
  }

  // A date in the calendar to show how one is written: the third day of its
  // third month (or its last), year 1492 of its last era.
  function example(cal) {
    var months = monthsOf(cal);
    var eras = (cal && cal.eras) || [];
    var date = { year: eras.length ? runningYear(cal, eras.length - 1, 1492) : 1492 };
    if (months.length) {
      date.month = Math.min(3, months.length);
      date.day = Math.min(3, months[date.month - 1].days);
    }
    return date;
  }

  // A date's shape checked, and that it fits the calendar.
  function checked(cal, raw) {
    var shape = checkShape(raw);
    if (shape.error || shape.value === null) return shape;
    var why = misfit(cal, shape.value);
    if (why) return { error: why };
    return shape;
  }

  // Reads a date from numbers, { year, month?, day?, hour?, minute?, circa? },
  // `year` the running year; or, naming an era (by name, short name or place
  // from 1) as `era`, `year` that era's year.
  function fromNumbers(cal, raw) {
    if (!isPlainObject(raw)) return { error: 'A date must be text or numbers.' };
    var input = {};
    Object.keys(raw).forEach(function (k) {
      if (k !== 'era') input[k] = raw[k];
    });
    if (raw.era !== undefined && raw.era !== null && raw.era !== '') {
      var eras = (cal && cal.eras) || [];
      var index = -1;
      if (typeof raw.era === 'number') index = raw.era - 1;
      else {
        var key = fold(raw.era);
        index = eras.findIndex(function (e) {
          return fold(e.name) === key || (e.short && fold(e.short) === key);
        });
      }
      if (!eras[index]) return { error: 'This calendar has no era “' + raw.era + '”.' };
      var eraYear = whole(raw.year);
      if (eraYear === undefined || isNaN(eraYear)) return { error: 'The date needs a whole year.' };
      input.year = runningYear(cal, index, eraYear);
    }
    return checked(cal, input);
  }

  // A date from either: text in the project's form, or numbers.
  function parse(cal, raw) {
    if (raw === undefined || raw === null) return { value: null };
    if (typeof raw === 'string') return read(cal, raw);
    if (typeof raw === 'number') return checked(cal, { year: raw });
    return fromNumbers(cal, raw);
  }

  // A range from text ("1190 – 1210", "1190 to 1210", "1190 – ongoing") or
  // { from, to }, `to` null for one still going (only when `open` allows).
  function parseRange(cal, raw, open) {
    var from;
    var to;
    if (typeof raw === 'string') {
      var halves = raw.split(/\s+(?:–|—|-|to|until)\s+/);
      if (halves.length > 2) return { error: 'A range is two dates.' };
      from = halves[0];
      to = halves.length === 2 ? halves[1] : undefined;
      if (to !== undefined && /^(ongoing|now|still going|…|\.\.\.)$/i.test(to.trim())) to = null;
    } else if (isPlainObject(raw)) {
      from = raw.from;
      to = raw.to;
    } else {
      return { error: 'A range must be text or { from, to }.' };
    }
    var a = parse(cal, from);
    if (a.error) return a;
    if (a.value === null) return { error: 'A range needs its first date.' };
    if (to === null || to === undefined) {
      if (!open) return { error: 'This range needs its last date.' };
      return { value: { from: a.value, to: null } };
    }
    var b = parse(cal, to);
    if (b.error) return b;
    if (b.value === null) return { value: { from: a.value, to: null } };
    if (compare(a.value, b.value) > 0) return { error: 'A range can’t end before it starts.' };
    return { value: { from: a.value, to: b.value } };
  }

  // The dates on elements that don't fit the calendar (CA9), for its page and
  // get_calendar to list: `defs` the project's fields by type, `elements`
  // each { id, type, name, fields }. Gives back [{ id, type, name, key,
  // label, value, text, why }], by name.
  function misfits(cal, defs, elements) {
    var out = [];
    (elements || []).forEach(function (el) {
      ((defs && defs[el.type]) || []).forEach(function (def) {
        var value = el.fields ? el.fields[def.key] : undefined;
        if (def.kind !== 'date' || !isPlainObject(value)) return;
        var why = misfit(cal, value);
        if (!why) return;
        out.push({
          id: el.id,
          type: el.type,
          name: el.name,
          key: def.key,
          label: def.label,
          value: value,
          text: write(cal, value),
          why: why,
        });
      });
    });
    return out.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name)) || a.label.localeCompare(b.label);
    });
  }

  var api = {
    LIMITS: LIMITS,
    TOKENS: TOKENS,
    FORMATS: FORMATS,
    gregorian: gregorian,
    blank: blank,
    of: of,
    check: check,
    checkFormat: checkFormat,
    daysInYear: daysInYear,
    daysInMonth: daysInMonth,
    dayOfYear: dayOfYear,
    dayCount: dayCount,
    weekday: weekday,
    season: season,
    eraOf: eraOf,
    runningYear: runningYear,
    compare: compare,
    checkShape: checkShape,
    misfit: misfit,
    fits: fits,
    ordinal: ordinal,
    example: example,
    write: write,
    writeRange: writeRange,
    read: read,
    fromNumbers: fromNumbers,
    parse: parse,
    parseRange: parseRange,
    misfits: misfits,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.calendar = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
