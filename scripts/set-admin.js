#!/usr/bin/env node

/**
 * Grant or revoke the admin custom claim for a Firebase Auth user.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/set-admin.js <email> <action>
 *
 * Arguments:
 *   email  - User email address
 *   action - One of: grant, revoke
 *
 * Exit codes:
 *   0 - success
 *   1 - missing or invalid arguments
 *   3 - Firebase API error
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.env.EMAIL || process.argv[2];
const action = process.env.ACTION || process.argv[3];

if (!email || !action) {
  console.error('Error: email and action arguments are both required.');
  console.error('Usage: node scripts/set-admin.js <email> <action>');
  process.exit(1);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailPattern.test(email)) {
  console.error(`Error: invalid email format: "${email}".`);
  process.exit(1);
}

const validActions = ['grant', 'revoke'];
if (!validActions.includes(action)) {
  console.error(`Error: invalid action "${action}". Must be one of: ${validActions.join(', ')}.`);
  process.exit(1);
}

const saKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saKeyJson) {
  console.error('Error: FIREBASE_SERVICE_ACCOUNT environment variable is not set.');
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(saKeyJson);
} catch {
  console.error('Error: FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  process.exit(1);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

try {
  const user = await auth.getUserByEmail(email);
  const currentClaims = user.customClaims || {};
  const isGrant = action === 'grant';

  await auth.setCustomUserClaims(user.uid, { ...currentClaims, admin: isGrant });

  const status = isGrant ? 'granted' : 'revoked';
  console.log(`Admin claim ${status} for ${email}`);
} catch (err) {
  if (err.code === 'auth/user-not-found') {
    console.error(`Error: no user found with email "${email}".`);
    process.exit(3);
  }
  console.error(`Firebase error (${err.code || 'unknown'}): ${err.message}`);
  process.exit(3);
}
