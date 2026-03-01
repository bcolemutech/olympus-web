#!/usr/bin/env node

/**
 * One-time migration: add trackingType, stock, bottleSize, bottleSizeUnit
 * to every ingredient in symposium_ingredients.
 *
 * Logic:
 *   unit === 'each'  →  trackingType = 'quantity', keep quantity, stock = 0
 *   all other units   →  trackingType = 'volume', stock = 1 if inStock else 0,
 *                         bottleSize = 750, bottleSizeUnit = 'ml', quantity = 0
 *
 * Recomputes inStock for all documents.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/migrate-tracking-type.js
 *
 * Dry-run (no writes):
 *   FIREBASE_SERVICE_ACCOUNT='<json>' DRY_RUN=1 node scripts/migrate-tracking-type.js
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error('Error: FIREBASE_SERVICE_ACCOUNT env var is required.');
  process.exit(1);
}

const serviceAccount = JSON.parse(raw);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const dryRun = !!process.env.DRY_RUN;

async function migrate() {
  const snapshot = await db.collection('symposium_ingredients').get();

  if (snapshot.empty) {
    console.log('No ingredients found. Nothing to migrate.');
    return;
  }

  console.log(`Found ${snapshot.size} ingredient(s). ${dryRun ? '(DRY RUN)' : ''}`);

  const batch = db.batch();
  let updated = 0;
  let skipped = 0;

  snapshot.forEach(function (doc) {
    const data = doc.data();

    // Skip if already migrated
    if (data.trackingType) {
      skipped++;
      return;
    }

    const isEach = data.unit === 'each';
    const trackingType = isEach ? 'quantity' : 'volume';

    const update = {
      trackingType: trackingType,
      stock: isEach ? 0 : (data.inStock ? 1 : 0),
      bottleSize: isEach ? 0 : 750,
      bottleSizeUnit: 'ml',
      quantity: isEach ? (Number(data.quantity) || 0) : 0,
      inStock: isEach
        ? (Number(data.quantity) || 0) > 0
        : (data.inStock ? true : false),
    };

    console.log(
      `  ${data.name} (${data.unit}) → ${trackingType}, ` +
      `stock=${update.stock}, qty=${update.quantity}, inStock=${update.inStock}`
    );

    if (!dryRun) {
      batch.update(doc.ref, update);
    }
    updated++;
  });

  if (!dryRun && updated > 0) {
    await batch.commit();
  }

  console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
}

migrate().catch(function (err) {
  console.error('Migration failed:', err);
  process.exit(2);
});
