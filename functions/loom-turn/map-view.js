'use strict';

const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const { discoveredBy } = require('./discovery');
const { speedOf, turnStateOf } = require('../loom-models');
const { planOn, doorStatesOf, doorSides } = require('./steps');
const layers = require('../loom-canon/layers');
const seen = require('./seen');

const ROUTES = ['road', 'trail', 'sea'];
const TOWN_SPAN = 1000; // town coordinates run 0–1000 each way (place.position)

/**
 * What a save may see of its world's map (planning/the-loom-layered-worlds.md
 * §7; L-331 / #393), for the Loom's map view: only the places it has
 * discovered (./discovery.js), with their positions, the links between them,
 * whether each is open to players (the gate, L-322), and where the save
 * stands. Nothing undiscovered is ever included, and no descriptions: the
 * story still comes through turns.
 *
 * Static worlds have no coordinates, so their places come without x/y and
 * the map is null.
 *
 * In a settlement with a town layout, `town` is the town the save stands in,
 * for the town view (townView below); elsewhere it is null. On a battle map,
 * `battleMap` is what the save has seen of that map, for the grid view
 * (battleView below; `record` is the save's seen record for it, ./seen.js);
 * else null. `turn` is the save's turn (L-611 / #441): `{ n, movementLeft,
 * speed, actionUsed, plan }`, a fresh one for an older save.
 */
function mapView(canonWorld, save, record) {
  const discovered = new Set(discoveredBy(canonWorld, save));
  if (save.location) discovered.add(save.location);

  const places = [];
  for (const id of discovered) {
    const place = canonWorld.locations[id];
    // A retired place stays on the map only while the save stands in it.
    if (!place || (place.retired && id !== save.location)) continue;
    const geo = place.geo || {};
    const row = {
      id,
      name: place.name,
      kind: geo.kind || 'place',
      open: isPlayable(canonWorld, place),
    };
    if (typeof geo.x === 'number' && typeof geo.y === 'number') {
      row.x = geo.x;
      row.y = geo.y;
    }
    if (geo.kind === 'settlement') {
      row.population = Math.round(geo.population || 0);
      if (geo.capital) row.capital = true;
      if (geo.port) row.port = true;
      // Where a traveller can choose to arrive (L-346): its open ways in.
      const ways = row.open ? waysInto(canonWorld, id) : [];
      if (ways.length) row.waysIn = ways;
    }
    if (geo.markerType) row.markerType = geo.markerType;
    if (place.retired) row.retired = true;
    places.push(row);
  }

  const shown = new Set(places.map((p) => p.id));
  const links = [];
  const seen = new Set();
  for (const { id } of places) {
    const place = canonWorld.locations[id];
    const via = (place.geo && place.geo.links) || {};
    for (const other of place.connections || []) {
      const key = [id, other].sort().join('|');
      if (!shown.has(other) || seen.has(key)) continue;
      seen.add(key);
      links.push({ from: id, to: other, via: via[other] || null });
    }
  }

  const map = canonWorld.map;
  return {
    worldId: canonWorld.id,
    name: canonWorld.name,
    here: save.location || null,
    places,
    links,
    town: townView(canonWorld, save, discovered),
    battleMap: battleView(canonWorld, save, record),
    // The turn (L-611 / #441): which it is, the movement left of the
    // character's speed, whether its action is used, and any plan kept.
    turn: turnView(save),
    map:
      map && map.width
        ? {
            width: map.width,
            height: map.height,
            image: map.imagePath
              ? { path: map.imagePath, width: map.imageWidth, height: map.imageHeight }
              : null,
          }
        : null,
  };
}

// A settlement's open ways in, and the routes each serves (`via`, a route
// kind, narrows them to the ones serving it).
function waysInto(canonWorld, locationId, via) {
  return town
    .entrancesOf(canonWorld, locationId)
    .filter((p) => isPlaceOpen(canonWorld, p) && (via === undefined || town.serves(p, via)))
    .map((p) => ({ id: p.id, name: p.name, via: servedRoutes(p) }));
}

// The world routes an entrance serves, in a fixed order (no list: all of them).
function servedRoutes(place) {
  const via = place.entrance && place.entrance.via;
  return Array.isArray(via) && via.length ? ROUTES.filter((r) => via.includes(r)) : ROUTES;
}

function positionIn(place) {
  const p = place.position;
  const inside = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= TOWN_SPAN;
  return p && inside(p.x) && inside(p.y) ? { x: p.x, y: p.y } : null;
}

