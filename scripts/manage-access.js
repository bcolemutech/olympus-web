#!/usr/bin/env node

/**
 * Manage app access custom claims for a Firebase Auth user.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/manage-access.js <email> <action> <app_ids>
 *
 * Arguments:
 *   email    - User email address
 *   action   - One of: grant, revoke, set
 *   app_ids  - Comma-separated app IDs (e.g., app1,app2,app3)
 *
 * Exit codes:
 *   0 - success
 *   1 - missing or invalid arguments
 *   3 - Firebase API error
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.env.EMAIL || process.argv[2];
const action = process.env.ACTION || process.argv[3];
const appIdsRaw = process.env.APP_IDS || process.argv[4];

if (!email || !action || !appIdsRaw) {
  console.error(
    "Error: email, action, and app_ids arguments are all required.",
  );
  console.error(
    "Usage: node scripts/manage-access.js <email> <action> <app_ids>",
  );
  process.exit(1);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailPattern.test(email)) {
  console.error(`Error: invalid email format: "${email}".`);
  process.exit(1);
}

const validActions = ["grant", "revoke", "set"];
if (!validActions.includes(action)) {
  console.error(
    `Error: invalid action "${action}". Must be one of: ${validActions.join(", ")}.`,
  );
  process.exit(1);
}

const newAppIds = appIdsRaw
  .split(",")
  .map((id) => id.trim())
  .filter((id) => id.length > 0);

if (newAppIds.length === 0) {
  console.error(
    "Error: no valid app IDs provided. Please provide comma-separated app IDs.",
  );
  process.exit(1);
}

const invalidAppIds = newAppIds.filter((id) => !/^[A-Za-z0-9_-]+$/.test(id));
if (invalidAppIds.length > 0) {
  console.error(
    `Error: invalid app ID(s): ${invalidAppIds.join(", ")}. App IDs must contain only letters, numbers, underscores, or hyphens.`,
  );
  process.exit(1);
}

const saKeyJson = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!saKeyJson) {
  console.error(
    "Error: FIREBASE_SERVICE_ACCOUNT environment variable is not set.",
  );
  process.exit(1);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(saKeyJson);
} catch {
  console.error("Error: FIREBASE_SERVICE_ACCOUNT is not valid JSON.");
  process.exit(1);
}

const app = initializeApp({ credential: cert(serviceAccount) });
const auth = getAuth(app);

try {
  const user = await auth.getUserByEmail(email);
  const currentClaims = user.customClaims || {};
  let apps = currentClaims.apps || [];

  if (action === "grant") {
    apps = [...new Set([...apps, ...newAppIds])];
  } else if (action === "revoke") {
    apps = apps.filter((id) => !newAppIds.includes(id));
  } else if (action === "set") {
    apps = newAppIds;
  }

  await auth.setCustomUserClaims(user.uid, { ...currentClaims, apps });

  console.log(`Access updated for ${email}`);
  console.log(`Action: ${action}`);
  console.log(`Apps: ${apps.join(", ")}`);
} catch (err) {
  if (err.code === "auth/user-not-found") {
    console.error(`Error: no user found with email "${email}".`);
    process.exit(3);
  }
  console.error(`Firebase error (${err.code || "unknown"}): ${err.message}`);
  process.exit(3);
}
