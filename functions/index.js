'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');
const { runTurnPipeline, LoomTurnError } = require('./loom-turn');
const loomCanon = require('./loom-canon');
const frames = require('./loom-canon/frames');
const levels = require('./loom-canon/levels');
const { isPlayable, gradeWorld } = require('./loom-canon/grading');
const { withNeighbours } = require('./loom-turn/discovery');
const { arrivalPlace } = require('./loom-canon/town');
const maps = require('./loom-canon/maps');
const checks = require('./loom-canon/checks');
const combat = require('./loom-modules/combat');
const sheets = require('./loom-canon/sheets');
const creation = require('./loom-canon/creation');
const { rollDie } = require('./loom-turn/adjudicate');
const { mapView } = require('./loom-turn/map-view');
const { firstLook, seenRef } = require('./loom-turn/seen');
const { seenTownRef } = require('./loom-turn/town-seen');
const { makeSave } = require('./loom-models');

initializeApp();

// ── Inbound MCP (Initiative 1) ─────────────────────────
// Streamable HTTP MCP server + OAuth discovery, served on the primary origin
// via Hosting rewrites. See planning/initiative-1-mcp-foundation.md.
exports.mcpServer = require('./mcp').mcpServer;

// ── The Cartographer (C-5) ─────────────────────────────
// Upload an Azgaar map → parse, map, and load it as a draft Loom world; then
// publish it to the Loom. See functions/cartographer/service.js.
const cartographer = require('./cartographer/service');
let _cartographerService;
function cartographerService() {
  if (!_cartographerService) {
    const { getStorage } = require('firebase-admin/storage');
    const { createFirestoreWorldWriter } = require('./mcp/apps/cartographer/writer');
    _cartographerService = cartographer.createCartographerService({
      db: getFirestore(),
      bucket: getStorage().bucket(),
      writer: createFirestoreWorldWriter(() => getFirestore()),
    });
  }
  return _cartographerService;
}

// Large maps parse and load in seconds, but allow headroom for big exports.
exports.cartographerImport = onCall({ memory: '1GiB', timeoutSeconds: 300 }, async (request) => {
  const uid = cartographer.requireCartographer(request);
  return cartographerService().importUpload(uid, request.data || {});
});

exports.cartographerPublish = onCall(async (request) => {
  const uid = cartographer.requireCartographer(request);
  return cartographerService().publishWorld(uid, request.data || {});
});

// How built each world is (Layered Worlds, L-323 / #392), for the page.
exports.cartographerCompletion = onCall(async (request) => {
  cartographer.requireCartographer(request);
  return cartographerService().worldCompletion(request.data || {});
});

// A town's art (Layered Worlds, L-347 / #416): attach, replace or remove it.
exports.cartographerTownImage = onCall({ memory: '1GiB' }, async (request) => {
  const uid = cartographer.requireCartographer(request);
  return cartographerService().townImage(uid, request.data || {});
});

// A battle map's art (Layered Worlds, L-355 / #417): attach, replace or remove it.
exports.cartographerMapImage = onCall({ memory: '1GiB' }, async (request) => {
  const uid = cartographer.requireCartographer(request);
  return cartographerService().mapImage(uid, request.data || {});
});

// ── The image studio (L-700) ─────────────────────────────
// One shared library of images for Cartographer editors. See
// functions/studio/ and planning/the-image-studio.md.
let _studioService;
function studioService() {
  if (!_studioService) {
    const { getStorage } = require('firebase-admin/storage');
    const { FieldValue } = require('firebase-admin/firestore');
    _studioService = require('./studio/service').createStudioService({
      db: getFirestore(),
      bucket: getStorage().bucket(),
      FieldValue,
      auth: getAuth(),
      jobs: () => require('./studio').studio().jobs,
    });
  }
  return _studioService;
}

// Add an uploaded image (PNG, JPEG, WebP or SVG) to the library (L-701). It has
// room to make a big image's screen-sized copy (L-727), as the art callables do.
exports.studioUpload = onCall({ memory: '1GiB' }, async (request) => {
  const uid = cartographer.requireCartographer(request);
  return studioService().upload(uid, request.data || {});
});

