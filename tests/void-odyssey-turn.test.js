'use strict';

/**
 * Void Odyssey Turn Integration Tests
 *
 * Tests the voidOdysseyTurn Cloud Function against the Firestore emulator
 * with mocked AI responses. Each test seeds a game state, provides a crafted
 * AI response, calls the turn function, and asserts the resulting Firestore state.
 *
 * Run: firebase emulators:exec --only firestore "cd tests && npm test -- void-odyssey-turn"
 *
 * Set VOID_ODYSSEY_LIVE_AI=true to skip the mock and call the real Gemini API
 * (requires GOOGLE_APPLICATION_CREDENTIALS).
 */

const {
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
} = require('./fixtures/void-odyssey');

// ── Firebase Admin setup (emulator) ──────────────────────────────────────────
// Must set env vars BEFORE requiring firebase-admin so it connects to emulator.
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-void-odyssey-test';

// Mock callGemini BEFORE requiring the functions module, unless live AI is requested.
const useLiveAI = process.env.VOID_ODYSSEY_LIVE_AI === 'true';
if (!useLiveAI) {
  jest.mock('../functions/gemini', () => ({
    callGemini: jest.fn(),
  }));
}

const admin = require('firebase-admin');

// Initialize a test app — the emulator ignores credentials.
if (admin.apps.length === 0) {
  admin.initializeApp({ projectId: 'demo-void-odyssey-test' });
}

const db = admin.firestore();

// Import the mocked callGemini so we can control its return values per test.
const { callGemini } = require('../functions/gemini');

// firebase-functions-test initializes the test environment for Cloud Functions.
const functionsTest = require('firebase-functions-test')(
  { projectId: 'demo-void-odyssey-test' },
  null
);
const { voidOdysseyTurn } = require('../functions/index');
const crypto = require('crypto');

// ── Helpers ──────────────────────────────────────────────────────────────────

const gameRef = () => db.collection('void_odyssey_games').doc(TEST_GAME_ID);

/**
 * Seeds a full game into Firestore: game doc, crew, star map, location, and optionally
 * items/quests/narrative log entries.
 */
async function seedGame({
  game = {},
  crew = [],
  starMap = null,
  locations = [],
  items = [],
  quests = [],
  narrativeLog = [],
  userDifficulty = null,
} = {}) {
  const ref = gameRef();
  await ref.set(makeGame(game));

  // Seed user difficulty preference if specified
  if (userDifficulty) {
    await db.collection('users').doc(TEST_USER_ID).set({ voidOdysseyDifficulty: userDifficulty });
  }

  // Default crew if none specified
  const crewDocs =
    crew.length > 0
      ? crew
      : [
          makeCrew({ id: 'crew_engineer', name: 'Kira Vasquez', role: 'engineer' }),
          makeCrew({ id: 'crew_pilot', name: 'Ren Takashi', role: 'pilot' }),
        ];
  for (const c of crewDocs) {
    await ref.collection('crew').doc(c.id).set(c);
  }

  // Star map — use default 5-system map if none specified
  const systems = starMap || makeDefaultStarMap();
  for (const sys of systems) {
    await ref.collection('star_map').doc(sys.id).set(sys);
  }

  // Locations
  const locs = locations.length > 0 ? locations : [makeLocation()];
  for (const loc of locs) {
    await ref.collection('locations').doc(loc.id).set(loc);
  }

  // Items
  for (const item of items) {
    await ref.collection('items').doc(item.id).set(item);
  }

  // Quests
  for (const quest of quests) {
    await ref.collection('quests').doc(quest.id).set(quest);
  }

  // Narrative log
  const logs =
    narrativeLog.length > 0 ? narrativeLog : [makeNarrativeLogEntry()];
  for (const entry of logs) {
    await ref.collection('narrative_log').doc(entry.id).set(entry);
  }
}

/**
 * Clears all data under the test game document (subcollections + root doc).
 */
