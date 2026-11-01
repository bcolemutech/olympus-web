'use strict';

/**
 * Moves at any depth (planning/map-levels.md §4.3, TV2, TV3, LV4; L-903 /
 * #721): what the frame (../loom-canon/frames.js) can't hold.
 *
 *   down      a move that arrives at a place opening a region map goes on
 *             into it, by its way in facing where the traveller came from
 *             (a place on it with `entrance`; decided with the user
 *             2026-11-01), and finds the way in and its neighbours there
 *   exits     (TV3) a place with `exits: [{ placeId, seconds, name }]`
 *             leads from where the save stands at it to a place on any map,
 *             taking the exit's time
 *   between   (TV2) a move to a place outside the frame climbs to the lowest
 *             map holding both, crosses it and descends: out of each region
 *             map by a way out (crossing it to the nearest, if not at one),
 *             across the common map along its links, and into each region
 *             map below by its way in, crossing it to the next place. Each
 *             stage takes its own map's time (timeRules of the map crossed),
 *             and the arrival line names the whole journey. Only places the
 *             save has discovered are gone to, and only through open ones.
 *
 * A move starts from the frame's region map: not on a grid (its exits come
 * first), and in a town only from a way out.
 *
 * Pure: returns a resolution, as ./adjudicate.js does.
 */

const levels = require('../loom-canon/levels');
const frames = require('../loom-canon/frames');
const travel = require('../loom-canon/travel');
const clock = require('../loom-canon/clock');
const town = require('../loom-canon/town');
const { isPlayable } = require('../loom-canon/grading');

const blocked = (message) => ({ outcome: 'blocked', mutations: [], constraints: [message] });
const set = (path, value) => ({ target: 'save', op: 'set-flag', path, value });
const add = (path, value) => ({ target: 'save', op: 'add', path, value });
const live = (e) => Boolean(e) && !e.retired;
const kindOf = (world, mapId) => (levels.mapOf(world, mapId) || {}).kind || null;
const nameOf = (world, mapId) => (levels.mapOf(world, mapId) || {}).name || mapId;

