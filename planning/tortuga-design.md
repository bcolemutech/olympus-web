# Tortuga — Game Design & Phased Implementation Plan

> Status: **Draft for review**. Not yet finalized. Open questions are flagged inline and collected in §11.

---

## 1. Vision

**Tortuga** is a sea-faring pirate empire builder for the Olympus platform, set in the era of Caribbean piracy and American colonization (roughly **1650–1730**). The player begins as a freshly-minted captain with one ship and a green crew, and grows — through exploration, plunder, recruitment, and conquest — into a pirate lord commanding a feared fleet and a chain of ports, forts, and hidden coves.

The product has two interlocking halves:

- **The Cartographer** — a world-builder that imports Azgaar Fantasy Map Generator output, strips it of the land-heavy fantasy detail, and overlays it with pirate-era maritime data (ports, forts, hazards, trade routes, factions). Worlds are **shared by default**.
- **The Account** — the gameplay layer. Each player runs their own **private** campaign on a shared world. ("On the account" was period slang for going pirate.)

A world must exist before a game can be started, but the two parts ship and version independently.

---

## 2. Olympus Integration

### Naming proposal

| Concept            | Proposed name        |
| ------------------ | -------------------- |
| Top-level app      | **Tortuga**          |
| World-builder mode | **The Cartographer** |
| Gameplay mode      | **The Account**      |
| App slug / claim   | `tortuga`            |

I recommend **one Olympus app** (`/apps/tortuga/`) with two modes rather than two separate apps, because:

- One access claim (`apps[]: ['tortuga']`) covers both modes
- Map renderer, auth guard, Firestore init, and shared header are reused
- The world-list browser is needed in both modes (Cartographer manages worlds; The Account picks a world to play on)
- Easier to keep cross-mode UX consistent (e.g. preview a world before starting a game)

Splitting into two apps later is cheap if it ever becomes worthwhile.

### Module layout (IIFE namespace pattern, matching Symposium)

```
/public/apps/tortuga/
├── index.html
├── state.js                  # Namespace init, constants, shared state
├── firestore.js              # Worlds/games CRUD
├── map-renderer.js           # Leaflet-based renderer (shared by both modes)
├── world-list.js             # Shared world browser
├── cartographer/
│   ├── importer.js           # Azgaar JSON parser
│   ├── overlay.js            # Pirate-flair generator
│   └── editor.js             # UI for tweaking generated worlds
├── play/
│   ├── ship-types.js         # Static ship catalog (config, not Firestore)
│   ├── world-loader.js       # Pulls shared world into a game session
│   ├── ships.js              # Fleet management
│   ├── crew.js               # Crew & officers
│   ├── settlements.js        # Player-claimed settlement state
│   ├── factions.js           # Phase 4
│   ├── combat.js             # Phase 3
│   ├── turn.js               # Turn cycle
│   └── events.js             # Random encounters
└── app.js                    # Init, mode routing (?mode=world|play)
```

Script load order in `index.html` follows the existing pattern: `state.js` → modules → `app.js` last.

### Olympus reuse

- **Shared header** via `window.OlympusHeader.render('Tortuga')`
- **Auth guard** identical to other embedded apps; require `apps` claim includes `'tortuga'`
- **Firestore rules** add `hasApp('tortuga')` helper checks (see §9)
- **GitHub Actions** deploy pipeline — no new workflows needed
- **No build step** — Leaflet, js-yaml, and any other deps loaded from CDN

---

## 3. The Cartographer (World Builder)

### Goals

- Take an Azgaar export and produce a **playable maritime world** in Firestore
- Land detail is largely discarded; the sea is the playing field
- Recommend (but do not require) ocean-dominant maps to the user
- Worlds are shared by default so players can pool effort on world creation

### Input formats

- **Azgaar JSON** (the full "Menu → Save → Save as JSON" export) — **the only supported import format.** Single file carrying `info`, `pack.{burgs, states, features, vertices, cells, rivers, routes}`, and `biomesData`. Has everything we need.
- **Azgaar `.map` and partitioned GeoJSON exports are not supported.** `.map` is the editor's native save format and parsing it isn't worth the complexity when "Save as JSON" is one click away. GeoJSON exports are partitioned by data type (cells / routes / rivers / markers / zones) and none carry burgs/states on their own. The importer rejects both with a message pointing the user at "Save as JSON".
- JSON is parsed client-side; no upload to Cloud Functions needed for ingest.

### Pipeline

