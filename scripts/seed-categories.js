#!/usr/bin/env node

/**
 * Seed the symposium_categories collection with ingredient and equipment categories.
 *
 * Idempotent — safe to re-run. Uses set({ merge: true }) so existing
 * documents are updated rather than overwritten.
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' node scripts/seed-categories.js
 *
 * Exit codes:
 *   0 - success
 *   1 - missing configuration
 *   3 - Firebase API error
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const categories = [
  {
    id: 'spirit',
    name: 'Spirits',
    type: 'ingredient',
    subcategories: [
      'bourbon',
      'rye',
      'scotch',
      'vodka',
      'gin',
      'rum',
      'tequila',
      'mezcal',
      'brandy',
    ],
    sortOrder: 1,
  },
  {
    id: 'liqueur',
    name: 'Liqueurs',
    type: 'ingredient',
    subcategories: ['amaro', 'orange', 'herbal', 'cream', 'coffee', 'nut'],
    sortOrder: 2,
  },
  {
    id: 'mixer',
    name: 'Mixers',
    type: 'ingredient',
    subcategories: ['juice', 'soda', 'tonic', 'syrup', 'cream'],
    sortOrder: 3,
  },
  {
    id: 'bitter',
    name: 'Bitters',
    type: 'ingredient',
    subcategories: ['aromatic', 'citrus', 'herbal', 'spice'],
    sortOrder: 4,
  },
  {
    id: 'syrup',
    name: 'Syrups',
    type: 'ingredient',
    subcategories: ['simple', 'flavored', 'honey', 'agave'],
    sortOrder: 5,
  },
  {
    id: 'garnish',
    name: 'Garnishes',
    type: 'ingredient',
    subcategories: ['citrus', 'fruit', 'herb', 'olive', 'cherry'],
    sortOrder: 6,
  },
  {
    id: 'wine-beer',
    name: 'Wine & Beer',
    type: 'ingredient',
    subcategories: ['red wine', 'white wine', 'sparkling', 'beer', 'cider'],
    sortOrder: 7,
  },
  {
    id: 'other',
    name: 'Other',
    type: 'ingredient',
    subcategories: ['egg', 'dairy', 'spice', 'misc'],
    sortOrder: 8,
  },
  {
    id: 'glassware',
    name: 'Glassware',
    type: 'equipment',
    subcategories: [
      'rocks glass',
      'coupe',
      'highball',
      'martini',
      'wine',
      'champagne',
      'shot',
      'pint',
    ],
    sortOrder: 9,
  },
  {
    id: 'tools',
    name: 'Tools',
    type: 'equipment',
    subcategories: ['shaker', 'strainer', 'jigger', 'muddler', 'bar spoon', 'peeler', 'zester'],
    sortOrder: 10,
  },
  {
    id: 'appliance',
    name: 'Appliances',
    type: 'equipment',
    subcategories: ['blender', 'ice maker', 'refrigerator', 'juicer'],
    sortOrder: 11,
  },
  {
    id: 'classic',
    name: 'Classic Cocktails',
    type: 'recipe',
    subcategories: ['whiskey-based', 'gin-based', 'vodka-based', 'rum-based', 'tequila-based'],
    sortOrder: 12,
  },
  {
    id: 'tiki',
    name: 'Tiki',
    type: 'recipe',
    subcategories: ['rum-based', 'tropical', 'frozen'],
    sortOrder: 13,
  },
  {
    id: 'modern',
    name: 'Modern',
    type: 'recipe',
    subcategories: ['contemporary', 'low-abv', 'sour'],
    sortOrder: 14,
  },
  {
    id: 'shots',
    name: 'Shots',
    type: 'recipe',
    subcategories: ['layered', 'simple'],
    sortOrder: 15,
  },
  {
    id: 'non-alcoholic',
    name: 'Non-Alcoholic',
    type: 'recipe',
    subcategories: ['mocktail', 'juice', 'soda'],
    sortOrder: 16,
  },
];

try {
  const batch = db.batch();

  for (const cat of categories) {
    const { id, ...data } = cat;
    const ref = db.collection('symposium_categories').doc(id);
    batch.set(ref, data, { merge: true });
  }

  await batch.commit();
  console.log(`Seeded ${categories.length} categories into symposium_categories.`);
} catch (err) {
  console.error(`Firestore error (${err.code || 'unknown'}): ${err.message}`);
  process.exit(3);
}