// The month's spending, for the studio page's header, panel and banner (L-706).
exports.studioCosts = onCall(async (request) => {
  const uid = cartographer.requireCartographer(request);
  return studioService().costs(uid, request.data || {});
});

// Start generating an image from the page's form (L-707): returns the job at
// once; the page follows it in studio_jobs.
exports.studioGenerate = onCall(async (request) => {
  const uid = cartographer.requireCartographer(request);
  return studioService().generate(uid, request.data || {});
});

// Runs one generation job (L-707): the studio's Cloud Tasks queue, at most
// MAX_RUNNING at once (T5). A job is run once: no retries by the queue, so it
// is never charged twice. A job the model turns away as busy queues itself
// again, after a wait (L-396; functions/studio/jobs.js).
const { onTaskDispatched } = require('firebase-functions/v2/tasks');
exports.studioRunJob = onTaskDispatched(
  {
    retryConfig: { maxAttempts: 1 },
    rateLimits: { maxConcurrentDispatches: require('./studio/config').MAX_RUNNING },
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  async (req) => {
    await require('./studio').studio().jobs.run(req.data.jobId);
  }
);

// Grand Hall "connected assistants" (phase 1i): the signed-in user lists and
// revokes their own MCP connections. See functions/mcp/connections.js.
const mcpConnections = require('./mcp/connections');
let _connections;
function connectionsService() {
  if (!_connections) {
    const { store, audit } = require('./mcp').services();
    _connections = mcpConnections.createConnectionsService({ store, audit });
  }
  return _connections;
}

exports.mcpListConnections = onCall(async (request) => {
  const uid = mcpConnections.requireSignedIn(request);
  return { connections: await connectionsService().list(uid) };
});

exports.mcpRevokeConnection = onCall(async (request) => {
  const uid = mcpConnections.requireSignedIn(request);
  return connectionsService().revoke(uid, (request.data || {}).grantId);
});

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

/**
 * Validates the caller is signed in and holds the `loom` app claim. Returns
 * the caller's uid, or throws HttpsError.
 */
function requireLoomAuth(request) {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'You must be signed in to play The Loom.');
  }
  const tokenApps = request.auth.token.apps;
  if (!Array.isArray(tokenApps) || !tokenApps.includes('loom')) {
    throw new HttpsError('permission-denied', "You don't have access to The Loom.");
  }
  return request.auth.uid;
}

/**
 * loomPlayTurn — runs one turn of The Loom's turn pipeline (design doc §5,
 * §7). Callable by any signed-in user with the `loom` app claim who owns the
 * target save; the client only ever receives the narration/summary contract,
 * never raw state authority.
 *
 * Data: { worldId: string, saveId: string, actionText: string }
 *    or { worldId, saveId, action: { verb: 'move', target: locationId } } — a
 *       move made on the world map (L-331 / #393), which skips INTERPRET
 *    or { worldId, saveId, action: { verb: 'move', cell: { x, y } } } — a step
 *       on a battle map (L-351), likewise
 *    or { worldId, saveId, action: { verb: 'end-turn' } } — ends the turn,
 *       refilling movement and the action, with no model call (L-611 / #441)
 *    or { worldId, saveId, action: { verb: 'continue' } } — walks the plan
 *       kept from an earlier move (L-613 / #443)
 *    or { worldId, saveId, action: { verb: 'door', door, open } } — opens
 *       (open true) or closes a door beside the player (L-625 / #450)
 *    or { worldId, saveId, action: { verb: 'move', point: { x, y } } } — a walk
 *       to a point on the street of a town with ground (L-662 / #469); there,
 *       a move to a place walks to its door and goes in
 *    or { worldId, saveId, action: { verb: 'walk-there', point | target } } —
 *       walks, ending each turn, until it arrives (L-662)
 *    or { worldId, saveId, action: { verb: 'attack', target, attack?, subdue? } }
 *       — attacks someone on the battle map (L-822): with one of the
 *       character's attacks (by id; the first without), to knock out when
 *       subdue; no model reads it
 *    or { worldId, saveId, action: { verb: 'rest', rest: 'short' | 'long' } } — a
 *       short or long rest (L-827), by the system's rests
 *    or { worldId, saveId, action: { verb: 'dash' | 'dodge' | 'withdraw' | 'stand' } },
 *       { verb: 'ready', attack?, target? } or { verb: 'use', feature } — a
 *       fight's other actions (L-823); no model reads them but Use's
 * A walk in town is worked out without the model too, and returns step:
 * { townPoint, ap, plan, lines } (plus `entered`, and `turns` for
 * walk-there).
 * A step on a battle map (a cell, or continue) is worked out without the
 * model and also returns step: { cell, ap, plan, lines }.
 * Returns: { narration: string, stateSummary: string, suggestedActions: string[] }
 */
