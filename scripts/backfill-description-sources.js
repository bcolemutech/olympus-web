#!/usr/bin/env node

/**
 * Backfill where each description in a Cartographer world came from
 * (planning/the-loom-layered-worlds.md §4.3; L-321 / #390).
 *
 * Grading counts a place as written up only when `sources.description` isn't
 * 'import'. Worlds imported before sources existed have no stamps, so this
 * script adds them: it re-runs the parser and mapper on the world's original
 * Azgaar export and marks a description 'import' if it still matches the
 * mapper's output word for word, and 'mcp' if it was written over since.
 * Without an export, every place and realm is marked 'import'. Characters are
 * always 'mcp'. Existing stamps are left alone, so it is safe to run twice.
 *
 * Run it after the change that stamps new imports and MCP edits is deployed,
 * so nothing written in between goes unstamped.
 *
 * Usage (dry run by default; nothing is written without --apply):
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-description-sources.js
 *       → lists the worlds
 *   FIREBASE_SERVICE_ACCOUNT="$(cat key.json)" node scripts/backfill-description-sources.js \
 *       <worldId> ["maps/<export>.json"] [--apply]
 *
 * GOOGLE_APPLICATION_CREDENTIALS=key.json works in place of
 * FIREBASE_SERVICE_ACCOUNT. --apply asks you to type the world id to confirm.
 * With FIRESTORE_EMULATOR_HOST set, it runs against the emulator instead.
 */

import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const { parseAzgaarExport } = require('../functions/cartographer/parse.js');
const { mapToCanon } = require('../functions/cartographer/map.js');
const {
  checkExportMatchesWorld,
  planSourceBackfill,
  applySourceBackfill,
} = require('../functions/cartographer/sources.js');

const SHOW_WRITTEN = 25;

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

async function listWorlds(db) {
  const snap = await db.collection('loom_worlds').orderBy('createdAtMs', 'desc').get();
  if (snap.empty) return console.log('No worlds.');
  console.log('Worlds (pass one as the first argument):');
  for (const doc of snap.docs) {
    const w = doc.data();
    const map = w.source ? `${w.source.mapName}, seed ${w.source.seed}` : 'no source';
    console.log(`  ${doc.id}  "${w.name}"  ${w.status}  (${map})`);
  }
}

async function readEntities(worldRef) {
  const entities = {};
  for (const collection of ['locations', 'factions', 'characters']) {
    const snap = await worldRef.collection(collection).get();
    entities[collection] = Object.fromEntries(
      snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }])
    );
  }
  return entities;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [worldId, exportPath] = args.filter((a) => a !== '--apply');
  const db = connect();
  if (!worldId) return listWorlds(db);

  const worldRef = db.collection('loom_worlds').doc(worldId);
  const snap = await worldRef.get();
  if (!snap.exists) throw new Error(`No world "${worldId}".`);
  const meta = snap.data();
  console.log(
    `World ${worldId} "${meta.name}" (${meta.status}, canonVersion ${meta.canonVersion})`
  );

  let mapped = null;
  if (exportPath) {
    const parsed = parseAzgaarExport(readFileSync(exportPath));
    checkExportMatchesWorld(meta, parsed);
    mapped = mapToCanon(parsed);
    console.log(`Export: ${parsed.source.mapName}, seed ${parsed.source.seed}: matches the world.`);
  } else {
    console.log('No export given: every place and realm will be marked as import text.');
  }

  const plan = planSourceBackfill({ entities: await readEntities(worldRef), mapped });
  for (const [collection, c] of Object.entries(plan.summary)) {
    console.log(
      `${collection}: ${c.total} — ${c.import} import text, ${c.mcp} written, ` +
        `${c.alreadyStamped} already stamped, ${c.noDescription} without a description`
    );
  }
  const written = plan.updates.filter((u) => u.source === 'mcp' && u.collection !== 'characters');
  if (written.length) {
    console.log('Written up (these become enterable once the gate ships):');
    for (const u of written.slice(0, SHOW_WRITTEN)) console.log(`  ${u.name} (${u.id})`);
    if (written.length > SHOW_WRITTEN) console.log(`  … and ${written.length - SHOW_WRITTEN} more`);
  }

  if (!plan.updates.length) return console.log('Nothing to stamp.');
  if (!apply) {
    return console.log(
      `DRY RUN: nothing written. Re-run with --apply to write ${plan.updates.length} stamps.`
    );
  }
  const typed = await ask(
    `Type the world id (${worldId}) to write ${plan.updates.length} stamps: `
  );
  if (typed !== worldId) return console.log('Not confirmed. Nothing written.');
  const result = await applySourceBackfill(db, worldId, plan);
  console.log(`Wrote ${result.written} stamps; canonVersion is now ${result.canonVersion}.`);
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
