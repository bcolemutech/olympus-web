'use strict';

/**
 * Fights in play (planning/combat.md §4.2; L-821 / #653): the combat
 * module's fight (./fight.js) on a save, for ADJUDICATE. Who is in one,
 * starting it, the rounds after each of the player's turns, and ending it,
 * each as the save's mutations and plain lines: no model decides anything
 * (CB0), and NARRATE is told only when a fight starts or ends.
 *
 * Sides (EN1): a character's `side` in canon, `party`, `hostile`, `wary`
 * (L-392: challenging first, ./wary.js) or `neutral` (the default), set
 * over MCP, or as turned in the save (`save.sides`). A fight is on the battle map the
 * player stands on, among the player, the hostile characters standing on it
 * and those on the player's side; someone the player attacks joins it,
 * hostile.
 *
 * Starting (SE1): a hostile seeing the player (`by: 'seen'`: they lie in
 * wait, so the player rolls to notice them), the player attacking someone
 * (`by: 'attack'`: the attacked roll to see it coming), or the GM or an
 * event (`by: 'gm' | 'event'`), which the stories that bring them call.
 *
 * Ending (SE4): the player leaving the map (fled), a foe talked down by a
 * social check against them, and, at each End turn, foes no longer on the
 * map (gone) or no longer hostile (stood down). Foes falling (L-822),
 * fleeing and surrendering (L-824) and the player falling (L-827) come with
 * their stories.
 */

const maps = require('../../loom-canon/maps');
const sight = require('../../loom-canon/sight');
const checks = require('../../loom-canon/checks');
const sheets = require('../../loom-canon/sheets');
const fight = require('./fight');
const others = require('./others');
const down = require('./down');
const reactions = require('./reactions');

const { PLAYER } = fight;
const SIDES = ['party', 'hostile', 'neutral', 'wary'];

// What the player can do to talk a foe out of a fight (SE4): a social check
// against them that succeeds.
const TALK_DOWN =
  /^(persuade|convince|talk|reason|plead|negotiate|parley|intimidate|threaten|deceive|bluff|calm|reassure)/;
// What starts a fight with someone not already in one (SE1).
const ATTACK = /^(attack|strike|hit|stab|slash|shoot|punch|kick|fight|assault|ambush|charge|swing)/;

const ORDINAL = ['1st', '2nd', '3rd'];
const ordinal = (n) => ORDINAL[n - 1] || n + 'th';

/** A character's side (EN1): party, hostile, wary or neutral. */
function sideOf(character) {
  return SIDES.includes(character && character.side) ? character.side : 'neutral';
}

const setFight = (value) => ({ target: 'save', op: 'set-flag', path: 'fight', value });

/** The save's fight, or null. */
function fightOf(save) {
  return (save && save.fight) || null;
}

/**
 * Someone's state in this save (L-822): `save.figures[id]`, `{ sheet, down? }`
 * once they have been hurt, put down or had an effect put on them; their
 * sheet there is their own from then on.
 */
function figureOf(save, id) {
  return ((save && save.figures) || {})[id] || null;
}

/** Whether someone is down in this save: 'dead', 'out' (knocked out), or null. */
function downOf(save, id) {
  const f = figureOf(save, id);
  return (f && f.down) || null;
}

/**
 * Someone's sheet as this save has it (L-822): theirs in `save.figures`, else
 * their canon sheet (L-813), else the system's defaults.
 */
function sheetFor(world, save, character) {
  const f = figureOf(save, character.id);
  if (f && f.sheet) return f.sheet;
  if (character.sheet) return character.sheet;
  return sheets.defaultSheet(checks.systemOf(world));
}

// The characters standing on the map the save is on, and not down in it.
function standingHere(world, save) {
  const host = maps.hostOf(world, save);
  return host ? maps.standingAt(world, host).filter((c) => !downOf(save, c.id)) : [];
}

/**
 * The hostile characters standing on the save's battle map that it can see
 * from where it stands (SE1), with its doors as they are.
 */
