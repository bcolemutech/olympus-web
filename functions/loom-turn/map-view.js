'use strict';

const { isPlayable, isPlaceOpen } = require('../loom-canon/grading');
const town = require('../loom-canon/town');
const { discoveredBy } = require('./discovery');

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
 * for the town view (townView below); elsewhere it is null.
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
 * town with the ways out that serve each (`exits`, discovered places only).
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

  const next = here
    ? (here.connections || []).filter((id) => ids.has(id))
    : inTown.filter(town.isEntrance).map((p) => p.id);

  const settlement = canonWorld.locations[location];
  const entrances = inTown.filter((p) => town.isEntrance(p) && !p.retired);
  const exits = [];
  for (const id of settlement.connections || []) {
    const to = canonWorld.locations[id];
    if (!to || !discovered.has(id)) continue;
    const via = town.routeBetween(canonWorld, location, id);
    exits.push({
      id,
      name: to.name,
      via,
      open: isPlayable(canonWorld, to),
      waysOut: entrances.filter((p) => town.serves(p, via)).map((p) => p.id),
    });
  }

  return {
    locationId: location,
    name: settlement.name,
    here: here ? here.id : null,
    next,
    places,
    links,
    exits,
  };
}

module.exports = { mapView, townView };
