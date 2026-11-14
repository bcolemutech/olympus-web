'use strict';

/**
 * Journeys across country (planning/off-road-travel.md §4.4, TR1, TR5–TR8,
 * MD2; L-363 / #837): setting out toward any point or place on a region
 * map, the planner's path (../loom-canon/wild-plan.js) walked in day legs,
 * a camp each night in the wilds, the navigation check off the road
 * (../loom-modules/wilds), places near the path discovered, and closed
 * places reached and stood outside of.
 *
 *   travel(action, save, view, dice)   the `travel` verb: setting out
 *                     (params.offRoad, a place in targets[0] or
 *                     params.to { mapId, point }), going on (params.go
 *                     'on') or stopping (params.go 'stop'); a move made
 *                     in the wilds comes here as setting out for its place
 *   outside(view, save, place, from, opts)   arriving at a closed place by
 *                     road or by an exit: the save left in the wilds at its
 *                     edge (TR1), the resolution's mutations and line
 *   outsidePoint(view, place, from)   the point at a closed place's edge,
 *                     toward `from`
 *
 * A journey is kept on the save as `journey: { mapId, to, path, times,
 * routes, hours, done, leg, by, distance }`: the plan's points ({ x, y })
 * and the hours from the start at each, the stretches on a route (in
 * hours), its whole time, the hours of it walked, the legs walked, and
 * `by: 'wild'`. A leg is the module's `dayHours` of travel; one that ends
 * short of the goal camps there for the night (the rest of the day), so the
 * whole journey takes the plan's hours and a night between each day, as a
 * trip by road does (../loom-canon/travel.js). A failed navigation check
 * loses a share of the day: the camp is that much short and drifts off the
 * path, and the rest is planned again from there.
 *
 * After each day leg an event may happen at the camp (L-364; ../loom-modules/
 * wilds/events.js): a roll seeded by the save, the leg and the hour it began,
 * against the module's chance for the camp's danger, far lower on a route; the
 * path walked (the wilds, or a route's kind) shapes it. The roll, the chance
 * and the event are the turn's `event`, and the event is told with the leg. One
 * with figures to meet is played on a battle map (L-366; ../loom-modules/wilds/
 * arrive.js): at a camp or where the leg ends in the wilds the save is put on the
 * map at an entry, its figures standing there, and leaves by its edge back to
 * the journey; arriving at a place, it is told like the rest.
 *
 * Pure: returns a resolution, as ./adjudicate.js does.
 */

const clock = require('../loom-canon/clock');
const travel = require('../loom-canon/travel');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const routes = require('../loom-canon/routes');
const materials = require('../loom-canon/materials');
const checks = require('../loom-canon/checks');
const sheets = require('../loom-canon/sheets');
const wildPlan = require('../loom-canon/wild-plan');
const wilds = require('../loom-modules/wilds');
const { isPlayable } = require('../loom-canon/grading');

const blocked = (message) => ({ outcome: 'blocked', mutations: [], constraints: [message] });
const set = (path, value) => ({ target: 'save', op: 'set-flag', path, value });
const add = (path, value) => ({ target: 'save', op: 'add', path, value });
const tick = { op: 'increment', path: 'worldClock', value: 1 };
const live = (e) => Boolean(e) && !e.retired;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPoint = (p) => isObject(p) && Number.isFinite(p.x) && Number.isFinite(p.y);
const xy = (p) => ({ x: p[0], y: p[1] });
const pair = (p) => [p.x, p.y];

const EPSILON = 1e-6;
// How far outside a closed place the save stands: this share of the map's long side.
const OUTSIDE = 0.01;
// Points along a day's stretch whose danger makes the navigation check harder.
const SAMPLES = 8;

const OFF = "This world keeps to its roads: there's no travelling across country here.";
const NO_GROUND = "The land here isn't mapped for travel across country.";
const NOT_HERE = "You can't set out across country from here.";

/** The wilds module's settings in play here, or null when off-road travel is off. */
function settingsFor(view) {
  return wilds.settings.settingsOf(checks.systemOf(view), view);
}

