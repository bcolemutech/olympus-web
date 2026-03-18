# Olympus-Web Architecture

## Overview

**Olympus-web** is a multi-app Firebase platform called **The Grand Hall** — a central authenticated launcher that hosts multiple single-page sub-applications. There is no build step for the frontend; all code is static JavaScript served via Firebase Hosting with Firestore as the database and Cloud Functions v2 for privileged operations.

- **Firebase Project:** `olympus-dfa00`
- **Hosting:** Firebase Hosting (`/public` directory)
- **Database:** Firestore (us-central1)
- **Functions:** Cloud Functions v2, Node.js 22
- **Auth:** Firebase Auth (email/password + Google Sign-in) with custom claims

---

## Repository Structure

```
olympus-web/
├── public/              # Firebase Hosting root (all frontend code)
│   ├── index.html       # Grand Hall (main launcher/auth page)
│   ├── apps.yaml        # App registry manifest
│   ├── apps/            # Sub-applications
│   │   ├── symposium/   # Cocktail inventory management
│   │   ├── admin/       # Admin panel (The Pantheon)
│   │   ├── jsx-runner/  # Dynamic React applet runner
│   │   ├── example/     # Minimal working example
│   │   └── _template/   # Starter template for new apps
│   ├── js/
│   │   └── components/
│   │       └── app-header.js  # Shared header component
│   └── styles/
│       └── app.css      # Shared dark-theme stylesheet
├── functions/           # Cloud Functions (Node.js 22, CommonJS)
├── scripts/             # One-time admin/setup utility scripts
├── tests/               # Firestore security rules tests (Jest)
├── planning/            # Documentation and planning files
├── .github/workflows/   # GitHub Actions CI/CD pipelines
├── firebase.json        # Firebase project config
├── .firebaserc          # Project alias (default: olympus-dfa00)
├── firestore.rules      # Firestore security rules
└── firestore.indexes.json
```

---

## Sub-Applications

### 1. The Grand Hall (`/public/index.html`)
The central entry point and auth hub.
- **Tech:** Vanilla JS, Firebase Auth SDK v12.9 (compat)
- **Responsibilities:**
  - Email/password and Google Sign-in
  - Loads `apps.yaml` and renders the app grid
  - Profile view ("The Oracle's Mirror", `?view=profile`)
  - Redirects to individual apps
- **Auth claims:** Reads `apps[]` and `admin` custom claims to filter visible apps

### 2. The Symposium (`/public/apps/symposium/`)
Full-featured cocktail and bar inventory management system.
- **Tech:** Vanilla JS (IIFE namespace pattern), Firestore
- **Modules (load order):**
  | File | Lines | Purpose |
  |------|-------|---------|
  | `state.js` | 201 | Namespace init, constants, shared state |
  | `firestore.js` | 186 | Firestore CRUD operations |
  | `amphora.js` | 336 | Ingredient inventory logic |
  | `equipment.js` | 433 | Equipment management |
  | `appellations.js` | 504 | Category/classification system |
  | `ingredients.js` | 689 | Ingredient UI and logic |
  | `shopping.js` | 691 | Shopping list functionality |
  | `recipes.js` | 2,236 | Recipe management |
  | `inventory.js` | 228 | Inventory tracking |
  | `app.js` | 659 | Event listeners, init, tab routing |
- **Tabs:** Ingredients, Equipment, Recipes, Shopping List, Inventory, Search
- **Firestore collections:** `symposium_ingredients`, `symposium_equipment`, `symposium_recipes`, `symposium_shopping_list`, `symposium_categories`

### 3. The Pantheon (`/public/apps/admin/`)
Admin panel for user and app management.
- **Tech:** Vanilla JS, calls Cloud Functions for privileged operations
- **Requires:** `admin: true` custom claim
- **Modules:**
  | File | Lines | Purpose |
  |------|-------|---------|
  | `state.js` | 25 | Basic state init |
  | `app.js` | 115 | Init, routing |
  | `users.js` | 543 | User list, invite, role management |
  | `apps-tab.js` | 109 | App registry view |
