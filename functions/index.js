'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');
const crypto = require('crypto');
const { callGemini } = require('./gemini');

initializeApp();

// Reused across invitations to avoid per-call overhead.
const googleAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

/**
 * Validates that the caller has the admin custom claim and that the provided
 * email is a non-empty string. Throws HttpsError on any violation.
 */
function requireAdminCaller(request, email) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to call this function.');
  }
  if (!request.auth.token.admin) {
    throw new HttpsError('permission-denied', 'Only admins can perform this action.');
  }
  if (typeof email !== 'string' || email.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'A valid email address is required.');
  }
}

/**
 * Looks up a Firebase Auth user by email, mapping known error codes to
 * appropriate HttpsError types.
 */
async function getUserByEmail(email) {
  try {
    return await getAuth().getUserByEmail(email);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      throw new HttpsError('not-found', `No user found with email: ${email}`);
    }
    if (err.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'The email address is not valid.');
    }
    console.error('getUserByEmail error:', err);
    throw new HttpsError('internal', 'Failed to look up user.');
  }
}

/**
 * setAdminRole — grants admin: true to the user identified by email.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { email: string }
 * Returns: { success: true, email: string }
 *
 * Note: The target user must sign out and back in (or call
 * user.getIdToken(true)) for the new claim to appear in their ID token.
 */
exports.setAdminRole = onCall(async (request) => {
  const email = request.data && request.data.email;
  requireAdminCaller(request, email);

  const user = await getUserByEmail(email.trim());

  const existingClaims = user.customClaims || {};
  const existingApps = Array.isArray(existingClaims.apps) ? existingClaims.apps : [];
  const apps = existingApps.includes('admin') ? existingApps : [...existingApps, 'admin'];
  try {
    await getAuth().setCustomUserClaims(user.uid, { ...existingClaims, admin: true, apps });
  } catch (err) {
    console.error('setCustomUserClaims error:', err);
    throw new HttpsError('internal', 'Failed to update user claims.');
  }

  return { success: true, email: email.trim() };
});

/**
 * removeAdminRole — revokes the admin claim from the user identified by email.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { email: string }
 * Returns: { success: true, email: string }
 *
 * Note: The target user must sign out and back in (or call
 * user.getIdToken(true)) for the claim removal to take effect.
 */
exports.removeAdminRole = onCall(async (request) => {
  const email = request.data && request.data.email;
  requireAdminCaller(request, email);

  const user = await getUserByEmail(email.trim());

  const existingClaims = { ...(user.customClaims || {}) };
  delete existingClaims.admin;
  const existingApps = Array.isArray(existingClaims.apps) ? existingClaims.apps : [];
  existingClaims.apps = existingApps.filter((id) => id !== 'admin');
  try {
    await getAuth().setCustomUserClaims(user.uid, existingClaims);
  } catch (err) {
    console.error('setCustomUserClaims error:', err);
    throw new HttpsError('internal', 'Failed to update user claims.');
  }

  return { success: true, email: email.trim() };
});

/**
 * listUsers — returns a paginated list of Firebase Auth users.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { pageToken?: string, emailPrefix?: string }
 * Returns: { users: Array, nextPageToken: string | null }
 *
 * Each user object contains: uid, email, emailVerified, disabled,
 * customClaims, creationTime, lastSignInTime.
 *
 * Firebase Auth listUsers does not support server-side prefix filtering;
 * emailPrefix filtering is applied after fetching each page.
 */
exports.listUsers = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to call this function.');
  }
  if (!request.auth.token.admin) {
    throw new HttpsError('permission-denied', 'Only admins can list users.');
  }

  const { pageToken, emailPrefix } = request.data || {};
  const prefix =
    typeof emailPrefix === 'string' && emailPrefix.trim().length > 0
      ? emailPrefix.trim().toLowerCase()
      : null;

  const mapUser = (u) => ({
    uid: u.uid,
    email: u.email || '',
    emailVerified: u.emailVerified,
    disabled: u.disabled,
    customClaims: u.customClaims || {},
    creationTime: u.metadata.creationTime,
    lastSignInTime: u.metadata.lastSignInTime,
  });

  // When filtering by prefix, accumulate pages until we have at least one
  // matching user (or the user list is exhausted), so the client is never
  // shown an empty page with a dangling "Load more" button.
  const MAX_PAGES = 10;
  let users = [];
  let nextToken = pageToken || undefined;
  let pages = 0;

  do {
    let result;
    try {
      result = await getAuth().listUsers(100, nextToken);
    } catch (err) {
      console.error('listUsers error:', err);
      throw new HttpsError('internal', 'Failed to list users.');
    }

    const mapped = result.users.map(mapUser);
    users = users.concat(
      prefix ? mapped.filter((u) => u.email.toLowerCase().startsWith(prefix)) : mapped
    );
    nextToken = result.pageToken || null;
    pages++;
  } while (prefix && users.length === 0 && nextToken && pages < MAX_PAGES);

  return { users, nextPageToken: nextToken || null };
});

/**
 * manageAccess — grants, revokes, or sets app access for a user.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { email: string, action: 'grant'|'revoke'|'set', apps: string[] }
 * Returns: { apps: string[] } — the updated apps list
 *
 * Replicates the logic in scripts/manage-access.js as a callable function.
 */
exports.manageAccess = onCall(async (request) => {
  const email = request.data && request.data.email;
  requireAdminCaller(request, email);

  const { action, apps: incomingApps } = request.data || {};

  const validActions = ['grant', 'revoke', 'set'];
  if (!validActions.includes(action)) {
    throw new HttpsError('invalid-argument', `action must be one of: ${validActions.join(', ')}.`);
  }

  if (!Array.isArray(incomingApps) || incomingApps.some((a) => typeof a !== 'string')) {
    throw new HttpsError('invalid-argument', 'apps must be an array of strings.');
  }

  const newAppIds = [...new Set(incomingApps.map((a) => a.trim()).filter((a) => a.length > 0))];

  const invalidIds = newAppIds.filter((id) => !/^[A-Za-z0-9_-]+$/.test(id));
  if (invalidIds.length > 0) {
    throw new HttpsError(
      'invalid-argument',
      `Invalid app ID(s): ${invalidIds.join(', ')}. App IDs must contain only letters, numbers, underscores, or hyphens.`
    );
  }

  const user = await getUserByEmail(email.trim());
  const currentClaims = user.customClaims || {};
  let apps = Array.isArray(currentClaims.apps) ? currentClaims.apps : [];

  if (action === 'grant') {
    apps = [...new Set([...apps, ...newAppIds])];
  } else if (action === 'revoke') {
    apps = apps.filter((id) => !newAppIds.includes(id));
  } else {
    apps = newAppIds;
  }

  try {
    await getAuth().setCustomUserClaims(user.uid, { ...currentClaims, apps });
  } catch (err) {
    console.error('setCustomUserClaims error:', err);
    throw new HttpsError('internal', 'Failed to update user claims.');
  }

  return { apps };
});

/**
 * setUserDisabled — enables or disables a Firebase Auth user account.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { email: string, disabled: boolean }
 * Returns: { success: true, disabled: boolean }
 */
exports.setUserDisabled = onCall(async (request) => {
  const email = request.data && request.data.email;
  requireAdminCaller(request, email);

  const { disabled } = request.data || {};
  if (typeof disabled !== 'boolean') {
    throw new HttpsError('invalid-argument', 'disabled must be a boolean.');
  }

  const user = await getUserByEmail(email.trim());

  try {
    await getAuth().updateUser(user.uid, { disabled });
  } catch (err) {
    console.error('updateUser error:', err);
    throw new HttpsError('internal', 'Failed to update user.');
  }

  return { success: true, disabled };
});

/**
 * inviteUser — creates a new Firebase Auth user and sends a password-setup
 * email as the invitation.
 *
 * Caller must have admin: true in their custom claims.
 * Data: { email: string, initialApps?: string[] }
 * Returns: { uid: string, email: string }
 *
 * Replicates the logic in scripts/invite-user.js as a callable function.
 * Uses Application Default Credentials (available in Cloud Functions runtime)
 * to obtain an access token for the Identity Toolkit REST API.
 */
exports.inviteUser = onCall(async (request) => {
  const email = request.data && request.data.email;
  requireAdminCaller(request, email);

  const initialApps = request.data.initialApps;
  if (initialApps !== undefined && initialApps !== null) {
    if (!Array.isArray(initialApps) || initialApps.some((a) => typeof a !== 'string')) {
      throw new HttpsError('invalid-argument', 'initialApps must be an array of strings.');
    }
  }
  const apps = Array.isArray(initialApps)
    ? [...new Set(initialApps.map((a) => a.trim()).filter((a) => a.length > 0))]
    : [];

  // Step 1: Create the user (no password — they set it via the email link)
  let userRecord;
  try {
    userRecord = await getAuth().createUser({
      email: email.trim(),
      emailVerified: false,
      disabled: false,
    });
  } catch (err) {
    if (err.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', `A user with email "${email.trim()}" already exists.`);
    }
    if (err.code === 'auth/invalid-email') {
      throw new HttpsError('invalid-argument', 'The email address is not valid.');
    }
    console.error('createUser error:', err);
    throw new HttpsError('internal', 'Failed to create user.');
  }

  // Step 2: Set initial custom claims if provided
  if (apps.length > 0) {
    try {
      await getAuth().setCustomUserClaims(userRecord.uid, { apps });
    } catch (err) {
      console.error('setCustomUserClaims error:', err);
      // Non-fatal — user is created, claims just not set; clean up and surface error
      try {
        await getAuth().deleteUser(userRecord.uid);
      } catch (deleteErr) {
        console.error('Failed to clean up user after claims error:', deleteErr);
      }
      throw new HttpsError('internal', 'Failed to set initial app access.');
    }
  }

  // Step 3: Send password-reset email via Identity Toolkit REST API
  const continueUrl = process.env.APP_URL || 'https://olympus-dfa00.web.app';
  try {
    const accessToken = await googleAuth.getAccessToken();
    if (!accessToken) {
      throw new Error('Failed to obtain access token from Application Default Credentials.');
    }

    const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: email.trim(),
        continueUrl,
        returnOobLink: false,
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      throw new Error(
        `Identity Toolkit API error (${response.status}): ${body.error?.message || JSON.stringify(body)}`
      );
    }
  } catch (err) {
    console.error('sendOobCode error:', err);
    // Clean up orphaned user
    try {
      await getAuth().deleteUser(userRecord.uid);
    } catch (deleteErr) {
      console.error('Failed to clean up orphaned user:', deleteErr);
    }
    throw new HttpsError('internal', 'Failed to send invitation email.');
  }

  return { uid: userRecord.uid, email: email.trim() };
});

// ── Void Odyssey ──────────────────────────────────────────────────────────────

const VOID_ODYSSEY_MODEL = 'gemini-2.5-flash';
const VOID_ODYSSEY_COST_PER_TURN = 0.01; // USD per AI turn

// Shared allowlists used by multiple Void Odyssey callables (voidOdysseyNewGame,
// voidOdysseyGenerateBackstory, …). Keep these in one place so a new journey or
// trait added here is automatically honored across every entry point.
const VOID_ODYSSEY_JOURNEY_IDS = [
  'frontier_explorer',
  'smugglers_run',
  'warpath',
  'deep_salvage',
  'first_contact',
  'the_long_haul',
  'ships_company',
  'custom',
];

const VOID_ODYSSEY_TRAIT_IDS = [
  'resourceful',
  'cautious',
  'silver_tongued',
  'reckless',
  'honorable',
  'ruthless',
  'curious',
  'paranoid',
  'compassionate',
  'calculating',
  'charismatic',
  'stoic',
];

// Roles selectable during game creation when difficulty === 'ships_company'.
// Mirrors the roleOptions array in public/apps/void-odyssey/journeys.js. A
// drift test in tests/void-odyssey-constants.test.js asserts the two stay
// in sync.
const VOID_ODYSSEY_SHIPS_COMPANY_ROLE_IDS = [
  'fighter_pilot',
  'weapons_officer',
  'helmsman',
  'chief_engineer',
  'ships_surgeon',
  'intelligence_analyst',
  'marine_sergeant',
];

// Per-journey ship allowlist. Mirrors VO.JOURNEYS[id].availableShips in
// public/apps/void-odyssey/journeys.js. Used for server-side validation so
// modified clients cannot pair a ship with a journey it does not belong to.
// The same drift test above asserts this stays in sync with the frontend.
// `custom` is intentionally omitted — the custom journey is not yet selectable
// in the wizard (order 8, filtered out of Step 1), so no ship allowlist applies.
const VOID_ODYSSEY_JOURNEY_SHIPS = {
  frontier_explorer: ['survey_vessel', 'scout_corvette', 'light_freighter'],
  smugglers_run: ['light_freighter', 'blockade_runner', 'salvage_rig'],
  warpath: ['gunship', 'corvette_warfit', 'carrier_escort'],
  deep_salvage: ['salvage_rig', 'light_freighter', 'scout_corvette'],
  first_contact: ['survey_vessel', 'diplomatic_cruiser', 'scout_corvette'],
  the_long_haul: ['long_range_cruiser', 'light_freighter', 'survey_vessel'],
  ships_company: ['fleet_carrier', 'line_battleship', 'heavy_cruiser'],
};