1. **Upload** — User drops an Azgaar `.json` (full "Save as JSON" export) into the importer.
2. **Parse** — Extract: coastline polygons, water cells, biomes, burgs (potential ports), state borders, rivers (deep-water inland reach), climate (storm bands).
3. **Recommend** — Inspect water-to-land ratio. If land > ~60%, surface a soft warning: _"This map is land-heavy. Tortuga plays best on oceanic maps. Continue anyway?"_
4. **Overlay generation** — Apply pirate flair:
   - **Settlements** — Reclassify coastal burgs into one of: `colonial_port`, `free_port`, `fort`, `hidden_cove`, `native_village`, `ruins`. Weight by burg size and parent state.
   - **Hidden coves** — Generate N small uncharted settlements not in the source data, hidden until discovered.
   - **Hazards** — Reefs near coasts, storm bands by latitude/climate, kraken zones in deep water (placed sparsely).
   - **Trade routes** — Lines between large colonial_ports controlled by the same parent state; merchants spawn along these in Phase 3+.
   - **Factions** — Map source states to faction archetypes (Spanish Crown, British Crown, French Crown, Dutch Trading Co., Pirate Brethren, Indigenous Confederacies, Free Cities). User can rename and re-color.
   - **Wind & current zones** — Coarse-grained directional zones (trade winds, doldrums, gulf streams). Used for movement cost modifiers in Phase 2+.
5. **Editor** — User can rename settlements, drag-adjust positions, tweak faction colors, add/remove hazards before saving.
6. **Save** — Write to `worlds/{worldId}` with `shared: true` by default.

### Configuration knobs at generation time

- **Era preset** — `caribbean_golden_age` (default), `mediterranean_corsair`, `indian_ocean`, `freeform`. Influences settlement names, faction archetypes, hazard weighting.
- **Settlement density** — sparse / standard / dense
- **Hazard density** — sparse / standard / dense
- **Mythic creatures toggle** — kraken, ghost ships, etc. on/off (off = grittier historical feel)
- **Faction count** — 2–8

### Rendering

Use **Leaflet** with `L.CRS.Simple` (fictional coordinate space, no geographic projection). Loaded from CDN. Layers:

- Base — coastline + water
- Settlements (markers, clustered at low zoom)
- Hazards (overlay polygons)
- Trade routes (polylines, toggle)
- Faction territory (translucent polygons, toggle)
- Wind/current zones (arrow overlays, toggle)

The same renderer powers The Account, with an additional player/fleet layer on top.

---

## 4. The Account (Gameplay) — Core Concepts

### Player fantasy

You are a captain. You start with one ship, a crew of unknowns, and an open sea. By the late game you are a name that makes governors sweat — you command a fleet, your captains report to you, your ports brew rum and rebuild hulls, and rival factions weigh whether to ally with you or burn you down.

### Core entities

| Entity               | Description                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Captain** (player) | The player's avatar. Stats, reputation, gold, command rating.                                               |
| **Ship**             | An instanced vessel of a defined `class`. Has hull, sails, guns, crew slot, cargo, upgrades, damage state.  |
| **Crew**             | Counted pool of generic sailors + named **Officers**.                                                       |
| **Officer**          | Named NPC with stats. Can be promoted to **sub-captain** of a ship. Loyalty matters.                        |
| **Sub-Captain**      | An officer commanding a non-flagship vessel. Player commands flagship directly.                             |
| **Squad**            | 1–N ships grouped under a sub-captain (or the player) for movement and missions.                            |
| **Fleet**            | The player's full set of squads.                                                                            |
| **Settlement**       | Town, fort, cove. World-defined but state-tracked per-game. Can be visited, captured, garrisoned, improved. |
| **Territory**        | Sea zones or settlement clusters claimed by the player.                                                     |
| **Faction**          | Other organization (rival pirates, navies, etc.) with goals, state, AI. Phase 4.                            |
| **Natural enemies**  | Kraken, white whale, ghost ship — non-faction threats. Phase 4.                                             |

### Player progression arc

1. **Solo captain** — one ship, exploring, learning the world
2. **Small fleet** — 2–4 ships, hiring officers, light combat
3. **Pirate company** — squads, taking forts, holding ports
4. **Pirate lord** — territory, treaties, fleet-vs-fleet wars, mythic hunts

The phases of _implementation_ (§8) roughly map to these stages of _player progression_.

---

## 5. Ship Catalog

Stored as a static JS config object in `play/ship-types.js`, following the Void Odyssey precedent of static configs over Firestore for infrequently-changing data. Instanced ships in a game reference a `classId` and denormalize the relevant base stats at creation.

### Ship classes (target catalog)

Organized roughly by role. Each class has tiers within it (e.g. a Light Sloop vs Heavy Sloop) accessible via the upgrade system.

