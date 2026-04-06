'use strict';

/**
 * Test fixture factories for Void Odyssey integration tests.
 * Each factory returns a valid document with sensible defaults that can be overridden.
 */

const TEST_USER_ID = 'test-user-001';
const TEST_GAME_ID = 'test-game-001';

function makeGame(overrides = {}) {
  return {
    id: TEST_GAME_ID,
    userId: TEST_USER_ID,
    name: 'Test Campaign',
    createdAt: new Date(),
    updatedAt: new Date(),
    turnCount: 1,
    status: 'active',
    difficulty: 'frontier_explorer',
    ship: {
      name: 'The Wayfinder',
      class: 'light_freighter',
      description: 'A sturdy cargo vessel.',
      hull: 70,
      hullMax: 70,
      shields: 30,
      shieldsMax: 30,
      fuel: 100,
      cargo: 0,
      cargoMax: 80,
      credits: 500,
      currentLocationId: 'loc_start',
      currentSystemId: 'sys_origin',
      dockedAt: null,
      weapons: [
        {
          id: 'w1',
          name: 'Point-Defense Turret',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: '',
        },
      ],
      systems: [
        { id: 's1', name: 'FTL Drive', status: 'operational', notes: '' },
        { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
        { id: 's3', name: 'Sensors', status: 'operational', notes: '' },
      ],
      features: [
        {
          id: 'f1',
          name: 'Expanded Cargo Hold',
          description: 'Extra storage.',
          functional: true,
        },
      ],
    },
    journey: {
      id: 'frontier_explorer',
      name: 'Frontier Explorer',
      tone: 'wonder_discovery',
      dangerLevel: 'low_moderate',
      themes: ['exploration', 'science', 'first_contact', 'moral_dilemmas'],
      narrativeDirectives: ['Emphasize awe, scale, and the uncanny'],
    },
    character: {
      name: 'Captain Test',
      role: 'captain',
      traits: ['resourceful', 'cautious'],
      backstory: 'A test pilot.',
      stats: { physique: 50, agility: 60, intellect: 60, presence: 50 },
      condition: { health: 100, healthMax: 100, stress: 0, statusEffects: [] },
      notes: '',
      // piloting:2 (3pts) + engineering:3 (6pts) + medicine:1 (1pt) = 10pts
      skills: { piloting: 2, engineering: 3, medicine: 1 },
    },
    player: {
      name: 'Captain Test',
      title: 'Captain',
      backstory: 'A test pilot.',
      traits: ['resourceful', 'cautious'],
      reputation: {},
    },
    combatActive: false,
    combatEnemy: null,
    crewCount: 2,
    activeCrew: [
      { id: 'crew_engineer', name: 'Kira Vasquez', role: 'engineer' },
      { id: 'crew_pilot', name: 'Ren Takashi', role: 'pilot' },
    ],
    activeQuestCount: 0,
    currentLocationName: 'Haven Station',
    currentLocationTags: ['station'],
    rateLimits: {
      turnsThisHour: 0,
      hourStartTimestamp: Date.now(),
      turnsThisWeek: 0,
      weekStartTimestamp: Date.now(),
    },
    ...overrides,
    ship: { ...makeGame.defaults?.ship, ...overrides.ship },
  };
}
// Store defaults for nested merge support
makeGame.defaults = {
  ship: {
    name: 'The Wayfinder',
    class: 'light_freighter',
    description: 'A sturdy cargo vessel.',
    hull: 70,
    hullMax: 70,
    shields: 30,
    shieldsMax: 30,
    fuel: 100,
    cargo: 0,
    cargoMax: 80,
    credits: 500,
    currentLocationId: 'loc_start',
    currentSystemId: 'sys_origin',
    dockedAt: null,
    weapons: [
      {
        id: 'w1',
        name: 'Point-Defense Turret',
        type: 'energy',
        damage: 'light',
        status: 'operational',
        notes: '',
      },
    ],
    systems: [
      { id: 's1', name: 'FTL Drive', status: 'operational', notes: '' },
      { id: 's2', name: 'Life Support', status: 'operational', notes: '' },
      { id: 's3', name: 'Sensors', status: 'operational', notes: '' },
    ],
    features: [
      {
        id: 'f1',
        name: 'Expanded Cargo Hold',
        description: 'Extra storage.',
        functional: true,
      },
    ],
  },
};

function makeCrew(overrides = {}) {
  return {
    id: overrides.id || 'crew_test',
    name: 'Test Crew Member',
    role: 'general',
    species: 'human',
    status: 'active',
    backstory: 'A reliable crew member.',
    personality: ['calm', 'loyal'],
    skills: ['repair'],
    quirks: [],
    portraitDescription: '',
    morale: 'content',
    loyalty: 50,
    healthStatus: 'healthy',
    currentAssignment: null,
    relationships: {},
    significantMoments: [],
    joinedTurn: 0,
    departureReason: null,
    departedOnTurn: null,
    tags: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeStarMapSystem(overrides = {}) {
  return {
    id: overrides.id || 'sys_origin',
    name: 'Origin System',
    type: 'system',
    coordinates: { x: 0, y: 0 },
    connections: [
      { targetId: 'sys_near_1', distance: 12, hazards: [], known: true },
    ],
    discovered: true,
    visited: true,
    scanLevel: 'detailed',
    locationCount: 1,
    dangerLevel: 'cautious',
    faction: null,
    hasServices: true,
    rumors: [],
    signalStrength: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeLocation(overrides = {}) {
  return {
    id: overrides.id || 'loc_start',
    name: 'Haven Station',
    type: 'station',
    description: 'A bustling trade hub.',
    firstImpressions: 'Lights and noise.',
    atmosphere: 'busy',
    environment: {
      gravity: 'standard',
      atmosphere: 'breathable',
      temperature: 'temperate',
      hazards: [],
    },
    dockable: true,
    services: ['refuel', 'repair', 'trade'],
    residentEntityIds: [],
    pointsOfInterest: [],
    parentLocationId: null,
    connectedLocationIds: [],
    distanceFromCurrent: null,
    coordinates: { x: 0, y: 0, z: null },
    visitCount: 1,
    firstVisitedTurn: 0,
    lastVisitedTurn: 1,
    significantEvents: [],
    tags: ['station'],
    faction: null,
    dangerLevel: 'safe',
    discovered: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeItem(overrides = {}) {
  return {
    id: overrides.id || 'item_test',
    name: 'Test Cargo',
    type: 'trade_goods',
    description: 'A crate of goods.',
    shortDescription: 'Trade goods.',
    cargoUnits: 5,
    quantity: 1,
    condition: 'good',
    baseValue: 50,
    rarity: 'common',
    location: 'cargo',
    acquiredTurn: 1,
    acquiredFrom: 'Haven Station',
    questRelated: false,
    questId: null,
    tags: [],
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeQuest(overrides = {}) {
  return {
    id: overrides.id || 'quest_test',
    name: 'Test Quest',
    description: 'A quest for testing.',
    type: 'side',
    status: 'active',
    givenBy: null,
    givenOnTurn: 1,
    locationId: 'loc_start',
    objectives: [
      { id: 'obj_1', description: 'Complete the objective', status: 'active', completedOnTurn: null },
    ],
    currentObjectiveId: 'obj_1',
    rewards: null,
    consequences: null,
    completedOnTurn: null,
    relatedEntityIds: [],
    relatedLocationIds: [],
    relatedItemIds: [],
    relatedQuestIds: [],
    hooks: ['A mysterious lead'],
    secrets: ['Hidden truth'],
    tags: ['side'],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeNarrativeLogEntry(overrides = {}) {
  return {
    id: overrides.id || 'log_test',
    turnNumber: 1,
    timestamp: new Date(),
    playerAction: { type: 'freeform', actionId: null, input: 'Look around' },
    narrative: 'You look around the station.',
    mood: 'calm',
    stateMutations: [],
    newEntityIds: [],
    locationId: 'loc_start',
    summary: 'Player looked around.',
    tags: ['freeform', 'calm'],
    availableActions: [
      { id: 'act_1', label: 'Explore the market', type: 'investigation' },
      { id: 'act_2', label: 'Talk to the bartender', type: 'dialogue' },
      { id: 'act_3', label: 'Head to the docks', type: 'navigation' },
    ],
    compressed: false,
    ...overrides,
  };
}

/**
 * Builds a minimal valid AI response for the turn function.
 * Override stateMutations, newEntities, etc. to test specific scenarios.
 */
function makeAiResponse(overrides = {}) {
  return {
    narrative: overrides.narrative || 'The hum of the station fills the corridor as you step forward.',
    mood: overrides.mood || 'calm',
    stateMutations: overrides.stateMutations || [],
    availableActions: overrides.availableActions || [
      { id: 'act_1', label: 'Investigate the signal', type: 'investigation' },
      { id: 'act_2', label: 'Talk to the trader', type: 'dialogue' },
      { id: 'act_3', label: 'Set course for Kappa', type: 'navigation' },
    ],
    newEntities: overrides.newEntities || [],
    summary: overrides.summary || 'A routine turn at the station.',
    rollInterpretation: overrides.rollInterpretation || {
      skipRoll: false,
      actionRoll: 14,
      modifierFormula: '+2 (resourceful captain)',
      totalModifier: 2,
      finalResult: 18,
      difficultyClass: 10,
      difficultyRationale: 'Routine station activity',
      success: true,
      isCritical: false,
      criticalType: null,
      savingThrow: null,
      narrativeSummary: 'A solid success with your resourceful instincts.',
    },
  };
}

/**
 * Default player action for tests.
 */
function makePlayerAction(overrides = {}) {
  return {
    type: 'freeform',
    actionId: null,
    input: 'Look around the station',
    ...overrides,
  };
}

/**
 * The default star map (5 systems) matching buildStartingStarMap in index.js.
 */
function makeDefaultStarMap() {
  return [
    makeStarMapSystem({
      id: 'sys_origin',
      name: 'Origin System',
      connections: [
        { targetId: 'sys_near_1', distance: 12, hazards: [], known: true },
        { targetId: 'sys_near_2', distance: 18, hazards: ['debris_field'], known: true },
      ],
      visited: true,
      scanLevel: 'detailed',
    }),
    makeStarMapSystem({
      id: 'sys_near_1',
      name: 'Relay Outpost Kappa',
      coordinates: { x: 35, y: -20 },
      connections: [
        { targetId: 'sys_origin', distance: 12, hazards: [], known: true },
        { targetId: 'sys_far_1', distance: 22, hazards: ['pirate_corridor'], known: false },
      ],
      visited: false,
      scanLevel: 'basic',
      rumors: ['Traders mention a salvage yard beyond the relay'],
    }),
    makeStarMapSystem({
      id: 'sys_near_2',
      name: "Drifter's Reach",
      coordinates: { x: -25, y: 30 },
      connections: [
        { targetId: 'sys_origin', distance: 18, hazards: ['debris_field'], known: true },
        { targetId: 'sys_far_2', distance: 28, hazards: [], known: false },
      ],
      visited: false,
      scanLevel: 'basic',
      hasServices: false,
    }),
    makeStarMapSystem({
      id: 'sys_far_1',
      name: 'Unknown Sector',
      coordinates: { x: 65, y: -45 },
      connections: [
        { targetId: 'sys_near_1', distance: 22, hazards: ['pirate_corridor'], known: false },
      ],
      discovered: false,
      scanLevel: 'none',
      dangerLevel: 'dangerous',
      hasServices: false,
    }),
    makeStarMapSystem({
      id: 'sys_far_2',
      name: 'Unknown Signal Source',
      type: 'anomaly',
      coordinates: { x: -55, y: 60 },
      connections: [
        { targetId: 'sys_near_2', distance: 28, hazards: [], known: false },
      ],
      discovered: false,
      scanLevel: 'none',
      dangerLevel: 'dangerous',
      hasServices: false,
    }),
  ];
}

module.exports = {
  TEST_USER_ID,
  TEST_GAME_ID,
  makeGame,
  makeCrew,
  makeStarMapSystem,
  makeLocation,
  makeItem,
  makeQuest,
  makeNarrativeLogEntry,
  makeAiResponse,
  makePlayerAction,
  makeDefaultStarMap,
};
