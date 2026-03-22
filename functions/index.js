'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { GoogleAuth } = require('google-auth-library');

const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');

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

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const VOID_ODYSSEY_MODEL = 'claude-sonnet-4-6';

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
    { "type": "quest_start", "quest": { "id": string, "title": string, "description": string } }
    { "type": "quest_update", "questId": string, "status": "in_progress"|"completed"|"failed", "note": string }
  ],
  "availableActions": [
    { "id": string, "label": string (max 8 words), "type": "dialogue"|"navigation"|"combat"|"investigation"|"freeform" }
  ],
  "newEntities": [
    { "id": string, "type": "npc"|"ship"|"object", "name": string, "description": string, "species": string | null, "role": string | null, "disposition": "friendly"|"neutral"|"suspicious"|"hostile", "dialogue_style": string | null, "tags": string[] }
  ],
  "summary": string (one sentence summary of what happened this turn)
}

Constraints:
- Generate exactly 3-4 available actions (always include one with type "freeform" and label "Do something else...")
- The narrative MUST continue from the current game state — do not contradict established facts
- Honor the difficulty/tone setting in your narrative style and stat changes
- Keep stat mutations reasonable: fuel should decrease by 1-5 per turn typically, combat causes 5-20 hull damage
- Reference crew members and the captain by name when relevant
- Do NOT generate mutations unless the action warrants them (e.g. dialogue rarely costs fuel)`;

const VOID_ODYSSEY_RATE_LIMITS = {
  HOURLY_SOFT: 15,
  HOURLY_HARD: 25,
  WEEKLY_SOFT: 150,
  WEEKLY_HARD: 200,
};

const SHIP_CLASS_DEFAULTS = {
  light_freighter: {
    hull: 70,
    hullMax: 70,
    shields: 30,
    shieldsMax: 30,
    fuel: 100,
    cargo: 0,
    cargoMax: 80,
  },
  scout_corvette: {
    hull: 55,
    hullMax: 55,
    shields: 45,
    shieldsMax: 45,
    fuel: 100,
    cargo: 0,
    cargoMax: 30,
  },
  gunship: {
    hull: 90,
    hullMax: 90,
    shields: 60,
    shieldsMax: 60,
    fuel: 100,
    cargo: 0,
    cargoMax: 20,
  },
  salvage_rig: {
    hull: 65,
    hullMax: 65,
    shields: 35,
    shieldsMax: 35,
    fuel: 100,
    cargo: 0,
    cargoMax: 60,
  },
};

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
 * Reads: last 5 narrative entries, active crew, current location.
 */
async function assembleContext(db, gameId, gameDoc) {
  const gameRef = db.collection('void_odyssey_games').doc(gameId);

  const currentLocId = (gameDoc.ship && gameDoc.ship.currentLocationId) || '';

  const [narrativeSnap, crewSnap, locationSnap, entitiesSnap, itemsSnap] = await Promise.all([
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
    crew.push({
      id: d.id,
      name: d.name,
      role: d.role,
      species: d.species || 'human',
      morale: d.morale || 'content',
      personality: d.personality || [],
      backstory: (d.backstory || '').slice(0, 200),
    });
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
    },
    player: {
      name: gameDoc.player.name,
      traits: gameDoc.player.traits || [],
    },
    difficulty: gameDoc.difficulty || 'frontier_explorer',
    location,
    entitiesAtLocation: entitiesHere,
    cargoItems,
    crew,
    recentHistory,
    activeQuests: gameDoc.activeQuests || [],
    turnCount: gameDoc.turnCount || 0,
  };
}

/**
 * Clamps a value to [min, max].
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * voidOdysseyTurn — executes a single turn in a Void Odyssey campaign.
 *
 * Data: { gameId: string, playerAction: { type, actionId, input } }
 * Returns: { narrative, mood, availableActions, shipStatus, turnCount, locationName, crewCount, rateLimitWarning }
 */
exports.voidOdysseyTurn = onCall({ secrets: [anthropicApiKey] }, async (request) => {
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

  // ── Build Claude prompt ────────────────────────────────────
  const userMessage = `Current game state:
${JSON.stringify(context, null, 2)}

Player action:
Type: ${playerAction.type}
Action: ${playerAction.actionId || 'custom'}
Input: ${playerAction.input}

Generate the next narrative beat, state mutations, and available actions.`;

  // ── Call Claude API ────────────────────────────────────────
  const apiKey = anthropicApiKey.value();
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY secret is empty');
    throw new HttpsError('internal', 'Game service is not configured.');
  }

  let claudeResponse;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: VOID_ODYSSEY_MODEL,
        max_tokens: 1500,
        system: VOID_ODYSSEY_TURN_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      console.error('Anthropic API error:', response.status, body);
      throw new HttpsError('internal', 'Failed to generate narrative. Please try again.');
    }

    const body = await response.json();
    const rawText = body.content && body.content[0] && body.content[0].text;
    if (!rawText) {
      throw new HttpsError('internal', 'Empty response from AI.');
    }

    const cleanedText = rawText
      .trim()
      .replace(/^\s*```(?:\s*json)?\s*/i, '')
      .replace(/\s*```\s*$/, '');
    claudeResponse = JSON.parse(cleanedText);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('Claude API or parse error:', err);
    throw new HttpsError('internal', 'Failed to generate narrative. Please try again.');
  }

  // ── Validate response fields ───────────────────────────────
  if (!claudeResponse.narrative || typeof claudeResponse.narrative !== 'string') {
    throw new HttpsError('internal', 'Invalid narrative response. Please try again.');
  }
  // Cap narrative length
  if (claudeResponse.narrative.length > 5000) {
    claudeResponse.narrative = claudeResponse.narrative.slice(0, 5000);
  }

  // Validate mood against known enum
  const VALID_MOODS = ['tense', 'calm', 'wonder', 'danger', 'tense_curiosity', 'wry', 'reverent'];
  claudeResponse.mood =
    typeof claudeResponse.mood === 'string' && VALID_MOODS.includes(claudeResponse.mood)
      ? claudeResponse.mood
      : 'calm';

  // Validate stateMutations
  claudeResponse.stateMutations = Array.isArray(claudeResponse.stateMutations)
    ? claudeResponse.stateMutations.slice(0, 20)
    : [];

  // Validate availableActions — ensure 3-4, always include freeform
  const VALID_ACTION_TYPES = ['dialogue', 'navigation', 'combat', 'investigation', 'freeform'];
  claudeResponse.availableActions = Array.isArray(claudeResponse.availableActions)
    ? claudeResponse.availableActions
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
  // Ensure at least one freeform action exists
  if (!claudeResponse.availableActions.some((a) => a.type === 'freeform')) {
    claudeResponse.availableActions.push({
      id: 'freeform_fallback',
      label: 'Do something else...',
      type: 'freeform',
    });
  }

  // Validate newEntities
  claudeResponse.newEntities = Array.isArray(claudeResponse.newEntities)
    ? claudeResponse.newEntities
        .filter((e) => e && typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 100)
        .slice(0, 10)
    : [];

  // Cap summary length
  claudeResponse.summary =
    typeof claudeResponse.summary === 'string' ? claudeResponse.summary.slice(0, 500) : '';

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

    for (const mut of claudeResponse.stateMutations) {
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
      }
    }

    // Persist new entities
    for (let i = 0; i < claudeResponse.newEntities.length; i++) {
      const entity = claudeResponse.newEntities[i];
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

    tx.update(gameRef, gameUpdate);

    // Narrative log entry — cap field sizes to avoid exceeding Firestore limits
    const narrativeLogRef = gameRef.collection('narrative_log').doc();
    const cappedMutations = validatedMutations.slice(0, 20);
    const cappedEntityIds = claudeResponse.newEntities
      .map((e) => e.id)
      .filter((id) => typeof id === 'string' && id.length > 0)
      .slice(0, 10);
    const cappedActions = claudeResponse.availableActions.slice(0, 5);

    tx.set(narrativeLogRef, {
      id: narrativeLogRef.id,
      turnNumber: newTurnCount,
      timestamp: now,
      playerAction: {
        type: playerAction.type,
        actionId: playerAction.actionId || null,
        input: playerAction.input,
      },
      narrative: claudeResponse.narrative,
      mood: claudeResponse.mood,
      stateMutations: cappedMutations,
      newEntityIds: cappedEntityIds,
      locationId: ship.currentLocationId || '',
      summary: claudeResponse.summary,
      tags: [playerAction.type, claudeResponse.mood],
      availableActions: cappedActions,
    });

    return { ship, currentLocationName, newTurnCount, validatedMutations };
  });

  // ── Compute crew count ─────────────────────────────────────
  const crewSnap = await gameRef.collection('crew').where('status', '==', 'active').get();

  // ── Return to client ───────────────────────────────────────
  return {
    narrative: claudeResponse.narrative,
    mood: claudeResponse.mood,
    availableActions: claudeResponse.availableActions,
    shipStatus: {
      hull: txResult.ship.hull,
      hullMax: txResult.ship.hullMax,
      shields: txResult.ship.shields,
      shieldsMax: txResult.ship.shieldsMax,
      fuel: txResult.ship.fuel,
    },
    turnCount: txResult.newTurnCount,
    locationName: txResult.currentLocationName,
    crewCount: crewSnap.size,
    rateLimitWarning: rateLimitResult.warning || null,
  };
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
exports.voidOdysseyNewGame = onCall({ secrets: [anthropicApiKey] }, async (request) => {
  // ── Auth + claim check ─────────────────────────────────────
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to play Void Odyssey.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('void-odyssey')) {
    throw new HttpsError('permission-denied', "You don't have access to Void Odyssey.");
  }

  // ── Input validation ───────────────────────────────────────
  const { difficulty, captainName, captainTraits, captainBackstory, shipClass, shipName } =
    request.data || {};

  const validDifficulties = ['frontier_explorer', 'smugglers_run', 'warpath', 'custom'];
  const validShipClasses = ['light_freighter', 'scout_corvette', 'gunship', 'salvage_rig'];

  if (!difficulty || !validDifficulties.includes(difficulty)) {
    throw new HttpsError('invalid-argument', 'Invalid difficulty selection.');
  }
  const validTraitIds = [
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

  if (typeof captainName !== 'string' || captainName.trim().length === 0) {
    throw new HttpsError('invalid-argument', "Captain's name is required.");
  }
  if (captainName.trim().length > 60) {
    throw new HttpsError('invalid-argument', "Captain's name must be 60 characters or fewer.");
  }
  if (!Array.isArray(captainTraits) || captainTraits.length < 2 || captainTraits.length > 3) {
    throw new HttpsError('invalid-argument', 'Select 2–3 captain traits.');
  }
  if (!captainTraits.every((t) => validTraitIds.includes(t))) {
    throw new HttpsError('invalid-argument', 'Invalid captain trait selection.');
  }
  if (!shipClass || !validShipClasses.includes(shipClass)) {
    throw new HttpsError('invalid-argument', 'Invalid ship class selection.');
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

  const apiKey = anthropicApiKey.value();
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY secret is empty');
    throw new HttpsError('internal', 'Game service is not configured.');
  }

  // ── Build Claude prompt ────────────────────────────────────
  const difficultyLabels = {
    frontier_explorer: 'Frontier Explorer (discovery-focused, lower danger)',
    smugglers_run: "Smuggler's Run (trade, intrigue, moral grey areas)",
    warpath: 'Warpath (combat-heavy, high stakes)',
    custom: 'Custom (flexible tone)',
  };
  const shipClassLabels = {
    light_freighter: 'Light Freighter (high cargo, moderate speed, light weapons)',
    scout_corvette: 'Scout Corvette (fast, great sensors, light cargo)',
    gunship: 'Gunship (heavy weapons, slow, low cargo)',
    salvage_rig: 'Salvage Rig (versatile, moderate stats, lots of quirks)',
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
    { "id": string, "label": string (max 8 words), "type": string (one of: dialogue, navigation, combat, investigation, freeform) }
  ],
  "mood": string (one of: tense, calm, wonder, danger, tense_curiosity, wry, reverent)
}

Constraints:
- Generate exactly 2-3 crew members appropriate for the ship class
- Generate exactly 3-4 available actions (always include one with type "freeform" and label "Do something else...")
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

  // ── Call Claude API ────────────────────────────────────────
  let claudeResponse;
  try {
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: VOID_ODYSSEY_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      const body = await response.json();
      console.error('Anthropic API error:', response.status, body);
      throw new HttpsError('internal', 'Failed to generate opening scene. Please try again.');
    }

    const body = await response.json();
    const rawText = body.content && body.content[0] && body.content[0].text;
    if (!rawText) {
      throw new HttpsError('internal', 'Empty response from AI.');
    }

    const cleanedText = rawText
      .trim()
      .replace(/^\s*```(?:\s*json)?\s*/i, '')
      .replace(/\s*```\s*$/, '');
    claudeResponse = JSON.parse(cleanedText);
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error('Claude API or parse error:', err);
    throw new HttpsError('internal', 'Failed to generate opening scene. Please try again.');
  }

  // ── Build Firestore data ───────────────────────────────────
  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const userId = request.auth.uid;

  const gameRef = db.collection('void_odyssey_games').doc();
  const gameId = gameRef.id;

  const shipStats = SHIP_CLASS_DEFAULTS[shipClass] || SHIP_CLASS_DEFAULTS.light_freighter;

  const crew = claudeResponse.crew || [];
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
      weapons: [],
      systems: [],
      features: [],
      currentLocationId: locationId,
      dockedAt: claudeResponse.startingLocationType === 'station' ? locationId : null,
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
    currentLocationName: claudeResponse.startingLocationName || 'Unknown Location',
    currentLocationTags: [claudeResponse.startingLocationType || 'unknown'],
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
    narrative: claudeResponse.narrative || '',
    mood: claudeResponse.mood || 'calm',
    stateMutations: [],
    newEntityIds: [],
    locationId,
    summary: `Campaign began at ${claudeResponse.startingLocationName || 'Unknown Location'}`,
    tags: ['game_start', shipClass, difficulty],
    availableActions: claudeResponse.availableActions || [],
  };

  const locationRef = db
    .collection('void_odyssey_games')
    .doc(gameId)
    .collection('locations')
    .doc(locationId);

  const locationDoc = {
    id: locationId,
    name: claudeResponse.startingLocationName || 'Unknown Location',
    type: claudeResponse.startingLocationType || 'station',
    description: claudeResponse.startingLocationDescription || '',
    firstImpressions: claudeResponse.startingLocationDescription || '',
    atmosphere: claudeResponse.startingLocationAtmosphere || '',
    environment: {
      gravity: 'standard',
      atmosphere: 'breathable',
      temperature: 'temperate',
      hazards: [],
    },
    dockable:
      claudeResponse.startingLocationType === 'station' ||
      claudeResponse.startingLocationType === 'planet',
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
    tags: [claudeResponse.startingLocationType || 'unknown', 'starting_location'],
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

  await batch.commit();

  // ── Return to client ───────────────────────────────────────
  return {
    gameId,
    narrative: claudeResponse.narrative || '',
    availableActions: claudeResponse.availableActions || [],
    crew: crew.map((m, i) => ({
      id: activeCrew[i].id,
      name: m.name,
      role: m.role,
      species: m.species || 'human',
      backstory: m.backstory || '',
    })),
    startingLocation: claudeResponse.startingLocationName || 'Unknown Location',
    mood: claudeResponse.mood || 'calm',
    ship: { name: shipName.trim(), class: shipClass },
  };
});
