'use strict';

const { isPlayable } = require('../loom-canon/grading');
const { discoveredBy } = require('./discovery');

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

module.exports = { mapView };
