'use strict';

const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} = require('firebase/firestore');

const RULES_PATH = resolve(__dirname, '../firestore.rules');
const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  'demo-olympus-rules-test';

// Seed data: a recipe category that passes validRecipe()'s category checks
const TEST_CATEGORY_ID = 'cat-classic';
const TEST_CATEGORY_DATA = {
  name: 'Classic Cocktails',
  type: 'recipe',
  sortOrder: 1,
  subcategories: ['classic', 'modern'],
};

// Auth token that satisfies hasApp('symposium')
const SYMPOSIUM_TOKEN = { apps: ['symposium'] };

// ── Helpers ──────────────────────────────────────────────────────────────────

// Returns a minimal valid recipe using only linked (id-based) ingredient refs.
// Timestamps must be filled in by the caller (serverTimestamp() for creates).
function makeLinkedRecipe(overrides) {
  var base = {
    name: 'Test Recipe',
    category: TEST_CATEGORY_ID,
    subcategory: 'classic',
    tags: [],
    description: 'A test description.',
    instructions: 'Stir and strain.',
    ingredients: [{ id: 'ing-001', amount: '2', unit: 'oz', optional: false }],
    equipment: [{ id: 'equip-001' }],
    garnish: '',
    glassware: 'Coupe',
    servings: 1,
    canMake: true,
    favorite: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  return Object.assign({}, base, overrides || {});
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('symposium_recipes — Firestore Security Rules', function () {
  var testEnv;
  var authedDb;

  beforeAll(async function () {
    var firestoreConfig = {
      rules: readFileSync(RULES_PATH, 'utf8'),
    };

    var emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost) {
      var parts = emulatorHost.split(':');
      var host = parts[0];
      var portString = parts[1];
      if (host) {
        firestoreConfig.host = host;
      }
      if (portString) {
        var parsedPort = parseInt(portString, 10);
        if (!isNaN(parsedPort)) {
          firestoreConfig.port = parsedPort;
        }
      }
    } else {
      firestoreConfig.host = '127.0.0.1';
      firestoreConfig.port = 8080;
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: firestoreConfig,
    });

    // Seed the category document (bypass rules)
    await testEnv.withSecurityRulesDisabled(async function (ctx) {
      await setDoc(
        doc(ctx.firestore(), 'symposium_categories', TEST_CATEGORY_ID),
        TEST_CATEGORY_DATA
      );
    });

    authedDb = testEnv.authenticatedContext('user-001', SYMPOSIUM_TOKEN).firestore();
  });

  afterAll(async function () {
    await testEnv.cleanup();
  });

  afterEach(async function () {
    await testEnv.clearFirestore();
    // Re-seed the category after each clearFirestore()
    await testEnv.withSecurityRulesDisabled(async function (ctx) {
      await setDoc(
        doc(ctx.firestore(), 'symposium_categories', TEST_CATEGORY_ID),
        TEST_CATEGORY_DATA
      );
    });
  });

  // ── 1. Read access ──────────────────────────────────────────────────────────

  describe('read access', function () {
    it('allows read for authenticated symposium user', async function () {
      await assertSucceeds(getDoc(doc(authedDb, 'symposium_recipes', 'r-read-test')));
    });

    it('denies read for unauthenticated user', async function () {
      var unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthDb, 'symposium_recipes', 'r-read-test')));
    });

    it('denies read for user without symposium app claim', async function () {
      var wrongDb = testEnv
        .authenticatedContext('user-002', { apps: ['other-app'] })
        .firestore();
      await assertFails(getDoc(doc(wrongDb, 'symposium_recipes', 'r-read-test')));
    });
  });

  // ── 2. Backward compatibility: linked-format ingredients ───────────────────

  describe('backward compatibility — linked-format ingredients', function () {
    it('allows create with id-based ingredient refs (no pendingCount)', async function () {
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_recipes', 'r-linked-1'), makeLinkedRecipe())
      );
    });

    it('allows create with multiple id-based equipment refs', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-linked-equip'),
          makeLinkedRecipe({ equipment: [{ id: 'equip-001' }, { id: 'equip-002' }] })
        )
      );
    });

    it('allows create with empty equipment array', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-no-equip'),
          makeLinkedRecipe({ equipment: [] })
        )
      );
    });

    it('allows update preserving createdAt', async function () {
      // First create
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_recipes', 'r-update-test'), {
          name: 'Test Recipe',
          category: TEST_CATEGORY_ID,
          subcategory: 'classic',
          tags: [],
          description: 'A test description.',
          instructions: 'Stir and strain.',
          ingredients: [{ id: 'ing-001', amount: '2', unit: 'oz', optional: false }],
          equipment: [],
          garnish: '',
          glassware: 'Coupe',
          servings: 1,
          canMake: true,
          favorite: false,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      // Now update via authed context — createdAt must match stored value
      var updateData = makeLinkedRecipe({
        createdAt: new Date('2024-01-01'),
        updatedAt: serverTimestamp(),
      });
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_recipes', 'r-update-test'), updateData)
      );
    });
  });

  // ── 3. Pending ingredient entries ──────────────────────────────────────────

  describe('pending ingredient entries', function () {
    it('allows create with a single pending ingredient', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pending-ing'),
          makeLinkedRecipe({
            ingredients: [
              { name: 'Obscure Bitters', amount: '2', unit: 'dash', optional: false, pending: true },
            ],
          })
        )
      );
    });

    it('allows create with a pending optional ingredient', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pending-optional'),
          makeLinkedRecipe({
            ingredients: [
              { name: 'Rare Syrup', amount: '0.5', unit: 'oz', optional: true, pending: true },
            ],
          })
        )
      );
    });
  });

  // ── 4. Mixed linked + pending ingredients ──────────────────────────────────

  describe('mixed linked + pending ingredients', function () {
    it('allows create with pending at [0], linked at [1]', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-mixed-pending-first'),
          makeLinkedRecipe({
            ingredients: [
              { name: 'New Spirit', amount: '1.5', unit: 'oz', optional: false, pending: true },
              { id: 'ing-001', amount: '0.75', unit: 'oz', optional: false },
            ],
          })
        )
      );
    });

    it('allows create with linked at [0], pending at [1]', async function () {
      // [0] is spot-checked (linked, valid); [1] is pending (not checked by rules — see note below)
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-mixed-linked-first'),
          makeLinkedRecipe({
            ingredients: [
              { id: 'ing-001', amount: '2', unit: 'oz', optional: false },
              { name: 'New Spirit', amount: '1', unit: 'oz', optional: false, pending: true },
            ],
          })
        )
      );
    });
  });

  // ── 5. pendingCount field ──────────────────────────────────────────────────

  describe('pendingCount field', function () {
    it('allows create without pendingCount (backward compat)', async function () {
      var data = makeLinkedRecipe();
      delete data.pendingCount;
      await assertSucceeds(setDoc(doc(authedDb, 'symposium_recipes', 'r-no-pcount'), data));
    });

    it('allows create with pendingCount = 0', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pcount-0'),
          makeLinkedRecipe({ pendingCount: 0 })
        )
      );
    });

    it('allows create with pendingCount = 3', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pcount-3'),
          makeLinkedRecipe({
            pendingCount: 3,
            ingredients: [
              { name: 'Spirit A', amount: '1', unit: 'oz', optional: false, pending: true },
            ],
          })
        )
      );
    });

    it('rejects pendingCount as a negative integer', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pcount-neg'),
          makeLinkedRecipe({ pendingCount: -1 })
        )
      );
    });

    it('rejects pendingCount as a float', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pcount-float'),
          makeLinkedRecipe({ pendingCount: 1.5 })
        )
      );
    });

    it('rejects pendingCount as a string', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pcount-string'),
          makeLinkedRecipe({ pendingCount: '2' })
        )
      );
    });
  });

  // ── 6. Malformed entries — rules enforcement boundary ─────────────────────

  describe('malformed entries — rules enforcement boundary', function () {
    // NOTE: Firestore Security Rules cannot iterate variable-length lists.
    // Only ingredients[0] and equipment[0] are spot-checked by the rules.
    // Malformed entries at index >= 1 are NOT rejected by rules.
    // Frontend validation in _validateForm() is the primary defence.

    it('rejects pending ingredient at [0] missing name field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-malformed-no-name'),
          makeLinkedRecipe({
            ingredients: [{ pending: true, amount: '1', unit: 'oz', optional: false }],
          })
        )
      );
    });

    it('rejects pending ingredient at [0] with name as a number', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-malformed-name-type'),
          makeLinkedRecipe({
            ingredients: [{ name: 42, amount: '1', unit: 'oz', optional: false, pending: true }],
          })
        )
      );
    });

    it('rejects linked ingredient at [0] missing id field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-malformed-linked-no-id'),
          makeLinkedRecipe({
            ingredients: [{ amount: '2', unit: 'oz', optional: false }],
          })
        )
      );
    });

    it('documents: malformed entry at [1] is NOT rejected by rules (rules limitation)', async function () {
      // This test explicitly documents the enforcement gap.
      // A valid entry at [0] passes the spot-check; the malformed entry at
      // [1] is not examined. Frontend validation must catch this case.
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-malformed-index-1'),
          makeLinkedRecipe({
            ingredients: [
              { id: 'ing-001', amount: '2', unit: 'oz', optional: false }, // [0] valid
              { pending: true },                                             // [1] malformed — NOT checked by rules
            ],
          })
        )
      );
    });
  });

  // ── 7. Equipment dual format ───────────────────────────────────────────────

  describe('equipment dual format', function () {
    it('allows pending equipment entry at [0]', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-pending-equip'),
          makeLinkedRecipe({ equipment: [{ name: 'Fancy Muddler', pending: true }] })
        )
      );
    });

    it('rejects pending equipment at [0] missing name', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-malformed-equip'),
          makeLinkedRecipe({ equipment: [{ pending: true }] })
        )
      );
    });

    it('allows mixed linked and pending equipment (pending at [0])', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-mixed-equip'),
          makeLinkedRecipe({
            equipment: [
              { name: 'New Strainer', pending: true },
              { id: 'equip-001' },
            ],
          })
        )
      );
    });
  });

  // ── 8. Unknown / disallowed top-level fields ───────────────────────────────

  describe('unknown fields', function () {
    it('rejects a recipe with an unknown top-level field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_recipes', 'r-unknown-field'),
          makeLinkedRecipe({ unexpectedField: 'surprise' })
        )
      );
    });

    it('rejects a recipe missing required field (instructions)', async function () {
      var data = makeLinkedRecipe();
      delete data.instructions;
      await assertFails(setDoc(doc(authedDb, 'symposium_recipes', 'r-missing-field'), data));
    });
  });
});

