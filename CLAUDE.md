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
| The Loom | `public/apps/loom/` | AI-narrated game system; plays worlds with Gemini |
| The Cartographer | `public/apps/cartographer/` | Turns Azgaar maps into Loom worlds; MCP connector at `/mcp/cartographer` |
| Scriptorium | *(MCP connector only)* | Notes managed from Claude at `/mcp/scriptorium` |

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
- **Cloud Functions v2** — Node.js 22, CommonJS; entry point `functions/index.js`
- **Cloud Storage** — `olympus-dfa00.firebasestorage.app`, rules in `storage.rules` (Cartographer map uploads and world images)
- **MCP server** — `@modelcontextprotocol/sdk`, Streamable HTTP with its own OAuth 2.1 authorization server, in `functions/mcp/`
- **Firebase Auth** — Email/password + Google Sign-in

### Dev Tooling
- **ESLint 9** — `eslint.config.js` with separate configs per zone
- **Prettier 3** — `.prettierrc`, semi:true, singleQuote:true, printWidth:100
- **Jest 29** — Rules, Cloud Functions, Loom, Cartographer and MCP tests against the Firestore and Storage emulators
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
│       ├── loom/                  # The Loom game client
│       └── cartographer/          # The Cartographer: map upload, worlds, publish
├── functions/
│   ├── index.js                   # All Cloud Function exports (admin, Loom, Cartographer, MCP)
│   ├── gemini.js                  # Gemini/Vertex AI callGemini helper (extracted for testability)
│   ├── loom-canon/                # World canon: static worlds + Firestore worlds (loadWorld)
│   ├── loom-turn/                 # Turn pipeline: intake → interpret → adjudicate → narrate → commit
│   ├── loom-models.js             # Loom save and turn document shapes
│   ├── cartographer/              # Azgaar parse → map → load, import and publish service
│   └── mcp/                       # MCP host, OAuth server, registry, apps/ (scriptorium, cartographer)
├── tests/                         # Jest suites (rules, Loom, Cartographer, MCP) + fixtures/
├── scripts/                       # One-time admin utility scripts
├── planning/                      # Architecture and design documentation
├── .github/workflows/             # CI/CD pipelines
├── firebase.json                  # Firebase configuration
├── firestore.rules                # Firestore security rules
├── firestore.indexes.json         # Firestore index definitions
├── storage.rules                  # Cloud Storage security rules
├── .firebaserc                    # Firebase project alias + Storage deploy target
├── eslint.config.js               # ESLint configuration
└── .prettierrc                    # Prettier configuration
```

---

## Code Architecture & Conventions

### IIFE Namespace Pattern

All vanilla JS files use an Immediately Invoked Function Expression that attaches to a global namespace. Each app owns its namespace (e.g., `window.Symposium`, `window.Loom`).

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
| `apps/{appId}` | `hasApp(appId)` or admin | App registry |
| `pool_handicap/{userId}` | Self read/write only | Billiards handicap data |
| `loom_worlds/{worldId}` | `hasApp('cartographer')`; `hasApp('loom')` for published only | Cartographer worlds; entity subcollections (`locations`, `factions`, `regions`, `characters`, `lore`) readable by `cartographer` only |
| `loom_saves/{saveId}` (+ `loom_turns`) | Owner with `hasApp('loom')`, read only | Game saves and turn history |
| `loom_world_state/{worldId}` | `hasApp('loom')`, read only | Shared world state |
| `loom_softcanon/{entityId}` | `hasApp('loom')`, read only | Play-invented entities |
| `scriptorium_notes/{id}` | Deny (server only) | Scriptorium notes, via MCP |
| `mcp_*` (`oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_grants`, `audit`, `rate_limits`) | Deny (server only) | MCP OAuth state, audit log, rate limits |

Client writes to Loom and Cartographer data are denied; the Cloud Functions write through the Admin SDK. Default: all other paths deny read/write.

---

## Cloud Functions

Functions v2, all exported from `functions/index.js`. Everything is a Callable except `mcpServer`, an HTTP function behind the Hosting rewrites for `/mcp/**`, `/authorize`, `/token`, `/register`, `/revoke` and the `.well-known` discovery docs.

| Function | Who Can Call | Purpose |
|---|---|---|
| `setAdminRole` | Admin only | Grant admin custom claim |
| `removeAdminRole` | Admin only | Revoke admin custom claim |
| `listUsers` | Admin only | List all Auth users |
| `inviteUser` | Admin only | Create new user account |
| `manageAccess` | Admin only | Add/remove app from user's claims |
| `setUserDisabled` | Admin only | Enable/disable a user |
| `loomCreateSave` / `loomDeleteSave` | `loom` claim (own saves) | Start or delete a game |
| `loomPlayTurn` | `loom` claim (own saves) | Run one turn of the Loom pipeline |
| `cartographerImport` | `cartographer` claim | Uploaded Azgaar map → draft world |
| `cartographerPublish` | `cartographer` claim | Publish a draft world to the Loom |
| `mcpListConnections` / `mcpRevokeConnection` | Signed-in user (own connections) | Grand Hall "Manage connections" |
| `mcpServer` | OAuth bearer token per connector | MCP connectors (Scriptorium, Cartographer) and the OAuth server |

Functions preserve existing custom claims when modifying them (merge pattern, not overwrite).

---

## GitHub Actions Workflows

| Workflow | Trigger | Action |
|---|---|---|
| `code-quality.yml` | Push/PR to main | ESLint + Prettier check |
| `firebase-hosting-pull-request.yml` | Pull Request | Deploy preview channel, comment URL on PR |
| `firebase-hosting-merge.yml` | Push to main | Deploy hosting + Firestore rules/indexes + Storage rules + Cloud Functions |
| `firestore-rules.yml` | Push/PR to main | Run the Jest suite against the Firestore and Storage emulators |
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
fix(loom): correct soft-canon promotion threshold
docs(admin): update user management instructions
chore(ci): update Firebase deploy action version
```

---

## JSX Runner — In-Browser React

JSX Runner loads applets defined in `public/apps/jsx-runner/applets.yaml`. Each applet is a `.jsx` file that exports a default React component. Babel Standalone transpiles JSX at runtime — there is no compile step. React and ReactDOM are loaded from CDN.

To add a new applet:
1. Create `public/apps/jsx-runner/applets/your-applet.jsx`
2. Add it to `public/apps/jsx-runner/applets.yaml`