function hostilesInSight(world, save) {
  const { map, cell } = maps.positionOf(world || {}, save);
  if (!map || !cell) return [];
  const seen = sight.inSight(map, cell, ((save && save.doors) || {})[map.id] || {});
  return standingHere(world, save).filter(
    (c) => sideOf(c) === 'hostile' && seen[c.cell.x + ',' + c.cell.y]
  );
}

/**
 * Starts a fight on the save's battle map (SE1–SE3): the player, every
 * hostile and party fighter standing on it (characters and figures, L-824),
 * and `joining` (ids of others who join hostile: someone the player
 * attacks). Rolls initiative and surprise, then plays the turns before the
 * player's first (./others.js; `first`: the player's turn is first, their
 * attack opening the fight).
 *
 * Returns `{ mutations, lines, roll, rounds, lost, fight: { started, by,
 * order, surprised, ended? } }` (`roll` the player's initiative, for the
 * roll card; `rounds` the rounds that passed before their first turn, each
 * 6 s; `lost` more time lost, knocked out), or null when there's no battle
 * map here or nobody to fight.
 */
function begin(
  world,
  save,
  { by, ambushers = null, joining = [], first = false, dice, choose = null }
) {
  const { map } = maps.positionOf(world || {}, save);
  if (!map) return null;
  const system = checks.systemOf(world);
  // The neutral and the wary stay out (L-392), unless joining.
  const others = standingHere(world, save).filter(
    (c) => ['party', 'hostile'].includes(sideOf(c)) || joining.includes(c.id)
  );
  if (!others.some((c) => sideOf(c) === 'hostile' || joining.includes(c.id))) return null;
  const combatants = [
    {
      id: PLAYER,
      kind: PLAYER,
      name: (save.character && save.character.name) || 'You',
      sheet: sheets.sheetOf(save),
    },
  ].concat(
    others.map((c) => ({
      id: c.id,
      kind: 'character',
      side: joining.includes(c.id) ? 'hostile' : sideOf(c),
      name: c.name,
      sheet: sheetFor(world, save, c),
    }))
  );
  const started = fight.start(system, {
    id: 'fight-' + map.id + '-' + (Number.isFinite(save.time) ? save.time : 0),
    mapId: map.id,
    by,
    combatants,
    ambushers,
    dice,
  });
  // Someone attacked joins hostile whatever their side in canon (SE1).
  for (const id of joining) {
    if (started.fight.combatants[id]) started.fight.combatants[id].joined = true;
  }
  // A leader's fall shakes the rest (L-824; EN4).
  for (const c of others) {
    if (c.leader && started.fight.combatants[c.id]) started.fight.combatants[c.id].leader = true;
  }
  const caught = started.surprise.surprised;
  // The player's own attack opens it: theirs is the first turn (SE1).
  const f = first ? { ...started.fight, turn: PLAYER } : started.fight;
  const nameOf = (id) => (id === PLAYER ? 'you' : f.combatants[id].name);
  const place = f.order.indexOf(PLAYER) + 1;
  const lines = [
    'A fight breaks out. In order: ' +
      f.order.map((id) => nameOf(id) + ' (' + f.combatants[id].initiative + ')').join(', ') +
      '.',
  ];
  if (caught.includes(PLAYER)) lines.push("You're caught off guard: you lose the first round.");
  const theyMissed = caught.filter((id) => id !== PLAYER).map(nameOf);
  if (theyMissed.length) {
    lines.push(
      listed(theyMissed) + (theyMissed.length > 1 ? ' are' : ' is') + ' caught off guard.'
    );
  }
  // Those before the player take their turns (L-824).
  const played =
    f.turn === PLAYER
      ? { mutations: [setFight(f)], lines: [], rounds: 0, lost: 0 }
      : othersPlay(world, save, f, { dice, current: true, choose });
  lines.push(...played.lines);
  const mine = started.initiative[PLAYER];
  return {
    mutations: played.mutations,
    lines,
    rounds: played.rounds,
    lost: played.lost,
    roll: {
      ...mine,
      type: 'number',
      natural: 0,
      success: true,
      degree: 'success',
      rung: null,
      difficulty: null,
      verdict: ordinal(place) + ' of ' + f.order.length,
    },
    ...(played.fallen ? { fallen: played.fallen } : {}),
    ...(played.named && played.named.length ? { named: played.named } : {}),
    ...(played.turns && played.turns.length ? { turns: played.turns } : {}),
    fight: {
      ...(played.fight || {}),
      started: true,
      by,
      order: f.order.map(nameOf),
      surprised: caught.map(nameOf),
    },
  };
}

