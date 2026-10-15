#!/usr/bin/env node

/**
 * Screen-sized copies for the image studio's library (L-727 / #598;
 * planning/the-map-first-loom.md §3 A1): every version stored before L-727
 * that is bigger than a screen gets a copy at most 2048 px on its long side,
 * and every image its screen link, as the studio now makes them when it
 * stores a version. See functions/studio/screen-backfill.js for how.
 *
 * Copies already made are left alone, so it is safe to run twice.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-screen-copies.js
 *       → every image, and what would be made
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-screen-copies.js \
 *       <imageId> [--apply]          → one image
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-screen-copies.js \
 *       --all --apply                → every image
 *
 * It needs the functions' dependencies installed (npm ci --prefix functions),
 * for sharp. GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. The bucket is <project>.firebasestorage.app, or
 * FIREBASE_STORAGE_BUCKET. --apply asks you to type the image id (or "all")
 * to confirm; with BACKFILL_CONFIRM set, its value is taken as what you typed
 * (the Backfill Screen Copies workflow passes its `confirm` input). With
 * FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST set, it runs
 * against the emulators.
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const require = createRequire(import.meta.url);
const { applyScreenBackfill } = require('../functions/studio/screen-backfill.js');

function connect() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Local testing against the emulators; no credentials involved.
    projectId = process.env.GCLOUD_PROJECT || 'demo-backfill';
    initializeApp({ projectId });
    console.log(`Using the emulators (Firestore at ${process.env.FIRESTORE_EMULATOR_HOST}).`);
  } else if (raw) {
    const account = JSON.parse(raw);
    projectId = account.project_id;
    initializeApp({ credential: cert(account), projectId });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
    projectId = process.env.GCLOUD_PROJECT;
  } else {
    console.error('Set FIREBASE_SERVICE_ACCOUNT (the key JSON) or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  const bucketName = process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`;
  return { db: getFirestore(), bucket: getStorage().bucket(bucketName) };
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const [imageId] = args.filter((a) => !a.startsWith('--'));
  const writing = args.includes('--apply') && Boolean(imageId || all);
  const { db, bucket } = connect();

  if (writing) {
    const word = imageId || 'all';
    const typed =
      process.env.BACKFILL_CONFIRM !== undefined
        ? process.env.BACKFILL_CONFIRM.trim()
        : await ask(`Type ${word === 'all' ? '"all"' : `the image id (${word})`} to write: `);
    if (typed !== word) {
      console.error(`Not confirmed (expected "${word}"). Nothing written.`);
      process.exitCode = 1;
      return;
    }
  }

  const { images, missing } = await applyScreenBackfill({ db, bucket, apply: writing, imageId });
  if (!images.length && !missing.length) {
    return console.log('Nothing to make: every image has its screen copies and link.');
  }
  let copies = 0;
  for (const image of images) {
    console.log(`  ${image.id} "${image.title}":`);
    for (const c of image.copies) {
      copies += 1;
      console.log(`    ${writing ? 'made' : 'would make'} a copy of v${c.n}: ${c.from} → ${c.to}`);
    }
    if (image.link) console.log(`    ${writing ? 'wrote' : 'would write'} its screen link`);
  }
  for (const m of missing) console.log(`  MISSING ${m.id} v${m.n}: ${m.path}; no copy made`);
  console.log(
    writing
      ? `Made ${copies} copy(ies) for ${images.length} image(s).`
      : `DRY RUN: nothing written. Re-run with <imageId> --apply, or --all --apply, to make ${copies} copy(ies) for ${images.length} image(s).`
  );
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