function list(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

// The place's grid square, for a path ending on a grid by a place.
function settled(world, at) {
  return at.map((step) => {
    if (kindOf(world, step.mapId) !== 'grid' || !step.placeId) return step;
    const place = levels.placeOf(world, step.placeId);
    return place && place.at ? { mapId: step.mapId, cell: { x: place.at.x, y: place.at.y } } : step;
  });
}

/**
 * Into region map `mapId` (opened by the last step of `at`) by its way in
 * facing `fromId`: `{ at, way, found }` (found: the way and its neighbours),
 * or null when it has no open way in.
 */
function into(world, at, mapId, fromId) {
  const view = frames.viewFor(world, mapId);
  const way = frames.wayInto(world, mapId, fromId, (w) => isPlayable(view, w));
  if (!way) return null;
  return {
    at: at.concat([{ mapId, placeId: way.id }]),
    way,
    found: [way.id].concat(way.connections || []),
  };
}

/**
 * A resolution's move that arrives at a place opening a region map, carried
 * on into it (down): its way in, found there. Other resolutions as they are.
 */
function withDescent(resolution, characterState, view) {
  if (!resolution || resolution.outcome !== 'success' || !view.frame) return resolution;
  const moved = (resolution.mutations || []).find((m) => m.path === 'location');
  const place = moved && view.locations[moved.value];
  if (!place || !place.region) return resolution;
  const prefix = view.frame.prefix.concat([{ mapId: view.frame.mapId, placeId: place.id }]);
  const down = into(view, prefix, place.region.mapId, characterState.location);
  if (!down) return resolution;
  return {
    ...resolution,
    mutations: resolution.mutations.concat(
      [set('at', down.at)],
      down.found.map((id) => add('discovered', id))
    ),
    constraints: resolution.constraints.concat([
      'You come into ' + nameOf(view, place.region.mapId) + ' by ' + down.way.name + '.',
    ]),
  };
}

// Where the save stands that an exit or a set-out can start from: its place
// in town, else its place on the region map.
function standingAt(view, characterState) {
  const here = town.positionOf(view, characterState);
  if (here.place) return here.place;
  if (here.point) return null;
  return view.locations[characterState.location] || null;
}

/** A move by an exit of the place the save stands at (TV3), or null. */
function byExit(proposedAction, characterState, view) {
  const target = proposedAction.targets[0];
  const host = standingAt(view, characterState);
  const exit =
    host &&
    (host.exits || []).find((e) => e && (e.placeId === target || e.name === target) && e.placeId);
  if (!exit) return null;
  return exitTo(view, characterState, exit, host.id);
}

/**
 * Going by an exit (`{ placeId, seconds, name }`) to its place on any map
 * (TV3), from `fromId` (where the save stands): on into a region map it
 * opens, by its way in.
 */
function exitTo(view, characterState, exit, fromId) {
  const to = levels.placeOf(view, exit.placeId);
  const path = to && levels.pathTo(view, exit.placeId);
  if (!path || !live(to))
    return blocked('The way by ' + (exit.name || 'there') + ' leads nowhere now.');
  if (kindOf(view, to.mapId) === 'region') {
    const there = frames.viewFor(view, to.mapId);
    if (!isPlayable(there, there.locations[exit.placeId] || to)) {
      return blocked('The way to ' + to.name + ' is closed. Turn back.');
    }
  }
  let at = settled(view, path);
  let line = 'You go by ' + (exit.name || 'the way') + ' to ' + to.name + '.';
  const found = [exit.placeId];
  const opens = levels.openedBy(view, exit.placeId);
  if (opens && opens.kind === 'region') {
    const down = into(view, at, to.opens.mapId, fromId);
    if (down) {
      at = down.at;
      found.push(...down.found);
      line += ' You come into ' + opens.name + ' by ' + down.way.name + '.';
    }
  }
  const seconds = Number.isFinite(exit.seconds) && exit.seconds > 0 ? exit.seconds : 0;
  const start = clock.timeOf(characterState);
  return {
    outcome: 'success',
    mutations: [set('at', at)]
      .concat(found.map((id) => add('discovered', id)))
      .concat([add('visited', exit.placeId)])
      .concat(seconds ? [set('time', start + seconds)] : [])
      .concat([{ op: 'increment', path: 'worldClock', value: 1 }]),
    constraints: [line],
    ...(seconds ? { time: travel.timeSpent(start, seconds) } : {}),
  };
}

// ── Between parents (TV2) ───────────────────────────────────────────

/**
 * The quickest way across region map `mapId` from one of its places to one
 * of `goals` (ids), through open places only, setting out at `start`:
 * `{ path: [ids], seconds, legs: [{ from, to, trip }] }`, or null.
 */
function cross(world, mapId, fromId, goals, characterState, start) {
  const view = frames.viewFor(world, mapId);
  const goal = new Set(goals);
  if (goal.has(fromId)) return { path: [fromId], seconds: 0, legs: [] };
  const passable = (loc) =>
    live(loc) && isPlayable(view, loc) && !town.missingAbility(loc, characterState);
  const best = new Map([[fromId, { seconds: 0, prev: null, trip: null }]]);
  const open = [fromId];
  while (open.length) {
    open.sort((a, b) => best.get(a).seconds - best.get(b).seconds);
    const id = open.shift();
    const here = best.get(id);
    if (goal.has(id)) {
      const path = [];
      const legs = [];
      for (let at = id; at; at = best.get(at).prev) {
        path.unshift(at);
        if (best.get(at).prev)
          legs.unshift({ from: best.get(at).prev, to: at, trip: best.get(at).trip });
      }
      return { path, seconds: here.seconds, legs };
    }
    const loc = view.locations[id];
    for (const next of (loc && loc.connections) || []) {
      const there = view.locations[next];
      if (!passable(there)) continue;
      const trip = travel.trip(view, id, next, start + here.seconds);
      const seconds = here.seconds + (trip ? trip.seconds : 0);
      if (best.has(next) && best.get(next).seconds <= seconds) continue;
      best.set(next, { seconds, prev: id, trip });
      if (!open.includes(next)) open.push(next);
    }
  }
  return null;
}

/**
 * A move to a place outside the frame (TV2): climb, cross, descend. Null
 * when the target is in the frame (today's rules move there) or isn't a
 * place of the model.
 */
function betweenParents(proposedAction, characterState, view) {
  const targetId = proposedAction.targets[0];
  const target = levels.placeOf(view, targetId);
  if (!target || !view.frame) return null;
  if (view.locations[targetId]) return null;
  const inTown = (view.places || {})[targetId];
  if (inTown && inTown.locationId && view.locations[inTown.locationId]) return null;
  if (kindOf(view, target.mapId) !== 'region') {
    return blocked("You can't get there directly from here.");
  }
  if (!live(target)) return blocked("That place can't be reached anymore.");
  const discovered = Array.isArray(characterState.discovered) ? characterState.discovered : [];
  if (!discovered.includes(targetId)) return blocked("You can't get there directly from here.");

  // Setting out from the frame's region map: in a town, only from a way out.
  const here = town.positionOf(view, characterState);
  if (here.point || (here.place && !town.isEntrance(here.place))) {
    const ways = town.entrancesOf(view, characterState.location).map((p) => p.name);
    return blocked(
      'To set out for ' +
        target.name +
        ', go to ' +
        (ways.length ? ways.join(' or ') : 'a way out of town') +
        ' first.'
    );
  }

  const from = view.frame.prefix.concat([
    { mapId: view.frame.mapId, placeId: characterState.location },
  ]);
  if (from.some((s) => kindOf(view, s.mapId) !== 'region')) {
    return blocked("You can't get there directly from here.");
  }
  const to = levels.pathTo(view, targetId);
  if (!to) return blocked("You can't get there directly from here.");
  let i = 0;
  while (
    i < from.length &&
    i < to.length &&
    from[i].mapId === to[i].mapId &&
    from[i].placeId === to[i].placeId
  ) {
    i++;
  }
  if (i >= to.length)
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  if (i >= from.length || from[i].mapId !== to[i].mapId) {
    return blocked("You can't get there directly from here.");
  }

  const start = clock.timeOf(characterState);
  let seconds = 0;
  const stages = [];
  const found = new Set();
  // Up: out of each region map below the common one, by its way out.
  for (let k = from.length - 1; k > i; k--) {
    const mapId = from[k].mapId;
    const ways = frames.waysOf(view, mapId).map((w) => w.id);
    if (!ways.length) return blocked('No way out of ' + nameOf(view, mapId) + ' is known.');
    const across = cross(view, mapId, from[k].placeId, ways, characterState, start + seconds);
    if (!across) return blocked('No way out of ' + nameOf(view, mapId) + ' you can take.');
    seconds += across.seconds;
    const out = frames.viewFor(view, mapId).locations[across.path[across.path.length - 1]];
    stages.push({
      mapId,
      across,
      line: 'You leave ' + nameOf(view, mapId) + ' by ' + out.name + '.',
    });
  }
  // Across the lowest map that holds both.
  const common = to[i].mapId;
  const across = cross(
    view,
    common,
    from[i].placeId,
    [to[i].placeId],
    characterState,
    start + seconds
  );
  if (!across) {
    const closed = frames.viewFor(view, common).locations[to[i].placeId];
    if (closed && !isPlayable(frames.viewFor(view, common), closed)) {
      return blocked('The way to ' + closed.name + ' is closed. Turn back.');
    }
    return blocked('No way you know leads there.');
  }
  seconds += across.seconds;
  stages.push({ mapId: common, across });
  across.path.forEach((id) => found.add(id));
  // Down: into each region map by its way in, across it to the next place.
  let at = to.slice(0, i + 1).map((s) => ({ ...s }));
  for (let k = i + 1; k < to.length; k++) {
    const mapId = to[k].mapId;
    const cameFrom = stages.length ? lastOf(stages) : from[i].placeId;
    const down = into(view, at.slice(0, k), mapId, cameFrom);
    if (!down) return blocked('The way into ' + nameOf(view, mapId) + ' is closed. Turn back.');
    down.found.forEach((id) => found.add(id));
    const there = cross(view, mapId, down.way.id, [to[k].placeId], characterState, start + seconds);
    if (!there) {
      const closed = frames.viewFor(view, mapId).locations[to[k].placeId];
      if (closed && !isPlayable(frames.viewFor(view, mapId), closed)) {
        return blocked('The way to ' + closed.name + ' is closed. Turn back.');
      }
      return blocked('No way you know leads there.');
    }
    seconds += there.seconds;
    stages.push({
      mapId,
      across: there,
      line: 'You come into ' + nameOf(view, mapId) + ' by ' + down.way.name + '.',
    });
    there.path.forEach((id) => found.add(id));
    at = at.slice(0, k).concat([{ mapId, placeId: to[k].placeId }]);
  }
  // Arriving at a place that opens a region map goes on into it.
  let arrival = '';
  const opens = levels.openedBy(view, targetId);
  if (opens && opens.kind === 'region') {
    const down = into(view, at, target.opens.mapId, lastOf(stages));
    if (down) {
      at = down.at;
      down.found.forEach((id) => found.add(id));
      arrival = ' You come into ' + opens.name + ' by ' + down.way.name + '.';
    }
  }

  const crossed = stages.filter((s) => s.across.legs.length).map((s) => nameOf(view, s.mapId));
  const lines = stages.filter((s) => s.line).map((s) => s.line);
  lines.push(
    (seconds > 0 ? 'After ' + clock.duration(seconds) + ' in all' : 'At once') +
      (crossed.length ? ', across ' + list(crossed) : '') +
      ', you arrive at ' +
      target.name +
      '.' +
      arrival
  );
  return {
    outcome: 'success',
    mutations: [set('at', at)]
      .concat([...found].map((id) => add('discovered', id)))
      .concat([add('visited', targetId)])
      .concat(seconds ? [set('time', start + seconds)] : [])
      .concat([{ op: 'increment', path: 'worldClock', value: 1 }]),
    constraints: lines,
    journey: {
      stages: stages.map((s) => ({
        mapId: s.mapId,
        through: s.across.path,
        seconds: s.across.seconds,
      })),
    },
    ...(seconds ? { time: travel.timeSpent(start, seconds) } : {}),
  };
}

// The last place a journey's stages reached.
function lastOf(stages) {
  const last = stages[stages.length - 1];
  return last.across.path[last.across.path.length - 1];
}

/**
 * A move the frame can't hold, or null for today's rules: by an exit of
 * where the save stands (TV3), else to a place outside the frame (TV2).
 */
function depthMove(proposedAction, characterState, view) {
  if (!view || !view.frame || !view.regionLocations) return null;
  if (!proposedAction.targets || !proposedAction.targets[0]) return null;
  return (
    byExit(proposedAction, characterState, view) ||
    betweenParents(proposedAction, characterState, view)
  );
}

module.exports = { depthMove, withDescent, byExit, exitTo, betweenParents, cross, into };