// ── symposium_shopping_list — Firestore Security Rules ────────────────────────

function makeShoppingItem(overrides) {
  var base = {
    name: 'Buffalo Trace',
    quantity: 1,
    unit: 'bottle',
    category: 'spirits',
    checked: false,
    addedFrom: 'manual',
    ingredientId: null,
    sourceRecipeId: null,
    notes: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  return Object.assign({}, base, overrides || {});
}

describe('symposium_shopping_list — Firestore Security Rules', function () {
  var testEnv;
  var authedDb;

  beforeAll(async function () {
    var firestoreConfig = {
      rules: readFileSync(RULES_PATH, 'utf8'),
    };

    var emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost) {
      var parts = emulatorHost.split(':');
      var host = parts[0];
      var portString = parts[1];
      if (host) {
        firestoreConfig.host = host;
      }
      if (portString) {
        var parsedPort = parseInt(portString, 10);
        if (!isNaN(parsedPort)) {
          firestoreConfig.port = parsedPort;
        }
      }
    } else {
      firestoreConfig.host = '127.0.0.1';
      firestoreConfig.port = 8080;
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: firestoreConfig,
    });

    authedDb = testEnv.authenticatedContext('user-001', SYMPOSIUM_TOKEN).firestore();
  });

  afterAll(async function () {
    await testEnv.cleanup();
  });

  afterEach(async function () {
    await testEnv.clearFirestore();
  });

  // ── 1. Read access ────────────────────────────────────────────────────────

  describe('read access', function () {
    it('allows read for authenticated symposium user', async function () {
      await assertSucceeds(
        getDoc(doc(authedDb, 'symposium_shopping_list', 'item-read-test'))
      );
    });

    it('denies read for unauthenticated user', async function () {
      var unauthDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(unauthDb, 'symposium_shopping_list', 'item-read-test'))
      );
    });

    it('denies read for user without symposium app claim', async function () {
      var wrongDb = testEnv
        .authenticatedContext('user-002', { apps: ['other-app'] })
        .firestore();
      await assertFails(
        getDoc(doc(wrongDb, 'symposium_shopping_list', 'item-read-test'))
      );
    });
  });

  // ── 2. Valid creates ──────────────────────────────────────────────────────

  describe('valid creates', function () {
    it('allows create of a freeform item (ingredientId null)', async function () {
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_shopping_list', 'item-freeform'), makeShoppingItem())
      );
    });

    it('allows create of a linked item (ingredientId set)', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-linked'),
          makeShoppingItem({ ingredientId: 'ing-001' })
        )
      );
    });

    it('allows create of a checked item', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-checked'),
          makeShoppingItem({ checked: true })
        )
      );
    });

    it('allows create with addedFrom auto-suggest', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-autosuggest'),
          makeShoppingItem({ addedFrom: 'auto-suggest' })
        )
      );
    });

    it('allows create with addedFrom recipe and sourceRecipeId set', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-from-recipe'),
          makeShoppingItem({ addedFrom: 'recipe', sourceRecipeId: 'recipe-001' })
        )
      );
    });

    it('allows create with non-empty notes', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-with-notes'),
          makeShoppingItem({ notes: 'Prefer small-batch if available' })
        )
      );
    });

    it('allows create with quantity 0', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-qty-0'),
          makeShoppingItem({ quantity: 0 })
        )
      );
    });
  });

  // ── 3. Valid updates ──────────────────────────────────────────────────────

  describe('valid updates', function () {
    it('allows update to toggle checked state', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_shopping_list', 'item-toggle'), {
          name: 'Lime Juice',
          quantity: 2,
          unit: 'oz',
          category: 'citrus',
          checked: false,
          addedFrom: 'manual',
          ingredientId: null,
          sourceRecipeId: null,
          notes: '',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      var updateData = makeShoppingItem({
        name: 'Lime Juice',
        quantity: 2,
        unit: 'oz',
        category: 'citrus',
        checked: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: serverTimestamp(),
      });
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_shopping_list', 'item-toggle'), updateData)
      );
    });

    it('rejects update that changes createdAt', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_shopping_list', 'item-immutable-cat'), {
          name: 'Angostura',
          quantity: 1,
          unit: 'bottle',
          category: 'bitters',
          checked: false,
          addedFrom: 'manual',
          ingredientId: null,
          sourceRecipeId: null,
          notes: '',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      var updateData = makeShoppingItem({
        name: 'Angostura',
        category: 'bitters',
        createdAt: new Date('2025-06-01'), // changed!
        updatedAt: serverTimestamp(),
      });
      await assertFails(
        setDoc(doc(authedDb, 'symposium_shopping_list', 'item-immutable-cat'), updateData)
      );
    });
  });

  // ── 4. Delete ─────────────────────────────────────────────────────────────

  describe('delete', function () {
    const { deleteDoc } = require('firebase/firestore');

    it('allows delete by authenticated symposium user', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_shopping_list', 'item-to-delete'), {
          name: 'Delete Me',
          quantity: 1,
          unit: 'each',
          category: 'misc',
          checked: false,
          addedFrom: 'manual',
          ingredientId: null,
          sourceRecipeId: null,
          notes: '',
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertSucceeds(
        deleteDoc(doc(authedDb, 'symposium_shopping_list', 'item-to-delete'))
      );
    });
  });

  // ── 5. Rejection cases ────────────────────────────────────────────────────

  describe('rejection cases', function () {
    it('rejects create with missing required field (name)', async function () {
      var data = makeShoppingItem();
      delete data.name;
      await assertFails(setDoc(doc(authedDb, 'symposium_shopping_list', 'item-no-name'), data));
    });

    it('rejects create with missing required field (checked)', async function () {
      var data = makeShoppingItem();
      delete data.checked;
      await assertFails(
        setDoc(doc(authedDb, 'symposium_shopping_list', 'item-no-checked'), data)
      );
    });

    it('rejects create with quantity as string', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-qty-string'),
          makeShoppingItem({ quantity: '2' })
        )
      );
    });

    it('rejects create with empty name', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-empty-name'),
          makeShoppingItem({ name: '' })
        )
      );
    });

    it('rejects create with invalid addedFrom value', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-bad-source'),
          makeShoppingItem({ addedFrom: 'imported' })
        )
      );
    });

    it('rejects create with unknown extra field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-extra-field'),
          makeShoppingItem({ unexpectedField: 'surprise' })
        )
      );
    });

    it('rejects create with name exceeding 200 characters', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-long-name'),
          makeShoppingItem({ name: 'A'.repeat(201) })
        )
      );
    });

    it('rejects create with checked as string', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-checked-string'),
          makeShoppingItem({ checked: 'true' })
        )
      );
    });

    it('rejects create with negative quantity', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_shopping_list', 'item-negative-qty'),
          makeShoppingItem({ quantity: -1 })
        )
      );
    });
  });
});

