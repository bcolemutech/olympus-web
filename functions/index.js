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
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
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
