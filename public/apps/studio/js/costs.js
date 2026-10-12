(function () {
  'use strict';

  // What the studio spends (planning/the-image-studio.md §4.5; L-706 / #542).
  // There is no spending limit, so the month's total is always on the page,
  // above the library, and a banner says plainly once it passes the warning
  // figure ($50). The cost panel shows a month by day and by who asked (each
  // editor, through the page or Claude). It all comes from the studioCosts
  // callable, read again whenever the library changes (a new image may have
  // cost something).

  var Studio = window.Studio;
  var state = Studio.state;
  var ref = Studio.getRef;
  var el = Studio.el;

  var pending = null;
  var shownMonth = null; // the panel's month; the bar is always this month

  function money(usd) {
    usd = Number(usd) || 0;
    return '$' + (usd > 0 && usd < 1 ? usd.toFixed(3) : usd.toFixed(2));
  }

  function thisMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  function name(uid, names) {
    if (uid === state.uid) return 'You';
    return (names && names[uid]) || uid;
  }

  function renderBar(data) {
    Studio.show('studio-costbar', true);
    var over = data.total > data.warnAt;
    ref('studio-costbar').classList.toggle('studio-costbar-over', over);
    ref('studio-cost-total').textContent = money(data.total);
    ref('studio-cost-figure').textContent = 'warning at ' + money(data.warnAt);
    Studio.say(
      ref('studio-cost-banner'),
      over
        ? 'The studio has spent ' +
            money(data.total) +
            ' this month, past the ' +
            money(data.warnAt) +
            ' warning figure. There is no spending limit: every image made from now on adds to it.'
        : ''
    );
  }

  function table(headings, rows) {
    var t = el('table', 'studio-cost-table');
    var head = el('tr');
    headings.forEach(function (h) {
      head.appendChild(el('th', null, h));
    });
    t.appendChild(head);
    rows.forEach(function (cells) {
      var tr = el('tr');
      cells.forEach(function (cell) {
        var td = el('td');
        if (cell instanceof window.Node) td.appendChild(cell);
        else td.textContent = cell;
        tr.appendChild(td);
      });
      t.appendChild(tr);
    });
    return t;
  }

  // A bar for a day, scaled to the month's dearest day.
  function bar(usd, most) {
    var wrap = el('span', 'studio-cost-bar');
    var fill = el('span', 'studio-cost-bar-fill');
    fill.style.width = (most > 0 ? Math.max(2, Math.round((usd / most) * 100)) : 0) + '%';
    wrap.appendChild(fill);
    return wrap;
  }

  function renderPanel(data) {
    var panel = ref('studio-cost-panel');
    panel.innerHTML = '';
    panel.appendChild(
      el(
        'p',
        'studio-cost-summary' + (data.total > data.warnAt ? ' studio-cost-over' : ''),
        money(data.total) +
          ' in ' +
          data.month +
          ' from ' +
          data.count +
          (data.count === 1 ? ' charge' : ' charges') +
          ', against a warning figure of ' +
          money(data.warnAt) +
          '.'
      )
    );
    if (!data.count) {
      panel.appendChild(el('p', 'studio-meta', 'Nothing was charged this month.'));
      return;
    }

    panel.appendChild(el('h3', 'studio-subtitle', 'By day'));
    var most = Math.max.apply(
      null,
      data.days.map(function (d) {
        return d.usd;
      })
    );
    panel.appendChild(
      table(
        ['Day', 'Spent', 'Images', ''],
        data.days.map(function (d) {
          return [d.date.slice(5), money(d.usd), String(d.count), bar(d.usd, most)];
        })
      )
    );

    panel.appendChild(el('h3', 'studio-subtitle', 'By who'));
    panel.appendChild(
      table(
        ['Who', 'Spent', 'On this page', 'From Claude'],
        data.who.map(function (w) {
          return [
            name(w.uid, data.names),
            money(w.usd) + ' (' + w.count + ')',
            money(w.page.usd),
            money(w.mcp.usd),
          ];
        })
      )
    );

    if (data.models && data.models.length) {
      panel.appendChild(el('h3', 'studio-subtitle', 'By model'));
      panel.appendChild(
        table(
          ['Model', 'Spent', 'Images'],
          data.models.map(function (m) {
            return [m.model, money(m.usd), String(m.count)];
          })
        )
      );
    }

    if (data.recent && data.recent.length) {
      panel.appendChild(el('h3', 'studio-subtitle', 'Latest charges'));
      panel.appendChild(
        table(
          ['When', 'Spent', 'What', 'Who'],
          data.recent.map(function (r) {
            return [
              new Date(r.at).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              }),
              money(r.usd) + (r.failed ? ' (failed)' : ''),
              [Studio.kindName(r.kind || 'other'), r.model].filter(Boolean).join(' · '),
              name(r.createdBy, data.names) + (r.via === 'mcp' ? ', from Claude' : ''),
            ];
          })
        )
      );
    }
  }

  function load(month) {
    var call = state.functions.httpsCallable('studioCosts');
    return call(month ? { month: month } : {}).then(function (res) {
      return res.data;
    });
  }

  // The bar (this month) and, when it shows this month, the panel.
  function refresh() {
    if (pending) return pending;
    pending = load()
      .then(function (data) {
        renderBar(data);
        if (!shownMonth || shownMonth === data.month) {
          shownMonth = data.month;
          renderPanel(data);
        }
      })
      .catch(function (err) {
        console.error('Failed to load costs:', err);
        Studio.show('studio-costbar', true);
        ref('studio-cost-total').textContent = 'unknown';
        ref('studio-cost-figure').textContent = 'costs could not be loaded';
      })
      .then(function () {
        pending = null;
      });
    return pending;
  }

  function showMonth(month) {
    Studio.say(ref('studio-cost-error'), '');
    shownMonth = month;
    load(month)
      .then(renderPanel)
      .catch(function (err) {
        console.error('Failed to load costs:', err);
        Studio.say(ref('studio-cost-error'), err.message || 'Costs could not be loaded.');
      });
  }

  Studio.costs = {
    init: function () {
      var input = ref('studio-cost-month');
      input.value = thisMonth();
      input.max = thisMonth();
      input.addEventListener('change', function () {
        if (/^\d{4}-\d{2}$/.test(input.value)) showMonth(input.value);
      });
      ref('studio-cost-link').addEventListener('click', function () {
        ref('studio-costs').open = true;
      });
      refresh();
    },
    refresh: refresh,
    money: money,
  };
})();
