# Claude Code — Project Memory

## After Making Changes

Always run lint and format before committing or finishing work:

```bash
npm run lint:fix
npm run format
```

## Output Style

- Do not wrap URLs/links in asterisks (`**`). Asterisks become part of the URL and break clickable links.
  - Bad: `**https://example.com**`
  - Good: `https://example.com`

---

## Project Overview

**olympus-web** is a multi-app Firebase platform hosting several web applications under a single unified authentication system called **The Grand Hall**. It is a zero-build-step static hosting architecture with Firestore for data storage and Cloud Functions for privileged operations.

**Firebase Project ID:** `olympus-dfa00`

### Applications

| App | Directory | Description |
|-----|-----------|-------------|
| The Grand Hall | `public/index.html` | Central launcher and auth portal |
| The Symposium | `public/apps/symposium/` | Cocktail inventory management |
| The Pantheon | `public/apps/admin/` | Admin panel for user management |
| JSX Runner | `public/apps/jsx-runner/` | Dynamic React applet executor |
| Void Odyssey | `public/apps/void-odyssey/` | AI-powered space exploration game |

---

## Technology Stack

### Frontend
- **Vanilla JavaScript** — IIFE namespace pattern (no bundler, no build step)
- **React 18.3.1** — CDN via unpkg.com (used in JSX Runner applets only)
- **Babel Standalone 7.26.10** — In-browser JSX transpilation (JSX Runner only)
- **Firebase SDK v12.9** — CDN, compat mode (`firebase/compat/app`, etc.)
- **js-yaml 4.1.0** — YAML manifest parsing (CDN)
- **CSS3** — Custom dark theme, no CSS framework

### Backend
- **Firebase Hosting** — Static, `public/` directory
- **Firestore** — `us-central1`, schema enforced by security rules
- **Cloud Functions v2** — Node.js 22, ES module CommonJS in `functions/index.js`
- **Firebase Auth** — Email/password + Google Sign-in

### Dev Tooling
- **ESLint 9** — `eslint.config.js` with separate configs per zone
- **Prettier 3** — `.prettierrc`, semi:true, singleQuote:true, printWidth:100
- **Jest 29** — Firestore security rules tests + Void Odyssey turn integration tests using Firebase emulator
- **GitHub Actions** — 6 workflows for CI, preview deploys, and production deploys

---

## Repository Structure

```
olympus-web/
├── public/                        # Firebase Hosting root (all frontend)
│   ├── index.html                 # The Grand Hall (launcher + auth)
│   ├── apps.yaml                  # App registry manifest
│   ├── styles/app.css             # Shared dark-theme stylesheet
│   ├── js/components/
│   │   └── app-header.js          # Shared navigation header component
│   └── apps/
│       ├── _template/             # Boilerplate for creating new apps
│       ├── symposium/             # Cocktail inventory app (~6,500 lines JS)
│       ├── admin/                 # Admin panel
│       ├── jsx-runner/            # React applet executor
│       └── void-odyssey/          # Space game with AI narrative
├── functions/
│   ├── index.js                   # Cloud Functions: user/admin management (~2,200 lines)
│   └── gemini.js                  # Gemini/Vertex AI callGemini helper (extracted for testability)
├── tests/
│   ├── firestore-rules.test.js    # Jest tests for Firestore security rules
│   ├── void-odyssey-turn.test.js  # Integration tests for Void Odyssey turn function
│   └── fixtures/
│       └── void-odyssey.js        # Test fixture factories (makeGame, makeCrew, etc.)
├── scripts/                       # One-time admin utility scripts
├── planning/                      # Architecture and design documentation
├── .github/workflows/             # CI/CD pipelines
├── firebase.json                  # Firebase configuration
├── firestore.rules                # Firestore security rules
├── firestore.indexes.json         # Firestore index definitions
├── .firebaserc                    # Firebase project alias
├── eslint.config.js               # ESLint configuration
└── .prettierrc                    # Prettier configuration
```

---

## Code Architecture & Conventions

### IIFE Namespace Pattern

All vanilla JS files use an Immediately Invoked Function Expression that attaches to a global namespace. Each app owns its namespace (e.g., `window.Symposium`, `window.VoidOdyssey`).

```js
// State file — defines namespace and exports constants
window.AppName = window.AppName || {};
window.AppName.SOME_CONSTANT = 'value';

// Feature file — extends namespace
(function () {
  const { db, SOME_CONSTANT } = window.AppName;

  function doSomething() { ... }

  window.AppName.doSomething = doSomething;
})();
```