- **Tabs:** Users, Apps
- **Operations:** List users, invite users, grant/revoke admin, manage app access

### 4. JSX Runner (`/public/apps/jsx-runner/`)
Dynamic React applet execution engine — no build step required.
- **Tech:** React 18.3.1 + Babel Standalone 7.26.10 (all via CDN), js-yaml
- **How it works:** Loads `applets.yaml` manifest → transpiles JSX client-side → renders in React
- **Current applets (`/applets/`):**
  - `hello-world.jsx` — Demo greeting
  - `counter.jsx` — Click counter demo
  - `pool-powerups.jsx` (1,330 lines) — Handicap card system for billiards

### 5. Example App (`/public/apps/example/`)
Minimal working app for reference.

### 6. App Template (`/public/apps/_template/`)
Blueprint for creating new embedded apps. Demonstrates:
- IIFE namespace module pattern
- Shared header integration
- Auth guard pattern
- Script load order: `state.js` → external modules → `app.js`

---

## App Manifest (`apps.yaml`)

All apps are registered in `/public/apps.yaml`. Each entry has:
```yaml
- id: symposium
  name: The Symposium
  description: "..."
  icon: "🍸"
  type: embedded       # 'embedded' or 'jsx'
  path: /apps/symposium/
  enabled: true
  order: 1
```
- `type: embedded` — Full HTML app at a path
- `type: jsx` — JSX applet file loaded by the JSX Runner
- Access is filtered by the user's `apps[]` custom claim

---

## Shared Infrastructure

### Shared Header (`/public/js/components/app-header.js`)
All embedded apps use a shared header rendered via:
```js
window.OlympusHeader.render('App Name');
```
Renders: back link to Grand Hall, app name, profile link, sign-out button.

### Shared Styles (`/public/styles/app.css`)
Dark theme with gold/orange gradient accents. Provides: cards, buttons, dividers, loading spinners, mobile responsive layout.

### Firebase SDK (CDN)
All apps load Firebase SDK v12.9.0 (compat) from `/__/firebase/` (Firebase Hosting auto-injection). Uses `?useEmulator=true` for local development.

---

## Authentication & Authorization

### Auth Flow
1. Firebase Auth handles email/password and Google sign-in on the Grand Hall
2. Auth state persists via localStorage
3. Custom JWT claims are set by Cloud Functions

### Custom Claims
| Claim | Type | Purpose |
|-------|------|---------|
| `admin` | boolean | Grants access to The Pantheon |
| `apps` | string[] | Allowlist of accessible app IDs |

### Firestore Security Rules
- Default deny on all collections
- Helper functions:
  - `hasApp(appId)` — `appId` in `request.auth.token.apps`
  - `hasAdmin()` — `request.auth.token.admin == true`
- Symposium collections require `hasApp('symposium')`
- App registry requires `hasApp(appId) || hasAdmin()`

### Bootstrap
The first admin must be set manually (Firebase Console or local script with service account). After that, admins can promote/demote users via The Pantheon or the `set-admin` GitHub Actions workflow.

---

## Cloud Functions

All functions are in `/functions/`, Cloud Functions v2, Node.js 22, CommonJS.

| Function | Purpose |
|----------|---------|
| `inviteUser` | Create a new Firebase Auth user and set initial app access |
| `setAdminRole` | Grant or revoke `admin: true` custom claim |
| `setUserApps` | Update a user's `apps[]` custom claim |
| `listUsers` | Paginated list of all auth users |
| `getUserAppAccess` | Get a user's current app access list |
| `disableUser` | Enable or disable a user account |
| `deleteUser` | Permanently delete a user |

All functions:
- Are callable (HTTPS callable)
- Verify the caller has `admin: true`
- Return structured `{ success, message, data }` responses

---

## Firestore Data Models

### `symposium_ingredients`
```
name, category, subcategory, tags[], unit, type='consumable',
inStock, quantity, trackingType ('volume'|'quantity'),
stock, bottleSize, bottleSizeUnit, notes,
shoppingListDefault, lowStockThreshold,
createdAt, updatedAt,
openBottleLevel? (optional), brand? (optional)
```

