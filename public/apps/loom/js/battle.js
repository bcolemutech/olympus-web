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
  //   the path a move would take (grid-paths.js, the server's own rules),
  //   solid for this turn and dashed after, and a kept plan is dashed. After
  //   a move the token walks its path (K3; a click skips ahead, reduced
  //   motion jumps). Reach and paths cover only squares seen (L-635).
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
  var P = Loom.gridPaths;
  var L = Loom.mapLayers;
  var engine = Loom.engine;
  var CELL = 40;
  var PAD = 60; // room for the labels of squares at the edge
  var STEP_MS = 110; // the token's walk, a square at a time
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
    wall: 0xe9e4d8,
    solid: 0x080a10,
    solidEdge: 0x3a4050,
    low: 0xcdaa7d,
    difficult: 0x9aa0a6,
    dot: 0xbebebe,
    door: 0xffb74d,
    doorLocked: 0xe57373,
    reach: 0xffb74d,
    path: 0xffb74d,
    selected: 0xffffff,
    person: 0x4db6ac,
    foe: 0xe57373, // someone hostile (L-828)
    friend: 0x81c784, // someone on your side (L-828)
    you: 0xffffff,
    ring: 0xffb74d,
    label: 0xe0e0e0,
    hazard: 0xce93d8, // a hazard's squares (L-815)
    range: 0xef9a9a, // an attack's reach or range (L-828)
    cover: 0x90caf9, // a target's cover (L-828)
    card: 0xfff3e0, // a foe's card over its token while its turn plays out
    area: 0x9fa8da, // an area's tint, edge and name (#670)
  };
  var CARD_MS = 1100; // how long a foe's card shows over its token (L-828)
  var FOG_DIM = 0.6; // seen before, out of sight now
  var FOG_SCALE = 4; // fog texture pixels a square, before it is stretched
  var FOG_BLUR = 3; // px of that texture: the feathered edge, about ¾ of a square
  var MIST = 0.16; // the drifting mist over unseen ground, at its thickest (K3)
  var MIST_RGB = '84,98,128';
  var MIST_PERIOD = 9; // s for the mist to thin and thicken

  var battle = {
    data: null, // loomGetMap's `battleMap`
    turn: null, // loomGetMap's `turn` (L-611): movement left, the plan
    selected: null, // a cell { x, y }
    selectedDoor: null, // a door's id, when a door is clicked (L-627)
    art: null, // its image (Loom.draw.art): the copy, then the full image (L-727)
    reach: null, // this turn's reach: { runs: [{ y, x0, x1 }] }
    fog: null, // the fog (L-634): { dark: runs, dim: runs }, as reach's runs
    known: null, // whether a square (by y × width + x) has been seen (L-635)
    preview: null, // the path to the selected cell: { path, walked, rest, cost, turns } or { none }
    pending: null, // a move sent: { mapId, from, path }, for the walk when it lands
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
    return { x: PAD + (cell.x + 0.5) * CELL, y: PAD + (cell.y + 0.5) * CELL };
  }

  // The server's own path rules (layers.js; L-624): around walls, locked
  // doors and obstacles, each step at this character's price in action
  // points (L-832: the turn's `prices`, a square 1 and difficult ground 2
  // by default), a closed door's cost to open it (where a walk stops), and
  // exits stepped onto, never through. Doors are as this save has them, and
  // only ground it knows is walked (L-635): what it has seen, as the server
  // does.
  function pathOptions() {
    var states = {};
    (battle.data.doors || []).forEach(function (door) {
      states[door.id] = door.state;
    });
    var prices = (battle.turn && battle.turn.prices) || null;
    var rules = L.pathOptions(
      battle.data,
      states,
      prices && {
        move: prices.move,
        difficult: prices.difficult,
        door: function (door) {
          var own = prices.doors && prices.doors[door.id];
          return typeof own === 'number' ? own : prices.door;
        },
      }
    );
    if (!battle.known) return rules;
    return {
      avoid: rules.avoid,
      opens: rules.opens,
      openCost: rules.openCost,
      cost: function (from, to) {
        return known(to) ? rules.cost(from, to) : Infinity;
      },
    };
  }

  // Whether the save has seen a square (L-635): everything, without a fog.
  function known(cell) {
    return !battle.known || battle.known(cell.y * battle.data.width + cell.x);
  }

  function doorById(id) {
    return (
      (battle.data.doors || []).filter(function (d) {
        return d.id === id;
      })[0] || null
    );
  }

  // The two squares a door stands between (as the server's steps.js has it).
  function doorSides(door) {
    if (door.from.x === door.to.x) {
      var y = Math.min(door.from.y, door.to.y);
      return [
        { x: door.from.x - 1, y: y },
        { x: door.from.x, y: y },
      ];
    }
    var x = Math.min(door.from.x, door.to.x);
    return [
      { x: x, y: door.from.y - 1 },
      { x: x, y: door.from.y },
    ];
  }

  function besideDoor(door) {
    return doorSides(door).some(function (side) {
      return same(side, battle.data.here);
    });
  }

  function doorName(id) {
    var door = (battle.data.doors || []).filter(function (d) {
      return d.id === id;
    })[0];
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
    if (moved) {
      battle.selected = null;
      battle.anim = null;
    }
    walkIfMoved();
    if (battle.selectedDoor && (!battle.data || !doorById(battle.selectedDoor))) {
      battle.selectedDoor = null;
    }
    loadArt(data && data.image);
    computeFog();
    computeReach();
    computePreview();
    changed();
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
    var i = -1;
    pending.path.forEach(function (step, j) {
      if (same(step, d.here)) i = j;
    });
    if (i < 0) return;
    battle.anim = { cells: [pending.from].concat(pending.path.slice(0, i + 1)), t0: now() };
    if (battle.selected && same(battle.selected, d.here)) battle.selected = null;
    window.requestAnimationFrame(frame);
  }

  function frame() {
    var anim = battle.anim;
    if (!anim) return;
    if ((now() - anim.t0) / STEP_MS >= anim.cells.length - 1) {
      battle.anim = null;
      changed();
      Loom.map.render();
      return;
    }
    engine.draw(); // only the token moves
    window.requestAnimationFrame(frame);
  }

  // Where the token is drawn: along its walk, or where it stands.
  function tokenCentre() {
    var anim = battle.anim;
    if (!anim) return centre(battle.data.here);
    var t = Math.max(0, (now() - anim.t0) / STEP_MS);
    var i = Math.min(Math.floor(t), anim.cells.length - 2);
    var f = Math.min(1, t - i);
    var a = centre(anim.cells[i]);
    var b = centre(anim.cells[i + 1]);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  }

  // The squares this turn's movement reaches, as runs along each row.
  function computeReach() {
    var d = battle.data;
    battle.reach = null;
    if (!d || movementLeft() <= 0) return;
    var runs = [];
    P.reach(d, d.here, movementLeft(), pathOptions())
      .sort(function (a, b) {
        return a.y - b.y || a.x - b.x;
      })
      .forEach(function (cell) {
        var last = runs[runs.length - 1];
        if (last && last.y === cell.y && last.x1 === cell.x - 1) last.x1 = cell.x;
        else runs.push({ y: cell.y, x0: cell.x, x1: cell.x });
      });
    battle.reach = { runs: runs };
  }

  // How many turns walking `path` takes with a full pool, from the next turn
  // (a door opened on the way ends a turn's walk).
  function turnsFor(path) {
    var speed = battle.turn ? (battle.turn.apOff ? Infinity : battle.turn.pool) : 20;
    var openCost = pathOptions().openCost;
    var turns = 0;
    while (path.length) {
      var w = P.walk(path, speed, { openCost: openCost });
      if (!w.walked.length && !w.opened) return Infinity;
      path = w.rest;
      turns += 1;
    }
    return turns;
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
    var found = P.pathTo(d, d.here, cell, pathOptions());
    if (!found) {
      battle.preview = { none: true };
      return;
    }
    // A way to someone ends on the last free square before them (L-642).
    var path = found.path;
    var meeting = personAt(cell);
    if (meeting) {
      while (path.length && personAt(path[path.length - 1])) path = path.slice(0, -1);
      if (!path.length) {
        battle.preview = { beside: meeting };
        return;
      }
    }
    var w = P.walk(path, movementLeft(), {
      stand: function (step) {
        return !personAt(step);
      },
      openCost: pathOptions().openCost,
    });
    var doors = path
      .filter(function (step) {
        return step.opens;
      })
      .map(function (step) {
        return doorName(step.opens);
      });
    battle.preview = {
      path: path,
      walked: w.walked,
      rest: w.rest,
      cost: path[path.length - 1].cost,
      turns: (w.walked.length || w.opened ? 1 : 0) + turnsFor(w.rest),
      doors: doors,
    };
  }

  function reset() {
    setData(null);
  }

  /** The map's coordinate space: the grid, with room around it. */
  function bounds() {
    var d = battle.data;
    return d
      ? { width: d.width * CELL + 2 * PAD, height: d.height * CELL + 2 * PAD }
      : { width: 1, height: 1 };
  }

  /** The grid, for framing: a battle map is small enough to show whole. */
  function framePoints() {
    var d = battle.data;
    return [
      { x: PAD, y: PAD },
      { x: PAD + d.width * CELL, y: PAD + d.height * CELL },
    ];
  }

  function herePoint() {
    return battle.data ? centre(battle.data.here) : null;
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
      fogDim: new PIXI.Sprite(),
      under: new PIXI.Graphics(), // reach, grid, layers, entries, exits, features
      people: new PIXI.Container(),
      fogDark: new PIXI.Sprite(),
      mist: new PIXI.Sprite(),
      labels: new PIXI.Container(),
      over: new PIXI.Graphics(), // the selected square and the way
      you: Loom.draw.token(),
      cards: new PIXI.Container(), // foes' cards while their turns play out (L-828)
    };
    n.art.alpha = 0.95;
    n.scene.addChild(n.ground, n.art, n.fogDim, n.under, n.people, n.fogDark, n.mist);
    n.scene.addChild(n.labels, n.over, n.you.container, n.cards);
    container.addChild(n.scene);
    battle.nodes = n;
  }

  // A deterministic grain for the dark (A3): 0–1 from a square.
  function grain(x, y) {
    var h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
  }

  // The fog as two textures (A3), a few pixels a square, blurred for soft
  // edges and stretched over the grid smoothly: the dimming of squares seen
  // before, and the dark of squares never seen, with a faint grain.
  function fogTextures(d) {
    var key = d.id + '|' + d.fog.seen + '|' + d.fog.inSight;
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
      dim: make(function (i) {
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

  // Diagonal hatching inside a rectangle (low obstacles), lines `gap` apart.
  function hatch(g, x0, y0, x1, y1, gap) {
    for (var c = x0 + y0 + gap / 2; c < x1 + y1; c += gap) {
      var xa = Math.max(x0, c - y1);
      var xb = Math.min(x1, c - y0);
      if (xb > xa) g.moveTo(xa, c - xa).lineTo(xb, c - xb);
    }
  }

  function rebuild(view) {
    var n = battle.nodes;
    var d = battle.data;
    var px = 1 / view.scale; // a screen pixel, in map units
    var cellPx = CELL * view.scale;
    var gw = d.width * CELL;
    var gh = d.height * CELL;

    n.ground.clear();
    n.ground
      .rect(PAD, PAD, gw, gh)
      .fill({ color: COLOURS.ground })
      .stroke({ width: px, color: COLOURS.groundEdge, alpha: 0.25 });

    // The art is stretched to the grid, as Claude sees it in view_image.
    var art = d.image && battle.art && battle.art.ready(d.image);
    n.art.visible = Boolean(art);
    if (art) {
      n.art.texture = battle.art.texture;
      n.art.position.set(PAD, PAD);
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
      pair[0].position.set(PAD, PAD);
      pair[0].width = gw;
      pair[0].height = gh;
    });

    var g = n.under;
    g.clear();
    var square = function (cell) {
      return { x: PAD + cell.x * CELL, y: PAD + cell.y * CELL };
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

    // The grid, when its squares are big enough to see.
    if (cellPx >= 6) {
      [false, true].forEach(function (major) {
        for (var gx = 0; gx <= d.width; gx++) {
          if ((gx % 5 === 0) !== major) continue;
          g.moveTo(PAD + gx * CELL, PAD).lineTo(PAD + gx * CELL, PAD + gh);
        }
        for (var gy = 0; gy <= d.height; gy++) {
          if ((gy % 5 === 0) !== major) continue;
          g.moveTo(PAD, PAD + gy * CELL).lineTo(PAD + gw, PAD + gy * CELL);
        }
        g.stroke({ width: px, color: COLOURS.grid, alpha: major ? 0.3 : 0.12 });
      });
    }

    // The layers (L-627): on a plain grid, obstacles and walls.
    var wallWidth = Math.max(3, cellPx / 7) * px;
    if (!d.image) {
      (d.obstacles || []).forEach(function (o) {
        var a = square(o);
        var w = (o.w || 1) * CELL;
        var h = (o.h || 1) * CELL;
        if (o.kind === 'solid') {
          g.rect(a.x, a.y, w, h)
            .fill({ color: COLOURS.solid, alpha: 0.88 })
            .stroke({ width: 1.5 * px, color: COLOURS.solidEdge });
        } else if (o.kind === 'low') {
          hatch(g, a.x, a.y, a.x + w, a.y + h, 8 * px * Math.SQRT2);
          g.stroke({ width: 3 * px, color: COLOURS.low, alpha: 0.75 });
          g.rect(a.x, a.y, w, h).stroke({ width: 1.5 * px, color: COLOURS.low });
        } else {
          var gap = 9 * px;
          if ((w / gap) * (h / gap) < 4000) {
            for (var dx = gap / 2; dx < w; dx += gap) {
              for (var dy = gap / 2; dy < h; dy += gap) g.circle(a.x + dx, a.y + dy, 1.6 * px);
            }
            g.fill({ color: COLOURS.dot, alpha: 0.8 });
          }
          Loom.draw.polyline(
            g,
            [
              { x: a.x, y: a.y },
              { x: a.x + w, y: a.y },
              { x: a.x + w, y: a.y + h },
              { x: a.x, y: a.y + h },
              { x: a.x, y: a.y },
            ],
            [4 * px, 3 * px]
          );
          g.stroke({ width: 1.5 * px, color: COLOURS.difficult });
        }
      });
      (d.walls || []).forEach(function (w) {
        Loom.draw.polyline(g, (w.points || []).map(square));
        g.stroke({ width: wallWidth, color: COLOURS.wall, cap: 'square', join: 'miter' });
      });
    }

    // Doors, always, by their state for this save.
    (d.doors || []).forEach(function (door) {
      var a = square(door.from);
      var b = square(door.to);
      if (battle.selectedDoor === door.id) {
        g.moveTo(a.x, a.y).lineTo(b.x, b.y);
        g.stroke({ width: wallWidth + 8 * px, color: COLOURS.selected, alpha: 0.45 });
      }
      Loom.draw.line(g, a, b, door.state === 'open' ? [3 * px, 4 * px] : null);
      g.stroke({
        width: wallWidth + 2 * px,
        color: door.state === 'locked' ? COLOURS.doorLocked : COLOURS.door,
        alpha: door.state === 'open' ? 0.85 : 1,
      });
    });

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
        n.people.addChild(token.container);
      }
      people[person.id || person.name] = true;
      var c = centre(person);
      token.container.visible = true;
      token.container.scale.set(px);
      // Their side shows in a fight's colours (L-828): foes red, friends
      // green; someone down is faded.
      token.container.alpha = person.down ? 0.45 : 1;
      token.update({
        x: c.x,
        y: c.y,
        radius: Math.max(5, cellPx * 0.32),
        name: person.name,
        fill:
          person.side === 'hostile'
            ? COLOURS.foe
            : person.side === 'party'
              ? COLOURS.friend
              : COLOURS.person,
      });
    });
    Object.keys(battle.tokens).forEach(function (id) {
      if (!people[id]) battle.tokens[id].container.visible = false;
    });

    // Names, drawn over the fog so one by a square at its edge still reads.
    n.labels.removeChildren();
    var label = function (cell, text, colour) {
      var node = Loom.draw.label(text, 11.5);
      var c = centre(cell);
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
      var c = centre(area.label);
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
    var centres = function (cells) {
      return cells.map(centre);
    };
    // Someone selected (L-828; UI2): your attacks' reach and range around
    // you (long range dashed), and their cover from where you stand.
    var target = battle.selected && personAt(battle.selected);
    var combat = combatOf();
    if (target && combat && !target.down) {
      var around = function (r) {
        var x0 = Math.max(0, d.here.x - r);
        var y0 = Math.max(0, d.here.y - r);
        var x1 = Math.min(d.width - 1, d.here.x + r);
        var y1 = Math.min(d.height - 1, d.here.y + r);
        var a = square({ x: x0, y: y0 });
        var b = square({ x: x1 + 1, y: y1 + 1 });
        return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a];
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
        var tc = centre(target);
        coverLabel.position.set(tc.x, tc.y - CELL / 2 - 16 * px);
        n.labels.addChild(coverLabel);
        battle.labels.push(coverLabel);
      }
    }
    var preview = battle.preview;
    var plan = battle.turn && battle.turn.plan;
    if (!battle.anim && preview && preview.path) {
      Loom.draw.polyline(o, centres([d.here].concat(preview.walked)));
      o.stroke({ width: 3 * px, color: COLOURS.path, cap: 'round', join: 'round' });
      var from = preview.walked.length ? preview.walked[preview.walked.length - 1] : d.here;
      Loom.draw.polyline(o, centres([from].concat(preview.rest)), [2 * px, 7 * px]);
      o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.85, cap: 'round' });
      // Its cost at the end, and where the AP left runs out (L-837; UI1).
      if (battle.turn && !battle.turn.apOff) {
        var end = preview.path[preview.path.length - 1];
        pathLabel(n, px, end, preview.cost + ' AP');
        if (preview.rest.length) {
          var stop = centre(from);
          o.circle(stop.x, stop.y, CELL * 0.22).stroke({ width: 2.5 * px, color: COLOURS.path });
          o.moveTo(stop.x - CELL * 0.16, stop.y - CELL * 0.16)
            .lineTo(stop.x + CELL * 0.16, stop.y + CELL * 0.16)
            .stroke({ width: 2.5 * px, color: COLOURS.path });
          if (preview.walked.length) pathLabel(n, px, from, 'AP runs out', true);
        }
      }
    } else if (!battle.anim && !battle.selected && plan) {
      Loom.draw.polyline(o, centres([d.here].concat(plan.path)), [2 * px, 7 * px]);
      o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.5, cap: 'round' });
    }
  }

  // A label over a square of the path preview (L-837): its cost; or, under
  // it (`below`), where the AP runs out.
  function pathLabel(n, px, cell, text, below) {
    var node = Loom.draw.label(text, 11);
    node.style.fill = COLOURS.path;
    node.scale.set(px);
    var c = centre(cell);
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
    if (battle.playback) drawPlayback(view);

    // You: along your walk, or where you stand.
    var cellPx = CELL * view.scale;
    var me = tokenCentre();
    var save = Loom.store.get().save;
    n.you.container.scale.set(1 / view.scale);
    n.you.update({
      x: me.x,
      y: me.y,
      radius: Math.max(5, cellPx * 0.3),
      name: save && save.characterName,
      fill: COLOURS.you,
      ring: COLOURS.ring,
    });
  }

  // ── Clicks: the menu (I2) ─────────────────────────

  // The door under a point (within a fifth of a square of its line), or null.
  function doorAt(m) {
    var gx = (m.x - PAD) / CELL;
    var gy = (m.y - PAD) / CELL;
    return (
      (battle.data.doors || []).filter(function (dr) {
        var x0 = Math.min(dr.from.x, dr.to.x);
        var x1 = Math.max(dr.from.x, dr.to.x);
        var y0 = Math.min(dr.from.y, dr.to.y);
        var y1 = Math.max(dr.from.y, dr.to.y);
        var dx = Math.max(x0 - gx, 0, gx - x1);
        var dy = Math.max(y0 - gy, 0, gy - y1);
        return Math.sqrt(dx * dx + dy * dy) <= DOOR_HIT;
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
        battle.pending = { mapId: d.id, from: d.here, path: preview.path };
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
    var d = battle.data;
    var m = M.toMap(view, point.x, point.y);
    var door = doorAt(m);
    if (door) {
      battle.selectedDoor = door.id;
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
    var cell = { x: Math.floor((m.x - PAD) / CELL), y: Math.floor((m.y - PAD) / CELL) };
    var inside = cell.x >= 0 && cell.y >= 0 && cell.x < d.width && cell.y < d.height;
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
  // 'long' (range), or null, as the server reads it (position.js bandOf).
  function bandOf(attack, cell) {
    var away = distance(battle.data.here, cell);
    if (attack.range) {
      if (away <= attack.range.normal) return 'normal';
      return away <= attack.range.long ? 'long' : null;
    }
    return away <= (attack.reach || 1) ? 'reach' : null;
  }

  var BAND_WORDS = { reach: 'in reach', normal: 'in range', long: 'long range' };

  // What a square offers: on yours, Stand up when lying down and, in a
  // fight, Dodge, Withdraw and Ready; on someone, Move and Attack with each of your attacks; on a
  // feature beside you, Use; else Move.
  function itemsFor(cell) {
    var d = battle.data;
    if (same(cell, d.here)) return selfItems();
    var person = personAt(cell);
    if (person) return [moveItem(cell)].concat(attackItems(person));
    var feature = at(cell).feature;
    return [moveItem(cell)].concat(feature ? useItems(feature) : []);
  }

  // Turns run on AP (L-832): each menu entry shows its cost, greyed out
  // with the reason when the AP left won't pay for it (L-837). With AP off
  // (L-838), the turn's one action.
  function acted() {
    return Boolean(battle.turn && battle.turn.apOff && battle.turn.acted);
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
            ? 'Out of range (' + a.range.long + ' squares).'
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
    var where = {};
    (d.people || []).forEach(function (p) {
      if (p.x !== undefined) where[p.id] = { x: p.x, y: p.y };
    });
    var steps = [];
    var t = 0;
    turns.forEach(function (turn) {
      var from = where[turn.id];
      var path = turn.path || [];
      if (!from && path.length) from = path[0];
      if (!from) return;
      var cells = [from].concat(path);
      var walk = (cells.length - 1) * STEP_MS;
      var card = turn.attack && turn.attack.card ? cardText(turn) : null;
      steps.push({ id: turn.id, cells: cells, t0: t, walk: walk, card: card });
      t += walk + (card ? CARD_MS : 0);
      where[turn.id] = cells[cells.length - 1];
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
        if (!at[st.id]) at[st.id] = centre(st.cells[0]);
        return;
      }
      var u = Math.min(1, (t - st.t0) / Math.max(1, st.walk));
      var span = (st.cells.length - 1) * u;
      var i = Math.min(Math.floor(span), Math.max(0, st.cells.length - 2));
      var f = st.cells.length > 1 ? Math.min(1, span - i) : 0;
      var a = centre(st.cells[i]);
      var b = centre(st.cells[Math.min(i + 1, st.cells.length - 1)]);
      at[st.id] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      if (st.card && t >= st.t0 + st.walk && t < st.t0 + st.walk + CARD_MS) {
        var node = Loom.draw.label(st.card, 12);
        node.style.fill = COLOURS.card;
        node.scale.set(1 / view.scale);
        node.position.set(at[st.id].x, at[st.id].y - CELL * 0.75);
        n.cards.addChild(node);
      }
    });
    Object.keys(at).forEach(function (id) {
      var token = battle.tokens[id];
      if (!token) return;
      token.container.visible = true;
      token.container.position.set(at[id].x, at[id].y);
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
      : 'look at ' + (target.name || 'the door');
    return {
      label: "What's here?",
      note: 'Free',
      onSelect: function () {
        Loom.play.lookAt(cell ? { cell: { x: cell.x, y: cell.y } } : { door: target.door }, label);
      },
    };
  }

  /** A hover over the grid shows it can be clicked. */
  function hover(point, view) {
    if (!point || !battle.data) {
      engine.panelCursor('');
      return;
    }
    var m = M.toMap(view, point.x, point.y);
    var d = battle.data;
    var gx = (m.x - PAD) / CELL;
    var gy = (m.y - PAD) / CELL;
    var onGrid = gx >= 0 && gy >= 0 && gx < d.width && gy < d.height;
    engine.panelCursor(doorAt(m) || onGrid ? 'pointer' : '');
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
    if (!preview.rest.length) when = 'this turn';
    else if (preview.turns === Infinity) when = 'too far to walk';
    else if (!preview.walked.length) {
      when = preview.turns === 1 ? 'next turn' : preview.turns + ' turns, from next turn';
    } else when = preview.turns + ' turns';
    return (
      (battle.turn && battle.turn.apOff ? preview.path.length + ' squares' : preview.cost + ' AP') +
      ' · ' +
      when +
      (preview.doors.length ? ' · opens ' + listOf(preview.doors).replace(/ or /, ' and ') : '')
    );
  }

  /** Continue (L-613): walks the kept plan, the token walking it as it lands. */
  function continuePlan() {
    var turn = battle.turn;
    if (battle.data && turn && turn.plan) {
      battle.pending = { mapId: battle.data.id, from: battle.data.here, path: turn.plan.path };
    }
    Loom.play.continuePlan();
  }

  /** The minimap's view of the map: the grid, the people in sight and you. */
  function minimap() {
    var d = battle.data;
    var points = (d.people || [])
      .filter(function (p) {
        return p.x !== undefined;
      })
      .map(function (p) {
        var c = centre(p);
        return { x: c.x, y: c.y, colour: '#4db6ac', r: 2.5 };
      });
    var me = centre(d.here);
    points.push({ x: me.x, y: me.y, colour: '#ffffff', r: 3.5, ring: '#ffb74d' });
    return {
      rect: { x: PAD, y: PAD, width: d.width * CELL, height: d.height * CELL, fill: '#1a1f2c' },
      points: points,
    };
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
      PAD + Math.cos(phase / 3) * CELL * 0.2
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
    selectHere: function () {
      selectHere();
      battle.selectedDoor = null;
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
  };
})();
