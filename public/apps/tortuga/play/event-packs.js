(function () {
  'use strict';

  window.Tortuga = window.Tortuga || {};
  var T = window.Tortuga;

  // ── Event catalog ────────────────────────────────────────────
  //
  // Each event object:
  //   id         {string}    unique identifier
  //   type       {string}    'storm' | 'wreckage' | 'sighting'
  //   title      {string}    modal header text
  //   weight     {number}    relative draw weight
  //   narratives {string[]}  one is picked at random for flavour
  //   choices    {Array<{
  //                id:      string,
  //                label:   string,
  //                primary: bool,
  //                outcome: {
  //                  hullDmg?:  [min, max],
  //                  sailsDmg?: [min, max],
  //                  supplies?: { key: [min, max] },
  //                  gold?:     [min, max],
  //                }
  //              }>}
  //
  // Damage values are dealt amounts (positive = damage). Supply values are gains
  // (positive = gain). Ranges are inclusive. The engine resolves them at fire-time.

  T.EVENT_PACKS = [
    // ── Storms ────────────────────────────────────────────────

    {
      id: 'storm_squall',
      type: 'storm',
      title: 'Sudden Squall',
      weight: 3,
      narratives: [
        'Black clouds pile on the horizon with frightening speed. The lookout shouts "All hands!" ' +
          'before the first wave crashes over the bow.',
        'A wall of rain sweeps in from the east. Lightning splits the sky as the wind tears at the rigging.',
        'Without warning the sea turns from grey to green. The crew scramble to furl sail before the gust hits.',
      ],
      choices: [
        {
          id: 'understood',
          label: 'Ride it out',
          primary: true,
          outcome: { hullDmg: [1, 2], sailsDmg: [1, 3] },
        },
      ],
    },

    {
      id: 'storm_typhoon',
      type: 'storm',
      title: 'Tropical Typhoon',
      weight: 1,
      narratives: [
        'A full typhoon closes from the south-west. For three hours the ship is at the mercy of the sea.',
        'The barometer drops like a stone. By nightfall the flagship is fighting for her life in mountainous swells.',
      ],
      choices: [
        {
          id: 'understood',
          label: 'Hold fast',
          primary: true,
          outcome: { hullDmg: [2, 3], sailsDmg: [1, 2] },
        },
      ],
    },

    // ── Wreckage ──────────────────────────────────────────────

    {
      id: 'wreckage_merchant',
      type: 'wreckage',
      title: 'Merchant Wreck',
      weight: 3,
      narratives: [
        'A shattered hull bobs in the swell — a merchant brig, recently broken apart. ' +
          'Barrels and bales drift around her.',
        'Smoke still rises from a beached wreck on a reef ahead. The crew spot cargo floating free.',
        'Half-submerged crates mark the grave of an unlucky merchantman. ' +
          'No survivors, but her cargo endures.',
      ],
      choices: [
        {
          id: 'salvage',
          label: 'Salvage',
          primary: true,
          outcome: {
            supplies: {
              food: [1, 3],
              water: [0, 2],
              rum: [0, 2],
              repairMaterials: [0, 2],
            },
            gold: [0, 25],
          },
        },
        {
          id: 'sail_on',
          label: 'Sail On',
          primary: false,
          outcome: {},
        },
      ],
    },

    {
      id: 'wreckage_warship',
      type: 'wreckage',
      title: 'Sunken Warship',
      weight: 1,
      narratives: [
        'The cannon-pocked hull of a naval sloop lies on a sandbar. ' +
          'Powder and shot litter the shallows.',
        'A patrol frigate, caught by some terrible broadside, rests half-submerged. ' +
          'Her gun-ports are still open.',
      ],
      choices: [
        {
          id: 'salvage',
          label: 'Salvage',
          primary: true,
          outcome: {
            supplies: {
              powder: [1, 3],
              shot: [1, 3],
              repairMaterials: [0, 1],
            },
            gold: [0, 10],
          },
        },
        {
          id: 'sail_on',
          label: 'Sail On',
          primary: false,
          outcome: {},
        },
      ],
    },

    // ── Sightings ─────────────────────────────────────────────

    {
      id: 'sighting_sea_turtle',
      type: 'sighting',
      title: 'Giant Sea Turtle',
      weight: 2,
      narratives: [
        'A leatherback the size of a jolly-boat surfaces alongside the flagship, ' +
          'regarding the crew with an ancient eye before diving.',
        'The helmsman nearly puts the wheel hard over when a great shell breaks the surface ahead. ' +
          'The old hands assure the young ones it is a good omen.',
      ],
      choices: [{ id: 'dismiss', label: 'Remarkable', primary: true, outcome: {} }],
    },

    {
      id: 'sighting_ghost_ship',
      type: 'sighting',
      title: 'Ghost Ship',
      weight: 1,
      narratives: [
        'A full-rigged ship glides through the fog under all sail — no crew visible, ' +
          'no flag at her masthead. She rounds a headland and vanishes.',
        'The night watch wakes the captain: a dark vessel with no running lights crosses ' +
          "the flagship's bows without a sound.",
      ],
      choices: [{ id: 'dismiss', label: 'Unsettling', primary: true, outcome: {} }],
    },

    {
      id: 'sighting_whale_pod',
      type: 'sighting',
      title: 'Pod of Whales',
      weight: 2,
      narratives: [
        'A pod of sperm whales breaches off the starboard bow, soaking the watch with spray ' +
          'and drawing a cheer from the crew.',
        'Fins cut the water all around. The flagship picks her way through a gathering of ' +
          'giants, close enough to touch.',
      ],
      choices: [{ id: 'dismiss', label: 'Magnificent', primary: true, outcome: {} }],
    },

    {
      id: 'sighting_distant_fleet',
      type: 'sighting',
      title: 'Distant Fleet',
      weight: 2,
      narratives: [
        'A dozen sails are counted on the horizon before they disappear into haze. ' +
          'Their flag is impossible to make out.',
        'The lookout reports a column of smoke, then topgallants — a fleet, moving fast. ' +
          'They pass without incident.',
      ],
      choices: [{ id: 'dismiss', label: 'Noted', primary: true, outcome: {} }],
    },
  ];
})();
