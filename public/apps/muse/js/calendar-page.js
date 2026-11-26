(function () {
  'use strict';

  // A project's calendar, on a page of its own (planning/the-muse.md §3 TL1,
  // CA1–CA9; M-301 / #922): its months (festival days, and those outside the
  // week), weekdays and the first of them, seasons, hours and minutes, eras,
  // and the pattern dates are written by, with a live example. Changes are a
  // draft until saved; "Start again from" puts the Gregorian (no leap days) or
  // a blank one in the draft. Dates keep their numbers when it changes, and
  // those that no longer fit are listed here to fix (CA9). The arithmetic is
  // ./calendar.js's; the project's versions (M-105) cover it, as they cover
  // its fields.

  var Muse = window.Muse;
  var state = Muse.state;
  var CAL = Muse.calendar;
  var draft = null;
  var good = null; // the draft as last checked, for the examples
  var dirty = false;

  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  function changed(redraw) {
    dirty = true;
    Muse.$('muse-cal-save').disabled = false;
    Muse.$('muse-cal-reset').disabled = false;
    Muse.say(Muse.$('muse-cal-done'), '');
    if (redraw) draw();
    else drawLive();
  }

  // ── Controls ────────────────────────────────────
  function text(value, label, onInput, className) {
    var input = Muse.el('input', 'muse-input' + (className ? ' ' + className : ''));
    input.value = value === undefined || value === null ? '' : String(value);
    input.autocomplete = 'off';
    input.setAttribute('aria-label', label);
    if (className === 'muse-cal-short') input.placeholder = 'Short name';
    input.addEventListener('input', function () {
      onInput(input.value);
      changed(false);
    });
    return input;
  }

  // A number typed: as a number when it is one, else as typed (the check
  // then says what is wrong).
  function number(value, label, onInput) {
    var input = text(
      value,
      label,
      function (raw) {
        var n = Number(raw.trim());
        onInput(raw.trim() !== '' && isFinite(n) ? n : raw);
      },
      'muse-cal-num'
    );
    input.inputMode = 'numeric';
    return input;
  }

  function check(label, on, onChange) {
    var wrap = Muse.el('label', 'muse-check');
    var box = Muse.el('input');
    box.type = 'checkbox';
    box.checked = !!on;
    box.addEventListener('change', function () {
      onChange(box.checked);
      changed(true);
    });
    wrap.appendChild(box);
    wrap.appendChild(document.createTextNode(' ' + label));
    return wrap;
  }

  function button(textOf, label, onClick) {
    var b = Muse.el('button', 'muse-btn muse-btn-quiet muse-btn-small', textOf);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', onClick);
    return b;
  }

  // ↑, ↓ and Remove for row `i` of `list`.
  function moves(row, list, i, name) {
    var up = button('↑', 'Move ' + name + ' up', function () {
      list.splice(i - 1, 0, list.splice(i, 1)[0]);
      changed(true);
    });
    up.disabled = i === 0;
    var down = button('↓', 'Move ' + name + ' down', function () {
      list.splice(i + 1, 0, list.splice(i, 1)[0]);
      changed(true);
    });
    down.disabled = i === list.length - 1;
    row.appendChild(up);
    row.appendChild(down);
    row.appendChild(remove(list, i, name));
  }

  function remove(list, i, name) {
    var b = button('Remove', 'Remove ' + name, function () {
      list.splice(i, 1);
      changed(true);
    });
    b.classList.add('muse-cal-remove');
    return b;
  }

  function rowOf(box) {
    var row = Muse.el('div', 'muse-inline muse-cal-row');
    box.appendChild(row);
    return row;
  }

  // ── The parts ───────────────────────────────────
  function drawMonths() {
    var box = Muse.$('muse-cal-months');
    box.textContent = '';
    draft.months.forEach(function (m, i, all) {
      var row = rowOf(box);
      row.dataset.month = String(i + 1);
      var name = m.name || 'month ' + (i + 1);
      row.appendChild(Muse.el('span', 'muse-cal-n', String(i + 1)));
      row.appendChild(
        text(m.name, 'Month ' + (i + 1) + ': name', function (v) {
          m.name = v;
        })
      );
      row.appendChild(
        text(
          m.short,
          'Month ' + (i + 1) + ': short name',
          function (v) {
            m.short = v;
          },
          'muse-cal-short'
        )
      );
      var days = number(m.days, 'Month ' + (i + 1) + ': days', function (v) {
        m.days = v;
      });
      days.classList.add('muse-cal-days');
      row.appendChild(days);
      row.appendChild(Muse.el('span', 'muse-hint', 'days'));
      row.appendChild(
        check('Outside the week', m.outsideWeek, function (on) {
          m.outsideWeek = on;
        })
      );
      moves(row, all, i, name);
    });
  }

  function drawWeekdays() {
    var box = Muse.$('muse-cal-weekdays');
    box.textContent = '';
    draft.weekdays.forEach(function (w, i, all) {
      var row = rowOf(box);
      row.appendChild(
        text(w, 'Weekday ' + (i + 1), function (v) {
          all[i] = v;
          drawFirst();
        })
      );
      moves(row, all, i, w || 'weekday ' + (i + 1));
    });
    drawFirst();
  }

  function drawFirst() {
    var select = Muse.$('muse-cal-first');
    select.textContent = '';
    draft.weekdays.forEach(function (w, i) {
      var o = Muse.el('option', '', w || 'Weekday ' + (i + 1));
      o.value = String(i);
      select.appendChild(o);
    });
    if (draft.firstWeekday >= draft.weekdays.length) draft.firstWeekday = 0;
    select.value = String(draft.firstWeekday || 0);
    Muse.show(Muse.$('muse-cal-first-box'), draft.weekdays.length > 0);
  }

  function drawSeasons() {
    var box = Muse.$('muse-cal-seasons');
    box.textContent = '';
    draft.seasons.forEach(function (s, i, all) {
      var row = rowOf(box);
      var name = s.name || 'season ' + (i + 1);
      row.appendChild(
        text(s.name, 'Season ' + (i + 1) + ': name', function (v) {
          s.name = v;
        })
      );
      row.appendChild(Muse.el('span', 'muse-hint', 'from'));
      var day = number(s.day, 'Season ' + (i + 1) + ': day it starts', function (v) {
        s.day = v;
      });
      row.appendChild(day);
      var month = Muse.el('select', 'muse-input muse-select');
      month.setAttribute('aria-label', 'Season ' + (i + 1) + ': month it starts');
      draft.months.forEach(function (m, k) {
        var o = Muse.el('option', '', m.name || 'Month ' + (k + 1));
        o.value = String(k + 1);
        month.appendChild(o);
      });
      month.value = String(s.month);
      month.addEventListener('change', function () {
        s.month = Number(month.value);
        changed(false);
      });
      row.appendChild(month);
      row.appendChild(remove(all, i, name));
    });
    Muse.$('muse-cal-season-add').disabled = !draft.months.length;
  }

  function drawEras() {
    var box = Muse.$('muse-cal-eras');
    box.textContent = '';
    draft.eras.forEach(function (e, i, all) {
      var row = rowOf(box);
      var name = e.name || 'era ' + (i + 1);
      row.appendChild(
        text(e.name, 'Era ' + (i + 1) + ': name', function (v) {
          e.name = v;
        })
      );
      row.appendChild(
        text(
          e.short,
          'Era ' + (i + 1) + ': short name',
          function (v) {
            e.short = v;
          },
          'muse-cal-short'
        )
      );
      row.appendChild(Muse.el('span', 'muse-hint', 'from year'));
      row.appendChild(
        number(e.start, 'Era ' + (i + 1) + ': the running year it starts', function (v) {
          e.start = v;
        })
      );
      row.appendChild(
        check('Counts backward', e.backward, function (on) {
          e.backward = on;
        })
      );
      row.appendChild(remove(all, i, name));
    });
  }

  function drawTime() {
    Muse.$('muse-cal-hours').value = String(draft.hoursPerDay);
    Muse.$('muse-cal-minutes').value = String(draft.minutesPerHour);
  }

  // The pattern: one of those offered, each shown as it writes, or one's own.
  function drawFormat() {
    var select = Muse.$('muse-cal-format-pick');
    select.textContent = '';
    var cal = good || CAL.gregorian();
    var date = CAL.example(cal);
    CAL.FORMATS.forEach(function (f) {
      var o = Muse.el('option', '', CAL.write(cal, date, f));
      o.value = f;
      select.appendChild(o);
    });
    var own = Muse.el('option', '', 'A pattern of your own');
    own.value = '';
    select.appendChild(own);
    select.value = CAL.FORMATS.indexOf(draft.format) === -1 ? '' : draft.format;
    var input = Muse.$('muse-cal-format');
    if (input.value !== draft.format) input.value = draft.format;
  }

  // What follows from the draft as it is typed: the example, the year's
  // length and whether it would save.
  function drawLive() {
    var checked = CAL.check(draft);
    if (!checked.error) good = checked.value;
    var cal = good || CAL.gregorian();
    var date = CAL.example(cal);
    var day = CAL.weekday(cal, date);
    var season = CAL.season(cal, date);
    Muse.$('muse-cal-example').textContent = checked.error
      ? ''
      : 'Dates are written like “' +
        CAL.write(cal, date) +
        '”' +
        (date.day !== undefined
          ? ', “' + CAL.write(cal, { year: date.year, month: date.month }) + '”'
          : '') +
        ' and “c. ' +
        CAL.write(cal, { year: date.year }) +
        '”.' +
        (day ? ' That day is a ' + day.name + '.' : '') +
        (season ? ' It is ' + season.name + '.' : '');
    var length = CAL.daysInYear(cal);
    Muse.$('muse-cal-year').textContent = checked.error
      ? ''
      : length
        ? 'A year of ' + length + (length === 1 ? ' day.' : ' days.')
        : 'No months: dates are years only.';
    Muse.say(Muse.$('muse-cal-error'), checked.error || '');
    drawFormat();
  }

  function draw() {
    drawMonths();
    drawWeekdays();
    drawSeasons();
    drawTime();
    drawEras();
    drawLive();
  }

  // ── The dates that don't fit (CA9) ──────────────
  function loadMisfits() {
    var p = state.project;
    var cal = CAL.of(p);
    var dated = Muse.TYPES.map(function (t) {
      return t.id;
    }).filter(function (type) {
      return ((p.fields && p.fields[type]) || []).some(function (def) {
        return def.kind === 'date';
      });
    });
    var list = Muse.$('muse-cal-misfit-list');
    if (!dated.length) {
      list.textContent = '';
      Muse.show(Muse.$('muse-cal-misfits'), false);
      return Promise.resolve([]);
    }
    return state.db
      .collection('muse_projects')
      .doc(p.id)
      .collection('elements')
      .where('retired', '==', false)
      .get()
      .then(function (snap) {
        if (state.project !== p) return [];
        var elements = snap.docs
          .map(function (doc) {
            var data = doc.data();
            return { id: doc.id, type: data.type, name: data.name, fields: data.fields || {} };
          })
          .filter(function (el) {
            return dated.indexOf(el.type) !== -1;
          });
        var found = CAL.misfits(cal, p.fields, elements);
        list.textContent = '';
        found.forEach(function (m) {
          var li = Muse.el('li', 'muse-cal-misfit');
          li.dataset.id = m.id;
          var a = Muse.el('a', '', m.name);
          a.href = projectHash() + '/e/' + encodeURIComponent(m.id);
          li.appendChild(a);
          li.appendChild(document.createTextNode(' — ' + m.label + ': ' + m.text + '. ' + m.why));
          list.appendChild(li);
        });
        Muse.show(Muse.$('muse-cal-misfits'), found.length > 0);
        return found;
      })
      .catch(function () {
        Muse.show(Muse.$('muse-cal-misfits'), false);
        return [];
      });
  }

  // ── Saving ──────────────────────────────────────
  function save() {
    var p = state.project;
    var checked = CAL.check(draft);
    if (checked.error) {
      Muse.say(Muse.$('muse-cal-error'), checked.error);
      return;
    }
    var b = Muse.$('muse-cal-save');
    b.disabled = true;
    Muse.projects
      .update(p.id, { calendar: checked.value })
      .then(function () {
        p.calendar = checked.value;
        draft = copy(checked.value);
        dirty = false;
        Muse.$('muse-cal-reset').disabled = true;
        drawNote();
        draw();
        Muse.say(Muse.$('muse-cal-done'), 'Calendar saved.');
        return loadMisfits();
      })
      .catch(function (err) {
        b.disabled = false;
        Muse.say(Muse.$('muse-cal-error'), 'The calendar couldn’t be saved: ' + err.message);
      });
  }

  function drawNote() {
    Muse.$('muse-cal-note').textContent = state.project.calendar
      ? 'Dates in ' + state.project.title + ' are written and picked in this calendar.'
      : state.project.title +
        ' uses the Gregorian calendar (with no leap days) until you save one of its own.';
  }

  function reset() {
    draft = copy(CAL.of(state.project));
    good = null;
    dirty = false;
    Muse.$('muse-cal-save').disabled = true;
    Muse.$('muse-cal-reset').disabled = true;
    Muse.say(Muse.$('muse-cal-done'), '');
    draw();
  }

  Muse.calendarPage = {
    init: function () {
      Muse.$('muse-cal-save').addEventListener('click', save);
      Muse.$('muse-cal-reset').addEventListener('click', reset);
      Muse.$('muse-cal-gregorian').addEventListener('click', function () {
        draft = CAL.gregorian();
        changed(true);
      });
      Muse.$('muse-cal-blank').addEventListener('click', function () {
        draft = CAL.blank();
        changed(true);
      });
      Muse.$('muse-cal-month-add').addEventListener('click', function () {
        draft.months.push({
          name: 'Month ' + (draft.months.length + 1),
          short: '',
          days: 30,
          outsideWeek: false,
        });
        changed(true);
        var rows = Muse.$('muse-cal-months').querySelectorAll('.muse-cal-row');
        var last = rows[rows.length - 1];
        if (last) last.querySelector('input').select();
      });
      Muse.$('muse-cal-weekday-add').addEventListener('click', function () {
        draft.weekdays.push('Day ' + (draft.weekdays.length + 1));
        changed(true);
      });
      Muse.$('muse-cal-season-add').addEventListener('click', function () {
        draft.seasons.push({ name: 'Season ' + (draft.seasons.length + 1), month: 1, day: 1 });
        changed(true);
      });
      Muse.$('muse-cal-era-add').addEventListener('click', function () {
        var last = draft.eras[draft.eras.length - 1];
        var start = last && typeof last.start === 'number' ? last.start + 1000 : 1;
        draft.eras.push({
          name: 'Era ' + (draft.eras.length + 1),
          short: '',
          start: start,
          backward: false,
        });
        changed(true);
      });
      Muse.$('muse-cal-first').addEventListener('change', function () {
        draft.firstWeekday = Number(Muse.$('muse-cal-first').value);
        changed(false);
      });
      [
        ['muse-cal-hours', 'hoursPerDay'],
        ['muse-cal-minutes', 'minutesPerHour'],
      ].forEach(function (pair) {
        Muse.$(pair[0]).addEventListener('input', function () {
          var raw = Muse.$(pair[0]).value.trim();
          var n = Number(raw);
          draft[pair[1]] = raw !== '' && isFinite(n) ? n : raw;
          changed(false);
        });
      });
      Muse.$('muse-cal-format-pick').addEventListener('change', function () {
        var value = Muse.$('muse-cal-format-pick').value;
        if (value) draft.format = value;
        changed(false);
        if (!value) Muse.$('muse-cal-format').focus();
      });
      Muse.$('muse-cal-format').addEventListener('input', function () {
        draft.format = Muse.$('muse-cal-format').value;
        changed(false);
        Muse.$('muse-cal-format-pick').value =
          CAL.FORMATS.indexOf(draft.format) === -1 ? '' : draft.format;
      });
      Muse.$('muse-cal-tokens').textContent =
        'Tokens: ' +
        CAL.TOKENS.map(function (t) {
          return '{' + t.id + '} ' + t.name.toLowerCase();
        }).join(' · ') +
        '. A date without a day or a month leaves those out.';
    },

    // Opens a project's calendar; false when the project isn't there.
    show: function (projectId) {
      return Muse.project.load(projectId).then(function (found) {
        if (!found) return false;
        var back = Muse.$('muse-cal-back');
        back.href = projectHash();
        back.textContent = '← ' + state.project.title;
        document.title = 'Calendar — ' + state.project.title;
        Muse.say(Muse.$('muse-cal-error'), '');
        drawNote();
        reset();
        loadMisfits();
        return true;
      });
    },

    dirty: function () {
      return dirty;
    },
  };
})();