exports.loomPlayTurn = onCall(async (request) => {
  const uid = requireLoomAuth(request);

  const { worldId, saveId, actionText, action } = request.data || {};

  if (typeof worldId !== 'string' || worldId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'worldId is required.');
  }
  if (typeof saveId !== 'string' || saveId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'saveId is required.');
  }
  if (action !== undefined && action !== null) {
    if (actionText !== undefined) {
      throw new HttpsError('invalid-argument', 'Send actionText or action, not both.');
    }
    const isCell = (cell) =>
      Boolean(cell) &&
      typeof cell === 'object' &&
      [cell.x, cell.y].every((n) => Number.isInteger(n) && n >= 0 && n < maps.MAX_SIDE);
    const hasTarget = typeof action.target === 'string';
    // A point in a town's 0–1000 square (L-662).
    const isPoint = (point) =>
      Boolean(point) &&
      typeof point === 'object' &&
      [point.x, point.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1000);
    const hasPoint = action.point !== undefined;
    const bare =
      typeof action === 'object' &&
      (action.verb === 'end-turn' || action.verb === 'continue' || action.verb === 'confirm');
    // One of the GM's suggestions, chosen (#673): its text, and its verb and
    // target when it named them.
    const suggestion =
      typeof action === 'object' &&
      action.verb === 'suggested' &&
      typeof action.text === 'string' &&
      action.text.trim().length > 0 &&
      action.text.length <= 200 &&
      (action.act === undefined ||
        (Boolean(action.act) &&
          typeof action.act === 'object' &&
          typeof action.act.verb === 'string' &&
          /^[a-z][a-z_-]{1,20}$/.test(action.act.verb) &&
          (action.act.target === undefined ||
            (typeof action.act.target === 'string' &&
              /^[A-Za-z0-9_:-]{1,80}$/.test(action.act.target)))));
    const door =
      typeof action === 'object' &&
      action.verb === 'door' &&
      typeof action.door === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,39}$/.test(action.door) &&
      typeof action.open === 'boolean';
    const goodTarget = hasTarget && /^[A-Za-z0-9_-]{1,80}$/.test(action.target);
    const moving =
      typeof action === 'object' &&
      (action.verb === 'move' || action.verb === 'walk-there') &&
      (hasPoint
        ? isPoint(action.point)
        : hasTarget
          ? goodTarget
          : action.verb === 'move' && isCell(action.cell));
    // An attack chosen on the map (L-822).
    const attacking =
      typeof action === 'object' &&
      action.verb === 'attack' &&
      goodTarget &&
      (action.attack === undefined ||
        (typeof action.attack === 'string' &&
          /^[A-Za-z][A-Za-z0-9_-]{0,39}$/.test(action.attack))) &&
      (action.subdue === undefined || typeof action.subdue === 'boolean');
    // A short or long rest (L-827).
    const resting =
      typeof action === 'object' &&
      action.verb === 'rest' &&
      ['short', 'long'].includes(action.rest);
    // Dash, Dodge, Withdraw, Ready and Use (L-823).
    const id = (v) => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(v);
    const tactic =
      typeof action === 'object' &&
      (['dash', 'dodge', 'withdraw', 'stand'].includes(action.verb) ||
        (action.verb === 'ready' &&
          (action.attack === undefined || id(action.attack)) &&
          (action.target === undefined || goodTarget)) ||
        (action.verb === 'use' && id(action.feature)));
    // "What's here?" on a battle map (#672): a square, or a door.
    const looking =
      typeof action === 'object' &&
      action.verb === 'look' &&
      (action.door !== undefined
        ? typeof action.door === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(action.door)
        : isCell(action.cell));
    // Taking a level offered at a long rest (L-843): the choices are checked
    // by the advancement module.
    const levelling =
      typeof action === 'object' &&
      action.verb === 'levelUp' &&
      action.choices !== null &&
      typeof action.choices === 'object' &&
      !Array.isArray(action.choices) &&
      JSON.stringify(action.choices).length <= 2000;
    if (
      !bare &&
      !door &&
      !moving &&
      !attacking &&
      !resting &&
      !tactic &&
      !looking &&
      !suggestion &&
      !levelling
    ) {
      throw new HttpsError(
        'invalid-argument',
        'action must be { verb: "move", target: <place id> }, { verb: "move", cell: { x, y } }, ' +
          '{ verb: "move", point: { x, y } }, { verb: "walk-there", point | target }, ' +
          '{ verb: "continue" }, { verb: "door", door: <door id>, open: true | false }, ' +
          '{ verb: "attack", target: <character id>, attack?, subdue? }, ' +
          '{ verb: "rest", rest: "short" | "long" }, { verb: "dash" | "dodge" | "withdraw" | "stand" }, ' +
          '{ verb: "ready", attack?, target? }, { verb: "use", feature: <feature id> }, ' +
          '{ verb: "look", cell: { x, y } | door: <door id> }, ' +
          '{ verb: "suggested", text, act?: { verb, target? } }, { verb: "confirm" }, ' +
          '{ verb: "levelUp", choices: { attributes?, skills?, traits?, attacks? } } ' +
          'or { verb: "end-turn" }.'
      );
    }
  } else {
    if (typeof actionText !== 'string' || actionText.trim().length === 0) {
      throw new HttpsError('invalid-argument', 'actionText is required.');
    }
    if (actionText.length > 2000) {
      throw new HttpsError('invalid-argument', 'actionText must be 2000 characters or fewer.');
    }
  }

  try {
    return await runTurnPipeline({
      db: getFirestore(),
      uid,
      worldId: worldId.trim(),
      saveId: saveId.trim(),
      ...(action
        ? {
            action:
              action.verb === 'levelUp'
                ? { verb: 'levelUp', choices: action.choices }
                : action.verb === 'suggested'
                  ? {
                      verb: 'suggested',
                      text: action.text.trim(),
                      ...(action.act
                        ? {
                            act: {
                              verb: action.act.verb,
                              ...(action.act.target ? { target: action.act.target } : {}),
                            },
                          }
                        : {}),
                    }
                  : action.verb === 'look'
                    ? action.door !== undefined
                      ? { verb: 'look', door: action.door }
                      : { verb: 'look', cell: { x: action.cell.x, y: action.cell.y } }
                    : action.verb === 'door'
                      ? { verb: 'door', door: action.door, open: action.open }
                      : action.verb === 'rest'
                        ? { verb: 'rest', rest: action.rest }
                        : ['dash', 'dodge', 'withdraw', 'stand', 'ready', 'use'].includes(
                              action.verb
                            )
                          ? {
                              verb: action.verb,
                              ...(action.attack ? { attack: action.attack } : {}),
                              ...(action.target ? { target: action.target } : {}),
                              ...(action.feature ? { feature: action.feature } : {}),
                            }
                          : action.verb === 'attack'
                            ? {
                                verb: 'attack',
                                target: action.target,
                                ...(action.attack ? { attack: action.attack } : {}),
                                ...(action.subdue ? { subdue: true } : {}),
                              }
                            : action.verb === 'end-turn' ||
                                action.verb === 'continue' ||
                                action.verb === 'confirm'
                              ? { verb: action.verb }
                              : action.point !== undefined
                                ? {
                                    verb: action.verb,
                                    point: { x: action.point.x, y: action.point.y },
                                  }
                                : typeof action.target === 'string'
                                  ? { verb: action.verb, target: action.target }
                                  : { verb: 'move', cell: { x: action.cell.x, y: action.cell.y } },
          }
        : { actionText: actionText.trim() }),
    });
  } catch (err) {
    if (err instanceof LoomTurnError) {
      throw new HttpsError(err.code, err.message);
    }
    console.error('loomPlayTurn error:', err);
    throw new HttpsError('internal', 'Failed to process turn.');
  }
});