### Script Loading Order

Within each app's `index.html`, scripts must be loaded in dependency order:
1. `state.js` — namespace, constants, shared state
2. Feature modules (e.g., `firestore.js`, domain logic files)
3. `app.js` — initialization, routing, event wiring (always last)

### Firebase Auth Guard

Every app (except The Grand Hall) guards its content with `onAuthStateChanged`. The pattern is:

```js
firebase.auth().onAuthStateChanged((user) => {
  if (!user) {
    window.location.href = '/';
    return;
  }
  // init app
});
```

### App Access Control

Access is controlled via Firebase custom claims. Users have an `apps[]` array and an `admin` boolean in their token.

- `hasAdmin()` — checks `request.auth.token.admin == true`
- `hasApp('symposium')` — checks if `'symposium'` is in the user's apps claim

The Cloud Functions in `functions/index.js` manage these claims via `setAdminRole`, `removeAdminRole`, and `manageAccess`.

### Shared Components

- **`public/js/components/app-header.js`** — Navigation header with back button, user menu, logout. All apps include this via `<script>`.
- **`public/styles/app.css`** — Base stylesheet. All apps link this in addition to their own CSS.

---

## Common NPM Scripts

```bash
# Code quality (run before every commit)
npm run lint:fix          # Auto-fix ESLint issues
npm run format            # Prettier format all files
npm run lint              # Lint check only (no fix)
npm run format:check      # Prettier check only (no write)

# Local development
npm run emulator          # Start all emulators (Functions + Firestore + Hosting)
npm run emulator:hosting  # Hosting emulator only

# Testing
npm run test:install      # Install test dependencies (first time)
npm test                  # Run Firestore rules tests with Jest

# Deployment
npm run deploy:preview    # Deploy to Firebase preview channel
npm run deploy            # Deploy hosting only (production)
```

---

## Firestore Collections

| Collection | Access | Description |
|---|---|---|
| `symposium_ingredients/{id}` | `hasApp('symposium')` | Ingredient inventory |
| `symposium_equipment/{id}` | `hasApp('symposium')` | Equipment inventory |
| `symposium_recipes/{id}` | `hasApp('symposium')` | Recipes |
| `symposium_shopping_list/{id}` | `hasApp('symposium')` | Shopping list items |
| `symposium_categories/{id}` | `hasApp('symposium')` | Categories/subcategories |
| `void_odyssey_games/{gameId}` | User-scoped (userId match) | Game campaigns |
| `apps/{appId}` | `hasApp(appId)` or admin | App registry |
| `pool_handicap/{userId}` | Self read/write only | Billiards handicap data |

Default: all other paths deny read/write.

---

## Cloud Functions

All functions are Firebase Callable (HTTPS) Functions v2. They are in `functions/index.js`.

| Function | Who Can Call | Purpose |
|---|---|---|
| `setAdminRole` | Admin only | Grant admin custom claim |
| `removeAdminRole` | Admin only | Revoke admin custom claim |
| `listUsers` | Admin only | List all Auth users |
| `inviteUser` | Admin only | Create new user account |
| `manageAccess` | Admin only | Add/remove app from user's claims |
| `setUserDisabled` | Admin only | Enable/disable a user |
| `getUserByEmail` | Admin only | Look up user by email |

Functions preserve existing custom claims when modifying them (merge pattern, not overwrite).

---

## GitHub Actions Workflows

| Workflow | Trigger | Action |
|---|---|---|
| `code-quality.yml` | Push/PR to main | ESLint + Prettier check |
| `firebase-hosting-pull-request.yml` | Pull Request | Deploy preview channel, comment URL on PR |
| `firebase-hosting-merge.yml` | Push to main | Deploy hosting + Firestore rules/indexes + Cloud Functions |
| `firestore-rules.yml` | Push/PR to main | Run Jest tests against Firestore emulator |
| `set-admin.yml` | Manual dispatch | Grant or revoke admin claim |
| `seed-categories.yml` | Manual dispatch | Populate Symposium categories |

**Required secret:** `FIREBASE_SERVICE_ACCOUNT_OLYMPUS_DFA00`

---

## Local Development Setup

### Prerequisites
- Node.js 22+
- Java (required for Firestore emulator)
- Firebase CLI: `npm install -g firebase-tools`
- Firebase login: `firebase login`

### Initial Setup
```bash
npm install                 # Root dev dependencies (ESLint, Prettier)
cd functions && npm install # Functions dependencies
cd tests && npm ci          # Test dependencies
```

