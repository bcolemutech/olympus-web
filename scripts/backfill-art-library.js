#!/usr/bin/env node

/**
 * Move every world's art into the image studio's library
 * (planning/the-image-studio.md §3 S6; L-705 / #541): each world map, town
 * art and battle-map art still held as a Storage path (from before L-704)
 * becomes a library image, and the world points at it. See
 * functions/studio/art-backfill.js for how.
 *
 * Art already in the library is left alone, so it is safe to run twice; the
 * same file in several worlds becomes one image. A file that is missing from
 * Storage is listed and left as it is.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-art-library.js
 *       → every world, and what would move in each
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-art-library.js \
 *       <worldId> [--apply]          → one world
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-art-library.js \
 *       --all --apply                → every world
 *
 * GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. The bucket is <project>.firebasestorage.app, or
 * FIREBASE_STORAGE_BUCKET. --apply asks you to type the world id (or "all")
 * to confirm; with BACKFILL_CONFIRM set, its value is taken as what you typed
 * (the Backfill Art Library workflow passes its `confirm` input). With
 * FIRESTORE_EMULATOR_HOST and FIREBASE_STORAGE_EMULATOR_HOST set, it runs
 * against the emulators.
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const require = createRequire(import.meta.url);
const loomCanon = require('../functions/loom-canon/index.js');
const { planArtBackfill, applyArtBackfill } = require('../functions/studio/art-backfill.js');

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

const line = (m) => `${m.target} ${m.name} (${m.id}): ${m.path}`;

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const [worldId] = args.filter((a) => !a.startsWith('--'));
  const { db, bucket } = connect();

  const ids = worldId
    ? [worldId]
    : (await db.collection('loom_worlds').get()).docs.map((doc) => doc.id).sort();
  if (!ids.length) return console.log('No worlds.');
  const worlds = [];
  console.log(worldId ? 'World:' : 'Worlds:');
  for (const id of ids) {
    const world = await loomCanon.loadWorld(id, { db, playableOnly: false });
    if (!world) {
      console.log(`  ${id}: not a loadable world; skipped.`);
      continue;
    }
    const items = planArtBackfill(world);
    console.log(`  ${id} "${world.name}" (${world.status}): ${items.length} to move`);
    if (items.length) worlds.push(world);
  }
  if (!worlds.length) return console.log('Nothing to move: every world’s art is in the library.');

  const writing = apply && (worldId || all);
  if (writing) {
    const word = worldId || 'all';
    const typed =
      process.env.BACKFILL_CONFIRM !== undefined
        ? process.env.BACKFILL_CONFIRM.trim()
        : await ask(`Type ${word === 'all' ? '"all"' : `the world id (${word})`} to write: `);
    if (typed !== word) {
      console.error(`Not confirmed (expected "${word}"). Nothing written.`);
      process.exitCode = 1;
      return;
    }
  }

  let total = 0;
  for (const world of worlds) {
    const result = await applyArtBackfill({ db, bucket, FieldValue, world, apply: writing });
    total += result.moved.length;
    console.log(`  ${world.id}:`);
    for (const m of result.moved) {
      console.log(
        `    ${writing ? 'moved' : 'would move'} ${line(m)}` +
          (m.imageId
            ? ` → ${m.imageId}${m.reused ? ' (same file as an image already there)' : ''}`
            : '')
      );
    }
    for (const m of result.missing) console.log(`    MISSING ${line(m)}: left as it is`);
    if (result.canonVersion) console.log(`    canonVersion is now ${result.canonVersion}.`);
  }
  console.log(
    writing
      ? `Moved ${total} piece(s) of art into the library.`
      : `DRY RUN: nothing written. Re-run with <worldId> --apply, or --all --apply, to move ${total} piece(s) of art.`
  );
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