/**
 * Everyone else's turns (./others.js), from fight `f`, as the save's
 * mutations and lines: the fight (or its end), every fighter's state in
 * `save.figures`, the player's sheet when hurt, and their fall (`save.down`;
 * L-827). A fight that ends with the player down has its aftermath
 * (./down.js): coming round, death, or a fate for NARRATE to choose.
 * Returns `{ mutations, lines, rounds, lost, turns, named, keptLeft?, fight?,
 * fallen? }`,
 * `fight` its end for NARRATE, `fallen` what became of the player, `named`
 * the named characters' choices (L-825; `choose`, ./others.js).
 */
function othersPlay(world, save, f, { dice, current = false, choose = null }) {
  const result = others.playOthers(
    world,
    { ...save, fight: f },
    {
      dice,
      current,
      now: Number.isFinite(save.time) ? save.time : 0,
      choose,
    }
  );
  const mutations = [{ target: 'save', op: 'set-flag', path: 'figures', value: result.figures }];
  if (result.sheet) {
    mutations.push({
      target: 'save',
      op: 'set-flag',
      path: 'character.sheet',
      value: result.sheet,
    });
  }
  const lines = result.lines.slice();
  const fell = result.down || save.down || null;
  if (result.down) mutations.push({ target: 'save', op: 'set-flag', path: 'down', value: fell });
  let ended = null;
  let fallen = null;
  if (result.ended) {
    ended = ending(result.endedFight, result.ended);
    mutations.push(...ended.mutations);
    lines.push(...ended.lines);
    if (fell) {
      fallen = afterFall(world, save, {
        f: result.endedFight,
        winner: result.ended.winner,
        sheet: result.sheet || sheets.sheetOf(save),
        figures: result.figures,
        down: fell,
        dice,
      });
      mutations.push(...fallen.mutations);
      lines.push(...fallen.lines);
    }
  } else {
    mutations.push(setFight(result.fight));
    if (result.rounds) lines.push('Round ' + result.fight.round + '.');
  }
  return {
    mutations,
    lines,
    rounds: result.rounds,
    lost: 0,
    turns: result.turns,
    named: result.named,
    ...(Number.isInteger(result.keptLeft) ? { keptLeft: result.keptLeft } : {}),
    ...(ended ? { fight: ended.fight } : {}),
    ...(fallen ? { fallen: fallen.fallen } : {}),
  };
}

/**
 * The player down when a fight ends (DF1–DF3; ./down.js): their allies still
 * standing tend them, or nobody does. Returns `{ mutations, lines, fallen:
 * { outcome, sheet?, hours? } }`: coming round (written now), dead (the
 * save ends; NARRATE writes the epilogue), or a fate for NARRATE to choose
 * (written once it has, ../../loom-turn/index.js).
 */
function afterFall(world, save, { f, winner, sheet, figures: states, down: fell, dice }) {
  const seen = require('./figures').withFigures(world, { ...save, figures: states || {} });
  const allies = Object.entries(f.combatants)
    .filter(([id, c]) => id !== PLAYER && c.side === 'party' && !c.out)
    .map(([id]) =>
      sheetFor(seen, { ...save, figures: states || {} }, seen.characters[id] || { id })
    );
  const after = down.aftermath(world, { sheet, down: fell, winner, allies, dice });
  if (after.outcome === 'wake') {
    return {
      mutations: down.wakeMutations(world, save, { sheet, hours: after.hours }),
      lines: after.lines,
      fallen: { outcome: 'wake' },
    };
  }
  if (after.outcome === 'dead') {
    return {
      mutations: down.deathMutations(save),
      lines: after.lines,
      fallen: { outcome: 'dead' },
    };
  }
  return {
    mutations: [{ target: 'save', op: 'set-flag', path: 'down', value: null }],
    lines: after.lines,
    fallen: { outcome: 'fate', sheet, hours: after.hours },
  };
}

