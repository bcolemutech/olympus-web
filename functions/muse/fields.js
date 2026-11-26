/* global module, window, require */
(function () {
  'use strict';

  // A project's own fields per element type (planning/the-muse.md §3 EL2;
  // M-102 / #890). The project keeps their definitions in `fields`, by type:
  //
  //   fields: { character: [{ key, label, kind, options }], faction: […], … }
  //
  // and each element keeps its values in its own `fields`, by key. The kinds:
  //
  //   text      a line or a paragraph, up to 10,000 characters
  //   number    any finite number
  //   date      { year, month?, day?, hour?, minute?, circa? }, whole numbers:
  //             just a year, a month or a day (TL1), with a time and "c."
  //             (M-301, D12); `year` the running year. Given as numbers or as
  //             text in the project's form, read and written by its calendar
  //             (./calendar.js).
  //   element   an element's id; `options` may name the types it can be
  //   choice    one of `options`, a list of words
  //
  // A field removed from the project keeps its values on each element until
  // that element is next saved (clean() drops them then). A stored value that
  // a change of definition made invalid (an option taken away, a link to an
  // element since retired) is kept as long as it isn't edited.
  //
  // Pure: the page uses it, and the Muse connector (M-106) will too. Checks
  // take raw input (from a form or a tool call) and give back { value } or
  // { error }; a value of null means "not set".

  var calendar =
    typeof window !== 'undefined' && window.Muse && window.Muse.calendar
      ? window.Muse.calendar
      : require('./calendar.js');

  var TYPES = ['character', 'faction', 'location', 'object', 'concept'];
  var KINDS = [
    { id: 'text', name: 'Text' },
    { id: 'number', name: 'Number' },
    { id: 'date', name: 'Date' },
    { id: 'element', name: 'Link to an element' },
    { id: 'choice', name: 'Choice from a list' },
  ];
  var KIND_IDS = KINDS.map(function (k) {
    return k.id;
  });
  var LIMITS = { perType: 30, label: 60, options: 50, option: 100, text: 10000, key: 40 };
  var KEY = /^[a-z][a-z0-9_]{0,39}$/;

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  // A key for a new field: its label as a word, and a few letters of
  // `salt` (random by default) so that a field removed and added again never
  // reads the values the old one left on elements. Unique among `taken`.
  function makeKey(label, taken, salt) {
    var base =
      String(label || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30) || 'field';
    if (!/^[a-z]/.test(base)) base = ('f_' + base).slice(0, 30);
    var used = {};
    (taken || []).forEach(function (k) {
      used[k] = true;
    });
    for (var n = 0; ; n++) {
      var tail =
        n === 0 && salt !== undefined ? String(salt) : Math.random().toString(36).slice(2, 6);
      var key =
        base +
        '_' +
        tail
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 6);
      if (!used[key] && KEY.test(key)) return key;
    }
  }

  // Checks one type's list of definitions; gives back { value } (cleaned) or
  // { error }.
  function checkDefinitions(list) {
    if (list === undefined || list === null) return { value: [] };
    if (!Array.isArray(list)) return { error: 'Fields must be a list.' };
    if (list.length > LIMITS.perType) {
      return { error: 'A type has at most ' + LIMITS.perType + ' fields.' };
    }
    var keys = {};
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var def = list[i];
      if (!isPlainObject(def)) return { error: 'A field must be an object.' };
      var label = String(def.label || '').trim();
      if (!label) return { error: 'Every field needs a label.' };
      if (label.length > LIMITS.label) {
        return { error: 'A label is at most ' + LIMITS.label + ' characters.' };
      }
      var key = String(def.key || '');
      if (!KEY.test(key)) return { error: 'The field "' + label + '" has a bad key.' };
      if (keys[key]) return { error: 'Two fields share the key "' + key + '".' };
      keys[key] = true;
      if (KIND_IDS.indexOf(def.kind) === -1) {
        return { error: 'The field "' + label + '" has no kind we know.' };
      }
      var clean = { key: key, label: label, kind: def.kind };
      if (def.kind === 'choice') {
        var options = checkOptions(def.options);
        if (options.error) return { error: 'The field "' + label + '": ' + options.error };
        if (!options.value.length) {
          return { error: 'The field "' + label + '" needs at least one choice.' };
        }
        clean.options = options.value;
      } else if (def.kind === 'element') {
        var types = Array.isArray(def.options) ? def.options : [];
        for (var t = 0; t < types.length; t++) {
          if (TYPES.indexOf(types[t]) === -1) {
            return { error: 'The field "' + label + '" links to a type we don’t know.' };
          }
        }
        clean.options = TYPES.filter(function (type) {
          return types.indexOf(type) !== -1;
        });
      }
      out.push(clean);
    }
    return { value: out };
  }

  function checkOptions(options) {
    if (!Array.isArray(options)) return { error: 'the choices must be a list.' };
    var seen = {};
    var out = [];
    for (var i = 0; i < options.length; i++) {
      var option = String(options[i] === null || options[i] === undefined ? '' : options[i]).trim();
      if (!option || seen[option]) continue;
      if (option.length > LIMITS.option) {
        return { error: 'a choice is at most ' + LIMITS.option + ' characters.' };
      }
      seen[option] = true;
      out.push(option);
    }
    if (out.length > LIMITS.options) {
      return { error: 'at most ' + LIMITS.options + ' choices.' };
    }
    return { value: out };
  }

  // Checks the project's whole `fields` map, by type.
  function checkAll(fields) {
    if (fields === undefined || fields === null) return { value: {} };
    if (!isPlainObject(fields)) return { error: 'Fields must be a map by type.' };
    var out = {};
    var types = Object.keys(fields);
    for (var i = 0; i < types.length; i++) {
      if (TYPES.indexOf(types[i]) === -1) {
        return { error: 'Fields for a type we don’t know: ' + types[i] + '.' };
      }
      var checked = checkDefinitions(fields[types[i]]);
      if (checked.error) return checked;
      if (checked.value.length) out[types[i]] = checked.value;
    }
    return { value: out };
  }

  function empty(raw) {
    return raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim());
  }

  // The same value, whatever order a map's keys come in (Firestore gives a
  // date's back sorted).
  function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (!isPlainObject(value)) return value;
    var out = {};
    Object.keys(value)
      .sort()
      .forEach(function (k) {
        out[k] = canonical(value[k]);
      });
    return out;
  }

  function sameValue(a, b) {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  }

  // Checks a raw value for a field. `context`:
  //   elementType(id) → the type of a live element, or null (element links)
  //   calendar        the project's calendar (./calendar.js of): a date is
  //                   read by it and must fit it (CA9); without one, only
  //                   a date's shape is checked
  //   kept            the value stored now, accepted as it is even where
  //                   a change of definition has made it invalid
  function checkValue(def, raw, context) {
    context = context || {};
    if (empty(raw)) return { value: null };
    if (context.kept !== undefined && context.kept !== null && sameValue(raw, context.kept)) {
      return { value: context.kept };
    }
    var label = def.label;
    switch (def.kind) {
      case 'text': {
        var text = String(raw).trim();
        if (text.length > LIMITS.text) {
          return { error: label + ' is at most ' + LIMITS.text + ' characters.' };
        }
        return { value: text };
      }
      case 'number': {
        var n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''));
        if (typeof raw === 'boolean' || !isFinite(n)) {
          return { error: label + ' must be a number.' };
        }
        return { value: n };
      }
      case 'date':
        return checkDate(label, raw, context.calendar);
      case 'element': {
        var id = String(raw).trim();
        var type = context.elementType ? context.elementType(id) : null;
        if (!type) return { error: label + ' must link to an element in this project.' };
        if (def.options && def.options.length && def.options.indexOf(type) === -1) {
          return { error: label + ' can’t link to a ' + type + '.' };
        }
        return { value: id };
      }
      case 'choice': {
        var choice = String(raw).trim();
        if ((def.options || []).indexOf(choice) === -1) {
          return { error: label + ' must be one of its choices.' };
        }
        return { value: choice };
      }
      default:
        return { error: label + ' has no kind we know.' };
    }
  }

  // A date at any precision: a year, a month of a year, or a day of a month,
  // with a time and "circa" (D12): numbers, or text in the calendar's form.
  function checkDate(label, raw, cal) {
    if (typeof raw === 'string' || typeof raw === 'number') {
      var read = calendar.parse(cal || calendar.gregorian(), raw);
      return read.error ? { error: label + ': ' + read.error } : read;
    }
    if (isPlainObject(raw) && raw.era !== undefined && raw.era !== null && raw.era !== '') {
      var numbers = calendar.fromNumbers(cal || calendar.gregorian(), raw);
      return numbers.error ? { error: label + ': ' + numbers.error } : numbers;
    }
    var shape = calendar.checkShape(raw, label);
    if (shape.error || shape.value === null || !cal) return shape;
    var why = calendar.misfit(cal, shape.value);
    return why ? { error: label + ': ' + why } : shape;
  }

  // An element's values cleaned against its type's definitions: values of
  // fields no longer defined are dropped, as are values not set. Used when
  // an element is saved.
  function clean(defs, values) {
    var out = {};
    (defs || []).forEach(function (def) {
      if (values && values[def.key] !== undefined && values[def.key] !== null) {
        out[def.key] = values[def.key];
      }
    });
    return out;
  }

  // Checks every value for a type at once: `raw` by key. Gives back
  // { value } (the element's cleaned `fields`) or { error }.
  function checkValues(defs, raw, context) {
    context = context || {};
    var kept = context.kept || {};
    var out = {};
    for (var i = 0; i < (defs || []).length; i++) {
      var def = defs[i];
      var checked = checkValue(def, raw ? raw[def.key] : null, {
        elementType: context.elementType,
        calendar: context.calendar,
        kept: kept[def.key],
      });
      if (checked.error) return checked;
      if (checked.value !== null) out[def.key] = checked.value;
    }
    return { value: out };
  }

  // A value as words to show. `context.elementName(id)` names a link, and
  // `context.calendar` writes a date (else the Gregorian does).
  function format(def, value, context) {
    context = context || {};
    if (value === undefined || value === null) return '';
    switch (def.kind) {
      case 'number':
        return typeof value === 'number' ? value.toLocaleString() : String(value);
      case 'date':
        return formatDate(value, context.calendar);
      case 'element':
        return (context.elementName && context.elementName(value)) || 'A retired element';
      default:
        return String(value);
    }
  }

  function formatDate(value, cal) {
    if (!isPlainObject(value) || typeof value.year !== 'number') return '';
    return calendar.write(cal || calendar.gregorian(), value);
  }

  var api = {
    TYPES: TYPES,
    KINDS: KINDS,
    LIMITS: LIMITS,
    makeKey: makeKey,
    checkDefinitions: checkDefinitions,
    checkAll: checkAll,
    checkValue: checkValue,
    checkValues: checkValues,
    clean: clean,
    format: format,
    formatDate: formatDate,
  };

  if (typeof window !== 'undefined') {
    window.Muse = window.Muse || {};
    window.Muse.fields = api;
  }
  if (typeof module === 'object' && module.exports) module.exports = api;
})();