// ── symposium_ingredients — Firestore Security Rules ─────────────────────────

function makeIngredient(overrides) {
  var base = {
    name: 'Buffalo Trace',
    category: TEST_CATEGORY_ID,
    subcategory: 'bourbon',
    tags: ['whiskey', 'american'],
    unit: 'oz',
    type: 'consumable',
    inStock: false,
    quantity: 0,
    trackingType: 'volume',
    stock: 0,
    bottleSize: 750,
    bottleSizeUnit: 'ml',
    notes: '',
    shoppingListDefault: true,
    lowStockThreshold: 1,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  return Object.assign({}, base, overrides || {});
}

describe('symposium_ingredients — Firestore Security Rules', function () {
  var testEnv;
  var authedDb;

  beforeAll(async function () {
    var firestoreConfig = {
      rules: readFileSync(RULES_PATH, 'utf8'),
    };

    var emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost) {
      var parts = emulatorHost.split(':');
      var host = parts[0];
      var portString = parts[1];
      if (host) {
        firestoreConfig.host = host;
      }
      if (portString) {
        var parsedPort = parseInt(portString, 10);
        if (!isNaN(parsedPort)) {
          firestoreConfig.port = parsedPort;
        }
      }
    } else {
      firestoreConfig.host = '127.0.0.1';
      firestoreConfig.port = 8080;
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: firestoreConfig,
    });

    // Seed the category document (bypass rules)
    await testEnv.withSecurityRulesDisabled(async function (ctx) {
      await setDoc(
        doc(ctx.firestore(), 'symposium_categories', TEST_CATEGORY_ID),
        TEST_CATEGORY_DATA
      );
    });

    authedDb = testEnv.authenticatedContext('user-001', SYMPOSIUM_TOKEN).firestore();
  });

  afterAll(async function () {
    await testEnv.cleanup();
  });

  afterEach(async function () {
    await testEnv.clearFirestore();
    // Re-seed the category after each clearFirestore()
    await testEnv.withSecurityRulesDisabled(async function (ctx) {
      await setDoc(
        doc(ctx.firestore(), 'symposium_categories', TEST_CATEGORY_ID),
        TEST_CATEGORY_DATA
      );
    });
  });

  // ── 1. Valid creates ──────────────────────────────────────────────────────

  describe('valid creates', function () {
    it('allows create of a valid volume-tracked ingredient', async function () {
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_ingredients', 'ing-001'), makeIngredient())
      );
    });

    it('allows create of a valid quantity-tracked ingredient', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_ingredients', 'ing-qty'),
          makeIngredient({ unit: 'each', trackingType: 'quantity', bottleSize: 0 })
        )
      );
    });

    it('allows create with openBottleLevel set to a valid level', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_ingredients', 'ing-with-level'),
          makeIngredient({ openBottleLevel: 'half', stock: 1, inStock: true })
        )
      );
    });
  });

  // ── 2. Brand field — intake flow ──────────────────────────────────────────

  describe('brand field (stock intake)', function () {
    it('allows update with a valid brand string', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-brand-test'), {
          name: 'Bourbon',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: [],
          unit: 'oz',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'volume',
          stock: 0,
          bottleSize: 750,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: false,
          lowStockThreshold: 1,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertSucceeds(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-brand-test'), {
          stock: 1,
          inStock: true,
          openBottleLevel: 'full',
          brand: 'Buffalo Trace',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('allows update without brand (backward compatible)', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-no-brand'), {
          name: 'Simple Syrup',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: [],
          unit: 'oz',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'volume',
          stock: 0,
          bottleSize: 750,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: false,
          lowStockThreshold: 0,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertSucceeds(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-no-brand'), {
          stock: 2,
          inStock: true,
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('rejects update with brand exceeding 200 characters', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-brand-long'), {
          name: 'Whiskey',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: [],
          unit: 'oz',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'volume',
          stock: 0,
          bottleSize: 750,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: false,
          lowStockThreshold: 0,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertFails(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-brand-long'), {
          stock: 1,
          inStock: true,
          brand: 'B'.repeat(201),
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('rejects update with brand as a non-string value', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-brand-type'), {
          name: 'Rye',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: [],
          unit: 'oz',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'volume',
          stock: 0,
          bottleSize: 750,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: false,
          lowStockThreshold: 0,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertFails(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-brand-type'), {
          stock: 1,
          inStock: true,
          brand: 42,
          updatedAt: serverTimestamp(),
        })
      );
    });
  });

  // ── 3. Intake update pattern ──────────────────────────────────────────────

  describe('intake update pattern', function () {
    it('allows partial update that increments stock, sets inStock and openBottleLevel', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-intake'), {
          name: 'Mezcal',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: ['smoky'],
          unit: 'oz',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'volume',
          stock: 0,
          bottleSize: 750,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: true,
          lowStockThreshold: 1,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertSucceeds(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-intake'), {
          stock: 1,
          inStock: true,
          openBottleLevel: 'full',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('allows partial update that increments quantity for quantity-tracked ingredient', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(doc(ctx.firestore(), 'symposium_ingredients', 'ing-intake-qty'), {
          name: 'Maraschino Cherry',
          category: TEST_CATEGORY_ID,
          subcategory: 'bourbon',
          tags: [],
          unit: 'each',
          type: 'consumable',
          inStock: false,
          quantity: 0,
          trackingType: 'quantity',
          stock: 0,
          bottleSize: 0,
          bottleSizeUnit: 'ml',
          notes: '',
          shoppingListDefault: true,
          lowStockThreshold: 5,
          createdAt: new Date('2024-01-01'),
          updatedAt: new Date('2024-01-01'),
        });
      });

      await assertSucceeds(
        updateDoc(doc(authedDb, 'symposium_ingredients', 'ing-intake-qty'), {
          quantity: 1,
          inStock: true,
          updatedAt: serverTimestamp(),
        })
      );
    });
  });

  // ── 4. Rejection cases ────────────────────────────────────────────────────

  describe('rejection cases', function () {
    it('rejects create with unknown extra field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_ingredients', 'ing-extra-field'),
          makeIngredient({ unexpectedField: 'surprise' })
        )
      );
    });

    it('rejects create with invalid openBottleLevel', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_ingredients', 'ing-bad-level'),
          makeIngredient({ openBottleLevel: 'mostly-full' })
        )
      );
    });
  });
});

