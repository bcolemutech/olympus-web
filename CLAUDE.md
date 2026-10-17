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

## Planning and Roadmap

- **Start at [`planning/roadmap.md`](planning/roadmap.md).** It says what has shipped, what is in progress and what comes next, with the issue numbers. Asked "what's next?", read it first, then the issue it points to.
- **Each phase has a design doc** in `planning/` (listed in the roadmap) with dated **Decisions** and an **Epics and sub-issues** table. The doc and the issue are the spec: follow their decisions, and ask before departing from them.
- **New work is designed before it is built.** A phase or epic not yet broken out gets a draft design doc first, with a **gap sheet**: the open questions, each with options and a recommendation, put to the user to answer (by asking them, not left in a file). Sub-issues are filed only once it's answered.
- **Issues follow the existing format.** Epics are titled `L-x00 — [Epic] …` and stories `L-xxx · …`, with the `loom` label, the phase milestone, and the story attached to its epic as a sub-issue. The body has Overview, then design doc / Depends on / Suggested model lines, then Scope, Acceptance criteria, and a `Part of #… (L-…)` footer.
- **Content features add to grading.** An epic that adds content to the game (art, people, items, places, layers) adds its criteria and weights to the grading rubric (`functions/loom-canon/grading.js`, design in `planning/the-loom-grading.md`) in one of its stories, and isn't closed until they are in.
- **Mechanics are modules; systems are data.** Each world has one game system, written as data over MCP (design in `planning/game-systems.md`). A mechanic (combat, ship battle, powers) is built once as a module that declares its settings, and is tested with at least two systems' settings from its first story. A system never needs new code: a difference that would becomes a module option every system can use.
- **One story, one PR**, titled `feat(loom): … (L-xxx, #issue)` (or `feat(cartographer)`), with the tests its acceptance criteria name.
- **When an epic ships:** close it, tick its sub-issue checklist, and update its row in `roadmap.md` and the status line of its design doc, in the same PR or a small docs PR.

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
| The Image Studio | `public/apps/studio/` | The library of art for worlds: browse, search, look at, upload and download images. Opened by the `cartographer` claim (`claim:` in `apps.yaml`); its MCP tools are in the Cartographer connector |
| Scriptorium | *(MCP connector only)* | Notes managed from Claude at `/mcp/scriptorium` |

---

## Technology Stack

