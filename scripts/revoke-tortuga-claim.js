#!/usr/bin/env node

/**
 * Revoke the tortuga custom claim from every Firebase Auth user that has it,
 * as part of L-007 teardown (#292) — the app and its Firestore rules are
 * removed, so the claim no longer gates anything. Every other claim (admin,
 * other apps) is preserved untouched.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/revoke-tortuga-claim.js
 *
 * Exit codes:
 *   0 - success
 *   1 - missing configuration
 *   3 - Firebase API error
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

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
  let nextPageToken;
  let scanned = 0;
  let updated = 0;

  do {
    const result = await auth.listUsers(1000, nextPageToken);
    for (const user of result.users) {
      scanned += 1;
      const claims = user.customClaims || {};
      const apps = Array.isArray(claims.apps) ? claims.apps : [];
      if (!apps.includes('tortuga')) continue;

      const newApps = apps.filter((id) => id !== 'tortuga');
      await auth.setCustomUserClaims(user.uid, { ...claims, apps: newApps });
      updated += 1;
    }
    nextPageToken = result.pageToken;
  } while (nextPageToken);

  console.log(`Scanned ${scanned} user(s). Revoked tortuga claim from ${updated} user(s).`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    const summary = [
      '## Tortuga Claim Revocation',
      '',
      `- Users scanned: ${scanned}`,
      `- Claims revoked: ${updated}`,
    ].join('\n');
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
  }
} catch (err) {
  console.error(`Firebase error (${err.code || 'unknown'}): ${err.message}`);
  process.exit(3);
}