/**
 * The town a save stands in (planning/the-loom-layered-worlds.md §8; L-345 /
 * #399), for the town view: every live place of the town, whether each is
 * open (the gate, L-322), which are ways in and out and the routes they
 * serve, their positions where set (the view places the rest), the links
 * between them, where the save stands, the places one step away (`next`, as
 * the rules engine allows: the links from here), and the world routes out of
 * town with the ways out that serve each and the ways in at the other end
 * (`exits`, discovered places only).
 * Like the world map: no descriptions, and nothing outside the town.
 */
function townView(canonWorld, save, discovered) {
  const { location, place: here } = town.positionOf(canonWorld, save);
  if (!location) return null;
  const inTown = town.placesOf(canonWorld, location);
  // A retired place stays in view only while the save stands in it.
  if (here && !inTown.some((p) => p.id === here.id)) inTown.push(here);
  if (!inTown.length) return null;

  const ids = new Set(inTown.map((p) => p.id));
  const places = inTown.map((place) => {
    const row = {
      id: place.id,
      name: place.name,
      kind: place.kind || 'place',
      open: isPlaceOpen(canonWorld, place),
    };
    if (town.isEntrance(place)) row.entranceFor = servedRoutes(place);
    const position = positionIn(place);
    if (position) row.position = position;
    if (place.retired) row.retired = true;
    return row;
  });

  const links = [];
  const seen = new Set();
  for (const place of inTown) {
    for (const other of place.connections || []) {
      const key = [place.id, other].sort().join('|');
      if (!ids.has(other) || seen.has(key)) continue;
      seen.add(key);
      links.push({ from: place.id, to: other });
    }
  }

  // Every place the save can walk to in one move (L-600 / #433), nearest
  // first: through places it may enter, to any linked to them.
  const next = town
    .reachableFrom(canonWorld, location, here, town.passableFor(canonWorld, save))
    .map((p) => p.id)
    .filter((id) => ids.has(id));

  const settlement = canonWorld.locations[location];
  const entrances = inTown.filter((p) => town.isEntrance(p) && !p.retired);
  const exits = [];
  for (const id of settlement.connections || []) {
    const to = canonWorld.locations[id];
    if (!to || !discovered.has(id)) continue;
    const via = town.routeBetween(canonWorld, location, id);
    const open = isPlayable(canonWorld, to);
    exits.push({
      id,
      name: to.name,
      via,
      open,
      waysOut: entrances.filter((p) => town.serves(p, via)).map((p) => p.id),
      // Where you can choose to arrive by this route (L-346).
      waysIn: open ? waysInto(canonWorld, id, via).map((p) => ({ id: p.id, name: p.name })) : [],
    });
  }

  const art = settlement.town && settlement.town.image;
  return {
    locationId: location,
    name: settlement.name,
    here: here ? here.id : null,
    next,
    places,
    links,
    exits,
    // The town's art (L-347), drawn behind the places, fitted to the town's
    // 0–1000 square: { path (Cloud Storage), width, height }, or null.
    image: art ? { path: art.path, width: art.width, height: art.height } : null,
  };
}

/**
 * The battle map a save stands on (planning/the-loom-layered-worlds.md §9;
 * L-354 / #403), for the grid view: its grid and art, where the save stands,
 * and what the save has seen of it (planning/the-loom-movement-and-vision.md
 * §5; L-633 / #456). Nothing the character hasn't seen leaves the server:
 *
 *   - the walls and doors along the sides of squares it has seen, each door
 *     in this save's state (L-624);
 *   - the obstacles on squares it has seen, cut down to those squares;
 *   - the entries, exits (and where each leads) and features on squares it
 *     has seen;
 *   - the people found at the place: those standing on a square (`cell`,
 *     §6) only while it's in sight, with their square (`x`, `y`) for their
 *     token (L-642); the rest, who have no square yet, listed;
 *   - `fog: { seen, inSight }`, the squares seen (ever, this one included)
 *     and in sight now, packed as ./seen.js packs them (one bit a square,
 *     y × width + x, lowest bit first, in base64), for the grid view's fog.
 *
 * Seen means the save's record for this map (`record`, ./seen.js) and
 * whatever is in sight now, so a save with no record yet still sees where
 * it stands. The art is sent whole: the fog covers it. Null off a map.
 */
