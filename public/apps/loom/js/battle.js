(function () {
  'use strict';

  // The battle level of the map engine (planning/the-map-first-loom.md §4.3;
  // L-724 / #595): the battle map the player stands on, from loomGetMap's
  // `battleMap` (planning/the-loom-layered-worlds.md §9). Its art (or a plain
  // grid) under the grid; its layers (L-627): on a plain grid, walls and
  // obstacles (solid dark, low hatched, difficult dotted), over art the art
  // shows them; doors always, by their state for this save (closed amber,
  // open dashed, locked red); entries, exits and features; the people in
  // sight (L-642) and you, as tokens with initials (A6).
  //
  // - The fog (L-634, A3): from loomGetMap's `fog` (L-633), squares never
  //   seen are dark, those seen before but out of sight now dimmed, those in
  //   sight clear, with feathered edges and a faint grain. The dimming lies
  //   under the grid and the layers, so the layout remembered still reads;
  //   the dark covers everything. Only what the server sent is drawn.
  // - The turn (L-615): this turn's reach is lit; a selected square shows
  //   the path a move would take (map-paths.js, the server's own planner and
  //   move: in feet, through gaps as wide as the character, 1 AP per 5 ft
  //   rounded up once; L-922), solid for this turn and dashed after, and a
  //   kept plan is dashed. After a move the token walks its path (K3; a
  //   click skips ahead, reduced motion jumps). Reach and paths cover only
  //   squares seen (L-635).
  // - Hazards (L-815; EF9): the squares of each in sight, tinted, edged and
  //   named. Walking into one stops the walk there; its save is the turn's
  //   roll card.
  // - Every click opens the engine's menu (I2), no one-tap shortcuts: on a
  //   square, Move (step there, go to someone or a feature, go out by an
  //   exit; beyond this turn the rest is kept as the plan) and What's here?
  //   (#672: the GM describes it, free); on a door, Open, Close or Try it
  //   from beside it, and What's here?.
  //
  // The map is drawn in map coordinates (CELL units a square, PAD around
  // the grid) in a container the camera moves, so panning only moves it; it
  // is rebuilt when what it shows or the zoom changes. Strokes, tokens and
  // labels keep their size on screen at every zoom.

  var Loom = window.Loom;
  var state = Loom.state;
  var M = Loom.mapMath;
  var MP = Loom.mapPaths;
  var engine = Loom.engine;
  var CELL = 40;
  var PAD = 60; // room for the labels of squares at the edge
  // Room above the grid (L-941, TV4): PAD, or more for walls standing on its
  // top edge to rise into; set with the map.
  var TOP = PAD;
  var RISE_PX = 0; // how far up the screen the tallest wall rises
  // The isometric view (planning/isometric-view.md §4.1, IS1, IS2, IN2, C2;
  // L-951 / #857): the grid turned 45° and drawn 2:1, a square a diamond
  // twice as wide as tall, its north to the top right, and a foot of height
  // rising ISO_RISE floor units up the screen. What lies on the floor (the
  // painter's ground, lines and shadows; the reach, areas, hazards, fog, the
  // path and selections) is drawn on the grid as before, under one
  // transform; what stands (the painter's walls, doors, windows and props,
  // L-952, and the tokens) is built on the isometric screen and drawn back to
  // front by footprint, the tokens placed in that order as they move; names
  // and foes' cards are placed there, upright; clicks are worked back to the
  // floor. The rules stay on the flat grid, in feet.
  // The default since L-953; `?view=tq` on the page (or
  // Loom.battle.setIso(false)) draws the three-quarter view, to compare.
  var ISO_RISE = 1.22;
  var iso = !/[?&]view=tq(&|#|$)/.test((window.location && window.location.search) || '');
  // Seeing and picking in isometric (planning/isometric-view.md §4.3, IS4,
  // IN1; L-953 / #859): what stands in front of a token, the pointer or the
  // path fades (judged on the isometric screen, by footprint); the walls-low
  // button drops every wall to a 2 ft stub, remembered per player on the
  // device; a click picks the front-most thing drawn under it (a door's
  // leaf or the wall over it, a usable object's picture, a token), walls and
  // decor falling through to the floor; a hover lights what a click picks.
  var WALLS_LOW_KEY = 'loom.wallsLow.';
  var LIT = 0xffe082; // the hover's outline
  var STEP_MS = 110; // the token's walk: a square (5 ft) in this long
  var DOOR_HIT = 0.2; // squares from a door's line that a click picks it

  var COLOURS = {
    ground: 0x1a1f2c,
    groundEdge: 0xffffff,
    grid: 0xffffff,
    entry: 0x66bb6a,
    exit: 0xef5350,
    exitLabel: 0xffab91,
    feature: 0xffb74d,
    dark: 0x0a0e1a,
    reach: 0xffb74d,
    path: 0xffb74d,
    selected: 0xffffff,
    person: 0x4db6ac,
    foe: 0xe57373, // someone hostile (L-828)
    friend: 0x81c784, // someone on your side (L-828)
    wary: 0xffb74d, // someone wary of you, who challenges first (L-392)
    you: 0xffffff,
    ring: 0xffb74d,
    label: 0xe0e0e0,
    hazard: 0xce93d8, // a hazard's squares (L-815)
    range: 0xef9a9a, // an attack's reach or range (L-828)
    cover: 0x90caf9, // a target's cover (L-828)
    card: 0xfff3e0, // a foe's card over its token while its turn plays out
    turn: 0xfff59d, // the ring round the one whose turn is playing out (L-932)
    area: 0x9fa8da, // an area's tint, edge and name (#670)
  };
  var CARD_MS = 1100; // how long a foe's card shows over its token (L-828)
  var FOG_DIM = 0.6; // seen before, out of sight now
  var FOG_SCALE = 4; // fog texture pixels a square, before it is stretched
  var FOG_BLUR = 3; // px of that texture: the feathered edge, about ¾ of a square
  var FOG_DIM_SCALE = 12; // the dimming's texture pixels a square: its edge follows the sight lines (L-924)
  var FOG_DIM_BLUR = 2; // px of that texture: a soft edge, a sixth of a square
  var MIST = 0.16; // the drifting mist over unseen ground, at its thickest (K3)
  var MIST_RGB = '84,98,128';
  var MIST_PERIOD = 9; // s for the mist to thin and thicken

  var battle = {
    data: null, // loomGetMap's `battleMap`
    turn: null, // loomGetMap's `turn` (L-611): movement left, the plan
    selected: null, // a cell { x, y }
    selectedDoor: null, // a door's id, when a door is clicked (L-627)
    selectedObject: null, // an object's id, when one there is something to do with is clicked (L-926)
    art: null, // its image (Loom.draw.art): the copy, then the full image (L-727)
    reach: null, // this turn's reach: { runs: [{ y, x0, x1 }] }
    fog: null, // the fog (L-634): { dark: runs, dim: runs }, as reach's runs
    known: null, // whether a square (by y × width + x) has been seen (L-635)
    cursor: null, // where the pointer is over the map, in feet (L-942), for seeing behind walls
    cursorPick: null, // what the pointer would pick in isometric (L-953), never faded for it
    lit: null, // what a click would pick, lit (L-953): { hit } or { cell }
    litKey: '', // what the lit outline was last drawn for
    wallsLow: null, // the walls-low button (L-953): null until read from the device
    fadeAt: 0, // when the walls last faded for what is behind them
    fadeTimer: 0, // the throttled check waiting, for the pointer
    preview: null, // the move to the selected cell: { path, walked, rest, stop, end, short, cost, feet, turns } or { none }
    pending: null, // a move sent: { mapId, points } in feet, for the walk when it lands
    anim: null, // the token's walk: { cells, t0 }
    playback: null, // everyone else's turns playing out (L-828): { steps, t0, end }
    version: 0, // bumped when what is drawn changes
    built: null, // what the drawing was last built for
    nodes: null, // the PixiJS objects
    labels: [], // the labels in use
    tokens: {}, // person id → token
    fogTextures: { key: null, dim: null, dark: null, mist: null, unseen: 0 },
  };

  // Something drawn changed: rebuild on the next draw.
  function changed() {
    battle.version += 1;
  }

  // ── Helpers ───────────────────────────────────────

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function same(a, b) {
    return Boolean(a) && Boolean(b) && a.x === b.x && a.y === b.y;
  }

  // The exit and the feature at a cell, if any.
  function at(cell) {
    var d = battle.data;
    var find = function (list) {
      return (
        list.filter(function (item) {
          return same(item, cell);
        })[0] || null
      );
    };
    return { exit: find(d.exits), feature: find(d.features) };
  }

  // The area a seen square is in (#670): the smallest holding it, or null.
  function areaAt(cell) {
    var best = null;
    (battle.data.areas || []).forEach(function (area) {
      var hit = area.squares.some(function (sq) {
        return same(sq, cell);
      });
      if (hit && (!best || area.squares.length < best.squares.length)) best = area;
    });
    return best;
  }

  // Who stands on a cell, of the people in sight (L-642), or null.
  function personAt(cell) {
    return (
      (battle.data.people || []).filter(function (p) {
        return p.x !== undefined && same(p, cell);
      })[0] || null
    );
  }

  // A cell's middle, in map coordinates.
  function centre(cell) {
    return { x: PAD + (cell.x + 0.5) * CELL, y: TOP + (cell.y + 0.5) * CELL };
  }

  // A point in map coordinates, in feet.
  function feetOf(m) {
    return { x: ((m.x - PAD) / CELL) * MP.FEET, y: ((m.y - TOP) / CELL) * MP.FEET };
  }

  // A point in feet (L-922) in map coordinates.
  function spot(p) {
    return { x: PAD + (p.x / MP.FEET) * CELL, y: TOP + (p.y / MP.FEET) * CELL };
  }

  // ── The projection (L-951) ────────────────────────
  //
  // Map coordinates are the grid's, as the floor is drawn: PAD and TOP at its
  // north-west corner, CELL a square. The scene is what the camera sees: the
  // same in the three-quarter view; in the isometric one, a grid point (u, v)
  // from the corner is drawn at (u − v, (u + v) / 2) from isoOrigin().

  // Where the map's north-west corner is drawn in isometric: its west corner
  // (the map's south-west) at the left margin, room above for what rises at
  // its north edge.
  function isoOrigin() {
    var d = battle.data;
    return { x: PAD + (d ? d.height * CELL : 0), y: PAD + RISE_PX };
  }

  // A point in map coordinates on the scene.
  function toScene(g) {
    if (!iso) return { x: g.x, y: g.y };
    var o = isoOrigin();
    var u = g.x - PAD;
    var v = g.y - TOP;
    return { x: o.x + u - v, y: o.y + (u + v) / 2 };
  }

  // A point on the scene back on the floor, in map coordinates.
  function toGrid(s) {
    if (!iso) return { x: s.x, y: s.y };
    var o = isoOrigin();
    var a = s.x - o.x; // u − v
    var b = 2 * (s.y - o.y); // u + v
    return { x: PAD + (a + b) / 2, y: TOP + (b - a) / 2 };
  }

  // The transform that lays what's drawn in map coordinates on the scene.
  function floorMatrix() {
    var PIXI = window.PIXI;
    if (!iso) return new PIXI.Matrix();
    var o = isoOrigin();
    return new PIXI.Matrix(1, 0.5, -1, 0.5, o.x - PAD + TOP, o.y - (PAD + TOP) / 2);
  }

  // Where the painter's standing layer has its map's corner on the scene, and
  // its scale (its units are feet), for its parts and the drawer's tokens.
  function standAt() {
    var at = iso ? isoOrigin() : { x: PAD, y: TOP };
    return { x: at.x, y: at.y, scale: CELL / MP.FEET };
  }

  // A point on the scene in the standing layer's units.
  function standUnits(s) {
    var at = standAt();
    return { x: (s.x - at.x) / at.scale, y: (s.y - at.y) / at.scale };
  }

  // A floor point in feet on the scene.
  function sceneOf(p) {
    return toScene(spot(p));
  }

  // Where the player stands, in feet: sent with the map, else its square's centre.
  function hereFeet() {
    var d = battle.data;
    return d.herePoint || MP.centreOf(d.here);
  }

  // The map as this character moves on it, as the server plans a move
  // (map-paths.js viewPlanner; L-922): as far as it has been seen, each door
  // as this save has it (or `opened` on the way), at this character's prices
  // (L-832: the turn's `prices`) and width, never into a square not seen
  // (L-635) nor an exit but the one at `goal`.
  function planFor(goal, opened) {
    return MP.viewPlanner(battle.data, (battle.turn && battle.turn.prices) || null, {
      goal: goal,
      opened: opened,
      known: battle.known ? known : null,
    });
  }

  // Whether the save has seen a square (L-635): everything, without a fog.
  function known(cell) {
    return !battle.known || battle.known(cell.y * battle.data.width + cell.x);
  }

  // The doors seen of the map, each in this save's state: its geometry's
  // (L-922; since L-928 nothing else), as the server sends them.
  function doorsOf(d) {
    return ((d && d.geometry) || {}).doors || [];
  }

  function doorById(id) {
    return (
      doorsOf(battle.data).filter(function (d) {
        return d.id === id;
      })[0] || null
    );
  }

  // A door's ends in feet.
  function endsOf(door) {
    var at = function (p) {
      return Array.isArray(p) ? { x: p[0], y: p[1] } : { x: p.x, y: p.y };
    };
    return [at(door.from), at(door.to)];
  }

  // The two squares either side of a door's middle (as the server's
  // loom-canon/doors.js has it): for a door along a grid line, the squares
  // it stands between.
  function doorSides(door) {
    var ends = endsOf(door);
    var a = ends[0];
    var b = ends[1];
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    var nx = (-(b.y - a.y) / len) * (MP.FEET / 4);
    var ny = ((b.x - a.x) / len) * (MP.FEET / 4);
    var sq = function (x, y) {
      return { x: Math.floor(x / MP.FEET + 1e-9), y: Math.floor(y / MP.FEET + 1e-9) };
    };
    return [sq(mx - nx, my - ny), sq(mx + nx, my + ny)].sort(function (p, q) {
      return p.x + p.y - (q.x + q.y);
    });
  }

  function besideDoor(door) {
    return doorSides(door).some(function (side) {
      return same(side, battle.data.here);
    });
  }

  function doorName(id) {
    var door = doorById(id);
    return door ? door.name || 'a door' : 'a door';
  }

  // The AP left this turn (L-832), what steps are paid from; with AP off
  // (L-838) steps are free.
  function movementLeft() {
    if (battle.turn && battle.turn.apOff) return Infinity;
    return battle.turn ? battle.turn.ap : 0;
  }

  // What an action costs this character (L-837), from the turn's prices:
  // `id` one of its actions (dodge, withdraw, standUp, object…); null with
  // AP off, or when it isn't known.
  function actionCost(id) {
    var turn = battle.turn;
    if (!turn || turn.apOff || !turn.prices || !turn.prices.actions) return null;
    var n = turn.prices.actions[id];
    return n === undefined ? null : n;
  }

  // A cost as the menu says it: "10 AP"; '' with AP off.
  function apText(cost) {
    if (cost === undefined || battle.turn == null || battle.turn.apOff) return '';
    return cost === null ? 'not possible now' : cost + ' AP';
  }

  // Why the AP left won't pay for `cost`, or null (L-837): "Costs 10 AP; you
  // have 6." A cost of null (a condition's 'never') can't be paid at all.
  function short(cost) {
    var turn = battle.turn;
    if (!turn || turn.apOff || cost === undefined) return null;
    if (cost === null) return "You can't do that now.";
    return cost > turn.ap ? 'Costs ' + cost + ' AP; you have ' + turn.ap + '.' : null;
  }

  // A menu item's note: its cost first, then the rest.
  function noted(cost, rest) {
    return [apText(cost), rest].filter(Boolean).join(' · ');
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function now() {
    return window.performance ? window.performance.now() : Date.now();
  }

  function listOf(words) {
    if (words.length < 2) return words.join('');
    return words.slice(0, -1).join(', ') + ' or ' + words[words.length - 1];
  }

  // ── Data ──────────────────────────────────────────

  // A grid's own painting is drawn only if it is a floor painting (L-955, AR2,
  // C4): its floors, under the walls, doors and objects that stand from the
  // data. A painting of anything else (the old top-down ones, with walls and
  // furniture painted in) is not drawn, and the map draws from its data.
  function floorArt(data) {
    return data && data.image && data.image.view === 'floor' ? data.image : null;
  }

  // The map's art: its screen-sized copy first, the full image once zoomed in
  // (A1; L-727).
  function loadArt(image) {
    if (!battle.art) {
      battle.art = Loom.draw.art(function () {
        changed();
        engine.draw();
      }, 'battle-map art');
    }
    battle.art.set(image);
  }

  /** Takes loomGetMap's `battleMap` (or null), and its `turn`. */
  function setData(data, turn) {
    var moved = !battle.data || !data || battle.data.id !== data.id;
    battle.data = data || null;
    battle.turn = turn || null;
    TOP = topOf(battle.data);
    if (moved) {
      battle.selected = null;
      battle.anim = null;
      battle.cursor = null;
      battle.cursorPick = null;
      battle.lit = null;
    }
    walkIfMoved();
    if (battle.selectedDoor && (!battle.data || !doorById(battle.selectedDoor))) {
      battle.selectedDoor = null;
    }
    if (battle.selectedObject && (!battle.data || !usable(battle.selectedObject))) {
      battle.selectedObject = null;
    }
    loadArt(floorArt(data));
    computeFog();
    computeReach();
    computePreview();
    changed();
  }

  // The room above the grid (TV4): its tallest wall's rise, and a little. In
  // isometric the grid's own corner is PAD, the room above is the diamond's
  // (isoOrigin), at the true 2:1 rise (C2).
  function topOf(d) {
    var rise = iso ? { feet: 1, rise: ISO_RISE } : { feet: 1 };
    RISE_PX = d ? (Loom.mapPaint.riseOf(MP.geometryOf(d), rise) / MP.FEET) * CELL : 0;
    if (iso) return PAD;
    return d ? Math.max(PAD, Math.ceil(RISE_PX + 24)) : PAD;
  }

  // Whether bit `i` is set in squares packed as the server packs them (one bit
  // a square, y × width + x, lowest bit first, in base64; L-632).
  function unpacked(packed) {
    var bytes = window.atob(packed || '');
    return function (i) {
      return Boolean(bytes.charCodeAt(i >> 3) & (1 << (i & 7)));
    };
  }

  // The fog's dark and dim squares, as runs along each row (L-634).
  function computeFog() {
    var d = battle.data;
    battle.fog = null;
    battle.known = null;
    if (!d || !d.fog) return;
    var seen = unpacked(d.fog.seen);
    battle.known = seen;
    var inSight = unpacked(d.fog.inSight);
    var runs = { dark: [], dim: [] };
    for (var y = 0; y < d.height; y++) {
      var level = null;
      var x0 = 0;
      for (var x = 0; x <= d.width; x++) {
        var i = y * d.width + x;
        var here = x === d.width ? null : !seen(i) ? 'dark' : !inSight(i) ? 'dim' : null;
        if (here === level) continue;
        if (level) runs[level].push({ y: y, x0: x0, x1: x - 1 });
        level = here;
        x0 = x;
      }
    }
    battle.fog = runs;
  }

  // Whether a square is in sight (anything not under the fog).
  function inSightNow(cell) {
    return !(
      battle.fog &&
      ['dark', 'dim'].some(function (level) {
        return battle.fog[level].some(function (run) {
          return run.y === cell.y && run.x0 <= cell.x && cell.x <= run.x1;
        });
      })
    );
  }

  // A move sent from here has landed: walk the token along the path it took,
  // up to where it stands now (if that's on the path; else it simply jumps).
  function walkIfMoved() {
    var pending = battle.pending;
    battle.pending = null;
    var d = battle.data;
    if (!pending || !d || pending.mapId !== d.id || reducedMotion()) return;
    var here = hereFeet();
    var i = -1;
    pending.points.forEach(function (p, j) {
      if (Math.abs(p.x - here.x) < 0.05 && Math.abs(p.y - here.y) < 0.05) i = j;
    });
    if (i < 1) return;
    battle.anim = { points: pending.points.slice(0, i + 1), t0: now() };
    if (battle.selected && same(battle.selected, d.here)) battle.selected = null;
    window.requestAnimationFrame(frame);
  }

  // How far along a walk's points, in feet.
  function lengthOf(points) {
    var total = 0;
    for (var i = 1; i < points.length; i++) {
      total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    }
    return total;
  }

  function frame() {
    var anim = battle.anim;
    if (!anim) return;
    if (((now() - anim.t0) / STEP_MS) * MP.FEET >= lengthOf(anim.points)) {
      battle.anim = null;
      changed();
      Loom.map.render();
      return;
    }
    engine.draw(); // only the token moves
    window.requestAnimationFrame(frame);
  }

  // The point `feet` along a walk's points, in feet; its end past that.
  function along(pts, feet) {
    var left = Math.max(0, feet);
    for (var i = 1; i < pts.length; i++) {
      var len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (left <= len && len > 0) {
        var f = left / len;
        return {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * f,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * f,
        };
      }
      left -= len;
    }
    return pts[pts.length - 1];
  }

  // Where the token is drawn: along its walk (5 ft in STEP_MS), or where it stands.
  function tokenCentre() {
    var anim = battle.anim;
    if (!anim) return spot(hereFeet());
    return spot(along(anim.points, ((now() - anim.t0) / STEP_MS) * MP.FEET));
  }

  // Where someone in sight stands, in feet (L-922): their point, else their
  // square's centre.
  function personFeet(person) {
    return person.point || MP.centreOf(person);
  }

  // The squares this turn's AP reaches, as runs along each row.
  function computeReach() {
    var d = battle.data;
    battle.reach = null;
    if (!d || movementLeft() <= 0) return;
    var runs = [];
    MP.reachable(planFor(null), hereFeet(), movementLeft()).forEach(function (cell) {
      var last = runs[runs.length - 1];
      if (last && last.y === cell.y && last.x1 === cell.x - 1) last.x1 = cell.x;
      else runs.push({ y: cell.y, x0: cell.x, x1: cell.x });
    });
    battle.reach = { runs: runs };
  }

  // A move to `cell`, as the server makes it (map-paths.js moveTo, which
  // steps.js planStep runs too): the spot in the square the character fits,
  // the way there, cut short beside someone standing there, and how far `ap`
  // takes it. Null when there's no way; { beside } when they're beside the
  // one standing there already.
  function moveTo(cell, ap, opened) {
    var d = battle.data;
    var meeting = personAt(cell);
    if (meeting && distance(d.here, cell) <= 1) return { beside: meeting };
    var plan = planFor(cell, opened);
    var move = MP.moveTo(plan, hereFeet(), { cell: cell }, ap, {
      occupied: function (sq) {
        return Boolean(personAt(sq));
      },
    });
    return move.none ? null : move;
  }

  // How many turns the rest of a move takes with a full pool, from the next
  // turn: each turn's walk found afresh from where the last stopped, as
  // Continue does (a door opened on the way ends a turn's walk).
  function turnsFor(move) {
    var pool = battle.turn ? (battle.turn.apOff ? Infinity : battle.turn.pool) : 20;
    var opened = {};
    var from = move;
    for (var turns = 1; turns <= 50; turns++) {
      var w = from.walk;
      if (w.opened) opened[w.opened] = 'open';
      var last = w.walked.length ? w.walked[w.walked.length - 1] : from.path.points[0];
      var plan = planFor(MP.squareOf(from.end), opened);
      var path = MP.pathTo(plan, last, from.end);
      if (!path) return Infinity;
      var next = MP.walk(plan, path, pool, { arriveIn: MP.squareOf(from.end) });
      if (!next.walked.length && !next.opened) return Infinity;
      if (next.reached) return turns;
      from = { path: path, walk: next, end: from.end };
    }
    return Infinity;
  }

  // The points a walk goes through: from its start to where it stops.
  function walkedPoints(move) {
    var w = move.walk;
    var pts = move.path.points;
    if (!w.walked.length) return [pts[0]];
    var stop = w.walked[w.walked.length - 1];
    return pts.slice(0, stop.leg + 1).concat([{ x: stop.x, y: stop.y }]);
  }

  // The path a move to the selected cell would take, as the server finds it.
  function computePreview() {
    var d = battle.data;
    var cell = battle.selected;
    battle.preview = null;
    if (!d || !cell || same(cell, d.here)) return;
    if (!known(cell)) {
      battle.preview = { unseen: true }; // (L-635)
      return;
    }
    var move = moveTo(cell, movementLeft());
    if (!move) {
      battle.preview = { none: true };
      return;
    }
    // A way to someone ends just before them (L-642).
    if (move.beside) {
      battle.preview = { beside: move.beside };
      return;
    }
    var w = move.walk;
    var walked = walkedPoints(move);
    var stop = walked[walked.length - 1];
    var leg = w.walked.length ? w.walked[w.walked.length - 1].leg + 1 : 1;
    var rest = w.reached ? [] : [stop].concat(move.path.points.slice(leg));
    battle.preview = {
      path: move.path,
      walked: walked,
      rest: rest,
      stop: stop,
      end: move.end,
      short: !w.reached,
      cost: move.path.ap,
      feet: move.path.feet,
      turns: w.reached ? 1 : (w.walked.length || w.opened ? 1 : 0) + turnsFor(move),
      doors: move.path.doors.map(function (door) {
        return doorName(door.id);
      }),
    };
  }

  function reset() {
    setData(null);
  }

  /**
   * The map's coordinate space on the scene: the grid, with room around it;
   * in isometric, its diamond, with room above for what rises at its north.
   */
  function bounds() {
    var d = battle.data;
    if (!d) return { width: 1, height: 1 };
    if (iso) {
      var span = (d.width + d.height) * CELL;
      return { width: span + 2 * PAD, height: isoOrigin().y + span / 2 + PAD };
    }
    return { width: d.width * CELL + 2 * PAD, height: d.height * CELL + TOP + PAD };
  }

  /** The grid, for framing: a battle map is small enough to show whole. */
  function framePoints() {
    var d = battle.data;
    if (iso) {
      var o = isoOrigin();
      var span = (d.width + d.height) * CELL;
      return [
        { x: PAD, y: o.y - RISE_PX }, // with what rises at its north corner
        { x: PAD + span, y: o.y + span / 2 },
      ];
    }
    return [
      { x: PAD, y: TOP - RISE_PX }, // with the walls standing on its top edge (TV4)
      { x: PAD + d.width * CELL, y: TOP + d.height * CELL },
    ];
  }

  function herePoint() {
    return battle.data ? sceneOf(hereFeet()) : null;
  }

  function selectHere() {
    battle.selected = battle.data ? { x: battle.data.here.x, y: battle.data.here.y } : null;
  }

  // ── Drawing ───────────────────────────────────────

  function build(container) {
    var PIXI = window.PIXI;
    var n = {
      scene: new PIXI.Container(),
      ground: new PIXI.Graphics(),
      art: new PIXI.Sprite(),
      painted: new PIXI.Container(), // the map drawn from its data (L-924; paint.js)
      under: new PIXI.Graphics(), // reach, grid, layers, entries, exits, features
      fogDark: new PIXI.Sprite(),
      mist: new PIXI.Sprite(),
      // The standing layer (L-941): walls, doors, windows and objects standing
      // up, and the tokens, in one order by their feet (paint.js); over the
      // dark so a wall's face can rise over squares not seen, cut to the
      // columns over the squares seen so nothing beyond them shows.
      standing: new PIXI.Container(),
      standMask: new PIXI.Graphics(),
      fogDim: new PIXI.Sprite(),
      labels: new PIXI.Container(),
      over: new PIXI.Graphics(), // the selected square and the way
      you: Loom.draw.token(),
      cards: new PIXI.Container(), // foes' cards while their turns play out (L-828)
      // What lies on the floor, in map coordinates, laid on the scene by the
      // projection (L-951): under what stands, the dimming over it, and the
      // selection and the way over the names.
      floor: new PIXI.Container(),
      floorDim: new PIXI.Container(),
      floorOver: new PIXI.Container(),
      lit: new PIXI.Graphics(), // what a click would pick, lit (L-953)
    };
    n.art.alpha = 0.95;
    n.you.container.__loomPainted = { layer: 'standing', kind: 'token', id: 'you' };
    n.you.container.__loomHit = 'you'; // picked by its picture in isometric (L-953)
    n.floor.addChild(n.ground, n.art, n.painted, n.under, n.fogDark, n.mist);
    n.floorDim.addChild(n.fogDim);
    n.floorOver.addChild(n.over);
    n.scene.addChild(
      n.floor,
      n.standing,
      n.standMask,
      n.floorDim,
      n.lit,
      n.labels,
      n.floorOver,
      n.cards
    );
    container.addChild(n.scene);
    battle.nodes = n;
  }

  // The floor laid on the scene: flat in the three-quarter view, under the
  // isometric transform in the isometric one.
  function project(n) {
    var m = floorMatrix();
    [n.floor, n.floorDim, n.floorOver].forEach(function (layer) {
      layer.setFromMatrix(m);
    });
    // In isometric the dimming lies on the floor, under what stands, which is
    // dimmed by its own squares (standShade); else over all of it.
    var at = iso ? 1 : 3; // just over the floor, or just over what stands and its mask
    if (n.scene.getChildIndex(n.floorDim) !== at) n.scene.setChildIndex(n.floorDim, at);
  }

  // What stands dimmed by the fog in isometric (L-952): a piece out of sight
  // (none of its footprint's middle and corners on a square in sight) as the
  // floor's seen-before squares are; never-seen squares are the mask's.
  function standShade(d) {
    var key = iso && d.fog ? d.id + '|' + d.fog.inSight : null;
    if (battle.shadeKey === key) return;
    battle.shadeKey = key;
    if (!key) {
      Loom.mapPaint.shade('battle:' + d.id, null);
      return;
    }
    var inSight = unpacked(d.fog.inSight);
    var k = Math.round(255 * (1 - FOG_DIM));
    var dim = (k << 16) | (k << 8) | k;
    var lit = function (p) {
      var x = Math.floor(p.x / MP.FEET);
      var y = Math.floor(p.y / MP.FEET);
      return x >= 0 && y >= 0 && x < d.width && y < d.height && inSight(y * d.width + x);
    };
    Loom.mapPaint.shade('battle:' + d.id, function (print) {
      var c = { x: 0, y: 0 };
      print.forEach(function (p) {
        c.x += p.x / print.length;
        c.y += p.y / print.length;
      });
      var near = [c].concat(
        print.map(function (p) {
          return { x: c.x + (p.x - c.x) * 0.9, y: c.y + (p.y - c.y) * 0.9 };
        })
      );
      return near.some(lit) ? 0xffffff : dim;
    });
  }

  // A deterministic grain for the dark (A3): 0–1 from a square.
  function grain(x, y) {
    var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // The dimming of what's been seen, cut to the region in sight now (L-924):
  // drawn finer than the dark, so its edge follows the sight lines (a wall's
  // shadow, a doorway's cone), and softened a little.
  function dimOutside(d, seen, view) {
    var scale = FOG_DIM_SCALE;
    var raw = document.createElement('canvas');
    raw.width = d.width * scale;
    raw.height = d.height * scale;
    var ctx = raw.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,' + FOG_DIM + ')';
    for (var y = 0; y < d.height; y++) {
      for (var x = 0; x < d.width; x++) {
        if (seen(y * d.width + x)) ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    var px = scale / MP.FEET; // canvas pixels a foot
    ctx.globalCompositeOperation = 'destination-out';
    ctx.beginPath();
    ctx.moveTo(view[0] * px, view[1] * px);
    for (var k = 2; k + 1 < view.length; k += 2) ctx.lineTo(view[k] * px, view[k + 1] * px);
    ctx.closePath();
    ctx.fill();
    var soft = document.createElement('canvas');
    soft.width = raw.width;
    soft.height = raw.height;
    var sctx = soft.getContext('2d');
    if ('filter' in sctx) sctx.filter = 'blur(' + FOG_DIM_BLUR + 'px)';
    sctx.drawImage(raw, 0, 0);
    var texture = window.PIXI.Texture.from(soft);
    texture.source.scaleMode = 'linear';
    return texture;
  }

  // A token in the standing layer (L-941), in its place in the order: its
  // foot at `at` (map coordinates), where they stand (L-932: the disc stands
  // upright on its base above it, `radius` its radius on the scene; someone
  // down lies flat on it, `standing` false). Returns where its foot is drawn
  // on the scene, for the token to be placed there.
  function standToken(container, at, radius, standing) {
    var foot = toScene(at);
    var key = battle.data && 'battle:' + battle.data.id;
    var stand = key && Loom.mapPaint.standOf(key);
    if (!stand) return foot;
    if (container.parent !== stand) stand.addChild(container);
    container.__loomFoot = radius;
    container.__loomStanding = standing !== false;
    if (iso) {
      // In isometric (L-952), placed among what stands by its footprint: a
      // square a little inside its disc, and the disc upright over it.
      var u = standUnits(foot);
      var r = radius / standAt().scale;
      var tall = standing !== false ? r * Loom.draw.standHeight() : r;
      Loom.mapPaint.place(key, container, {
        print: Loom.iso.square(feetOf(at), r * 0.8),
        box: { x0: u.x - r, x1: u.x + r, y0: u.y - tall, y1: u.y + r * 0.5 },
        depth: u.y,
        outline: tokenOutline(u, r, standing !== false), // for picking (L-953)
      });
    } else container.zIndex = foot.y;
    if (container.__loomPainted) {
      container.__loomPainted.depth = Math.round(standUnits(foot).y * 100) / 100;
    }
    return foot;
  }

  // A token's drawn shape in the standing layer's units (L-953), for picking
  // it by its picture: standing, its disc on its stem over its base; down,
  // the disc lying squashed on its foot (draw.js token).
  function tokenOutline(u, r, standing) {
    var pts = [];
    var ring = function (cx, cy, rx, ry) {
      for (var i = 0; i < 16; i++) {
        var t = (i / 16) * 2 * Math.PI;
        pts.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
      }
    };
    if (standing) {
      ring(u.x, u.y - (Loom.draw.standHeight() - 1) * r, r, r);
      ring(u.x, u.y, r * 0.62, r * 0.2);
    } else ring(u.x, u.y, r, r * 0.55);
    return Loom.iso.hull(pts);
  }

  // A person's token as it is drawn (L-932): their picture, side, size and
  // state; `turn` rings the one whose turn is playing out.
  function personToken(person, c, radius, turn) {
    return {
      x: c.x,
      y: c.y,
      // As wide as they are (L-922), a medium one's as before.
      radius: radius,
      name: person.name,
      fill:
        person.side === 'hostile'
          ? COLOURS.foe
          : person.side === 'party'
            ? COLOURS.friend
            : person.side === 'wary'
              ? COLOURS.wary
              : COLOURS.person,
      picture: person.token || null,
      standing: true,
      down: Boolean(person.down),
      turn: turn ? COLOURS.turn : null,
      shadow: true, // standing, with its contact shadow (L-943)
      onLoad: pictureLoaded,
    };
  }

  // A token's picture arrived (L-932): drawn on the next frame.
  function pictureLoaded() {
    if (battle.nodes) engine.draw();
  }

  // The standing layer cut to the columns over the squares seen (L-941): a
  // wall's face rises up the screen over the squares beyond it, but nothing
  // standing on a square never seen shows.
  function maskStanding(n, d) {
    var key = d.fog ? d.id + '|' + d.fog.seen + '|' + TOP + '|' + (iso ? RISE_PX : '') : null;
    if (battle.standMaskKey === key) return;
    battle.standMaskKey = key;
    var g = n.standMask;
    g.clear();
    if (!key) {
      n.standing.mask = null;
      g.visible = false;
      return;
    }
    var seen = unpacked(d.fog.seen);
    var rise = RISE_PX + CELL / 2; // the tallest wall's rise, and some
    for (var y = 0; y < d.height; y++) {
      var x = 0;
      while (x < d.width) {
        if (!seen(y * d.width + x)) {
          x += 1;
          continue;
        }
        var x0 = x;
        while (x < d.width && seen(y * d.width + x)) x += 1;
        if (!iso) {
          g.rect(PAD + x0 * CELL, TOP + y * CELL - rise, (x - x0) * CELL, CELL + rise);
          continue;
        }
        // In isometric (L-951) the run's floor is a parallelogram, west corner
        // at its south-west and east at its north-east, swept up by the rise.
        var west = toScene({ x: PAD + x0 * CELL, y: TOP + (y + 1) * CELL });
        var north = toScene({ x: PAD + x0 * CELL, y: TOP + y * CELL });
        var east = toScene({ x: PAD + x * CELL, y: TOP + y * CELL });
        var south = toScene({ x: PAD + x * CELL, y: TOP + (y + 1) * CELL });
        g.poly([
          west.x,
          west.y + 1,
          west.x,
          west.y - rise,
          north.x,
          north.y - rise,
          east.x,
          east.y - rise,
          east.x,
          east.y + 1,
          south.x,
          south.y + 1,
        ]);
      }
    }
    g.fill({ color: 0xffffff });
    g.visible = true;
    n.standing.mask = g;
  }

  // The fog as two textures (A3), a few pixels a square, blurred for soft
  // edges and stretched over the grid smoothly: the dimming of squares seen
  // before, and the dark of squares never seen, with a faint grain.
  function fogTextures(d) {
    var view = Array.isArray(d.fog.view) && d.fog.view.length >= 6 ? d.fog.view : null;
    var key = d.id + '|' + d.fog.seen + '|' + d.fog.inSight + '|' + (view ? view.join(',') : '');
    if (battle.fogTextures.key === key) return battle.fogTextures;
    var seen = unpacked(d.fog.seen);
    var inSight = unpacked(d.fog.inSight);
    var unseen = 0;
    var make = function (alphaOf, rgb) {
      var raw = document.createElement('canvas');
      raw.width = d.width * FOG_SCALE;
      raw.height = d.height * FOG_SCALE;
      var ctx = raw.getContext('2d');
      for (var y = 0; y < d.height; y++) {
        for (var x = 0; x < d.width; x++) {
          var a = alphaOf(y * d.width + x, x, y);
          if (!a) continue;
          ctx.fillStyle = 'rgba(' + (rgb || '0,0,0') + ',' + a + ')';
          ctx.fillRect(x * FOG_SCALE, y * FOG_SCALE, FOG_SCALE, FOG_SCALE);
        }
      }
      var soft = document.createElement('canvas');
      soft.width = raw.width;
      soft.height = raw.height;
      var sctx = soft.getContext('2d');
      if ('filter' in sctx) sctx.filter = 'blur(' + FOG_BLUR + 'px)';
      sctx.drawImage(raw, 0, 0);
      var texture = window.PIXI.Texture.from(soft);
      texture.source.scaleMode = 'linear';
      return texture;
    };
    ['dim', 'dark', 'mist'].forEach(function (kind) {
      if (battle.fogTextures[kind]) battle.fogTextures[kind].destroy(true);
    });
    // The mist (K3): blotches two squares across over unseen ground, one
    // layer the ambient touches drift and thin and thicken.
    var mist = make(function (i, x, y) {
      return seen(i) ? 0 : MIST * grain(Math.floor(x / 2), Math.floor((y + 1) / 2));
    }, MIST_RGB);
    battle.fogTextures = {
      key: key,
      // Dimmed: seen before; in sight now, the region seen, to its exact
      // edge (L-924, from the server's sight outline), else by the square.
      dim: view
        ? dimOutside(d, seen, view)
        : make(function (i) {
            return seen(i) && !inSight(i) ? FOG_DIM : 0;
          }),
      dark: make(function (i, x, y) {
        if (seen(i)) return 0;
        unseen += 1;
        return 0.9 + 0.1 * grain(x, y);
      }),
      mist: mist,
    };
    battle.fogTextures.unseen = unseen;
    return battle.fogTextures;
  }

  // The world's own accent, for the painter's tint (RD4): set on the page
  // only when the world has one (theme.js useAccent).
  function accent() {
    var v = document.documentElement.style.getPropertyValue('--loom-accent').trim();
    var m = /^#([0-9a-f]{6})$/i.exec(v);
    return m ? parseInt(m[1], 16) : null;
  }

  // The map as the painter draws it (L-924): its geometry as far as seen,
  // each door in this save's state (as the server sends it). Under a floor
  // painting (L-955) its floors aren't drawn (`floorArt`); everything that
  // stands is, from the data.
  function paintMap(n, d) {
    var merged = MP.geometryOf(d);
    var geometry = {};
    Object.keys(merged).forEach(function (k) {
      geometry[k] = merged[k];
    });
    var root = Loom.mapPaint.paint(n.painted, 'battle:' + d.id, geometry, {
      tile: MP.FEET,
      wall: 1.5,
      feet: 1,
      fades: true, // walls over a token fade (L-942), so they're cut along their length
      stand: n.standing,
      standAt: standAt(),
      // In isometric (L-952), what stands is built on the isometric screen.
      iso: iso ? { rise: ISO_RISE } : null,
      low: iso && wallsLow(), // the walls-low button (L-953)
      floorArt: Boolean(floorArt(d)), // a floor painting lies under what stands (L-955)
      tint: accent(),
      worldKinds: d.objectKinds || null,
      set: d.artSet || null, // the world's art set (L-944)
      materials: d.materials || null, // the world's own ground (L-713)
      onProgress: engine.progress,
      onChange: function () {
        engine.draw();
      },
    });
    root.position.set(PAD, TOP);
    root.scale.set(CELL / MP.FEET);
  }

  function rebuild(view) {
    var n = battle.nodes;
    var d = battle.data;
    var px = 1 / view.scale; // a screen pixel, in map units
    var cellPx = CELL * view.scale;
    var gw = d.width * CELL;
    var gh = d.height * CELL;
    project(n);

    n.ground.clear();
    n.ground
      .rect(PAD, TOP, gw, gh)
      .fill({ color: COLOURS.ground })
      .stroke({ width: px, color: COLOURS.groundEdge, alpha: 0.25 });

    // The map drawn from its data (L-924), when what's sent of it changes.
    if (battle.paintedFor !== d) {
      battle.paintedFor = d;
      battle.shadeKey = undefined;
      paintMap(n, d);
    }
    standShade(d);
    maskStanding(n, d);

    // The art is stretched to the grid, as Claude sees it in view_image.
    var art = floorArt(d) && battle.art && battle.art.ready(d.image);
    n.art.visible = Boolean(art);
    if (art) {
      n.art.texture = battle.art.texture;
      n.art.position.set(PAD, TOP);
      n.art.width = gw;
      n.art.height = gh;
      battle.art.sharpen(Loom.draw.devicePx(Math.max(gw, gh) * view.scale));
    }

    var fog = d.fog ? fogTextures(d) : null;
    var misty = Boolean(fog && fog.unseen) && !reducedMotion(); // only while it drifts
    [
      [n.fogDim, fog && fog.dim],
      [n.fogDark, fog && fog.dark],
      [n.mist, misty && fog.mist],
    ].forEach(function (pair) {
      pair[0].visible = Boolean(pair[1]);
      if (!pair[1]) return;
      pair[0].texture = pair[1];
      pair[0].position.set(PAD, TOP);
      pair[0].width = gw;
      pair[0].height = gh;
    });

    var g = n.under;
    g.clear();
    var square = function (cell) {
      return { x: PAD + cell.x * CELL, y: TOP + cell.y * CELL };
    };

    // This turn's reach (L-615).
    if (battle.reach && !battle.anim) {
      battle.reach.runs.forEach(function (run) {
        var a = square({ x: run.x0, y: run.y });
        g.rect(a.x, a.y, (run.x1 - run.x0 + 1) * CELL, CELL);
      });
      g.fill({ color: COLOURS.reach, alpha: 0.12 });
    }

    // Areas (#670), under everything else: a faint tint over the squares
    // seen of each, its edge where it meets squares outside it. Never a
    // target: a click on a square in one is a click on that square.
    (d.areas || []).forEach(function (area) {
      var on = {};
      area.squares.forEach(function (sq) {
        on[sq.x + ',' + sq.y] = true;
      });
      area.squares.forEach(function (sq) {
        var a = square(sq);
        g.rect(a.x, a.y, CELL, CELL);
      });
      g.fill({ color: COLOURS.area, alpha: 0.08 });
      area.squares.forEach(function (sq) {
        var a = square(sq);
        if (!on[sq.x + ',' + (sq.y - 1)]) g.moveTo(a.x, a.y).lineTo(a.x + CELL, a.y);
        if (!on[sq.x + ',' + (sq.y + 1)]) g.moveTo(a.x, a.y + CELL).lineTo(a.x + CELL, a.y + CELL);
        if (!on[sq.x - 1 + ',' + sq.y]) g.moveTo(a.x, a.y).lineTo(a.x, a.y + CELL);
        if (!on[sq.x + 1 + ',' + sq.y]) g.moveTo(a.x + CELL, a.y).lineTo(a.x + CELL, a.y + CELL);
      });
      g.stroke({ width: 1.5 * px, color: COLOURS.area, alpha: 0.45 });
    });

    // The grid, when its squares are big enough to see; in isometric, faint
    // 5 ft diamonds only while a move or an aim is being chosen (IN2).
    battle.gridShown = cellPx >= 6 && (!iso || choosing());
    if (battle.gridShown) {
      [false, true].forEach(function (major) {
        for (var gx = 0; gx <= d.width; gx++) {
          if ((gx % 5 === 0) !== major) continue;
          g.moveTo(PAD + gx * CELL, TOP).lineTo(PAD + gx * CELL, TOP + gh);
        }
        for (var gy = 0; gy <= d.height; gy++) {
          if ((gy % 5 === 0) !== major) continue;
          g.moveTo(PAD, TOP + gy * CELL).lineTo(PAD + gw, TOP + gy * CELL);
        }
        g.stroke({ width: px, color: COLOURS.grid, alpha: major ? 0.3 : 0.12 });
      });
    }

    // The map itself, ground, walls, doors, windows, objects and light, is
    // the painter's (L-924; paint.js), under all this. A door selected
    // (L-627) is marked over it.
    var wallWidth = Math.max(3, cellPx / 7) * px;
    doorsOf(d).forEach(function (door) {
      if (battle.selectedDoor !== door.id) return;
      var ends = endsOf(door);
      var a = square({ x: ends[0].x / MP.FEET, y: ends[0].y / MP.FEET });
      var b = square({ x: ends[1].x / MP.FEET, y: ends[1].y / MP.FEET });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
      g.stroke({ width: wallWidth + 8 * px, color: COLOURS.selected, alpha: 0.45 });
    });

    // An object selected (L-926) is outlined the same way.
    var chosen = battle.selectedObject && objectItem(battle.selectedObject);
    if (chosen) {
      var box = hitBox(chosen);
      var corner = spot({ x: box.x0, y: box.y0 });
      var far = spot({ x: box.x1, y: box.y1 });
      g.rect(corner.x, corner.y, far.x - corner.x, far.y - corner.y);
      g.stroke({ width: wallWidth * 0.6, color: COLOURS.selected, alpha: 0.7 });
    }

    // Hazards in sight (L-815; EF9): their squares tinted, their edge drawn
    // where it meets squares outside them.
    (d.hazards || []).forEach(function (hazard) {
      var on = {};
      hazard.squares.forEach(function (sq) {
        on[sq.x + ',' + sq.y] = true;
      });
      hazard.squares.forEach(function (sq) {
        var a = square(sq);
        g.rect(a.x, a.y, CELL, CELL);
      });
      g.fill({ color: COLOURS.hazard, alpha: 0.28 });
      hazard.squares.forEach(function (sq) {
        var a = square(sq);
        if (!on[sq.x + ',' + (sq.y - 1)]) g.moveTo(a.x, a.y).lineTo(a.x + CELL, a.y);
        if (!on[sq.x + ',' + (sq.y + 1)]) g.moveTo(a.x, a.y + CELL).lineTo(a.x + CELL, a.y + CELL);
        if (!on[sq.x - 1 + ',' + sq.y]) g.moveTo(a.x, a.y).lineTo(a.x, a.y + CELL);
        if (!on[sq.x + 1 + ',' + sq.y]) g.moveTo(a.x + CELL, a.y).lineTo(a.x + CELL, a.y + CELL);
      });
      g.stroke({ width: 2 * px, color: COLOURS.hazard, alpha: 0.9 });
    });

    // Entries, exits and features: what stands on a square seen before but
    // out of sight now is faded.
    var faded = function (cell) {
      return inSightNow(cell) ? 1 : 0.55;
    };
    var box = function (cell) {
      var a = square(cell);
      var inset = Math.min(1 * px, CELL / 8);
      return [
        a.x + inset,
        a.y + inset,
        CELL - 2 * inset,
        CELL - 2 * inset,
        Math.min(4 * px, CELL / 6),
      ];
    };
    d.entries.forEach(function (e) {
      var r = box(e);
      g.roundRect(r[0], r[1], r[2], r[3], r[4])
        .fill({ color: COLOURS.entry, alpha: 0.25 * faded(e) })
        .stroke({ width: px, color: COLOURS.entry, alpha: 0.7 * faded(e) });
    });
    d.exits.forEach(function (e) {
      var r = box(e);
      g.roundRect(r[0], r[1], r[2], r[3], r[4])
        .fill({ color: COLOURS.exit, alpha: 0.55 * faded(e) })
        .stroke({ width: 1.5 * px, color: COLOURS.exit, alpha: faded(e) });
    });
    d.features.forEach(function (f) {
      var c = centre(f);
      g.circle(c.x, c.y, Math.max(3 * px, CELL * 0.28))
        .fill({ color: COLOURS.feature, alpha: faded(f) })
        .stroke({ width: 1.5 * px, color: COLOURS.dark, alpha: faded(f) });
    });

    // People in sight (L-642), as tokens (A6).
    var people = {};
    (d.people || []).forEach(function (person) {
      if (person.x === undefined) return;
      var token = battle.tokens[person.id || person.name];
      if (!token) {
        token = Loom.draw.token();
        battle.tokens[person.id || person.name] = token;
        token.container.__loomPainted = {
          layer: 'standing',
          kind: 'token',
          id: person.id || person.name,
        };
        // Picked by its picture in isometric (L-953).
        token.container.__loomHit = 'person:' + (person.id || person.name);
      }
      people[person.id || person.name] = true;
      var c = spot(personFeet(person));
      token.container.visible = true;
      token.container.scale.set(px);
      // Their side shows in a fight's colours (L-828): foes red, friends
      // green; their picture in the frame (L-932); someone down lies flat,
      // greyed and crossed.
      token.container.alpha = 1;
      var radius = Math.max(5, cellPx * Math.max(0.32, (person.width || 0) / MP.FEET / 2));
      var foot = standToken(token.container, c, radius * px, !person.down);
      token.person = person;
      token.radius = radius;
      token.update(personToken(person, foot, radius, false));
    });
    Object.keys(battle.tokens).forEach(function (id) {
      if (!people[id]) battle.tokens[id].container.visible = false;
    });

    // Names, drawn over the fog so one by a square at its edge still reads,
    // upright on the scene: under the square (in isometric, its diamond's
    // lowest corner).
    n.labels.removeChildren();
    var label = function (cell, text, colour) {
      var node = Loom.draw.label(text, 11.5);
      var c = toScene(cell.point ? spot(cell.point) : centre(cell));
      node.style.fill = colour || COLOURS.label;
      node.alpha = faded(cell);
      node.scale.set(px);
      node.position.set(c.x, c.y + CELL / 2 + 3 * px);
      n.labels.addChild(node);
    };
    battle.labels.forEach(function (node) {
      node.destroy();
    });
    // An area's name in its middle square seen (#670), in italics, set
    // apart from the names of things.
    (d.areas || []).forEach(function (area) {
      if (!area.label) return;
      var node = Loom.draw.label(area.name, 12);
      var c = toScene(centre(area.label));
      node.style.fill = COLOURS.area;
      node.style.fontStyle = 'italic';
      node.anchor.set(0.5, 0.5);
      node.alpha = 0.9 * faded(area.label);
      node.scale.set(px);
      node.position.set(c.x, c.y);
      n.labels.addChild(node);
    });
    d.exits.forEach(function (e) {
      label(e, e.name, COLOURS.exitLabel);
    });
    d.features.forEach(function (f) {
      label(f, f.name);
    });
    // A hazard's name under its middle square in sight (L-815).
    (d.hazards || []).forEach(function (hazard) {
      var mid = hazard.squares[Math.floor(hazard.squares.length / 2)];
      if (mid) label(mid, hazard.name, COLOURS.hazard);
    });
    // (While everyone else's turns play out, names would stand where the
    // tokens end, L-828: they come back when it's over.)
    (d.people || []).forEach(function (person) {
      if (person.x !== undefined && !battle.playback) label(person, person.name);
    });
    battle.labels = n.labels.children.slice();

    // The selected square, and the way: its path (this turn solid, the rest
    // dashed), or else the plan kept from an earlier move (L-615).
    var o = n.over;
    o.clear();
    if (battle.selected) {
      var r = box(battle.selected);
      o.roundRect(r[0], r[1], r[2], r[3], r[4]).stroke({ width: 2 * px, color: COLOURS.selected });
    }
    // Someone selected (L-828; UI2): your attacks' reach and range around
    // you (long range dashed), and their cover from where you stand. In feet
    // (L-922): a ring where their middle must be for the attack to reach
    // them, edge to edge.
    var target = battle.selected && personAt(battle.selected);
    var combat = combatOf();
    if (target && combat && !target.down) {
      var me = spot(hereFeet());
      var edges = (((d.size && d.size.width) || 2.5) + (target.width || 2.5)) / 2;
      var around = function (squares) {
        var r = ((squares * MP.FEET + edges) / MP.FEET) * CELL;
        var ring = [];
        for (var i = 0; i <= 72; i++) {
          var t = (i / 72) * 2 * Math.PI;
          ring.push({ x: me.x + r * Math.cos(t), y: me.y + r * Math.sin(t) });
        }
        return ring;
      };
      combat.attacks.forEach(function (a) {
        if (a.range) {
          Loom.draw.polyline(o, around(a.range.normal));
          o.stroke({ width: 2 * px, color: COLOURS.range, alpha: 0.8 });
          Loom.draw.polyline(o, around(a.range.long), [4 * px, 6 * px]);
          o.stroke({ width: 1.5 * px, color: COLOURS.range, alpha: 0.6 });
        } else {
          Loom.draw.polyline(o, around(a.reach || 1));
          o.stroke({ width: 2 * px, color: COLOURS.range, alpha: 0.9 });
        }
      });
      if (target.cover) {
        var tb = box(target);
        o.roundRect(tb[0], tb[1], tb[2], tb[3], tb[4]).stroke({
          width: 3 * px,
          color: COLOURS.cover,
        });
        var coverLabel = Loom.draw.label(target.cover + ' cover', 11);
        coverLabel.style.fill = COLOURS.cover;
        coverLabel.scale.set(px);
        var tc = toScene(centre(target));
        coverLabel.position.set(tc.x, tc.y - CELL / 2 - 16 * px);
        n.labels.addChild(coverLabel);
        battle.labels.push(coverLabel);
      }
    }
    var preview = battle.preview;
    var plan = battle.turn && battle.turn.plan;
    if (!battle.anim && preview && preview.path) {
      if (preview.walked.length > 1) {
        Loom.draw.polyline(o, preview.walked.map(spot));
        o.stroke({ width: 3 * px, color: COLOURS.path, cap: 'round', join: 'round' });
      }
      if (preview.rest.length > 1) {
        Loom.draw.polyline(o, preview.rest.map(spot), [2 * px, 7 * px]);
        o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.85, cap: 'round' });
      }
      // Its cost at the end, and where the AP left runs out (L-837; UI1).
      if (battle.turn && !battle.turn.apOff) {
        pathLabel(n, px, MP.squareOf(preview.end), preview.cost + ' AP');
        if (preview.short) {
          var from = MP.squareOf(preview.stop);
          var stop = spot(preview.stop);
          o.circle(stop.x, stop.y, CELL * 0.22).stroke({ width: 2.5 * px, color: COLOURS.path });
          o.moveTo(stop.x - CELL * 0.16, stop.y - CELL * 0.16)
            .lineTo(stop.x + CELL * 0.16, stop.y + CELL * 0.16)
            .stroke({ width: 2.5 * px, color: COLOURS.path });
          if (preview.walked.length > 1) pathLabel(n, px, from, 'AP runs out', true);
        }
      }
    } else if (!battle.anim && !battle.selected && plan) {
      Loom.draw.polyline(o, [spot(hereFeet())].concat(plan.path.map(centre)), [2 * px, 7 * px]);
      o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.5, cap: 'round' });
    }
  }

  // Whether a move or an aim is being chosen (IN2): a square or someone other
  // than your own selected, its path or your attacks' reach shown.
  function choosing() {
    return Boolean(battle.selected) && !same(battle.selected, battle.data.here);
  }

  // A label over a square of the path preview (L-837): its cost; or, under
  // it (`below`), where the AP runs out.
  function pathLabel(n, px, cell, text, below) {
    var node = Loom.draw.label(text, 11);
    node.style.fill = COLOURS.path;
    node.scale.set(px);
    var c = toScene(centre(cell));
    node.position.set(c.x, below ? c.y + CELL / 2 + 2 * px : c.y - CELL / 2 - 14 * px);
    n.labels.addChild(node);
    battle.labels.push(node);
  }

  /** Draws the map for the camera's view: rebuilt when needed, else just moved. */
  function draw(container, view) {
    if (!battle.data) return;
    if (!battle.nodes) build(container);
    var n = battle.nodes;
    var key = [
      battle.version,
      view.scale,
      battle.selected ? battle.selected.x + ',' + battle.selected.y : '',
      battle.selectedDoor || '',
      battle.selectedObject || '',
      battle.anim ? 1 : 0,
      battle.playback ? 1 : 0, // names follow their tokens again once it's over
      reducedMotion() ? 'still' : '', // the mist shows only while it may drift
    ].join('|');
    if (key !== battle.built) {
      rebuild(view);
      battle.built = key;
    }
    n.scene.position.set(view.x, view.y);
    n.scene.scale.set(view.scale);
    // Only what's on the screen is drawn (L-943; EN5): the rest stays built.
    var shown = engine.size();
    if (iso) cullFloor(view, shown);
    else Loom.mapPaint.cull('battle:' + battle.data.id, shown.width, shown.height);
    if (battle.playback) drawPlayback(view);

    // You: along your walk, or where you stand.
    var cellPx = CELL * view.scale;
    var save = Loom.store.get().save;
    n.you.container.scale.set(1 / view.scale);
    var me = standToken(n.you.container, tokenCentre(), Math.max(5, cellPx * 0.3) / view.scale);
    n.you.update({
      x: me.x,
      y: me.y,
      radius: Math.max(5, cellPx * 0.3),
      name: save && save.characterName,
      fill: COLOURS.you,
      ring: COLOURS.ring,
      picture: (battle.data && battle.data.you && battle.data.you.token) || null,
      standing: true, // upright on its base (L-932)
      shadow: true, // standing, with its contact shadow (L-943)
      onLoad: pictureLoaded,
    });
    drawLit(view);
    fadeBehind();
  }

  // ── What a click picks (IN1; L-953) ───────────────

  // Whether a pick in isometric is something a click there opens: a door
  // seen, a usable object, someone in sight, or you.
  function pickable(hit) {
    if (hit === 'you') return true;
    if (hit.indexOf('door:') === 0) return Boolean(doorById(hit.slice(5)));
    if (hit.indexOf('person:') === 0) return Boolean(personById(hit.slice(7)));
    return Boolean(usable(hit) && objectItem(hit));
  }

  function personById(id) {
    return (
      (battle.data.people || []).filter(function (p) {
        return (p.id || p.name) === id && p.x !== undefined;
      })[0] || null
    );
  }

  /**
   * What a click at a point on the scene picks: in isometric, the front-most
   * thing drawn there (a door's leaf or the wall over it, a usable object's
   * picture, someone's token); in the three-quarter view, a standing
   * object's picture; else a door or an object on the floor point under it,
   * else the square (null off the grid). { m (the floor point, map
   * coordinates), hit?, door?, object?, person?, you?, cell }.
   */
  function pickAt(raw) {
    var d = battle.data;
    var m = toGrid(raw); // on the floor (L-951)
    var out = { m: m, hit: null, cell: null };
    if (iso) {
      var p = standUnits(raw);
      var got = Loom.mapPaint.pick('battle:' + d.id, p.x, p.y, pickable);
      if (got) {
        var h = got.hit;
        out.hit = h;
        if (h === 'you') out.you = true;
        else if (h.indexOf('door:') === 0) out.door = doorById(h.slice(5));
        else if (h.indexOf('person:') === 0) out.person = personById(h.slice(7));
        else out.object = { o: usable(h), item: objectItem(h), d2: 0 };
        out.cell = out.person
          ? { x: out.person.x, y: out.person.y }
          : out.you
            ? { x: d.here.x, y: d.here.y }
            : null;
        return out;
      }
    } else {
      var standing = standingObjectAt(raw); // it rises over what's behind it (L-941)
      if (standing) {
        out.object = standing;
        out.hit = standing.o.id;
        return out;
      }
    }
    var door = doorAt(m);
    if (door) {
      out.door = door;
      out.hit = 'door:' + door.id;
      return out;
    }
    var hit = objectAt(m);
    if (hit) {
      out.object = hit;
      out.hit = hit.o.id;
      return out;
    }
    var cell = { x: Math.floor((m.x - PAD) / CELL), y: Math.floor((m.y - TOP) / CELL) };
    if (cell.x >= 0 && cell.y >= 0 && cell.x < d.width && cell.y < d.height) out.cell = cell;
    return out;
  }

  // What the hover lights (L-953): the pick's outline, or the square's diamond.
  function lightUp(lit) {
    var was = battle.lit;
    var same1 =
      (!was && !lit) ||
      (was &&
        lit &&
        was.hit === lit.hit &&
        (was.cell && lit.cell ? same(was.cell, lit.cell) : was.cell === lit.cell));
    if (same1) return;
    battle.lit = lit;
    engine.draw();
  }

  // The lit outline drawn on the scene, in the standing layer's units (only
  // in isometric): what a click picks, strong; the square, faint.
  function drawLit(view) {
    var n = battle.nodes;
    var lit = iso ? battle.lit : null;
    var at = standAt();
    var key = 'battle:' + battle.data.id;
    var poly = null;
    if (lit && lit.hit) poly = Loom.mapPaint.outlineOfHit(key, lit.hit);
    else if (lit && lit.cell) {
      var F = MP.FEET;
      poly = [
        { x: lit.cell.x * F, y: lit.cell.y * F },
        { x: (lit.cell.x + 1) * F, y: lit.cell.y * F },
        { x: (lit.cell.x + 1) * F, y: (lit.cell.y + 1) * F },
        { x: lit.cell.x * F, y: (lit.cell.y + 1) * F },
      ].map(function (p) {
        return Loom.iso.P(p, 0);
      });
    }
    var sig = poly
      ? [view.scale, at.x, at.y, at.scale]
          .concat(
            poly.map(function (p) {
              return Math.round(p.x * 100) + ',' + Math.round(p.y * 100);
            })
          )
          .join('|') + (lit.hit ? '|hit' : '')
      : '';
    if (sig === battle.litKey) return;
    battle.litKey = sig;
    var g = n.lit;
    g.clear();
    if (!poly) return;
    g.position.set(at.x, at.y);
    g.scale.set(at.scale);
    var px = 1 / (view.scale * at.scale); // a screen pixel, in its units
    var flat = [];
    poly.forEach(function (p) {
      flat.push(p.x, p.y);
    });
    g.poly(flat)
      .fill({ color: LIT, alpha: lit.hit ? 0.12 : 0.08 })
      .stroke({
        width: (lit.hit ? 2 : 1.5) * px,
        color: LIT,
        alpha: lit.hit ? 0.95 : 0.55,
        join: 'round',
      });
  }

  // In isometric (L-951), what lies on the floor culled to the floor the
  // screen shows: the screen's corners worked back to the floor, in feet;
  // and what stands culled to the screen in the standing layer's units (L-952).
  function cullFloor(view, shown) {
    var screen = [
      [0, 0],
      [shown.width, 0],
      [0, shown.height],
      [shown.width, shown.height],
    ].map(function (c) {
      return M.toMap(view, c[0], c[1]);
    });
    var boxOf = function (ps) {
      var xs = ps.map(function (p) {
        return p.x;
      });
      var ys = ps.map(function (p) {
        return p.y;
      });
      return {
        x0: Math.min.apply(null, xs),
        y0: Math.min.apply(null, ys),
        x1: Math.max.apply(null, xs),
        y1: Math.max.apply(null, ys),
      };
    };
    Loom.mapPaint.view(
      'battle:' + battle.data.id,
      boxOf(
        screen.map(function (p) {
          return feetOf(toGrid(p));
        })
      ),
      boxOf(screen.map(standUnits))
    );
  }

  // ── Seeing behind walls (TV1; L-942) ──────────────

  var FADE_STEP_FT = 2.5; // the path's points checked this far apart
  var FADE_EVERY_MS = 80; // the pointer's check, at most this often

  // What is to be seen behind walls, for the painter's `fade`: the tokens'
  // discs (their foot's y the depth), the pointer's point and the points of
  // the path preview, each a floor point (its y the depth), all in the
  // standing layer's units (in isometric, as the floor is drawn there). In
  // isometric (L-953) each has its footprint on the floor too, in feet, so
  // what fades is judged as the order is, by footprint; the pointer's never
  // fades what it would pick.
  function fadeTargets() {
    var key = 'battle:' + battle.data.id;
    var stand = Loom.mapPaint.standOf(key);
    var out = [];
    var spot1 = function (feet, except) {
      var p = standUnits(sceneOf(feet));
      var t = { box: { x0: p.x, y0: p.y, x1: p.x, y1: p.y }, depth: p.y };
      if (iso) t.print = Loom.iso.square(feet, 0.25);
      if (except) t.except = except;
      out.push(t);
    };
    if (stand) {
      stand.children.forEach(function (child) {
        if (child.__loomFoot === undefined || !child.visible) return;
        var placed = iso && child.__loomPlace;
        if (placed) {
          out.push({ box: placed.box, depth: placed.depth, print: placed.print });
          return;
        }
        var c = standUnits(child.position);
        var r = child.__loomFoot / standAt().scale;
        // A standing disc (L-932) rises from its foot; one lying down covers its spot.
        out.push(
          child.__loomStanding
            ? {
                box: { x0: c.x - r, y0: c.y - r * Loom.draw.standHeight(), x1: c.x + r, y1: c.y },
                depth: c.y,
              }
            : { box: { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r }, depth: c.y }
        );
      });
    }
    if (battle.cursor) spot1(battle.cursor, battle.cursorPick);
    var preview = battle.preview;
    if (!battle.anim && preview && preview.path) {
      [preview.walked, preview.rest].forEach(function (line) {
        (line || []).forEach(function (p, i) {
          spot1(p);
          var q = line[i + 1];
          if (!q) return;
          var n = Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / FADE_STEP_FT);
          for (var k = 1; k < n; k++) {
            spot1({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
          }
        });
      });
    }
    return out;
  }

  // The walls, doors and tall objects over any of them fade (the painter
  // keeps the same targets as nothing to do); called as they move: every
  // draw, and the pointer's, throttled.
  function fadeBehind() {
    if (!battle.data || !battle.nodes) return;
    battle.fadeAt = now();
    Loom.mapPaint.fade('battle:' + battle.data.id, fadeTargets());
  }

  function fadeSoon() {
    var wait = FADE_EVERY_MS - (now() - battle.fadeAt);
    if (wait <= 0) {
      fadeBehind();
      return;
    }
    if (battle.fadeTimer) return;
    battle.fadeTimer = window.setTimeout(function () {
      battle.fadeTimer = 0;
      fadeBehind();
    }, wait);
  }

  // ── Clicks: the menu (I2) ─────────────────────────

  // ── Objects you can use (L-926) ───────────────────

  // The row the server sent for an object there is something to do with:
  // { id, name, state?, description?, contents?, actions }.
  function usable(id) {
    return (
      ((battle.data && battle.data.objects) || []).filter(function (o) {
        return o.id === id;
      })[0] || null
    );
  }

  // Its place in the map's geometry (where, how big, its art): an item of it.
  function objectItem(id) {
    return (
      (((battle.data && battle.data.geometry) || {}).objects || []).filter(function (i) {
        return i.id === id;
      })[0] || null
    );
  }

  // The box round an object's footprint, in feet.
  function feetBox(item) {
    var c = Loom.mapGeometry.compile({ objects: [item] });
    var ring = c.objects.length ? c.objects[0].rings[0] : null;
    var at = Array.isArray(item.at) ? item.at : [item.at.x, item.at.y];
    var xs = ring
      ? ring.map(function (p) {
          return p[0];
        })
      : [at[0], at[0]];
    var ys = ring
      ? ring.map(function (p) {
          return p[1];
        })
      : [at[1], at[1]];
    return {
      x0: Math.min.apply(null, xs),
      y0: Math.min.apply(null, ys),
      x1: Math.max.apply(null, xs),
      y1: Math.max.apply(null, ys),
    };
  }

  // What a click on it hits and the selection outlines: its footprint, at
  // least a square, so a lever can be clicked.
  function hitBox(item) {
    var b = feetBox(item);
    var cx = (b.x0 + b.x1) / 2;
    var cy = (b.y0 + b.y1) / 2;
    var hw = Math.max((b.x1 - b.x0) / 2, MP.FEET / 2);
    var hh = Math.max((b.y1 - b.y0) / 2, MP.FEET / 2);
    return { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
  }

  // The grid squares it covers, as the server reads them (objects.js squaresOf).
  function objectSquares(item) {
    var b = feetBox(item);
    var F = MP.FEET;
    var x0 = Math.max(0, Math.floor(b.x0 / F + 1e-9));
    var y0 = Math.max(0, Math.floor(b.y0 / F + 1e-9));
    var x1 = Math.min(battle.data.width - 1, Math.max(x0, Math.floor(b.x1 / F - 1e-9)));
    var y1 = Math.min(battle.data.height - 1, Math.max(y0, Math.floor(b.y1 / F - 1e-9)));
    var out = [];
    for (var y = y0; y <= y1; y++) for (var x = x0; x <= x1; x++) out.push({ x: x, y: y });
    return out;
  }

  // Whether the player stands beside it: beside any square it covers.
  function besideObject(item) {
    return objectSquares(item).some(function (sq) {
      return distance(sq, battle.data.here) <= 1;
    });
  }

  // The object there is something to do with under a point (map
  // coordinates), the nearest to its middle if two overlap, or null.
  function objectAt(m) {
    var p = feetOf(m);
    var best = null;
    ((battle.data && battle.data.objects) || []).forEach(function (o) {
      var item = objectItem(o.id);
      if (!item) return;
      var b = hitBox(item);
      if (p.x < b.x0 || p.x > b.x1 || p.y < b.y0 || p.y > b.y1) return;
      var dx = p.x - (b.x0 + b.x1) / 2;
      var dy = p.y - (b.y0 + b.y1) / 2;
      var d2 = dx * dx + dy * dy;
      if (!best || d2 < best.d2) best = { o: o, item: item, d2: d2 };
    });
    return best;
  }

  // The object there is something to do with whose standing picture is under
  // a point on the scene (L-941; paint.js standingAt), the front-most, or null.
  function standingObjectAt(s) {
    if (!battle.data) return null;
    var p = standUnits(s);
    var id = Loom.mapPaint.standingAt('battle:' + battle.data.id, p.x, p.y);
    if (!id) return null;
    var o = ((battle.data && battle.data.objects) || []).filter(function (x) {
      return x.id === id;
    })[0];
    var item = o && objectItem(o.id);
    return item ? { o: o, item: item, d2: 0 } : null;
  }

  var OBJECT_STATES = { locked: 'Locked.', closed: 'Closed.', open: 'Open.' };

  // Its card, across the top of its menu: its picture, what it looks like,
  // and what is known of it (its state; what it holds once opened).
  function objectCard(o, item) {
    var lines = [];
    if (o.state) {
      lines.push(
        o.state === 'open' && item.container && item.container.search
          ? 'Searched.'
          : OBJECT_STATES[o.state] || capitalise(o.state) + '.'
      );
    }
    if (o.contents) lines.push('It holds ' + o.contents + '.');
    return {
      art: Loom.mapPaint.cardUrl(item, battle.data.objectKinds || null, battle.data.artSet || null),
      text: o.description || '',
      lines: lines,
    };
  }

  // Its actions: each at its AP cost, greyed out with the reason when out of
  // reach, already acted, or the AP left won't pay (L-837); a long one (a
  // lock picked over turns) is put in as AP allow.
  function objectItems(o, item) {
    var beside = besideObject(item);
    return o.actions.map(function (a) {
      var why = !beside
        ? 'Walk beside it to ' + a.name.toLowerCase() + '.'
        : acted()
          ? "You've acted this turn."
          : a.long
            ? null
            : short(a.cost);
      return {
        label: a.name,
        disabled: Boolean(why),
        note:
          why ||
          (a.long
            ? noted(undefined, a.long + ' AP of work, over turns')
            : noted(a.cost, battle.turn && battle.turn.apOff ? 'your action' : '')),
        onSelect: function () {
          Loom.play.objectAction(o.id, a.id, a.name.toLowerCase() + ' ' + o.name);
        },
      };
    });
  }

  // The door under a point (within a fifth of a square of its line), or null.
  function doorAt(m) {
    var p = feetOf(m);
    return (
      doorsOf(battle.data).filter(function (dr) {
        var ends = endsOf(dr);
        var a = ends[0];
        var b = ends[1];
        var vx = b.x - a.x;
        var vy = b.y - a.y;
        var len2 = vx * vx + vy * vy || 1;
        var t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
        var dx = p.x - (a.x + t * vx);
        var dy = p.y - (a.y + t * vy);
        return Math.sqrt(dx * dx + dy * dy) <= DOOR_HIT * MP.FEET;
      })[0] || null
    );
  }

  function doorStateWord(door) {
    return door.state === 'open' ? 'open' : door.state === 'locked' ? 'locked' : 'closed';
  }

  // A door's menu (L-627): Open, Close or Try it from beside it.
  function doorItems(door) {
    var name = door.name || 'the door';
    var open = door.state !== 'open';
    var text =
      door.state === 'open'
        ? 'Close ' + name
        : door.state === 'locked'
          ? 'Try ' + name + ' (locked)'
          : 'Open ' + name;
    var beside = besideDoor(door);
    // Its cost (L-837): the door's own or the system's; a lock's to try one.
    var prices = (battle.turn && battle.turn.prices) || null;
    var cost =
      !prices || (battle.turn && battle.turn.apOff)
        ? undefined
        : door.state === 'locked'
          ? actionCost('lock')
          : typeof (prices.doors || {})[door.id] === 'number'
            ? prices.doors[door.id]
            : prices.door;
    var why = !beside ? 'Walk beside it to open or close it.' : short(cost);
    return [
      {
        label: capitalise(text),
        disabled: Boolean(why),
        note: why || noted(cost, battle.turn && battle.turn.apOff ? 'free' : ''),
        onSelect: function () {
          Loom.play.doorAction(door.id, open, (open ? 'open ' : 'close ') + name);
        },
      },
    ];
  }

  function whereTo(exit) {
    return exit.to === 'out'
      ? 'out of ' + (battle.data.host ? battle.data.host.name : 'here')
      : 'to ' + exit.to.name;
  }

  // What a square is: its title and facts, for the menu and the card; the
  // area it's in, if any (#670), after its square.
  function describe(cell) {
    var there = at(cell);
    var person = personAt(cell);
    var area = areaAt(cell);
    var coords = '(' + cell.x + ', ' + cell.y + ')' + (area ? ' · in ' + area.name : '');
    if (person) {
      return {
        title: person.name,
        facts: (there.feature ? 'At ' + there.feature.name + ' · ' : '') + coords,
        go: 'Go to ' + person.name,
      };
    }
    if (there.exit) {
      return {
        title: capitalise(there.exit.name),
        facts: 'Way out, ' + whereTo(there.exit) + ' · ' + coords,
        go: 'Go out by ' + there.exit.name,
      };
    }
    if (there.feature) {
      return {
        title: capitalise(there.feature.name),
        facts: 'Feature · ' + coords,
        go: 'Go to ' + there.feature.name,
      };
    }
    return {
      title: 'Square (' + cell.x + ', ' + cell.y + ')',
      facts: area ? 'In ' + area.name : '',
      go: 'Move here',
      coords: '(' + cell.x + ', ' + cell.y + ')',
    };
  }

  // Why a move to the selected square can't be made, or null.
  function refusal(cell) {
    var preview = battle.preview;
    if (same(cell, battle.data.here)) return 'You are here.';
    if (preview && preview.unseen) return "You haven't seen that.";
    if (preview && preview.beside) return "You're beside " + preview.beside.name + '.';
    if (!preview || preview.none) return "There's no way there from here.";
    return null;
  }

  // Move to the selected square: a step, or as far as this turn goes with
  // the rest kept as the plan (L-613), remembered so the token can walk it.
  function moveItem(cell) {
    var about = describe(cell);
    var no = refusal(cell);
    if (no) return { label: about.go, disabled: true, note: no };
    var preview = battle.preview;
    var d = battle.data;
    var label = about.coords ? 'move to ' + about.coords : about.go.toLowerCase();
    return {
      label: about.go,
      note: costLine(preview),
      onSelect: function () {
        battle.pending = { mapId: d.id, points: preview.walked };
        Loom.play.moveToCell(cell, label);
      },
    };
  }

  function busy(items) {
    if (!state.turnInProgress) return items;
    return items.map(function (item) {
      return item.disabled
        ? item
        : Object.assign({}, item, { disabled: true, note: 'A turn is under way.' });
    });
  }

  /** A click on the map (I2): a door or a square, and a menu for it. */
  function tap(point, view) {
    if (!battle.data) return;
    if (battle.anim) {
      battle.anim = null; // a click skips the walk ahead
      changed();
      Loom.map.render();
      return;
    }
    // What's under it (L-953): in isometric, the front-most thing drawn there;
    // a phone's tap picks the same way.
    var got = pickAt(M.toMap(view, point.x, point.y));
    var door = got.door;
    if (door) {
      battle.selectedDoor = door.id;
      battle.selectedObject = null;
      battle.selected = null;
      battle.preview = null;
      Loom.map.render();
      engine.openMenu(point, {
        title: capitalise(door.name || 'the door'),
        subtitle: 'Door · ' + doorStateWord(door),
        items: busy(doorItems(door).concat([lookItem({ door: door.id, name: door.name })])),
      });
      return;
    }
    battle.selectedDoor = null;
    // An object there is something to do with (L-926): its menu, with its card.
    var hit = got.object;
    if (hit) {
      battle.selectedObject = hit.o.id;
      battle.selected = null;
      battle.preview = null;
      Loom.map.render();
      engine.openMenu(point, {
        title: capitalise(hit.o.name),
        subtitle: 'Object' + (hit.o.state ? ' · ' + hit.o.state : ''),
        card: objectCard(hit.o, hit.item),
        items: busy(
          objectItems(hit.o, hit.item).concat([lookItem({ object: hit.o.id, name: hit.o.name })])
        ),
      });
      return;
    }
    battle.selectedObject = null;
    // Someone's token, or the square: the square's menu (on someone, theirs).
    var cell = got.cell;
    var inside = Boolean(cell);
    battle.selected = inside ? cell : null;
    computePreview();
    Loom.map.render();
    if (!inside) return;
    var about = describe(cell);
    engine.openMenu(point, {
      title: about.title,
      subtitle: about.facts || undefined,
      items: busy(itemsFor(cell).concat([lookItem({ cell: cell })])),
    });
  }

  // ── Fighting (L-828; combat UI2, TN5) ─────────────

  function combatOf() {
    var m = Loom.store.get().map;
    return (m && m.combat) || null;
  }

  function fightOf() {
    var m = Loom.store.get().map;
    return (m && m.fight) || null;
  }

  function distance(a, b) {
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }

  // How far an attack reaches someone from here: 'reach', 'normal' or
  // 'long' (range), or null, as the server reads it: in feet, edge to edge
  // (map-paths.js bandOf; L-922).
  function bandOf(attack, person) {
    var d = battle.data;
    var me = { point: hereFeet(), width: d.size && d.size.width };
    return MP.bandOf(attack, me, { point: personFeet(person), width: person.width });
  }

  var BAND_WORDS = { reach: 'in reach', normal: 'in range', long: 'long range' };

  // What a square offers: on yours, Stand up when lying down and, in a
  // fight, Dodge, Withdraw and Ready; on someone, Move and Attack with each of your attacks
  // (someone wary, Talk first: L-392); on a feature beside you, Use; else Move.
  function itemsFor(cell) {
    var d = battle.data;
    if (same(cell, d.here)) return selfItems();
    var person = personAt(cell);
    if (person) {
      return [moveItem(cell)]
        .concat(person.side === 'wary' && !person.down ? [talkItem(person)] : [])
        .concat(attackItems(person));
    }
    var feature = at(cell).feature;
    return [moveItem(cell)].concat(feature ? useItems(feature) : []);
  }

  // Turns run on AP (L-832): each menu entry shows its cost, greyed out
  // with the reason when the AP left won't pay for it (L-837). With AP off
  // (L-838), the turn's one action.
  function acted() {
    return Boolean(battle.turn && battle.turn.apOff && battle.turn.acted);
  }

  /** Talk (L-392): answering someone wary before it comes to blows, walked to as any suggestion. */
  function talkItem(person) {
    return {
      label: 'Talk to ' + person.name,
      note: 'wary of you',
      onSelect: function () {
        Loom.play.suggest({ text: 'talk to ' + person.name, verb: 'talk', target: person.id });
      },
    };
  }

  /**
   * Attack (UI2): each of your attacks at them, with whether it reaches
   * (in reach, range, long range), their cover from here, and the roll; out
   * of reach or range it can't be chosen. Not offered at someone down, or on
   * your side.
   */
  function attackItems(person) {
    var combat = combatOf();
    if (!combat || person.down || person.side === 'party') return [];
    var subdue = Boolean(Loom.store.get().ui.subdue);
    return combat.attacks.map(function (a) {
      var band = bandOf(a, person);
      var why = acted()
        ? "You've acted this turn."
        : band
          ? short(a.ap)
          : a.range
            ? 'Out of range (' + a.range.long * MP.FEET + ' ft).'
            : 'Out of reach: get closer.';
      var note = [
        apText(a.ap),
        band ? BAND_WORDS[band] : null,
        person.cover ? person.cover + ' cover' : null,
        a.attack,
        subdue && a.lethal ? 'to subdue' : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return {
        label: 'Attack with ' + a.name.toLowerCase(),
        disabled: Boolean(why),
        note: why || note,
        onSelect: function () {
          Loom.play.attack(
            person.id,
            a.id,
            'attack ' + person.name + ' with ' + a.name.toLowerCase()
          );
        },
      };
    });
  }

  // Your own square: in a fight, Dodge, Withdraw and Ready (Dash went with
  // action points, L-832: moving further is spending AP on squares).
  function selfItems() {
    var combat = combatOf();
    var fight = fightOf();
    var item = function (label, note, verb, extra, said, cost) {
      // Its cost (L-837), greyed out with the reason when it can't be paid.
      var why = acted() ? "You've acted this turn." : short(cost);
      return {
        label: label,
        disabled: Boolean(why),
        note: why || noted(cost, note),
        onSelect: function () {
          Loom.play.tactic(verb, extra, said);
        },
      };
    };
    var items = [];
    // Prone or the like (L-834): standing up, for its cost.
    var character = (Loom.store.get().map || {}).character;
    var lying = ((character && character.conditions) || []).some(function (c) {
      return /standing up/.test(c.ap || '');
    });
    if (lying) {
      items.push(
        item('Stand up', 'ends lying down', 'stand', null, 'stand up', actionCost('standUp'))
      );
    }
    // Search what is in sight for what is hidden (L-927): a secret door, a trap.
    items.push(
      item(
        'Search',
        'for what is hidden in sight',
        'search',
        null,
        'search the area',
        actionCost('search')
      )
    );
    if (!fight) return items;
    items.push(
      item(
        'Dodge',
        'harder to hit until your next turn',
        'dodge',
        null,
        'dodge',
        actionCost('dodge')
      ),
      item(
        'Withdraw',
        'move away without drawing blows',
        'withdraw',
        null,
        'withdraw',
        actionCost('withdraw')
      )
    );
    ((combat && combat.attacks) || []).forEach(function (a) {
      items.push(
        item(
          'Ready ' + a.name.toLowerCase(),
          'set aside: strikes the first foe to come into its ' + (a.range ? 'range' : 'reach'),
          'ready',
          { attack: a.id },
          'ready ' + a.name.toLowerCase(),
          a.ap
        )
      );
    });
    return items;
  }

  // Use a feature beside you (TN5): the GM says what it does.
  function useItems(feature) {
    var beside = distance(battle.data.here, feature) <= 1;
    var prices = battle.turn && !battle.turn.apOff && battle.turn.prices;
    var own = prices && prices.features ? prices.features[feature.id] : undefined;
    var cost = !prices ? undefined : own !== undefined ? own : actionCost('object');
    // A long action (CT4) is put in over turns: what this turn pays is what's left.
    var long = feature.long && feature.long.ap;
    var why = !beside
      ? 'Walk beside it to use it.'
      : acted()
        ? "You've acted this turn."
        : long
          ? null
          : short(cost);
    return [
      {
        label: 'Use ' + feature.name,
        disabled: Boolean(why),
        note:
          why ||
          (long
            ? noted(undefined, long + ' AP of work, over turns')
            : noted(cost, battle.turn && battle.turn.apOff ? 'your action' : '')),
        onSelect: function () {
          Loom.play.tactic('use', { feature: feature.id }, 'use ' + feature.name);
        },
      },
    ];
  }

  // ── Everyone else's turns, played out (L-828; UI3) ─

  /**
   * Plays out everyone else's turns on the map: one after another, each
   * fighter's token walks its path, then its card shows over it. Starts from
   * where the tokens stand now (before the map reloads). Faster, or reduced
   * motion, skips it.
   */
  function playOut(turns, faster) {
    var d = battle.data;
    if (!d || faster || reducedMotion()) return;
    // Where each stands, in feet (L-922).
    var where = {};
    (d.people || []).forEach(function (p) {
      if (p.x !== undefined) where[p.id] = personFeet(p);
    });
    var steps = [];
    var t = 0;
    turns.forEach(function (turn) {
      var from = where[turn.id];
      // The walk's points in feet; from before, its squares' centres.
      var path = turn.points || (turn.path || []).map(MP.centreOf);
      if (!from && path.length) from = path[0];
      if (!from) return;
      var pts = [from].concat(path);
      var walk = (lengthOf(pts) / MP.FEET) * STEP_MS;
      var card = turn.attack && turn.attack.card ? cardText(turn) : null;
      steps.push({ id: turn.id, pts: pts, t0: t, walk: walk, card: card });
      t += walk + (card ? CARD_MS : 0);
      where[turn.id] = pts[pts.length - 1];
    });
    if (!steps.length) return;
    battle.playback = { steps: steps, t0: now(), end: t, last: where };
    window.requestAnimationFrame(playFrame);
  }

  // A foe's card over its token: the roll against what it needed, and the hit.
  function cardText(turn) {
    var a = turn.attack;
    var c = a.card;
    return (
      c.total +
      (c.difficulty !== null && c.difficulty !== undefined ? ' vs ' + c.difficulty : '') +
      (a.hit ? ' · hit' + (a.damage ? ' ' + a.damage : '') : ' · miss')
    );
  }

  function playFrame() {
    var pb = battle.playback;
    if (!pb) return;
    if (now() - pb.t0 >= pb.end) {
      battle.playback = null;
      clearCards();
      changed();
      Loom.map.render();
      return;
    }
    engine.draw();
    window.requestAnimationFrame(playFrame);
  }

  // Where each token is now along the playback, and the card showing.
  function drawPlayback(view) {
    var pb = battle.playback;
    var n = battle.nodes;
    var t = now() - pb.t0;
    clearCards();
    var at = {};
    pb.steps.forEach(function (st) {
      if (t < st.t0) {
        if (!at[st.id]) at[st.id] = spot(st.pts[0]);
        return;
      }
      var u = Math.min(1, (t - st.t0) / Math.max(1, st.walk));
      at[st.id] = spot(along(st.pts, lengthOf(st.pts) * u));
      if (st.card && t >= st.t0 + st.walk && t < st.t0 + st.walk + CARD_MS) {
        var node = Loom.draw.label(st.card, 12);
        node.style.fill = COLOURS.card;
        node.scale.set(1 / view.scale);
        // Over its disc, standing on its base (L-932).
        var held = battle.tokens[st.id];
        var r = held && held.container.__loomFoot ? held.container.__loomFoot : CELL * 0.32;
        var over = toScene(at[st.id]); // upright on the scene (L-951)
        node.position.set(over.x, over.y - r * Loom.draw.standHeight() - CELL * 0.3);
        n.cards.addChild(node);
      }
    });
    // The one whose turn is playing is ringed (L-932).
    var playing = null;
    pb.steps.forEach(function (st) {
      if (t >= st.t0 && t < st.t0 + st.walk + (st.card ? CARD_MS : 0)) playing = st.id;
    });
    Object.keys(at).forEach(function (id) {
      var token = battle.tokens[id];
      if (!token) return;
      token.container.visible = true;
      var foot = standToken(
        token.container,
        at[id],
        token.container.__loomFoot || 0,
        token.container.__loomStanding
      );
      if (token.person) {
        token.update(personToken(token.person, foot, token.radius, id === playing));
      } else token.container.position.set(foot.x, foot.y);
    });
  }

  function clearCards() {
    var n = battle.nodes;
    if (!n || !n.cards) return;
    n.cards.children.slice().forEach(function (node) {
      node.destroy();
    });
    n.cards.removeChildren();
  }

  // What's here? (#672): the GM describes the square or door, from what the
  // player knows of it; free. A square never seen has nothing to tell.
  function lookItem(target) {
    var cell = target.cell;
    var unseen = cell && battle.known && !battle.known(cell.y * battle.data.width + cell.x);
    if (unseen) {
      return { label: "What's here?", disabled: true, note: "You haven't seen that spot." };
    }
    var label = cell
      ? "what's here at (" + cell.x + ', ' + cell.y + ')'
      : 'look at ' + (target.name || (target.object ? 'it' : 'the door'));
    return {
      label: "What's here?",
      note: 'Free',
      onSelect: function () {
        Loom.play.lookAt(
          cell
            ? { cell: { x: cell.x, y: cell.y } }
            : target.object
              ? { object: target.object }
              : { door: target.door },
          label
        );
      },
    };
  }

  /** A hover over the grid shows it can be clicked. */
  function hover(point, view) {
    if (!point || !battle.data) {
      engine.panelCursor('');
      if (battle.cursor) {
        battle.cursor = null;
        battle.cursorPick = null;
        fadeSoon();
      }
      if (battle.data) lightUp(null);
      return;
    }
    var got = pickAt(M.toMap(view, point.x, point.y));
    battle.cursor = feetOf(got.m);
    // What it would pick never fades for it (L-953): the wall in front does.
    battle.cursorPick = iso ? got.hit : null;
    fadeSoon();
    engine.panelCursor(got.hit || got.cell ? 'pointer' : '');
    // What a click would pick, lit (L-953).
    if (iso) lightUp(got.hit ? { hit: got.hit } : got.cell ? { cell: got.cell } : null);
  }

  // ── The card ──────────────────────────────────────

  /** The card: what was clicked, or where you are (the turn is on the overlay, L-725). */
  function renderInfo(info) {
    info.innerHTML = '';
    renderCard(info);
  }

  function renderCard(info) {
    var d = battle.data;
    var door = battle.selectedDoor && doorById(battle.selectedDoor);
    if (door) {
      info.appendChild(el('h3', 'loom-map-info-name', capitalise(door.name || 'the door')));
      info.appendChild(el('p', 'loom-map-info-facts', 'Door · ' + doorStateWord(door)));
      if (!besideDoor(door)) {
        info.appendChild(el('p', 'loom-map-info-status', 'Walk beside it to open or close it.'));
      }
      return;
    }
    var object = battle.selectedObject && usable(battle.selectedObject);
    if (object) {
      info.appendChild(el('h3', 'loom-map-info-name', capitalise(object.name)));
      info.appendChild(
        el('p', 'loom-map-info-facts', 'Object' + (object.state ? ' · ' + object.state : ''))
      );
      var item = objectItem(object.id);
      if (item && !besideObject(item)) {
        info.appendChild(el('p', 'loom-map-info-status', 'Walk beside it to use it.'));
      }
      return;
    }
    var cell = battle.selected;
    if (!cell) {
      var here = at(d.here);
      var where =
        "You're at (" +
        d.here.x +
        ', ' +
        d.here.y +
        ')' +
        (here.feature ? ', at ' + here.feature.name : '') +
        (areaAt(d.here) ? ', in ' + areaAt(d.here).name : '') +
        (d.host ? (areaAt(d.here) ? ' of ' : ' in ') + d.host.name : '') +
        '. ';
      var ways = d.exits.length
        ? ' Ways out: ' +
          listOf(
            d.exits.map(function (e) {
              return e.name;
            })
          ) +
          '.'
        : '';
      info.appendChild(
        el('p', 'loom-map-hint', where + 'Click a square for what you can do.' + ways)
      );
      if (d.people.length) {
        info.appendChild(
          el(
            'p',
            'loom-map-info-facts',
            'Here: ' +
              listOf(
                d.people.map(function (p) {
                  return p.name;
                })
              ).replace(/ or /, ' and ') +
              '.'
          )
        );
      }
      return;
    }
    var about = describe(cell);
    info.appendChild(el('h3', 'loom-map-info-name', about.title));
    if (about.facts) info.appendChild(el('p', 'loom-map-info-facts', about.facts));
    var no = refusal(cell);
    info.appendChild(
      no
        ? el('p', 'loom-map-info-status', no)
        : el('p', 'loom-map-info-facts', costLine(battle.preview))
    );
  }

  // What a move costs, and when it gets there: "8 movement · this turn".
  function costLine(preview) {
    var when;
    if (!preview.short) when = 'this turn';
    else if (preview.turns === Infinity) when = 'too far to walk';
    else if (preview.walked.length <= 1) {
      when = preview.turns === 1 ? 'next turn' : preview.turns + ' turns, from next turn';
    } else when = preview.turns + ' turns';
    return (
      (battle.turn && battle.turn.apOff ? Math.round(preview.feet) + ' ft' : preview.cost + ' AP') +
      ' · ' +
      when +
      (preview.doors.length ? ' · opens ' + listOf(preview.doors).replace(/ or /, ' and ') : '')
    );
  }

  /** Continue (L-613): walks the kept plan, the token walking it as it lands. */
  function continuePlan() {
    var turn = battle.turn;
    if (battle.data && turn && turn.plan && turn.plan.to) {
      // Where the plan heads, walked as far as this turn goes, for the token.
      var move = moveTo(turn.plan.to, movementLeft());
      if (move && move.path) battle.pending = { mapId: battle.data.id, points: walkedPoints(move) };
    }
    Loom.play.continuePlan();
  }

  /**
   * The minimap's view of the map, on the scene: the grid (in isometric, its
   * diamond: `rect` round it, `shape` its corners), the people in sight and you.
   */
  function minimap() {
    var d = battle.data;
    var points = (d.people || [])
      .filter(function (p) {
        return p.x !== undefined;
      })
      .map(function (p) {
        var c = toScene(centre(p));
        return { x: c.x, y: c.y, colour: '#4db6ac', r: 2.5 };
      });
    var me = sceneOf(hereFeet());
    points.push({ x: me.x, y: me.y, colour: '#ffffff', r: 3.5, ring: '#ffb74d' });
    var rect = { x: PAD, y: TOP, width: d.width * CELL, height: d.height * CELL, fill: '#1a1f2c' };
    if (iso) {
      var corners = [
        { x: PAD, y: TOP },
        { x: PAD + d.width * CELL, y: TOP },
        { x: PAD + d.width * CELL, y: TOP + d.height * CELL },
        { x: PAD, y: TOP + d.height * CELL },
      ].map(toScene);
      var span = (d.width + d.height) * CELL;
      rect = { x: PAD, y: isoOrigin().y, width: span, height: span / 2, fill: rect.fill };
      rect.shape = corners;
    }
    return { rect: rect, points: points };
  }

  // Switches the isometric view on or off (L-951; `?view=iso` sets it at
  // first): the map is drawn again in it, and the drawer frames it afresh.
  function setIso(on) {
    on = Boolean(on);
    if (on === iso) return;
    iso = on;
    TOP = topOf(battle.data);
    battle.lit = null;
    battle.cursorPick = null;
    battle.paintedFor = null;
    battle.standMaskKey = null;
    changed();
  }

  // ── Walls low (IS4; L-953) ────────────────────────

  // The player's own choice on this device.
  function wallsKey() {
    return WALLS_LOW_KEY + ((state && state.uid) || 'anyone');
  }

  /** Whether every wall is drawn as a low stub (the walls-low button; L-953). */
  function wallsLow() {
    if (battle.wallsLow === null) {
      try {
        battle.wallsLow = window.localStorage.getItem(wallsKey()) === '1';
      } catch {
        battle.wallsLow = false;
      }
    }
    return battle.wallsLow;
  }

  /** Drops every wall to a stub, or raises them again; remembered on the device. */
  function setWallsLow(on) {
    on = Boolean(on);
    if (on === wallsLow()) return;
    battle.wallsLow = on;
    try {
      window.localStorage.setItem(wallsKey(), on ? '1' : '0');
    } catch {
      // Storage off (a private window): it holds for this visit only.
    }
    battle.paintedFor = null;
    changed();
    engine.draw();
  }

  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // The ambient touches (K3; L-727): the mist over unseen ground drifts to
  // and fro, thinning and thickening as it goes.
  function ambient(container, t) {
    var n = battle.nodes;
    if (!n || !battle.data || !n.mist.visible) return false;
    var phase = (t * 2 * Math.PI) / MIST_PERIOD;
    n.mist.alpha = 0.55 + 0.45 * Math.sin(phase);
    n.mist.position.set(
      PAD + Math.sin(phase / 2) * CELL * 0.35,
      TOP + Math.cos(phase / 3) * CELL * 0.2
    );
    return true;
  }

  engine.addLayer('battle', {
    ambient: ambient,
    draw: draw,
  });

  Loom.battle = {
    setData: setData,
    reset: reset,
    bounds: bounds,
    framePoints: framePoints,
    herePoint: herePoint,
    /**
     * A point in feet (L-922) on the scene the camera sees: where to click
     * it (in isometric, its point on the isometric screen; L-951).
     */
    mapPoint: sceneOf,
    /** A point on the scene back on the floor, in feet (L-951), for tests. */
    floorPoint: function (s) {
      return feetOf(toGrid(s));
    },
    setIso: setIso,
    wallsLow: wallsLow,
    setWallsLow: setWallsLow,
    /**
     * What a click at a screen point would pick (L-953), for tests: { door },
     * { object }, { person } (an id, or 'you') or { cell }; null off the map.
     */
    picks: function (point) {
      var view = engine.camera && engine.camera.view;
      if (!battle.data || !view) return null;
      var got = pickAt(M.toMap(view, point.x, point.y));
      if (got.door) return { door: got.door.id };
      if (got.object) return { object: got.object.o.id };
      if (got.person) return { person: got.person.id || got.person.name };
      if (got.you) return { person: 'you' };
      return got.cell ? { cell: got.cell } : null;
    },
    /** What the hover lights now (L-953), for tests: { hit } or { cell }, or null. */
    lit: function () {
      return battle.lit;
    },
    /** Whether grid maps are drawn in the isometric view (L-951). */
    iso: function () {
      return iso;
    },
    /**
     * What's drawn upright on the scene, for tests (L-951): your token's
     * foot, the names and foes' cards ({ text, x, y }), whether the grid
     * (in isometric, the 5 ft diamonds) shows, whether the hover's
     * outline is drawn (L-953) and the floor painting's place (L-955).
     */
    drawn: function () {
      var n = battle.nodes;
      if (!n) return null;
      var text = function (node) {
        return { text: node.text, x: node.position.x, y: node.position.y };
      };
      return {
        you: { x: n.you.container.position.x, y: n.you.container.position.y },
        labels: n.labels.children.map(text),
        cards: n.cards.children.map(text),
        grid: Boolean(battle.gridShown),
        lit: Boolean(battle.litKey), // the hover's outline drawn (L-953)
        // The grid's floor painting (L-955), where it lies on the floor in
        // feet, or null when none is drawn.
        art: n.art.visible
          ? {
              x0: ((n.art.position.x - PAD) * MP.FEET) / CELL,
              y0: ((n.art.position.y - TOP) * MP.FEET) / CELL,
              x1: ((n.art.position.x + n.art.width - PAD) * MP.FEET) / CELL,
              y1: ((n.art.position.y + n.art.height - TOP) * MP.FEET) / CELL,
            }
          : null,
      };
    },
    selectHere: function () {
      selectHere();
      battle.selectedDoor = null;
      battle.selectedObject = null;
      computePreview();
    },
    tap: tap,
    hover: hover,
    continuePlan: continuePlan,
    playOut: playOut,
    /** Whether everyone else's turns are playing out on the map now (L-828). */
    playing: function () {
      return Boolean(battle.playback);
    },
    minimap: minimap,
    renderInfo: renderInfo,
    current: function () {
      return battle.data;
    },
    /**
     * The tokens drawn (L-932), for tests: each person's id, whether their
     * picture shows, whether they stand, their radius in map coordinates
     * and where their foot is.
     */
    tokens: function () {
      return Object.keys(battle.tokens)
        .filter(function (id) {
          return battle.tokens[id].container.visible;
        })
        .map(function (id) {
          var t = battle.tokens[id];
          return {
            id: id,
            pictured: t.pictured,
            standing: Boolean(t.container.__loomStanding),
            radius: t.container.__loomFoot,
            x: t.container.position.x,
            y: t.container.position.y,
          };
        });
    },
  };
})();