**Small & fast (raiders, scouts, smugglers)**
| Class | Masts | Guns | Crew | Notes |
|---|---|---|---|---|
| Sloop | 1 | 4–14 | 30–75 | Iconic pirate workhorse. Fast, shallow draft. |
| Schooner | 2 | 4–12 | 20–60 | Very fast, fore-and-aft rig, good against the wind. |
| Cutter | 1 | 4–10 | 20–40 | Small, nimble, often used as tender. |
| Pinnace | 1–2 | 4–8 | 15–40 | Small, versatile, often a ship's boat scaled up. |
| Brigantine | 2 | 10–16 | 80–120 | Two-masted, mixed rig — favored pirate vessel. |

**Medium (mainline combatants, escorts)**
| Class | Masts | Guns | Crew | Notes |
|---|---|---|---|---|
| Brig | 2 | 10–18 | 80–110 | Square-rigged two-master, common naval & merchant. |
| Snow | 2 | 14–20 | 80–120 | Similar to brig with trysail mast. |
| Xebec | 2–3 | 16–24 | 100–140 | Mediterranean import, fast, lateen rig, raider favorite. |
| Bark / Barque | 3 | 6–14 | 50–90 | Cargo-leaning three-master. |
| Pink | 2 | 4–10 | 30–60 | Narrow-sterned small merchant. |

**Large merchant (juicy prizes)**
| Class | Masts | Guns | Crew | Notes |
|---|---|---|---|---|
| Fluyt | 3 | 6–12 | 30–60 | Dutch cargo hauler, big hold, lightly armed. |
| Merchantman | 3 | 8–16 | 60–100 | Generic large trader. |
| East Indiaman | 3 | 26–36 | 200–300 | Heavily armed merchantman — dangerous prize, huge payday. |
| Galleon | 3–4 | 24–40 | 200–400 | Spanish treasure ship. Slow, sturdy, gold-laden. |
| Carrack | 3–4 | 20–30 | 150–250 | Older but still in service, big and tough. |

**Warships (the navy comes for you)**
| Class | Masts | Guns | Crew | Notes |
|---|---|---|---|---|
| Corvette | 3 | 18–22 | 110–150 | Small warship, single gundeck. |
| Frigate | 3 | 28–44 | 180–300 | Fast, well-armed naval workhorse. |
| Ship of the Line (4th rate) | 3 | 50–60 | 350–450 | Smallest line ship. Brutal. |
| Ship of the Line (3rd rate) | 3 | 64–80 | 500–700 | The terror of the seas. |
| Man-o'-War | 3 | 90+ | 800+ | Flagship of a national navy. Endgame threat. |

**Specialty**
| Class | Notes |
|---|---|
| Bomb Ketch | Mortar-armed, exists to bombard forts. Bad at ship-to-ship. |
| Fireship | One-shot incendiary, sacrificial. |
| Gunboat | Tiny, one heavy gun, harbor defense. |
| Felucca | Small lateen-rigged, shallow water. |

> **Design note:** Final stat tuning is a Phase 3 task. The catalog above sets the _range_ of ships and their _roles_; concrete numbers come with balance work.

### Per-ship stats (instance-level)

```
shipId, classId, name, customFlag,
hull        { current, max },
sails       { current, max },       # affects speed when damaged
guns        { count, weight },      # weight: 4 / 6 / 9 / 12 / 18 / 24 / 32 lb
crew        { current, min, max },
morale,
cargo       { used, capacity, manifest[] },
upgrades[]  { id, tier },
speed, maneuverability, draft,
damage      { hull, sails, guns, hold },
location,
squadId? (null if flagship or unassigned)
```

### Upgrades (Phase 3)

Per-class trees with shared categories:

- **Hull** — copper sheathing, reinforced timbers, increased capacity
- **Sails** — extra canvas, storm rig, lateen conversion
- **Guns** — heavier shot, carronades, swivel guns, chase guns
- **Hold** — extra cargo, hidden compartments, brig
- **Crew quarters** — morale boost, capacity boost
- **Officer suite** — bonus to commanding officer's stat application

Not every upgrade is available to every class (a sloop cannot mount 32-pounders).

---

## 6. Mechanics

### 6.1 Turn structure (full game, Phase 4)

1. **Player turn** — unlimited actions until "End Turn":
   - Move squads on the map (action points or simultaneous resolution — see §11)
   - Engage in combat (interactive)
   - Send squads on missions (auto-resolved at end of turn)
   - Visit settlements (manage)
   - Build, recruit, trade
   - Diplomacy
2. **End turn**
3. **NPC faction turns** — resolved in background, but **player is interrupted** for combat if attacked
4. **World tick** — events, weather, market shifts, mission resolutions
5. Return to player turn

Phase 2 (MVP) has no NPC turn — only player exploration ticks.

### 6.2 Movement

