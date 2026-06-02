(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // Coarser grid than pathfinder's trade-route default (160) — each nav cell is a
  // meaningful movement step (~12×16 world units on a typical 600×800 map).
  var NAV_GRID_SIZE = 50;

  // AP budget per turn derived from ship speed (1–100 scale, per §5 ship stats).
  var SPEED_AP_BRACKETS = [
    { min: 80, ap: 10 },
    { min: 70, ap: 8 },
    { min: 60, ap: 7 },
    { min: 50, ap: 6 },
    { min: 35, ap: 4 },
    { min: 0, ap: 3 },
  ];

  function speedToAP(speed) {
    for (var i = 0; i < SPEED_AP_BRACKETS.length; i++) {
      if (speed >= SPEED_AP_BRACKETS[i].min) return SPEED_AP_BRACKETS[i].ap;
    }
    return 3;
  }

  // Build the navigation land mask from world coastlines at NAV_GRID_SIZE resolution.
  // Returns the meta object expected by findPath / findPathFull in pathfinder.js.
  function buildGraph(worldData) {
    return T.pathfinder.buildLandMask(worldData.bounds, worldData.coastlines, NAV_GRID_SIZE);
  }

  // Returns { displayPath, gridPath, steps } or null when no water path exists.
  // displayPath — simplified polyline for the map overlay
  // gridPath    — full cell-by-cell path in world coords for step animation
  // steps       — AP cost (each grid hop = 1 AP)
  function findPath(graph, fromPos, toPos) {
    return T.pathfinder.findPathFull(graph, fromPos, toPos);
  }

  // Returns all water cells reachable within apBudget AP from fromPos.
  // Each element: { worldPos: [y,x], steps: number }
  function reachableCells(graph, fromPos, apBudget) {
    return T.pathfinder.reachableCells(graph, fromPos, apBudget);
  }

  T.seaGraph = {
    buildGraph: buildGraph,
    findPath: findPath,
    reachableCells: reachableCells,
    speedToAP: speedToAP,
    NAV_GRID_SIZE: NAV_GRID_SIZE,
  };
})();
