#!/usr/bin/env node

/**
 * Give every world made before game systems the built-in fantasy system's id
 * (planning/game-systems.md §3 SY4, §4.8; L-804 / #630). Such worlds already
 * play by it (a world naming no system reads as `d20-fantasy`); this writes
 * it down, so the world's system is chosen and graded as set. Lock
 * difficulties carry over: the fantasy system uses a lock's number as it is.
 *
 * Worlds that name a system are left alone, so it is safe to run twice. Each
 * world written gets a canonVersion bump, so cached copies reload.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-world-systems.js
 *       → every world, and which would get the system
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-world-systems.js \
 *       <worldId> [--apply]          → one world
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-world-systems.js \
 *       --all --apply                → every world
 *
 * GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. --apply asks you to type the world id (or "all")
 * to confirm; with BACKFILL_CONFIRM set, its value is taken as what you typed
 * (the Backfill World Systems workflow passes its `confirm` input). With
 * FIRESTORE_EMULATOR_HOST set, it runs against the emulator.
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { systemBackfill } = require('../functions/loom-canon/systems.js');
const { applyBackfill } = require('../functions/cartographer/backfill.js');

function connect() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Local testing against the emulator; no credentials involved.
    initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-backfill' });
    console.log(`Using the Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}.`);
  } else if (raw) {
    const account = JSON.parse(raw);
    initializeApp({ credential: cert(account), projectId: account.project_id });
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    initializeApp({ credential: applicationDefault() });
  } else {
    console.error('Set FIREBASE_SERVICE_ACCOUNT (the key JSON) or GOOGLE_APPLICATION_CREDENTIALS.');
    process.exit(1);
  }
  return getFirestore();
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
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const [worldId] = args.filter((a) => !a.startsWith('--'));
  const db = connect();

  const docs = worldId
    ? [await db.collection('loom_worlds').doc(worldId).get()]
    : (await db.collection('loom_worlds').get()).docs;
  const plans = [];
  console.log(worldId ? 'World:' : 'Worlds:');
  for (const doc of docs.sort((a, b) => a.id.localeCompare(b.id))) {
    if (!doc.exists) {
      console.log(`  ${doc.id}: no such world; skipped.`);
      continue;
    }
    const world = doc.data();
    const fields = systemBackfill(world);
    console.log(
      `  ${doc.id} "${world.name}" (${world.status}): ` +
        (fields ? `would get ${fields.systemId}` : `plays by ${world.systemId}; left alone`)
    );
    if (fields) plans.push({ id: doc.id, fields });
  }
  if (!plans.length) return console.log('Nothing to backfill.');
  if (!apply || (!worldId && !all)) {
    return console.log(
      'DRY RUN: nothing written. Re-run with <worldId> --apply, or --all --apply, to give ' +
        `${plans.length} world(s) the fantasy system.`
    );
  }
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
  for (const { id, fields } of plans) {
    const result = await applyBackfill(db, id, { writes: [], worldFields: fields });
    console.log(`  ${id}: now ${fields.systemId}; canonVersion is now ${result.canonVersion}.`);
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