async function clearGame() {
  const ref = gameRef();
  const subcollections = ['crew', 'star_map', 'locations', 'items', 'quests', 'narrative_log', 'entities'];
  for (const sub of subcollections) {
    const snap = await ref.collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  const docSnap = await ref.get();
  if (docSnap.exists) {
    await ref.delete();
  }
  // Clean up user cost doc
  const userRef = db.collection('users').doc(TEST_USER_ID);
  const userSnap = await userRef.get();
  if (userSnap.exists) {
    await userRef.delete();
  }
}

/**
 * Invokes voidOdysseyTurn with the given player action and returns the result.
 * Calls .run() directly since firebase-functions-test misdetects v2 onCall arity.
 */
function callTurn(playerAction = {}, { authOverride, ...dataOverrides } = {}) {
  const action = makePlayerAction(playerAction);
  return voidOdysseyTurn.run({
    data: { gameId: TEST_GAME_ID, playerAction: action, ...dataOverrides },
    auth: authOverride !== undefined
      ? authOverride
      : {
          uid: TEST_USER_ID,
          token: { apps: ['void-odyssey'], admin: false },
        },
  });
}

/**
 * Sets the mock AI response for the next callGemini invocation.
 */
function mockAiResponse(aiResponse) {
  if (useLiveAI) return;
  callGemini.mockResolvedValueOnce(aiResponse);
}

// ── Test lifecycle ───────────────────────────────────────────────────────────

beforeEach(async () => {
  await clearGame();
  if (!useLiveAI) {
    callGemini.mockReset();
  }
});

afterAll(async () => {
  await clearGame();
  functionsTest.cleanup();
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('voidOdysseyTurn', () => {
  describe('basic turn flow', () => {
    test('processes a turn with no mutations and returns expected fields', async () => {
      await seedGame();
      const aiResponse = makeAiResponse();
      mockAiResponse(aiResponse);

      const result = await callTurn();

      expect(result.narrative).toBe(aiResponse.narrative);
      expect(result.mood).toBe('calm');
      expect(result.availableActions).toHaveLength(3);
      expect(result.turnCount).toBe(2); // started at 1, incremented
      expect(result.shipStatus).toBeDefined();
      expect(result.shipStatus.hull).toBe(70);
      expect(result.shipStatus.fuel).toBe(100);
      expect(result.crewCount).toBe(2);
    });

    test('increments turn count in the game document', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());

      await callTurn();

      const snap = await gameRef().get();
      expect(snap.data().turnCount).toBe(2);
    });

    test('creates a narrative log entry', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());

      await callTurn({ input: 'Check the sensors' });

      const logSnap = await gameRef()
        .collection('narrative_log')
        .where('turnNumber', '==', 2)
        .get();
      expect(logSnap.size).toBe(1);
      const logData = logSnap.docs[0].data();
      expect(logData.playerAction.input).toBe('Check the sensors');
      expect(logData.narrative).toBeDefined();
    });
  });

  describe('ship stat mutations', () => {
    test('applies hull damage and clamps to zero', async () => {
      await seedGame({ game: { ship: { hull: 15 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'ship_stat', field: 'hull', delta: -20, reason: 'Asteroid impact' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.hull).toBe(0); // 15 - 20, clamped to 0
    });

    test('applies shield repair and clamps to max', async () => {
      await seedGame({ game: { ship: { shields: 25 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'ship_stat', field: 'shields', delta: 10, reason: 'Shield recharge' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.shields).toBe(30); // 25 + 10, clamped to shieldsMax=30
    });

    test('applies fuel consumption', async () => {
      await seedGame({ game: { ship: { fuel: 80 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'ship_stat', field: 'fuel', delta: -5, reason: 'Thruster burn' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.fuel).toBe(75);
    });

    test('applies credit changes and never goes below zero', async () => {
      await seedGame({ game: { ship: { credits: 30 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'credits', delta: -50, reason: 'Robbed by pirates' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.credits).toBe(0); // 30 - 50, clamped to 0
    });
  });

  describe('cargo mutations', () => {
    test('add_item creates item document in Firestore', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'add_item',
              item: {
                id: 'item_salvage_01',
                name: 'Salvaged Hull Plating',
                type: 'trade_goods',
                description: 'Dented but usable hull plating from a derelict.',
                cargoUnits: 10,
                quantity: 3,
                rarity: 'uncommon',
                tags: ['salvage', 'metal'],
              },
            },
          ],
        })
      );

      await callTurn();

      const itemSnap = await gameRef().collection('items').doc('item_salvage_01').get();
      expect(itemSnap.exists).toBe(true);
      const item = itemSnap.data();
      expect(item.name).toBe('Salvaged Hull Plating');
      expect(item.cargoUnits).toBe(10);
      expect(item.quantity).toBe(3);
      expect(item.rarity).toBe('uncommon');
      expect(item.location).toBe('cargo');
      expect(item.acquiredTurn).toBe(2);
    });

    test('remove_item deletes item document from Firestore', async () => {
      await seedGame({ items: [makeItem({ id: 'item_to_remove', name: 'Old Junk' })] });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [{ type: 'remove_item', itemId: 'item_to_remove' }],
        })
      );

      await callTurn();

      const itemSnap = await gameRef().collection('items').doc('item_to_remove').get();
      expect(itemSnap.exists).toBe(false);
    });
  });

  describe('crew mutations', () => {
    test('crew_morale updates crew morale field', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'crew_morale', crewId: 'crew_engineer', value: 'inspired', reason: 'Successful repair' },
          ],
        })
      );

      await callTurn();

      const crewSnap = await gameRef().collection('crew').doc('crew_engineer').get();
      expect(crewSnap.data().morale).toBe('inspired');
    });

    test('crew_health updates crew health status', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'crew_health', crewId: 'crew_pilot', value: 'minor_injury', reason: 'Hit by debris' },
          ],
        })
      );

      await callTurn();

      const crewSnap = await gameRef().collection('crew').doc('crew_pilot').get();
      expect(crewSnap.data().healthStatus).toBe('minor_injury');
    });

    test('crew_departure marks crew as departed and decrements count', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'crew_departure', crewId: 'crew_pilot', reason: 'Left at the station' },
          ],
        })
      );

      const result = await callTurn();

      const crewSnap = await gameRef().collection('crew').doc('crew_pilot').get();
      expect(crewSnap.data().status).toBe('departed');
      expect(crewSnap.data().departureReason).toBe('Left at the station');
      expect(crewSnap.data().departedOnTurn).toBe(2);
      // crewCount is computed from active crew query at the end
      expect(result.crewCount).toBe(1);
    });

    test('crew_relationship sets relationship between two crew members', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'crew_relationship',
              crewId: 'crew_engineer',
              targetCrewId: 'crew_pilot',
              disposition: 'friendly',
              notes: 'Bonded over engine repairs',
            },
          ],
        })
      );

      await callTurn();

      const crewSnap = await gameRef().collection('crew').doc('crew_engineer').get();
      const data = crewSnap.data();
      // NOTE: set() with merge stores dot-notation keys as literal field names,
      // so the field is "relationships.crew_pilot" (a flat key), not nested.
      // This is a known quirk — update() would interpret dots as paths, but set() does not.
      const rel = data['relationships.crew_pilot'];
      expect(rel).toBeDefined();
      expect(rel.disposition).toBe('friendly');
      expect(rel.notes).toBe('Bonded over engine repairs');
    });

    test('crew_significant_moment adds a moment to the crew member', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'crew_significant_moment',
              crewId: 'crew_engineer',
              summary: 'Saved the ship from an engine meltdown',
            },
          ],
        })
      );

      await callTurn();

      const crewSnap = await gameRef().collection('crew').doc('crew_engineer').get();
      const moments = crewSnap.data().significantMoments;
      expect(moments.length).toBeGreaterThanOrEqual(1);
      const latest = moments.find((m) => m.turnNumber === 2);
      expect(latest).toBeDefined();
      expect(latest.summary).toBe('Saved the ship from an engine meltdown');
    });
  });

  describe('location mutations', () => {
    test('location_discover creates a new location document', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'location_discover',
              location: {
                id: 'loc_new_station',
                name: 'Phantom Dock',
                type: 'station',
                description: 'A hidden refueling station.',
                atmosphere: 'eerie',
              },
            },
          ],
        })
      );

      await callTurn();

      const locSnap = await gameRef().collection('locations').doc('loc_new_station').get();
      expect(locSnap.exists).toBe(true);
      const loc = locSnap.data();
      expect(loc.name).toBe('Phantom Dock');
      expect(loc.type).toBe('station');
      expect(loc.discovered).toBe(true);
    });

    test('location_update adds a point of interest to existing location', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'location_update',
              locationId: 'loc_start',
              pointOfInterest: {
                id: 'poi_market',
                name: 'Black Market',
                description: 'Hidden behind the cantina.',
                type: 'commerce',
              },
              significantEvent: 'A hidden market was discovered.',
            },
          ],
        })
      );

      await callTurn();

      const locSnap = await gameRef().collection('locations').doc('loc_start').get();
      const loc = locSnap.data();
      expect(loc.pointsOfInterest).toBeDefined();
      const poi = loc.pointsOfInterest.find((p) => p.id === 'poi_market');
      expect(poi).toBeDefined();
      expect(poi.name).toBe('Black Market');
      expect(loc.significantEvents).toBeDefined();
      expect(loc.significantEvents.some((e) => e.summary === 'A hidden market was discovered.')).toBe(true);
    });

    test('navigation action with location_discover updates game location', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'location_discover',
              location: {
                id: 'loc_nav_target',
                name: 'Orbital Platform Zeta',
                type: 'station',
                description: 'A military observation post.',
                atmosphere: 'tense',
              },
            },
          ],
        })
      );

      // Use navigation action type to trigger location update on game doc
      await callTurn({ type: 'navigation', input: 'Dock at the orbital platform' });

      const snap = await gameRef().get();
      const game = snap.data();
      expect(game.currentLocationName).toBe('Orbital Platform Zeta');
      expect(game.ship.currentLocationId).toBe('loc_nav_target');
    });
  });

  describe('travel mutations', () => {
    test('travel to connected system deducts fuel and updates position', async () => {
      await seedGame({ game: { ship: { fuel: 80 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'travel', targetSystemId: 'sys_near_1', fuelCost: 12, reason: 'FTL jump' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.fuel).toBe(68); // 80 - 12
      expect(result.currentSystemId).toBe('sys_near_1');

      // Target system should be marked as visited
      const sysSnap = await gameRef().collection('star_map').doc('sys_near_1').get();
      expect(sysSnap.data().visited).toBe(true);
    });

    test('travel to disconnected system is skipped', async () => {
      await seedGame({ game: { ship: { fuel: 80 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'travel', targetSystemId: 'sys_far_1', fuelCost: 10, reason: 'Long jump' },
          ],
        })
      );

      const result = await callTurn();

      // sys_far_1 is NOT connected to sys_origin, so travel should be skipped
      expect(result.shipStatus.fuel).toBe(80); // unchanged
      expect(result.currentSystemId).toBe('sys_origin'); // unchanged
    });

    test('travel with insufficient fuel is skipped', async () => {
      await seedGame({ game: { ship: { fuel: 5 } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'travel', targetSystemId: 'sys_near_1', fuelCost: 12, reason: 'FTL jump' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.shipStatus.fuel).toBe(5); // unchanged
      expect(result.currentSystemId).toBe('sys_origin'); // unchanged
    });
  });

  describe('combat mutations', () => {
    test('combat_start sets combatActive and enemy', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          mood: 'combat',
          stateMutations: [
            {
              type: 'combat_start',
              enemyName: 'Pirate Corvette',
              enemyType: 'ship',
              threatLevel: 'moderate',
            },
          ],
        })
      );

      const result = await callTurn();

      expect(result.combatActive).toBe(true);
      const snap = await gameRef().get();
      const game = snap.data();
      expect(game.combatEnemy.name).toBe('Pirate Corvette');
      expect(game.combatEnemy.threatLevel).toBe('moderate');
    });

    test('combat_end clears combatActive', async () => {
      await seedGame({ game: { combatActive: true, combatEnemy: { name: 'Raider', type: 'ship', threatLevel: 'minor' } } });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'combat_end', outcome: 'victory', summary: 'The raider was destroyed.' },
          ],
        })
      );

      const result = await callTurn();

      expect(result.combatActive).toBe(false);
    });

    test('weapon_status updates a weapon in the ship weapons array', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'weapon_status', weaponId: 'w1', status: 'damaged', reason: 'Overheated in combat' },
          ],
        })
      );

      const result = await callTurn();

      const snap = await gameRef().get();
      const weapons = snap.data().ship.weapons;
      const w1 = weapons.find((w) => w.id === 'w1');
      expect(w1.status).toBe('damaged');

      // result.shipStatus.weapons must reflect the updated status so the UI
      // can update labels without a page reload
      const resultW1 = result.shipStatus.weapons.find((w) => w.id === 'w1');
      expect(resultW1).toBeDefined();
      expect(resultW1.status).toBe('damaged');
    });

    test('system_status updates a system in the ship systems array', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'system_status', systemId: 's1', status: 'damaged', reason: 'Power surge' },
          ],
        })
      );

      const result = await callTurn();

      const snap = await gameRef().get();
      const systems = snap.data().ship.systems;
      const s1 = systems.find((s) => s.id === 's1');
      expect(s1.status).toBe('damaged');

      // result.shipStatus.systems must reflect the updated status so the UI
      // can update labels without a page reload
      const resultS1 = result.shipStatus.systems.find((s) => s.id === 's1');
      expect(resultS1).toBeDefined();
      expect(resultS1.status).toBe('damaged');
    });
  });

  describe('quest mutations', () => {
    test('quest_start creates a new quest document', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'quest_start',
              quest: {
                id: 'quest_rescue',
                name: 'Distress Signal',
                description: 'A faint distress signal from a nearby moon.',
                type: 'side',
                objectives: [
                  { id: 'obj_investigate', description: 'Investigate the signal source' },
                  { id: 'obj_rescue', description: 'Rescue the survivors' },
                ],
                hooks: ['The signal pattern is military-grade'],
                secrets: ['The survivors are not who they claim to be'],
              },
            },
          ],
        })
      );

      await callTurn();

      const questSnap = await gameRef().collection('quests').doc('quest_rescue').get();
      expect(questSnap.exists).toBe(true);
      const quest = questSnap.data();
      expect(quest.name).toBe('Distress Signal');
      expect(quest.status).toBe('active');
      expect(quest.objectives).toHaveLength(2);
      expect(quest.objectives[0].status).toBe('active');
      expect(quest.currentObjectiveId).toBe('obj_investigate');
      expect(quest.hooks).toContain('The signal pattern is military-grade');

      // Game doc should have incremented activeQuestCount
      const gameSnap = await gameRef().get();
      expect(gameSnap.data().activeQuestCount).toBe(1);
    });

    test('quest_update completes a quest and decrements active count', async () => {
      await seedGame({
        game: { activeQuestCount: 1 },
        quests: [makeQuest({ id: 'quest_active', status: 'active' })],
      });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            { type: 'quest_update', questId: 'quest_active', status: 'completed' },
          ],
        })
      );

      await callTurn();

      const questSnap = await gameRef().collection('quests').doc('quest_active').get();
      expect(questSnap.data().status).toBe('completed');
      expect(questSnap.data().completedOnTurn).toBe(2);

      const gameSnap = await gameRef().get();
      expect(gameSnap.data().activeQuestCount).toBe(0);
    });

    test('quest_update advances objective status', async () => {
      const quest = makeQuest({
        id: 'quest_multi',
        objectives: [
          { id: 'obj_1', description: 'Find the clue', status: 'active', completedOnTurn: null },
          { id: 'obj_2', description: 'Follow up', status: 'active', completedOnTurn: null },
        ],
        currentObjectiveId: 'obj_1',
      });
      await seedGame({ game: { activeQuestCount: 1 }, quests: [quest] });
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'quest_update',
              questId: 'quest_multi',
              objectiveId: 'obj_1',
              objectiveStatus: 'completed',
            },
          ],
        })
      );

      await callTurn();

      const questSnap = await gameRef().collection('quests').doc('quest_multi').get();
      const objectives = questSnap.data().objectives;
      expect(objectives.find((o) => o.id === 'obj_1').status).toBe('completed');
      expect(questSnap.data().currentObjectiveId).toBe('obj_2');
    });
  });

  describe('star map mutations', () => {
    test('star_map_discover creates a new system with reverse connections', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'star_map_discover',
              system: {
                id: 'sys_new',
                name: 'Nebula Outpost',
                type: 'system',
                coordinates: { x: 50, y: 50 },
                connections: [{ targetId: 'sys_origin', distance: 15, hazards: [] }],
                dangerLevel: 'cautious',
                faction: null,
                hasServices: true,
                rumors: ['Strange signals emanate from the nebula'],
              },
            },
          ],
        })
      );

      await callTurn();

      const newSysSnap = await gameRef().collection('star_map').doc('sys_new').get();
      expect(newSysSnap.exists).toBe(true);
      expect(newSysSnap.data().name).toBe('Nebula Outpost');
      expect(newSysSnap.data().discovered).toBe(true);
      expect(newSysSnap.data().visited).toBe(false);

      // Reverse connection should be added to sys_origin
      const originSnap = await gameRef().collection('star_map').doc('sys_origin').get();
      const originConns = originSnap.data().connections;
      expect(originConns.some((c) => c.targetId === 'sys_new')).toBe(true);
    });

    test('star_map_update updates scan level and rumors', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          stateMutations: [
            {
              type: 'star_map_update',
              systemId: 'sys_near_1',
              scanLevel: 'detailed',
              rumors: ['A hidden pirate base operates nearby'],
            },
          ],
        })
      );

      await callTurn();

      const sysSnap = await gameRef().collection('star_map').doc('sys_near_1').get();
      expect(sysSnap.data().scanLevel).toBe('detailed');
      expect(sysSnap.data().rumors).toContain('A hidden pirate base operates nearby');
    });
  });

  describe('entity creation', () => {
    test('newEntities creates entity documents in Firestore', async () => {
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          newEntities: [
            {
              id: 'npc_trader',
              type: 'npc',
              name: 'Zara the Merchant',
              description: 'A shrewd trader with cybernetic eyes.',
              species: 'human',
              role: 'trader',
              disposition: 'friendly',
              dialogue_style: 'fast-talking',
              tags: ['merchant', 'cybernetic'],
            },
          ],
        })
      );

      await callTurn();

      const entitySnap = await gameRef().collection('entities').doc('npc_trader').get();
      expect(entitySnap.exists).toBe(true);
      const entity = entitySnap.data();
      expect(entity.name).toBe('Zara the Merchant');
      expect(entity.type).toBe('npc');
      expect(entity.disposition).toBe('friendly');
      expect(entity.metOnTurn).toBe(2);
    });
  });

  describe('combined mutations', () => {
    test('multiple mutation types in a single turn all apply correctly', async () => {
      await seedGame({ game: { ship: { fuel: 90, credits: 200 } } });
      mockAiResponse(
        makeAiResponse({
          mood: 'tense',
          stateMutations: [
            { type: 'ship_stat', field: 'fuel', delta: -3, reason: 'Docking maneuvers' },
            { type: 'credits', delta: -75, reason: 'Docking fee' },
            {
              type: 'add_item',
              item: {
                id: 'item_repair_kit',
                name: 'Emergency Repair Kit',
                type: 'consumable',
                description: 'Patches hull breaches.',
                cargoUnits: 2,
                quantity: 1,
                rarity: 'common',
              },
            },
            { type: 'crew_morale', crewId: 'crew_engineer', value: 'content', reason: 'Happy to dock' },
          ],
          newEntities: [
            {
              id: 'npc_dockmaster',
              type: 'npc',
              name: 'Dockmaster Orin',
              description: 'Gruff station official.',
              species: 'human',
              role: 'official',
              disposition: 'neutral',
              tags: ['station'],
            },
          ],
        })
      );

      const result = await callTurn();

      // Ship stats
      expect(result.shipStatus.fuel).toBe(87); // 90 - 3
      expect(result.shipStatus.credits).toBe(125); // 200 - 75

      // Item created
      const itemSnap = await gameRef().collection('items').doc('item_repair_kit').get();
      expect(itemSnap.exists).toBe(true);

      // Crew morale updated
      const crewSnap = await gameRef().collection('crew').doc('crew_engineer').get();
      expect(crewSnap.data().morale).toBe('content');

      // Entity created
      const entitySnap = await gameRef().collection('entities').doc('npc_dockmaster').get();
      expect(entitySnap.exists).toBe(true);
    });
  });

  describe('validation and edge cases', () => {
    test('rejects unauthenticated requests', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());

      await expect(
        callTurn({}, { authOverride: null })
      ).rejects.toThrow(/signed in/i);
    });

    test('rejects requests without void-odyssey app claim', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());

      await expect(
        callTurn({}, { authOverride: { uid: TEST_USER_ID, token: { apps: ['symposium'] } } })
      ).rejects.toThrow(/access/i);
    });

    test('rejects requests for a non-existent game', async () => {
      // Don't seed any game
      mockAiResponse(makeAiResponse());

      await expect(callTurn()).rejects.toThrow(/not found/i);
    });

    test('rejects requests for another user\'s game', async () => {
      await seedGame({ game: { userId: 'other-user' } });
      mockAiResponse(makeAiResponse());

      await expect(callTurn()).rejects.toThrow(/not your game/i);
    });

    test('rejects requests for an ended game', async () => {
      await seedGame({ game: { status: 'ended' } });
      mockAiResponse(makeAiResponse());

      await expect(callTurn()).rejects.toThrow(/no longer active/i);
    });
  });

  describe('AI cost tracking', () => {
    test('increments voidOdysseyCost for the user after a successful turn', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());

      await callTurn();

      const userSnap = await db.collection('users').doc(TEST_USER_ID).get();
      expect(userSnap.exists).toBe(true);
      expect(userSnap.data().voidOdysseyCost).toBeCloseTo(0.01, 4);
    });

    test('accumulates cost across multiple turns', async () => {
      await seedGame();
      mockAiResponse(makeAiResponse());
      await callTurn();
      mockAiResponse(makeAiResponse());
      await callTurn();

      const userSnap = await db.collection('users').doc(TEST_USER_ID).get();
      expect(userSnap.data().voidOdysseyCost).toBeCloseTo(0.02, 4);
    });

    test('does not create a cost doc when auth is rejected', async () => {
      mockAiResponse(makeAiResponse());

      await expect(
        callTurn({}, { authOverride: null })
      ).rejects.toThrow();

      const userSnap = await db.collection('users').doc(TEST_USER_ID).get();
      expect(userSnap.exists).toBe(false);
    });

    test('does not increment cost when the game is not found', async () => {
      // No game seeded — turn will fail before reaching the cost write
      mockAiResponse(makeAiResponse());

      await expect(callTurn()).rejects.toThrow(/not found/i);

      const userSnap = await db.collection('users').doc(TEST_USER_ID).get();
      expect(userSnap.exists).toBe(false);
    });
  });

  describe('dice roll system', () => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    test('returns rollInterpretation in the response', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(14);
      await seedGame();
      mockAiResponse(makeAiResponse());

      const result = await callTurn();

      expect(result.rollInterpretation).toBeDefined();
      expect(result.rollInterpretation.naturalRoll).toBe(14);
      expect(typeof result.rollInterpretation.success).toBe('boolean');
      expect(typeof result.rollInterpretation.finalResult).toBe('number');
      expect(typeof result.rollInterpretation.difficultyClass).toBe('number');
    });

    test('critical success (nat 20) forces success regardless of DC', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(20);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            actionRoll: 20,
            modifierFormula: '',
            totalModifier: 0,
            finalResult: 20,
            difficultyClass: 30,
            difficultyRationale: 'Absurd action',
            success: false, // AI says failure — server must override
            isCritical: true,
            criticalType: 'success',
            savingThrow: null,
            narrativeSummary: 'Against all odds...',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.naturalRoll).toBe(20);
      expect(result.rollInterpretation.success).toBe(true);
      expect(result.rollInterpretation.isCritical).toBe(true);
      expect(result.rollInterpretation.criticalType).toBe('success');
    });

    test('critical failure (nat 1) forces failure regardless of modifiers', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(1);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            actionRoll: 1,
            modifierFormula: '+10 (god mode)',
            totalModifier: 10,
            finalResult: 11,
            difficultyClass: 5,
            difficultyRationale: 'Trivial action',
            success: true, // AI says success — server must override
            isCritical: true,
            criticalType: 'failure',
            savingThrow: null,
            narrativeSummary: 'Complete disaster.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.naturalRoll).toBe(1);
      expect(result.rollInterpretation.success).toBe(false);
      expect(result.rollInterpretation.isCritical).toBe(true);
      expect(result.rollInterpretation.criticalType).toBe('failure');
    });

    test('server recomputes success from DC and modifiers', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(5);
      await seedGame({ userDifficulty: 'hard' }); // difficultyModifier = 0
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            actionRoll: 5,
            modifierFormula: '+1 (pilot)',
            totalModifier: 1,
            finalResult: 6,
            difficultyClass: 15,
            difficultyRationale: 'Hard maneuver',
            success: true, // AI lies — 5 + 1 + 0 = 6 < DC 15
            isCritical: false,
            criticalType: null,
            savingThrow: null,
            narrativeSummary: 'Not quite enough.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.naturalRoll).toBe(5);
      expect(result.rollInterpretation.finalResult).toBe(6); // 5 + 1 + 0
      expect(result.rollInterpretation.success).toBe(false); // server overrides AI
    });

    test('saving throw uses server-generated roll value', async () => {
      // First call returns action roll, second returns saving throw roll
      jest.spyOn(crypto, 'randomInt').mockReturnValueOnce(15).mockReturnValueOnce(8);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            actionRoll: 15,
            modifierFormula: '+2 (silver-tongued)',
            totalModifier: 2,
            finalResult: 19,
            difficultyClass: 12,
            difficultyRationale: 'Standard persuasion',
            success: true,
            isCritical: false,
            criticalType: null,
            savingThrow: {
              applicable: true,
              targetName: 'Station Guard',
              savingRoll: 99, // AI tries to fake a high roll
              savingDC: 10,
              savingModifiers: '+1 (disciplined)',
              savingResult: true,
            },
            narrativeSummary: 'Your words find their mark.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.savingThrow).toBeDefined();
      expect(result.rollInterpretation.savingThrow.savingRoll).toBe(8); // server value, not 99
      expect(result.rollInterpretation.savingThrow.savingResult).toBe(false); // 8 < DC 10
    });

    test('difficulty modifier applied correctly for hardest', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(10);
      await seedGame({ userDifficulty: 'hardest' });
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            actionRoll: 10,
            modifierFormula: '',
            totalModifier: 0,
            finalResult: 8,
            difficultyClass: 10,
            difficultyRationale: 'Standard action',
            success: false,
            isCritical: false,
            criticalType: null,
            savingThrow: null,
            narrativeSummary: 'The void is unforgiving.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.difficultyModifier).toBe(-2);
      expect(result.rollInterpretation.finalResult).toBe(8); // 10 + 0 + (-2)
      expect(result.rollInterpretation.success).toBe(false); // 8 < DC 10
    });

    test('rollInterpretation is stored in narrative log', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(14);
      await seedGame();
      mockAiResponse(makeAiResponse());

      await callTurn();

      const logSnap = await gameRef()
        .collection('narrative_log')
        .orderBy('turnNumber', 'desc')
        .limit(1)
        .get();
      expect(logSnap.empty).toBe(false);
      const logData = logSnap.docs[0].data();
      expect(logData.rollInterpretation).toBeDefined();
      expect(logData.rollInterpretation.naturalRoll).toBe(14);
    });

    test('fallback rollInterpretation when AI omits it', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(12);
      await seedGame();
      const response = makeAiResponse();
      delete response.rollInterpretation;
      mockAiResponse(response);

      const result = await callTurn();

      expect(result.rollInterpretation).toBeDefined();
      expect(result.rollInterpretation.naturalRoll).toBe(12);
      expect(result.rollInterpretation.difficultyClass).toBe(10); // default DC
    });

    test('skipRoll with DC <= 5 forces success even on natural 1', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(1);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            skipRoll: true,
            actionRoll: 1,
            modifierFormula: '',
            totalModifier: 0,
            finalResult: 1,
            difficultyClass: 3,
            difficultyRationale: 'Automatic — no roll needed',
            success: true,
            isCritical: false,
            criticalType: null,
            savingThrow: null,
            narrativeSummary: 'You look around the room.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.skipRoll).toBe(true);
      expect(result.rollInterpretation.success).toBe(true);
      expect(result.rollInterpretation.naturalRoll).toBeNull();
      expect(result.rollInterpretation.isCritical).toBe(false);
      expect(result.rollInterpretation.criticalType).toBeNull();
    });

    test('skipRoll is ignored when DC > 5 (safety rail)', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(1);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            skipRoll: true,
            actionRoll: 1,
            modifierFormula: '+1 (hacking tools)',
            totalModifier: 1,
            finalResult: 2,
            difficultyClass: 12,
            difficultyRationale: 'Hacking a terminal',
            success: true,
            isCritical: true,
            criticalType: 'failure',
            savingThrow: null,
            narrativeSummary: 'The hack fails spectacularly.',
          },
        })
      );

      const result = await callTurn();

      expect(result.rollInterpretation.skipRoll).toBe(false);
      expect(result.rollInterpretation.success).toBe(false); // nat 1 = critical failure
      expect(result.rollInterpretation.naturalRoll).toBe(1);
      expect(result.rollInterpretation.isCritical).toBe(true);
      expect(result.rollInterpretation.criticalType).toBe('failure');
    });

    test('skipRoll flag is stored in narrative log', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(15);
      await seedGame();
      mockAiResponse(
        makeAiResponse({
          rollInterpretation: {
            skipRoll: true,
            actionRoll: 15,
            modifierFormula: '',
            totalModifier: 0,
            finalResult: 15,
            difficultyClass: 3,
            difficultyRationale: 'Automatic — no roll needed',
            success: true,
            isCritical: false,
            criticalType: null,
            savingThrow: null,
            narrativeSummary: 'You check your cargo hold.',
          },
        })
      );

      await callTurn();

      const logSnap = await gameRef()
        .collection('narrative_log')
        .orderBy('turnNumber', 'desc')
        .limit(1)
        .get();
      const logData = logSnap.docs[0].data();
      expect(logData.rollInterpretation.skipRoll).toBe(true);
      expect(logData.rollInterpretation.success).toBe(true);
      expect(logData.rollInterpretation.naturalRoll).toBeNull();
    });

    test('non-skipRoll turns remain unaffected', async () => {
      jest.spyOn(crypto, 'randomInt').mockReturnValue(14);
      await seedGame();
      mockAiResponse(makeAiResponse());

      const result = await callTurn();

      expect(result.rollInterpretation.skipRoll).toBe(false);
      expect(result.rollInterpretation.naturalRoll).toBe(14);
      expect(typeof result.rollInterpretation.success).toBe('boolean');
    });
  });

  describe('system prompt assembly', () => {
    // These tests rely on inspecting the mocked callGemini call args.
    const skipIfLive = useLiveAI ? test.skip : test;

    skipIfLive('appends journey directives to the system prompt', async () => {
      await seedGame({
        game: {
          journey: {
            id: 'warpath',
            name: 'Warpath',
            tone: 'grim_military',
            dangerLevel: 'high',
            themes: ['war'],
            narrativeDirectives: [
              'Combat has consequences — every shot matters',
              'Honor the chain of command',
            ],
          },
        },
      });
      mockAiResponse(makeAiResponse());

      await callTurn();

      const args = callGemini.mock.calls[0][0];
      expect(args.systemInstruction).toContain('## Campaign Journey: Warpath');
      expect(args.systemInstruction).toContain('Tone: grim_military');
      expect(args.systemInstruction).toContain('Danger Level: high');
      expect(args.systemInstruction).toContain('- Combat has consequences — every shot matters');
      expect(args.systemInstruction).toContain('- Honor the chain of command');
    });

    skipIfLive('legacy game without journey gets unchanged base prompt', async () => {
      await seedGame({ game: { journey: null } });
      mockAiResponse(makeAiResponse());

      await callTurn();

      const args = callGemini.mock.calls[0][0];
      expect(args.systemInstruction).not.toContain('## Campaign Journey');
      expect(args.systemInstruction).not.toContain('Player role:');
    });

    skipIfLive("ship's company games inject player role into the system prompt", async () => {
      await seedGame({
        game: {
          difficulty: 'ships_company',
          journey: {
            id: 'ships_company',
            name: "Ship's Company",
            tone: 'intimate_and_massive',
            dangerLevel: 'high_scoped',
            themes: ['chain_of_command'],
            narrativeDirectives: ['Filter events through the role lens'],
          },
          character: {
            name: 'Lt. Test',
            role: 'fighter_pilot',
            traits: ['resourceful'],
            stats: { physique: 50, agility: 60, intellect: 60, presence: 50 },
            condition: { health: 100, healthMax: 100, stress: 0, statusEffects: [] },
            notes: '',
            skills: { piloting: 3, gunnery: 2 },
          },
        },
      });
      mockAiResponse(makeAiResponse());

      await callTurn();

      const args = callGemini.mock.calls[0][0];
      expect(args.systemInstruction).toContain('Player role: fighter_pilot');
      expect(args.systemInstruction).toContain(
        'Filter all events, conversations, and access through the lens of this role.'
      );
    });

    skipIfLive('captain skills are included in the player context', async () => {
      await seedGame({
        game: {
          character: {
            name: 'Captain Test',
            role: 'captain',
            traits: ['resourceful'],
            stats: { physique: 50, agility: 60, intellect: 60, presence: 50 },
            condition: { health: 100, healthMax: 100, stress: 0, statusEffects: [] },
            notes: '',
            skills: { piloting: 3, diplomacy: 2 },
          },
        },
      });
      mockAiResponse(makeAiResponse());

      await callTurn();

      const args = callGemini.mock.calls[0][0];
      expect(args.userMessage).toContain('"skills"');
      expect(args.userMessage).toMatch(/"piloting":\s*3/);
      expect(args.userMessage).toMatch(/"diplomacy":\s*2/);
      expect(args.systemInstruction).toContain('captain skills');
    });

    skipIfLive('legacy game without character.skills falls back to empty object', async () => {
      await seedGame({
        game: {
          character: {
            name: 'Captain Legacy',
            role: 'captain',
            traits: ['resourceful'],
            stats: { physique: 50, agility: 60, intellect: 60, presence: 50 },
            condition: { health: 100, healthMax: 100, stress: 0, statusEffects: [] },
            notes: '',
            // No skills field
          },
        },
      });
      mockAiResponse(makeAiResponse());

      const result = await callTurn();

      expect(result).toBeDefined();
      const args = callGemini.mock.calls[0][0];
      expect(args.userMessage).toContain('"skills": {}');
    });
  });
});
