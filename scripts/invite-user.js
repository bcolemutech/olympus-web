#!/usr/bin/env node

/**
 * Invite a user to the Olympus Firebase project.
 *
 * Creates a Firebase Auth user with the given email, then sends
 * a password-reset email via the Identity Toolkit API as the invitation.
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
import { GoogleAuth } from "google-auth-library";

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
  // Step 1: Create the user (no password — they will set it via the email link)
  const userRecord = await auth.createUser({
    email,
    emailVerified: false,
    disabled: false,
  });
  console.log(`Created user: ${userRecord.uid} (${userRecord.email})`);

  // Step 2: Send password reset email via Identity Toolkit REST API
  const googleAuth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const accessToken = await googleAuth.getAccessToken();

  const response = await fetch(
    "https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requestType: "PASSWORD_RESET",
        email,
        returnOobLink: false,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.json();
    throw new Error(
      `Identity Toolkit API error (${response.status}): ${body.error?.message || JSON.stringify(body)}`,
    );
  }

  console.log(`Password reset email sent to ${email}.`);

  if (process.env.GITHUB_OUTPUT) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_OUTPUT, `uid=${userRecord.uid}\n`);
    appendFileSync(process.env.GITHUB_OUTPUT, `email_sent=true\n`);
  }
} catch (err) {
  if (err.code === "auth/email-already-exists") {
    console.error(`Error: A user with email "${email}" already exists.`);
    process.exit(2);
  }
  console.error(`Firebase error (${err.code || "unknown"}): ${err.message}`);
  process.exit(3);
}