/**
 * loomGetMap — what a save may see of its world's map (Layered Worlds §7;
 * L-331 / #393): its discovered places with positions, the links between
 * them, which are open to players, where it stands, and the map image. The
 * world's entity subcollections stay unreadable to Loom clients; this is the
 * only way the map reaches them, and it never includes undiscovered places.
 *
 * In a settlement with a town layout it also returns that town, for the town
 * view (L-345 / #399): its places, links, ways in and out, and routes out. On
 * a battle map it returns what the save has seen of that map, with the fog,
 * for the grid view (L-354 / #403; L-633 / #456): nothing unseen is sent.
 * Always, the save's turn: movement left, the action, the turn number
 * (L-611 / #441).
 *
 * Data: { worldId: string, saveId: string }
 * Returns: { worldId, name, here, places[], links[], town, battleMap, turn, time, rules,
 *            character, map }
 */
exports.loomGetMap = onCall(async (request) => {
  const uid = requireLoomAuth(request);
  const { worldId, saveId, peek } = request.data || {};
  if (typeof worldId !== 'string' || worldId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'worldId is required.');
  }
  if (typeof saveId !== 'string' || saveId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'saveId is required.');
  }
  if (peek !== undefined && peek !== null && (typeof peek !== 'string' || !peek)) {
    throw new HttpsError('invalid-argument', 'peek must be a map id.');
  }

  const db = getFirestore();
  const snap = await db.collection('loom_saves').doc(saveId.trim()).get();
  if (!snap.exists) throw new HttpsError('not-found', 'Save not found.');
  const stored = snap.data();
  if (stored.ownerUid !== uid) throw new HttpsError('permission-denied', 'This is not your save.');
  if (stored.worldId !== worldId.trim()) {
    throw new HttpsError('failed-precondition', 'worldId does not match this save.');
  }
  const loaded = await loomCanon.loadWorld(worldId.trim(), { db });
  if (!loaded) throw new HttpsError('not-found', 'Unknown world.');
  // The world from where the save stands (L-903): the map it is on.
  const play = frames.playWorld(loaded);
  const framed = frames.frameOf(play, stored);
  const at = framed.at || frames.atOf(framed.view, framed.save);
  // A peek at a region map above (L-904; map levels UI1): that map, from the
  // place on it the save's path goes through.
  if (peek && peek !== framed.view.frame.mapId) {
    const peeked = frames.peekAt(play, at, peek);
    if (!peeked) throw new HttpsError('invalid-argument', 'That map is not on your trail.');
    const there = { ...framed.save, ...peeked.fields };
    const world = combat.figures.withFigures(peeked.view, there);
    return {
      ...mapView(world, sheets.withAp(there, checks.systemOf(world), world), null, null),
      mapId: peek,
      peek: true,
      trail: frames.trailOf(play, at),
    };
  }
  // The world as this save sees it (L-824): its map's figures, and everyone
  // where the save has them.
  const canonWorld = combat.figures.withFigures(framed.view, framed.save);
  // The character's pool of action points, worked out for the world's system (L-811; L-832).
  const save = sheets.withAp(framed.save, checks.systemOf(canonWorld), canonWorld);
  // On a battle map, only what the save has seen of it is sent (L-633).
  const record = save.mapId ? await seenRef(snap.ref, save.mapId).get() : null;
  // In a town, what the save has seen of it, for its fog (L-672).
  const townRecord = save.location ? await seenTownRef(snap.ref, save.location).get() : null;
  const view = mapView(
    canonWorld,
    save,
    record && record.exists ? record.data() : null,
    townRecord && townRecord.exists ? townRecord.data() : null
  );
  // The map it stands on, and the trail (L-903; map levels UI1): each map
  // above it, the one it is on last.
  return {
    ...view,
    mapId: canonWorld.frame.mapId,
    trail: frames.trailOf(canonWorld, at),
  };
});