function battleView(canonWorld, save, record) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map) return null;
  const doors = doorStatesOf(save, map.id);
  const inSight = seen.inSightNow(canonWorld, save).squares;
  const known = Object.assign(seen.squaresOf(record, map), inSight);
  const on = (square) => Boolean(known[square.x + ',' + square.y]);

  const host = maps.hostOf(canonWorld, save);
  const isPlace = host && Boolean((canonWorld.places || {})[host.id]);
  const people = host
    ? Object.values(canonWorld.characters || {})
        .filter((c) => !c.retired)
        .filter((c) =>
          isPlace
            ? c.placeId === host.id || (host.npcIds || []).includes(c.id)
            : c.locationId === host.id && !c.placeId
        )
        .filter((c) => !c.cell || Boolean(inSight[c.cell.x + ',' + c.cell.y]))
        // Their square, for their token (L-642); none for those without one.
        .map((c) => ({ id: c.id, name: c.name, ...(c.cell ? { x: c.cell.x, y: c.cell.y } : {}) }))
    : [];
  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    image: map.image
      ? { path: map.image.path, width: map.image.width, height: map.image.height }
      : null,
    here: { x: cell.x, y: cell.y },
    host: host ? { id: host.id, name: host.name } : null,
    entries: (map.entries || []).filter(on).map((e) => ({ id: e.id, x: e.x, y: e.y })),
    exits: (map.exits || []).filter(on).map((e) => {
      const next = e.to && e.to !== 'out' ? (canonWorld.battleMaps || {})[e.to.map] : null;
      return {
        id: e.id,
        name: e.name,
        x: e.x,
        y: e.y,
        to: next ? { map: next.id, name: next.name } : 'out',
      };
    }),
    features: (map.features || [])
      .filter(on)
      .map((f) => ({ id: f.id, name: f.name, x: f.x, y: f.y })),
    // Its layers (L-624), as far as they've been seen, each door in this
    // save's state, so the grid view's paths are the server's.
    walls: seenWalls(map, on),
    doors: (map.doors || [])
      .filter((d) => doorSides(d).some(on))
      .map((d) => ({
        id: d.id,
        name: d.name,
        from: d.from,
        to: d.to,
        state: layers.doorState(d, doors),
      })),
    obstacles: seenObstacles(map, on),
    people,
    fog: {
      seen: seen.pack(known, map.width, map.height),
      inSight: seen.pack(inSight, map.width, map.height),
    },
  };
}

// The runs of a map's walls along the sides of squares seen (`on`): each wall
// is cut at the sides of squares not seen on either hand, every run kept
// running the way its wall did.
function seenWalls(map, on) {
  const runs = [];
  (map.walls || []).forEach((wall) => {
    const points = wall.points || [];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const dx = Math.sign(b.x - a.x);
      const dy = Math.sign(b.y - a.y);
      if (Boolean(dx) === Boolean(dy)) continue; // not along a grid line
      const length = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      let start = null;
      for (let k = 0; k <= length; k++) {
        // The side from a + k to a + k + 1, between the squares either hand.
        let seenSide = false;
        if (k < length) {
          const x = a.x + dx * k + Math.min(dx, 0);
          const y = a.y + dy * k + Math.min(dy, 0);
          seenSide = dx ? on({ x, y: y - 1 }) || on({ x, y }) : on({ x: x - 1, y }) || on({ x, y });
        }
        if (seenSide && start === null) start = k;
        if (!seenSide && start !== null) {
          runs.push({
            points: [
              { x: a.x + dx * start, y: a.y + dy * start },
              { x: a.x + dx * k, y: a.y + dy * k },
            ],
          });
          start = null;
        }
      }
    }
  });
  return runs;
}

// A map's obstacles on squares seen (`on`): whole where all of it is seen,
// else cut into its seen runs along each row.
function seenObstacles(map, on) {
  const pieces = [];
  (map.obstacles || []).forEach((o) => {
    const w = o.w || 1;
    const h = o.h || 1;
    const piece = (x, y, width) => ({ id: o.id, name: o.name, kind: o.kind, x, y, w: width, h: 1 });
    const rows = [];
    for (let y = o.y; y < o.y + h; y++) {
      let start = null;
      for (let x = o.x; x <= o.x + w; x++) {
        const seenHere = x < o.x + w && on({ x, y });
        if (seenHere && start === null) start = x;
        if (!seenHere && start !== null) {
          rows.push(piece(start, y, x - start));
          start = null;
        }
      }
    }
    if (rows.length === h && rows.every((r) => r.w === w)) {
      pieces.push({ id: o.id, name: o.name, kind: o.kind, x: o.x, y: o.y, w, h });
    } else {
      pieces.push(...rows);
    }
  });
  return pieces;
}

// The plan shows only while it's for the map the save stands on (L-613).
function turnView(save) {
  const { n, movementLeft, actionUsed } = turnStateOf(save);
  return { n, movementLeft, speed: speedOf(save), actionUsed, plan: planOn(save) };
}

module.exports = { mapView, townView, battleView, turnView };