// ── Where from, and where to ─────────────────────────────────────────

// The point on the frame's map the save sets out from, and what it is.
function startOf(view, save) {
  if (save.mapId) return { refused: NOT_HERE + ' Leave the map first.' };
  if (!save.location && isPoint(save.wild)) return { point: pair(save.wild), wild: true };
  const here = (view.locations || {})[save.location];
  const g = here && here.geo;
  if (!g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) return { refused: NOT_HERE };
  const place = save.placeId && (view.places || {})[save.placeId];
  if (save.townPoint || (place && !town.isEntrance(place))) {
    const ways = town.entrancesOf(view, save.location).map((p) => p.name);
    return {
      refused:
        'To set out across country, go to ' +
        (ways.length ? ways.join(' or ') : 'a way out of ' + here.name) +
        ' first.',
    };
  }
  return { point: [g.x, g.y], placeId: save.location };
}

// Where a journey heads: a place on the frame's map the save knows, or a point on it.
function goalOf(view, save, action) {
  const params = action.params || {};
  const to = isObject(params.to) ? params.to : null;
  if (to && isPoint(to.point)) {
    if (to.mapId && to.mapId !== view.frame.mapId) {
      return { refused: "You can only head across the land you're in." };
    }
    const bounds = wildPlan.boundsOf(view);
    const { x, y } = to.point;
    if (!bounds || x < 0 || y < 0 || x > bounds.width || y > bounds.height) {
      return { refused: "That's off the map." };
    }
    return { point: [x, y], name: null };
  }
  const id = (action.targets || [])[0];
  const place = id && (view.locations || {})[id];
  if (!place) return { refused: "There's no such place to head for." };
  if (!live(place)) return { refused: "That place can't be reached anymore." };
  const known = [].concat(save.discovered || [], save.visited || []);
  if (!known.includes(id)) return { refused: "You don't know where that is." };
  const g = place.geo || {};
  if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) {
    return { refused: "There's no way across country to " + place.name + '.' };
  }
  return { point: [g.x, g.y], placeId: id, name: place.name };
}

// ── A journey along a plan ───────────────────────────────────────────

// The kind of a route (a lane's id is its two ends', in order, joined by "|").
function routeKindOf(view, routeId) {
  const [a, b] = String(routeId || '').split('|');
  const links = (((view.locations || {})[a] || {}).geo || {}).links || {};
  return links[b] || 'trail';
}

// The journey kept on the save for a plan to `goal`.
function journeyOf(view, plan, goal) {
  const spans = [];
  let t = 0;
  for (const leg of plan.legs || []) {
    if (leg.by === 'route') {
      spans.push({ from: t, to: t + leg.hours, kind: routeKindOf(view, leg.route) });
    }
    t += leg.hours;
  }
  return {
    mapId: view.frame.mapId,
    to: {
      point: xy(goal.point),
      ...(goal.placeId ? { placeId: goal.placeId } : {}),
      ...(goal.name ? { name: goal.name } : {}),
    },
    path: plan.path.map(xy),
    times: plan.times.slice(),
    routes: spans,
    hours: plan.hours,
    done: 0,
    leg: 0,
    by: 'wild',
    distance: plan.distance,
  };
}

// The point `t` hours along a journey's path.
function pointAt(journey, t) {
  const { path, times } = journey;
  if (t <= times[0]) return pair(path[0]);
  for (let i = 1; i < path.length; i++) {
    if (t <= times[i] + EPSILON) {
      const span = times[i] - times[i - 1];
      const f = span > 0 ? Math.min(1, Math.max(0, (t - times[i - 1]) / span)) : 1;
      return [
        path[i - 1].x + (path[i].x - path[i - 1].x) * f,
        path[i - 1].y + (path[i].y - path[i - 1].y) * f,
      ];
    }
  }
  return pair(path[path.length - 1]);
}

// The points walked from hour `a` to hour `b`.
function stretch(journey, a, b) {
  const out = [pointAt(journey, a)];
  journey.path.forEach((p, i) => {
    if (journey.times[i] > a + EPSILON && journey.times[i] < b - EPSILON) out.push(pair(p));
  });
  out.push(pointAt(journey, b));
  return out;
}

