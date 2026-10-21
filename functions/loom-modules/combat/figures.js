'use strict';

/**
 * Figures and tactics settings (planning/combat.md §3 EN1–EN3, §4.6; L-824 /
 * #656): unnamed fighters placed many at once from a stat block ("bandit ×
 * 4"), and every fighter's role and posture.
 *
 *   battleMap.figures: [group]   (decided 2026-10-21: on the battle map, until
 *                                L-792's templates)
 *     id         lowercase letters, digits and dashes
 *     name       "Bandit"; each is named with a number when there are several
 *                ("Bandit 3")
 *     statBlock  the short form of a sheet (../../loom-canon/sheets.js): every
 *                attribute, and attacks
 *     side       hostile (the default), party or neutral
 *     role?      brute, skirmisher, archer, guard, caster or leader
 *     posture?   cowardly, cautious, steady, bold or reckless
 *     leader?    whether their fall shakes the rest (EN4)
 *     cells      the squares they stand on, one each
 *
 * A named character's role, posture and leader are on their canon record
 * (set_tactics). Without a role, a fighter with a ranged attack is an archer
 * and any other a brute; without a posture, steady.
 *
 * In a save: every fighter's state is `save.figures[id]` (L-822): their sheet
 * as hurt, `down`, and now `cell` (where they have moved to) and `gone` (left
 * the map: 'fled'). withFigures gives the world as a save sees it: its map's
 * figures standing among the characters, and everyone where the save has them.
 */

const maps = require('../../loom-canon/maps');
const layers = require('../../loom-canon/layers');
const sheets = require('../../loom-canon/sheets');
const { attacksOf } = require('./attacks');

const ROLES = ['brute', 'skirmisher', 'archer', 'guard', 'caster', 'leader'];
const POSTURES = ['cowardly', 'cautious', 'steady', 'bold', 'reckless'];
const SIDES = ['party', 'hostile', 'neutral'];
const GROUP_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_GROUPS = 20;
const MAX_FIGURES = 20;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const key = (cell) => cell.x + ',' + cell.y;
const copyOf = (v) => JSON.parse(JSON.stringify(v));

/** A figure's id in play: the group's id, numbered when there are several. */
function figureId(group, n) {
  return 'fig-' + group.id + ((group.cells || []).length > 1 ? '-' + n : '');
}

/** The figures a group stands for, each as a character would be: id, name, cell, side... */
function instancesOf(system, group) {
  const cells = Array.isArray(group.cells) ? group.cells : [];
  const sheet = sheets.sheetFromStatBlock(system, group.statBlock || {});
  return cells.map((cell, i) => ({
    id: figureId(group, i + 1),
    name: cells.length > 1 ? `${group.name} ${i + 1}` : group.name,
    figure: group.id,
    cell: { x: cell.x, y: cell.y },
    side: SIDES.includes(group.side) ? group.side : 'hostile',
    ...(group.role ? { role: group.role } : {}),
    ...(group.posture ? { posture: group.posture } : {}),
    ...(group.leader ? { leader: true } : {}),
    sheet: copyOf(sheet),
  }));
}

/** A fighter's role (EN3): theirs, else archer with a ranged attack, else brute. */
function roleOf(system, fighter) {
  if (ROLES.includes(fighter.role)) return fighter.role;
  const list = attacksOf(system, fighter.sheet);
  return list.some((a) => a.range) ? 'archer' : 'brute';
}

/** A fighter's posture (EN3): theirs, else steady. */
function postureOf(fighter) {
  return POSTURES.includes(fighter.posture) ? fighter.posture : 'steady';
}

/** What's wrong with a role, posture and leader, each named. */
function validateTactics(t, where = 'tactics') {
  const errors = [];
  if (t.role !== undefined && t.role !== null && !ROLES.includes(t.role)) {
    errors.push(`${where}.role must be one of ${ROLES.join(', ')}.`);
  }
  if (t.posture !== undefined && t.posture !== null && !POSTURES.includes(t.posture)) {
    errors.push(`${where}.posture must be one of ${POSTURES.join(', ')}.`);
  }
  if (t.leader !== undefined && typeof t.leader !== 'boolean') {
    errors.push(`${where}.leader must be true or false.`);
  }
  return errors;
}

/**
 * What's wrong with a map's figures (as place_figures would set them), each
 * named: their shape, stat blocks against the system, and squares (on the
 * grid, free of what blocks, of entries and exits, of characters standing on
 * the map, and of each other). Errors only.
 */
