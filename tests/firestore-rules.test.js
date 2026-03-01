'use strict';

const { initializeTestEnvironment, assertFails, assertSucceeds } =
  require('@firebase/rules-unit-testing');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} = require('firebase/firestore');

const RULES_PATH = resolve(__dirname, '../firestore.rules');
const PROJECT_ID = 'demo-olympus-rules-test';

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
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: '127.0.0.1',
        port: 8080,
        rules: readFileSync(RULES_PATH, 'utf8'),
      },
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