### `symposium_equipment`
```
name, category, subcategory, tags[], type='reusable',
quantity, condition ('good'|'fair'|'replace'),
notes, createdAt, updatedAt
```

### `symposium_recipes`
```
name, category, subcategory, tags[], description, instructions,
ingredients[{id, amount, unit, optional} | {pendingName}],
equipment[{id} | {pendingName}],
garnish, glassware, servings,
canMake (bool), favorite (bool),
createdAt, updatedAt,
imageUrl? (optional), source? (optional), pendingCount? (optional)
```

### `symposium_shopping_list`
```
name, quantity, unit, category, checked,
addedFrom ('manual'|'auto-suggest'|'recipe'),
ingredientId, sourceRecipeId, notes, createdAt, updatedAt
```

### `symposium_categories`
```
name, type ('ingredient'|'equipment'|'recipe'),
subcategories[], sortOrder
```

### `apps`
App registry metadata. Read requires `hasApp(appId) || hasAdmin()`.

---

## Coding Patterns

### IIFE Namespace Pattern (all embedded apps)
```js
// state.js — always first
const MyApp = (() => {
  return { state: {}, constants: {} };
})();

// feature.js — depends on state
const MyApp = (() => {
  const { state } = MyApp;
  function doSomething() { ... }
  return { ...MyApp, doSomething };
})();

// app.js — always last
(async () => {
  await MyApp.init();
})();
```

### Auth Guard Pattern
```js
firebase.auth().onAuthStateChanged(user => {
  if (!user) { window.location.href = '/'; return; }
  // check claims, then init app
});
```

### Firestore Operations
Apps use `firebase.firestore()` directly (compat SDK). No ORM layer.

---

## Build & Tooling

| Command | Description |
|---------|-------------|
| `npm run lint` | ESLint check |
| `npm run lint:fix` | Auto-fix lint issues |
| `npm run format` | Prettier format |
| `npm run format:check` | Check formatting |
| `npm run emulator` | Start Firestore + Functions emulators |
| `npm run emulator:hosting` | Start hosting emulator (port 5000) |
| `npm run deploy` | Deploy to production |
| `npm run deploy:preview` | Deploy to preview channel |
| `npm run test` | Run Firestore rules tests |

**No frontend build step.** All JS is served as-is. ESLint uses flat config v9 with separate rule sets for `functions/`, `public/`, and `scripts/`.

---

## CI/CD (GitHub Actions)

| Workflow | Trigger | Action |
|----------|---------|--------|
| `firebase-hosting-merge.yml` | Push to `main` | Full deploy: hosting + Firestore rules/indexes + Cloud Functions + IAM |
| `firebase-hosting-pull-request.yml` | PR to `main` | Deploy preview channel, comment URL on PR |
| `code-quality.yml` | Push/PR | ESLint + Prettier checks |
| `firestore-rules.yml` | Push/PR | Jest rules unit tests |
| `set-admin.yml` | Manual | Grant/revoke admin claim |
| `seed-categories.yml` | Manual | Seed Symposium categories |

**Required secret:** `FIREBASE_SERVICE_ACCOUNT_OLYMPUS_DFA00`

---

## Local Development

```bash
# Prerequisites
node >= 18.0.0
firebase-tools (global)
java (for emulators)

# Setup
npm install
npm run emulator         # Firestore on :8080, Functions on :5001
npm run emulator:hosting # Hosting on :5000
```

Open http://localhost:5000. The `?useEmulator=true` query is auto-applied in the Firebase init script.

---

## Adding a New App

1. Copy `/public/apps/_template/` to `/public/apps/<app-id>/`
2. Add entry to `apps.yaml`
3. Add Firestore rules for the new collection (if needed)
4. Create the app access claim key (admin grants it via The Pantheon)
5. If using Cloud Functions: add to `/functions/index.js`

For a **JSX applet** instead:
1. Create `applet.jsx` file in `/public/apps/jsx-runner/applets/`
2. Add entry to `/public/apps/jsx-runner/applets.yaml` with `type: jsx`
3. No additional auth wiring needed — JSX Runner inherits Grand Hall auth