const VOID_ODYSSEY_TURN_SYSTEM_PROMPT = `You are the narrator for Void Odyssey, an AI-driven space exploration game. You write in second person ("You step onto the bridge..."). The genre is hard-ish sci-fi — think Firefly meets Mass Effect: grounded crews, alien encounters, political tensions, moments of wonder.

You MUST respond with ONLY a valid JSON object. No prose outside the JSON. The schema is:
{
  "narrative": string (150-250 words, second-person, continues the story based on the player's action),
  "mood": string (one of: tense, calm, wonder, danger, tense_curiosity, wry, reverent),
  "stateMutations": [
    Allowed mutation types:
    { "type": "ship_stat", "field": "hull"|"shields"|"fuel"|"cargo", "delta": number, "reason": string }
    { "type": "crew_morale", "crewId": string, "value": "content"|"uneasy"|"fearful"|"inspired"|"defiant", "reason": string }
    { "type": "add_item", "item": { "id": string, "name": string, "type": "trade_goods"|"weapon"|"equipment"|"quest_item"|"consumable"|"data"|"artifact", "description": string, "cargoUnits": number, "quantity": number, "condition": "pristine"|"good"|"worn"|"damaged", "rarity": "common"|"uncommon"|"rare"|"unique", "tags": string[] } }
    { "type": "remove_item", "itemId": string }
    { "type": "location_discover", "location": { "id": string, "name": string, "type": "station"|"planet"|"moon"|"asteroid_field"|"derelict"|"anomaly", "description": string, "atmosphere": string } }
    { "type": "location_update", "locationId": string, "pointOfInterest": { "id": string, "name": string, "description": string, "type": string } | null, "significantEvent": string | null }
    { "type": "quest_start", "quest": { "id": string, "name": string, "description": string, "type": "main"|"side"|"crew_personal"|"faction"|"discovery", "givenBy": string | null, "objectives": [{ "id": string, "description": string }], "hooks": string[], "secrets": string[] } }
    { "type": "quest_update", "questId": string, "status": "active"|"completed"|"failed"|"abandoned" | null, "objectiveId": string | null, "objectiveStatus": "active"|"completed"|"failed" | null, "note": string }
    { "type": "star_map_discover", "system": { "id": string, "name": string, "type": "system"|"anomaly"|"hidden", "coordinates": { "x": number, "y": number }, "connections": [{ "targetId": string, "distance": number, "hazards": string[] }], "dangerLevel": "safe"|"cautious"|"dangerous"|"hostile", "faction": string | null, "hasServices": boolean, "rumors": string[] } }
    { "type": "star_map_update", "systemId": string, "scanLevel": "basic"|"detailed" | null, "rumors": string[] | null }
    { "type": "travel", "targetSystemId": string, "fuelCost": number, "reason": string }
    { "type": "credits", "delta": number, "reason": string }
    { "type": "crew_health", "crewId": string, "value": "healthy"|"minor_injury"|"serious_injury"|"critical", "reason": string }
    { "type": "crew_relationship", "crewId": string, "targetCrewId": string, "disposition": "friendly"|"neutral"|"tense"|"hostile"|"romantic"|"rivalry", "notes": string }
    { "type": "crew_significant_moment", "crewId": string, "summary": string }
    { "type": "crew_departure", "crewId": string, "reason": string }
    { "type": "combat_start", "enemyName": string, "enemyType": "ship"|"creature"|"boarding_party", "threatLevel": "minor"|"moderate"|"severe"|"overwhelming" }
    { "type": "combat_end", "outcome": "victory"|"defeat"|"escape"|"surrender", "summary": string }
    { "type": "weapon_status", "weaponId": string, "status": "operational"|"damaged"|"destroyed", "reason": string }
    { "type": "system_status", "systemId": string, "status": "operational"|"damaged"|"destroyed"|"offline", "reason": string }
  ],
  "availableActions": [
    { "id": string, "label": string (max 8 words), "type": "dialogue"|"navigation"|"combat"|"investigation" }
  ],
  "newEntities": [
    { "id": string, "type": "npc"|"ship"|"object", "name": string, "description": string, "species": string | null, "role": string | null, "disposition": "friendly"|"neutral"|"suspicious"|"hostile", "dialogue_style": string | null, "tags": string[] }
  ],
  "summary": string (one sentence summary of what happened this turn),
  "rollInterpretation": {
    "skipRoll": boolean (true ONLY for automatic/trivial actions that cannot meaningfully fail — see AUTOMATIC ACTIONS below),
    "naturalRoll": number (echo the server-provided d20 value exactly — note: the server ignores this field and uses its own authoritative roll value, but include it for readability),
    "modifierFormula": string (e.g. "+2 (pilot skill) +1 (operational sensors) -1 (low morale)" — do NOT include the difficulty modifier here; the server adds it separately),
    "totalModifier": number (sum of character/crew/ship/situation modifiers only — do NOT include the difficulty modifier; the server adds it separately),
    "finalResult": number (actionRoll + totalModifier + difficultyModifier),
    "difficultyClass": number (1-30, the DC you set for this action),
    "difficultyRationale": string (why you chose this DC — max 50 words),
    "success": boolean,
    "isCritical": boolean (true if actionRoll was 1 or 20),
    "criticalType": "success" | "failure" | null,
    "savingThrow": { "applicable": boolean, "targetName": string | null, "savingRoll": number | null, "savingDC": number | null, "savingModifiers": string | null, "savingResult": boolean | null } | null,
    "narrativeSummary": string (one sentence summary of roll outcome for the player)
  }
}

Constraints:
- Generate exactly 3-4 available actions
- The narrative MUST continue from the current game state — do not contradict established facts
- Honor the difficulty/tone setting in your narrative style and stat changes
- Keep stat mutations reasonable: fuel should decrease by 1-5 per turn typically, combat causes 5-20 hull damage
- Reference crew members and the captain by name when relevant
- Do NOT generate mutations unless the action warrants them (e.g. dialogue rarely costs fuel)
- When the player navigates between systems, emit a "travel" mutation with the target system ID and fuel cost (typically 5-15 based on connection distance)
- You may discover new adjacent systems using "star_map_discover" when the narrative calls for it — place them at reasonable coordinates relative to existing systems
- Use "quest_start" to introduce emergent storylines with clear objectives; advance quests via "quest_update" as story progresses
- If starMapContext is provided, suggest navigation actions when appropriate and reference rumors or signals from adjacent systems
- When creating quests, include at least one hook or secret that you can use for future narrative development
- CREW MORALE: Track morale over time; broken or angry crew may depart after multiple turns via "crew_departure". Low morale darkens narrative tone; inspired crew suggest bold actions. Use "crew_personal" quest type for backstory-driven storylines. Evolve relationships via "crew_relationship" mutations during shared experiences. Use "crew_significant_moment" to mark pivotal character beats. Use "crew_health" to track injuries from combat or hazards.
- TRADE & ECONOMY: Offer trade actions at locations with trade or black_market services. Emit paired "credits" + "add_item"/"remove_item" mutations for transactions. Typical prices: common goods 10-50 credits, rare items 100-500, unique artifacts 500+. Respect cargo capacity — warn players when near cargoMax.
- COMBAT RULES: When combat begins, set mood to "combat" and emit "combat_start". During combat, provide tactical choices: fire weapons, evasive maneuvers, boost shields, target subsystems, crew actions, or flee. Shields absorb damage first, then hull takes hits. Crew can be injured via "crew_health". Weapons and systems can be damaged via "weapon_status"/"system_status". Combat typically lasts 2-5 turns. End with "combat_end" and return to a non-combat mood. Always offer "Attempt to flee" as an action during combat.
- DICE ROLLS: A server-generated d20 roll is provided with each turn. You MUST include a "rollInterpretation" in your response using the provided roll — never generate your own roll value. Build a modifier formula from relevant player traits, crew skills, ship system status, and situational factors. Do NOT include the difficulty modifier in your modifierFormula or totalModifier — the server adds it automatically as a separate term. Critical success (natural 20) always succeeds with an exceptional narrative outcome — bonus loot, dramatic flair, or unexpected advantage. Critical failure (natural 1) always fails with a complication — damage, embarrassment, or escalation. The narrative MUST reflect the roll outcome — do not write a success narrative for a failed roll or vice versa.
- DC GUIDE (Difficulty Class): Most player actions should be DC 5-10. Reserve high DCs for genuinely difficult or absurd actions. Default to LOW DCs — err on the side of letting players succeed.
  DC 3-5 (Trivial): Looking around, docking at a station, checking cargo, reading a log, routine ship operations, walking through a safe area, buying common goods at a shop.
  DC 6-8 (Easy): Talking to friendly or neutral NPCs, asking an NPC for directions, basic repairs with an engineer present, navigating a known safe route, trading at fair market price, investigating an obvious clue, scanning a nearby object with working sensors.
  DC 9-11 (Moderate): High-stakes persuasion of a neutral NPC (e.g., convincing them to take a real risk or act against their interests), navigating through a debris field, bartering for a better price, picking up a distress signal, performing non-trivial repairs, sneaking past inattentive guards, investigating a hidden compartment.
  DC 12-14 (Challenging): Persuading a suspicious NPC, hacking a basic terminal, navigating hazardous space, combat maneuvers against a moderate threat, bluffing past a checkpoint, repairing damaged systems mid-combat, tracking a faint signal.
  DC 15-17 (Hard): Convincing a hostile NPC to stand down, hacking a military system, navigating through a minefield, performing surgery without a medic, outrunning a faster ship, decoding encrypted alien transmissions.
  DC 18-20 (Very Hard): Talking down an enemy mid-combat, disabling a warship's shields from the inside, navigating a collapsing anomaly, performing impossible repairs with no parts.
  DC 21-25 (Extreme): Persuading a sworn enemy to become an ally, single-handedly defeating an overwhelming force, navigating through a black hole's accretion disk.
  DC 26-30 (Absurd/Impossible): Rewriting the laws of physics, destroying a planet, teleporting without technology, resurrecting the dead, anything that breaks the established universe rules.
  IMPORTANT: Dialogue with friendly/neutral NPCs should almost always be DC 5-8. Exploring and investigating should be DC 5-10. Only combat, deception, and genuinely risky actions warrant DC 12+. If the player is doing something their character would reasonably be able to do, keep the DC low.
- AUTOMATIC ACTIONS (skipRoll): Some actions are so routine they should NEVER require a dice roll. Set "skipRoll": true in your rollInterpretation for these actions. When skipRoll is true, the action automatically succeeds — ignore the d20 value entirely and write a success narrative. Set difficultyClass to 1, difficultyRationale to "Automatic — no roll needed", and modifierFormula to "". This DC is a placeholder only; the action succeeds automatically when skipRoll is true. Still provide a narrativeSummary.
  ALWAYS skip rolls for: looking around or observing surroundings, reading logs/manifests/public data, talking to friendly/neutral NPCs (no persuasion or deception intent), walking through safe/known areas, checking inventory or cargo, docking at a station with permission, routine ship operations (checking sensors, running diagnostics, setting course on a known route), buying common goods at listed price, opening unlocked doors, eating/drinking, checking the star map, asking crew members routine questions.
  NEVER skip rolls for: combat actions, persuasion/deception/intimidation, navigation through hazards, hacking or bypassing security, repairs under pressure or with damaged parts, stealth or sneaking, any action with meaningful opposition or risk of harm, anything creative/ambitious/unusual the player attempts, bartering or negotiating prices, investigating hidden or concealed things.
  When in doubt, do NOT skip — let the dice decide.
- SAVING THROWS: If the action targets a person, creature, or system that could resist (e.g., persuasion, hacking, combat maneuver), use the provided saving throw d20 to determine if the target resists. Set an appropriate saving DC based on the target's capability. If no saving throw is relevant (e.g., exploring, routine navigation, self-directed actions), set savingThrow to null or savingThrow.applicable to false.
- MODIFIER SOURCES: Draw modifiers from — captain traits (+1 to +2 each when relevant), captain skills (+1 to +3 based on skill level — piloting, gunnery, engineering, medicine, diplomacy, intimidation, deception, investigation, survival, hacking, stealth, leadership, xenology, commerce, perception; apply the most relevant skill to the action, and if no skill applies do not add a skill modifier), crew skills (+1 to +3 for relevant crew role), ship system status (operational +1, damaged -2, destroyed -4), ship weapons (in combat, +1 to +2), current morale (inspired +1, content 0, uneasy -1, fearful -2, broken -3), injuries (minor -1, serious -2, critical -3), relevant cargo items (+1 for useful equipment). Do not stack more than 5 modifiers total.`;

/**
 * Builds the per-turn system prompt for Void Odyssey, augmenting the base
 * prompt with journey-specific narrative directives and (for Ship's Company
 * games) the player's role. Games created before the journey feature do not
 * have `gameDoc.journey` and receive the unchanged base prompt.
 */
