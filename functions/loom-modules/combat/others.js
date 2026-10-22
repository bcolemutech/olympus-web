'use strict';

/**
 * Everyone else's turns (planning/combat.md §3 EN3, EN4, EN6, §4.6; L-824 /
 * #656): after the player's turn, each other fighter in the fight takes
 * theirs in order, to the player's next, by the rules alone (CB0): their
 * tactics (./tactics.js) choose a move and an attack, the attack is rolled
 * (./strike.js), their conditions tick (L-815), and morale is rolled when
 * their side falters.
 *
 *   Morale (EN4)   when half of the hostile side is down, or its leader
 *                  falls, each of the rest rolls the system's morale check at
 *                  the rung for their posture (settings' `morale`), once for
 *                  each; failing, they run for the nearest way off the map,
 *                  or surrender with no way out. A cowardly fighter left with
 *                  a quarter of its health or less runs without a roll.
 *   Position (L-823)  each attack by where the two stand (./position.js:
 *                  range, cover, flanking, Dodge), and the target's
 *                  defending reaction; each walk draws reactions (./
 *                  reactions.js: leaving reach, the player's readied attack),
 *                  and a fighter struck down on the way stops there. The
 *                  player's Dodge and readied attack end when their turn
 *                  comes round.
 *   The player at 0  falls by the system's down kind (./down.js; L-827):
 *                  dying, out, or a wound that keeps them up. Down, they leave
 *                  the fight, which goes on while an ally of theirs stands;
 *                  nobody targets them.
 *
 * Pure: the dice come from the caller. Works on copies and returns what
 * changed, for ./play.js to write.
 */

const checks = require('../../loom-canon/checks');
const sheets = require('../../loom-canon/sheets');
const effects = require('../../loom-canon/effects');
const conditions = require('../../loom-canon/conditions');
const maps = require('../../loom-canon/maps');
const fight = require('./fight');
const tactics = require('./tactics');
const { strike, spendAmmo } = require('./strike');
const { attacksOf } = require('./attacks');
const { settingsOf } = require('./settings');
const figures = require('./figures');
const down = require('./down');
const position = require('./position');
const reactions = require('./reactions');

const { PLAYER } = fight;
const copyOf = (v) => JSON.parse(JSON.stringify(v));
const key = (cell) => cell.x + ',' + cell.y;

/**
 * Plays the turns of everyone but the player, from the one after the current
 * turn (or the current one itself, with `current`: a fight just begun) to the
 * player's next. `save` is the save as it stands (its fight, figures, sheet
 * and square); `now` the time the turns are played at.
 *
 * Returns `{ fight (null when it ended), figures, sheet (the player's, when
 * changed), lines, rounds, turns: [{ id, path, attack?, reactions? }], ended?: { winner,
 * how }, down?: the player's state when they fell }`.
 */