// The fight's end (SE4), as a line and what NARRATE is told.
const ENDS = {
  fled: 'fled',
  down: 'fell',
  surrendered: 'surrendered',
  talkedDown: 'were talked down',
  gone: 'are gone',
  stoodDown: 'stood down',
};
function ending(f, result) {
  const theirs = result.winner === 'party';
  const how = result.how.filter(Boolean);
  const line = theirs
    ? 'The fight is over: your foes ' +
      (how.map((h) => ENDS[h] || h).join(' or ') || 'are gone') +
      '.'
    : result.how.includes('fled')
      ? 'You get away: the fight is over.'
      : 'The fight is over.';
  return {
    mutations: [setFight(null)],
    lines: [line],
    fight: { ended: true, winner: result.winner, how, rounds: f.round },
  };
}

/**
 * After the player's End turn in a fight (TN1, SE4): foes no longer on the
 * map, or no longer hostile, leave it; if a side is empty, it ends;
 * otherwise everyone else takes their turn, to the player's next (L-824:
 * by their tactics). Returns `{ mutations, lines, lost, turns?, fight? }`
 * (fight: its end, for NARRATE), or null with no fight.
 */
function afterTurn(world, save, { dice, choose = null } = {}) {
  let f = fightOf(save);
  if (!f) return null;
  const here = new Map(standingHere(world, save).map((c) => [c.id, c]));
  for (const [id, c] of Object.entries(f.combatants)) {
    if (id === PLAYER || c.out) continue;
    const now = here.get(id);
    if (!now) f = fight.leave(f, id, 'gone');
    else if (c.side === 'hostile' && sideOf(now) !== 'hostile' && !c.joined) {
      f = fight.leave(f, id, 'stoodDown');
    }
  }
  const over = fight.endOf(f);
  if (!over) return othersPlay(world, save, f, { dice, choose });
  const end = ending(f, over);
  if (!save.down) return { lost: 0, ...end };
  // The player went down on their own turn (L-823: struck leaving reach).
  const fallen = afterFall(world, save, {
    f,
    winner: over.winner,
    sheet: sheets.sheetOf(save),
    figures: save.figures,
    down: save.down,
    dice,
  });
  return {
    lost: 0,
    mutations: end.mutations.concat(fallen.mutations),
    lines: end.lines.concat(fallen.lines),
    fight: end.fight,
    fallen: fallen.fallen,
  };
}

/**
 * The player still down with no fight (L-827): nobody left to help, so what
 * becomes of them is decided now. `{ mutations, lines, fallen }`.
 */
function afterFight(world, save, { dice } = {}) {
  const f = { round: 1, combatants: {} };
  return afterFall(world, save, {
    f,
    winner: 'hostile',
    sheet: sheets.sheetOf(save),
    figures: save.figures,
    down: save.down,
    dice,
  });
}

/**
 * The player's walk in a fight (L-823; PS4): stepping out of a foe's reach
 * draws its attack, unless they withdrew this turn (`turn.withdrawn`). A
 * blow that drops them stops the walk where they were struck, and they fall
 * by the system's down kind (./down.js). `walked` the squares stepped on.
 *
 * Returns null out of a fight or when nobody reacts; else `{ reached,
 * fight, sheet, down, figures, lines }`: how many squares they walked, the
 * fight (reactions spent; the player out if down), their sheet, their fall
 * (`save.down`, or null), every reactor's state (`save.figures`).
 */
