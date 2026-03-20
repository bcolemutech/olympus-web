(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  // ── Difficulty / tone options ──────────────────────────────
  VO.DIFFICULTIES = [
    {
      id: 'frontier_explorer',
      label: 'Frontier Explorer',
      description: 'Discovery-focused, lower danger. Chart unknown space and make first contact.',
      icon: '🔭',
    },
    {
      id: 'smugglers_run',
      label: "Smuggler's Run",
      description: 'Trade, intrigue, and moral grey areas. Every deal has a catch.',
      icon: '📦',
    },
    {
      id: 'warpath',
      label: 'Warpath',
      description: 'Combat-heavy, high stakes. Survive the void or die trying.',
      icon: '⚔️',
    },
    {
      id: 'custom',
      label: 'Custom',
      description: 'Mix and match — the narrator adapts to your style.',
      icon: '✨',
    },
  ];

  // ── Captain trait options ──────────────────────────────────
  VO.CAPTAIN_TRAITS = [
    { id: 'resourceful', label: 'Resourceful' },
    { id: 'cautious', label: 'Cautious' },
    { id: 'silver_tongued', label: 'Silver-Tongued' },
    { id: 'reckless', label: 'Reckless' },
    { id: 'honorable', label: 'Honorable' },
    { id: 'ruthless', label: 'Ruthless' },
    { id: 'curious', label: 'Curious' },
    { id: 'paranoid', label: 'Paranoid' },
    { id: 'compassionate', label: 'Compassionate' },
    { id: 'calculating', label: 'Calculating' },
    { id: 'charismatic', label: 'Charismatic' },
    { id: 'stoic', label: 'Stoic' },
  ];

  // ── Ship class definitions ─────────────────────────────────
  VO.SHIP_CLASSES = [
    {
      id: 'light_freighter',
      label: 'Light Freighter',
      description: 'The workhorse of the frontier. Plenty of cargo room, decent speed.',
      icon: '🚚',
      stats: {
        hull: 70,
        hullMax: 70,
        shields: 30,
        shieldsMax: 30,
        fuel: 100,
        cargo: 0,
        cargoMax: 80,
      },
      weapons: [
        {
          id: 'w1',
          name: 'Point-Defense Turret',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'For emergencies only.',
        },
      ],
      systems: [
        { id: 's1', name: 'FTL Drive', status: 'operational', notes: '' },
        { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
        { id: 's3', name: 'Sensors', status: 'operational', notes: 'Short-range only.' },
      ],
      features: [
        {
          id: 'f1',
          name: 'Expanded Cargo Hold',
          description: 'Extra storage at the cost of crew space.',
          functional: true,
        },
      ],
      flavor: 'High cargo capacity, moderate hull, minimal weapons.',
    },
    {
      id: 'scout_corvette',
      label: 'Scout Corvette',
      description: 'Fast and nimble. Born to explore the edges of the map.',
      icon: '🛸',
      stats: {
        hull: 55,
        hullMax: 55,
        shields: 45,
        shieldsMax: 45,
        fuel: 100,
        cargo: 0,
        cargoMax: 30,
      },
      weapons: [
        {
          id: 'w1',
          name: 'Light Plasma Cannon',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: '',
        },
      ],
      systems: [
        { id: 's1', name: 'FTL Drive', status: 'operational', notes: 'Enhanced range.' },
        { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
        { id: 's3', name: 'Long-Range Sensors', status: 'operational', notes: 'Best-in-class.' },
      ],
      features: [
        {
          id: 'f1',
          name: 'Stealth Coating',
          description: 'Reduces sensor signature.',
          functional: true,
        },
      ],
      flavor: 'Fast, great sensors, minimal cargo.',
    },
    {
      id: 'gunship',
      label: 'Gunship',
      description: 'A flying arsenal. Slow and cargo-light, but nothing touches you in a fight.',
      icon: '🔫',
      stats: {
        hull: 90,
        hullMax: 90,
        shields: 60,
        shieldsMax: 60,
        fuel: 100,
        cargo: 0,
        cargoMax: 20,
      },
      weapons: [
        {
          id: 'w1',
          name: 'Twin Plasma Cannons',
          type: 'energy',
          damage: 'heavy',
          status: 'operational',
          notes: '',
        },
        {
          id: 'w2',
          name: 'Missile Tubes',
          type: 'missile',
          damage: 'heavy',
          status: 'operational',
          notes: '12 missiles remaining.',
        },
      ],
      systems: [
        { id: 's1', name: 'FTL Drive', status: 'operational', notes: 'Military-grade.' },
        { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
        { id: 's3', name: 'Combat Sensors', status: 'operational', notes: 'Targeting optimized.' },
      ],
      features: [
        {
          id: 'f1',
          name: 'Reinforced Armor Plating',
          description: 'Additional structural integrity.',
          functional: true,
        },
      ],
      flavor: 'Heavy weapons, tough hull, slow and low cargo.',
    },
    {
      id: 'salvage_rig',
      label: 'Salvage Rig',
      description: 'A repurposed industrial vessel. Full of surprises and hidden compartments.',
      icon: '🔧',
      stats: {
        hull: 65,
        hullMax: 65,
        shields: 35,
        shieldsMax: 35,
        fuel: 100,
        cargo: 0,
        cargoMax: 60,
      },
      weapons: [
        {
          id: 'w1',
          name: 'Mining Laser (weaponized)',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: 'Jury-rigged.',
        },
      ],
      systems: [
        { id: 's1', name: 'FTL Drive', status: 'operational', notes: 'Barely certified.' },
        { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
        { id: 's3', name: 'Salvage Arm', status: 'operational', notes: 'Can retrieve debris.' },
      ],
      features: [
        {
          id: 'f1',
          name: "Smuggler's Hold",
          description: 'Hidden compartment beneath the cargo bay.',
          functional: true,
        },
        {
          id: 'f2',
          name: 'Workshop',
          description: 'Basic repair and fabrication tools.',
          functional: true,
        },
      ],
      flavor: 'Versatile, good cargo, lots of quirks.',
    },
  ];

  // ── Shared mutable state ───────────────────────────────────
  VO.state = {
    db: null,
    functions: null,
    currentUser: null,
    currentGame: null,
    currentView: 'loading',
    wizardStep: 1,
    wizardData: {
      difficulty: null,
      captainName: '',
      captainTraits: [],
      captainBackstory: '',
      shipClass: null,
      shipName: '',
    },
    // After Cloud Function returns (steps 4-5)
    generatedCrew: null,
    generatedGame: null,
    // Turn execution lock
    _turnInProgress: false,
  };

  // ── Lazy-cached DOM ref helper ─────────────────────────────
  var _refCache = {};
  VO.getRef = function (id) {
    if (!_refCache[id]) {
      _refCache[id] = document.getElementById(id);
    }
    return _refCache[id];
  };
})();