- Map is **point-to-point on sea graph** with hex-like granularity, _not_ free-form pixel movement
- Each squad has a movement budget per turn driven by slowest ship's speed × wind/current modifiers
- Settlements and known hazards visible; fog of war on unexplored sea
- Phase 2 MVP simplification: free movement with turn-time-based cooldowns or simple AP

### 6.3 Combat (Phase 3) — Risk-style with weighting

**Resolution model:** turn-based **Risk-style direct comparison** dice with stat weights, not a real-time tactical sim. This keeps it tractable to build and play in a browser.

Per engagement:

1. **Initiation** — Attacker squad vs defender squad, range starts at **long**.
2. **Round structure**, repeated until exit:
   - Each side picks a posture: _Hold range / Close / Disengage / Board_
   - Compute round dice pool per ship based on guns, hull, crew, officer stat, range band
   - **Dice count** comes from ship's relevant attribute pool for the range band (e.g. broadside guns at medium range)
   - **Dice type** scales with officer + crew quality: baseline d10, stepping up to d12 / d20 as Command, Cunning, or Navigation cross 1–100 thresholds
   - Roll dice on both sides; sort each side highest-to-lowest; **pair the highest die of each side against the other's highest**, second-highest against second-highest, etc.
   - For each pair: higher result wins (attacker wins ties at long/medium; defender wins ties at short/boarding to reward proximity defenders). Each pair-win deals one damage allocation
   - Apply hull / sails / crew / gun damage based on the active range band's damage profile
3. **Exit conditions** — sunk, captured, surrendered, fled. A side flees when below morale threshold.

**Worked example (one round at medium range, no criticals):**

- Player flagship rolls **4d10** (broadside, base + decent gunnery officer): `[8, 7, 5, 2]`
- Defender brigantine rolls **3d10**: `[9, 6, 4]`
- Pair top-down: `8 vs 9` → defender wins → 1 damage to player. `7 vs 6` → player wins → 1 damage to defender. `5 vs 4` → player wins → 1 damage to defender. `2` is unpaired and ignored.
- Outcome: player deals 2 damage, defender deals 1 damage. Damage type is determined by the medium-range damage profile (broadsides peak → hull/gun damage favored).

**Critical results** apply per die: a natural max on the die type (`10` on d10, `12` on d12, `20` on d20) triggers a narrative crit. Natural `1` triggers a crit-failure. Crits compound on top of normal damage:

**Range bands** affect which guns and tactics apply:

- **Long** — chase guns, sail damage favored
- **Medium** — broadsides peak
- **Short** — broadsides + grape shot, crew damage
- **Boarding** — crew-vs-crew, captures possible

- Natural max on highest die → magazine explosion / decisive broadside / flag struck (severity scales by range band)
- Natural 1 on highest die → fouled rigging / misfire / officer wounded (own side suffers)
- Multiple crits in a round narrate as a single combined beat

**Outcomes:**

- Sunk — gone, partial cargo recoverable
- Captured — added to fleet (needs prize crew)
- Damaged & fled — returns to nearest friendly port
- Surrendered — full cargo + ship taken
- Boarded successfully — same as captured but with morale + reputation effects

**Server-side rolls.** Per the Void Odyssey learning: dice rolls happen in a Cloud Function, not in client JS. Client requests resolution, Function rolls + computes + writes results, client renders. Prevents save-scumming and keeps combat tamper-resistant.

**Auto-resolution** — squads sent on missions resolve combat by a faster, statistical version of the same model. Mission report summarizes outcomes.

### 6.4 Economy

Resources tracked at fleet and settlement level:

- **Gold** — currency. Plunder, trade, taxation of held ports.
- **Supplies** — food, water, rum. Consumed per turn per crew member.
- **Powder & shot** — consumed in combat.
- **Repair materials** — timber, canvas, cordage. Spent to fix damage outside a shipyard.
- **Reputation** — per-faction. Negative with navies, positive (or feared) with brethren.

### 6.5 Crew & officers

- **Crew** — counted pool per ship. Recruited at ports, lost in combat and to disease.
- **Officers** — named NPCs with stats:
  - `Command` — buffs ship in combat
  - `Navigation` — speed + storm resistance
  - `Cunning` — boarding + stealth
  - `Charisma` — recruit retention, morale
  - `Loyalty` — risk of mutiny / desertion. Influenced by treatment, share of plunder.
- **Promotion** — any officer with high enough Command can be made sub-captain of a ship.
- **Recruitment** — taverns at ports. Officer pool is finite per port and refreshes slowly.

### 6.6 Settlements

A settlement record has world-level (shared) data and per-game (private) state.

| World-level                                         | Per-game                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `id, name, type, position, parentFaction, baseSize` | `controlledBy, garrison, improvements[], heat, lastVisited, prosperity` |

Settlement interactions:

- **Visit** — friendly port: repair, restock, recruit, sell, buy
- **Raid** — small hit-and-run; gold + heat, no capture
- **Capture** — full assault with squad; risk of significant losses; gain control
- **Garrison** — assign ships / crew to defend
- **Build improvements** — shipyard, fort, tavern, marketplace, smuggler's den, drydock, signal tower
- **Tax** — gold per turn from controlled ports, scaled by prosperity
- **Heat** — controlled settlements draw faction retaliation if heat too high

### 6.7 Factions & AI (Phase 4)

Each faction has:

- Goals (expand, defend, hunt player)
- Strength score
- Disposition toward player (-100 to +100)
- A simple rule-based AI that picks actions on its turn

**Natural enemies** (Kraken, ghost ship, white whale) are not factions — they are stateful **roaming threats** with simple behavior (e.g. Kraken patrols a zone and attacks any squad in it). Mythic toggle in the world controls whether they exist.

---

## 7. MVP Scope (Phase 2 exit criteria)

The MVP is **explore-only**. No combat, no empire, no factions. A player can:

- Browse worlds and pick one
- Create a new game (saved game record)
- Choose from a small set of starter ships (3–4 classes)
- Pick a starting friendly port
- See themselves on the map
- Move ship around the sea graph
- Discover settlements (fog of war reveals on approach)
- Visit ports for narrative flavor + crew/supply top-up
- Encounter non-combat random events (storm, drifting wreckage, sighting on the horizon)
- Save and resume

Explicitly **out of scope for MVP**: combat, captured ships, multiple ships, officers, settlements you can capture, factions, missions, economy beyond supplies & gold.

---

## 8. Phased Implementation Plan

Each phase decomposes into story-card-sized deliverables matching the project's existing cadence. Story cards drafted but not finalized — listed here at story-card resolution.

### Phase 0 — Foundation

| Story | Description                                                                                     |
| ----- | ----------------------------------------------------------------------------------------------- | ------ |
| T-001 | Create `/apps/tortuga/` from `_template`; register in `apps.yaml`; add `tortuga` app claim path |
| T-002 | Firestore rules: `worlds/*` and `games/*` collections with `hasApp('tortuga')` guards           |
| T-003 | Module skeleton: `state.js`, `firestore.js`, `app.js`, mode router (`?mode=world                | play`) |
| T-004 | Shared map renderer module using Leaflet (`L.CRS.Simple`), loaded from CDN                      |
| T-005 | World list browser component (shared between modes)                                             |

### Phase 1 — The Cartographer

| Story | Description                                                            |
| ----- | ---------------------------------------------------------------------- |
| T-101 | Azgaar JSON parser (full "Save as JSON" export)                        |
| T-103 | Land/water ratio check + soft "ocean-dominant recommended" nudge       |
| T-104 | Overlay generator: classify coastal burgs into settlement types        |
| T-105 | Overlay generator: hidden coves, hazards (reefs, storms, kraken zones) |
| T-106 | Overlay generator: faction mapping from source states                  |
| T-107 | Overlay generator: trade routes between large colonial ports           |
| T-108 | Cartographer UI: upload → preview → tweak → save                       |
| T-109 | World editor: rename settlements, drag positions, edit factions        |
| T-110 | Save world to Firestore (shared by default, with private toggle)       |
| T-111 | World list UI: browse, search, preview, mark favorites                 |

### Phase 2 — MVP Game ("The Account": exploration)

| Story | Description                                                                   |
| ----- | ----------------------------------------------------------------------------- |
| T-201 | Game session: create new game record linked to a world                        |
| T-202 | Ship catalog static config; starter ship picker (3–4 classes)                 |
| T-203 | Starting port picker (friendly ports on chosen world)                         |
| T-204 | Game map view: world layer + player ship marker + fog of war                  |
| T-205 | Movement: sea graph generation from world water cells; click-to-move on graph |
| T-206 | Settlement discovery: reveal on approach within range                         |
| T-207 | Port visit UI: rest, repair (basic), buy supplies, hire crew (count only)     |
| T-208 | Random event engine + non-combat event pack (storms, wreckage, sightings)     |
| T-209 | Save & resume: load game state, restore map + ship + log                      |
| T-210 | Captain's log: scrolling narrative of player actions and events               |
| T-211 | Game settings: difficulty toggle (affects supply consumption etc.)            |

### Phase 3 — Empire Building & Combat

