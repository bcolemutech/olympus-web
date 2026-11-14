(function () {
  'use strict';

  // Travel across country on the region map, as the page shows it before the
  // player sets out (planning/off-road-travel.md §4.7, TR5; L-367 / #841).
  //
  // The preview is the turn's own plan: wild-paths.js, the same file the server
  // runs, fed what loomGetMap's `wilds` carries (the wilds module's pace and
  // day, the map's scale and unit, the world's overrides of its ground, the
  // regions' dangers and the zones that name them, the routes the save knows as
  // lanes) over the region map's drawn ground. So its path, distance and hours
  // are the ones the journey keeps (tests/loom-wild-map-draw.test.js checks it).
  //
  //   ready(data)            whether the map offers travel across country
  //   startOf(data, here)    where a journey would set out from, [x, y]: the
  //                          camp in the wilds, else the place the save is in
  //   planTo(data, from, to) the planner's path, or null for no way
  //   summary(data, plan)    the words for a plan: { hours, days, distance,
  //                          terrain, rating, ratingId, time, line }
  //   groundAt(data, point)  the name of the ground at a point, or null
  //   rate(danger)           the wildness rating of an average danger
  //
  // Loaded after wild-paths.js and materials.js, before world.js.

  var Loom = window.Loom;

  // The wildness rating from the average danger along the way (EV6: danger runs
  // from 0.5, calm, to 2, deadly; 1 is the default): the first whose `below`
  // the danger is under.
  var RATINGS = [
    { id: 'calm', label: 'calm', below: 0.8 },
    { id: 'wild', label: 'wild', below: 1.3 },
    { id: 'dangerous', label: 'dangerous', below: 1.8 },
    { id: 'deadly', label: 'deadly', below: Infinity },
  ];

  var EPSILON = 1e-6;
  var composed = typeof WeakMap === 'function' ? new WeakMap() : null;

  function rate(danger) {
    var d = typeof danger === 'number' && isFinite(danger) ? danger : 1;
    for (var i = 0; i < RATINGS.length; i++) {
      if (d < RATINGS[i].below) return RATINGS[i];
    }
    return RATINGS[RATINGS.length - 1];
  }

  function ready(data) {
    return Boolean(
      data && data.wilds && data.map && data.map.geometry && data.map.width && data.map.height
    );
  }

  // The map's drawn geometry with the zones that name regions put back (a map's
  // drawn geometry has none), kept per map data so the planner's grid is cached.
  function geometryOf(data) {
    var held = composed && composed.get(data);
    if (held) return held;
    var geometry = Object.assign({}, data.map.geometry, { zones: data.wilds.zones || [] });
    if (composed) composed.set(data, geometry);
    return geometry;
  }

  function startOf(data, here) {
    if (data && data.wild) return [data.wild.x, data.wild.y];
    if (here && typeof here.x === 'number' && typeof here.y === 'number') return [here.x, here.y];
    return null;
  }

  function groundOptions(data) {
    return {
      geometry: geometryOf(data),
      bounds: { width: data.map.width, height: data.map.height },
      own: data.materials,
      wilds: data.wilds.overrides,
      regions: data.wilds.regions,
    };
  }

  function planTo(data, from, to) {
    if (!ready(data) || !from || !to) return null;
    var opts = groundOptions(data);
    opts.from = from;
    opts.to = to;
    opts.scale = data.wilds.scale;
    opts.pace = data.wilds.pace;
    opts.routes = data.wilds.lanes;
    var plan = Loom.wildPaths.plan(opts);
    return plan && plan.path && plan.path.length ? plan : null;
  }

  function nameOf(data, id) {
    var m = id && Loom.materials.materialOf('ground', id, data.materials);
    return ((m && m.name) || id || '').toLowerCase();
  }

  function groundAt(data, point) {
    if (!ready(data) || !point) return null;
    var opts = groundOptions(data);
    var g = Loom.wildPaths.at(opts, point);
    return g && g.material ? nameOf(data, g.material) : null;
  }

  function andList(names) {
    if (names.length <= 1) return names.join('');
    return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  }

  // As the journal's opening line says it (wild-journeys.js distanceLine).
  function distanceWords(data, distance) {
    var unit = data.wilds.unit || 'miles';
    var n =
      unit === 'miles'
        ? distance < 10
          ? Math.round(distance * 10) / 10
          : Math.round(distance)
        : Math.round(distance * 10) / 10;
    return 'about ' + n + ' ' + unit;
  }

  function timeWords(hours, dayHours) {
    if (hours <= dayHours + EPSILON) {
      var h = Math.max(1, Math.round(hours));
      return h === 1 ? 'about an hour' : 'about ' + h + ' hours';
    }
    var days = Math.max(1, Math.ceil(hours / dayHours - EPSILON));
    return days + ' days';
  }

  /** The words for a plan: see the top of this file. */
  function summary(data, plan) {
    var dayHours = data.wilds.dayHours;
    var days = Math.max(1, Math.ceil(plan.hours / dayHours - EPSILON));
    var terrain = (plan.terrain || []).slice(0, 2).map(function (t) {
      return nameOf(data, t.material);
    });
    var rating = rate(plan.danger);
    var distance = distanceWords(data, plan.distance);
    var time = timeWords(plan.hours, dayHours);
    return {
      hours: plan.hours,
      days: days,
      distance: distance,
      time: time,
      terrain: terrain,
      rating: rating.label,
      ratingId: rating.id,
      line:
        distance +
        ' · ' +
        time +
        (terrain.length ? ' · ' + andList(terrain) : '') +
        ' · ' +
        rating.label,
    };
  }

  Loom.wildView = {
    RATINGS: RATINGS,
    rate: rate,
    ready: ready,
    startOf: startOf,
    planTo: planTo,
    summary: summary,
    groundAt: groundAt,
  };
})();
