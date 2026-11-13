'use strict';

const { ToolError } = require('../../registry');
const routes = require('../../../loom-canon/routes');

// Reading a route's line and rules from a tool's input (L-715; planning/
// worlds-without-azgaar.md §4.5, PL4, PL7), shared by connect_locations (the
// top map's links), connect_places and add_places (a map's). The stored shape
// is in ../../../loom-canon/routes.js.

/**
 * The line and rules a tool call gives, checked: waypoints inside the map
 * (`bounds`: { width, height } in its units, or none to skip the test), the
 * rules' faction a live realm of the world. `at` prefixes a refusal ("Link
 * 2: "). Returns `{ waypoints?, rules? }` with only what was given; throws a
 * ToolError naming what is wrong.
 */
function routeInput(world, input, bounds, at = '') {
  const out = {};
  if (input.waypoints !== undefined) {
    const { points, errors } = routes.checkWaypoints(input.waypoints, bounds);
    if (errors.length) throw new ToolError(at + errors.join(' '));
    out.waypoints = points;
  }
  if (input.rules !== undefined) {
    const rules = {};
    for (const [key, value] of Object.entries(input.rules)) {
      if (value === undefined) continue;
      if (key === 'hostileToFactionId' && value !== null) {
        const faction = ((world && world.factions) || {})[value];
        if (!faction || faction.retired) {
          throw new ToolError(
            `${at}No realm "${value}" for the route to be hostile to (get_world).`
          );
        }
      }
      rules[key] = value;
    }
    out.rules = rules;
  }
  return out;
}

/**
 * The extras a link ends up with on each of its two ends once `change`
 * (routeInput's) is applied to what it holds: `{ a, b }`, each `{ waypoints?,
 * rules? }` or null for none, `b`'s waypoints turned round. `had` is the link
 * as seen from `a`.
 */
function extrasAfter(had, change) {
  const a = routes.applyExtras(had, change);
  const b = a && {
    ...a,
    ...(a.waypoints ? { waypoints: a.waypoints.slice().reverse() } : {}),
  };
  return { a, b };
}

module.exports = { routeInput, extrasAfter };