| Story | Description                                                                 |
| ----- | --------------------------------------------------------------------------- |
| T-301 | Full ship catalog (all classes) and upgrade tree definitions                |
| T-302 | Multi-ship fleet management UI                                              |
| T-303 | Officer system: data model, named-officer generator, hire-at-tavern flow    |
| T-304 | Sub-captain promotion: assign officer to ship                               |
| T-305 | Squad formation: group ships, assign squad commander                        |
| T-306 | Cloud Function: combat resolver (server-side dice)                          |
| T-307 | Interactive combat UI: range bands, postures, round-by-round resolution     |
| T-308 | Combat outcomes: sunk / captured / fled / boarded; prize crew & cargo       |
| T-309 | Settlement state model (per-game) on top of world settlements               |
| T-310 | Raid action: small hit-and-run on a settlement                              |
| T-311 | Capture action: full assault with a squad                                   |
| T-312 | Garrisons: assign ships/crew to hold a settlement                           |
| T-313 | Settlement improvements: shipyard, fort, tavern, marketplace, etc.          |
| T-314 | Economy v2: gold per turn from holdings, supply consumption per crew        |
| T-315 | Reputation system (placeholder for Phase 4 factions)                        |
| T-316 | Auto-resolved mission system: send squad on a mission, report back          |
| T-317 | Randomized combat encounter spawning (no factions yet — just generic ships) |

### Phase 4 — Factions & AI

| Story | Description                                                          |
| ----- | -------------------------------------------------------------------- |
| T-401 | Faction data model and world-to-game faction state instancing        |
| T-402 | Faction AI v1: rule-based action picker                              |
| T-403 | Turn cycle: player turn → faction turns → world tick                 |
| T-404 | Defense scenarios: interrupt to defend when attacked on faction turn |
| T-405 | Diplomacy: treaties, alliances, tribute, declaration of war          |
| T-406 | Per-faction reputation & relationship UI                             |
| T-407 | Natural enemies: Kraken, ghost ship, white whale — roaming threats   |
| T-408 | Mythic hunts: optional quest chains for mythic creatures             |
| T-409 | Faction-controlled territory display on map                          |
| T-410 | End-game / victory conditions (see §11)                              |

---

## 9. Data Models (Firestore)

### `tortuga_worlds/{worldId}` — shared

```
name, description,
createdBy (uid),
createdAt, updatedAt,
shared (bool, default true),
sourceFormat ('azgaar-json'),
era ('caribbean_golden_age' | ...),
dimensions { width, height },
geography {
  coastlineGeoJSON (ref to subcollection or storage if large),
  waterCells: [...],
  windZones: [...],
  currents: [...]
},
settlements: [{ id, name, type, position, parentFaction, baseSize, hidden }],
hazards: [{ id, type, polygon, severity }],
factions: [{ id, name, archetype, color, homeSettlementId }],
tradeRoutes: [{ id, fromId, toId, faction }]
```

_Large geography blobs may need to live in a subcollection or Cloud Storage if they exceed the 1 MB document limit. To be determined at implementation time._

### `tortuga_games/{gameId}` — private to owner

```
owner (uid),
worldId (ref),                     // provenance only — game-time reads use worldSnapshot
worldSnapshot {                    // deep copy of the source world at game create (per §11 #9)
  geography { ... },
  settlements: [...],
  hazards: [...],
  factions: [...],
  tradeRoutes: [...]
},
createdAt, lastPlayedAt,
turnNumber,
phase ('exploration' | 'empire' | 'factions'),
captain {
  name, portrait, reputation,
  stats { command, navigation, cunning, charisma },
  gold
},
flagshipId (ref to subcollection),
fog: [...],   // discovered tile/cell IDs
settings { difficulty, mythicEnabled, pacing, ... }
```

_`worldSnapshot` is the canonical world data the game reads at runtime — see §11 #9. If the world's geography lives in a subcollection (size caveat below), the snapshot fans out the same way._
_`settings.pacing` is reserved (default `'async'`) for future multiplayer wall-clock pacing per §13; phase-4 single-player ships with async only._

### `tortuga_games/{gameId}/ships/{shipId}`

_(see §5 instance-level stats)_

### `tortuga_games/{gameId}/officers/{officerId}`

```
name, background,
stats { command, navigation, cunning, charisma, loyalty },
shipId? (null if unassigned),
isSubCaptain (bool),
shareOfPlunder
```

### `tortuga_games/{gameId}/squads/{squadId}`

```
name, commanderOfficerId,
shipIds[],
location, destination?,
orders ('move' | 'patrol' | 'mission'),
missionId?
```

### `tortuga_games/{gameId}/settlements/{settlementId}`

```
worldSettlementId (ref),
controlledBy ('player' | 'faction:<id>' | 'unclaimed'),
garrison { ships[], crew },
improvements: [{ id, tier }],
heat, prosperity, lastVisited
```

### `tortuga_games/{gameId}/factions/{factionId}` (Phase 4)

```
worldFactionId (ref),
disposition,    // -100 to +100
strength,
goals[],
lastAction
```