/**
 * loomWorldRatings — each published world's band, for the Loom's world list
 * (planning/the-loom-grading.md §4.4, E4; L-694 / #555).
 *
 * Players see the band's name only (playable, rich, vivid or legendary):
 * never the score, a checklist or criteria. Worlds that aren't published, or
 * don't exist, are left out. Grades are computed here, never stored, as
 * everywhere else.
 *
 * Data: { worldIds: string[] } (up to 20)
 * Returns: { ratings: { [worldId]: band } }
 */
const MAX_RATED_WORLDS = 20;
const RATED_WORLD_ID = /^[a-z0-9-]{1,64}$/;
exports.loomWorldRatings = onCall(async (request) => {
  requireLoomAuth(request);
  const { worldIds } = request.data || {};
  if (
    !Array.isArray(worldIds) ||
    worldIds.length > MAX_RATED_WORLDS ||
    !worldIds.every((id) => typeof id === 'string' && RATED_WORLD_ID.test(id))
  ) {
    throw new HttpsError(
      'invalid-argument',
      `worldIds must be up to ${MAX_RATED_WORLDS} world ids.`
    );
  }
  const db = getFirestore();
  const ratings = {};
  for (const id of new Set(worldIds)) {
    // Published worlds only (loadWorld's default for play).
    const world = await loomCanon.loadWorld(id, { db });
    const summary = world && gradeWorld(world);
    if (summary && summary.graded) ratings[id] = summary.band;
  }
  return { ratings };
});

