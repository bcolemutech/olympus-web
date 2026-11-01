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
- **Ideas are staged as issues.** An idea issue (any open issue labelled `idea`, whatever its title; the Idea template starts it "Idea: ") is an inbox entry, not a plan. Asked to go through the ideas, read the open ones and, with the user, fold each into the roadmap ("Not yet placed", an existing epic's design, or a new design with its gap sheet); then close it with a comment saying where it went. Bugs use the Bug template (label `bug`). Epics and stories are still filed from their design docs; the Epic and Story templates only record their format.
- **New work is designed before it is built.** A phase or epic not yet broken out gets a draft design doc first, with a **gap sheet**: the open questions, each with options and a recommendation, put to the user to answer (by asking them, not left in a file). Sub-issues are filed only once it's answered.
- **Issues follow the existing format.** Epics are titled `L-x00 — [Epic] …` and stories `L-xxx · …`, with the `loom` label, the phase milestone, and the story attached to its epic as a sub-issue. The body has Overview, then design doc / Depends on / Suggested model lines, then Scope, Acceptance criteria, and a `Part of #… (L-…)` footer.
- **Content features add to grading.** An epic that adds content to the game (art, people, items, places, layers) adds its criteria and weights to the grading rubric (`functions/loom-canon/grading.js`, design in `planning/the-loom-grading.md`) in one of its stories, and isn't closed until they are in.
- **Mechanics are modules; systems are data.** Each world has one game system, written as data over MCP (design in `planning/game-systems.md`). A mechanic (combat, ship battle, powers) is built once as a module that declares its settings, and is tested with at least two systems' settings from its first story. A system never needs new code: a difference that would becomes a module option every system can use. There is no single house system: each module lists its assumptions as settings, can be left off, and is tested with two systems that differ in kind (the d20 and the dice-pool built-ins).
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
- **Preact 10.29.8 + htm 3.1.1** — CDN via unpkg.com, no build (the Loom's play view: components in `window.Loom`, one store; `public/apps/loom/js/ui.js`, `shell.js` (the side panel, a bottom sheet on phones), the panel's content in `journal.js` (with the roll cards' dice to tap), the rules reference in `rules.js`, the Character panel and the strip on the map in `character.js` (with experience toward the next level and a mark when one is ready, L-845), making a character for a new game in `creation.js`, the level-up form in the journal in `levelup.js` (L-845); the look's tokens in `loom.css`, each world's accent in `theme.js`)
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
- **GitHub Actions** — 10 workflows for CI, preview deploys, production deploys and admin tasks

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
│   ├── loom-modules/              # Game-system modules (Phase 9): combat/ (settings, fights, attacks, strikes, play)
│   ├── cartographer/              # Azgaar parse → map → load, import and publish service
│   └── mcp/                       # MCP host, OAuth server, registry, apps/ (scriptorium, cartographer)
├── tests/                         # Jest suites (rules, Loom, Cartographer, MCP) + fixtures/
├── scripts/                       # Admin scripts the workflows run (set-admin, seed-categories, studio-generate, migrate-map-levels)
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
| `loom_worlds/{worldId}` | `hasApp('cartographer')`; `hasApp('loom')` for published only | Cartographer worlds, imported from Azgaar or made from scratch over MCP (`create_world`, `add_locations`, `connect_locations` with `links`; `source.kind: 'scratch'`, a plain `map.backdrop` colour; L-391); entity subcollections (`locations`, `factions`, `regions`, `characters`, `lore`, `places`, `battleMaps`, and `statBlocks`, named stat blocks characters and figures name with overrides, their sheets worked out when the world loads; L-393, `functions/loom-canon/stat-blocks.js`; and `maps`, maps inside maps to any depth, each a `region`, `area` or `grid` with its `parent` place on the map above and its `space`, from the world's `topMapId`, with places in the new shape in `places` (a `mapId`, where on it, `opens`, `links`, `exits`), loaded with the world's `tree`, places with no settlement (the migrated world map's places, grids' ways in and out) apart from today's town places as `mapPlaces`; L-901, `functions/loom-canon/levels.js`; written for today's worlds by the Migrate Map Levels workflow, L-902, `functions/cartographer/migrate-levels.js` (its plan in `functions/loom-canon/level-plan.js`), beside today's data; play reads it through frames (L-903, `functions/loom-canon/frames.js`): the world seen from the lowest region map on the save's path, its places as locations, the area maps under them as towns, grids as battle maps, and a world with no top map planned in memory) readable by `cartographer` only |
| `loom_saves/{saveId}` (+ `loom_turns`) | Owner with `hasApp('loom')`, read only | Game saves and turn history; each save keeps its own clock, `time` in seconds from Day 1 (rules in `functions/loom-canon/clock.js`); its character's sheet, shaped by the world's game system, at `character.sheet` (attributes, skills, resources, level, traits, conditions, its pool of action points `ap`, its experience `xp` and the levels ready from it `levelsReady` (worked out), successes counted toward rising `uses`, and each attack's rank `attackRanks`, read as `rank` in its formulas (L-841); `functions/loom-canon/sheets.js`); the foes and moments paid for, at `earned` (L-841); where it stands in the levels model, at `at` (a path of `{ mapId, placeId | point | cell }` steps from the top map down, checked against canon by `levels.validateAt`; L-901; where it stands since L-903, the frame's `location`, `placeId`, `townPoint`, `mapId` and `cell` kept beside it; `discovered`, `visited` and `waysKnown` stay flat lists by place); a level offered at the last long rest and not yet taken, at `levelOffer` (L-843); its turn at `turn` (`{ n, ap, kept, plan, reserved?, moved?, long? }`: the AP left, the AP set aside for a readied attack (L-833), a long action under way; `functions/loom-models.js`, L-832; one from before AP reads with its movement left as its AP); its conditions are effects put on and ticked by `functions/loom-canon/effects.js` (L-815); the fight it is in, if any, at `fight` (round, turn order, whose turn; `functions/loom-modules/combat/`, L-821); sides turned in it (a wary figure turned hostile, a hostile calmed), at `sides` (L-392; `functions/loom-modules/combat/wary.js`); the others it has fought, at `figures` (each one's sheet as this save has it, whether they are down, dead or knocked out (L-822), where they have moved and whether they fled (L-824)); the player down, at `down` (dying, stable or out), the story's end at `ended` (died), and the last long rest at `rested` (L-827); a question asked of a complicated action, awaiting the player's answer, at `asked` (L-826); an action awaiting the player's Do it, at `pending` (#673); the settlements it has arrived in, at `visited`, and by settlement the ways in and out it knows there (arrived by, stood in or crossed by; `'all'` where it knew the town before), at `waysKnown` (L-381; `functions/loom-turn/visits.js`; derived on the next turn of a save from before) |
| `loom_world_state/{worldId}` | `hasApp('loom')`, read only | Shared world state |
| `loom_creation_rolls/{rollId}` | Deny (server only) | Scores rolled for a new character (L-812): the player, the world and the values, used once by `loomCreateSave` |
| `loom_systems/{systemId}` | Deny (server only) | Game systems as data (L-801; `functions/loom-canon/systems.js`): the sheet (its AP pool, `sheet.ap`), checks and ladder, creation, action points (`ap`: costs, tiers, keep limit, with attacks', map features', doors', traits' and conditions' own; `functions/loom-canon/ap.js`, L-831; or `ap: false` to switch AP off, L-838; conditions change the pool (`modifiers.ap`), set it (`ap: 0`, Stunned) or prices (`costs`, a multiple or `'never'`: Prone doubles moving, Restrained can't move), and `standUp` ends one by standing up, L-834, the flags `noAction` and `noMove` from before AP converted with warnings; systems written with speed or combat economy converted, with warnings), advancement (`{ experience?, use? }`, how characters grow: a curve, a foe's worth, story sizes, quests and grants per level; improving by use's threshold by rank; checked by `functions/loom-modules/advancement/`, L-841; a world turns it off with `rules.advancement: false`), modules (combat's settings checked by `functions/loom-modules/combat/settings.js`), words; written over MCP (`set_system`, `copy_system`), named by `world.systemId` (the built-in `d20-fantasy` when none; `pool-scifi` is the other built-in, both in `built-in-systems.js`) |
| `loom_softcanon/{entityId}` | `hasApp('loom')`, read only | Play-invented entities |
| `studio_images/{imageId}` | `hasApp('cartographer')`, read only | The image studio's library: one record per image, with its kind, labels, versions and link; a version bigger than a screen also has a copy at most 2048 px long, served by its screen link (files in Storage at `studio/{imageId}/`) |
| `studio_jobs/{jobId}` | `hasApp('cartographer')`, read only | The image studio's jobs, making an image or editing one: the request, its state (queued, running, done, failed), the image (and version) made, its cost or error; one the model turned away as busy (429) is queued again with backoff, `tries` and `retryAt`, up to 5 tries (L-396) |
| `studio_styles/{styleId}` | `hasApp('cartographer')`, read only | The image studio's named styles: a name, prompt text and up to 3 reference images, named in a generation or edit; a world's default is `world.studio.styleId` |
| `studio_costs/{entryId}`, `studio_costs_month/{yyyy-mm}` | Deny (server only) | The image studio's costs: one entry per charged job, and each month's totals by day, model and who (read through `studioCosts`) |
| `scriptorium_notes/{id}` | Deny (server only) | Scriptorium notes, via MCP (`list_notes` pages titles and dates without bodies by a cursor; `get_note` reads one; L-397) |
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
| `loomPlayTurn` | `loom` claim (own saves) | Run one turn of the Loom pipeline (typed text, a move made on the map, continuing a plan, or ending the turn); steps on a battle map, and walks in a town with ground (with "Walk there"), are worked out without the model; every grid turn runs on action points (L-832): steps priced by the cost table as the character pays it (difficult ground double, a door its cost), every action its cost (a few words 2, an object or a lock 5, Dodge 8, an attack 10 or its own, anything else typed by the tier INTERPRET names, minor 3, standard 10 or major 20, the system's `ap.tiers`, L-835), one the AP left won't pay for refused with its cost, a long action (`long: { ap }` on a feature or door) put in over several turns until done, walked off or hurt; off a grid, actions cost nothing; with the world's system's AP off (`ap: false`, L-838) steps on a grid are free, each turn takes one action anywhere (`turn.acted`), and a fight runs on the combat module's `turn` rule (actions a turn, reactions a round); a move to a world place from anywhere in a town walks to the way out serving the route first (on the streets turn after turn, through its places in one go) and sets out (#669), leaving only by a way out the save knows (L-381: in a town with ground, those it arrived by, stood in or sighted), and arrives by the way in facing where it came from (a way in may serve its routes only to and from certain places, `entrance.to`, and is then the one used for them; L-395): on the way in's battle map the first time, on the town map at the way in once visited (L-382); a move to a settlement visited before that isn't a neighbour is a journey there (L-384; `functions/loom-canon/journeys.js`): the quickest path through settlements visited, set out on by the first leg's way out, its time the legs' plus each crossed town's walk from way in to way out, the ways used in each town crossed found there, and with no such path "No way you know leads there."; "What's here?" (`{ verb: 'look', cell | door }`, or a typed look at something on the map) has NARRATE describe that spot from the facts the save knows of it, an empty one plainly with no model, spending and recording nothing (#672; `functions/loom-turn/looking.js`); out of a fight, talking with or handling someone or something needs the player beside it: a typed action out of reach, and any of the GM's suggestions (`{ text, verb, target }`, chosen as `{ verb: 'suggested', text, act }`), answers with a `confirm` card (the walk, the action, any roll, its cost) kept as the save's `pending`, and `{ verb: 'confirm' }` walks over and then acts; looking and talking roll nothing unless resisted (#673; `functions/loom-turn/reach.js`); a rolled action returns its `roll` for the panel's roll card (its dice, its line with each term named, the degree in the system's words), and NARRATE is told the degree and the world's game system; walking into a hazard on a battle map stops there and triggers it (its save, the condition; `functions/loom-canon/hazards.js`), and End turn ticks the character's conditions; coming into sight of a hostile on a battle map, or attacking someone there, starts a fight (a wary figure, L-392, challenges instead: it turns hostile when attacked, when the check its `challenge` names fails against it, or by a trigger, a door opened or forced, a feature touched, an ally attacked or an area entered, which can also calm a hostile; NARRATE is told its challenge; the combat module's `wary` setting, on by default) (initiative and surprise by the server's dice), in which each End turn is a round and the model narrates only its start and end (L-821); an attack (typed, or `{ verb: 'attack', target, attack?, subdue? }` with no model to read it) is rolled by the combat module, its damage by degree and type taken from the foe in the save, and in a fight is the rules' lines and roll card (L-822); in a fight, End turn plays everyone else's turns by their tactics (role and posture), each planned within their AP (L-836: a brute strikes again while it lasts, a skirmisher strikes and steps away, a guard strikes once and keeps the rest to react, an archer readies a shot with what's left, a caster's area only when it can pay), morale breaks foes into flight or surrender, figures placed on the battle map (`place_figures`) fight like characters, (L-824); the player at 0 falls by the system's down kind (dying with saves, wounds, out at once), can then only end their turn (a dying save each), and when the fight ends comes round, dies (the save ends with an epilogue and takes no more turns) or, with the world's death off, comes round where NARRATE's chosen fate puts them; short and long rests (`{ verb: 'rest', rest }` or typed) restore by the system's rests, a long one once a day, and somewhere dangerous can be broken, hostiles there starting a fight (L-827); attacks count long range, cover, flanking where the system has it, Dodge and the target's defending reaction (a trait's); in a fight, what a fighter doesn't spend on their turn is kept (`kept` on their entry in the fight; capped by the system's `ap.keepLimit`) and pays their reactions until their next turn, as many as it covers (L-833): stepping out of a foe's reach draws its attack, at the attack's cost, unless the player withdrew; a defending reaction costs `defend`; a readied attack goes off at the first foe to come into it, paid from the AP Ready set aside (`turn.reserved`, lost if it never fires); and Dodge, Withdraw, Stand (`{ verb: 'stand' }`, ending Prone, L-834), Ready (`{ verb, attack?, target? }`) and Use (`{ verb: 'use', feature }`, narrated) each cost their AP (L-823; Dash retired with AP, L-832); an End turn or a fight starting answers with everyone else's `turns` to play out on the map, each walk and attack card (L-828), and an End turn in a fight with `held` (the AP kept for reactions and what was left of it, for the turn bar; L-837); a named (canon) character's turn in a fight is chosen by one Flash call from the whole turns the rules list (on AP only those that fit, each with its cost), with their `combatNotes` (`set_tactics`), falling back to their role's tactics, and a round they act in is narrated once (L-825; `functions/loom-turn/named-turns.js`); experience is paid by the system's advancement as the turn is committed (L-842; `functions/loom-modules/advancement/earn.js`): each foe overcome by any means (down, fled, surrendered, talked down) its worth for its level against the player's, and a story moment NARRATE names (`moment: { id, size }`, one a turn, its id normalised) its size's amount, each once per save (`save.earned`), nothing with the world's advancement off, every award in the answer's `awards` for the journal; NARRATE is told the player's level against each foe's; a long rest with a level ready (not in a fight) answers with a `levelUp` offer (L-843; `functions/loom-modules/advancement/level-up.js`): the next level's grants (attribute points, skill ranks, traits or attacks from a list) and their limits, with the GM's suggestion from one Flash call (`functions/loom-turn/level-up.js`), checked like the player's own and replaced by the rules' when it fails; `{ verb: 'levelUp', choices: { attributes?, skills?, traits?, attacks? } }` takes it (checked like creation's, `level` raised, resources raised by what their maxima rose), a second ready level offered straight after; the offer is kept as the save's `levelOffer` until any other turn; with the system's `use`, a skill check that succeeds with stakes (INTERPRET's `params.stakes`, or in a fight) counts toward its skill, and an attack that hits in a fight toward that attack (`sheet.uses`), and at a long rest each at its threshold rises one rank up to its top, its count reset, every rise in the answer's `rises` (L-844; `functions/loom-modules/advancement/use.js`); a typed action is judged for plausibility by INTERPRET: an improbable one is rolled at the ladder's top rung, an extraordinary one refused, and a complicated one answered with a question (`asked`), the player's next typed text read as how; refusals and questions spend no AP or time (L-826); at any depth (L-903; `functions/loom-turn/depth.js`): arriving at a place that opens a region map goes in by its way in (a place on it with `entrance`) facing where the traveller came from, a place's `exits` lead to a place on any map in their own time, and a move to a place outside the frame climbs out of each region map by a way out, crosses the lowest map holding both and descends, each stage in its own map's time (`timeRules(world, map)`: route kinds and speeds from the region map, then `world.rules.time`, then the defaults), only to places discovered; every answer carries the save's `time` |
| `loomWorldRatings` | `loom` claim | Each published world's band (Playable, Rich, Vivid or Legendary) for the Loom's world list; the band's name only |
| `loomGetMap` | `loom` claim (own saves) | The world map a save may see: its discovered places, links, and which are open; in a town, its places for the town view; each route out of here with how long the trip takes (`travel`), one a neighbour, with no way in to choose (L-383: arrival is by the way in facing here); on each settlement visited before that isn't a neighbour, its journey from here (`journey`: its time, the towns passed and the kinds of route; `false` with no known way; L-384), for the world map's Journey to; the save's time (`time`, for the map's clock: "Day 1, evening"); the save's turn (its AP left of the pool, any long action, the plan, and what a step costs the character, `prices`, for the path preview; L-832; with each action's and feature's cost, `prices.actions` and `prices.features`, for the click menu, L-837); the world's game system for the rules reference (`rules`, with its AP pool, costs and tiers at `rules.ap`, L-837, and how characters grow at `rules.advancement`, L-845); a level offered at the last long rest and not yet taken (`levelUp`, with the rules' suggestion, for the level-up form after a reload; L-845); the character's sheet as the player reads it, for the Character panel and the strip (`character`, with `experience`: the total earned, this level's and the next's, and the levels ready; left out with advancement off, L-845); the fight it is in, if any (`fight`); and on a battle map the player's attacks, each with its AP cost, and whether Subdue applies (`combat`), with each person in sight's cover from the player (L-828), and its areas as far as they've been seen, with the one the player stands in (#670; `functions/loom-canon/map-areas.js`); the region map it stands on (`mapId`, its places as `places`) and the trail (`trail`: each map from the top down to the one it is on, `{ mapId, name, kind }`; L-903) |
| `cartographerImport` | `cartographer` claim | Uploaded Azgaar map → draft world |
| `cartographerPublish` | `cartographer` claim | Publish a draft world to the Loom |
| `cartographerCompletion` | `cartographer` claim | How built each world is, for the Cartographer page: open places, its score and band, counts by band per kind, and its biggest gaps |
| `cartographerTownImage` | `cartographer` claim | Attach, replace or remove a town's art (an uploaded PNG or SVG drawn behind the town view), through the image studio's library |
| `cartographerMapImage` | `cartographer` claim | Attach, replace or remove a battle map's art (an uploaded PNG or SVG drawn under its grid), through the image studio's library; `fit` (crop, pad or stretch) fits it to the grid's shape as a new version, the original kept (L-396; `functions/studio/fit.js`), as `studio_assign` and `cartographerTownImage` do |
| `studioUpload` | `cartographer` claim | Add an uploaded image (PNG, JPEG, WebP or SVG) to the image studio's library, with its title, kind and labels |
| `studioCosts` | `cartographer` claim | The image studio's spending for a month, for its page: the total against the $50 warning figure, by day, model and who, and the latest charges |
| `studioGenerate` | `cartographer` claim | Start making an image from the studio page's form (prompt, kind, tier, shape, references, title, labels); returns the job at once |
| `studioRunJob` | Cloud Tasks queue only | Runs one studio job, at most 8 at once: a new image, or an edit that becomes an image's next version, made with a Gemini image model on Vertex, its cost recorded; a busy model's 429 queues it again after a wait (L-396) |
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
| `migrate-map-levels.yml` | Manual dispatch | Write every world's world map, towns, town places and battle maps into maps and places (L-902; `scripts/migrate-map-levels.js`): a dry run reports what it would write, then apply with confirm "migrate"; running it again writes nothing |
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