// ── symposium_categories — Firestore Security Rules ───────────────────────────

function makeCategory(overrides) {
  var base = {
    name: 'Craft Beer',
    type: 'ingredient',
    subcategories: ['lager', 'ale', 'stout'],
    sortOrder: 20,
  };
  return Object.assign({}, base, overrides || {});
}

describe('symposium_categories — Firestore Security Rules', function () {
  var testEnv;
  var authedDb;
  var unauthDb;
  var wrongDb;

  beforeAll(async function () {
    var firestoreConfig = {
      rules: readFileSync(RULES_PATH, 'utf8'),
    };

    var emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
    if (emulatorHost) {
      var parts = emulatorHost.split(':');
      var host = parts[0];
      var portString = parts[1];
      if (host) {
        firestoreConfig.host = host;
      }
      if (portString) {
        var parsedPort = parseInt(portString, 10);
        if (!isNaN(parsedPort)) {
          firestoreConfig.port = parsedPort;
        }
      }
    } else {
      firestoreConfig.host = '127.0.0.1';
      firestoreConfig.port = 8080;
    }

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: firestoreConfig,
    });

    authedDb = testEnv.authenticatedContext('user-001', SYMPOSIUM_TOKEN).firestore();
    unauthDb = testEnv.unauthenticatedContext().firestore();
    wrongDb = testEnv.authenticatedContext('user-002', { apps: ['other-app'] }).firestore();
  });

  afterAll(async function () {
    await testEnv.cleanup();
  });

  afterEach(async function () {
    await testEnv.clearFirestore();
  });

  // ── Read access ──────────────────────────────────────────────────────────────

  describe('read access', function () {
    it('allows read for authenticated symposium user', async function () {
      await assertSucceeds(getDoc(doc(authedDb, 'symposium_categories', 'cat-test')));
    });

    it('denies read for unauthenticated user', async function () {
      await assertFails(getDoc(doc(unauthDb, 'symposium_categories', 'cat-test')));
    });

    it('denies read for user without symposium claim', async function () {
      await assertFails(getDoc(doc(wrongDb, 'symposium_categories', 'cat-test')));
    });
  });

  // ── Create ───────────────────────────────────────────────────────────────────

  describe('create', function () {
    it('allows create of a valid ingredient category', async function () {
      await assertSucceeds(
        setDoc(doc(authedDb, 'symposium_categories', 'craft-beer'), makeCategory())
      );
    });

    it('allows create of a valid recipe category', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'tiki-2'),
          makeCategory({ type: 'recipe' })
        )
      );
    });

    it('allows create of a valid equipment category', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'copper-tools'),
          makeCategory({ type: 'equipment' })
        )
      );
    });

    it('allows create of ingredient category with empty subcategories list', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'empty-subs'),
          makeCategory({ type: 'ingredient', subcategories: [] })
        )
      );
    });

    it('allows create of equipment category with empty subcategories list', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'empty-subs-eq'),
          makeCategory({ type: 'equipment', subcategories: [] })
        )
      );
    });

    it('allows create with sortOrder of 0', async function () {
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'zero-order'),
          makeCategory({ sortOrder: 0 })
        )
      );
    });

    it('rejects create with unknown extra field', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-cat'),
          makeCategory({ unexpectedField: 'oops' })
        )
      );
    });

    it('rejects create with missing required field (name)', async function () {
      var data = makeCategory();
      delete data.name;
      await assertFails(setDoc(doc(authedDb, 'symposium_categories', 'bad-cat'), data));
    });

    it('rejects create with empty name', async function () {
      await assertFails(
        setDoc(doc(authedDb, 'symposium_categories', 'bad-cat'), makeCategory({ name: '' }))
      );
    });

    it('rejects create with name exceeding 200 characters', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-cat'),
          makeCategory({ name: 'A'.repeat(201) })
        )
      );
    });

    it('rejects create with invalid type', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-type'),
          makeCategory({ type: 'cocktail' })
        )
      );
    });

    it('rejects create with sortOrder as string', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-order'),
          makeCategory({ sortOrder: '20' })
        )
      );
    });

    it('rejects create with negative sortOrder', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-order'),
          makeCategory({ sortOrder: -1 })
        )
      );
    });

    it('rejects create with subcategories as string', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'bad-subs'),
          makeCategory({ subcategories: 'bourbon' })
        )
      );
    });

    it('rejects create of recipe category with empty subcategories', async function () {
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'recipe-no-subs'),
          makeCategory({ type: 'recipe', subcategories: [] })
        )
      );
    });

    it('denies create for unauthenticated user', async function () {
      await assertFails(
        setDoc(doc(unauthDb, 'symposium_categories', 'craft-beer'), makeCategory())
      );
    });

    it('denies create for user without symposium claim', async function () {
      await assertFails(
        setDoc(doc(wrongDb, 'symposium_categories', 'craft-beer'), makeCategory())
      );
    });
  });

  // ── Update ───────────────────────────────────────────────────────────────────

  describe('update', function () {
    it('allows update of name and subcategories', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-update'),
          makeCategory()
        );
      });
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'cat-update'),
          makeCategory({ name: 'Updated Name', subcategories: ['lager'] })
        )
      );
    });

    it('allows update of sortOrder', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-reorder'),
          makeCategory()
        );
      });
      await assertSucceeds(
        setDoc(
          doc(authedDb, 'symposium_categories', 'cat-reorder'),
          makeCategory({ sortOrder: 5 })
        )
      );
    });

    it('rejects update that changes type', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-type-change'),
          makeCategory({ type: 'ingredient' })
        );
      });
      await assertFails(
        setDoc(
          doc(authedDb, 'symposium_categories', 'cat-type-change'),
          makeCategory({ type: 'recipe' })
        )
      );
    });

    it('denies update for unauthenticated user', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-unauth-update'),
          makeCategory()
        );
      });
      await assertFails(
        setDoc(
          doc(unauthDb, 'symposium_categories', 'cat-unauth-update'),
          makeCategory({ name: 'Hacked' })
        )
      );
    });
  });

  // ── Delete ───────────────────────────────────────────────────────────────────

  describe('delete', function () {
    const { deleteDoc } = require('firebase/firestore');

    it('allows delete by authenticated symposium user', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-to-delete'),
          makeCategory()
        );
      });
      await assertSucceeds(deleteDoc(doc(authedDb, 'symposium_categories', 'cat-to-delete')));
    });

    it('denies delete for unauthenticated user', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-unauth'),
          makeCategory()
        );
      });
      await assertFails(deleteDoc(doc(unauthDb, 'symposium_categories', 'cat-unauth')));
    });

    it('denies delete for user without symposium claim', async function () {
      await testEnv.withSecurityRulesDisabled(async function (ctx) {
        await setDoc(
          doc(ctx.firestore(), 'symposium_categories', 'cat-wrong-app'),
          makeCategory()
        );
      });
      await assertFails(deleteDoc(doc(wrongDb, 'symposium_categories', 'cat-wrong-app')));
    });
  });
});
