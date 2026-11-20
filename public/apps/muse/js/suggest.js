(function () {
  'use strict';

  // Picking an element by typing (planning/the-muse.md §3 EL5, EL6; M-103 /
  // #891): one list of names and aliases from the index, offered three ways.
  //
  //   Muse.suggest.input(input, options)   under a one-line box: the search
  //     in the header, and the other end of a relationship
  //   Muse.suggest.mention(textarea)       typing @ in a Markdown text offers
  //     elements and inserts [Name](muse:el/<id>) where the @ was
  //
  // The list is the index's, in memory, so it answers as you type. Arrow keys
  // move, Enter or Tab picks, Escape closes; a tap picks too.

  var Muse = window.Muse;

  var counter = 0;

  // The box a list sits in, made around `node` when it isn't in one.
  function wrapAround(node) {
    var parent = node.parentNode;
    if (parent && parent.classList.contains('muse-suggest-wrap')) return parent;
    var wrap = Muse.el('div', 'muse-suggest-wrap');
    parent.insertBefore(wrap, node);
    wrap.appendChild(node);
    return wrap;
  }

  // The list itself: `choose(result)` is called with the one picked.
  function popup(wrap, control, choose) {
    var list = Muse.el('div', 'muse-suggest hidden');
    list.id = 'muse-suggest-' + ++counter;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Matching elements');
    wrap.appendChild(list);
    control.setAttribute('aria-controls', list.id);
    control.setAttribute('aria-expanded', 'false');
    control.setAttribute('aria-autocomplete', 'list');
    var results = [];
    var active = 0;

    function mark() {
      Array.prototype.forEach.call(list.children, function (row, i) {
        row.setAttribute('aria-selected', String(i === active));
        row.classList.toggle('muse-suggest-active', i === active);
        if (i === active) {
          control.setAttribute('aria-activedescendant', row.id);
          if (row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    var api = {
      list: list,
      visible: function () {
        return !list.classList.contains('hidden');
      },
      hide: function () {
        results = [];
        list.textContent = '';
        list.classList.add('hidden');
        control.setAttribute('aria-expanded', 'false');
        control.removeAttribute('aria-activedescendant');
      },
      // Shows `found` (search results); nothing found hides the list.
      show: function (found, at) {
        if (!found.length) {
          api.hide();
          return;
        }
        results = found;
        active = 0;
        list.textContent = '';
        found.forEach(function (result, i) {
          var row = Muse.el('div', 'muse-suggest-row');
          row.id = list.id + '-' + i;
          row.setAttribute('role', 'option');
          row.dataset.id = result.id;
          row.appendChild(Muse.el('span', 'muse-suggest-name', result.name));
          row.appendChild(Muse.el('span', 'muse-suggest-type', Muse.TYPE[result.type].one));
          if (result.matched) {
            row.appendChild(Muse.el('span', 'muse-suggest-alias', 'also ' + result.matched));
          }
          // Keeps the focus where it was, so a tap doesn't close the list first.
          row.addEventListener('mousedown', function (event) {
            event.preventDefault();
          });
          row.addEventListener('click', function () {
            choose(result);
          });
          list.appendChild(row);
        });
        list.style.left = at ? at.left + 'px' : '';
        list.style.top = at ? at.top + 'px' : '';
        list.classList.remove('hidden');
        control.setAttribute('aria-expanded', 'true');
        mark();
      },
      move: function (step) {
        if (!results.length) return;
        active = (active + step + results.length) % results.length;
        mark();
      },
      pick: function () {
        if (results[active]) choose(results[active]);
      },
    };
    return api;
  }

  // Keys shared by both: true when it was a list key and has been used.
  function key(event, list) {
    if (!list.visible()) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      list.move(event.key === 'ArrowDown' ? 1 : -1);
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault();
      list.pick();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      list.hide();
      return true;
    }
    return false;
  }

  var LIST_KEYS = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape', 'Shift'];

  // ── Under a one-line box ────────────────────────
  // options:
  //   choose(result)   what picking does
  //   types            only these element types
  //   except()         the id of an element to leave out
  //   limit            at most this many (8)
  //   empty            true to list some with nothing typed (else it waits)
  function input(box, options) {
    options = options || {};
    var wrap = wrapAround(box);
    var list = popup(wrap, box, function (result) {
      list.hide();
      options.choose(result);
    });
    box.setAttribute('role', 'combobox');
    box.autocomplete = 'off';

    function update() {
      var text = box.value.trim();
      if (!text && !options.empty) {
        list.hide();
        return;
      }
      list.show(
        Muse.elements.search(text, {
          limit: options.limit || 8,
          types: options.types,
          except: options.except && options.except(),
        })
      );
    }

    box.addEventListener('input', update);
    box.addEventListener('focus', function () {
      if (options.empty) update();
    });
    box.addEventListener('keydown', function (event) {
      key(event, list);
    });
    box.addEventListener('blur', function () {
      // After a tap on a row has had its click.
      setTimeout(list.hide, 150);
    });
    return { hide: list.hide };
  }

  // ── Typing @ in a Markdown text ─────────────────
  // The @ and what follows it, up to the caret, when it is a place to link:
  // after a space, a bracket, a quote or the start, and without a line break.
  function token(area) {
    if (area.selectionStart !== area.selectionEnd) return null;
    var caret = area.selectionStart;
    var before = area.value.slice(0, caret);
    var at = before.lastIndexOf('@');
    if (at === -1) return null;
    var query = before.slice(at + 1);
    if (query.length > 40 || /\n/.test(query) || /^\s/.test(query)) return null;
    if (at > 0 && !/[\s(["']/.test(before.charAt(at - 1))) return null;
    return { start: at, end: caret, query: query };
  }

  // Where the caret is in a textarea, by measuring a copy of its text.
  var MIRRORED = [
    'boxSizing',
    'width',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'fontStyle',
    'fontWeight',
    'fontSize',
    'fontFamily',
    'lineHeight',
    'letterSpacing',
    'tabSize',
    'textTransform',
  ];
  function caretPoint(area, index) {
    var style = window.getComputedStyle(area);
    var mirror = document.createElement('div');
    MIRRORED.forEach(function (name) {
      mirror.style[name] = style[name];
    });
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    mirror.textContent = area.value.slice(0, index);
    var mark = document.createElement('span');
    mark.textContent = '​';
    mirror.appendChild(mark);
    area.parentNode.appendChild(mirror);
    var line = parseFloat(style.lineHeight) || 24;
    var point = {
      left: mark.offsetLeft - area.scrollLeft,
      top: mark.offsetTop - area.scrollTop + line,
      line: line,
    };
    mirror.remove();
    return point;
  }

  function mention(area) {
    var wrap = wrapAround(area);
    var open = null; // the token the list is for
    var list = popup(wrap, area, function (result) {
      var t = open;
      list.hide();
      open = null;
      if (!t) return;
      var link = Muse.links.linkMarkdown(result.name, result.id);
      area.value = area.value.slice(0, t.start) + link + area.value.slice(t.end);
      var caret = t.start + link.length;
      area.setSelectionRange(caret, caret);
      area.focus();
      area.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    function update() {
      var t = token(area);
      open = t;
      if (!t) {
        list.hide();
        return;
      }
      var found = Muse.elements.search(t.query, { limit: 8 });
      if (!found.length) {
        list.hide();
        return;
      }
      // Under the line the @ is on, kept inside the box.
      var point = caretPoint(area, t.start);
      var room = wrap.clientWidth - 288;
      var top = Math.min(point.top, area.offsetHeight);
      list.show(found, { left: Math.max(0, Math.min(point.left, room)), top: top });
      // Too near the bottom of the screen: above the line instead, when that fits.
      var box = list.list.getBoundingClientRect();
      if (box.bottom > window.innerHeight - 8) {
        var above = top - point.line - box.height - 8;
        if (box.top - (top - above) >= 0) list.list.style.top = above + 'px';
      }
    }

    area.addEventListener('input', update);
    area.addEventListener('click', update);
    area.addEventListener('keyup', function (event) {
      if (LIST_KEYS.indexOf(event.key) === -1) update();
    });
    area.addEventListener('keydown', function (event) {
      key(event, list);
    });
    area.addEventListener('blur', function () {
      setTimeout(list.hide, 150);
    });
    return { hide: list.hide };
  }

  Muse.suggest = { input: input, mention: mention, token: token };
})();
