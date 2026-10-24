'use strict';

const townPaths = require('../loom-canon/town-paths');
const ground = require('../loom-canon/ground');
const town = require('../loom-canon/town');
const { isPlaceOpen } = require('../loom-canon/grading');
const { turnStateOf } = require('../loom-models');
const { OUT_OF_MOVEMENT, heldBy } = require('./steps');

/**
 * Walking in a town with ground (planning/the-loom-movement-and-vision.md
 * §8; L-662 / #469), without the GM, as steps on a battle map are
 * (./steps.js). A move to a point on the street or to a place's door follows
 * the town's paths (town-paths.js), 20 m a point of movement, and stops when
 * movement runs out, the rest kept as the plan, which `continue` picks up.
 * The save then stands on the street at a point (`save.townPoint`), in no
 * place.
 *
 * Reaching a place's door takes you in: the caller runs the pipeline to
 * enter it, onto its battle map, narrated. Walks start from the street, or
 * from the door of the place the save is at (off its map).
 *
 * Pure: planTownStep reads a save and the canon world and says what the step
 * does; the caller writes it inside a transaction.
 */

const METRES_PER_POINT = 20;
const AT_DOOR = 0.5; // town units: standing this close to a door is at it

const round = (n) => Math.round(n * 100) / 100;
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < AT_DOOR;
const isPoint = (p) => Boolean(p) && Number.isFinite(p.x) && Number.isFinite(p.y);

/** The town a save can walk in now: off any map, in a settlement with ground. */
function streetOf(canonWorld, save) {
  if (!save || save.mapId) return null;
  const { location, place, point } = town.positionOf(canonWorld, save);
  const settlement = location && canonWorld.locations[location];
  if (!settlement || !ground.hasGround(settlement)) return null;
  const from = point || (place && isPoint(place.position) ? place.position : null);
  if (!from) return null;
  return { settlement, ground: ground.groundOf(settlement), from, place: place || null };
}

/** Whether a save walks its town's paths: on the street of a town with ground. */
function walksTown(canonWorld, save) {
  return Boolean(streetOf(canonWorld, save));
}

/** The save's plan, if it is a walk in the town it stands in now. */
function townPlanOf(save) {
  const plan = turnStateOf(save).plan;
  return plan && plan.layer === 'town' && plan.locationId === save.location ? plan : null;
}

const walkedLine = (metres) => 'You walk ' + Math.round(metres) + ' m.';

/**
 * What a walk in town does, for a save as it stands now:
 *   { refused: line }                          — nothing happens
 *   { point, turn, lines, walked, enter? }     — it walks, to the point
 *                                                reached; `walked` is the way
 *                                                it went (town points);
 *                                                `enter` is the place whose
 *                                                door it reached
 * `target` is { point }, { placeId } or { plan: true } (walk the plan). A
 * point may carry `leaveFor`, a world place to set out for from it (a typed
 * move out of town walks to a way out first; L-663): the plan keeps it, and
 * arriving says `leave`.
 */