// Rolled scores waiting to be used to make a character (L-812): server only.
const CREATION_ROLLS = 'loom_creation_rolls';

/**
 * loomCreateSave — creates a new save for the caller in a given world,
 * initializing the character from that world's canon defaults (starting
 * location, starting abilities). Callable by any signed-in user with the
 * `loom` app claim.
 *
 * The character is made by the world's system's method (L-812): `creation`
 * is the player's choices, `{ attributes, skills, traits, rollId? }`, checked
 * by ./loom-canon/creation.js and refused with each reason (rolled scores
 * must be those loomRollCharacter rolled, `rollId`). A world with a premade
 * character (`rules.startingSheet`, set over MCP) uses it; with neither, the
 * system's defaults (L-811).
 *
 * Data: { worldId: string, name: string, characterName: string, creation?: object }
 * Returns: { saveId: string }
 */
exports.loomCreateSave = onCall(async (request) => {
  const uid = requireLoomAuth(request);

  const { worldId, name, characterName, creation: choices } = request.data || {};

  if (typeof worldId !== 'string' || worldId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'worldId is required.');
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'name is required.');
  }
  if (name.length > 200) {
    throw new HttpsError('invalid-argument', 'name must be 200 characters or fewer.');
  }
  if (typeof characterName !== 'string' || characterName.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'characterName is required.');
  }
  if (characterName.length > 200) {
    throw new HttpsError('invalid-argument', 'characterName must be 200 characters or fewer.');
  }

  const db = getFirestore();
  // Static or Firestore-backed; drafts aren't playable until published.
  const loaded = await loomCanon.loadWorld(worldId.trim(), { db });
  if (!loaded) {
    throw new HttpsError('not-found', 'Unknown world.');
  }
  // The start is a place on any region map (L-903): the world is seen from
  // that map (../loom-canon/frames.js).
  const canonWorld = startFrame(loaded);
  // New games begin at the starting location, so it must be open to players
  // (Layered Worlds gate, L-322 / #391).
  const start = canonWorld.rules && canonWorld.locations[canonWorld.rules.startingLocationId];
  if (!start || start.retired || !isPlayable(canonWorld, start)) {
    throw new HttpsError('failed-precondition', "This world isn't ready to play yet.");
  }

  const saveRef = db.collection('loom_saves').doc();

  // The character's sheet (L-811, L-812): premade, made, or the defaults.
  const system = checks.systemOf(canonWorld);
  const startingTraits = (canonWorld.rules && canonWorld.rules.startingAbilities) || [];
  const premade = canonWorld.rules && canonWorld.rules.startingSheet;
  let sheet = sheets.defaultSheet(system, { traits: startingTraits });
  let rollRef = null;
  if (premade) {
    sheet = sheets.withPool(system, premade);
  } else if (choices !== undefined && choices !== null) {
    if (typeof choices !== 'object' || Array.isArray(choices)) {
      throw new HttpsError('invalid-argument', 'creation must be an object.');
    }
    let rolled = null;
    if ((system.creation || {}).method === 'rolling') {
      if (typeof choices.rollId !== 'string' || !choices.rollId) {
        throw new HttpsError('invalid-argument', 'Roll the scores first.');
      }
      rollRef = db.collection(CREATION_ROLLS).doc(choices.rollId);
      const roll = await rollRef.get();
      if (!roll.exists || roll.data().uid !== uid || roll.data().worldId !== worldId.trim()) {
        throw new HttpsError('failed-precondition', 'Those rolls are not yours; roll again.');
      }
      rolled = roll.data().values;
    }
    const built = creation.buildSheet(system, choices, { rolled, startingTraits });
    if (built.errors.length) throw new HttpsError('invalid-argument', built.errors.join(' '));
    sheet = built.sheet;
  }

  const startPlace = arrivalPlace(canonWorld, start.id, null);
  const save = makeSave({
    ownerUid: uid,
    worldId: worldId.trim(),
    name: name.trim(),
    character: { name: characterName.trim(), sheet },
    location: canonWorld.rules && canonWorld.rules.startingLocationId,
    // A start with a town layout (L-342) begins at its first open entrance,
    // and on its battle map if it has one (L-351).
    placeId: startPlace ? startPlace.id : null,
    ...Object.fromEntries(
      maps.arrivalMutations(canonWorld, startPlace || start, {}).map((m) => [m.path, m.value])
    ),
    // The world map shows what a save has discovered (L-331): at first, the
    // start and the places it connects to.
    discovered: withNeighbours(canonWorld, start.id),
    // Where it has been, and the ways in and out it knows there (L-381):
    // the start, and the way in it begins at.
    visited: [start.id],
    waysKnown: { [start.id]: startPlace ? [startPlace.id] : [] },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  // Where it stands in the levels model (L-903).
  const at = frames.atOf(canonWorld, save);
  if (at) save.at = at;

  // A start on a battle map sees what's in sight from its entry (L-632).
  const seen = firstLook(saveRef, canonWorld, save);

  try {
    const batch = db.batch();
    batch.set(saveRef, save);
    if (seen) batch.set(seen.ref, seen.value);
    if (rollRef) batch.delete(rollRef); // rolls are used once
    await batch.commit();
  } catch (err) {
    console.error('loomCreateSave error:', err);
    throw new HttpsError('internal', 'Failed to create save.');
  }

  return { saveId: saveRef.id };
});

