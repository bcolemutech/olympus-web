#!/usr/bin/env node

/**
 * Export/archive Void Odyssey Firestore data ahead of code removal (L-004 / #289).
 *
 * Walks void_odyssey_games and each game's subcollections (crew, locations,
 * entities, items, quests, star_map, narrative_log) into a single JSON file.
 * Firestore Timestamps are tagged as { __timestamp: <ISO string> } so restore
 * can reconstruct them exactly.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/export-void-odyssey.js
 *     -> writes scripts/export-output/void-odyssey-export-<ISO timestamp>.json
 *
 * Restore procedure (re-run if VO data ever needs to come back):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/export-void-odyssey.js --restore <path-to-export.json>
 *     -> re-writes every game doc and subcollection doc from the archive via
 *        set() keyed by original document ID (overwrite, safe to re-run)
 *
 * Exit codes:
 *   0 - success
 *   1 - missing configuration or arguments
 *   3 - Firebase API error
 */

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const SUBCOLLECTIONS = [
  'crew',
  'locations',
  'entities',
  'items',
  'quests',
  'star_map',
  'narrative_log',
];

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

function serializeValue(value) {
  if (value instanceof Timestamp) {
    return { __timestamp: value.toDate().toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serializeValue(v)]));
  }
  return value;
}

function deserializeValue(value) {
  if (value && typeof value === 'object' && typeof value.__timestamp === 'string') {
    return Timestamp.fromDate(new Date(value.__timestamp));
  }
  if (Array.isArray(value)) {
    return value.map(deserializeValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, deserializeValue(v)]));
  }
  return value;
}

async function exportGames() {
  const gamesSnap = await db.collection('void_odyssey_games').get();
  const counts = { games: gamesSnap.size };
  for (const key of SUBCOLLECTIONS) counts[key] = 0;

  const games = [];
  for (const gameDoc of gamesSnap.docs) {
    const gameRecord = { id: gameDoc.id, data: serializeValue(gameDoc.data()) };
    for (const sub of SUBCOLLECTIONS) {
      const subSnap = await gameDoc.ref.collection(sub).get();
      gameRecord[sub] = subSnap.docs.map((d) => ({ id: d.id, data: serializeValue(d.data()) }));
      counts[sub] += subSnap.size;
    }
    games.push(gameRecord);
  }

  const archive = {
    exportedAt: new Date().toISOString(),
    sourceProject: serviceAccount.project_id,
    counts,
    games,
  };

  const outDir = path.join(process.cwd(), 'scripts', 'export-output');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(
    outDir,
    `void-odyssey-export-${archive.exportedAt.replace(/[:.]/g, '-')}.json`
  );
  await writeFile(outPath, JSON.stringify(archive, null, 2));

  console.log(`Exported ${counts.games} game(s) to ${outPath}`);
  console.log('Document counts:', JSON.stringify(counts, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = [
      '## Void Odyssey Firestore Export',
      '',
      `- Exported at: ${archive.exportedAt}`,
      `- Games: ${counts.games}`,
      ...SUBCOLLECTIONS.map((k) => `- ${k}: ${counts[k]}`),
      '',
      `Archive file: \`${path.relative(process.cwd(), outPath)}\` (uploaded as a workflow artifact)`,
    ].join('\n');
    await writeFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, { flag: 'a' });
  }
}

async function restoreGames(archivePath) {
  const raw = await readFile(archivePath, 'utf8');
  const archive = JSON.parse(raw);

  let restoredDocs = 0;
  for (const game of archive.games) {
    const gameRef = db.collection('void_odyssey_games').doc(game.id);
    await gameRef.set(deserializeValue(game.data));
    restoredDocs += 1;
    for (const sub of SUBCOLLECTIONS) {
      for (const doc of game[sub] || []) {
        await gameRef.collection(sub).doc(doc.id).set(deserializeValue(doc.data));
        restoredDocs += 1;
      }
    }
  }

  console.log(
    `Restored ${archive.games.length} game(s), ${restoredDocs} document(s) total, from ${archivePath}`
  );
}

const restoreIndex = process.argv.indexOf('--restore');
try {
  if (restoreIndex !== -1) {
    const archivePath = process.argv[restoreIndex + 1];
    if (!archivePath) {
      console.error('Error: --restore requires a path to an export JSON file.');
      process.exit(1);
    }
    await restoreGames(archivePath);
  } else {
    await exportGames();
  }
} catch (err) {
  console.error(`Firebase error (${err.code || 'unknown'}): ${err.message}`);
  process.exit(3);
}
