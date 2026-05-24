// Minimal synthetic Azgaar "Save as JSON" export used by tortuga-importer.test.js.
// Mirrors the shape of pack.{burgs,states,features,vertices,cells} and biomesData
// from a real Azgaar v1.122.x export. Coordinates are in pixel space [x, y].
//
// Real Azgaar exports run ~5MB; this fixture is just enough to exercise every
// parser branch: dimensions, vertex deref, island vs lake vs ocean features,
// blank-slot burgs/states, port flag, biome catalog.

module.exports = {
  azgaarJsonSample: function () {
    return {
      info: {
        version: '1.122.7',
        mapName: 'TestIsle',
        seed: '12345',
        width: 1000,
        height: 800,
      },
      pack: {
        // vertex 0 unused; vertices 1–6 form a triangle island and a triangle lake
        vertices: [
          { i: 0, p: [0, 0], v: [], c: [] },
          { i: 1, p: [100, 100], v: [], c: [] }, // island A
          { i: 2, p: [200, 100], v: [], c: [] },
          { i: 3, p: [150, 200], v: [], c: [] },
          { i: 4, p: [500, 500], v: [], c: [] }, // lake
          { i: 5, p: [600, 500], v: [], c: [] },
          { i: 6, p: [550, 600], v: [], c: [] },
          { i: 7, p: [800, 300], v: [], c: [] }, // tiny isle B
          { i: 8, p: [820, 300], v: [], c: [] },
          { i: 9, p: [810, 320], v: [], c: [] },
        ],
        features: [
          0, // Azgaar uses 0 as a placeholder at index 0
          { i: 1, type: 'ocean', cells: 100, area: 0, vertices: [] },
          { i: 2, type: 'island', group: 'continent', cells: 10, vertices: [1, 2, 3] },
          { i: 3, type: 'lake', group: 'freshwater', name: 'Mirror Lake', cells: 3, vertices: [4, 5, 6] },
          { i: 4, type: 'island', group: 'isle', cells: 2, vertices: [7, 8, 9] },
        ],
        burgs: [
          0, // blank slot
          {
            i: 1,
            cell: 100,
            x: 150,
            y: 150,
            name: 'Port Royal',
            state: 1,
            culture: 1,
            population: 12.5,
            port: 1,
            capital: 1,
            group: 'capital',
            type: 'Naval',
            feature: 2,
          },
          {
            i: 2,
            cell: 101,
            x: 175,
            y: 175,
            name: 'Highmount',
            state: 1,
            culture: 1,
            population: 4.3,
            port: 0,
            capital: 0,
            group: 'town',
          },
          {
            i: 3,
            cell: 200,
            x: 810,
            y: 310,
            name: "Smuggler's Rest",
            state: 0, // neutral / wild
            culture: 2,
            population: 0.6,
            port: 1,
            group: 'hamlet',
          },
        ],
        states: [
          { i: 0, name: 'Neutrals' }, // skipped
          {
            i: 1,
            name: 'Albion',
            fullName: 'Kingdom of Albion',
            color: '#cc4400',
            capital: 1,
            culture: 1,
          },
          {
            i: 2,
            name: 'Castile',
            fullName: 'Crown of Castile',
            color: '#ddaa00',
            capital: 0, // no capital — capitalBurgId should be null
            culture: 2,
          },
        ],
        cells: [], // not used by the current parser
      },
      biomesData: {
        i: [0, 1, 2, 3],
        name: ['Marine', 'Hot desert', 'Grassland', 'Tropical forest'],
        color: ['#466eab', '#fbe79f', '#c8d68f', '#b6d95d'],
      },
    };
  },
};
