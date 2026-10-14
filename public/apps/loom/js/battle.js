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
  // - Every click opens the engine's menu (I2), no one-tap shortcuts: on a
  //   square, Move (step there, go to someone or a feature, go out by an
  //   exit; beyond this turn the rest is kept as the plan) and Look; on a
  //   door, Open, Close or Try it from beside it, and Look.
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
    you: 0xffffff,
    ring: 0xffb74d,
    label: 0xe0e0e0,
  };
  var FOG_DIM = 0.6; // seen before, out of sight now
  var FOG_SCALE = 4; // fog texture pixels a square, before it is stretched
  var FOG_BLUR = 3; // px of that texture: the feathered edge, about ¾ of a square

  var battle = {
    data: null, // loomGetMap's `battleMap`
    turn: null, // loomGetMap's `turn` (L-611): movement left, the plan
    selected: null, // a cell { x, y }
    selectedDoor: null, // a door's id, when a door is clicked (L-627)
    art: { path: null, texture: null },
    reach: null, // this turn's reach: { runs: [{ y, x0, x1 }] }
    fog: null, // the fog (L-634): { dark: runs, dim: runs }, as reach's runs
    known: null, // whether a square (by y × width + x) has been seen (L-635)
    preview: null, // the path to the selected cell: { path, walked, rest, cost, turns } or { none }
    pending: null, // a move sent: { mapId, from, path }, for the walk when it lands
    anim: null, // the token's walk: { cells, t0 }
    version: 0, // bumped when what is drawn changes
    built: null, // what the drawing was last built for
    nodes: null, // the PixiJS objects
    labels: [], // the labels in use
    tokens: {}, // person id → token
    fogTextures: { key: null, dim: null, dark: null },
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
  // doors and obstacles, 2 a square on difficult ground, 1 more to open a
  // closed door (where a walk stops), and exits stepped onto, never through.
  // Doors are as this save has them, and only ground it knows is walked
  // (L-635): what it has seen, as the server does.
  function pathOptions() {
    var states = {};
    (battle.data.doors || []).forEach(function (door) {
      states[door.id] = door.state;
    });
    var rules = L.pathOptions(battle.data, states);
    if (!battle.known) return rules;
    return {
      avoid: rules.avoid,
      opens: rules.opens,
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

  function movementLeft() {
    return battle.turn ? battle.turn.movementLeft : 0;
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

  function loadArt(image) {
    if (!image) {
      battle.art = { path: null, texture: null };
      return;
    }
    var key = Loom.artKey(image);
    if (key === battle.art.path) return;
    battle.art = { path: key, texture: null };
    Loom.draw
      .loadTexture(image)
      .then(function (texture) {
        if (battle.art.path !== key) return; // the player moved on meanwhile
        battle.art.texture = texture;
        changed();
        engine.draw();
      })
      .catch(function (err) {
        console.error('Could not load the battle-map art:', err);
      });
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

  // How many turns walking `path` takes at full speed, from the next turn
  // (a door opened on the way ends a turn's walk).
  function turnsFor(path) {
    var speed = battle.turn ? battle.turn.speed : 20;
    var turns = 0;
    while (path.length) {
      var w = P.walk(path, speed);
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
      labels: new PIXI.Container(),
      over: new PIXI.Graphics(), // the selected square and the way
      you: Loom.draw.token(),
    };
    n.art.alpha = 0.95;
    n.scene.addChild(n.ground, n.art, n.fogDim, n.under, n.people, n.fogDark);
    n.scene.addChild(n.labels, n.over, n.you.container);
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
    var make = function (alphaOf) {
      var raw = document.createElement('canvas');
      raw.width = d.width * FOG_SCALE;
      raw.height = d.height * FOG_SCALE;
      var ctx = raw.getContext('2d');
      for (var y = 0; y < d.height; y++) {
        for (var x = 0; x < d.width; x++) {
          var a = alphaOf(y * d.width + x, x, y);
          if (!a) continue;
          ctx.fillStyle = 'rgba(0,0,0,' + a + ')';
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
    ['dim', 'dark'].forEach(function (kind) {
      if (battle.fogTextures[kind]) battle.fogTextures[kind].destroy(true);
    });
    battle.fogTextures = {
      key: key,
      dim: make(function (i) {
        return seen(i) && !inSight(i) ? FOG_DIM : 0;
      }),
      dark: make(function (i, x, y) {
        return seen(i) ? 0 : 0.9 + 0.1 * grain(x, y);
      }),
    };
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
    var art = d.image && battle.art.texture && battle.art.path === Loom.artKey(d.image);
    n.art.visible = Boolean(art);
    if (art) {
      n.art.texture = battle.art.texture;
      n.art.position.set(PAD, PAD);
      n.art.width = gw;
      n.art.height = gh;
    }

    var fog = d.fog ? fogTextures(d) : null;
    [
      [n.fogDim, fog && fog.dim],
      [n.fogDark, fog && fog.dark],
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
      token.update({
        x: c.x,
        y: c.y,
        radius: Math.max(5, cellPx * 0.32),
        name: person.name,
        fill: COLOURS.person,
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
    d.exits.forEach(function (e) {
      label(e, e.name, COLOURS.exitLabel);
    });
    d.features.forEach(function (f) {
      label(f, f.name);
    });
    (d.people || []).forEach(function (person) {
      if (person.x !== undefined) label(person, person.name);
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
    var preview = battle.preview;
    var plan = battle.turn && battle.turn.plan;
    if (!battle.anim && preview && preview.path) {
      Loom.draw.polyline(o, centres([d.here].concat(preview.walked)));
      o.stroke({ width: 3 * px, color: COLOURS.path, cap: 'round', join: 'round' });
      var from = preview.walked.length ? preview.walked[preview.walked.length - 1] : d.here;
      Loom.draw.polyline(o, centres([from].concat(preview.rest)), [2 * px, 7 * px]);
      o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.85, cap: 'round' });
    } else if (!battle.anim && !battle.selected && plan) {
      Loom.draw.polyline(o, centres([d.here].concat(plan.path)), [2 * px, 7 * px]);
      o.stroke({ width: 3 * px, color: COLOURS.path, alpha: 0.5, cap: 'round' });
    }
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
    ].join('|');
    if (key !== battle.built) {
      rebuild(view);
      battle.built = key;
    }
    n.scene.position.set(view.x, view.y);
    n.scene.scale.set(view.scale);

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
    return [
      {
        label: capitalise(text),
        disabled: !beside,
        note: beside ? '1 movement' : 'Walk beside it to open or close it.',
        onSelect: function () {
          Loom.play.doorAction(door.id, open, (open ? 'open ' : 'close ') + name);
          Loom.map.showStory();
        },
      },
    ];
  }

  function whereTo(exit) {
    return exit.to === 'out'
      ? 'out of ' + (battle.data.host ? battle.data.host.name : 'here')
      : 'to ' + exit.to.name;
  }

  // What a square is: its title and facts, for the menu and the card.
  function describe(cell) {
    var there = at(cell);
    var person = personAt(cell);
    var coords = '(' + cell.x + ', ' + cell.y + ')';
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
    return { title: 'Square ' + coords, facts: '', go: 'Move here', coords: coords };
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
        items: busy(doorItems(door)).concat([lookItem()]),
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
      items: busy([moveItem(cell)]).concat([lookItem()]),
    });
  }

  // Look: the card shows what was clicked; nothing is played.
  function lookItem() {
    return {
      label: 'Look',
      onSelect: function () {
        Loom.map.render();
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

  function button(text, onClick) {
    var b = el('button', 'app-btn loom-map-travel', text);
    b.type = 'button';
    b.disabled = state.turnInProgress;
    b.addEventListener('click', onClick);
    return b;
  }

  /** The card: what was clicked (or where you are), and the turn under it. */
  function renderInfo(info) {
    info.innerHTML = '';
    renderCard(info);
    renderTurn(info);
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
        (d.host ? ' in ' + d.host.name : '') +
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
      preview.cost +
      ' movement · ' +
      when +
      (preview.doors.length ? ' · opens ' + listOf(preview.doors).replace(/ or /, ' and ') : '')
    );
  }

  // The turn (L-613, L-615): the turn number, movement left, the action,
  // Continue for a kept plan, and End turn.
  function renderTurn(info) {
    var turn = battle.turn;
    if (!turn) return;
    info.appendChild(
      el(
        'p',
        'loom-map-info-facts loom-map-turn-state',
        'Turn ' +
          turn.n +
          ' · movement ' +
          turn.movementLeft +
          ' of ' +
          turn.speed +
          ' · ' +
          (turn.actionUsed ? 'you have acted' : 'your action is ready')
      )
    );
    var row = el('div', 'loom-map-turn');
    if (turn.plan && turn.movementLeft > 0) {
      row.appendChild(
        button('Continue', function () {
          battle.pending = { mapId: battle.data.id, from: battle.data.here, path: turn.plan.path };
          Loom.play.continuePlan();
        })
      );
    }
    row.appendChild(
      button('End turn', function () {
        Loom.play.endTurn();
      })
    );
    info.appendChild(row);
  }

  function capitalise(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  engine.addLayer('battle', { draw: draw });

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
    renderInfo: renderInfo,
    current: function () {
      return battle.data;
    },
  };
})();