### `tortuga_games/{gameId}/log/{entryId}`

```
turn, type, summary, payload, createdAt
```

### Security rules (sketch)

```
match /tortuga_worlds/{worldId} {
  allow read: if hasApp('tortuga') && (resource.data.shared == true
                                       || resource.data.createdBy == request.auth.uid);
  allow create: if hasApp('tortuga') && request.resource.data.createdBy == request.auth.uid;
  allow update, delete: if hasApp('tortuga') && resource.data.createdBy == request.auth.uid;
}

match /tortuga_games/{gameId} {
  allow read, write: if hasApp('tortuga') && resource.data.owner == request.auth.uid;
  match /{subcoll}/{docId} {
    allow read, write: if hasApp('tortuga')
                        && get(/databases/$(database)/documents/tortuga_games/$(gameId)).data.owner == request.auth.uid;
  }
}
```

---

## 10. Architecture Notes

- **Map renderer**: Leaflet via CDN with `L.CRS.Simple`. Layers as described in §3.
- **No build step.** All client code remains plain JS modules under IIFE namespaces.
- **Combat resolver** (Phase 3) is the first piece that _must_ live in a Cloud Function — same reasoning as Void Odyssey's dice rolls.
- **AI narration** (optional, Phase 3/4) could reuse the Gemini 2.5 Flash plumbing from Void Odyssey for flavor text on events, combat blow-by-blows, port descriptions. Keep mechanics in code; AI only narrates.
- **Static config files** (`ship-types.js`, `event-packs.js`, `improvement-types.js`) ship with the app — denormalize into game/world docs at create time.
- **GitHub Actions** seed workflow for default world templates (a couple of curated maps so users can play before importing their own).

---

## 11. Open Design Questions

To be resolved during the relevant phase, not now. Resolved items show their decision inline.

