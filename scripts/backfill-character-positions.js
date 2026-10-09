#!/usr/bin/env node

/**
 * Give every character made before positions were required a position
 * (planning/the-loom-movement-and-vision.md §6a; L-683 / #515): a square at a
 * place or point of interest with a map, a town point in a settlement, or
 * none at a point of interest without a map (its own position counts). See
 * functions/cartographer/placing.js for how each default is chosen.
 *
 * Characters already placed are left alone, so it is safe to run twice.
 * Anyone it can't place (in the wilderness, or at a map with no free square)
 * is listed for Claude to place over MCP (update_character). Until everyone
 * is placed, publishing refuses the world, and list_work lists them.
 *
 * Run it after the change that requires positions (L-682) is deployed, so
 * nothing added in between goes unplaced.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-positions.js
 *       → every world, and what would be placed in each
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-positions.js \
 *       <worldId> [--apply]          → one world
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-character-positions.js \
 *       --all --apply                → every world
 *
 * GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. --apply asks you to type the world id (or "all")
 * to confirm. With FIRESTORE_EMULATOR_HOST set, it runs against the emulator.
 */

import { createRequire } from 'module';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const loomCanon = require('../functions/loom-canon/index.js');
const { planPositionBackfill } = require('../functions/cartographer/placing.js');
const { applyBackfill } = require('../functions/cartographer/backfill.js');

const SHOW = 25;

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

const shown = (fields) =>
  Object.entries(fields)
    .filter(([, value]) => value)
    .map(([field, p]) => `${field} (${p.x}, ${p.y})`)
    .join('') || 'its own position';

// Plans one world and says what it would do. Returns the plan, or null when
// the world can't be loaded.
async function planWorld(db, worldId) {
  const world = await loomCanon.loadWorld(worldId, { db, playableOnly: false });
  if (!world) {
    console.log(`  ${worldId}: not a loadable world; skipped.`);
    return null;
  }
  const plan = planPositionBackfill(world);
  console.log(
    `  ${worldId} "${world.name}" (${world.status}): ${plan.placed.length} to place, ` +
      `${plan.alreadyPlaced} already placed, ${plan.unplaceable.length} for Claude to place`
  );
  for (const p of plan.placed.slice(0, SHOW)) {
    console.log(`    ${p.name} (${p.id}): ${shown(p.fields)} — was: ${p.was}`);
  }
  if (plan.placed.length > SHOW) console.log(`    … and ${plan.placed.length - SHOW} more`);
  for (const u of plan.unplaceable) {
    console.log(`    NOT PLACED ${u.name} (${u.id}): ${u.problem}`);
  }
  return plan;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const [worldId] = args.filter((a) => !a.startsWith('--'));
  const db = connect();

  const ids = worldId
    ? [worldId]
    : (await db.collection('loom_worlds').get()).docs.map((doc) => doc.id).sort();
  if (!ids.length) return console.log('No worlds.');
  console.log(worldId ? 'World:' : 'Worlds:');
  const plans = [];
  for (const id of ids) {
    const plan = await planWorld(db, id);
    if (plan && plan.writes.length) plans.push({ id, plan });
  }
  const changes = plans.reduce((n, { plan }) => n + plan.writes.length, 0);
  if (!changes) return console.log('Nothing to backfill.');
  if (!apply || (!worldId && !all)) {
    return console.log(
      'DRY RUN: nothing written. Re-run with <worldId> --apply, or --all --apply, to place ' +
        `${changes} character(s).`
    );
  }
  const word = worldId || 'all';
  const typed = await ask(`Type ${word === 'all' ? '"all"' : `the world id (${word})`} to write: `);
  if (typed !== word) return console.log('Not confirmed. Nothing written.');
  for (const { id, plan } of plans) {
    const result = await applyBackfill(db, id, { writes: plan.writes });
    console.log(
      `  ${id}: placed ${plan.writes.length}; canonVersion is now ${result.canonVersion}.`
    );
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