function walkReactions(world, save, walked, { dice }) {
  const f = fightOf(save);
  const { map, cell } = maps.positionOf(world || {}, save);
  if (!f || !map || !cell || !walked.length || !f.combatants[PLAYER]) return null;
  const system = checks.systemOf(world);
  const fighters = standingHere(world, save)
    .filter((c) => f.combatants[c.id] && !f.combatants[c.id].out)
    .map((c) => ({
      id: c.id,
      side: f.combatants[c.id].side,
      name: c.name,
      cell: c.cell,
      sheet: sheetFor(world, save, c),
    }));
  const r = reactions.reactToWalk(system, {
    map,
    doors: ((save && save.doors) || {})[map.id] || {},
    fight: f,
    mover: { id: PLAYER, side: 'party', name: 'you', you: true, sheet: sheets.sheetOf(save) },
    from: cell,
    path: walked,
    fighters,
    withdrawn: Boolean(save.turn && save.turn.withdrawn),
    now: Number.isFinite(save.time) ? save.time : 0,
    dice,
  });
  if (!r.struck.length) return null;
  const states = JSON.parse(JSON.stringify((save && save.figures) || {}));
  for (const [id, s] of Object.entries(r.sheets)) states[id] = { ...(states[id] || {}), sheet: s };
  let next = r.fight;
  let sheet = r.sheet;
  let fell = null;
  const lines = r.lines.slice();
  if (r.down) {
    const fall = down.fall(system, sheet);
    sheet = fall.sheet;
    lines.push(...fall.lines);
    if (fall.down) {
      fell = fall.down;
      next = fight.leave(next, PLAYER, 'down');
    }
  }
  return {
    reached: fell ? r.reached : walked.length,
    fight: next,
    sheet,
    down: fell,
    figures: states,
    lines,
  };
}

/**
 * Those turned hostile in a fight under way join it (L-392; ./wary.js): each
 * standing on its map and not in it yet. `{ mutations, lines }`, or null
 * when nobody joins.
 */
function joinFight(world, save, ids, { dice }) {
  let f = fightOf(save);
  if (!f) return null;
  const system = checks.systemOf(world);
  const lines = [];
  for (const c of standingHere(world, save)) {
    if (!ids.includes(c.id) || f.combatants[c.id] || sideOf(c) !== 'hostile') continue;
    f = fight.join(
      system,
      f,
      {
        id: c.id,
        kind: 'character',
        side: 'hostile',
        name: c.name,
        sheet: sheetFor(world, save, c),
      },
      dice
    ).fight;
    lines.push(c.name + ' joins the fight.');
  }
  return lines.length ? { mutations: [setFight(f)], lines } : null;
}

/** The player leaving the fight's map (SE4: fled): `{ mutations, lines, fight }`, or null. */
function leftMap(save, mapId) {
  const f = fightOf(save);
  if (!f || mapId === f.mapId) return null;
  return ending(f, fight.endOf(fight.leave(f, PLAYER, 'fled')));
}

/**
 * A foe talked out of the fight (SE4): a social check against a hostile in
 * it that succeeded. `{ mutations, lines, fight? }`, or null when it isn't.
 */
function talkedDown(save, verb, targetId, success) {
  const f = fightOf(save);
  const c = f && f.combatants[targetId];
  if (!c || c.out || c.side !== 'hostile' || !success || !TALK_DOWN.test(String(verb || ''))) {
    return null;
  }
  const g = fight.leave(f, targetId, 'talkedDown');
  const over = fight.endOf(g);
  if (over) return ending(g, over);
  return { mutations: [setFight(g)], lines: [c.name + ' backs down.'] };
}

/** Whether an action starts a fight with someone (SE1): an attack at them. */
function isAttack(verb) {
  return ATTACK.test(String(verb || ''));
}

/** The fight as the Loom shows it (for the map view and NARRATE), or null. */
function viewOf(save) {
  const f = fightOf(save);
  if (!f) return null;
  return {
    round: f.round,
    turn: f.turn,
    order: f.order.map((id) => {
      const c = f.combatants[id];
      return {
        id,
        name: c.name,
        side: c.side,
        initiative: c.initiative,
        ...(id === PLAYER ? { you: true } : {}),
        ...(c.out ? { out: c.out } : {}),
        // Dodging, or an attack readied (L-823).
        ...(c.dodging ? { dodging: true } : {}),
        ...(c.readied ? { readied: c.readied.attack } : {}),
      };
    }),
  };
}

function listed(names) {
  if (names.length < 2) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

module.exports = {
  figureOf,
  downOf,
  sheetFor,
  standingHere,
  ending,
  SIDES,
  TALK_DOWN,
  sideOf,
  fightOf,
  hostilesInSight,
  begin,
  afterTurn,
  afterFight,
  walkReactions,
  leftMap,
  joinFight,
  talkedDown,
  isAttack,
  viewOf,
};