function playOthers(world, save, { dice, current = false, now = 0 }) {
  const system = checks.systemOf(world);
  const settings = settingsOf(system);
  const health = settings.health;
  const states = copyOf((save && save.figures) || {});
  let sheet = copyOf(sheets.sheetOf(save) || sheets.defaultSheet(system));
  let sheetChanged = false;
  let f = copyOf(save.fight);
  const lines = [];
  const turns = [];
  let rounds = 0;
  let ended = null;
  let playerDown = null;
  const { map, cell: playerCell } = maps.positionOf(world, save);
  const doors = ((save && save.doors) || {})[map ? map.id : ''] || {};
  const view = () => figures.withFigures(world, { ...save, figures: states });
  const sheetOf = (id, character) =>
    (states[id] && states[id].sheet) ||
    (character && character.sheet) ||
    sheets.defaultSheet(system);
  const maxOf = (s) => (health ? sheets.maxima(system, s)[health] || 0 : 0);
  const healthOf = (s) => {
    const held = s && s.resources && s.resources[health];
    return held && Number.isFinite(held.current) ? held.current : maxOf(s);
  };

  // Everyone in the fight still standing, where they are now.
  const fighters = () => {
    const world2 = view();
    const out = [];
    for (const id of f.order) {
      const c = f.combatants[id];
      if (!c || c.out) continue;
      if (id === PLAYER) {
        out.push({ id, name: 'you', side: 'party', cell: playerCell, sheet, max: maxOf(sheet) });
        continue;
      }
      const character = world2.characters[id];
      if (!character || character.retired || !character.cell) continue;
      const s = sheetOf(id, character);
      out.push({ ...character, id, side: c.side, cell: character.cell, sheet: s, max: maxOf(s) });
    }
    return out;
  };

  // Morale (EN4): when half the hostile side is down, or its leader falls.
  const checkMorale = () => {
    const morale = settings.morale;
    if (!morale) return;
    const hostile = Object.entries(f.combatants).filter(([, c]) => c.side === 'hostile');
    const down = hostile.filter(([, c]) => c.out === 'down');
    const leaderDown = hostile.some(([, c]) => c.leader && c.out === 'down');
    const half = down.length * 2 >= hostile.length;
    if (!half && !leaderDown) return;
    const world2 = view();
    for (const [id, c] of hostile) {
      if (c.out || c.fleeing || c.moraleRolled) continue;
      c.moraleRolled = true;
      const character = world2.characters[id] || {};
      const posture = figures.postureOf(character);
      const rungName = (morale.rungs || {})[posture];
      if (!rungName) continue;
      const rung = system.checks.ladder.find((r) => r.name === rungName);
      const roll = checks.rollCheck(system, {
        check: morale.check,
        character: { sheet: sheetOf(id, character) },
        difficulty: rung,
        dice,
      });
      if (roll.success) continue;
      breakOf(id, c, character.name || c.name);
    }
  };

  // Breaking (EN4): running for the nearest way out, or surrendering.
  const breakOf = (id, c, name) => {
    const way = map && (map.exits || []).length;
    if (way) {
      c.fleeing = true;
      lines.push(`${name} breaks and runs.`);
    } else {
      f = fight.leave(f, id, 'surrendered');
      lines.push(`${name} throws down their weapons.`);
    }
  };

  // One fighter's turn.
  const act = (id) => {
    let c = f.combatants[id];
    const world2 = view();
    const character = world2.characters[id];
    if (!character || character.retired || !character.cell) {
      f = fight.leave(f, id, 'gone');
      return;
    }
    let mine = sheetOf(id, character);
    const flags = conditions.flagsOf(system, mine);
    // A cowardly fighter nearly done for runs without a roll.
    if (
      !c.fleeing &&
      c.side === 'hostile' &&
      figures.postureOf(character) === 'cowardly' &&
      healthOf(mine) * 4 <= maxOf(mine)
    ) {
      breakOf(id, c, character.name);
      if (f.combatants[id].out) return;
    }
    const all = fighters();
    const me = all.find((x) => x.id === id);
    const foes = all.filter(
      (x) => x.id !== id && (c.side === 'hostile' ? x.side !== 'hostile' : x.side === 'hostile')
    );
    const friends = all.filter((x) => x.id !== id && !foes.includes(x));
    const occupied = new Set(
      Object.values(world2.characters)
        .filter((x) => !x.retired && x.cell && x.id !== id)
        .filter(
          (x) => (maps.characterHost(world2, x) || {}).id === (maps.hostOf(world2, save) || {}).id
        )
        .map((x) => key(x.cell))
        .concat(playerCell ? [key(playerCell)] : [])
    );
    const usable = attacksOf(system, mine).filter((a) => !spendAmmo(system, mine, a).refused);
    const plan = tactics.planTurn({
      me: {
        id,
        cell: me.cell,
        side: c.side,
        role: figures.roleOf(system, { ...character, sheet: mine }),
        posture: figures.postureOf(character),
        fleeing: Boolean(c.fleeing),
        attacks: usable,
        speed: sheets.speedFor(system, mine),
        noMove: flags.noMove.length > 0,
        noAction: flags.noAction.length > 0,
      },
      foes,
      friends,
      occupied,
      map,
      doors,
      health,
    });
    const record = { id, path: [] };
    // Walking, with the reactions it draws on the way (L-823: leaving
    // someone's reach, a readied attack). Struck down, they stop there.
    const walk = (path, from) => {
      if (!path.length) return { reached: 0, down: null };
      const r = reactions.reactToWalk(system, {
        map,
        doors,
        fight: f,
        mover: { id, side: c.side, name: character.name, sheet: mine },
        from,
        path,
        fighters: fighters().filter((x) => x.id !== id),
        now,
        dice,
      });
      f = r.fight;
      c = f.combatants[id];
      mine = r.sheet;
      lines.push(...r.lines);
      for (const [rid, s] of Object.entries(r.sheets)) {
        if (rid === PLAYER) {
          sheet = s;
          sheetChanged = true;
        } else states[rid] = { ...(states[rid] || {}), sheet: s };
      }
      if (r.struck.length) record.reactions = (record.reactions || []).concat(r.struck);
      const walked = path.slice(0, r.reached);
      record.path.push(...walked);
      if (walked.length) moved(walked[walked.length - 1]);
      return r;
    };
    const moved = (cell) => {
      states[id] = { ...(states[id] || {}), cell: { x: cell.x, y: cell.y } };
    };
    const fell = (how) => {
      states[id] = { ...(states[id] || {}), sheet: mine, down: how };
      f = fight.leave(f, id, 'down');
      turns.push(record);
    };
    const there = walk(plan.path, me.cell);
    if (there.down) return fell(there.down);
    if (plan.fled && there.reached === plan.path.length) {
      states[id] = { ...(states[id] || {}), sheet: mine, gone: 'fled' };
      f = fight.leave(f, id, 'fled');
      lines.push(`${character.name} flees.`);
      turns.push(record);
      return;
    }
    const from = record.path.length ? record.path[record.path.length - 1] : me.cell;
    if (plan.attack && !plan.fled) {
      const { attack, target } = plan.attack;
      const spent = spendAmmo(system, mine, attack);
      mine = spent.sheet;
      const targetSheet = target.id === PLAYER ? sheet : sheetOf(target.id, target);
      // Where they stand (L-823): range, cover, flanking, Dodge; and the
      // target's defending reaction, if they have one left.
      const theirs = f.combatants[target.id] || {};
      const terms = position.termsFor(system, {
        map,
        doors,
        attack,
        from,
        to: target.cell,
        friends: friends.filter((x) => x.cell).map((x) => x.cell),
        dodging: Boolean(theirs.dodging),
      });
      const defend =
        theirs.reactionsLeft > 0 ? position.defendOf(system, targetSheet, attack) : null;
      const struck = strike(system, {
        attacker: { name: character.name, sheet: mine },
        attack,
        bonus: terms.bonus,
        targets: [
          {
            id: target.id,
            name: target.id === PLAYER ? 'you' : target.name,
            sheet: targetSheet,
            guard: terms.guard,
            ...(defend ? { reaction: defend } : {}),
          },
        ],
        now,
        dice,
      });
      const r = struck.results[0];
      if (r.reacted) f.combatants[target.id].reactionsLeft -= 1;
      lines.push(
        ...r.lines.map((line, i) =>
          i === 0 && !r.reacted
            ? line.replace(/\.$/, '') +
              ` (${struck.roll.total} against ${r.opposed ? r.opposed.total : r.difficulty}).`
            : line
        )
      );
      record.attack = {
        attack: attack.id,
        target: target.id,
        hit: r.hit,
        ...(r.damage ? { damage: r.damage.total } : {}),
        ...(terms.cover ? { cover: terms.cover } : {}),
        ...(r.reacted ? { reacted: r.reacted.id } : {}),
        roll: struck.roll.total,
      };
      if (target.id === PLAYER) {
        sheet = r.sheet;
        sheetChanged = true;
        if (r.down) {
          // At 0, by the system's down kind (L-827).
          const fall = down.fall(system, sheet);
          sheet = fall.sheet;
          lines.push(...fall.lines);
          if (fall.down) {
            playerDown = fall.down;
            f = fight.leave(f, PLAYER, 'down');
          }
        }
      } else {
        states[target.id] = {
          ...(states[target.id] || {}),
          sheet: r.sheet,
          ...(r.down ? { down: r.down } : {}),
        };
        if (r.down && f.combatants[target.id]) f = fight.leave(f, target.id, 'down');
      }
      c = f.combatants[id];
    }
    const back = walk(plan.back, from);
    if (back.down) return fell(back.down);
    // Their conditions tick at the end of their turn (L-815).
    if ((mine.conditions || []).length) {
      const t = effects.endOfTurn(system, mine, { now, dice });
      mine = t.sheet;
      lines.push(
        ...t.lines.map((line) =>
          line.startsWith('You shake off')
            ? line.replace('You shake off', `${character.name} shakes off`)
            : `${character.name}: ${line}`
        )
      );
    }
    states[id] = { ...(states[id] || {}), sheet: mine };
    turns.push(record);
  };

  const done = () => {
    checkMorale();
    const over = fight.endOf(f);
    if (over) ended = over;
    return Boolean(over);
  };

  // What the player's turn did may have shaken their foes (a fall).
  if (done()) return finish();
  if (current && f.turn !== PLAYER && !f.combatants[f.turn].out) {
    act(f.turn);
    done();
  }
  for (let i = 0; !ended && i < f.order.length * 3; i++) {
    const step = fight.next(f, settings.economy);
    f = step.fight;
    if (step.newRound) rounds += 1;
    if (f.turn === PLAYER) break;
    act(f.turn);
    if (done()) break;
  }
  return finish();

  function finish() {
    // The player's turn again: their Dodge and readied attack are over (L-823).
    const mine = !ended && f.turn === PLAYER && f.combatants[PLAYER];
    if (mine) {
      delete mine.dodging;
      delete mine.readied;
    }
    return {
      fight: ended ? null : f,
      endedFight: ended ? f : null,
      figures: states,
      ...(sheetChanged ? { sheet } : {}),
      lines,
      rounds,
      turns,
      ...(ended ? { ended } : {}),
      ...(playerDown ? { down: playerDown } : {}),
    };
  }
}

module.exports = { playOthers };