// The world seen from the region map its start is on (L-903): the top map's
// frame when the start isn't a place of the model.
function startFrame(loaded) {
  const play = frames.playWorld(loaded);
  const startId = play.rules && play.rules.startingLocationId;
  const path = startId ? levels.pathTo(play, startId) : null;
  const last = path && path[path.length - 1];
  if (last && (levels.mapOf(play, last.mapId) || {}).kind === 'region') {
    return frames.viewFor(play, last.mapId, path.slice(0, -1));
  }
  return frames.viewFor(play, play.topMapId, []);
}

// A published world a player may start a game in, or a refusal.
async function playableWorld(worldId) {
  if (typeof worldId !== 'string' || worldId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'worldId is required.');
  }
  const canonWorld = await loomCanon.loadWorld(worldId.trim(), { db: getFirestore() });
  if (!canonWorld) throw new HttpsError('not-found', 'Unknown world.');
  return canonWorld;
}

/**
 * loomCreationRules — how a new character is made in a world (L-812;
 * game systems CS5), for the new-game form: the system's name and words,
 * its method and settings, each attribute with the modifier every score
 * gives, the skills and traits to choose from and how many; `premade` when
 * the world gives every new game its own character, so there's nothing to
 * choose.
 *
 * Data: { worldId: string }
 * Returns: { system: { id, name, words }, creation, premade }
 */