// Whether hours `a` to `b` lie on a route the whole way.
function onRoute(journey, a, b) {
  return (journey.routes || []).some((s) => s.from <= a + EPSILON && s.to >= b - EPSILON);
}

// The average danger of the ground along a stretch.
function dangerAlong(view, points) {
  const samples = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const p = along(points, i / SAMPLES);
    const g = wildPlan.groundAt(view, p);
    samples.push(g ? g.danger : 1);
  }
  return samples.reduce((a, b) => a + b, 0) / samples.length;
}

// The point a share `f` of the way along a polyline.
function along(points, f) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
  let left = total * f;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[i - 1], points[i]);
    if (left <= d || i === points.length - 1) {
      const k = d > 0 ? Math.min(1, left / d) : 0;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * k,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * k,
      ];
    }
    left -= d;
  }
  return points[0];
}

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// How far a point is from a polyline.
function distanceTo(points, p) {
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1] || a;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    const t =
      len > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t)));
  }
  return best;
}

// The live places on the frame's map within `miles` (map distance units) of a stretch.
function nearPath(view, points, within) {
  const scale = wildPlan.scaleOf(view);
  const out = [];
  for (const loc of Object.values(view.locations || {})) {
    const g = loc && loc.geo;
    if (!live(loc) || !g || !Number.isFinite(g.x) || !Number.isFinite(g.y)) continue;
    if (distanceTo(points, [g.x, g.y]) * scale <= within + EPSILON) out.push(loc);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

// A material's name, from the world's own or the catalog.
function materialName(view, id) {
  const m = id && materials.materialOf('ground', id, view.materials);
  return ((m && m.name) || id || 'open ground').toLowerCase();
}

// The ground crossed along a stretch, most first: its names.
function terrainAlong(view, points) {
  const by = {};
  for (let i = 0; i <= SAMPLES; i++) {
    const g = wildPlan.groundAt(view, along(points, i / SAMPLES));
    const name = materialName(view, g && g.material);
    by[name] = (by[name] || 0) + 1;
  }
  return Object.keys(by).sort((a, b) => by[b] - by[a] || (a < b ? -1 : 1));
}

function andList(names) {
  if (names.length <= 1) return names.join('');
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

function distanceLine(view, distance) {
  const own = routes.ownUnit(view);
  const unit = own ? ((view.map && view.map.distance) || {}).unit || 'units' : 'miles';
  const n = own ? Math.round(distance * 10) / 10 : routes.roundMiles(distance);
  return n + ' ' + unit;
}

// The camp drifted off the path by `by` map units, to one side (`side` ±1);
// null when it can't be (off the map, or ground that can't be crossed).
function drifted(view, journey, t, by, side) {
  const a = pointAt(journey, Math.max(0, t - 0.25));
  const b = pointAt(journey, t + 0.25);
  const len = dist(a, b);
  if (!(len > 0) || !(by > 0)) return null;
  const here = pointAt(journey, t);
  const bounds = wildPlan.boundsOf(view);
  for (const s of [side, -side]) {
    const p = [here[0] + (-(b[1] - a[1]) / len) * by * s, here[1] + ((b[0] - a[0]) / len) * by * s];
    if (p[0] < 0 || p[1] < 0 || p[0] > bounds.width || p[1] > bounds.height) continue;
    const g = wildPlan.groundAt(view, p);
    if (g && g.speed > 0) return p;
  }
  return null;
}

// ── A closed place, reached ──────────────────────────────────────────

/** The point at the edge of a closed place, toward `from` ([x, y]). */
function outsidePoint(view, place, from) {
  const g = place.geo;
  const bounds = wildPlan.boundsOf(view) || { width: 1000, height: 1000 };
  const by = Math.max(bounds.width, bounds.height) * OUTSIDE;
  let dx = from ? from[0] - g.x : 1;
  let dy = from ? from[1] - g.y : 0;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const step = Math.min(by, len > 0 ? len : by);
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  return [clamp(g.x + dx * step, bounds.width), clamp(g.y + dy * step, bounds.height)];
}

// Whether a save in the wilds stands outside a place (within twice the outside distance).
function standsOutside(view, save, place) {
  if (save.location || !isPoint(save.wild)) return false;
  const bounds = wildPlan.boundsOf(view);
  const g = place && place.geo;
  if (!bounds || !g) return false;
  return (
    Math.hypot(save.wild.x - g.x, save.wild.y - g.y) <=
    Math.max(bounds.width, bounds.height) * OUTSIDE * 2 + EPSILON
  );
}

/**
 * Arriving at a closed place (TR1): the save in the wilds at its edge,
 * toward `from` ([x, y]): `{ mutations, line }`.
 */
function outside(view, place, from) {
  const p = outsidePoint(view, place, from);
  const at = view.frame.prefix
    .map((s) => ({ ...s }))
    .concat([{ mapId: view.frame.mapId, point: xy(p) }]);
  return {
    mutations: [set('at', at), add('discovered', place.id)],
    line:
      'You come to ' +
      place.name +
      ', but its way is closed to you: you stand outside, and can go no further in.',
  };
}

// ── The verb ─────────────────────────────────────────────────────────

/**
 * The `travel` verb (and a move made in the wilds): see the top of this
 * file. `seed` (the save's id) seeds the event rolls.
 */
function travelAction(proposedAction, save, view, dice, { seed } = {}) {
  const params = proposedAction.params || {};
  const by = seed || [save.ownerUid, save.worldId].filter(Boolean).join(':');
  if (params.go === 'stop') return stop(save);
  if (params.go === 'on') return goOn(save, view, dice, by);
  return setOut(proposedAction, save, view, dice, by);
}

function stop(save) {
  if (!save.journey) return blocked("You aren't on a journey.");
  return {
    outcome: 'success',
    mutations: [set('journey', null)],
    constraints: [
      save.location
        ? 'You put off the journey.'
        : 'You stop where you are, in the wilds, and put off the journey.',
    ],
  };
}

function goOn(save, view, dice, seed) {
  const journey = save.journey;
  if (save.mapId) return blocked(NOT_HERE + ' Leave the map first.');
  if (!journey) return blocked("You aren't on a journey. Choose where to head.");
  if (!view.frame || journey.mapId !== view.frame.mapId || !(journey.path || []).length) {
    return blocked('That journey is behind you now. Choose where to head.');
  }
  const settings = settingsFor(view);
  if (!settings) return blocked(OFF);
  return walkLeg(view, save, journey, dice, settings, [], [], seed);
}

function setOut(proposedAction, save, view, dice, seed) {
  if (!view.frame) return blocked(NOT_HERE);
  const settings = settingsFor(view);
  if (!settings) return blocked(OFF);
  const from = startOf(view, save);
  if (from.refused) return blocked(from.refused);
  const goal = goalOf(view, save, proposedAction);
  if (goal.refused) return blocked(goal.refused);
  if (goal.placeId && goal.placeId === from.placeId) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
  const place = goal.placeId && view.locations[goal.placeId];
  // Outside a closed place already: it can't be entered (TR1).
  if (place && !isPlayable(view, place) && standsOutside(view, save, place)) {
    return blocked(place.name + ' is closed to you: you can go no further in.');
  }
  if (dist(from.point, goal.point) < EPSILON) {
    return { outcome: 'no_op', mutations: [], constraints: ["You're already there."] };
  }
  if (!(view.map && isObject(view.map.geometry))) return blocked(NO_GROUND);
  const plan = wildPlan.planOn(view, from.point, goal.point, { state: save, pace: settings.pace });
  if (!plan || !(plan.path || []).length) {
    return blocked(
      'There is no way across country to ' +
        (goal.name || 'there') +
        ' from here that you can take.'
    );
  }
  const journey = journeyOf(view, plan, goal);
  const days = Math.max(1, Math.ceil(plan.hours / settings.dayHours - EPSILON));
  const opening = [
    'You set out across country' +
      (goal.name ? ' for ' + goal.name : '') +
      ': about ' +
      distanceLine(view, plan.distance) +
      ', ' +
      (days === 1 ? 'a day' : 'some ' + days + ' days') +
      "' travel.",
  ];
  // Leaving a town's way out (or a place): out onto the map.
  const leaving = save.placeId ? [set('placeId', null)] : [];
  return walkLeg(view, save, journey, dice, settings, opening, leaving, seed);
}

/**
 * Walks a journey's next day leg from where the save stands: the time, the
 * navigation check off the road, the camp or the arrival, what is
 * discovered on the way, and the event at the end of a leg off the road.
 */
function walkLeg(view, save, journey, dice, settings, opening, leaving = [], seed = '') {
  const system = checks.systemOf(view);
  const day = settings.dayHours;
  const done = journey.done || 0;
  const remaining = Math.max(0, journey.hours - done);
  const reach = Math.min(remaining, day);
  const planned = stretch(journey, done, done + reach);

  // The navigation check (MD2), off the road only.
  const offRoad = !onRoute(journey, done, done + reach);
  const nav = offRoad
    ? wilds.navigate.navigate(
        sheets.sheetOf(save),
        system,
        dangerAlong(view, planned),
        dice,
        settings
      )
    : null;
  const lostHours = nav ? nav.lost * day : 0;
  const progress = Math.max(0, Math.min(remaining, day - lostHours));
  const arrives = progress >= remaining - EPSILON;
  const travelHours = arrives ? remaining + lostHours : day;
  const nightHours = arrives ? 0 : Math.max(0, 24 - day);
  const seconds = Math.round((travelHours + nightHours) * clock.HOUR);
  const start = clock.timeOf(save);
  const walked = stretch(journey, done, done + progress);
  const leg = (journey.leg || 0) + 1;

  const lines = opening.slice();
  const terrain = terrainAlong(view, walked);
  lines.push(
    'You travel ' +
      clock.duration(travelHours * clock.HOUR) +
      (offRoad ? ' across ' + andList(terrain.slice(0, 3)) : ' along the way') +
      '.'
  );
  if (nav && lostHours > 0) {
    lines.push(
      'You lose your way' +
        (terrain[0] ? ' in the ' + terrain[0] : '') +
        ', and ' +
        clock.duration(lostHours * clock.HOUR) +
        ' with it.'
    );
  }

  // Places near the path walked (TR7).
  const known = new Set([].concat(save.discovered || []));
  const near = nearPath(view, walked, settings.discover).filter((p) => !known.has(p.id));
  const mutations = leaving.slice();
  for (const p of near) mutations.push(add('discovered', p.id));

  const end = walked[walked.length - 1];
  const prefix = view.frame.prefix.map((s) => ({ ...s }));
  let next = null;
  // Where the leg ends: the camp, or the arrival.
  let spot = end;
  // Whether it ends in the wilds (an event with figures is played on a map there).
  let inWilds = true;
  if (arrives) {
    const goal = journey.to || {};
    const place = goal.placeId && view.locations[goal.placeId];
    if (place && live(place) && !isPlayable(view, place)) {
      const out = outside(view, place, walked.length > 1 ? walked[walked.length - 2] : end);
      mutations.push(...out.mutations);
      lines.push(out.line);
    } else if (place && live(place)) {
      mutations.push(...arriveAt(view, save, place));
      lines.push('You arrive at ' + place.name + '.');
      inWilds = false;
    } else {
      const p = goal.point ? pair(goal.point) : end;
      mutations.push(set('at', prefix.concat([{ mapId: view.frame.mapId, point: xy(p) }])));
      lines.push('You reach the place you were heading for, and stop there in the wilds.');
    }
    mutations.push(set('journey', null));
  } else {
    let camp = end;
    next = { ...journey, done: done + progress, leg };
    // Lost: the camp drifts off the path by the ground lost, and the rest
    // is planned again from there.
    if (nav && lostHours > 0) {
      const g = wildPlan.groundAt(view, end);
      const by = (lostHours * settings.pace * ((g && g.speed) || 1)) / wildPlan.scaleOf(view);
      const side = nav.roll && nav.roll.total % 2 ? 1 : -1;
      const off = drifted(view, journey, done + progress, by, side);
      const again =
        off &&
        wildPlan.planOn(view, off, pair(journey.to.point), { state: save, pace: settings.pace });
      if (again && (again.path || []).length) {
        camp = off;
        spot = off;
        next = {
          ...journeyOf(view, again, {
            point: pair(journey.to.point),
            placeId: journey.to.placeId,
            name: journey.to.name,
          }),
          leg,
        };
        lines.push('You end the day off your path, and set your course again from there.');
      }
    }
    const g = wildPlan.groundAt(view, camp);
    lines.push(
      'You make camp for the night' +
        (g && g.material ? ' in the ' + materialName(view, g.material) : ' in the wilds') +
        '.'
    );
    mutations.push(set('at', prefix.concat([{ mapId: view.frame.mapId, point: xy(camp) }])));
    mutations.push(set('journey', next));
  }
  if (near.length) lines.push('On the way you find ' + andList(near.map((p) => p.name)) + '.');

  // Something on the way (L-364, EV7): after each leg, a roll seeded by the
  // save, the leg and the hour it began. A route is the safer way, so far
  // less likely than off the road; the sort of path walked (the wilds, or a
  // route's kind) shapes the event.
  const walkedPath = wilds.events.pathOf(journey.routes, done, done + progress);
  const eventSeed = [seed, leg, start].join(':');
  let onTheWay = wilds.events.happen(view, {
    settings,
    point: spot,
    seed: eventSeed,
    path: walkedPath.path,
    share: walkedPath.share,
  });
  if (onTheWay.event) {
    // One with figures is played on a map (L-366): the save put on it at an
    // entry, on the side it came from, its figures standing there.
    const played = inWilds
      ? wilds.arrive.arrive(view, save, {
          at: spot,
          event: onTheWay.event,
          from: walked.length > 1 ? walked[walked.length - 2] : null,
          seed: eventSeed,
          dice: wilds.events.dice(eventSeed + ':figures'),
        })
      : null;
    if (played) {
      lines.push(played.line);
      mutations.push(...played.mutations);
      onTheWay = {
        ...onTheWay,
        event: {
          ...onTheWay.event,
          map: { id: played.map.id, name: played.map.name, from: played.from },
        },
      };
    }
    lines.push(onTheWay.event.text);
  }
  mutations.push(set('time', start + seconds), tick);

  return {
    outcome: 'success',
    mutations,
    constraints: lines,
    ...(nav ? { roll: require('./adjudicate').rolled(nav.roll, nav.rung, system) } : {}),
    time: travel.timeSpent(start, seconds),
    journey: {
      offRoad: true,
      leg,
      terrain,
      hours: travelHours,
      ...(arrives ? { arrived: true } : { camp: true }),
      ...(nav ? { lost: lostHours } : {}),
    },
    // The roll, the chance and what it brought, for the record and the GM (L-364).
    ...(onTheWay ? { event: onTheWay } : {}),
  };
}

// Arriving at an open place across country: at it on the frame's map (its
// way in, for a town; its battle map, if it has one), out of the wilds.
function arriveAt(view, save, place) {
  const arrival = town.arrivalPlace(view, place.id, null, null);
  const been = Boolean(arrival) && (save.visited || []).includes(place.id);
  return [
    set('location', place.id),
    set('wild', null),
    set('placeId', arrival ? arrival.id : null),
    set('townPoint', null),
    add('discovered', place.id),
    ...(been
      ? maps.arrivalMutations(view, null, save)
      : maps.arrivalMutations(view, arrival || place, save)),
  ];
}

module.exports = {
  OUTSIDE,
  OFF,
  settingsFor,
  travel: travelAction,
  outside,
  outsidePoint,
  standsOutside,
  pointAt,
  journeyOf,
};