function planTownStep(canonWorld, save, target) {
  const street = streetOf(canonWorld, save);
  if (!street) return { refused: 'There are no streets to walk here.' };
  const { settlement, from } = street;
  // Held where you stand by a condition (L-815: Stunned).
  const held = heldBy(canonWorld, save);
  if (held) return { refused: held };
  const turn = turnStateOf(save);

  let placeId = target.placeId || null;
  let to = target.point || null;
  let leaveFor = target.leaveFor || null;
  if (target.plan) {
    const plan = townPlanOf(save);
    if (!plan) return { refused: 'You have no way planned. Tap where to go.' };
    placeId = plan.placeId || null;
    leaveFor = plan.leaveFor || null;
    to = plan.to;
  }
  const leaving = leaveFor ? { leave: leaveFor } : {};
  let place = null;
  if (placeId) {
    place = (canonWorld.places || {})[placeId];
    if (!place || place.locationId !== settlement.id) {
      return { refused: "You can't get there directly from here." };
    }
    if (place.retired) return { refused: "That place can't be reached anymore." };
    if (!isPlaceOpen(canonWorld, place)) {
      return { refused: 'The way to ' + place.name + ' is closed. Turn back.' };
    }
    const required = town.missingAbility(place, save);
    if (required) {
      return { refused: 'You lack what it takes to get in (requires: ' + required + ').' };
    }
    if (!isPoint(place.position)) {
      return { refused: "You can't find the way to " + place.name + '.' };
    }
    to = place.position;
  }
  if (!isPoint(to) || to.x < 0 || to.y < 0 || to.x > 1000 || to.y > 1000) {
    return { refused: "That's outside the town." };
  }
  if (near(from, to)) {
    if (!place && leaveFor)
      return {
        point: { x: to.x, y: to.y },
        turn: { ...turn, plan: null },
        lines: [],
        walked: [from, to],
        ...leaving,
      };
    if (!place) return { refused: "You're already there." };
    // At its door already: in you go.
    return {
      point: { x: to.x, y: to.y },
      turn: { ...turn, plan: null },
      lines: [],
      walked: [from, to],
      enter: place,
    };
  }
  if (!place && ground.blockedAt(street.ground, to)) return { refused: "You can't stand there." };
  const path = townPaths.pathTo(street.ground, from, to, {
    size: town.townSize(settlement).metres,
  });
  if (!path) return { refused: "There's no way there from here." };
  // In town the pool walks 20 m a point, and actions cost nothing (L-832;
  // action points WH2).
  if (turn.ap < 1) return { refused: OUT_OF_MOVEMENT };

  const step = townPaths.walk(path, turn.ap * METRES_PER_POINT);
  const spent = step.arrived
    ? Math.min(turn.ap, Math.ceil(step.walked / METRES_PER_POINT - 1e-9))
    : turn.ap;
  const ap = turn.ap - spent;
  const lines = [walkedLine(step.walked)];
  if (step.arrived) {
    return {
      point: { x: to.x, y: to.y },
      turn: { ...turn, ap, plan: null },
      lines,
      walked: path.points,
      ...(place ? { enter: place } : {}),
      ...leaving,
    };
  }
  return {
    point: { x: round(step.to.x), y: round(step.to.y) },
    turn: {
      ...turn,
      ap,
      plan: {
        layer: 'town',
        locationId: settlement.id,
        to: { x: to.x, y: to.y },
        placeId: place ? place.id : null,
        ...(leaveFor ? { leaveFor } : {}),
        metres: Math.round(step.rest.metres),
      },
    },
    lines: lines.concat([OUT_OF_MOVEMENT]),
    // The way walked, for what is seen on it (L-671).
    walked: path.points
      .slice(0, path.points.length - step.rest.points.length + 1)
      .concat([step.to]),
  };
}

/** Whether a save on the street stands at a place's door. */
function atDoorOf(save, place) {
  return (
    Boolean(save && isPoint(save.townPoint) && place && isPoint(place.position)) &&
    near(save.townPoint, place.position)
  );
}

/**
 * The way out of town a walk to leave by heads for (L-663): of the open ways
 * out serving the route, the nearest on foot (then by id). Null when none
 * can be walked to.
 */
function nearestWayOut(canonWorld, save, ways) {
  const street = streetOf(canonWorld, save);
  if (!street) return null;
  const size = town.townSize(street.settlement).metres;
  let best = null;
  for (const way of ways) {
    if (way.retired || !isPlaceOpen(canonWorld, way) || !isPoint(way.position)) continue;
    const path = townPaths.pathTo(street.ground, street.from, way.position, { size });
    if (!path) continue;
    if (
      !best ||
      path.units < best.units - 1e-9 ||
      (Math.abs(path.units - best.units) < 1e-9 && way.id < best.way.id)
    ) {
      best = { way, units: path.units };
    }
  }
  return best ? best.way : null;
}

module.exports = {
  planTownStep,
  walksTown,
  streetOf,
  townPlanOf,
  atDoorOf,
  nearestWayOut,
  METRES_PER_POINT,
};