function buildVoidOdysseyTurnSystemPrompt(gameDoc) {
  let prompt = VOID_ODYSSEY_TURN_SYSTEM_PROMPT;

  const journey = gameDoc && gameDoc.journey;
  if (journey) {
    const directiveList =
      Array.isArray(journey.narrativeDirectives) && journey.narrativeDirectives.length
        ? journey.narrativeDirectives.map((d) => `- ${d}`).join('\n')
        : '- None provided.';
    prompt += `\n\n## Campaign Journey: ${journey.name}\nTone: ${journey.tone}\nDanger Level: ${journey.dangerLevel}\n\nNarrative directives for this campaign:\n${directiveList}`;
  }

  const character = (gameDoc && gameDoc.character) || null;
  const player = (gameDoc && gameDoc.player) || null;
  const role = (character && character.role) || (player && player.role) || null;
  if (gameDoc && gameDoc.difficulty === 'ships_company' && role) {
    prompt += `\n\nPlayer role: ${role}\nFilter all events, conversations, and access through the lens of this role.`;
  }

  return prompt;
}

const VOID_ODYSSEY_RATE_LIMITS = {
  HOURLY_SOFT: 15,
  HOURLY_HARD: 25,
  WEEKLY_SOFT: 150,
  WEEKLY_HARD: 200,
};

// NOTE: These ship class definitions must stay in sync with the frontend source of truth:
// public/apps/void-odyssey/state.js — VO.SHIP_CLASSES
// Any changes to stats, weapons, systems, or features should be applied in both places.
const SHIP_CLASS_DEFAULTS = {
  light_freighter: {
    hull: 70,
    hullMax: 70,
    shields: 30,
    shieldsMax: 30,
    fuel: 100,
    cargo: 0,
    cargoMax: 80,
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
  },
  scout_corvette: {
    hull: 55,
    hullMax: 55,
    shields: 45,
    shieldsMax: 45,
    fuel: 100,
    cargo: 0,
    cargoMax: 30,
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
  },
  gunship: {
    hull: 90,
    hullMax: 90,
    shields: 60,
    shieldsMax: 60,
    fuel: 100,
    cargo: 0,
    cargoMax: 20,
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
  },
  salvage_rig: {
    hull: 65,
    hullMax: 65,
    shields: 35,
    shieldsMax: 35,
    fuel: 100,
    cargo: 0,
    cargoMax: 60,
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
  },
};

/**
 * Starting star map region seeded into every new game.
 * Five systems forming a small graph — origin + 2 nearby discovered + 2 far undiscovered.
 */
function buildStartingStarMap(originName, difficulty) {
  var dangerBase = difficulty === 'warpath' ? 'dangerous' : 'cautious';
  return [
    {
      id: 'sys_origin',
      name: originName || 'Origin System',
      type: 'system',
      coordinates: { x: 0, y: 0 },
      connections: [
        { targetId: 'sys_near_1', distance: 12, hazards: [], known: true },
        { targetId: 'sys_near_2', distance: 18, hazards: ['debris_field'], known: true },
      ],
      discovered: true,
      visited: true,
      scanLevel: 'detailed',
      locationCount: 1,
      dangerLevel: dangerBase,
      faction: null,
      hasServices: true,
      rumors: [],
      signalStrength: null,
    },
    {
      id: 'sys_near_1',
      name: 'Relay Outpost Kappa',
      type: 'system',
      coordinates: { x: 35, y: -20 },
      connections: [
        { targetId: 'sys_origin', distance: 12, hazards: [], known: true },
        { targetId: 'sys_far_1', distance: 22, hazards: ['pirate_corridor'], known: false },
      ],
      discovered: true,
      visited: false,
      scanLevel: 'basic',
      locationCount: 0,
      dangerLevel: 'cautious',
      faction: null,
      hasServices: true,
      rumors: ['Traders mention a salvage yard beyond the relay'],
      signalStrength: null,
    },
    {
      id: 'sys_near_2',
      name: "Drifter's Reach",
      type: 'system',
      coordinates: { x: -25, y: 30 },
      connections: [
        { targetId: 'sys_origin', distance: 18, hazards: ['debris_field'], known: true },
        { targetId: 'sys_far_2', distance: 28, hazards: [], known: false },
      ],
      discovered: true,
      visited: false,
      scanLevel: 'basic',
      locationCount: 0,
      dangerLevel: 'cautious',
      faction: null,
      hasServices: false,
      rumors: ['An old signal repeats on low frequencies from deeper space'],
      signalStrength: null,
    },
    {
      id: 'sys_far_1',
      name: 'Unknown Sector',
      type: 'system',
      coordinates: { x: 65, y: -45 },
      connections: [
        { targetId: 'sys_near_1', distance: 22, hazards: ['pirate_corridor'], known: false },
      ],
      discovered: false,
      visited: false,
      scanLevel: 'none',
      locationCount: 0,
      dangerLevel: 'dangerous',
      faction: null,
      hasServices: false,
      rumors: [],
      signalStrength: 'faint',
    },
    {
      id: 'sys_far_2',
      name: 'Unknown Signal Source',
      type: 'anomaly',
      coordinates: { x: -55, y: 60 },
      connections: [{ targetId: 'sys_near_2', distance: 28, hazards: [], known: false }],
      discovered: false,
      visited: false,
      scanLevel: 'none',
      locationCount: 0,
      dangerLevel: 'dangerous',
      faction: null,
      hasServices: false,
      rumors: [],
      signalStrength: 'intermittent',
    },
  ];
}

/**
 * Checks rate limits for a game, resetting counters if windows have elapsed.
 * Returns { allowed, warning, updatedRateLimits }.
 */
function checkRateLimits(gameDoc, isAdmin) {
  const now = Date.now();
  const rl = gameDoc.rateLimits || {};

  let turnsThisHour = rl.turnsThisHour || 0;
  let hourStart = rl.hourStartTimestamp || now;
  let turnsThisWeek = rl.turnsThisWeek || 0;
  let weekStart = rl.weekStartTimestamp || now;

  // Reset hourly window
  if (now - hourStart > 60 * 60 * 1000) {
    turnsThisHour = 0;
    hourStart = now;
  }
  // Reset weekly window
  if (now - weekStart > 7 * 24 * 60 * 60 * 1000) {
    turnsThisWeek = 0;
    weekStart = now;
  }

  turnsThisHour++;
  turnsThisWeek++;

  const updatedRateLimits = {
    turnsThisHour,
    hourStartTimestamp: hourStart,
    turnsThisWeek,
    weekStartTimestamp: weekStart,
  };

  // Hard limits (admins bypass)
  if (!isAdmin) {
    if (turnsThisHour > VOID_ODYSSEY_RATE_LIMITS.HOURLY_HARD) {
      return {
        allowed: false,
        warning: 'Hourly turn limit reached. Take a break and come back soon!',
        updatedRateLimits,
      };
    }
    if (turnsThisWeek > VOID_ODYSSEY_RATE_LIMITS.WEEKLY_HARD) {
      return {
        allowed: false,
        warning: 'Weekly turn limit reached. Your odyssey continues next week!',
        updatedRateLimits,
      };
    }
  }

  // Soft warnings
  let warning = null;
  if (turnsThisHour > VOID_ODYSSEY_RATE_LIMITS.HOURLY_SOFT) {
    if (isAdmin) {
      warning = `You've taken ${turnsThisHour} turns this hour. As an admin, hard limits are not enforced, but consider taking a break.`;
    } else {
      warning = `You've taken ${turnsThisHour} turns this hour. The void will close after ${VOID_ODYSSEY_RATE_LIMITS.HOURLY_HARD}.`;
    }
  } else if (turnsThisWeek > VOID_ODYSSEY_RATE_LIMITS.WEEKLY_SOFT) {
    warning = `You've taken ${turnsThisWeek} turns this week. Weekly limit is ${VOID_ODYSSEY_RATE_LIMITS.WEEKLY_HARD}.`;
  }

  return { allowed: true, warning, updatedRateLimits };
}

/**
 * Assembles context from Firestore for a turn prompt.
 * Reads: last 5 narrative entries, active crew, current location, star map, active quests.
 */
async function assembleContext(db, gameId, gameDoc) {
  const gameRef = db.collection('void_odyssey_games').doc(gameId);

  const currentLocId = (gameDoc.ship && gameDoc.ship.currentLocationId) || '';

  const [
    narrativeSnap,
    crewSnap,
    locationSnap,
    entitiesSnap,
    itemsSnap,
    starMapSnap,
    questsSnap,
    compressedSnap,
  ] = await Promise.all([
    gameRef.collection('narrative_log').orderBy('turnNumber', 'desc').limit(5).get(),
    gameRef.collection('crew').where('status', '==', 'active').get(),
    currentLocId ? gameRef.collection('locations').doc(currentLocId).get() : Promise.resolve(null),
    currentLocId
      ? gameRef
          .collection('entities')
          .where('currentLocationId', '==', currentLocId)
          .limit(10)
          .get()
      : Promise.resolve(null),
    gameRef.collection('items').where('location', '==', 'cargo').limit(20).get(),
    gameRef.collection('star_map').limit(200).get(),
    gameRef.collection('quests').where('status', '==', 'active').get(),
    gameRef
      .collection('narrative_log')
      .where('compressed', '==', true)
      .orderBy('turnNumber', 'desc')
      .limit(10)
      .get(),
  ]);

  const recentHistory = [];
  narrativeSnap.forEach((doc) => {
    const d = doc.data();
    recentHistory.push({
      turnNumber: d.turnNumber,
      summary: d.summary || '',
      mood: d.mood || '',
      playerAction: d.playerAction || {},
    });
  });
  recentHistory.reverse(); // oldest first

  const crew = [];
  crewSnap.forEach((doc) => {
    const d = doc.data();
    const crewEntry = {
      id: d.id,
      name: d.name,
      role: d.role,
      species: d.species || 'human',
      morale: d.morale || 'content',
      personality: d.personality || [],
      backstory: (d.backstory || '').slice(0, 200),
      loyalty: d.loyalty != null ? d.loyalty : 0,
      healthStatus: d.healthStatus || 'healthy',
    };
    // Include relationship dispositions (compact, no notes to save tokens)
    if (d.relationships && typeof d.relationships === 'object') {
      const relSummary = {};
      for (const [key, val] of Object.entries(d.relationships)) {
        relSummary[key] = val.disposition || 'neutral';
      }
      crewEntry.relationships = relSummary;
    }
    // Include last 3 significant moments
    if (Array.isArray(d.significantMoments) && d.significantMoments.length > 0) {
      crewEntry.significantMoments = d.significantMoments.slice(-3);
    }
    crew.push(crewEntry);
  });

  const location =
    locationSnap && locationSnap.exists
      ? {
          name: locationSnap.data().name,
          type: locationSnap.data().type,
          description: (locationSnap.data().description || '').slice(0, 300),
          atmosphere: locationSnap.data().atmosphere || '',
        }
      : null;

  const entitiesHere = [];
  if (entitiesSnap) {
    entitiesSnap.forEach((doc) => {
      const d = doc.data();
      entitiesHere.push({
        id: doc.id,
        type: d.type,
        name: d.name,
        shortDescription: (d.shortDescription || d.description || '').slice(0, 200),
        disposition: d.disposition || 'neutral',
      });
    });
  }

  const cargoItems = [];
  itemsSnap.forEach((doc) => {
    const d = doc.data();
    cargoItems.push({
      id: doc.id,
      name: d.name,
      type: d.type || 'trade_goods',
      quantity: d.quantity || 1,
      cargoUnits: d.cargoUnits || 1,
    });
  });

  // Build star map context — adjacent systems and fuel range
  const currentSystemId = (gameDoc.ship && gameDoc.ship.currentSystemId) || '';
  const starMapSystems = [];
  starMapSnap.forEach((doc) => {
    starMapSystems.push(Object.assign({ id: doc.id }, doc.data()));
  });
  const currentSystem = starMapSystems.find((s) => s.id === currentSystemId) || null;
  const adjacentSystems = [];
  if (currentSystem && currentSystem.connections) {
    currentSystem.connections.forEach((conn) => {
      const target = starMapSystems.find((s) => s.id === conn.targetId);
      if (target) {
        adjacentSystems.push({
          id: target.id,
          name: target.name,
          distance: conn.distance,
          hazards: conn.hazards || [],
          discovered: target.discovered,
          visited: target.visited,
          dangerLevel: target.dangerLevel || 'cautious',
          faction: target.faction || null,
          hasServices: target.hasServices || false,
        });
      }
    });
  }

  // Build active quests from subcollection
  const activeQuests = [];
  questsSnap.forEach((doc) => {
    const d = doc.data();
    const objectives = d.objectives || [];
    const currentObj = objectives.find((o) => o.status === 'active');
    activeQuests.push({
      id: doc.id,
      name: d.name || d.title || 'Unnamed Quest',
      type: d.type || 'side',
      currentObjective: currentObj ? currentObj.description : null,
      givenBy: d.givenBy || null,
      status: d.status || 'active',
    });
  });

  return {
    ship: {
      name: gameDoc.ship.name,
      class: gameDoc.ship.class,
      hull: gameDoc.ship.hull,
      hullMax: gameDoc.ship.hullMax,
      shields: gameDoc.ship.shields,
      shieldsMax: gameDoc.ship.shieldsMax,
      fuel: gameDoc.ship.fuel,
      cargo: gameDoc.ship.cargo,
      cargoMax: gameDoc.ship.cargoMax,
      credits: gameDoc.ship.credits || 0,
      combatActive: gameDoc.combatActive || false,
      weapons: gameDoc.ship.weapons || [],
      systems: gameDoc.ship.systems || [],
    },
    player: (() => {
      const character = gameDoc.character || null;
      const player = gameDoc.player || null;
      const playerRole = (character && character.role) || (player && player.role) || null;
      return {
        name: (character && character.name) || (player && player.name) || '',
        traits: (character && character.traits) || (player && player.traits) || [],
        skills: (character && character.skills) || (player && player.skills) || {},
        ...(gameDoc.difficulty === 'ships_company' && playerRole ? { role: playerRole } : {}),
      };
    })(),
    difficulty: gameDoc.difficulty || 'frontier_explorer',
    location,
    entitiesAtLocation: entitiesHere,
    cargoItems,
    crew,
    recentHistory,
    activeQuests,
    starMapContext: {
      currentSystemId,
      currentSystemName: currentSystem ? currentSystem.name : null,
      adjacentSystems,
      fuelRange: gameDoc.ship.fuel || 0,
      knownSystems: starMapSystems.filter((s) => s.discovered).length,
    },
    turnCount: gameDoc.turnCount || 0,
    archiveSummaries: (() => {
      const summaries = [];
      if (compressedSnap) {
        compressedSnap.forEach((doc) => {
          const d = doc.data();
          if (d.compressedSummary) {
            summaries.push(d.compressedSummary);
          }
        });
      }
      return summaries;
    })(),
  };
}