1. **Movement model** — **Resolved: hex grid with AP-based movement.** Sea graph generated from world water cells with hex-like granularity. Each squad has a per-turn AP budget driven by slowest ship's speed × wind/current modifiers (modifiers ship in later phases). Combat positioning is decoupled — combat uses range bands (§6.3), not the hex grid. _(Phase 2 — closed via #235)_
2. **Stat scale** — **Resolved: 1–100, aligned with Void Odyssey.** Base value 50 with bonuses/penalties applied additively (e.g. veteran trait +10). Applies to captain stats, officer stats, ship combat-math inputs, and settlement prosperity. Scale lives as a constant in `state.js`. _(Phase 3 — closed via #236)_
3. **Combat dice math** — **Resolved: Risk-style direct comparison.** Each side rolls a pool; dice are sorted descending and paired across sides; higher in each pair wins. Pool _size_ comes from ship attributes for the range band; pool _die type_ steps up with officer/crew quality (d10 → d12 → d20). Ties favor the long/medium attacker and short/boarding defender. Critical results trigger on natural max (positive) and natural 1 (negative) on the highest die. See §6.3 for the worked example. _(Phase 3 — closed via #237)_
4. **Save-scumming policy** — **Resolved: hybrid (seeded combat).** Non-combat actions commit immediately to Firestore (no quit-to-undo). Combat engagements persist a seed before any roll; the resolver re-derives dice from `(seed, roundNumber, sideId)` so a reload mid-fight resumes exactly where the player left off with the same outcomes. Posture choices already submitted are persisted on the engagement doc. Result: no save-scum, but tab-close mid-engagement is safe. _(Phase 3 — closed via #238)_
5. **Turn time pressure** — **Resolved: pure async.** Player advances turns at their own pace; no cron jobs, no notifications, no missed-turn penalties. Wall-clock pacing is deferred to the §13 async-PvP multiplayer tier; `settings.pacing` is reserved on the game doc (defaults to `'async'`) so future work can flip games into wall-clock mode without a migration. _(Phase 4 — closed via #239)_
6. **Victory conditions** — **Resolved: sandbox only.** No auto-end conditions. Games run until the player chooses to stop. The end-game / victory-conditions story (T-410) is dropped from the milestone. A future "retire captain with stats recap" feature can be added as a §12 follow-up if it earns its keep. _(Phase 4 — closed via #240; T-410 closed)_
7. **Faction unlock pacing** — **Resolved: all factions instanced at game start.** Every world faction gets a per-game faction doc at game create. Initial disposition is per-archetype default (e.g. navies neutral-to-hostile, brethren friendly). The "fade-in" feel comes from faction _reactivity_, not visibility — factions don't actively pursue the player until the player draws their attention (low rep, raids, captures). Diplomacy UI shows the full roster from turn 1. _(Phase 4 — closed via #241)_
8. **Crew detail level** — **Resolved: counts + officer-only roster.** Generic sailors are a counted pool per ship with aggregate morale and loyalty; only officers (§6.5, T-303) are named NPCs with stats and personalities. Full named-crew rosters with per-sailor traits and mutiny mechanics remain in §12 as future work. _(Phase 3 — closed via #242)_
9. **World patches** — **Resolved: snapshot at game create.** At new-game time, the source world is deep-copied into the game's `worldSnapshot` field; all game-time reads of geography/settlements/hazards/factions/tradeRoutes go through the snapshot. The `worldId` reference is retained for provenance. Future edits to the source world do not affect active games. If the world's geography ever fans out into a subcollection (per §9 size caveat), the snapshot fans out the same way. _(Phase 2 — closed via #243)_

---

## 12. Future Features

Beyond Phase 4, in no particular priority order:

- **Retire captain with stats recap** — player-initiated end of a sandbox game with a captain's-log highlights reel and final stats summary
- **Named crew & rosters** — every sailor with a name, story, and loyalty; mutiny mechanics
- **Tavern recruiting cards** — meet officers as draftable cards with traits
- **Treasure maps & digs** — collect map fragments, deduce location, dig for buried gold
- **Disease & morale management** — scurvy, plague, drunkenness; rum rations as a balancing act
- **Detailed weather system** — storms that damage and scatter squads, hurricane season
- **Smuggling network** — clandestine trade between friendly/neutral ports
- **Letters of Marque path** — accept privateering papers from a navy; alternative playstyle
- **Custom flag designer** — design your own jolly roger; feared flag affects reputation
- **Ship customization** — paint, figureheads, name plates
- **Historical pirate NPCs** — Blackbeard, Anne Bonny, Black Bart, Henry Morgan as world figures, allies, or rivals
- **Procedural quest generator** — chained missions with branching outcomes
- **Boarding mini-game** — interactive boarding actions instead of pure dice
- **Achievements** — milestones for completionists
- **Leaderboards** — per-world rankings (most gold, biggest fleet, longest reign)
- **AI-narrated events** — Gemini-powered flavor text for events, port descriptions, combat
- **Mod support** — community-defined ship classes, factions, event packs
- **Accessibility pass** — colorblind palettes, keyboard navigation, screen-reader support
- **Mobile-friendly map** — touch gestures, responsive UI for tablet play

---

## 13. Multiplayer Concepts

Multiplayer is **explicitly post-Phase 4 future work**, but is worth shaping now so we don't paint ourselves into a corner with the data model.

### Tier 1: Shared World, Independent Games (lowest cost)

Multiple players run separate single-player games on the same shared world. No direct interaction. Adds:

- A **world leaderboard** showing each player's reputation/gold/fleet
- A **world chronicle** — public log of "Captain X sacked Port Royal on turn 42" entries posted from each player's game
- Players can publish ship blueprints (favorite builds) to a world's shipwright wall

Implementation cost is low because games stay private; only a public-summary stream is shared.

### Tier 2: Asynchronous PvP

Two players' games share a world _and_ can interact:

- Players can challenge each other's fleets to combat
- A challenged player has 24h to defend (interactive) or auto-resolve
- Captured ships and gold transfer
- Optional: open-world bounties (post a bounty on another player's captain)

Implementation cost: medium. Needs a shared **engagement queue** subcollection and notification plumbing. Combat resolver already lives server-side, which helps.

### Tier 3: Synchronous / Co-op Sessions

- Co-op: two players share command of one fleet
- Live PvP: scheduled fleet battles in real(ish) time

Implementation cost: high. Needs Firestore real-time sync of game state, conflict resolution, and likely Cloud Function arbitration of simultaneous actions. Probably never worth it unless the game gets traction.

### Tier 4: Player-as-Faction

A player's single-player progress can be **exported as an AI faction** that another player can import into their game. Your pirate empire becomes a rival the next captain has to contend with. Cool, low-bandwidth, async.

### Data model implications to keep in mind from day one

- Keep world state and game state cleanly separated (already the plan)
- Tag game-state writes with `turnNumber` so future async sync has a clock to reason about
- Don't bake assumptions of "one game per world per player" into rules; the per-player game limit should be soft, not enforced in rules

---

## 14. Out of Scope

For clarity, these are explicitly **not** part of the design:

- Land combat beyond settlement assault resolution (no army units, no overland movement)
- Detailed economic simulation (no commodity markets per port — abstracted into supplies/gold)
- Historical accuracy as a hard constraint (era-flavored, not era-faithful)
- Real-time tactical combat (turn-based by design)
- Mature/grimdark content beyond what the period naturally contains

---

_End of draft. Open questions in §11 should be the first things to resolve before kicking off Phase 0._
