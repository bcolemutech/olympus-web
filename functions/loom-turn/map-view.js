'use strict';

const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const maps = require('../loom-canon/maps');
const { discoveredBy } = require('./discovery');
const { speedOf, turnStateOf } = require('../loom-models');
const { planOn, doorStatesOf } = require('./steps');
const layers = require('../loom-canon/layers');

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
 * `battleMap` is that map, for the grid view (battleView below); else null.
 * `turn` is the save's turn (L-611 / #441): `{ n, movementLeft, speed,
 * actionUsed, plan }`, a fresh one for an older save.
 */
function mapView(canonWorld, save) {
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
    battleMap: battleView(canonWorld, save),
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
 * its entries, exits (and where each leads) and features, and the people
 * found at the place. Characters have no cells yet, so they are listed, not
 * placed. Null off a map.
 */
function battleView(canonWorld, save) {
  const { map, cell } = maps.positionOf(canonWorld, save);
  if (!map) return null;
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
        .map((c) => ({ id: c.id, name: c.name }))
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
    entries: (map.entries || []).map((e) => ({ id: e.id, x: e.x, y: e.y })),
    exits: (map.exits || []).map((e) => {
      const next = e.to && e.to !== 'out' ? (canonWorld.battleMaps || {})[e.to.map] : null;
      return {
        id: e.id,
        name: e.name,
        x: e.x,
        y: e.y,
        to: next ? { map: next.id, name: next.name } : 'out',
      };
    }),
    features: (map.features || []).map((f) => ({ id: f.id, name: f.name, x: f.x, y: f.y })),
    // Its layers (L-624), each door in this save's state, so the grid view's
    // paths are the server's.
    walls: (map.walls || []).map((w) => ({ points: w.points })),
    doors: (map.doors || []).map((d) => ({
      id: d.id,
      name: d.name,
      from: d.from,
      to: d.to,
      state: layers.doorState(d, doorStatesOf(save, map.id)),
    })),
    obstacles: (map.obstacles || []).map((o) => ({
      id: o.id,
      name: o.name,
      kind: o.kind,
      x: o.x,
      y: o.y,
      w: o.w || 1,
      h: o.h || 1,
    })),
    people,
  };
}

// The plan shows only while it's for the map the save stands on (L-613).
function turnView(save) {
  const { n, movementLeft, actionUsed } = turnStateOf(save);
  return { n, movementLeft, speed: speedOf(save), actionUsed, plan: planOn(save) };
}

module.exports = { mapView, townView, battleView, turnView };