### Frontend
- **Vanilla JavaScript** — IIFE namespace pattern (no bundler, no build step)
- **React 18.3.1** — CDN via unpkg.com (used in JSX Runner applets only)
- **Preact 10.29.8 + htm 3.1.1** — CDN via unpkg.com, no build (the Loom's play view: components in `window.Loom`, one store; `public/apps/loom/js/ui.js`, `shell.js` (the side panel, a bottom sheet on phones), the panel's content in `journal.js` (with the roll cards' dice to tap), the rules reference in `rules.js`, the Character panel and the strip on the map in `character.js`, making a character for a new game in `creation.js`; the look's tokens in `loom.css`, each world's accent in `theme.js`)
- **PixiJS 8.21.0** — CDN via unpkg.com (the Loom's map engine, `public/apps/loom/js/engine.js`: WebGL, canvas without it; the world map in `world.js`, towns in `town.js`, battle maps in `battle.js`, shared drawing in `draw.js`)
- **Babel Standalone 7.26.10** — In-browser JSX transpilation (JSX Runner only)
- **Firebase SDK v12.9** — CDN, compat mode (`firebase/compat/app`, etc.)
- **js-yaml 4.1.0** — YAML manifest parsing (CDN)
- **CSS3** — Custom dark theme, no CSS framework

### Backend
- **Firebase Hosting** — Static, `public/` directory
- **Firestore** — `us-central1`, schema enforced by security rules
- **Cloud Functions v2** — Node.js 22, CommonJS; entry point `functions/index.js`
- **Cloud Storage** — `olympus-dfa00.firebasestorage.app`, rules in `storage.rules` (Cartographer map uploads and world images); its CORS policy in `storage-cors.json` (GET from any origin, so WebGL and canvas can use its images as textures), applied by the Set Storage CORS workflow
- **MCP server** — `@modelcontextprotocol/sdk`, Streamable HTTP with its own OAuth 2.1 authorization server, in `functions/mcp/`
- **Firebase Auth** — Email/password + Google Sign-in

### Dev Tooling
- **ESLint 9** — `eslint.config.js` with separate configs per zone
- **Prettier 3** — `.prettierrc`, semi:true, singleQuote:true, printWidth:100
- **Jest 29** — Rules, Cloud Functions, Loom, Cartographer and MCP tests against the Firestore and Storage emulators
- **GitHub Actions** — 9 workflows for CI, preview deploys, production deploys and admin tasks

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
│       ├── cartographer/          # The Cartographer: map upload, worlds, publish
│       └── studio/                # The Image Studio: the image library
├── functions/
│   ├── index.js                   # All Cloud Function exports (admin, Loom, Cartographer, MCP)
│   ├── gemini.js                  # Gemini/Vertex AI callGemini helper (extracted for testability)
│   ├── loom-canon/                # World canon: static worlds + Firestore worlds (loadWorld)
│   ├── loom-turn/                 # Turn pipeline: intake → interpret → adjudicate → narrate → commit
│   ├── loom-models.js             # Loom save and turn document shapes
│   ├── cartographer/              # Azgaar parse → map → load, import and publish service
│   └── mcp/                       # MCP host, OAuth server, registry, apps/ (scriptorium, cartographer)
├── tests/                         # Jest suites (rules, Loom, Cartographer, MCP) + fixtures/
├── scripts/                       # Admin scripts the workflows run (set-admin, seed-categories, studio-generate)
├── planning/                      # Design docs per phase; roadmap.md orders the work
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

Access is controlled via Firebase custom claims. Users have an `apps[]` array and an `admin` boolean in their token. An app in `apps.yaml` may name another app's `claim` that opens it (the Image Studio opens with `cartographer`); the Grand Hall shows it to users with that claim, and The Pantheon doesn't offer it as a grant of its own.

- `hasAdmin()` — checks `request.auth.token.admin == true`
- `hasApp('symposium')` — checks if `'symposium'` is in the user's apps claim

The Cloud Functions in `functions/index.js` manage these claims via `setAdminRole`, `removeAdminRole`, and `manageAccess`.

### Shared Components

- **`public/js/components/app-header.js`** — Navigation header with back button, user menu, logout. All apps include this via `<script>`.
- **`public/styles/app.css`** — Base stylesheet. All apps link this in addition to their own CSS.
- **Shared with the server** — a rule both the Cloud Functions and the Loom page run (`grid-paths.js`, the Loom's grid paths; `town-paths.js`, its paths in town) lives in `functions/loom-canon/` and `public/apps/loom/js/` with identical bytes, since `functions/` deploys on its own. A test fails if the copies differ: edit both.

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
| `loom_worlds/{worldId}` | `hasApp('cartographer')`; `hasApp('loom')` for published only | Cartographer worlds; entity subcollections (`locations`, `factions`, `regions`, `characters`, `lore`, `places`) readable by `cartographer` only |
| `loom_saves/{saveId}` (+ `loom_turns`) | Owner with `hasApp('loom')`, read only | Game saves and turn history; each save keeps its own clock, `time` in seconds from Day 1 (rules in `functions/loom-canon/clock.js`); its character's sheet, shaped by the world's game system, at `character.sheet` (attributes, skills, resources, level, traits, conditions, speed; `functions/loom-canon/sheets.js`); its conditions are effects put on and ticked by `functions/loom-canon/effects.js` (L-815) |
| `loom_world_state/{worldId}` | `hasApp('loom')`, read only | Shared world state |
| `loom_creation_rolls/{rollId}` | Deny (server only) | Scores rolled for a new character (L-812): the player, the world and the values, used once by `loomCreateSave` |
| `loom_systems/{systemId}` | Deny (server only) | Game systems as data (L-801; `functions/loom-canon/systems.js`): the sheet, checks and ladder, creation, modules, words; written over MCP (`set_system`, `copy_system`), named by `world.systemId` (the built-in `d20-fantasy` when none; `pool-scifi` is the other built-in, both in `built-in-systems.js`) |
| `loom_softcanon/{entityId}` | `hasApp('loom')`, read only | Play-invented entities |
| `studio_images/{imageId}` | `hasApp('cartographer')`, read only | The image studio's library: one record per image, with its kind, labels, versions and link; a version bigger than a screen also has a copy at most 2048 px long, served by its screen link (files in Storage at `studio/{imageId}/`) |
| `studio_jobs/{jobId}` | `hasApp('cartographer')`, read only | The image studio's jobs, making an image or editing one: the request, its state (queued, running, done, failed), the image (and version) made, its cost or error |
| `studio_styles/{styleId}` | `hasApp('cartographer')`, read only | The image studio's named styles: a name, prompt text and up to 3 reference images, named in a generation or edit; a world's default is `world.studio.styleId` |
| `studio_costs/{entryId}`, `studio_costs_month/{yyyy-mm}` | Deny (server only) | The image studio's costs: one entry per charged job, and each month's totals by day, model and who (read through `studioCosts`) |
| `scriptorium_notes/{id}` | Deny (server only) | Scriptorium notes, via MCP |
| `mcp_*` (`oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_grants`, `audit`, `rate_limits`) | Deny (server only) | MCP OAuth state, audit log, rate limits |

Client writes to Loom and Cartographer data are denied; the Cloud Functions write through the Admin SDK. Default: all other paths deny read/write.

---

## Cloud Functions

Functions v2, all exported from `functions/index.js`. Everything is a Callable except `studioRunJob`, a Cloud Tasks queue function, and `mcpServer`, an HTTP function behind the Hosting rewrites for `/mcp/**`, `/authorize`, `/token`, `/register`, `/revoke` and the `.well-known` discovery docs.

| Function | Who Can Call | Purpose |
|---|---|---|
| `setAdminRole` | Admin only | Grant admin custom claim |
| `removeAdminRole` | Admin only | Revoke admin custom claim |
| `listUsers` | Admin only | List all Auth users |
| `inviteUser` | Admin only | Create new user account |
| `manageAccess` | Admin only | Add/remove app from user's claims |
| `setUserDisabled` | Admin only | Enable/disable a user |
| `loomCreateSave` / `loomDeleteSave` | `loom` claim (own saves) | Start or delete a game; a new game's character is made from the player's choices by the world's system's method (`creation`, checked by `functions/loom-canon/creation.js`), or is the world's premade one (`rules.startingSheet`) |
| `loomCreationRules` | `loom` claim | How a new character is made in a world, for the new-game form: the method and its settings, each score's modifier, the skills and traits to choose; or that it's premade |
| `loomRollCharacter` | `loom` claim | Rolls a new character's scores with the server's dice, for a system that makes characters by rolling; kept in `loom_creation_rolls` for `loomCreateSave` to use once |
| `loomPlayTurn` | `loom` claim (own saves) | Run one turn of the Loom pipeline (typed text, a move made on the map, continuing a plan, or ending the turn); steps on a battle map, and walks in a town with ground (with "Walk there"), are worked out without the model; a rolled action returns its `roll` for the panel's roll card (its dice, its line with each term named, the degree in the system's words), and NARRATE is told the degree and the world's game system; walking into a hazard on a battle map stops there and triggers it (its save, the condition; `functions/loom-canon/hazards.js`), and End turn ticks the character's conditions; every answer carries the save's `time` |
| `loomWorldRatings` | `loom` claim | Each published world's band (Playable, Rich, Vivid or Legendary) for the Loom's world list; the band's name only |
| `loomGetMap` | `loom` claim (own saves) | The world map a save may see: its discovered places, links, and which are open; in a town, its places for the town view; each route out of here with how long the trip takes (`travel`); the save's time (`time`, for the map's clock: "Day 1, evening"); the save's turn; the world's game system for the rules reference (`rules`); and the character's sheet as the player reads it, for the Character panel and the strip (`character`) |
| `cartographerImport` | `cartographer` claim | Uploaded Azgaar map → draft world |
| `cartographerPublish` | `cartographer` claim | Publish a draft world to the Loom |
| `cartographerCompletion` | `cartographer` claim | How built each world is, for the Cartographer page: open places, its score and band, counts by band per kind, and its biggest gaps |
| `cartographerTownImage` | `cartographer` claim | Attach, replace or remove a town's art (an uploaded PNG or SVG drawn behind the town view), through the image studio's library |
| `cartographerMapImage` | `cartographer` claim | Attach, replace or remove a battle map's art (an uploaded PNG or SVG drawn under its grid), through the image studio's library |
| `studioUpload` | `cartographer` claim | Add an uploaded image (PNG, JPEG, WebP or SVG) to the image studio's library, with its title, kind and labels |
| `studioCosts` | `cartographer` claim | The image studio's spending for a month, for its page: the total against the $50 warning figure, by day, model and who, and the latest charges |
| `studioGenerate` | `cartographer` claim | Start making an image from the studio page's form (prompt, kind, tier, shape, references, title, labels); returns the job at once |
| `studioRunJob` | Cloud Tasks queue only | Runs one studio job, at most 8 at once: a new image, or an edit that becomes an image's next version, made with a Gemini image model on Vertex, its cost recorded |
| `mcpListConnections` / `mcpRevokeConnection` | Signed-in user (own connections) | Grand Hall "Manage connections" |
| `mcpServer` | OAuth bearer token per connector | MCP connectors (Scriptorium, Cartographer) and the OAuth server |

Functions preserve existing custom claims when modifying them (merge pattern, not overwrite).

---

## GitHub Actions Workflows

| Workflow | Trigger | Action |
|---|---|---|
| `code-quality.yml` | Push/PR to main | ESLint + Prettier check |
| `firebase-hosting-pull-request.yml` | Pull Request | Deploy preview channel (lives 1 hour; first deletes channels older than that and the oldest past 10), comment URL on PR |
| `firebase-hosting-pr-cleanup.yml` | Pull Request closed | Delete the PR's preview channel, so the channel quota doesn't run out |
| `firebase-hosting-merge.yml` | Push to main | Deploy hosting + Firestore rules/indexes + Storage rules + Cloud Functions |
| `firestore-rules.yml` | Push/PR to main | Run the Jest suite against the Firestore and Storage emulators |
| `set-admin.yml` | Manual dispatch | Grant or revoke admin claim |
| `seed-categories.yml` | Manual dispatch | Populate Symposium categories |
| `set-storage-cors.yml` | Manual dispatch | Apply `storage-cors.json` to the Storage bucket, so the Loom's map engine can draw art from it (dry run, then apply) |
| `studio-generate.yml` | Manual dispatch | Make images with the real model by hand: one image, or the big-map trial; spends money, so it asks for confirm "spend" |

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
