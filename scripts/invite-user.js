#!/usr/bin/env node

/**
 * Invite a user to the Olympus Firebase project.
 *
 * Creates a Firebase Auth user with the given email, then generates
 * a password-reset link that serves as the invitation.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' EMAIL='user@example.com' node scripts/invite-user.js
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/invite-user.js user@example.com
 *
 * Exit codes:
 *   0 - success
 *   1 - missing arguments or environment
 *   2 - user already exists
 *   3 - Firebase API error
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

const email = process.env.EMAIL || process.argv[2];
if (!email) {
  console.error("Error: email argument is required.");
  console.error("Usage: EMAIL='user@example.com' node invite-user.js");
  process.exit(1);
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!emailPattern.test(email)) {
  console.error(`Error: invalid email format: "${email}".`);
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
  const userRecord = await auth.createUser({
    email,
    emailVerified: false,
    disabled: false,
  });
  console.log(`Created user: ${userRecord.uid} (${userRecord.email})`);

  const resetLink = await auth.generatePasswordResetLink(email);
  console.log("Invitation link generated successfully.");

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `uid=${userRecord.uid}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `link_generated=true\n`);
  }
} catch (err) {
  if (err.code === "auth/email-already-exists") {
    console.error(`Error: A user with email "${email}" already exists.`);
    process.exit(2);
  }
  console.error(`Firebase error (${err.code || "unknown"}): ${err.message}`);
  process.exit(3);
}