exports.loomCreationRules = onCall(async (request) => {
  requireLoomAuth(request);
  const canonWorld = await playableWorld((request.data || {}).worldId);
  const system = checks.systemOf(canonWorld);
  return {
    system: { id: system.id, name: system.name, words: system.words || {} },
    creation: creation.creationView(system),
    premade: Boolean(canonWorld.rules && canonWorld.rules.startingSheet),
  };
});

/**
 * loomRollCharacter — rolls a new character's scores with the server's dice
 * (L-812), for a world whose system makes characters by rolling: one score
 * per attribute, each with its dice for a roll card. They are kept for
 * loomCreateSave, which takes them by `rollId` once; rolling again starts a
 * new set.
 *
 * Data: { worldId: string }
 * Returns: { rollId, rolls: [{ total, line, dice }] }
 */
exports.loomRollCharacter = onCall(async (request) => {
  const uid = requireLoomAuth(request);
  const { worldId } = request.data || {};
  const canonWorld = await playableWorld(worldId);
  const system = checks.systemOf(canonWorld);
  if ((system.creation || {}).method !== 'rolling') {
    throw new HttpsError('failed-precondition', "This world's characters aren't rolled.");
  }
  const rolls = creation.rollAttributes(system, rollDie);
  const ref = getFirestore().collection(CREATION_ROLLS).doc();
  await ref.set({
    uid,
    worldId: worldId.trim(),
    values: rolls.map((r) => r.total),
    rolls,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { rollId: ref.id, rolls };
});

/**
 * loomDeleteSave — deletes one of the caller's own saves, including its
 * loom_turns event log and what it has seen on each map (`seen`; L-632)
 * (Firestore does not cascade-delete subcollections).
 * Callable by any signed-in user with the `loom` app claim who owns the save.
 *
 * Data: { saveId: string }
 * Returns: { success: true }
 */
exports.loomDeleteSave = onCall(async (request) => {
  const uid = requireLoomAuth(request);

  const { saveId } = request.data || {};
  if (typeof saveId !== 'string' || saveId.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'saveId is required.');
  }

  const db = getFirestore();
  const saveRef = db.collection('loom_saves').doc(saveId.trim());
  const saveSnap = await saveRef.get();

  if (!saveSnap.exists) {
    throw new HttpsError('not-found', 'Save not found.');
  }
  if (saveSnap.data().ownerUid !== uid) {
    throw new HttpsError('permission-denied', 'This is not your save.');
  }

  try {
    const [turnsSnap, seenSnap] = await Promise.all([
      saveRef.collection('loom_turns').get(),
      saveRef.collection('seen').get(),
    ]);
    const batch = db.batch();
    turnsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    seenSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(saveRef);
    await batch.commit();
  } catch (err) {
    console.error('loomDeleteSave error:', err);
    throw new HttpsError('internal', 'Failed to delete save.');
  }

  return { success: true };
});
