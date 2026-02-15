#!/usr/bin/env node

/**
 * Add or update an app in the Firestore App Registry.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/add-app.js <app_id> <name> <icon> <type> <description> [url_or_path] [order]
 *
 * Environment variables (override positional args):
 *   APP_ID      - Document ID in the apps collection
 *   APP_NAME    - Display name
 *   APP_ICON    - Emoji icon
 *   APP_TYPE    - 'embedded' or 'redirect'
 *   APP_DESC    - Short description
 *   APP_URL     - URL (redirect) or path (embedded)
 *   APP_ORDER   - Display order (integer, default 0)
 *
 * Exit codes:
 *   0 - success
 *   1 - missing or invalid arguments
 *   3 - Firebase API error
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const appId = process.env.APP_ID || process.argv[2];
const appName = process.env.APP_NAME || process.argv[3];
const appIcon = process.env.APP_ICON || process.argv[4];
const appType = process.env.APP_TYPE || process.argv[5];
const appDesc = process.env.APP_DESC || process.argv[6];
const appUrl = process.env.APP_URL || process.argv[7] || '';
const appOrder = parseInt(process.env.APP_ORDER || process.argv[8] || '0', 10);

if (!appId || !appName || !appIcon || !appType || !appDesc) {
  console.error('Error: app_id, name, icon, type, and description are all required.');
  console.error(
    'Usage: node scripts/add-app.js <app_id> <name> <icon> <type> <description> [url_or_path] [order]'
  );
  process.exit(1);
}

if (!/^[A-Za-z0-9_-]+$/.test(appId)) {
  console.error(
    `Error: invalid app ID "${appId}". Must contain only letters, numbers, underscores, or hyphens.`
  );
  process.exit(1);
}

const validTypes = ['embedded', 'redirect'];
if (!validTypes.includes(appType)) {
  console.error(`Error: invalid type "${appType}". Must be one of: ${validTypes.join(', ')}.`);
  process.exit(1);
}

if (appType === 'redirect' && !appUrl) {
  console.error('Error: redirect apps require a non-empty URL (APP_URL).');
  process.exit(1);
}

if (isNaN(appOrder)) {
  console.error('Error: order must be a valid integer.');
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
const db = getFirestore(app);

const docData = {
  name: appName,
  description: appDesc,
  icon: appIcon,
  type: appType,
  enabled: true,
  order: appOrder,
};

if (appType === 'redirect') {
  docData.url = appUrl;
  docData.path = FieldValue.delete();
} else {
  docData.path = appUrl;
  docData.url = FieldValue.delete();
}

try {
  await db.collection('apps').doc(appId).set(docData, { merge: true });
  console.log(`App "${appName}" written to apps/${appId}`);
  console.log(`Type: ${appType}`);
  console.log(`Order: ${appOrder}`);
} catch (err) {
  console.error(`Firestore error (${err.code || 'unknown'}): ${err.message}`);
  process.exit(3);
}
