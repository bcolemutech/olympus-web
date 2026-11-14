'use strict';

/**
 * A world for journeys across country (planning/off-road-travel.md §4.4;
 * L-363), in the levels model as loadWorld gives it: one region map in
 * miles, painted, its places in the new shape. Published, so graded: places
 * written for play are open, the one not written is closed.
 *
 *   The Weald (region, 40 × 24 mi): grassland, with a band of forest from
 *   x 5 to x 18 across the whole map (half grassland's speed off the road)
 *     Ashby (2, 10)       a town; a road west of the forest to Dunsmouth
 *     Fenwick (12, 11.5)  a hamlet in the forest, a mile and a half off the
 *                         way from Ashby to Carrow
 *     Gorse (12, 20)      a hamlet in the forest, far off that way
 *     Carrow (22, 10)     a town east of the forest
 *     Dunsmouth (2, 20)   a town not written yet: closed
 *
 * From Ashby to Carrow across country: 7 miles of grassland at 1.5 mph and
 * 13 of forest at 0.75, about 22 hours: three days' travel, two nights camped.
 */

const written = (name) => ({
  description: name + ', described for play.',
  sources: { description: 'mcp' },
});

function wildsWorld(id = 'weald', extra = {}) {
  const place = (name, at, more = {}) => ({
    mapId: 'weald',
    name,
    kind: 'town',
    at,
    ...written(name),
    ...more,
  });
  return {
    id,
    name: 'The Weald',
    tagline: '',
    openingHook: '',
    status: 'published',
    canonVersion: 1,
    map: null,
    rules: { startingLocationId: 'pl_ashby' },
    topMapId: 'weald',
    maps: {
      weald: {
        kind: 'region',
        parent: null,
        name: 'The Weald',
        space: { width: 40, height: 24, distance: { unit: 'mi', perUnit: 1 } },
        routeKinds: { road: { speed: 3 } },
        geometry: {
          ground: [
            {
              id: 'grass',
              material: 'grassland',
              shape: { rect: { x: 0, y: 0, w: 40, h: 24 } },
            },
            { id: 'wood', material: 'forest', shape: { rect: { x: 5, y: 0, w: 13, h: 24 } } },
          ],
          zones: [{ id: 'z_wood', region: 'reg_wood', shape: { rect: { x: 5, y: 0, w: 13, h: 24 } } }],
        },
      },
    },
    mapPlaces: {
      pl_ashby: place('Ashby', { x: 2, y: 10 }, { links: [{ placeId: 'pl_dunsmouth', kind: 'road' }] }),
      pl_fenwick: place('Fenwick', { x: 12, y: 11.5 }),
      pl_gorse: place('Gorse', { x: 12, y: 20 }),
      pl_carrow: place('Carrow', { x: 22, y: 10 }),
      pl_dunsmouth: { mapId: 'weald', name: 'Dunsmouth', kind: 'town', at: { x: 2, y: 20 } },
    },
    locations: {},
    places: {},
    battleMaps: {},
    factions: {},
    characters: {},
    lore: {},
    regions: {
      reg_wood: {
        id: 'reg_wood',
        name: 'The Greenwood',
        description: 'Old oaks and older paths. Folk lose their way in it.',
      },
    },
    statBlocks: {},
    ...extra,
  };
}

module.exports = { wildsWorld };
