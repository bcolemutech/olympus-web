(function () {
  'use strict';

  // A date picked in the project's calendar (planning/the-muse.md §3 CA6–CA9,
  // EV7; M-301 / #922): the era, the year in it, the month, the day, an
  // optional hour and minute, and "circa". It gives back the date's numbers,
  // the running year worked out from the era (CA1), and shows the date as the
  // calendar writes it as it is picked, flagged when it doesn't fit (CA9).
  // Used by date fields now, and by events and relationships in M-302.

  var Muse = window.Muse;
  var CAL = Muse.calendar;

  function box(className, label, part) {
    var input = Muse.el('input', 'muse-input ' + className);
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', label);
    input.dataset.part = part;
    return input;
  }

  function option(select, value, text) {
    var o = Muse.el('option', '', text);
    o.value = value;
    select.appendChild(o);
    return o;
  }

  // Makes a picker: `opts.label` names it, `opts.value` is the date it
  // starts at (or null), `opts.calendar` the project's. Gives back { node,
  // read }, `read()` the picked date's numbers, or null when none is picked.
  function make(opts) {
    var cal = opts.calendar || CAL.gregorian();
    var value = opts.value && typeof opts.value === 'object' ? opts.value : null;
    var label = opts.label;
    var months = cal.months || [];
    var eras = cal.eras || [];

    var node = Muse.el('div', 'muse-date-picker');
    node.setAttribute('role', 'group');
    node.setAttribute('aria-label', label);
    var row = Muse.el('div', 'muse-inline muse-date');
    node.appendChild(row);

    // The era, and the year in it; without eras, the running year.
    var era = null;
    if (eras.length) {
      era = Muse.el('select', 'muse-input muse-select muse-date-era');
      era.setAttribute('aria-label', label + ': era');
      era.dataset.part = 'era';
      eras.forEach(function (e, i) {
        option(era, String(i), e.short ? e.short + ' — ' + e.name : e.name);
      });
    }
    var year = box('muse-date-year', label + ': year', 'year');
    year.placeholder = 'Year';
    row.appendChild(year);
    if (era) row.appendChild(era);

    var month = Muse.el('select', 'muse-input muse-select muse-date-month');
    month.setAttribute('aria-label', label + ': month');
    month.dataset.part = 'month';
    option(month, '', '— Month —');
    months.forEach(function (m, i) {
      option(month, String(i + 1), m.name);
    });
    if (value && value.month > months.length) {
      option(month, String(value.month), 'Month ' + value.month + ' (not in the calendar)');
    }
    var day = box('muse-date-day', label + ': day', 'day');
    day.placeholder = 'Day';
    if (months.length) {
      row.appendChild(month);
      row.appendChild(day);
    }

    var time = Muse.el('div', 'muse-inline muse-date-time');
    var hour = box('muse-date-hour', label + ': hour', 'hour');
    hour.placeholder = 'hh';
    var minute = box('muse-date-minute', label + ': minute', 'minute');
    minute.placeholder = 'mm';
    var circaLabel = Muse.el('label', 'muse-check');
    var circa = Muse.el('input');
    circa.type = 'checkbox';
    circa.dataset.part = 'circa';
    circaLabel.appendChild(circa);
    circaLabel.appendChild(document.createTextNode(' Circa'));
    if (months.length) {
      time.appendChild(Muse.el('span', 'muse-hint', 'At'));
      time.appendChild(hour);
      time.appendChild(Muse.el('span', 'muse-hint', ':'));
      time.appendChild(minute);
    }
    time.appendChild(circaLabel);
    node.appendChild(time);

    var shown = Muse.el('p', 'muse-hint muse-date-shown');
    shown.setAttribute('aria-live', 'polite');
    node.appendChild(shown);

    // Its starting value.
    if (value && typeof value.year === 'number') {
      var at = CAL.eraOf(cal, value.year);
      year.value = String(at ? at.year : value.year);
      if (era && at) era.value = String(at.index);
      month.value = value.month !== undefined ? String(value.month) : '';
      day.value = value.day !== undefined ? String(value.day) : '';
      hour.value = value.hour !== undefined ? String(value.hour) : '';
      minute.value = value.minute !== undefined ? String(value.minute) : '';
      circa.checked = value.circa === true;
    } else if (era) {
      era.value = String(eras.length - 1);
    }

    function text(input) {
      return input.value.trim();
    }

    // The numbers picked, in a date's order; null when there are none. A
    // year that isn't a whole number is passed on as typed, to be refused.
    function read() {
      var raw = {};
      var y = text(year);
      if (!y && !text(day) && !month.value && !text(hour) && !text(minute)) return null;
      if (y) {
        var n = Number(y);
        var whole = isFinite(n) && Math.floor(n) === n;
        raw.year = !whole ? y : era ? CAL.runningYear(cal, Number(era.value), n) : n;
      }
      if (month.value) raw.month = Number(month.value);
      if (text(day)) raw.day = text(day);
      if (text(hour)) raw.hour = text(hour);
      if (text(minute)) raw.minute = text(minute);
      if (circa.checked) raw.circa = true;
      ['day', 'hour', 'minute'].forEach(function (part) {
        var v = Number(raw[part]);
        if (raw[part] !== undefined && isFinite(v) && Math.floor(v) === v) raw[part] = v;
      });
      return raw;
    }

    // Shows it as the calendar writes it, or why it can't be.
    function update() {
      var raw = read();
      if (!raw) {
        shown.textContent = '';
        shown.classList.remove('muse-misfit');
        return;
      }
      var shape = CAL.checkShape(raw, 'The date');
      var why = shape.error || (shape.value && CAL.misfit(cal, shape.value));
      shown.classList.toggle('muse-misfit', !!why);
      shown.textContent = why
        ? '⚠ ' + why
        : shape.value
          ? 'Shows as “' + CAL.write(cal, shape.value) + '”'
          : '';
    }
    node.addEventListener('input', update);
    node.addEventListener('change', update);
    update();

    return { node: node, read: read };
  }

  // A date to show where it is read: as the calendar writes it, flagged
  // (CA9) when it no longer fits.
  function shown(cal, value) {
    var span = Muse.el('span', 'muse-date-text', CAL.write(cal, value));
    var why = CAL.misfit(cal, value);
    if (why) {
      span.classList.add('muse-misfit');
      var flag = Muse.el('span', 'muse-misfit-flag', ' ⚠ Doesn’t fit the calendar');
      flag.title = why;
      span.appendChild(flag);
      span.dataset.misfit = why;
    }
    return span;
  }

  Muse.datePicker = { make: make, shown: shown };
})();
