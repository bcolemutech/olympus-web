(function () {
  'use strict';

  // Relationships on an element's page (planning/the-muse.md §3 EL3, EL4;
  // M-103 / #891): each one read from this element's side ("mother of Anne"
  // here, "daughter of Peter" on Anne's page), with its description; added,
  // edited and removed from either element. A list, no graph yet (EL4); the
  // time on the timeline comes with M-300.
  //
  // The words and the plans are in ./links.js; this draws them and does them.

  var Muse = window.Muse;
  var state = Muse.state;
  var L = Muse.links;

  var rels = []; // this element's relationships, as stored: { id, a, b, aToB, bToA, description }
  var editing = null; // the relationship being edited; null when adding
  var chosen = null; // the other element picked in the form

  function self() {
    return state.element;
  }

  function projectId() {
    return state.project.id;
  }

  function collection() {
    return Muse.elements.projectRef(projectId()).collection('relationships');
  }

  function fromDoc(doc) {
    var d = doc.data() || {};
    return {
      id: doc.id,
      a: d.a,
      b: d.b,
      aToB: d.aToB || '',
      bToA: d.bToA || '',
      description: d.description || '',
    };
  }

  function load() {
    return collection()
      .where('ends', 'array-contains', self().id)
      .get()
      .then(function (snap) {
        rels = snap.docs.map(fromDoc);
      });
  }

  // ── Drawing ─────────────────────────────────────
  function otherLink(id) {
    var name = Muse.elements.nameOf(id);
    if (!name) return Muse.el('span', 'muse-gone', 'A retired element');
    var a = Muse.el('a', 'muse-el-link', name);
    a.href = '#/p/' + encodeURIComponent(projectId()) + '/e/' + encodeURIComponent(id);
    a.dataset.el = id;
    return a;
  }

  function sorted() {
    return rels
      .map(function (rel) {
        return L.sideOf(rel, self().id);
      })
      .filter(Boolean)
      .sort(function (x, y) {
        var nx = Muse.elements.nameOf(x.other) || '';
        var ny = Muse.elements.nameOf(y.other) || '';
        return (
          nx.localeCompare(ny, undefined, { sensitivity: 'base' }) ||
          x.kind.localeCompare(y.kind) ||
          (x.id < y.id ? -1 : 1)
        );
      });
  }

  function drawRow(side) {
    var row = Muse.el('li', 'muse-rel');
    row.dataset.id = side.id;
    var line = Muse.el('div', 'muse-rel-line');
    line.appendChild(Muse.el('span', 'muse-rel-kind', side.kind));
    line.appendChild(otherLink(side.other));
    var actions = Muse.el('span', 'muse-rel-actions');
    var edit = Muse.el('button', 'muse-btn muse-btn-quiet muse-btn-small', 'Edit');
    edit.type = 'button';
    edit.setAttribute(
      'aria-label',
      'Edit ' + side.kind + ' ' + (Muse.elements.nameOf(side.other) || '')
    );
    edit.addEventListener('click', function () {
      openForm(side.id);
    });
    var remove = Muse.el('button', 'muse-btn muse-btn-quiet muse-btn-small', 'Remove');
    remove.type = 'button';
    remove.setAttribute(
      'aria-label',
      'Remove ' + side.kind + ' ' + (Muse.elements.nameOf(side.other) || '')
    );
    remove.addEventListener('click', function () {
      confirmRemove(row, side);
    });
    actions.appendChild(edit);
    actions.appendChild(remove);
    line.appendChild(actions);
    row.appendChild(line);
    if (side.description) row.appendChild(Muse.el('p', 'muse-rel-desc', side.description));
    return row;
  }

  function draw() {
    var list = Muse.$('muse-r-list');
    list.textContent = '';
    var sides = sorted();
    sides.forEach(function (side) {
      list.appendChild(drawRow(side));
    });
    Muse.show(Muse.$('muse-r-empty'), sides.length === 0);
  }

  // ── Removing ────────────────────────────────────
  function confirmRemove(row, side) {
    var old = row.querySelector('.muse-rel-confirm');
    if (old) return;
    var box = Muse.el('div', 'muse-confirm muse-rel-confirm');
    box.setAttribute('role', 'alertdialog');
    box.appendChild(Muse.el('p', '', 'Remove this relationship from both elements?'));
    var actions = Muse.el('div', 'muse-actions');
    var yes = Muse.el('button', 'muse-btn muse-btn-danger', 'Remove it');
    yes.type = 'button';
    var no = Muse.el('button', 'muse-btn muse-btn-quiet', 'Keep it');
    no.type = 'button';
    actions.appendChild(yes);
    actions.appendChild(no);
    box.appendChild(actions);
    row.appendChild(box);
    no.focus();
    no.addEventListener('click', function () {
      box.remove();
    });
    yes.addEventListener('click', function () {
      yes.disabled = true;
      run(Muse.elements.commit(L.planUnrelate(projectId(), side.id)));
    });
  }

  // Does a write, then reads the list again.
  function run(promise) {
    Muse.say(Muse.$('muse-r-error'), '');
    return promise
      .then(load)
      .then(function () {
        draw();
        closeForm();
      })
      .catch(function (err) {
        Muse.say(Muse.$('muse-r-error'), 'That didn’t work: ' + err.message);
      });
  }

  // ── The form ────────────────────────────────────
  function openForm(relationshipId) {
    var me = self();
    editing = null;
    chosen = null;
    var side = null;
    if (relationshipId) {
      editing = rels.filter(function (r) {
        return r.id === relationshipId;
      })[0];
      side = editing && L.sideOf(editing, me.id);
      if (!side) return;
      chosen = side.other;
    }
    var form = Muse.$('muse-r-form');
    Muse.show(form, true);
    Muse.show(Muse.$('muse-r-add'), false);
    Muse.say(Muse.$('muse-r-form-error'), '');
    var other = Muse.$('muse-r-other');
    var fixed = Muse.$('muse-r-fixed');
    Muse.show(other, !side);
    Muse.show(Muse.$('muse-r-other-label'), !side);
    Muse.show(fixed, !!side);
    fixed.textContent = '';
    if (side) fixed.appendChild(otherLink(side.other));
    other.value = '';
    Muse.$('muse-r-kind').value = side ? side.kind : '';
    Muse.$('muse-r-back').value = side && side.back !== side.kind ? side.back : '';
    Muse.$('muse-r-desc').value = side ? side.description : '';
    labels();
    (side ? Muse.$('muse-r-kind') : other).focus();
  }

  // The two sentences' labels carry the names, so each reads as a sentence.
  function labels() {
    var me = self();
    var theirs = chosen ? Muse.elements.nameOf(chosen) : null;
    Muse.$('muse-r-kind-label').textContent = me.name + ' is…';
    Muse.$('muse-r-back-label').textContent = (theirs || 'The other') + ' is… (blank: the same)';
  }

  function closeForm() {
    editing = null;
    chosen = null;
    Muse.show(Muse.$('muse-r-form'), false);
    Muse.show(Muse.$('muse-r-add'), true);
    Muse.say(Muse.$('muse-r-form-error'), '');
  }

  function submit(event) {
    event.preventDefault();
    var me = self();
    var error = Muse.$('muse-r-form-error');
    var button = Muse.$('muse-r-save');
    var kind = Muse.$('muse-r-kind').value;
    var back = Muse.$('muse-r-back').value;
    var description = Muse.$('muse-r-desc').value;
    var plan;
    if (editing) {
      var kinds = L.checkKinds({ aToB: kind, bToA: back, description: description });
      if (kinds.error) return Muse.say(error, kinds.error);
      var words = L.fromSide(editing, me.id, kinds.value.aToB, kinds.value.bToA);
      plan = L.planRelationshipUpdate(projectId(), editing.id, {
        aToB: words.aToB,
        bToA: words.bToA,
        description: kinds.value.description,
      });
    } else {
      var checked = L.checkRelationship(
        { a: me.id, b: chosen, aToB: kind, bToA: back, description: description },
        { elementType: Muse.elements.typeOf }
      );
      if (checked.error) return Muse.say(error, checked.error);
      plan = L.planRelate(projectId(), collection().doc().id, checked.value);
    }
    Muse.say(error, '');
    button.disabled = true;
    Muse.elements
      .commit(plan)
      .then(load)
      .then(function () {
        draw();
        closeForm();
      })
      .catch(function (err) {
        Muse.say(error, 'It couldn’t be saved: ' + err.message);
      })
      .then(function () {
        button.disabled = false;
      });
  }

  Muse.relationships = {
    init: function () {
      Muse.$('muse-r-add').addEventListener('click', function () {
        openForm();
      });
      Muse.$('muse-r-cancel').addEventListener('click', closeForm);
      Muse.$('muse-r-form').addEventListener('submit', submit);
      var other = Muse.$('muse-r-other');
      Muse.suggest.input(other, {
        empty: true,
        limit: 8,
        except: function () {
          return self() && self().id;
        },
        choose: function (result) {
          chosen = result.id;
          other.value = result.name;
          labels();
          Muse.$('muse-r-kind').focus();
        },
      });
      // Typing over a pick forgets it.
      other.addEventListener('input', function () {
        chosen = null;
        labels();
      });
    },

    // Draws the open element's relationships.
    show: function () {
      closeForm();
      Muse.say(Muse.$('muse-r-error'), '');
      Muse.show(Muse.$('muse-e-relationships'), true);
      return load()
        .then(draw)
        .catch(function (err) {
          rels = [];
          draw();
          Muse.say(Muse.$('muse-r-error'), 'Relationships couldn’t be read: ' + err.message);
        });
    },
  };
})();