/**
 * Compresses older narrative log entries into summaries for long-term memory.
 * Fire-and-forget — failures are non-fatal.
 */
async function compressNarrativeLog(db, gameId, currentTurn) {
  const gameRef = db.collection('void_odyssey_games').doc(gameId);
  // Query by turnNumber range to also capture pre-Phase-5 entries that lack the compressed field
  const cutoffTurn = currentTurn - 10;
  const oldEntriesSnap = await gameRef
    .collection('narrative_log')
    .where('turnNumber', '<=', cutoffTurn)
    .orderBy('turnNumber', 'asc')
    .limit(30)
    .get();

  const entries = [];
  oldEntriesSnap.forEach((doc) => {
    const d = doc.data();
    // Skip already-compressed entries (filter in code to handle missing field)
    if (d.compressed === true) return;
    if (entries.length >= 20) return;
    entries.push({ ref: doc.ref, summary: d.summary || '', mood: d.mood || '' });
  });

  if (entries.length < 10) return; // Not enough to compress

  const summaryText = entries.map((e) => `[${e.mood}] ${e.summary}`).join('\n');

  const compressed = await callGemini({
    modelName: VOID_ODYSSEY_MODEL,
    systemInstruction:
      'You are a narrative archivist. Compress the following turn-by-turn summaries into a single cohesive paragraph of about 150 words that preserves key events, character developments, and plot points. Write in past tense, third person.',
    userMessage: summaryText,
    maxOutputTokens: 500,
    jsonMode: false,
  });
  const batch = db.batch();
  for (let i = 0; i < entries.length; i++) {
    const update = { compressed: true };
    if (i === entries.length - 1) update.compressedSummary = compressed.slice(0, 2000);
    batch.update(entries[i].ref, update);
  }
  await batch.commit();
}

/**
 * Clamps a value to [min, max].
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Generates a d20 roll (1-20 inclusive) using crypto for unbiased randomness.
 */
function generateD20Roll() {
  return crypto.randomInt(1, 21);
}

/**
 * Returns a blanket modifier based on the user's difficulty preference.
 * Uses a modified Fibonacci scale: +5, +3, +2, 0, -2.
 */
function getDifficultyModifier(difficulty) {
  switch (difficulty) {
    case 'easiest':
      return 5;
    case 'easy':
      return 3;
    case 'normal':
      return 2;
    case 'hard':
      return 0;
    case 'hardest':
      return -2;
    default:
      return 2; // default to normal
  }
}

/**
 * voidOdysseyTurn — executes a single turn in a Void Odyssey campaign.
 *
 * Data: { gameId: string, playerAction: { type, actionId, input } }
 * Returns: { narrative, mood, availableActions, shipStatus, turnCount, locationName, crewCount, rateLimitWarning }
 */
