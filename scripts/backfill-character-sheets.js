#!/usr/bin/env node

/**
 * Give every save made before character sheets a sheet (planning/
 * game-systems.md §3 CS4, CS9; L-811 / #638): its world's system's defaults
 * (each attribute at the middle of its range, untrained, the lowest level,
 * every resource full), its abilities as traits and its speed carried over,
 * and the old `abilities`, `speed` and `condition` fields removed. That is
 * what such a character already rolls with, so play doesn't change.
 *
 * Saves that have a sheet are left alone, so it is safe to run twice. A save
 * whose world can't be loaded is listed and skipped.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-sheets.js
 *       → every save, and what each would get
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-sheets.js \
 *       <worldId> [--apply]          → the saves in one world
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-sheets.js \
 *       --all --apply                → every save
 *
 * GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. --apply asks you to type the world id (or "all")
 * to confirm; with BACKFILL_CONFIRM set, its value is taken as what you typed
 * (the Backfill Character Sheets workflow passes its `confirm` input). With
 * FIRESTORE_EMULATOR_HOST set, it runs against the emulator.
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const loomCanon = require('../functions/loom-canon/index.js');
const { systemOf } = require('../functions/loom-canon/checks.js');
const { sheetBackfill } = require('../functions/loom-canon/sheets.js');

const BATCH_SIZE = 400;

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

  let query = db.collection('loom_saves');
  if (worldId) query = query.where('worldId', '==', worldId);
  const saves = (await query.get()).docs;
  const systems = new Map(); // worldId → its system, or null
  const plans = [];
  let have = 0;
  console.log(worldId ? `Saves in ${worldId}:` : 'Saves:');
  for (const doc of saves.sort((a, b) => a.id.localeCompare(b.id))) {
    const save = doc.data();
    if (!systems.has(save.worldId)) {
      const world = await loomCanon.loadWorld(save.worldId, { db, playableOnly: false });
      systems.set(save.worldId, world ? systemOf(world) : null);
    }
    const system = systems.get(save.worldId);
    if (!system) {
      console.log(`  ${doc.id} (${save.worldId}): its world can't be loaded; skipped.`);
      continue;
    }
    const fields = sheetBackfill(save, system, FieldValue.delete());
    if (!fields) {
      have += 1;
      continue;
    }
    const sheet = fields['character.sheet'];
    console.log(
      `  ${doc.id} "${(save.character || {}).name}" (${save.worldId}, ${system.id}): ` +
        `traits [${sheet.traits.join(', ')}], speed ${sheet.speed}`
    );
    plans.push({ ref: doc.ref, fields });
  }
  console.log(`${plans.length} to give a sheet; ${have} have one.`);
  if (!plans.length) return console.log('Nothing to backfill.');
  if (!apply || (!worldId && !all)) {
    return console.log(
      'DRY RUN: nothing written. Re-run with <worldId> --apply, or --all --apply, to give ' +
        `${plans.length} save(s) a sheet.`
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
  for (let i = 0; i < plans.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const { ref, fields } of plans.slice(i, i + BATCH_SIZE)) batch.update(ref, fields);
    await batch.commit();
  }
  console.log(`Gave ${plans.length} save(s) a sheet.`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
