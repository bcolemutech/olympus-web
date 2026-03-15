'use strict';

const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { GoogleAuth } = require('google-auth-library');

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