function validateFigures(world, system, map, list) {
  if (!Array.isArray(list)) return ['figures must be a list.'];
  const errors = [];
  if (list.length > MAX_GROUPS) errors.push(`At most ${MAX_GROUPS} groups of figures a map.`);
  const ids = new Set();
  const taken = new Map();
  for (const { character, cell } of maps.standingOn(world, map)) {
    taken.set(key(cell), character.name);
  }
  list.forEach((g, i) => {
    const at = `figures[${i}]`;
    if (!isObject(g)) return errors.push(`${at} must be an object.`);
    if (typeof g.id !== 'string' || !GROUP_ID.test(g.id)) {
      errors.push(`${at}.id must be lowercase letters, digits and dashes.`);
    } else if (ids.has(g.id)) errors.push(`${at}.id "${g.id}" is used twice.`);
    else ids.add(g.id);
    if (typeof g.name !== 'string' || !g.name.trim() || g.name.length > 60) {
      errors.push(`${at}.name is required (at most 60 characters).`);
    }
    if (g.side !== undefined && !SIDES.includes(g.side)) {
      errors.push(`${at}.side must be one of ${SIDES.join(', ')}.`);
    }
    errors.push(...validateTactics(g, at));
    if (!isObject(g.statBlock)) errors.push(`${at}.statBlock is required: every attribute.`);
    else {
      sheets
        .validateStatBlock(system, g.statBlock)
        .forEach((e) => errors.push(`${at}.statBlock: ${e}`));
    }
    if (!Array.isArray(g.cells) || !g.cells.length || g.cells.length > MAX_FIGURES) {
      errors.push(`${at}.cells must list 1 to ${MAX_FIGURES} squares, one a figure.`);
      return;
    }
    g.cells.forEach((cell, j) => {
      const where = `${at}.cells[${j}]`;
      if (!isObject(cell) || !maps.inBounds(map, cell)) {
        errors.push(`${where} must be a square on the ${map.width} × ${map.height} grid.`);
        return;
      }
      const square = `(${cell.x}, ${cell.y})`;
      const obstacle = layers.obstacleAt(map, cell);
      if (obstacle && obstacle.kind !== 'difficult') {
        errors.push(`${where} ${square} is ${obstacle.name} (${obstacle.kind}).`);
      } else if ((map.entries || []).some((e) => maps.sameCell(e, cell))) {
        errors.push(`${where} ${square} is an entry, where players arrive.`);
      } else if ((map.exits || []).some((e) => maps.sameCell(e, cell))) {
        errors.push(`${where} ${square} is an exit.`);
      } else if (taken.has(key(cell))) {
        errors.push(`${where} ${square}: ${taken.get(key(cell))} stands there.`);
      } else taken.set(key(cell), g.name || 'a figure');
    });
  });
  return errors;
}

/**
 * The world as a save sees it (L-824): the figures on the map it stands on,
 * standing at its place as characters do (with their side, role, posture and
 * sheet), and every fighter where the save has them: moved (`cell`), or gone
 * from the map (fled), from `save.figures`. Characters keep their canon
 * record otherwise; the world itself isn't changed.
 */
function withFigures(world, save) {
  const states = (save && save.figures) || {};
  const host = save && save.mapId ? maps.hostOf(world, save) : null;
  const map = host ? maps.mapOf(world, host) : null;
  const onMap = map && map.id === save.mapId;
  if (!onMap && !Object.keys(states).length) return world;
  const characters = {};
  const place = (c) => {
    const s = states[c.id];
    if (!s) return c;
    if (s.gone) return { ...c, retired: true, gone: s.gone };
    return s.cell ? { ...c, cell: { x: s.cell.x, y: s.cell.y } } : c;
  };
  for (const [id, c] of Object.entries(world.characters || {})) characters[id] = place(c);
  if (onMap) {
    const system = require('../../loom-canon/checks').systemOf(world);
    const isPlace = Boolean((world.places || {})[host.id]);
    for (const group of map.figures || []) {
      for (const f of instancesOf(system, group)) {
        if (characters[f.id]) continue; // a character of that id wins
        characters[f.id] = place({
          ...f,
          description: group.description || `${group.name}, one of a group.`,
          ...(isPlace
            ? { placeId: host.id, locationId: host.locationId }
            : { locationId: host.id }),
        });
      }
    }
  }
  return { ...world, characters };
}

module.exports = {
  ROLES,
  POSTURES,
  SIDES,
  MAX_GROUPS,
  figureId,
  instancesOf,
  roleOf,
  postureOf,
  validateTactics,
  validateFigures,
  withFigures,
};