### Running Locally
```bash
npm run emulator            # Starts at localhost:5000 (hosting), 5001 (functions), 8080 (firestore)
```

No build step required. Edit files in `public/` and refresh the browser.

---

## Adding a New App

1. Copy `public/apps/_template/` to `public/apps/your-app-name/`
2. Add an entry to `public/apps.yaml`
3. Add Firestore rules for new collections in `firestore.rules`
4. Add the app ID to user claims via The Pantheon admin panel or `manageAccess` function
5. Follow the IIFE namespace pattern for JS modules

---

## Commit Style

Follow Conventional Commits with scopes matching the app or area changed:

```
feat(symposium): add batch delete for shopping list items
fix(void-odyssey): correct star map coordinate offset
docs(admin): update user management instructions
chore(ci): update Firebase deploy action version
```

---

## Void Odyssey — AI Integration

Void Odyssey generates narrative text via Gemini Flash (Vertex AI). The AI call is isolated in `functions/gemini.js` (`callGemini`), which `functions/index.js` imports. This separation enables Jest mocking for tests.

### Void Odyssey Turn Integration Tests

Tests live in `tests/void-odyssey-turn.test.js` with fixtures in `tests/fixtures/void-odyssey.js`. They run against the Firestore emulator with mocked AI responses.

**Running tests locally:**
```bash
cd functions && npm ci                 # Ensure functions deps are installed
cd tests && npm ci                     # Ensure test deps are installed
firebase emulators:exec --only firestore --project demo-void-odyssey-test "cd tests && npx jest void-odyssey-turn --verbose"
```

**Running with real Gemini (requires credentials):**
```bash
VOID_ODYSSEY_LIVE_AI=true firebase emulators:exec --only firestore --project demo-void-odyssey-test "cd tests && npx jest void-odyssey-turn"
```

**Adding a new test scenario:**
1. Open `tests/void-odyssey-turn.test.js`
2. Use the fixture factories from `tests/fixtures/void-odyssey.js`:
   - `makeGame(overrides)` — game document (supports `{ ship: {...} }` for nested overrides)
   - `makeCrew(overrides)` — crew member
   - `makeItem(overrides)` — cargo item
   - `makeQuest(overrides)` — quest with objectives
   - `makeLocation(overrides)` — location document
   - `makeStarMapSystem(overrides)` — star map system
   - `makeAiResponse(overrides)` — AI response with `stateMutations`, `newEntities`, etc.
   - `makePlayerAction(overrides)` — player action input
3. Follow this pattern:
```js
test('my scenario description', async () => {
  // 1. Seed game state (customize as needed)
  await seedGame({
    game: { ship: { fuel: 50 } },
    items: [makeItem({ id: 'item_old', name: 'Old Part' })],
  });

  // 2. Mock the AI response with specific mutations
  mockAiResponse(makeAiResponse({
    stateMutations: [
      { type: 'remove_item', itemId: 'item_old' },
      { type: 'add_item', item: { id: 'item_new', name: 'New Part', type: 'equipment', description: '...', cargoUnits: 2, quantity: 1, rarity: 'uncommon' } },
    ],
  }));

  // 3. Call the turn function
  const result = await callTurn({ type: 'freeform', input: 'Swap the part' });

  // 4. Assert on the return value and/or Firestore state
  const itemSnap = await gameRef().collection('items').doc('item_new').get();
  expect(itemSnap.exists).toBe(true);
});
```

**Available mutation types for `stateMutations`:**
`ship_stat`, `credits`, `add_item`, `remove_item`, `crew_morale`, `crew_health`, `crew_relationship`, `crew_significant_moment`, `crew_departure`, `location_discover`, `location_update`, `travel`, `combat_start`, `combat_end`, `weapon_status`, `system_status`, `quest_start`, `quest_update`, `star_map_discover`, `star_map_update`

**Known quirk:** `crew_relationship` uses `set()` with merge and dot-notation keys (e.g., `"relationships.crew_pilot"`), which Firestore stores as flat literal keys, not nested paths. Assert with `data['relationships.crew_pilot']` not `data.relationships.crew_pilot`.

---

## JSX Runner — In-Browser React

JSX Runner loads applets defined in `public/apps/jsx-runner/applets.yaml`. Each applet is a `.jsx` file that exports a default React component. Babel Standalone transpiles JSX at runtime — there is no compile step. React and ReactDOM are loaded from CDN.

To add a new applet:
1. Create `public/apps/jsx-runner/applets/your-applet.jsx`
2. Add it to `public/apps/jsx-runner/applets.yaml`
