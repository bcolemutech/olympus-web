(function () {
  'use strict';

  // Schematics on an element's page (planning/the-muse.md §3 SC3–SC9; M-202 /
  // #915). A location or an object lists its schematics in order (SC4): each
  // a studio picture with numbered pins and the list of points beside it, or
  // below it on a phone; picking a pin or a row lights up the other (SC6).
  // The picture zooms and pans by pinch, wheel or the + and − buttons (SC8);
  // "Add point" then a tap places a point, and a pin is dragged to move it, by
  // finger or mouse (SC7). A point's card has its name, description
  // (Markdown) and link to any element (SC5). Every element's page also says
  // where it is marked, a link that opens the plan at its pin (SC9).
  //
  // Seen from M-203's testing (2026-11-25): the section opens for reading,
  // the picture the card's full width and its points below it; "Edit
  // schematics" shows what changes them (rename, order, picture, removal,
  // adding, versions, and a point's Edit and Remove), and only then can a pin
  // be dragged. "⤢" opens the picture over the whole screen, its points in a
  // panel beside it and a point's card by its pin.
  //
  // The writes are ./schematics.js's plans through ./schematic-store.js; this
  // file draws them and holds the view (zoom, pan, what is picked).

  var Muse = window.Muse;
  var state = Muse.state;
  var S = Muse.schematics;
  var MAX_SCALE = 8;
  var DRAG = 4; // pixels a pointer moves before a tap is a drag
  var ZOOM_STEP = 1.25;
  var NARROW = 760; // at most this wide, the full screen's points cover the picture
  var LOCKED = 'muse-sc-locked'; // on <html> while the full screen is open

  var sc = null; // the open page's state, see reset()
  var ui = null; // the open schematic's nodes
  var versionBox = null;
  var addControls = null;

  function reset() {
    sc = {
      element: null,
      list: [],
      openId: null,
      selected: null,
      edit: false, // "Edit schematics" is on
      full: false, // the picture fills the screen
      drawer: false, // the full screen's list of points is open
      adding: false,
      editing: false,
      confirming: false,
      scale: 1,
      tx: 0,
      ty: 0,
      busy: false,
    };
    ui = null;
    document.documentElement.classList.remove(LOCKED);
  }
  reset();

  function narrow() {
    return window.innerWidth <= NARROW;
  }

  function node(id) {
    return Muse.$(id);
  }

  function say(text) {
    Muse.say(node('muse-e-sc-error'), text);
  }

  function projectHash() {
    return '#/p/' + encodeURIComponent(state.project.id);
  }

  function current() {
    return (
      sc.list.filter(function (s) {
        return s.id === sc.openId;
      })[0] || null
    );
  }

  function pointAt(s, id) {
    return (
      s.points.filter(function (p) {
        return p.id === id;
      })[0] || null
    );
  }

  function numberOf(s, id) {
    for (var i = 0; i < s.points.length; i++) if (s.points[i].id === id) return i + 1;
    return 0;
  }

  function button(text, label, className) {
    var b = Muse.el('button', 'muse-btn muse-btn-quiet ' + (className || ''), text);
    b.type = 'button';
    if (label) {
      b.setAttribute('aria-label', label);
      b.title = label;
    }
    return b;
  }

  // Runs a write, then reads the list again and draws what changed.
  function act(promise, after) {
    say('');
    sc.busy = true;
    return promise
      .then(function (result) {
        return reload().then(function () {
          if (after) after(result);
        });
      })
      .catch(function (err) {
        say('That didn’t work: ' + err.message);
        return reload().catch(function () {});
      })
      .then(function () {
        sc.busy = false;
      });
  }

  function reload() {
    var elementId = sc.element.id;
    return Muse.schematicStore.forElement(elementId).then(function (list) {
      if (!sc.element || sc.element.id !== elementId) return;
      sc.list = list;
      if (!current()) {
        sc.openId = list.length ? list[0].id : null;
        sc.selected = null;
        sc.scale = 1;
        ui = null;
      }
      draw();
    });
  }

  // ── The list of schematics ──────────────────────
  function drawTabs() {
    var tabs = node('muse-e-sc-tabs');
    tabs.textContent = '';
    sc.list.forEach(function (s) {
      var tab = Muse.el('button', 'muse-sc-tab', s.name);
      tab.type = 'button';
      tab.dataset.id = s.id;
      tab.setAttribute('aria-pressed', String(s.id === sc.openId));
      if (s.id === sc.openId) tab.classList.add('muse-sc-tab-on');
      tab.addEventListener('click', function () {
        openSchematic(s.id);
      });
      tabs.appendChild(tab);
    });
    Muse.show(tabs, sc.list.length > 0);
    Muse.show(node('muse-e-sc-empty'), sc.list.length === 0);
    node('muse-e-sc-count').textContent = sc.list.length ? String(sc.list.length) : '';
  }

  function openSchematic(id, pointId) {
    sc.openId = id;
    sc.selected = pointId || null;
    sc.adding = false;
    sc.editing = false;
    sc.confirming = false;
    sc.scale = 1;
    sc.tx = 0;
    sc.ty = 0;
    ui = null;
    draw();
  }

  // ── Reading and editing ─────────────────────────
  // What only "Edit schematics" shows. With none yet, adding one is all there
  // is to do, so it shows without asking.
  function refreshEdit() {
    var s = current();
    var section = node('muse-e-schematics');
    var toggle = node('muse-e-sc-edit');
    section.classList.toggle('muse-sc-editing', sc.edit);
    Muse.show(toggle, sc.list.length > 0);
    toggle.textContent = sc.edit ? 'Done' : 'Edit schematics';
    toggle.setAttribute('aria-pressed', String(sc.edit));
    Muse.show(node('muse-e-sc-new'), sc.edit || sc.list.length === 0);
    Muse.show(node('muse-e-sc-versions'), !!s && sc.edit);
    if (!ui) return;
    [ui.bar, ui.more, ui.danger, ui.add, ui.fullAdd].forEach(function (n) {
      Muse.show(n, sc.edit);
    });
    ui.fullEdit.textContent = sc.edit ? 'Done editing' : 'Edit';
    ui.fullEdit.setAttribute('aria-pressed', String(sc.edit));
    ui.empty.textContent = sc.edit
      ? 'No points yet. Choose “Add point”, then tap the picture.'
      : 'No points yet. Choose “Edit” to add some.';
  }

  function setEdit(on) {
    sc.edit = on;
    if (!on) {
      sc.adding = false;
      sc.editing = false;
      sc.confirming = false;
    }
    refreshEdit();
    var s = current();
    if (!ui || !s) return;
    refreshAdding();
    refreshDanger();
    drawCard(s);
  }

  // ── The full screen ─────────────────────────────
  function setFull(on) {
    if (!ui) return;
    sc.full = on;
    sc.drawer = on && !narrow();
    refreshFull();
    if (on) ui.fullClose.focus();
    else ui.full.focus();
  }

  function refreshFull() {
    var s = current();
    document.documentElement.classList.toggle(LOCKED, sc.full);
    ui.body.classList.toggle('muse-sc-full', sc.full);
    ui.body.classList.toggle('muse-sc-drawer-open', sc.drawer);
    ui.body.setAttribute('role', sc.full ? 'dialog' : 'group');
    ui.body.setAttribute('aria-label', s ? s.name : 'Schematic');
    Muse.show(ui.fullBar, sc.full);
    Muse.show(ui.full, !sc.full);
    ui.fullPoints.setAttribute('aria-pressed', String(sc.drawer));
    if (s) {
      ui.fullTitle.textContent = s.name;
      ui.fullPoints.textContent = 'Points' + (s.points.length ? ' (' + s.points.length + ')' : '');
      drawCard(s);
    }
    applyView();
  }

  // ── Drawing ─────────────────────────────────────
  function draw() {
    drawTabs();
    var s = current();
    Muse.show(node('muse-e-sc-open'), !!s);
    if (!s) {
      node('muse-e-sc-open').textContent = '';
      ui = null;
      document.documentElement.classList.remove(LOCKED);
      sc.full = false;
      refreshEdit();
      return;
    }
    if (!ui || ui.id !== s.id) build(s);
    refresh(s);
    if (versionBox && (!ui.versioned || ui.versioned !== s.id)) {
      versionBox.reset();
      ui.versioned = s.id;
    }
  }

  // The open schematic's controls, stage and side, built once per schematic.
  function build(s) {
    var open = node('muse-e-sc-open');
    open.textContent = '';
    ui = { id: s.id, image: s.image };

    // Its name, order, picture and removal (shown while editing).
    var bar = Muse.el('div', 'muse-sc-bar');
    ui.bar = bar;
    var rename = Muse.el('form', 'muse-inline muse-sc-rename');
    ui.name = Muse.el('input', 'muse-input');
    ui.name.id = 'muse-sc-name';
    ui.name.maxLength = S.LIMITS.name;
    ui.name.autocomplete = 'off';
    ui.name.setAttribute('aria-label', 'Schematic name');
    ui.rename = Muse.el('button', 'muse-btn muse-btn-quiet', 'Rename');
    ui.rename.type = 'submit';
    ui.rename.id = 'muse-sc-rename';
    rename.appendChild(ui.name);
    rename.appendChild(ui.rename);
    rename.addEventListener('submit', function (event) {
      event.preventDefault();
      var now = current();
      if (!now || ui.name.value.trim() === now.name) return;
      act(Muse.schematicStore.update(now, { name: ui.name.value }));
    });
    bar.appendChild(rename);
    ui.earlier = button('←', 'Move this schematic earlier', 'muse-sc-earlier');
    ui.earlier.id = 'muse-sc-earlier';
    ui.later = button('→', 'Move this schematic later', 'muse-sc-later');
    ui.later.id = 'muse-sc-later';
    [ui.earlier, ui.later].forEach(function (b, i) {
      b.addEventListener('click', function () {
        act(Muse.schematicStore.move(sc.list, sc.openId, i ? 1 : -1));
      });
      bar.appendChild(b);
    });
    open.appendChild(bar);

    var more = Muse.el('details', 'muse-sc-more');
    ui.more = more;
    more.appendChild(Muse.el('summary', '', 'Change the picture'));
    var pic = Muse.el('div');
    pic.id = 'muse-sc-pic-add';
    more.appendChild(pic);
    open.appendChild(more);
    Muse.photos.adder(pic, {
      id: 'muse-sc-pic',
      multiple: false,
      describe: describe,
      chosen: function () {
        var now = current();
        return now ? [now.image] : [];
      },
      onAdd: function (ids) {
        var now = current();
        return Muse.schematicStore.update(now, { image: ids[0] }).then(function () {
          return reload();
        });
      },
    });

    // The picture and its points; the same nodes fill the screen in full.
    var body = Muse.el('div', 'muse-sc-body');
    ui.body = body;
    body.appendChild(buildFullBar());
    body.appendChild(buildStage(s));
    body.appendChild(buildSide());
    ui.pop = Muse.el('div', 'muse-sc-card muse-sc-pop hidden');
    ui.pop.id = 'muse-sc-pop';
    body.appendChild(ui.pop);
    open.appendChild(body);

    var danger = Muse.el('div', 'muse-sc-danger');
    ui.danger = danger;
    ui.remove = button('Remove this schematic', '', 'muse-btn-danger');
    ui.remove.id = 'muse-sc-remove';
    ui.remove.classList.remove('muse-btn-quiet');
    ui.remove.addEventListener('click', function () {
      sc.confirming = true;
      refreshDanger();
    });
    ui.confirm = Muse.el('div', 'muse-confirm hidden');
    ui.confirm.setAttribute('role', 'alertdialog');
    ui.confirmText = Muse.el('p');
    ui.confirm.appendChild(ui.confirmText);
    var yes = Muse.el('button', 'muse-btn muse-btn-danger', 'Remove');
    yes.type = 'button';
    yes.id = 'muse-sc-remove-yes';
    yes.addEventListener('click', function () {
      var id = sc.openId;
      sc.confirming = false;
      sc.openId = null;
      act(Muse.schematicStore.remove(id));
    });
    var no = button('Keep it', '');
    no.id = 'muse-sc-remove-no';
    no.addEventListener('click', function () {
      sc.confirming = false;
      refreshDanger();
    });
    ui.confirm.appendChild(yes);
    ui.confirm.appendChild(no);
    danger.appendChild(ui.remove);
    danger.appendChild(ui.confirm);
    open.appendChild(danger);

    loadPicture(s);
  }

  function describe() {
    var addName = node('muse-e-sc-new-name');
    var e = sc.element;
    return {
      name: (addName && addName.value.trim()) || e.name + ' schematic',
      kind: 'schematic',
      labels: [Muse.photos.labelOf(state.project.title)],
    };
  }

  // The full screen's bar: its name, closing it, the points, and editing.
  function buildFullBar() {
    var bar = Muse.el('div', 'muse-sc-full-bar hidden');
    ui.fullBar = bar;
    ui.fullClose = button('Close', 'Leave full screen', 'muse-sc-full-close');
    ui.fullClose.id = 'muse-sc-full-close';
    ui.fullClose.addEventListener('click', function () {
      setFull(false);
    });
    ui.fullTitle = Muse.el('span', 'muse-sc-full-title');
    ui.fullPoints = button('Points', 'Show or hide the list of points');
    ui.fullPoints.id = 'muse-sc-full-points';
    ui.fullPoints.addEventListener('click', function () {
      sc.drawer = !sc.drawer;
      refreshFull();
    });
    ui.fullEdit = button('Edit', '');
    ui.fullEdit.id = 'muse-sc-full-edit';
    ui.fullEdit.addEventListener('click', function () {
      setEdit(!sc.edit);
    });
    ui.fullAdd = Muse.el('button', 'muse-btn hidden', 'Add point');
    ui.fullAdd.type = 'button';
    ui.fullAdd.id = 'muse-sc-full-add';
    ui.fullAdd.addEventListener('click', toggleAdding);
    [ui.fullClose, ui.fullTitle, ui.fullPoints, ui.fullEdit, ui.fullAdd].forEach(function (n) {
      bar.appendChild(n);
    });
    return bar;
  }

  function toggleAdding() {
    sc.adding = !sc.adding;
    refreshAdding();
  }

  function buildStage(s) {
    var wrap = Muse.el('div', 'muse-sc-main');
    ui.stage = Muse.el('div', 'muse-sc-stage');
    ui.stage.id = 'muse-sc-stage';
    ui.stage.tabIndex = -1;
    ui.canvas = Muse.el('div', 'muse-sc-canvas');
    ui.canvas.id = 'muse-sc-canvas';
    ui.img = Muse.el('img', 'muse-sc-img');
    ui.img.alt = s.name;
    ui.img.draggable = false;
    ui.img.decoding = 'async';
    ui.canvas.appendChild(ui.img);
    ui.pins = Muse.el('div', 'muse-sc-pins');
    ui.canvas.appendChild(ui.pins);
    ui.stage.appendChild(ui.canvas);
    ui.missing = Muse.el('p', 'muse-sc-missing hidden', 'Its picture is no longer in the studio.');
    ui.stage.appendChild(ui.missing);

    var zoom = Muse.el('div', 'muse-sc-zoom');
    ui.full = button('⤢', 'Full screen', 'muse-sc-full-open');
    ui.full.id = 'muse-sc-full';
    ui.full.addEventListener('click', function () {
      setFull(true);
    });
    zoom.appendChild(ui.full);
    [
      ['+', 'Zoom in', 'muse-sc-in', ZOOM_STEP],
      ['−', 'Zoom out', 'muse-sc-out', 1 / ZOOM_STEP],
    ].forEach(function (z) {
      var b = button(z[0], z[1], z[2]);
      b.id = z[2];
      b.addEventListener('click', function () {
        zoomAt(z[3], ui.stage.clientWidth / 2, ui.stage.clientHeight / 2);
      });
      zoom.appendChild(b);
    });
    var fit = button('Fit', 'Show the whole picture', 'muse-sc-fit');
    fit.id = 'muse-sc-fit';
    fit.addEventListener('click', function () {
      sc.scale = 1;
      applyView();
    });
    zoom.appendChild(fit);
    ui.stage.appendChild(zoom);

    wireStage(ui.stage);
    wrap.appendChild(ui.stage);
    ui.hint = Muse.el('p', 'muse-hint hidden', 'Tap the picture where the point goes.');
    ui.hint.id = 'muse-sc-hint';
    wrap.appendChild(ui.hint);
    return wrap;
  }

  function buildSide() {
    var side = Muse.el('div', 'muse-sc-side');
    side.id = 'muse-sc-side';
    ui.add = Muse.el('button', 'muse-btn muse-sc-add hidden', 'Add point');
    ui.add.type = 'button';
    ui.add.id = 'muse-sc-add-point';
    ui.add.setAttribute('aria-pressed', 'false');
    ui.add.addEventListener('click', toggleAdding);
    side.appendChild(ui.add);
    // The picked point's card, just under the picture (by its pin in full).
    ui.card = Muse.el('div', 'muse-sc-card hidden');
    ui.card.id = 'muse-sc-card';
    side.appendChild(ui.card);
    ui.list = Muse.el('ol', 'muse-sc-points');
    ui.list.id = 'muse-sc-points';
    side.appendChild(ui.list);
    ui.empty = Muse.el('p', 'muse-empty');
    side.appendChild(ui.empty);
    return side;
  }

  // The picture, from the studio's record of it.
  function loadPicture(s) {
    var id = s.image;
    Muse.photos.info(id).then(function (found) {
      if (!ui || ui.image !== id) return;
      if (!found) {
        Muse.show(ui.missing, true);
        return;
      }
      ui.img.alt = s.name;
      ui.img.addEventListener('load', function () {
        var w = ui.img.naturalWidth || 4;
        var h = ui.img.naturalHeight || 3;
        ui.ratio = w / h;
        ui.stage.style.setProperty('--w', w);
        ui.stage.style.setProperty('--h', h);
        applyView();
      });
      Muse.photos.thumb(ui.img, found);
    });
  }

  // Everything that follows the schematic's data: the pins, the list, the
  // card, the name, and whether its picture changed.
  function refresh(s) {
    if (ui.image !== s.image) {
      ui.image = s.image;
      Muse.show(ui.missing, false);
      loadPicture(s);
    }
    if (document.activeElement !== ui.name) ui.name.value = s.name;
    var at = S.inOrder(sc.list).map(function (x) {
      return x.id;
    });
    ui.earlier.disabled = at.indexOf(s.id) <= 0;
    ui.later.disabled = at.indexOf(s.id) === at.length - 1;
    if (sc.selected && !pointAt(s, sc.selected)) sc.selected = null;
    drawPins(s);
    drawList(s);
    refreshEdit();
    refreshAdding();
    refreshDanger();
    refreshFull(); // draws the card where it goes, and the view
  }

  function refreshAdding() {
    [ui.add, ui.fullAdd].forEach(function (b) {
      b.setAttribute('aria-pressed', String(sc.adding));
      b.textContent = sc.adding ? 'Cancel adding' : 'Add point';
    });
    ui.stage.classList.toggle('muse-sc-adding', sc.adding);
    Muse.show(ui.hint, sc.adding);
  }

  function refreshDanger() {
    var s = current();
    Muse.show(ui.confirm, sc.confirming);
    Muse.show(ui.remove, !sc.confirming);
    if (s) {
      ui.confirmText.textContent =
        'Remove ' +
        s.name +
        (s.points.length
          ? ' and its ' + s.points.length + ' point' + (s.points.length === 1 ? '' : 's')
          : '') +
        '? The picture stays in the studio.';
    }
  }

  function pinNode(s, p, i) {
    var pin = Muse.el('button', 'muse-sc-pin', String(i + 1));
    pin.type = 'button';
    pin.dataset.id = p.id;
    pin.style.left = p.x * 100 + '%';
    pin.style.top = p.y * 100 + '%';
    pin.setAttribute('aria-label', 'Point ' + (i + 1) + ': ' + p.name);
    if (p.id === sc.selected) pin.classList.add('muse-sc-on');
    pin.setAttribute('aria-pressed', String(p.id === sc.selected));
    // A key press on a focused pin picks it (a click with no pointer).
    pin.addEventListener('click', function (event) {
      if (event.detail === 0) pick(p.id);
    });
    return pin;
  }

  function drawPins(s) {
    ui.pins.textContent = '';
    s.points.forEach(function (p, i) {
      ui.pins.appendChild(pinNode(s, p, i));
    });
  }

  function drawList(s) {
    ui.list.textContent = '';
    s.points.forEach(function (p, i) {
      var li = Muse.el('li', 'muse-sc-item');
      var row = Muse.el('button', 'muse-sc-row');
      row.type = 'button';
      row.dataset.id = p.id;
      var on = p.id === sc.selected;
      row.classList.toggle('muse-sc-on', on);
      row.setAttribute('aria-pressed', String(on));
      row.appendChild(Muse.el('span', 'muse-sc-num', String(i + 1)));
      row.appendChild(Muse.el('span', 'muse-sc-row-name', p.name));
      if (p.link) {
        var linked = Muse.elements.nameOf(p.link);
        row.appendChild(
          Muse.el('span', 'muse-sc-row-link', '→ ' + (linked || 'a retired element'))
        );
      }
      row.addEventListener('click', function () {
        pick(p.id, true);
      });
      li.appendChild(row);
      ui.list.appendChild(li);
    });
    Muse.show(ui.empty, s.points.length === 0);
  }

  // Picks a point, or puts it down when it is the one picked: the pin and its
  // row light up together. Picked from the full screen's list, the picture
  // comes round to its pin, and on a narrow screen the list gets out of the way.
  function pick(id, fromList) {
    sc.selected = sc.selected === id ? null : id;
    sc.editing = false;
    var s = current();
    drawPins(s);
    drawList(s);
    if (sc.full && fromList && sc.selected) {
      if (narrow()) {
        sc.drawer = false;
        refreshFull();
      }
      if (sc.scale > 1) centerOn(pointAt(s, sc.selected), sc.scale);
    }
    drawCard(s);
  }

  // ── A point's card ──────────────────────────────
  function elementSelect(value) {
    var select = Muse.el('select', 'muse-input muse-select');
    var none = Muse.el('option', '', '— No link —');
    none.value = '';
    select.appendChild(none);
    Muse.elements.listOf().forEach(function (entry) {
      var option = Muse.el('option', '', entry.name + ' (' + Muse.TYPE[entry.type].one + ')');
      option.value = entry.id;
      select.appendChild(option);
    });
    if (value && !Muse.elements.nameOf(value)) {
      var gone = Muse.el('option', '', 'A retired element');
      gone.value = value;
      select.appendChild(gone);
    }
    select.value = value || '';
    return select;
  }

  // The picked point's card: under the picture, or by its pin in full.
  function drawCard(s) {
    var card = sc.full ? ui.pop : ui.card;
    ui.card.textContent = '';
    ui.pop.textContent = '';
    var p = sc.selected && pointAt(s, sc.selected);
    Muse.show(ui.card, !!p && !sc.full);
    Muse.show(ui.pop, !!p && sc.full);
    if (!p) return;
    var number = numberOf(s, p.id);
    if (sc.editing && sc.edit) {
      drawEdit(card, p, number);
      placePop();
      return;
    }
    var head = Muse.el('h3', 'muse-sc-card-name');
    head.appendChild(Muse.el('span', 'muse-sc-num', String(number)));
    head.appendChild(Muse.el('span', '', p.name));
    card.appendChild(head);
    if (p.description.trim()) {
      var text = Muse.el('div', 'muse-reading muse-sc-text');
      Muse.markdown.into(text, p.description, {});
      card.appendChild(text);
    }
    if (p.link) {
      var row = Muse.el('p', 'muse-sc-link');
      row.appendChild(document.createTextNode('Links to '));
      var name = Muse.elements.nameOf(p.link);
      if (name) {
        var a = Muse.el('a', 'muse-el-link muse-sc-link-a', name);
        a.href = projectHash() + '/e/' + encodeURIComponent(p.link);
        a.dataset.el = p.link;
        row.appendChild(a);
      } else {
        row.appendChild(Muse.el('span', 'muse-gone', 'a retired element'));
      }
      card.appendChild(row);
    }
    if (sc.edit) card.appendChild(cardActions(p));
    placePop();
  }

  // A point's Edit and Remove, while editing.
  function cardActions(p) {
    var actions = Muse.el('div', 'muse-sc-actions');
    var edit = button('Edit', '');
    edit.id = 'muse-sc-edit';
    edit.addEventListener('click', function () {
      sc.editing = true;
      drawCard(current());
    });
    var remove = button('Remove point', '');
    remove.id = 'muse-sc-remove-point';
    remove.addEventListener('click', function () {
      var id = p.id;
      sc.selected = null;
      act(Muse.schematicStore.removePoint(current(), id));
    });
    actions.appendChild(edit);
    actions.appendChild(remove);
    return actions;
  }

  // In full, the card sits beside its pin: to the right, or to the left when
  // the pin is in the right half, and kept on the screen.
  function placePop() {
    if (!ui || !sc.full || ui.pop.classList.contains('hidden')) return;
    var s = current();
    var p = s && sc.selected && pointAt(s, sc.selected);
    if (!p) return;
    var body = ui.body.getBoundingClientRect();
    var stage = ui.stage.getBoundingClientRect();
    var b = base();
    var x = stage.left - body.left + sc.tx + p.x * b.w * sc.scale;
    var y = stage.top - body.top + sc.ty + p.y * b.h * sc.scale;
    var w = ui.pop.offsetWidth;
    var h = ui.pop.offsetHeight;
    var gap = 24;
    var left = x - (stage.left - body.left) > stage.width / 2 ? x - gap - w : x + gap;
    var top = y - 30;
    var margin = 8;
    left = Math.max(margin, Math.min(body.width - w - margin, left));
    top = Math.max(stage.top - body.top + margin, Math.min(body.height - h - margin, top));
    ui.pop.style.left = left + 'px';
    ui.pop.style.top = top + 'px';
  }

  function drawEdit(card, p, number) {
    var form = Muse.el('form', 'muse-form muse-sc-form');
    form.noValidate = true;
    form.appendChild(Muse.el('h3', 'muse-sc-card-name', 'Point ' + number));
    var name = Muse.el('input', 'muse-input');
    name.id = 'muse-sc-p-name';
    name.maxLength = S.LIMITS.name;
    name.autocomplete = 'off';
    name.value = p.name;
    var nameLabel = Muse.el('label', 'muse-label', 'Name');
    nameLabel.htmlFor = name.id;
    var area = Muse.el('textarea', 'muse-input muse-textarea');
    area.id = 'muse-sc-p-description';
    area.rows = 4;
    area.maxLength = S.LIMITS.description;
    area.value = p.description;
    area.placeholder = 'Markdown; @ links an element';
    var areaLabel = Muse.el('label', 'muse-label', 'Description');
    areaLabel.htmlFor = area.id;
    var link = elementSelect(p.link);
    link.id = 'muse-sc-p-link';
    var linkLabel = Muse.el('label', 'muse-label', 'Links to');
    linkLabel.htmlFor = link.id;
    var error = Muse.el('p', 'muse-error hidden');
    error.setAttribute('role', 'alert');
    var save = Muse.el('button', 'muse-btn', 'Save');
    save.type = 'submit';
    save.id = 'muse-sc-p-save';
    var cancel = button('Cancel', '');
    cancel.addEventListener('click', function () {
      sc.editing = false;
      drawCard(current());
    });
    [nameLabel, name, areaLabel, area, linkLabel, link, error].forEach(function (n) {
      form.appendChild(n);
    });
    var row = Muse.el('div', 'muse-sc-actions');
    row.appendChild(save);
    row.appendChild(cancel);
    form.appendChild(row);
    card.appendChild(form);
    Muse.suggest.mention(area);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var input = { name: name.value, description: area.value, link: link.value || null };
      var checked = S.checkPoint(input, p, { elementType: Muse.elements.typeOf });
      if (checked.error) return Muse.say(error, checked.error);
      sc.editing = false;
      act(Muse.schematicStore.changePoint(current(), p.id, input));
    });
    name.focus();
  }

  // ── Zoom and pan (SC8) ──────────────────────────
  // The picture's size at scale 1. On the page the stage has the picture's
  // shape, so it is the stage; in full it is the largest that fits the screen.
  function base() {
    var w = ui.stage.clientWidth;
    var h = ui.stage.clientHeight;
    if (!sc.full || !ui.ratio || !w || !h) return { w: w, h: h };
    return w / h > ui.ratio ? { w: h * ui.ratio, h: h } : { w: w, h: w / ui.ratio };
  }

  // Bigger than the stage, the picture covers it; smaller, it is centred.
  function clampAxis(t, view, size) {
    if (size <= view) return (view - size) / 2;
    return Math.max(view - size, Math.min(0, t));
  }

  function applyView() {
    if (!ui || !ui.stage) return;
    var b = base();
    sc.scale = Math.max(1, Math.min(MAX_SCALE, sc.scale));
    sc.tx = clampAxis(sc.tx, ui.stage.clientWidth, b.w * sc.scale);
    sc.ty = clampAxis(sc.ty, ui.stage.clientHeight, b.h * sc.scale);
    ui.canvas.style.width = b.w + 'px';
    ui.canvas.style.height = b.h + 'px';
    ui.canvas.style.transform =
      'translate(' + sc.tx + 'px, ' + sc.ty + 'px) scale(' + sc.scale + ')';
    ui.stage.style.setProperty('--inv', String(1 / sc.scale));
    ui.stage.dataset.scale = String(Math.round(sc.scale * 100) / 100);
    placePop();
  }

  // Zooms to `scale` with a point in the middle of the stage.
  function centerOn(p, scale) {
    var b = base();
    sc.scale = scale;
    sc.tx = ui.stage.clientWidth / 2 - p.x * b.w * scale;
    sc.ty = ui.stage.clientHeight / 2 - p.y * b.h * scale;
    applyView();
  }

  // Zooms by `factor` about a point of the stage (cx, cy in its pixels).
  function zoomAt(factor, cx, cy) {
    var next = Math.max(1, Math.min(MAX_SCALE, sc.scale * factor));
    var k = next / sc.scale;
    sc.tx = cx - (cx - sc.tx) * k;
    sc.ty = cy - (cy - sc.ty) * k;
    sc.scale = next;
    applyView();
  }

  // The fraction of the picture under a pointer, kept inside it.
  function fractionAt(clientX, clientY) {
    var rect = ui.canvas.getBoundingClientRect();
    var x = rect.width ? (clientX - rect.left) / rect.width : 0;
    var y = rect.height ? (clientY - rect.top) / rect.height : 0;
    return {
      x: Math.round(Math.max(0, Math.min(1, x)) * 10000) / 10000,
      y: Math.round(Math.max(0, Math.min(1, y)) * 10000) / 10000,
    };
  }

  function wireStage(stage) {
    var pointers = {};
    var gesture = null;

    function count() {
      return Object.keys(pointers).length;
    }

    function spread() {
      var a = Object.keys(pointers).map(function (k) {
        return pointers[k];
      });
      return {
        dist: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1,
        x: (a[0].x + a[1].x) / 2,
        y: (a[0].y + a[1].y) / 2,
      };
    }

    stage.addEventListener(
      'wheel',
      function (event) {
        event.preventDefault();
        var rect = stage.getBoundingClientRect();
        zoomAt(
          event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP,
          event.clientX - rect.left,
          event.clientY - rect.top
        );
      },
      { passive: false }
    );

    stage.addEventListener('pointerdown', function (event) {
      if (event.target.closest('.muse-sc-zoom')) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      try {
        stage.setPointerCapture(event.pointerId);
      } catch {
        // Not every browser can; the stage still gets the moves it needs.
      }
      if (count() === 2) {
        var from = spread();
        gesture = {
          type: 'pinch',
          dist: from.dist,
          x: from.x,
          y: from.y,
          scale: sc.scale,
          tx: sc.tx,
          ty: sc.ty,
        };
        return;
      }
      if (count() > 2) return;
      var pin = event.target.closest('.muse-sc-pin');
      // A pin moves only while editing; otherwise a drag from it pans.
      var drags = pin && !sc.adding && sc.edit;
      gesture = {
        type: drags ? 'drag' : 'pan',
        pin: pin,
        id: pin ? pin.dataset.id : null,
        x: event.clientX,
        y: event.clientY,
        tx: sc.tx,
        ty: sc.ty,
        moved: false,
        at: null,
      };
      if (drags) event.preventDefault();
    });

    stage.addEventListener('pointermove', function (event) {
      if (!pointers[event.pointerId]) return;
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
      if (!gesture) return;
      if (gesture.type === 'pinch' && count() === 2) {
        var now = spread();
        var rect = stage.getBoundingClientRect();
        var next = Math.max(1, Math.min(MAX_SCALE, gesture.scale * (now.dist / gesture.dist)));
        var k = next / gesture.scale;
        var cx = gesture.x - rect.left;
        var cy = gesture.y - rect.top;
        sc.scale = next;
        sc.tx = cx - (cx - gesture.tx) * k + (now.x - gesture.x);
        sc.ty = cy - (cy - gesture.ty) * k + (now.y - gesture.y);
        applyView();
        return;
      }
      if (count() !== 1) return;
      var dx = event.clientX - gesture.x;
      var dy = event.clientY - gesture.y;
      if (!gesture.moved && Math.hypot(dx, dy) < DRAG) return;
      gesture.moved = true;
      if (gesture.type === 'drag') {
        // The pin follows the pointer, drawn at once; saved on release.
        gesture.at = fractionAt(event.clientX, event.clientY);
        gesture.pin.style.left = gesture.at.x * 100 + '%';
        gesture.pin.style.top = gesture.at.y * 100 + '%';
        gesture.pin.classList.add('muse-sc-dragging');
      } else {
        sc.tx = gesture.tx + dx;
        sc.ty = gesture.ty + dy;
        applyView();
      }
    });

    function end(event) {
      if (!pointers[event.pointerId]) return;
      delete pointers[event.pointerId];
      var done = gesture;
      if (count() > 0 || !done) {
        if (count() === 0) gesture = null;
        else if (done && done.type === 'pinch') gesture = null;
        return;
      }
      gesture = null;
      if (event.type === 'pointercancel') {
        if (done.pin) drawPins(current());
        return;
      }
      if (done.type === 'drag' && done.moved && done.at) {
        sc.selected = done.id;
        return act(Muse.schematicStore.changePoint(current(), done.id, done.at));
      }
      if (done.moved || done.type === 'pinch') return;
      // A tap.
      if (done.pin) return pick(done.id);
      if (sc.adding) return place(fractionAt(event.clientX, event.clientY));
      // A tap on the picture, off any pin, puts the picked point down.
      if (sc.selected && !sc.editing) pick(sc.selected);
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
  }

  // Adds a point where the picture was tapped, and opens its card to name it.
  function place(at) {
    var s = current();
    sc.adding = false;
    refreshAdding();
    if (s.points.length >= S.LIMITS.points) {
      return say('A schematic has at most ' + S.LIMITS.points + ' points.');
    }
    return act(
      Muse.schematicStore.addPoint(s, {
        name: 'Point ' + (s.points.length + 1),
        x: at.x,
        y: at.y,
        link: null,
      }),
      function (id) {
        sc.selected = id;
        sc.editing = true;
        var now = current();
        if (now) {
          drawPins(now);
          drawList(now);
          drawCard(now);
        }
      }
    );
  }

  // ── Marked on (SC9) ─────────────────────────────
  function drawMarked(found) {
    var section = node('muse-e-marked');
    var list = node('muse-mk-list');
    list.textContent = '';
    found.forEach(function (m) {
      var owner = Muse.elements.nameOf(m.schematic.element);
      var a = Muse.el('a', 'muse-el-row muse-mk-row');
      a.href =
        projectHash() +
        '/e/' +
        encodeURIComponent(m.schematic.element) +
        '/m/' +
        encodeURIComponent(m.schematic.id) +
        '/' +
        encodeURIComponent(m.points[0].id);
      a.dataset.schematic = m.schematic.id;
      a.appendChild(
        Muse.el(
          'span',
          'muse-el-row-name',
          'On ' + (owner ? owner + '’s ' : 'a retired element’s ') + m.schematic.name
        )
      );
      a.appendChild(
        Muse.el(
          'span',
          'muse-el-row-aliases',
          m.points
            .map(function (p) {
              return '#' + p.number + ' ' + p.name;
            })
            .join(' · ')
        )
      );
      list.appendChild(a);
    });
    Muse.show(section, found.length > 0);
  }

  Muse.schematicPage = {
    init: function () {
      node('muse-e-sc-edit').addEventListener('click', function () {
        setEdit(!sc.edit);
      });
      // Escape leaves the full screen, unless it is closing what is typed in.
      document.addEventListener('keydown', function (event) {
        if (event.key !== 'Escape' || !sc.full || !ui) return;
        if (event.target.closest && event.target.closest('input, textarea, select')) return;
        setFull(false);
      });
      // Going anywhere else leaves it too, so the page is never left locked.
      window.addEventListener('hashchange', function () {
        if (sc.full && ui) setFull(false);
      });
      window.addEventListener('resize', function () {
        if (ui) applyView();
      });
      versionBox = Muse.versionForm.mount(node('muse-e-sc-versions-box'), function () {
        return { projectId: state.project.id, collection: 'schematics', id: sc.openId };
      });
      addControls = Muse.photos.adder(node('muse-e-sc-add'), {
        id: 'muse-e-sc-photo',
        multiple: false,
        describe: describe,
        chosen: function () {
          return sc.list.map(function (s) {
            return s.image;
          });
        },
        onAdd: function (ids) {
          var e = sc.element;
          var typed = node('muse-e-sc-new-name').value;
          var name = typed.trim() || 'Schematic ' + (sc.list.length + 1);
          return Muse.schematicStore
            .create(e, { name: name, image: ids[0] }, sc.list)
            .then(function (id) {
              node('muse-e-sc-new-name').value = '';
              return Muse.schematicStore.forElement(e.id).then(function (list) {
                sc.list = list;
                // A new schematic is for adding points to.
                sc.edit = true;
                openSchematic(id);
              });
            });
        },
      });
    },

    // Draws the open element's schematics and where it is marked, opening
    // `opts.schematic` (and picking `opts.point`) when given; called as its
    // page opens.
    show: function (opts) {
      opts = opts || {};
      var e = state.element;
      reset();
      sc.element = e;
      say('');
      node('muse-e-sc-open').textContent = '';
      node('muse-e-sc-new-name').value = '';
      if (addControls) addControls.reset();
      var has = S.TYPES.indexOf(e.type) !== -1;
      Muse.show(node('muse-e-schematics'), has);
      refreshEdit();
      Muse.show(node('muse-e-marked'), false);
      var marked = Muse.schematicStore
        .markedOn(e.id)
        .then(function (found) {
          if (sc.element === e) drawMarked(found);
        })
        .catch(function () {
          // Nothing to show is no worse than a broken page.
        });
      if (!has) return marked;
      return Muse.schematicStore
        .forElement(e.id)
        .then(function (list) {
          if (sc.element !== e) return;
          sc.list = list;
          var wanted = list.filter(function (s) {
            return s.id === opts.schematic;
          })[0];
          sc.openId = wanted ? wanted.id : list.length ? list[0].id : null;
          sc.selected = wanted && opts.point ? opts.point : null;
          draw();
          var s = current();
          var p = s && sc.selected && pointAt(s, sc.selected);
          // Opens the plan at its pin: zoomed in, the pin in the middle.
          if (wanted && p && ui && ui.stage) centerOn(p, 2.5);
          if (wanted) node('muse-e-schematics').scrollIntoView({ block: 'start' });
        })
        .catch(function (err) {
          say('Its schematics couldn’t be read: ' + err.message);
        })
        .then(function () {
          return marked;
        });
    },
  };
})();