exports.voidOdysseyTurn = onCall(async (request) => {
  // ── Auth + claim check ─────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to play Void Odyssey.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('void-odyssey')) {
    throw new HttpsError('permission-denied', "You don't have access to Void Odyssey.");
  }
  const isAdmin = !!request.auth.token.admin;

  // ── Input validation ───────────────────────────────────────
  const { gameId, playerAction } = request.data || {};

  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'gameId is required.');
  }

  if (!playerAction || typeof playerAction !== 'object') {
    throw new HttpsError('invalid-argument', 'playerAction is required.');
  }

  const validActionTypes = ['dialogue', 'navigation', 'combat', 'investigation', 'freeform'];
  if (!validActionTypes.includes(playerAction.type)) {
    throw new HttpsError('invalid-argument', 'Invalid action type.');
  }
  if (typeof playerAction.input !== 'string' || playerAction.input.length === 0) {
    throw new HttpsError('invalid-argument', 'Action input is required.');
  }
  if (playerAction.input.length > 500) {
    throw new HttpsError('invalid-argument', 'Action input must be 500 characters or fewer.');
  }

  if (playerAction.actionId !== undefined && playerAction.actionId !== null) {
    if (typeof playerAction.actionId !== 'string') {
      throw new HttpsError('invalid-argument', 'actionId, if provided, must be a string.');
    }
    const trimmedActionId = playerAction.actionId.trim();
    if (trimmedActionId.length === 0) {
      throw new HttpsError(
        'invalid-argument',
        'actionId, if provided, must be a non-empty string.'
      );
    }
    if (trimmedActionId.length > 100) {
      throw new HttpsError('invalid-argument', 'actionId must be 100 characters or fewer.');
    }
    playerAction.actionId = trimmedActionId;
  }

  // ── Load game doc ──────────────────────────────────────────
  const db = getFirestore();
  const gameRef = db.collection('void_odyssey_games').doc(gameId.trim());
  const gameSnap = await gameRef.get();

  if (!gameSnap.exists) {
    throw new HttpsError('not-found', 'Game not found.');
  }

  const gameDoc = gameSnap.data();

  if (gameDoc.userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'This is not your game.');
  }
  if (gameDoc.status !== 'active') {
    throw new HttpsError('failed-precondition', 'This game is no longer active.');
  }

  // ── Rate limit check ──────────────────────────────────────
  const rateLimitResult = checkRateLimits(gameDoc, isAdmin);
  if (!rateLimitResult.allowed) {
    return { limitReached: true, message: rateLimitResult.warning };
  }

  // ── Context assembly ───────────────────────────────────────
  const context = await assembleContext(db, gameId.trim(), gameDoc);

  // ── Dice roll (server-generated) ────────────────────────────
  const actionRoll = generateD20Roll();
  const savingThrowRoll = generateD20Roll();

  // Read user's difficulty preference from their profile (best-effort)
  const userRef = db.collection('users').doc(request.auth.uid);
  let userDifficulty = 'normal';
  try {
    const userSnap = await userRef.get();
    if (userSnap.exists && userSnap.data().voidOdysseyDifficulty) {
      userDifficulty = userSnap.data().voidOdysseyDifficulty;
    }
  } catch (err) {
    console.error('Failed to read user difficulty preference, defaulting to normal.', err);
  }
  const difficultyModifier = getDifficultyModifier(userDifficulty);

  const isCriticalSuccess = actionRoll === 20;
  const isCriticalFailure = actionRoll === 1;

  // ── Build AI prompt ────────────────────────────────────────
  const userMessage = `Current game state:
${JSON.stringify(context, null, 2)}

Player action:
Type: ${playerAction.type}
Action: ${playerAction.actionId || 'custom'}
Input: ${playerAction.input}

Dice roll (server-generated, cannot be changed):
Action d20: ${actionRoll}${isCriticalSuccess ? ' (NATURAL 20 — CRITICAL SUCCESS)' : ''}${isCriticalFailure ? ' (NATURAL 1 — CRITICAL FAILURE)' : ''}
Saving throw d20 (use only if the action targets someone/something that resists): ${savingThrowRoll}
Difficulty modifier (player difficulty "${userDifficulty}"): ${difficultyModifier >= 0 ? '+' : ''}${difficultyModifier}

If this action is trivial/automatic (looking around, talking to a friendly NPC, routine ship ops, etc.), set skipRoll: true in rollInterpretation and ignore the dice values.

Generate the next narrative beat, state mutations, available actions, AND a rollInterpretation object based on the dice roll.`;

  // ── Call Gemini API ─────────────────────────────────────────
  let aiResponse;
  try {
    aiResponse = await callGemini({
      modelName: VOID_ODYSSEY_MODEL,
      systemInstruction: buildVoidOdysseyTurnSystemPrompt(gameDoc),
      userMessage,
      // NOTE: 8192 tokens increases average latency and API cost per turn.
      // VOID_ODYSSEY_COST_PER_TURN is an approximate game-credit metric, not an exact USD figure.
      maxOutputTokens: 8192,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('Gemini API or parse error:', err);
    throw new HttpsError('internal', 'Failed to generate narrative. Please try again.');
  }

  // ── Validate response fields ───────────────────────────────
  if (!aiResponse.narrative || typeof aiResponse.narrative !== 'string') {
    throw new HttpsError('internal', 'Invalid narrative response. Please try again.');
  }
  // Cap narrative length
  if (aiResponse.narrative.length > 5000) {
    aiResponse.narrative = aiResponse.narrative.slice(0, 5000);
  }

  // Validate mood against known enum
  const VALID_MOODS = [
    'tense',
    'calm',
    'wonder',
    'danger',
    'tense_curiosity',
    'wry',
    'reverent',
    'combat',
  ];
  aiResponse.mood =
    typeof aiResponse.mood === 'string' && VALID_MOODS.includes(aiResponse.mood)
      ? aiResponse.mood
      : 'calm';

  // Validate stateMutations
  aiResponse.stateMutations = Array.isArray(aiResponse.stateMutations)
    ? aiResponse.stateMutations.slice(0, 20)
    : [];

  // Validate availableActions — freeform is not a valid type for AI-generated actions
  const VALID_ACTION_TYPES = ['dialogue', 'navigation', 'combat', 'investigation'];
  aiResponse.availableActions = Array.isArray(aiResponse.availableActions)
    ? aiResponse.availableActions
        .filter(
          (a) =>
            a &&
            typeof a.id === 'string' &&
            a.id.length > 0 &&
            a.id.length <= 100 &&
            typeof a.label === 'string' &&
            a.label.length > 0 &&
            a.label.length <= 100 &&
            VALID_ACTION_TYPES.includes(a.type)
        )
        .slice(0, 5)
    : [];
  // Validate newEntities
  aiResponse.newEntities = Array.isArray(aiResponse.newEntities)
    ? aiResponse.newEntities
        .filter((e) => e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 100)
        .slice(0, 10)
    : [];

  // Cap summary length
  aiResponse.summary =
    typeof aiResponse.summary === 'string' ? aiResponse.summary.slice(0, 500) : '';

  // ── Validate and enforce rollInterpretation ────────────────
  const ri = aiResponse.rollInterpretation;
  if (ri && typeof ri === 'object') {
    const totalMod = clamp(Math.round(Number(ri.totalModifier) || 0), -20, 20);
    const dc = clamp(Number(ri.difficultyClass) || 10, 1, 30);

    // skipRoll: AI signals a trivial action; server only honors it when DC <= 5
    const skipRoll = ri.skipRoll === true && dc <= 5;

    // Keep persisted rollInterpretation internally consistent for auto-success.
    const finalResult = skipRoll ? dc : actionRoll + totalMod + difficultyModifier;
    const success = skipRoll
      ? true
      : isCriticalSuccess
        ? true
        : isCriticalFailure
          ? false
          : finalResult >= dc;

    let savingThrow = null;
    if (!skipRoll && ri.savingThrow && ri.savingThrow.applicable) {
      const savingDC = clamp(Number(ri.savingThrow.savingDC) || 10, 1, 30);
      savingThrow = {
        applicable: true,
        targetName:
          typeof ri.savingThrow.targetName === 'string'
            ? ri.savingThrow.targetName.slice(0, 100)
            : 'Target',
        savingRoll: savingThrowRoll,
        savingDC,
        savingModifiers:
          typeof ri.savingThrow.savingModifiers === 'string'
            ? ri.savingThrow.savingModifiers.slice(0, 200)
            : '',
        savingResult: savingThrowRoll >= savingDC,
      };
    }

    aiResponse.rollInterpretation = {
      skipRoll,
      naturalRoll: skipRoll ? null : actionRoll,
      modifierFormula:
        typeof ri.modifierFormula === 'string' ? ri.modifierFormula.slice(0, 300) : '',
      totalModifier: skipRoll ? 0 : totalMod,
      difficultyModifier: skipRoll ? 0 : difficultyModifier,
      finalResult,
      difficultyClass: dc,
      difficultyRationale:
        typeof ri.difficultyRationale === 'string' ? ri.difficultyRationale.slice(0, 200) : '',
      success,
      isCritical: skipRoll ? false : isCriticalSuccess || isCriticalFailure,
      criticalType: skipRoll
        ? null
        : isCriticalSuccess
          ? 'success'
          : isCriticalFailure
            ? 'failure'
            : null,
      savingThrow,
      narrativeSummary:
        typeof ri.narrativeSummary === 'string' ? ri.narrativeSummary.slice(0, 300) : '',
    };
  } else {
    // Fallback if AI omitted rollInterpretation
    const finalResult = actionRoll + difficultyModifier;
    aiResponse.rollInterpretation = {
      skipRoll: false,
      naturalRoll: actionRoll,
      modifierFormula: '',
      totalModifier: 0,
      difficultyModifier,
      finalResult,
      difficultyClass: 10,
      difficultyRationale: '',
      success: isCriticalSuccess ? true : isCriticalFailure ? false : finalResult >= 10,
      isCritical: isCriticalSuccess || isCriticalFailure,
      criticalType: isCriticalSuccess ? 'success' : isCriticalFailure ? 'failure' : null,
      savingThrow: null,
      narrativeSummary: '',
    };
  }

  // ── Apply mutations and persist via transaction ────────────
  const txResult = await db.runTransaction(async (tx) => {
    const freshSnap = await tx.get(gameRef);
    if (!freshSnap.exists) {
      throw new HttpsError('not-found', 'Game not found.');
    }
    const freshGame = freshSnap.data();
    const ship = { ...freshGame.ship };
    let currentLocationName = freshGame.currentLocationName || '';
    const validatedMutations = [];

    // ── Pre-fetch all documents needed by mutations (reads before writes) ──
    const prefetchRefs = new Map();
    const sourceSystemId = freshGame.ship.currentSystemId || 'sys_origin';
    for (const mut of aiResponse.stateMutations) {
      if (mut.type === 'quest_update' && mut.questId) {
        const ref = gameRef.collection('quests').doc(mut.questId);
        prefetchRefs.set(ref.path, ref);
      } else if (mut.type === 'star_map_discover' && mut.system) {
        const sys = mut.system;
        if (sys.id) {
          const sysRef = gameRef.collection('star_map').doc(sys.id);
          prefetchRefs.set(sysRef.path, sysRef);
        }
        const connections = Array.isArray(sys.connections) ? sys.connections.slice(0, 10) : [];
        for (const conn of connections) {
          if (conn.targetId) {
            const reverseRef = gameRef.collection('star_map').doc(conn.targetId);
            prefetchRefs.set(reverseRef.path, reverseRef);
          }
        }
      } else if (mut.type === 'travel' && mut.targetSystemId) {
        const travelSysRef = gameRef.collection('star_map').doc(mut.targetSystemId);
        const sourceSysRef = gameRef.collection('star_map').doc(sourceSystemId);
        prefetchRefs.set(travelSysRef.path, travelSysRef);
        prefetchRefs.set(sourceSysRef.path, sourceSysRef);
      }
    }
    const prefetchedSnaps = new Map();
    const refsToFetch = [...prefetchRefs.values()];
    if (refsToFetch.length > 0) {
      const snaps = await Promise.all(refsToFetch.map((ref) => tx.get(ref)));
      for (let i = 0; i < refsToFetch.length; i++) {
        prefetchedSnaps.set(refsToFetch[i].path, snaps[i]);
      }
    }

    for (const mut of aiResponse.stateMutations) {
      if (mut.type === 'ship_stat') {
        const field = mut.field;
        const delta = Number(mut.delta) || 0;
        if (field === 'hull') {
          ship.hull = clamp((ship.hull || 0) + delta, 0, ship.hullMax || 100);
          validatedMutations.push(mut);
        } else if (field === 'shields') {
          ship.shields = clamp((ship.shields || 0) + delta, 0, ship.shieldsMax || 100);
          validatedMutations.push(mut);
        } else if (field === 'fuel') {
          ship.fuel = clamp((ship.fuel || 0) + delta, 0, 100);
          validatedMutations.push(mut);
        } else if (field === 'cargo') {
          ship.cargo = clamp((ship.cargo || 0) + delta, 0, ship.cargoMax || 100);
          validatedMutations.push(mut);
        }
      } else if (mut.type === 'credits') {
        const delta = Number(mut.delta) || 0;
        ship.credits = Math.max(0, (ship.credits || 0) + delta);
        validatedMutations.push(mut);
      } else {
        validatedMutations.push(mut);
      }
    }

    const now = FieldValue.serverTimestamp();
    const newTurnCount = (freshGame.turnCount || 0) + 1;

    // Update game doc
    const gameUpdate = {
      turnCount: newTurnCount,
      updatedAt: now,
      'ship.hull': ship.hull,
      'ship.shields': ship.shields,
      'ship.fuel': ship.fuel,
      'ship.cargo': ship.cargo,
      'ship.credits': ship.credits != null ? ship.credits : freshGame.ship.credits || 0,
      rateLimits: rateLimitResult.updatedRateLimits,
    };

    // Process subcollection mutations
    for (let i = 0; i < validatedMutations.length; i++) {
      const mut = validatedMutations[i];

      if (mut.type === 'location_discover' && mut.location) {
        const locRef = gameRef
          .collection('locations')
          .doc(mut.location.id || `loc_${newTurnCount}`);
        tx.set(locRef, {
          id: locRef.id,
          name: (mut.location.name || 'Unknown').slice(0, 200),
          type: mut.location.type || 'unknown',
          description: (mut.location.description || '').slice(0, 1000),
          atmosphere: (mut.location.atmosphere || '').slice(0, 200),
          discovered: true,
          visitCount: 0,
          firstVisitedTurn: newTurnCount,
          tags: [mut.location.type || 'unknown'],
          createdAt: now,
          updatedAt: now,
        });
      } else if (mut.type === 'location_update' && mut.locationId) {
        const locUpdateRef = gameRef.collection('locations').doc(mut.locationId);
        const locUpdate = { updatedAt: now };
        if (mut.pointOfInterest && mut.pointOfInterest.name) {
          locUpdate.pointsOfInterest = FieldValue.arrayUnion({
            id: mut.pointOfInterest.id || `poi_${newTurnCount}_${i}`,
            name: (mut.pointOfInterest.name || '').slice(0, 200),
            description: (mut.pointOfInterest.description || '').slice(0, 500),
            type: mut.pointOfInterest.type || 'unknown',
            accessible: true,
            tags: [],
          });
        }
        if (mut.significantEvent && typeof mut.significantEvent === 'string') {
          locUpdate.significantEvents = FieldValue.arrayUnion({
            turnNumber: newTurnCount,
            summary: mut.significantEvent.slice(0, 500),
          });
        }
        tx.set(locUpdateRef, locUpdate, { merge: true });
      } else if (mut.type === 'crew_morale' && mut.crewId) {
        const crewRef = gameRef.collection('crew').doc(mut.crewId);
        tx.update(crewRef, { morale: mut.value || 'content', updatedAt: now });
      } else if (mut.type === 'crew_health' && mut.crewId) {
        const crewRef = gameRef.collection('crew').doc(mut.crewId);
        tx.update(crewRef, { healthStatus: mut.value || 'healthy', updatedAt: now });
      } else if (mut.type === 'crew_relationship' && mut.crewId && mut.targetCrewId) {
        const crewRef = gameRef.collection('crew').doc(mut.crewId);
        const relKey = 'relationships.' + mut.targetCrewId;
        tx.set(
          crewRef,
          {
            [relKey]: {
              disposition: mut.disposition || 'neutral',
              notes: (mut.notes || '').slice(0, 500),
            },
            updatedAt: now,
          },
          { merge: true }
        );
      } else if (mut.type === 'crew_significant_moment' && mut.crewId) {
        const crewRef = gameRef.collection('crew').doc(mut.crewId);
        tx.update(crewRef, {
          significantMoments: FieldValue.arrayUnion({
            turnNumber: newTurnCount,
            summary: (mut.summary || '').slice(0, 500),
          }),
          updatedAt: now,
        });
      } else if (mut.type === 'crew_departure' && mut.crewId) {
        const crewRef = gameRef.collection('crew').doc(mut.crewId);
        tx.update(crewRef, {
          status: 'departed',
          departureReason: (mut.reason || '').slice(0, 500),
          departedOnTurn: newTurnCount,
          updatedAt: now,
        });
        gameUpdate.crewCount = FieldValue.increment(-1);
      } else if (mut.type === 'combat_start' && mut.enemyName) {
        gameUpdate.combatActive = true;
        gameUpdate.combatEnemy = {
          name: (mut.enemyName || 'Unknown').slice(0, 200),
          type: mut.enemyType || 'ship',
          threatLevel: mut.threatLevel || 'moderate',
        };
      } else if (mut.type === 'combat_end') {
        gameUpdate.combatActive = false;
        gameUpdate.combatEnemy = FieldValue.delete();
      } else if (mut.type === 'weapon_status' && mut.weaponId) {
        const weapons = Array.isArray(ship.weapons) ? [...ship.weapons] : [];
        const wIdx = weapons.findIndex((w) => w.id === mut.weaponId || w.name === mut.weaponId);
        if (wIdx !== -1) {
          weapons[wIdx] = { ...weapons[wIdx], status: mut.status || 'operational' };
          ship.weapons = weapons;
          gameUpdate['ship.weapons'] = weapons;
        }
      } else if (mut.type === 'system_status' && mut.systemId) {
        const systems = Array.isArray(ship.systems) ? [...ship.systems] : [];
        const sIdx = systems.findIndex((s) => s.id === mut.systemId || s.name === mut.systemId);
        if (sIdx !== -1) {
          systems[sIdx] = { ...systems[sIdx], status: mut.status || 'operational' };
          ship.systems = systems;
          gameUpdate['ship.systems'] = systems;
        }
      } else if (mut.type === 'add_item' && mut.item) {
        const itemRef = gameRef.collection('items').doc(mut.item.id || `item_${newTurnCount}_${i}`);
        tx.set(itemRef, {
          id: itemRef.id,
          name: (mut.item.name || 'Unknown Item').slice(0, 200),
          type: mut.item.type || 'trade_goods',
          description: (mut.item.description || '').slice(0, 1000),
          shortDescription: (mut.item.description || '').slice(0, 200),
          cargoUnits: Number(mut.item.cargoUnits) || 1,
          quantity: Number(mut.item.quantity) || 1,
          condition: mut.item.condition || 'good',
          baseValue: mut.item.baseValue || null,
          rarity: mut.item.rarity || 'common',
          location: 'cargo',
          acquiredTurn: newTurnCount,
          acquiredFrom: currentLocationName || 'unknown',
          questRelated: !!mut.item.questRelated,
          questId: mut.item.questId || null,
          tags: Array.isArray(mut.item.tags) ? mut.item.tags.slice(0, 20) : [],
          notes: null,
          createdAt: now,
          updatedAt: now,
        });
      } else if (mut.type === 'remove_item' && mut.itemId) {
        const itemDelRef = gameRef.collection('items').doc(mut.itemId);
        tx.delete(itemDelRef);
      } else if (mut.type === 'quest_start' && mut.quest) {
        const q = mut.quest;
        const questRef = gameRef.collection('quests').doc(q.id || `quest_${newTurnCount}_${i}`);
        const objectives = Array.isArray(q.objectives)
          ? q.objectives.slice(0, 10).map((o) => ({
              id: o.id || `obj_${newTurnCount}_${i}`,
              description: (o.description || '').slice(0, 500),
              status: 'active',
              completedOnTurn: null,
            }))
          : [];
        tx.set(questRef, {
          id: questRef.id,
          name: (q.name || q.title || 'Unnamed Quest').slice(0, 200),
          description: (q.description || '').slice(0, 1000),
          type: q.type || 'side',
          status: 'active',
          givenBy: q.givenBy || null,
          givenOnTurn: newTurnCount,
          locationId: ship.currentLocationId || null,
          objectives,
          currentObjectiveId: objectives.length > 0 ? objectives[0].id : null,
          rewards: null,
          consequences: null,
          completedOnTurn: null,
          relatedEntityIds: [],
          relatedLocationIds: [],
          relatedItemIds: [],
          relatedQuestIds: [],
          hooks: Array.isArray(q.hooks) ? q.hooks.slice(0, 10) : [],
          secrets: Array.isArray(q.secrets) ? q.secrets.slice(0, 10) : [],
          tags: [q.type || 'side'],
          createdAt: now,
          updatedAt: now,
        });
        gameUpdate.activeQuestCount = FieldValue.increment(1);
      } else if (mut.type === 'quest_update' && mut.questId) {
        const questUpdateRef = gameRef.collection('quests').doc(mut.questId);
        const questSnap = prefetchedSnaps.get(questUpdateRef.path);
        if (questSnap && questSnap.exists) {
          const questData = questSnap.data();
          const questUpdate = { updatedAt: now };
          const previousStatus = questData.status || 'active';

          if (mut.status) {
            questUpdate.status = mut.status;
            if (
              (mut.status === 'completed' || mut.status === 'failed') &&
              previousStatus === 'active'
            ) {
              questUpdate.completedOnTurn = newTurnCount;
              gameUpdate.activeQuestCount = FieldValue.increment(-1);
            }
          }

          // Rewrite objectives array with the updated objective status
          if (mut.objectiveId && mut.objectiveStatus) {
            const existingObjectives = Array.isArray(questData.objectives)
              ? questData.objectives
              : [];
            questUpdate.objectives = existingObjectives.map((obj) => {
              if (obj.id === mut.objectiveId) {
                return {
                  ...obj,
                  status: mut.objectiveStatus,
                  completedOnTurn:
                    mut.objectiveStatus === 'completed'
                      ? newTurnCount
                      : obj.completedOnTurn || null,
                };
              }
              return obj;
            });
            // Advance currentObjectiveId to next active objective
            const nextActive = questUpdate.objectives.find((o) => o.status === 'active');
            questUpdate.currentObjectiveId = nextActive ? nextActive.id : null;
          }

          if (mut.note) {
            questUpdate.lastNote = (mut.note || '').slice(0, 500);
          }
          tx.set(questUpdateRef, questUpdate, { merge: true });
        }
      } else if (mut.type === 'star_map_discover' && mut.system) {
        const sys = mut.system;
        const sysRef = gameRef.collection('star_map').doc(sys.id || `sys_${newTurnCount}_${i}`);
        const connections = Array.isArray(sys.connections)
          ? sys.connections.slice(0, 10).map((c) => ({
              targetId: c.targetId,
              distance: Number(c.distance) || 10,
              hazards: Array.isArray(c.hazards) ? c.hazards.slice(0, 5) : [],
              known: false,
            }))
          : [];

        // Check if system already exists — if so, just mark discovered
        const existingSysSnap = prefetchedSnaps.get(sysRef.path);
        if (existingSysSnap && existingSysSnap.exists) {
          tx.set(sysRef, { discovered: true, updatedAt: now }, { merge: true });
        } else {
          tx.set(sysRef, {
            id: sysRef.id,
            name: (sys.name || 'Unknown System').slice(0, 200),
            type: sys.type || 'system',
            coordinates: {
              x: Number(sys.coordinates && sys.coordinates.x) || 0,
              y: Number(sys.coordinates && sys.coordinates.y) || 0,
            },
            connections,
            discovered: true,
            visited: false,
            scanLevel: 'none',
            locationCount: 0,
            dangerLevel: sys.dangerLevel || 'cautious',
            faction: sys.faction || null,
            hasServices: !!sys.hasServices,
            rumors: Array.isArray(sys.rumors) ? sys.rumors.slice(0, 5) : [],
            signalStrength: null,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Add reverse connection only to existing target systems
        for (const conn of connections) {
          const reverseRef = gameRef.collection('star_map').doc(conn.targetId);
          const reverseSnap = prefetchedSnaps.get(reverseRef.path);
          if (reverseSnap && reverseSnap.exists) {
            tx.set(
              reverseRef,
              {
                connections: FieldValue.arrayUnion({
                  targetId: sysRef.id,
                  distance: conn.distance,
                  hazards: conn.hazards,
                  known: false,
                }),
                updatedAt: now,
              },
              { merge: true }
            );
          }
        }
      } else if (mut.type === 'star_map_update' && mut.systemId) {
        const sysUpdateRef = gameRef.collection('star_map').doc(mut.systemId);
        const sysUpdate = { updatedAt: now };
        if (mut.scanLevel) sysUpdate.scanLevel = mut.scanLevel;
        if (Array.isArray(mut.rumors)) sysUpdate.rumors = mut.rumors.slice(0, 10);
        tx.set(sysUpdateRef, sysUpdate, { merge: true });
      } else if (mut.type === 'travel' && mut.targetSystemId) {
        const fuelCost = Number(mut.fuelCost) || 10;
        const sourceSystemId = freshGame.ship.currentSystemId || 'sys_origin';

        // Validate: check target exists and is connected to source
        const travelSysRef = gameRef.collection('star_map').doc(mut.targetSystemId);
        const sourceSysRef = gameRef.collection('star_map').doc(sourceSystemId);
        const targetSnap = prefetchedSnaps.get(travelSysRef.path);
        const sourceSnap = prefetchedSnaps.get(sourceSysRef.path);

        if (!targetSnap || !targetSnap.exists) continue; // skip invalid target

        // Verify connectivity
        const sourceData = sourceSnap && sourceSnap.exists ? sourceSnap.data() : {};
        const sourceConns = Array.isArray(sourceData.connections) ? sourceData.connections : [];
        const isConnected = sourceConns.some((c) => c.targetId === mut.targetSystemId);
        if (!isConnected) continue; // skip if not connected

        // Validate fuel
        if ((ship.fuel || 0) < fuelCost) continue; // skip if insufficient fuel

        // Apply fuel cost
        ship.fuel = clamp((ship.fuel || 0) - fuelCost, 0, 100);
        gameUpdate['ship.fuel'] = ship.fuel;
        ship.currentSystemId = mut.targetSystemId;
        gameUpdate['ship.currentSystemId'] = mut.targetSystemId;

        // Clear current location — new system has no location until the AI discovers one
        ship.currentLocationId = null;
        gameUpdate['ship.currentLocationId'] = null;

        // Mark target system as visited
        tx.set(
          travelSysRef,
          { visited: true, scanLevel: 'basic', updatedAt: now },
          { merge: true }
        );

        // Mark the route as known on both source and target systems
        if (sourceSystemId !== mut.targetSystemId) {
          const updatedSourceConns = sourceConns.map((c) => {
            if (c.targetId === mut.targetSystemId) {
              return { ...c, known: true };
            }
            return c;
          });
          tx.set(
            sourceSysRef,
            { connections: updatedSourceConns, updatedAt: now },
            { merge: true }
          );

          // Also mark reverse connection as known on target
          const targetData = targetSnap.data() || {};
          const targetConns = Array.isArray(targetData.connections) ? targetData.connections : [];
          const updatedTargetConns = targetConns.map((c) => {
            if (c.targetId === sourceSystemId) {
              return { ...c, known: true };
            }
            return c;
          });
          tx.set(
            travelSysRef,
            { connections: updatedTargetConns, updatedAt: now },
            { merge: true }
          );
        }
      }
    }

    // Persist new entities
    for (let i = 0; i < aiResponse.newEntities.length; i++) {
      const entity = aiResponse.newEntities[i];
      const entityRef = gameRef
        .collection('entities')
        .doc(entity.id || `entity_${newTurnCount}_${i}`);
      tx.set(entityRef, {
        id: entityRef.id,
        type: entity.type || 'npc',
        name: (entity.name || 'Unknown').slice(0, 200),
        description: (entity.description || '').slice(0, 1000),
        shortDescription: (entity.description || '').slice(0, 200),
        species: entity.species || null,
        role: entity.role || null,
        factionId: null,
        disposition: entity.disposition || 'neutral',
        personality: [],
        dialogue_style: entity.dialogue_style || null,
        motivations: [],
        secrets: [],
        territory: [],
        ideology: null,
        strength: null,
        allies: [],
        enemies: [],
        threat: null,
        habitat: null,
        abilities: [],
        metOnTurn: newTurnCount,
        interactionCount: 1,
        playerReputation: 0,
        significantMoments: [{ turnNumber: newTurnCount, summary: 'First encountered' }],
        currentLocationId: ship.currentLocationId || null,
        locationHistory: ship.currentLocationId ? [ship.currentLocationId] : [],
        status: 'alive',
        alive: true,
        tags: Array.isArray(entity.tags) ? entity.tags.slice(0, 20) : [],
        createdAt: now,
        updatedAt: now,
      });
    }

    // Check for navigation — update location
    const navAction = validatedMutations.find(
      (m) => m.type === 'location_discover' && m.location && m.location.name
    );
    if (playerAction.type === 'navigation' && navAction) {
      const newLocId = navAction.location.id || `loc_${newTurnCount}`;
      gameUpdate['ship.currentLocationId'] = newLocId;
      gameUpdate.currentLocationName = navAction.location.name;
      currentLocationName = navAction.location.name;
    }

    // Check for travel — update location name from target system (only if travel was applied)
    const travelAction = validatedMutations.find((m) => m.type === 'travel' && m.targetSystemId);
    if (travelAction && gameUpdate['ship.currentSystemId']) {
      if (navAction) {
        // A location_discover was also emitted — use its name
        currentLocationName = navAction.location.name;
      } else {
        // Look up the target system name from star_map for the location name
        const targetSysRef = gameRef.collection('star_map').doc(travelAction.targetSystemId);
        const targetSysSnap = prefetchedSnaps.get(targetSysRef.path);
        const targetSysName =
          targetSysSnap && targetSysSnap.exists && targetSysSnap.data().name
            ? targetSysSnap.data().name.slice(0, 200)
            : 'Unknown System';
        gameUpdate.currentLocationName = targetSysName;
        currentLocationName = targetSysName;
      }
    }

    tx.update(gameRef, gameUpdate);

    // Narrative log entry — cap field sizes to avoid exceeding Firestore limits
    const narrativeLogRef = gameRef.collection('narrative_log').doc();
    const cappedMutations = validatedMutations.slice(0, 20);
    const cappedEntityIds = aiResponse.newEntities
      .map((e) => e.id)
      .filter((id) => typeof id === 'string' && id.length > 0)
      .slice(0, 10);
    const cappedActions = aiResponse.availableActions.slice(0, 5);

    tx.set(narrativeLogRef, {
      id: narrativeLogRef.id,
      turnNumber: newTurnCount,
      timestamp: now,
      playerAction: {
        type: playerAction.type,
        actionId: playerAction.actionId || null,
        input: playerAction.input,
      },
      narrative: aiResponse.narrative,
      mood: aiResponse.mood,
      stateMutations: cappedMutations,
      newEntityIds: cappedEntityIds,
      locationId: ship.currentLocationId || '',
      summary: aiResponse.summary,
      tags: [playerAction.type, aiResponse.mood],
      availableActions: cappedActions,
      rollInterpretation: aiResponse.rollInterpretation,
      compressed: false,
    });

    return {
      ship,
      currentLocationName,
      newTurnCount,
      validatedMutations,
      currentSystemId: ship.currentSystemId || null,
      combatActive:
        gameUpdate.combatActive != null ? gameUpdate.combatActive : freshGame.combatActive || false,
    };
  });

  // ── Narrative compression (awaited with timeout, non-fatal) ──
  if (txResult.newTurnCount > 0 && txResult.newTurnCount % 20 === 0) {
    try {
      await Promise.race([
        compressNarrativeLog(db, gameId.trim(), txResult.newTurnCount),
        new Promise((_, reject) =>
          global.setTimeout(() => reject(new Error('Compression timed out')), 8000)
        ),
      ]);
    } catch (err) {
      console.error('Compression failed or timed out (non-fatal):', err);
    }
  }

  // ── Compute crew count ─────────────────────────────────────
  const crewSnap = await gameRef.collection('crew').where('status', '==', 'active').get();

  // ── Track AI cost (best-effort; non-fatal on failure) ──────
  try {
    await db
      .collection('users')
      .doc(request.auth.uid)
      .set({ voidOdysseyCost: FieldValue.increment(VOID_ODYSSEY_COST_PER_TURN) }, { merge: true });
  } catch (err) {
    console.error('Failed to update voidOdysseyCost for user:', request.auth.uid, err);
  }

  // ── Return to client ───────────────────────────────────────
  return {
    narrative: aiResponse.narrative,
    mood: aiResponse.mood,
    availableActions: aiResponse.availableActions,
    shipStatus: {
      hull: txResult.ship.hull,
      hullMax: txResult.ship.hullMax,
      shields: txResult.ship.shields,
      shieldsMax: txResult.ship.shieldsMax,
      fuel: txResult.ship.fuel,
      credits: txResult.ship.credits || 0,
      systems: txResult.ship.systems || [],
      weapons: txResult.ship.weapons || [],
    },
    combatActive: txResult.combatActive || false,
    turnCount: txResult.newTurnCount,
    locationName: txResult.currentLocationName,
    currentSystemId: txResult.currentSystemId || null,
    crewCount: crewSnap.size,
    rollInterpretation: aiResponse.rollInterpretation,
    rateLimitWarning: rateLimitResult.warning || null,
  };
});

/**
 * voidOdysseyGenerateBackstory — generates a captain backstory tuned to the
 * selected journey and traits. Used by the creation wizard's Step 2 "Generate
 * Backstory" button so the player can seed the textarea with an AI-written
 * draft and then edit it before continuing.
 *
 * Caller must be authenticated and have the 'void-odyssey' app claim.
 *
 * Data:
 *   journey: string            — journey / tone ID (same set as voidOdysseyNewGame)
 *   captainName: string        — optional; used for flavor if provided
 *   captainTraits: string[]    — 2-3 trait IDs
 *
 * Returns:
 *   backstory: string          — 2-4 sentence backstory (<= 400 chars)
 */
exports.voidOdysseyGenerateBackstory = onCall(async (request) => {
  // ── Auth + claim check ─────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to play Void Odyssey.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('void-odyssey')) {
    throw new HttpsError('permission-denied', "You don't have access to Void Odyssey.");
  }

  // ── Input validation ───────────────────────────────────────
  const { journey, captainName, captainTraits } = request.data || {};

  if (!journey || !VOID_ODYSSEY_JOURNEY_IDS.includes(journey)) {
    throw new HttpsError('invalid-argument', 'Invalid journey selection.');
  }
  if (!Array.isArray(captainTraits) || captainTraits.length < 2 || captainTraits.length > 3) {
    throw new HttpsError('invalid-argument', 'Select 2–3 captain traits.');
  }
  if (!captainTraits.every((t) => VOID_ODYSSEY_TRAIT_IDS.includes(t))) {
    throw new HttpsError('invalid-argument', 'Invalid captain trait selection.');
  }

  const journeyToneLabels = {
    frontier_explorer: 'Frontier Explorer — discovery-focused, wonder, first contact',
    smugglers_run: "Smuggler's Run — gritty trade, intrigue, moral grey areas",
    warpath: 'Warpath — military campaigns, tactical combat, high stakes',
    deep_salvage: 'Deep Salvage — atmospheric horror, derelict wrecks, resource scarcity',
    first_contact: 'First Contact — cerebral, diplomatic, xenolinguistic stakes',
    the_long_haul: 'The Long Haul — intimate character-driven voyage, isolation, crew bonds',
    ships_company:
      "Ship's Company — capital warship crew role, chain of command, institutional drama",
    custom: 'Custom — flexible tone, adapt to whatever story emerges',
  };

  const nameLine =
    typeof captainName === 'string' && captainName.trim()
      ? `Captain's name: ${captainName.trim().slice(0, 60)}`
      : "Captain's name: (unnamed — you may reference them as 'the captain')";

  const systemPrompt = `You write short character backstories for Void Odyssey, an AI-driven space exploration game set in a hard-ish sci-fi universe (Firefly meets Mass Effect — grounded crews, alien encounters, political tensions, moments of wonder).

You MUST respond with ONLY a valid JSON object. No prose outside the JSON. The schema is:
{
  "backstory": string (2-4 sentences, second person, 400 characters or fewer, tuned to the journey tone and chosen traits; should imply a reason this captain is heading into the void now)
}

Constraints:
- Write in second person ("You grew up…").
- Keep it grounded: a specific place, a specific incident, a hint of what's driving them.
- Reference the traits implicitly through behavior or history, not as a list.
- Do NOT name the ship, the crew, or the destination — those come later in creation.
- Stay within 400 characters total. Do not exceed this limit.`;

  const userMessage = `Generate a captain backstory for a new Void Odyssey campaign.

Journey / Tone: ${journeyToneLabels[journey]}
${nameLine}
Traits: ${captainTraits.join(', ')}`;

  let aiResponse;
  try {
    aiResponse = await callGemini({
      modelName: VOID_ODYSSEY_MODEL,
      systemInstruction: systemPrompt,
      userMessage,
      maxOutputTokens: 512,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('voidOdysseyGenerateBackstory Gemini error:', err);
    throw new HttpsError('internal', 'Failed to generate backstory. Please try again.');
  }

  let backstory = typeof aiResponse?.backstory === 'string' ? aiResponse.backstory.trim() : '';
  if (!backstory) {
    throw new HttpsError('internal', 'AI did not return a backstory.');
  }
  // Hard cap to match voidOdysseyNewGame's 400-char limit so the generated
  // text can be sent straight back without rejection.
  if (backstory.length > 400) {
    backstory = backstory.slice(0, 400).trimEnd();
  }

  return { backstory };
});

/**
 * voidOdysseyNewGame — creates a new Void Odyssey campaign.
 *
 * Caller must be authenticated and have the 'void-odyssey' app claim.
 *
 * Data:
 *   difficulty: string         — 'frontier_explorer' | 'smugglers_run' | 'warpath' | 'custom'
 *   captainName: string        — player character name
 *   captainTraits: string[]    — 2-3 trait IDs
 *   captainBackstory: string   — optional backstory (empty string if none)
 *   shipClass: string          — 'light_freighter' | 'scout_corvette' | 'gunship' | 'salvage_rig'
 *   shipName: string           — player-chosen ship name
 *
 * Returns:
 *   gameId: string
 *   narrative: string
 *   availableActions: { id, label, type }[]
 *   crew: { name, role, species, backstory, personality }[]
 *   startingLocation: string
 *   mood: string
 *   ship: { name, class, ... }
 */
exports.voidOdysseyNewGame = onCall(async (request) => {
  // ── Auth + claim check ─────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to play Void Odyssey.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('void-odyssey')) {
    throw new HttpsError('permission-denied', "You don't have access to Void Odyssey.");
  }

  // ── Input validation ───────────────────────────────────────
  const {
    difficulty,
    captainName,
    captainTraits,
    captainBackstory,
    captainSkills,
    shipClass,
    shipName,
    captainRole,
  } = request.data || {};

  const validShipClasses = [
    'light_freighter',
    'scout_corvette',
    'gunship',
    'salvage_rig',
    'survey_vessel',
    'blockade_runner',
    'corvette_warfit',
    'carrier_escort',
    'diplomatic_cruiser',
    'long_range_cruiser',
    'fleet_carrier',
    'line_battleship',
    'heavy_cruiser',
  ];

  if (!difficulty || !VOID_ODYSSEY_JOURNEY_IDS.includes(difficulty)) {
    throw new HttpsError('invalid-argument', 'Invalid difficulty selection.');
  }

  if (typeof captainName !== 'string' || captainName.trim().length === 0) {
    throw new HttpsError('invalid-argument', "Captain's name is required.");
  }
  if (captainName.trim().length > 60) {
    throw new HttpsError('invalid-argument', "Captain's name must be 60 characters or fewer.");
  }
  if (!Array.isArray(captainTraits) || captainTraits.length < 2 || captainTraits.length > 3) {
    throw new HttpsError('invalid-argument', 'Select 2–3 captain traits.');
  }
  if (!captainTraits.every((t) => VOID_ODYSSEY_TRAIT_IDS.includes(t))) {
    throw new HttpsError('invalid-argument', 'Invalid captain trait selection.');
  }
  if (!shipClass || !validShipClasses.includes(shipClass)) {
    throw new HttpsError('invalid-argument', 'Invalid ship class selection.');
  }
  // Enforce journey/ship pairing server-side so a modified client cannot pick
  // any ship for any journey. Only journeys listed in VOID_ODYSSEY_JOURNEY_SHIPS
  // are restricted; others (e.g. `custom`) pass through.
  const allowedShipsForJourney = VOID_ODYSSEY_JOURNEY_SHIPS[difficulty];
  if (allowedShipsForJourney && !allowedShipsForJourney.includes(shipClass)) {
    throw new HttpsError('invalid-argument', 'Selected ship is not available for this journey.');
  }
  if (typeof shipName !== 'string' || shipName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Ship name is required.');
  }
  if (shipName.trim().length > 60) {
    throw new HttpsError('invalid-argument', 'Ship name must be 60 characters or fewer.');
  }
  if (typeof captainBackstory === 'string' && captainBackstory.length > 400) {
    throw new HttpsError('invalid-argument', 'Backstory must be 400 characters or fewer.');
  }

  // Ship's Company: the player chooses a role aboard a capital vessel instead
  // of naming the ship. Required when difficulty === 'ships_company', ignored otherwise.
  let resolvedCharacterRole = 'captain';
  if (difficulty === 'ships_company') {
    if (!captainRole || !VOID_ODYSSEY_SHIPS_COMPANY_ROLE_IDS.includes(captainRole)) {
      throw new HttpsError(
        'invalid-argument',
        "A valid role is required for the Ship's Company journey."
      );
    }
    resolvedCharacterRole = captainRole;
  }

  // ── Validate skills (optional for legacy callers; required when provided) ──
  const VALID_SKILL_IDS = [
    'piloting',
    'gunnery',
    'engineering',
    'medicine',
    'diplomacy',
    'intimidation',
    'deception',
    'investigation',
    'survival',
    'hacking',
    'stealth',
    'leadership',
    'xenology',
    'commerce',
    'perception',
  ];
  const SKILL_POINT_COSTS = { 1: 1, 2: 3, 3: 6 };
  const SKILL_POINT_BUDGET = 10;

  const normalizedSkills =
    captainSkills && typeof captainSkills === 'object' && !Array.isArray(captainSkills)
      ? captainSkills
      : null;

  if (normalizedSkills !== null) {
    for (const [id, level] of Object.entries(normalizedSkills)) {
      if (!VALID_SKILL_IDS.includes(id)) {
        throw new HttpsError('invalid-argument', `Unknown skill: ${id}`);
      }
      if (![1, 2, 3].includes(level)) {
        throw new HttpsError('invalid-argument', `Skill level must be 1, 2, or 3: ${id}`);
      }
    }
    const totalPoints = Object.values(normalizedSkills).reduce(
      (sum, lvl) => sum + (SKILL_POINT_COSTS[lvl] || 0),
      0
    );
    if (totalPoints !== SKILL_POINT_BUDGET) {
      throw new HttpsError(
        'invalid-argument',
        `Skills must total exactly ${SKILL_POINT_BUDGET} points (got ${totalPoints}).`
      );
    }
  }

  // ── Build AI prompt ────────────────────────────────────────
  const difficultyLabels = {
    frontier_explorer: 'Frontier Explorer (discovery-focused, lower danger)',
    smugglers_run: "Smuggler's Run (trade, intrigue, moral grey areas)",
    warpath: 'Warpath (combat-heavy, high stakes)',
    deep_salvage: 'Deep Salvage (atmospheric horror, salvage operations, resource scarcity)',
    first_contact: 'First Contact (cerebral, diplomatic, high-stakes communication)',
    the_long_haul: 'The Long Haul (intimate character-driven voyage, crew dynamics)',
    ships_company: "Ship's Company (capital warship crew role, institutional drama)",
    custom: 'Custom (flexible tone)',
  };
  const shipClassLabels = {
    light_freighter: 'Light Freighter (high cargo, moderate speed, light weapons)',
    scout_corvette: 'Scout Corvette (fast, great sensors, light cargo)',
    gunship: 'Gunship (heavy weapons, slow, low cargo)',
    salvage_rig: 'Salvage Rig (versatile, moderate stats, lots of quirks)',
    survey_vessel: 'Survey Vessel (scientific instruments, moderate cargo, non-combat)',
    blockade_runner: 'Blockade Runner (very fast, low profile, small cargo)',
    corvette_warfit: 'Corvette (warfit) (fast warship, balanced weapons and speed)',
    carrier_escort: 'Carrier Escort (heavy armor, point-defense, fleet support role)',
    diplomatic_cruiser: 'Diplomatic Cruiser (spacious, high presence, non-combat systems)',
    long_range_cruiser: 'Long-Range Cruiser (extended fuel, large crew quarters, self-sufficient)',
    fleet_carrier: 'Fleet Carrier (massive, fighter bays, command facilities)',
    line_battleship: 'Line Battleship (heaviest armor and weapons, slow)',
    heavy_cruiser: 'Heavy Cruiser (balanced capital ship, versatile weapons)',
  };

  const systemPrompt = `You are the narrator for Void Odyssey, an AI-driven space exploration game. You write in second person ("You step onto the bridge..."). The genre is hard-ish sci-fi with room for the mysterious — think Firefly meets Mass Effect: grounded crews, alien encounters, political tensions, moments of wonder.

You must respond with ONLY a valid JSON object. No prose outside the JSON. The schema is:
{
  "narrative": string (200-300 words, the opening story beat — sets the scene, introduces a situation or threat, ends on a hook),
  "crew": [
    {
      "name": string,
      "role": string (one of: pilot, engineer, medic, gunner, science, general),
      "species": string,
      "backstory": string (2-3 sentences),
      "personality": string[] (2-3 adjectives)
    }
  ],
  "startingLocationName": string (name of the starting location),
  "startingLocationType": string (one of: station, planet, moon, asteroid_field, derelict, anomaly),
  "startingLocationDescription": string (2-3 sentences),
  "startingLocationAtmosphere": string (1-3 mood keywords, e.g. "industrial_decay"),
  "questHook": string (one sentence describing the first quest hook that emerged from the opening scene),
  "availableActions": [
    { "id": string, "label": string (max 8 words), "type": string (one of: dialogue, navigation, combat, investigation) }
  ],
  "mood": string (one of: tense, calm, wonder, danger, tense_curiosity, wry, reverent)
}

Constraints:
- Generate exactly 2-3 crew members appropriate for the ship class
- Generate exactly 3-4 available actions
- The narrative must reference the captain by name and at least one crew member
- Honor the difficulty/tone setting in the narrative style and situation
- The starting location must feel specific and interesting, not generic`;

  const backstoryNote =
    captainBackstory && captainBackstory.trim()
      ? `Captain's backstory: ${captainBackstory.trim()}`
      : 'No backstory provided — you may invent a brief one consistent with the traits.';

  const userMessage = `Create the opening of a new Void Odyssey campaign with these player choices:

Difficulty/Tone: ${difficultyLabels[difficulty]}
Captain's Name: ${captainName.trim()}
Captain's Traits: ${captainTraits.join(', ')}
${backstoryNote}
Ship Class: ${shipClassLabels[shipClass]}
Ship Name: ${shipName.trim()}

Generate the opening scene, starting crew, location, quest hook, and first available actions.`;

  // ── Call Gemini API ─────────────────────────────────────────
  let aiResponse;
  try {
    aiResponse = await callGemini({
      modelName: VOID_ODYSSEY_MODEL,
      systemInstruction: systemPrompt,
      userMessage,
      maxOutputTokens: 4096,
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('Gemini API or parse error:', err);
    throw new HttpsError('internal', 'Failed to generate opening scene. Please try again.');
  }

  // ── Journey config (server-side copy for denormalization) ──
  const JOURNEY_CONFIGS = {
    frontier_explorer: {
      id: 'frontier_explorer',
      name: 'Frontier Explorer',
      tone: 'wonder_discovery',
      dangerLevel: 'low_moderate',
      themes: ['exploration', 'science', 'first_contact', 'moral_dilemmas'],
      narrativeDirectives: [
        'Emphasize awe, scale, and the uncanny',
        'Alien life should feel genuinely alien, not humanoid defaults',
        'Favor environmental puzzles and first-contact diplomacy over combat',
        'Let the player name discoveries (planets, species, anomalies)',
        'Crew conversations lean philosophical — what does it mean to be the first?',
      ],
    },
    smugglers_run: {
      id: 'smugglers_run',
      name: "Smuggler's Run",
      tone: 'gritty_morally_gray',
      dangerLevel: 'moderate',
      themes: ['trade', 'deception', 'reputation', 'rival_crews', 'authority_evasion', 'loyalty'],
      narrativeDirectives: [
        'Every deal should have hidden costs or complications',
        'Reputation and relationships matter more than raw firepower',
        'Authority figures are corrupt, incompetent, or both',
        'Moral choices rarely have clean answers',
        'Humor and wit balance out the grime',
      ],
    },
    warpath: {
      id: 'warpath',
      name: 'Warpath',
      tone: 'intense_tactical',
      dangerLevel: 'high',
      themes: ['military_campaigns', 'tactical_decisions', 'crew_survival', 'sacrifice'],
      narrativeDirectives: [
        'Combat should feel dangerous and consequential',
        'Tactical decisions matter — reward clever play',
        'Crew bonds are forged and tested under fire',
        'The cost of victory is always real',
        'Honor and duty conflict with survival',
      ],
    },
    deep_salvage: {
      id: 'deep_salvage',
      name: 'Deep Salvage',
      tone: 'atmospheric_horror',
      dangerLevel: 'moderate_high',
      themes: ['salvage_operations', 'mystery', 'resource_scarcity', 'crew_psychology'],
      narrativeDirectives: [
        'Atmosphere is everything — silence, darkness, the creak of dead hulls',
        'Derelicts should feel like crime scenes or archaeological digs, not empty loot boxes',
        'Each wreck has a story: crew logs, damage patterns, cargo manifests that do not add up',
        'Resource management is tight — every EVA costs air, every repair costs parts',
        'Horror is slow-burn and psychological, not jump-scare gore',
      ],
    },
    first_contact: {
      id: 'first_contact',
      name: 'First Contact',
      tone: 'cerebral_diplomatic',
      dangerLevel: 'low_combat_high_stakes',
      themes: ['diplomacy', 'xenolinguistics', 'cultural_exchange', 'ethical_dilemmas'],
      narrativeDirectives: [
        'Alien civilizations should be deeply thought out — biology shapes culture shapes communication',
        'Misunderstandings are the primary source of tension, not malice',
        "The player's crew includes specialists whose expertise matters",
        'Political pressure from home adds a second layer of conflict',
        'Let the player develop actual protocols and approaches; reward creative diplomacy',
      ],
    },
    the_long_haul: {
      id: 'the_long_haul',
      name: 'The Long Haul',
      tone: 'intimate_character_driven',
      dangerLevel: 'variable',
      themes: ['crew_relationships', 'resource_management', 'isolation', 'adaptation'],
      narrativeDirectives: [
        'Crew development is the core — relationships deepen, conflict simmers, bonds form',
        'Downtime scenes are as important as crisis scenes',
        'The ship itself becomes a character — modifications, wear, personality',
        'Each region of space the ship passes through should feel distinct',
        'The overarching question: will you make it, and who will you be when you arrive?',
      ],
    },
    ships_company: {
      id: 'ships_company',
      name: "Ship's Company",
      tone: 'intimate_and_massive',
      dangerLevel: 'high_scoped',
      themes: ['chain_of_command', 'personal_heroism', 'departmental_loyalty', 'cost_of_war'],
      narrativeDirectives: [
        "The player has a role — filter events, access, and conversations through that role's perspective",
        'The commanding officer is an NPC with personality, agenda, and blind spots',
        'Inter-departmental tension is a rich source of drama',
        'The player can act outside their role, but the institution will react',
        'The ship should feel alive — a community of hundreds with culture, hierarchy, and gossip',
      ],
    },
    custom: {
      id: 'custom',
      name: 'Custom Journey',
      tone: 'flexible',
      dangerLevel: 'variable',
      themes: [],
      narrativeDirectives: ['Adapt tone and danger level to match the story as it develops'],
    },
  };

  // ── Trait → stat bonus mapping (base stat: 50; cap: 100) ───
  const TRAIT_STAT_BONUSES = {
    resourceful: { intellect: 10 },
    cautious: { agility: 10 },
    silver_tongued: { presence: 10 },
    reckless: { agility: 10 },
    honorable: { presence: 10 },
    ruthless: { physique: 10 },
    curious: { intellect: 10 },
    paranoid: { agility: 10 },
    compassionate: { presence: 10 },
    calculating: { intellect: 10 },
    charismatic: { presence: 10 },
    stoic: { physique: 10 },
  };

  // Compute character stats from selected traits
  const characterStats = { physique: 50, agility: 50, intellect: 50, presence: 50 };
  captainTraits.forEach((trait) => {
    const bonuses = TRAIT_STAT_BONUSES[trait] || {};
    for (const [stat, val] of Object.entries(bonuses)) {
      characterStats[stat] = Math.min(100, characterStats[stat] + val);
    }
  });

  // ── Build Firestore data ───────────────────────────────────
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const userId = request.auth.uid;

  const gameRef = db.collection('void_odyssey_games').doc();
  const gameId = gameRef.id;

  const shipStats = SHIP_CLASS_DEFAULTS[shipClass] || SHIP_CLASS_DEFAULTS.light_freighter;

  const crew = aiResponse.crew || [];
  const activeCrew = crew.map((m, i) => ({
    id: `crew_${i}_${gameId.slice(0, 6)}`,
    name: m.name,
    role: m.role,
  }));

  const locationId = `loc_start_${gameId.slice(0, 8)}`;

  const gameDoc = {
    id: gameId,
    userId,
    name: `${shipName.trim()} — Campaign`,
    createdAt: now,
    updatedAt: now,
    turnCount: 0,
    status: 'active',

    ship: {
      name: shipName.trim(),
      class: shipClass,
      description: shipClassLabels[shipClass],
      ...shipStats,
      credits: 500,
      currentLocationId: locationId,
      currentSystemId: 'sys_origin',
      dockedAt: aiResponse.startingLocationType === 'station' ? locationId : null,
    },

    combatActive: false,
    difficulty,

    journey: JOURNEY_CONFIGS[difficulty],

    character: {
      name: captainName.trim(),
      role: resolvedCharacterRole,
      traits: captainTraits,
      backstory: captainBackstory ? captainBackstory.trim() : '',
      stats: characterStats,
      condition: {
        health: 100,
        healthMax: 100,
        stress: 0,
        statusEffects: [],
      },
      notes: '',
      skills: normalizedSkills || {},
    },

    player: {
      name: captainName.trim(),
      title: 'Captain',
      backstory: captainBackstory ? captainBackstory.trim() : '',
      reputation: {},
      traits: captainTraits,
    },

    crewCount: crew.length,
    activeCrew,
    activeQuestCount: 0,
    currentLocationName: aiResponse.startingLocationName || 'Unknown Location',
    currentLocationTags: [aiResponse.startingLocationType || 'unknown'],
  };

  const narrativeLogRef = db
    .collection('void_odyssey_games')
    .doc(gameId)
    .collection('narrative_log')
    .doc();

  const narrativeEntry = {
    id: narrativeLogRef.id,
    turnNumber: 0,
    timestamp: now,
    playerAction: { type: 'system', actionId: null, input: 'New game started' },
    narrative: aiResponse.narrative || '',
    mood: aiResponse.mood || 'calm',
    stateMutations: [],
    newEntityIds: [],
    locationId,
    summary: `Campaign began at ${aiResponse.startingLocationName || 'Unknown Location'}`,
    tags: ['game_start', shipClass, difficulty],
    availableActions: aiResponse.availableActions || [],
    compressed: false,
  };

  const locationRef = db
    .collection('void_odyssey_games')
    .doc(gameId)
    .collection('locations')
    .doc(locationId);

  const locationDoc = {
    id: locationId,
    systemId: 'sys_origin',
    name: aiResponse.startingLocationName || 'Unknown Location',
    type: aiResponse.startingLocationType || 'station',
    description: aiResponse.startingLocationDescription || '',
    firstImpressions: aiResponse.startingLocationDescription || '',
    atmosphere: aiResponse.startingLocationAtmosphere || '',
    environment: {
      gravity: 'standard',
      atmosphere: 'breathable',
      temperature: 'temperate',
      hazards: [],
    },
    dockable:
      aiResponse.startingLocationType === 'station' || aiResponse.startingLocationType === 'planet',
    services: [],
    residentEntityIds: [],
    pointsOfInterest: [],
    parentLocationId: null,
    connectedLocationIds: [],
    distanceFromCurrent: null,
    coordinates: { x: 0, y: 0, z: null },
    visitCount: 1,
    firstVisitedTurn: 0,
    lastVisitedTurn: 0,
    significantEvents: [{ turnNumber: 0, summary: 'Campaign started here' }],
    tags: [aiResponse.startingLocationType || 'unknown', 'starting_location'],
    faction: null,
    dangerLevel: difficulty === 'warpath' ? 'dangerous' : 'cautious',
    discovered: true,
    createdAt: now,
    updatedAt: now,
  };

  // Batch write: game doc + narrative log + location + crew members
  const batch = db.batch();
  batch.set(gameRef, gameDoc);
  batch.set(narrativeLogRef, narrativeEntry);
  batch.set(locationRef, locationDoc);

  crew.forEach(function (member, i) {
    const crewRef = db
      .collection('void_odyssey_games')
      .doc(gameId)
      .collection('crew')
      .doc(activeCrew[i].id);

    batch.set(crewRef, {
      id: activeCrew[i].id,
      name: member.name,
      role: member.role,
      species: member.species || 'human',
      status: 'active',
      backstory: member.backstory || '',
      personality: member.personality || [],
      skills: [],
      quirks: [],
      morale: 'content',
      loyalty: 50,
      healthStatus: 'healthy',
      currentAssignment: 'bridge',
      relationships: {},
      significantMoments: [],
      tags: [member.role, 'founding_crew'],
      joinedTurn: 0,
      portraitDescription: '',
      createdAt: now,
      updatedAt: now,
    });
  });

  // Seed starting star map
  const starMapSystems = buildStartingStarMap(
    aiResponse.startingLocationName || 'Origin System',
    difficulty
  );
  starMapSystems.forEach(function (system) {
    const sysRef = db
      .collection('void_odyssey_games')
      .doc(gameId)
      .collection('star_map')
      .doc(system.id);
    batch.set(sysRef, Object.assign({}, system, { createdAt: now, updatedAt: now }));
  });

  await batch.commit();

  // ── Return to client ───────────────────────────────────────
  return {
    gameId,
    narrative: aiResponse.narrative || '',
    availableActions: aiResponse.availableActions || [],
    crew: crew.map((m, i) => ({
      id: activeCrew[i].id,
      name: m.name,
      role: m.role,
      species: m.species || 'human',
      backstory: m.backstory || '',
    })),
    startingLocation: aiResponse.startingLocationName || 'Unknown Location',
    mood: aiResponse.mood || 'calm',
    ship: { name: shipName.trim(), class: shipClass, credits: 500, ...shipStats },
  };
});

// ── Delete a Void Odyssey campaign and all subcollections ──────
exports.voidOdysseyDeleteGame = onCall(async (request) => {
  // Auth + claim check
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('void-odyssey')) {
    throw new HttpsError('permission-denied', "You don't have access to Void Odyssey.");
  }

  const { gameId } = request.data || {};
  if (typeof gameId !== 'string' || gameId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'gameId is required.');
  }

  const db = getFirestore();
  const gameRef = db.collection('void_odyssey_games').doc(gameId.trim());
  const gameDoc = await gameRef.get();

  if (!gameDoc.exists) {
    throw new HttpsError('not-found', 'Campaign not found.');
  }

  // Verify ownership
  if (gameDoc.data().userId !== request.auth.uid) {
    throw new HttpsError('permission-denied', 'You can only delete your own campaigns.');
  }

  // Recursively delete the game document and all subcollections
  await db.recursiveDelete(gameRef);

  return { success: true };
});
