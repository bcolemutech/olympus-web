(function () {
  'use strict';

  var Loom = window.Loom;
  var state = Loom.state;

  // What the panel shows lives in the store's journal; journal.js draws it
  // (L-726 / #597).
  var journal = Loom.journal;

  function setLoading(isLoading) {
    Loom.store.setUi({ busy: Boolean(isLoading) }); // the turn bars and the box
  }

  /**
   * The turn (L-614 / #444): its number, the movement left, and whether the
   * action is used, from loomGetMap's `turn`, for the turn bars.
   */
  // The turn, and the time for the map's clock (L-376): "Day 1, evening",
  // made on the server. Without a new time, the one shown stays.
  function showTurn(turn, time) {
    var before = Loom.store.get().turn;
    var label = time && time.label ? time.label : before && before.time;
    Loom.store.set({ turn: turn ? Object.assign({}, turn, { time: label || null }) : null });
  }

  // An answer's time, shown at once, before the map reloads.
  function showTime(time) {
    var turn = Loom.store.get().turn;
    if (turn && time && time.label) showTurn(turn, time);
  }

  /**
   * Plays a turn via the loomPlayTurn callable: typed text, or a structured
   * move from the world map. The client only ever receives { narration,
   * stateSummary, suggestedActions } — no raw state authority, per the
   * design doc's turn pipeline contract. The map reloads after every turn.
   *
   * A step on a battle map (L-613 / #443) answers with `step` and no
   * narration: only its plain lines ("You're out of movement…") join the
   * story, and the suggestions stay. `options.keep` keeps the suggestions
   * when none come back (ending the turn).
   */
  function playTurn(turn, label, options) {
    if (state.turnInProgress) return;
    options = options || {};
    var kept = journal.suggestions();

    state.turnInProgress = true;
    Loom.engine.follow(); // the camera follows the player's move again (K3)
    setLoading(true);
    journal.setError(null);
    journal.finishReveal();
    journal.setSuggestions([]);
    journal.setConfirm(null); // a confirm card is for the turn before (#673)
    Loom.engine.closeMenu(); // a click menu's choices are for before the turn
    Loom.map.render(); // the cards' buttons disable while a turn runs

    var loomPlayTurn = state.functions.httpsCallable('loomPlayTurn');
    var request = Object.assign({ worldId: state.worldId, saveId: state.saveId }, turn);
    loomPlayTurn(request)
      .then(function (result) {
        state.turnInProgress = false;
        setLoading(false);
        var data = result.data;
        showTime(data.time);
        // A second action turned down (L-614) keeps the suggestions, too.
        var keep = (options.keep || data.refused) && !(data.suggestedActions || []).length;
        // A walk that ends by going in or setting out (L-664), by walking
        // into a hazard (L-815), or into sight of a foe (L-821), is narrated,
        // its roll a card.
        var told = data.step && (data.step.entered || data.step.left || data.step.hazard);
        // Everyone else's turns (L-828; combat UI3): played out on the map,
        // their attack cards rolling themselves; Faster skips the show.
        var faster = Boolean(Loom.store.get().ui.faster);
        var turns = data.turns || [];
        if (turns.length && Loom.battle.playOut) Loom.battle.playOut(turns, faster);
        var cards = turns
          .filter(function (t) {
            return t.attack && t.attack.card;
          })
          .map(function (t) {
            return { name: t.name + ' · ' + t.attack.card.name, roll: t.attack.card };
          });
        if (data.confirm) {
          // What it would do, to confirm first (#673): nothing done yet.
          journal.setConfirm(data.confirm);
          journal.setSuggestions(kept);
        } else if (data.step && !told && !data.step.fight) {
          if (data.step.lines.length) journal.add(label, data.step.lines.join(' '));
          journal.setSuggestions(kept);
        } else {
          // The roll as a card (L4); the foes' after it.
          journal.add(label, data.narration, data.roll, { cards: cards, faster: faster });
          journal.setSuggestions(keep ? kept : data.suggestedActions);
        }
        journal.setSummary(data.stateSummary);
        var before = Loom.store.get().map;
        Loom.map.load().then(function () {
          journal.arrived(before, Loom.store.get().map); // the banner (A5)
        });
      })
      .catch(function (err) {
        state.turnInProgress = false;
        setLoading(false);
        Loom.map.render();
        journal.setSuggestions(kept);
        journal.setError('The Loom faltered: ' + (err.message || 'Unknown error'));
      });
  }

  /**
   * One of the GM's suggestions (#673), `{ text, verb?, target? }` or plain
   * text: the server answers with what it would do, to confirm first.
   */
  function suggest(suggestion) {
    var text = typeof suggestion === 'string' ? suggestion : suggestion.text;
    var action = { verb: 'suggested', text: text };
    if (suggestion.verb) {
      action.act = { verb: suggestion.verb };
      if (suggestion.target) action.act.target = suggestion.target;
    }
    playTurn({ action: action }, text, { keep: true });
  }

  /** Do it (#673): the action on the confirm card, walked to and done. */
  function confirm(label) {
    playTurn({ action: { verb: 'confirm' } }, label);
  }

  function submitTurn(actionText) {
    var trimmed = (actionText || '').trim();
    if (!trimmed) return;
    playTurn({ actionText: trimmed }, trimmed);
  }

  /** Travels to a place chosen on the world map (L-332 / #394). */
  function travelTo(locationId, name) {
    playTurn({ action: { verb: 'move', target: locationId } }, 'travel to ' + name);
  }

  /**
   * Steps to a cell on a battle map, from the grid view (L-354 / #403): as far
   * as this turn's movement goes, keeping the rest as the plan (L-613).
   */
  function moveToCell(cell, label) {
    playTurn({ action: { verb: 'move', cell: { x: cell.x, y: cell.y } } }, label);
  }

  /**
   * Walks in a town with ground (L-664), to `target`: { point: { x, y } } or
   * { target: <place id> }, as far as this turn's movement goes.
   */
  function walkTo(target, label) {
    playTurn({ action: Object.assign({ verb: 'move' }, target) }, label);
  }

  /** "Walk there" (L-664): walks on, turn after turn, until it arrives. */
  function walkThere(target, label) {
    playTurn({ action: Object.assign({ verb: 'walk-there' }, target) }, label);
  }

  /** Walks the plan kept from an earlier move (L-613 / #443). */
  function continuePlan() {
    playTurn({ action: { verb: 'continue' } }, 'continue');
  }

  /** Opens (open true) or closes a door beside the player, for 1 movement (L-625, L-627). */
  function doorAction(doorId, open, label) {
    playTurn({ action: { verb: 'door', door: doorId, open: open } }, label);
  }

  /**
   * "What's here?" on the battle map (#672): the GM describes a square, or a
   * door, from what the player knows of it. Free: the suggestions stay.
   */
  function lookAt(target, label) {
    playTurn({ action: Object.assign({ verb: 'look' }, target) }, label, { keep: true });
  }

  /**
   * An attack at someone on the battle map (L-828; combat UI2): with one of
   * the character's attacks, to knock out when the Subdue toggle is on.
   */
  function attack(targetId, attackId, label) {
    var subdue = Boolean(Loom.store.get().ui.subdue);
    playTurn(
      {
        action: Object.assign(
          { verb: 'attack', target: targetId, attack: attackId },
          subdue ? { subdue: true } : {}
        ),
      },
      label + (subdue ? ' (to subdue)' : '')
    );
  }

  /**
   * A fight's other actions (L-828; combat TN5): Dash, Dodge, Withdraw, Ready
   * (`extra`: { attack, target? }) and Use (`extra`: { feature }).
   */
  function tactic(verb, extra, label) {
    playTurn({ action: Object.assign({ verb: verb }, extra || {}) }, label);
  }

  /** Ends the turn: movement and the action refilled (L-611 / #441). */
  function endTurn() {
    playTurn({ action: { verb: 'end-turn' } }, 'end turn', { keep: true });
  }

  /** Resets the play view for a newly-selected save; resolves once its map has loaded. */
  function init(saveId, save) {
    state.saveId = saveId;

    journal.reset(save.recentSummary || '');
    setLoading(false);
    var input = document.getElementById('loom-turn-input');
    if (input) input.value = '';

    showTurn(null);
    Loom.map.reset();
    return Loom.map.load(); // the loading cover stays until it has (L-729)
  }

  Loom.play = {
    init: init,
    submitTurn: submitTurn,
    travelTo: travelTo,
    moveToCell: moveToCell,
    continuePlan: continuePlan,
    walkTo: walkTo,
    walkThere: walkThere,
    doorAction: doorAction,
    suggest: suggest,
    confirm: confirm,
    lookAt: lookAt,
    attack: attack,
    tactic: tactic,
    endTurn: endTurn,
    showTurn: showTurn,
  };
})();
