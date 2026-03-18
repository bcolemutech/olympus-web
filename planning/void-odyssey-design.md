# Void Odyssey — Game Design Document

## An AI-Driven Space Adventure for the Olympus Platform

**App ID:** `void-odyssey`
**App Name:** Void Odyssey
**Type:** Embedded (vanilla JS, IIFE pattern)
**Path:** `/apps/void-odyssey/`
**Tagline:** "The stars remember everything."

---

## 1. Concept

Void Odyssey is a persistent, AI-narrated space exploration game where the player commands a ship through a procedurally-expanding universe. Claude serves as the storytelling engine — narrator, world-builder, and game master — generating rich narrative responses to player choices while reading from and writing to a Firestore-backed world state.

Unlike a traditional choose-your-own-adventure with pre-written branches, the story is emergent. Claude receives structured context about the current game state (ship, crew, location, history, relationships) and generates narrative that is both creative and consistent with established canon. As the game unfolds, new people, places, and things are persisted to Firestore, building a living universe that Claude can reference in future turns.

The player interacts through a command-style UI: reading narrative passages, selecting from contextual actions, and occasionally issuing freeform commands. Every turn updates the world state, and the database becomes both the save file and the storytelling memory.

---

## 2. Core Gameplay Loop

```
┌─────────────────────────────────────────────────────┐
│                  GAME TURN CYCLE                     │
│                                                      │
│  1. CONTEXT ASSEMBLY                                 │
│     Load current state from Firestore:               │
│     - Ship status, location, crew                    │
│     - Recent narrative history (last N turns)        │
│     - Relevant entities at current location          │
│     - Active quests/events                           │
│     - Player traits and reputation                   │
│                                                      │
│  2. PLAYER INPUT                                     │
│     Present contextual actions + freeform option     │
│     Player selects or types a command                │
│                                                      │
│  3. AI NARRATIVE GENERATION                          │
│     Send assembled context + player action to Claude │
│     Claude returns:                                  │
│     - Narrative text (the story beat)                │
│     - State mutations (JSON structured output)       │
│     - Next available actions                         │
│     - Any new entities to persist                    │
│                                                      │
│  4. STATE PERSISTENCE                                │
│     Write mutations to Firestore:                    │
│     - Update ship/crew/location                      │
│     - Create new entities (people, places, items)    │
│     - Append to narrative log                        │
│     - Update quest progress                          │
│                                                      │
│  5. RENDER                                           │
│     Display narrative, update HUD, show new actions  │
│     Loop back to step 1                              │
└─────────────────────────────────────────────────────┘
```

---

## 3. The AI Storytelling Engine

### 3.1 How Claude Drives the Story

Claude is called via the Anthropic API (proxied through a Cloud Function to protect the API key). Each turn sends a structured prompt containing:

- A **system prompt** defining Claude's role as narrator, the tone/genre rules, and output format requirements
- The **world context** assembled from Firestore (ship, crew, location, nearby entities, recent history)
- The **player's action** for this turn
- A **response schema** Claude must follow (narrative text + structured state mutations as JSON)

Claude responds with both prose (the story) and machine-readable data (what changed). The client parses both: displaying the narrative to the player and writing the mutations to Firestore.

### 3.2 System Prompt Design

The narrator system prompt establishes:

- **Genre:** Hard-ish sci-fi with room for the mysterious. Think Firefly meets Mass Effect — grounded crews, alien encounters, political tensions, with moments of wonder.
- **Tone:** Adapts to context. Tense during combat, wry during crew banter, reverent during discovery. Second person ("You step onto the bridge...").
- **Constraints:** Claude must respect established canon (no contradicting persisted facts), honor ship capabilities (can't warp if the drive is damaged), and keep crew behavior consistent with their defined personalities.
- **Output format:** Claude returns a JSON object with `narrative` (string), `stateMutations` (array of operations), `availableActions` (array), and optionally `newEntities` (array of new people/places/things to persist).

### 3.3 Context Window Management

The full game state will eventually exceed what fits in a single prompt. The context assembly layer uses a priority system:

| Priority | Content | Always Included |
|----------|---------|-----------------|
| Critical | Ship status, current location, active crew | Yes |
| High | Last 5 narrative entries, active quests | Yes |
| Medium | Entities at current location, recent relationship changes | Yes |
| Low | Distant location details, completed quests, full crew backstories | Only when relevant |
| Archive | Old narrative entries, visited-but-departed locations | Summarized or omitted |

A **context budget** (measured in estimated tokens) determines how much detail to include. When a location is first visited, its full description loads. On subsequent visits, a condensed summary is used. Crew backstories load in full during crew-focused scenes but compress to a sentence otherwise.

### 3.4 Structured Output Contract

Claude's response must conform to this schema:

```json
{
  "narrative": "The airlock hisses open and you step into...",
  "stateMutations": [
    { "type": "updateShip", "field": "fuel", "value": 72 },
    { "type": "updateCrewMember", "id": "crew_kira", "field": "morale", "value": "anxious" },
    { "type": "moveShip", "destinationId": "loc_station_vega" },
    { "type": "addToInventory", "item": { "name": "Cracked Data Core", "type": "quest_item", "description": "..." } }
  ],
  "newEntities": [
    {
      "type": "person",
      "name": "Magistrate Dren",
      "description": "A towering amphibian bureaucrat with three sets of spectacles...",
      "location": "loc_station_vega",
      "faction": "Vega Trade Authority",
      "disposition": "suspicious",
      "tags": ["authority", "trade", "first_contact"]
    }
  ],
  "availableActions": [
    { "id": "negotiate", "label": "Negotiate docking fees", "type": "dialogue" },
    { "id": "explore_market", "label": "Explore the station market", "type": "navigation" },
    { "id": "return_ship", "label": "Return to your ship", "type": "navigation" },
    { "id": "freeform", "label": "Do something else...", "type": "freeform" }
  ],
  "mood": "tense_curiosity"
}
```

---

## 4. Data Architecture

All game data lives in Firestore under a user-scoped path pattern: `void_odyssey_games/{gameId}/...`. A player can have multiple saved games (campaigns).

### 4.1 Top-Level Collections

```
void_odyssey_games/{gameId}                    — Game metadata & ship state
void_odyssey_games/{gameId}/narrative_log      — Turn-by-turn story entries
void_odyssey_games/{gameId}/crew               — Crew member documents
void_odyssey_games/{gameId}/locations           — Discovered places
void_odyssey_games/{gameId}/entities            — People, factions, creatures
void_odyssey_games/{gameId}/items               — Inventory & cargo items
void_odyssey_games/{gameId}/quests              — Active and completed quests
void_odyssey_games/{gameId}/star_map            — Navigation graph (systems, routes)
```

### 4.2 Game Document (Root)

`void_odyssey_games/{gameId}`

This is the save file header and contains the ship — the central object of the game.

```
{
  // --- Meta ---
  id: string,                    // Auto-generated
  userId: string,                // Firebase Auth UID (owner)
  name: string,                  // Campaign name ("The Perdition Run")
  createdAt: timestamp,
  updatedAt: timestamp,
  turnCount: number,             // Total turns played
  status: 'active' | 'ended',

  // --- Ship ---
  ship: {
    name: string,                // Player-chosen ("The Daedalus")
    class: string,               // Ship class ("light_freighter", "corvette", etc.)
    description: string,         // Flavor text, may evolve

    // Physical stats
    hull: number,                // 0-100, current integrity
    hullMax: number,             // Maximum hull points
    shields: number,             // 0-100, current shield level
    shieldsMax: number,
    fuel: number,                // 0-100, percentage remaining
    cargo: number,               // Current cargo units used
    cargoMax: number,            // Maximum cargo capacity

    // Capabilities
    weapons: [
      {
        id: string,
        name: string,            // "Twin Plasma Cannons"
        type: string,            // "energy", "kinetic", "missile"
        damage: string,          // Relative: "light", "moderate", "heavy"
        status: string,          // "operational", "damaged", "destroyed"
        notes: string            // Flavor or context
      }
    ],
    systems: [
      {
        id: string,
        name: string,            // "FTL Drive", "Life Support", "Sensors"
        status: string,          // "operational", "damaged", "offline", "destroyed"
        notes: string
      }
    ],
    features: [
      {
        id: string,
        name: string,            // "Smuggler's Hold", "Med Bay", "Cloaking Device"
        description: string,
        functional: boolean
      }
    ],

    // Location
    currentLocationId: string,   // Reference to locations subcollection
    dockedAt: string | null,     // Station/port ID if docked
  },

  // --- Player ---
  player: {
    name: string,                // Character name
    title: string,               // "Captain", "Commander", etc.
    backstory: string,           // Brief origin (can be AI-generated at game start)
    reputation: {
      // Faction-keyed reputation scores
      // e.g., "vega_trade_authority": 15, "frontier_rebels": -30
    },
    traits: string[],            // ["resourceful", "cautious", "silver_tongued"]
  },

  // --- Summary Context (denormalized for quick reads) ---
  crewCount: number,
  activeCrew: [                  // Denormalized name+role for HUD display
    { id: string, name: string, role: string }
  ],
  activeQuestCount: number,
  currentLocationName: string,   // Denormalized for display without location lookup
  currentLocationTags: string[], // For context assembly filtering
}
```

### 4.3 Narrative Log

`void_odyssey_games/{gameId}/narrative_log/{entryId}`

The turn-by-turn story record. This is what gives Claude memory of what has happened.

```
{
  id: string,
  turnNumber: number,
  timestamp: timestamp,

  // What the player did
  playerAction: {
    type: string,                // "dialogue", "navigation", "combat", "freeform", "system"
    actionId: string | null,     // ID of the chosen action (if from a list)
    input: string,               // The action text or freeform input
  },

  // What Claude generated
  narrative: string,             // The story text shown to the player
  mood: string,                  // "tense", "calm", "wonder", "danger", etc.

  // What changed
  stateMutations: [              // Record of all mutations applied this turn
    { type: string, details: object }
  ],
  newEntityIds: string[],        // IDs of entities created this turn
  locationId: string,            // Where this turn took place

  // Context summary (for log browsing without loading full state)
  summary: string,               // One-line summary ("Negotiated with Magistrate Dren at Vega Station")

  // Searchability
  tags: string[],                // ["combat", "vega", "first_contact", "magistrate_dren"]
}
```

### 4.4 Crew

`void_odyssey_games/{gameId}/crew/{crewId}`

Each crew member is a full character document.

```
{
  id: string,
  name: string,                  // "Kira Vasquez"
  role: string,                  // "pilot", "engineer", "medic", "gunner", "science", "general"
  species: string,               // "human", or alien species name
  status: string,                // "active", "injured", "missing", "dead", "departed"

  // Personality & history
  backstory: string,             // 2-4 sentences, enough for Claude to voice them
  personality: string[],         // ["sardonic", "loyal", "reckless"]
  skills: string[],              // ["navigation", "zero-g combat", "xenolinguistics"]
  quirks: string[],              // ["hums when nervous", "collects alien seeds"]

  // Dynamic state
  morale: string,                // "content", "anxious", "angry", "inspired", "broken"
  loyalty: number,               // -100 to 100, relationship with player
  healthStatus: string,          // "healthy", "minor_injury", "serious_injury", "critical"
  currentAssignment: string | null,  // "bridge", "engine_room", "away_team", "resting"

  // Relationships with other crew
  relationships: {
    // crewId: { disposition: string, notes: string }
    // e.g., "crew_jarek": { disposition: "rivalry", notes: "Competed for pilot seat" }
  },

  // History with the player
  significantMoments: [          // Key events Claude can reference
    { turnNumber: number, summary: string }
  ],

  // Search & context
  tags: string[],                // ["pilot", "human", "founding_crew"]
  joinedTurn: number,
  portraitDescription: string,   // Physical description for AI to reference
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 4.5 Locations

`void_odyssey_games/{gameId}/locations/{locationId}`

Every discovered place in the universe.

```
{
  id: string,
  name: string,                  // "Vega Station"
  type: string,                  // "star_system", "station", "planet", "moon",
                                 // "asteroid_field", "derelict", "anomaly", "nebula"

  // Description layers
  description: string,           // Current description (may evolve with story)
  firstImpressions: string,      // What the player first saw (immutable after creation)
  atmosphere: string,            // Mood/tone keywords ("industrial_decay", "lush_alien", "void_silence")

  // Physical properties
  environment: {
    gravity: string | null,      // "standard", "low", "high", "zero"
    atmosphere: string | null,   // "breathable", "toxic", "vacuum", "thin"
    temperature: string | null,  // "temperate", "scorching", "frozen"
    hazards: string[],           // ["radiation_belt", "pirate_territory", "unstable_orbit"]
  },

  // What is here
  dockable: boolean,             // Can the ship dock here?
  services: string[],            // ["refuel", "repair", "trade", "medical", "black_market"]
  residentEntityIds: string[],   // People/factions present (denormalized IDs)
  pointsOfInterest: [            // Sub-locations the player can visit
    {
      id: string,
      name: string,              // "The Rust Market"
      description: string,
      type: string,              // "market", "cantina", "government", "ruin", "lab"
      accessible: boolean,
      tags: string[],
    }
  ],

  // Navigation
  parentLocationId: string | null,  // e.g., planet's parent system
  connectedLocationIds: string[],   // Reachable from here (star map edges)
  distanceFromCurrent: number | null,  // Fuel cost, calculated at query time
  coordinates: {                // For star map visualization
    x: number,
    y: number,
    z: number | null,           // Optional depth for 3D feel
  },

  // History
  visitCount: number,
  firstVisitedTurn: number,
  lastVisitedTurn: number,
  significantEvents: [           // What happened here
    { turnNumber: number, summary: string }
  ],

  // Searchability
  tags: string[],               // ["station", "trade_hub", "frontier", "vega_authority"]
  faction: string | null,       // Controlling faction
  dangerLevel: string,          // "safe", "cautious", "dangerous", "hostile"

  discovered: boolean,          // True = player has been here; false = known but unvisited
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 4.6 Entities (People, Factions, Creatures)

`void_odyssey_games/{gameId}/entities/{entityId}`

NPCs, organizations, and alien creatures encountered in the world.

```
{
  id: string,
  type: string,                  // "person", "faction", "creature", "ai"
  name: string,
  description: string,           // Physical/visual description
  shortDescription: string,      // One-liner for lists and context summaries

  // For persons
  species: string | null,
  role: string | null,           // "merchant", "warlord", "informant", "scientist"
  factionId: string | null,      // Which faction they belong to
  disposition: string,           // "friendly", "neutral", "suspicious", "hostile"
  personality: string[],
  dialogue_style: string | null, // Brief note for Claude: "speaks in riddles", "blunt military cadence"
  motivations: string[],         // What they want: ["profit", "revenge", "knowledge"]
  secrets: string[],             // Things the player doesn't know yet (Claude can reveal over time)

  // For factions
  territory: string[],           // Location IDs they control
  ideology: string | null,       // Brief faction philosophy
  strength: string | null,       // "local", "regional", "galactic"
  allies: string[],              // Other faction IDs
  enemies: string[],

  // For creatures
  threat: string | null,         // "harmless", "moderate", "lethal"
  habitat: string | null,
  abilities: string[],

  // Relationship to player
  metOnTurn: number | null,
  interactionCount: number,
  playerReputation: number,      // -100 to 100, this entity's view of the player
  significantMoments: [
    { turnNumber: number, summary: string }
  ],

  // Location
  currentLocationId: string | null,
  locationHistory: string[],     // Where they've been seen

  // State
  status: string,                // "alive", "dead", "missing", "unknown"
  alive: boolean,

  // Searchability
  tags: string[],
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 4.7 Items

`void_odyssey_games/{gameId}/items/{itemId}`

Everything in the ship's cargo hold, crew equipment, or quest inventory.

```
{
  id: string,
  name: string,
  type: string,                  // "trade_goods", "weapon", "equipment", "quest_item",
                                 // "consumable", "data", "artifact"
  description: string,
  shortDescription: string,

  // Physical
  cargoUnits: number,            // How much cargo space it uses (0 for data/small items)
  quantity: number,              // Stack count for trade goods / consumables
  condition: string,             // "pristine", "good", "worn", "damaged", "broken"

  // Value
  baseValue: number | null,      // Credits, if tradeable
  rarity: string,                // "common", "uncommon", "rare", "unique"

  // Game state
  location: string,              // "cargo", "equipped:{crewId}", "quest_log", "stashed:{locationId}"
  acquiredTurn: number,
  acquiredFrom: string,          // Location or entity name
  questRelated: boolean,
  questId: string | null,

  // Searchability
  tags: string[],
  notes: string | null,          // Claude can add context ("The merchant warned you not to open this")
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 4.8 Quests

`void_odyssey_games/{gameId}/quests/{questId}`

Emergent storylines that Claude creates and tracks.

```
{
  id: string,
  name: string,                  // "The Dren Arrangement"
  description: string,           // Current understanding of the quest
  type: string,                  // "main", "side", "crew_personal", "faction", "discovery"
  status: string,                // "active", "completed", "failed", "abandoned"

  // Structure
  givenBy: string | null,        // Entity ID or "self-initiated"
  givenOnTurn: number,
  locationId: string | null,     // Where it was received

  // Progress
  objectives: [
    {
      id: string,
      description: string,       // "Deliver the data core to Magistrate Dren"
      status: string,            // "active", "completed", "failed"
      completedOnTurn: number | null,
    }
  ],
  currentObjectiveId: string | null,

  // Outcomes
  rewards: string | null,        // Description of what was gained
  consequences: string | null,   // Description of story impact
  completedOnTurn: number | null,

  // Connections
  relatedEntityIds: string[],
  relatedLocationIds: string[],
  relatedItemIds: string[],
  relatedQuestIds: string[],     // Linked quests (sequel, prerequisite)

  // Narrative hooks
  hooks: string[],               // Hints Claude can use: "Dren mentioned a sister on Kepler-7"
  secrets: string[],             // Info Claude can reveal: "The data core contains coordinates to..."

  // Searchability
  tags: string[],
  createdAt: timestamp,
  updatedAt: timestamp,
}
```

### 4.9 Star Map

`void_odyssey_games/{gameId}/star_map/{systemId}`

The navigation graph — defines what exists in space and how locations connect. This is separate from `locations` because the star map includes undiscovered systems (foggy nodes the player can see but hasn't visited).

```
{
  id: string,
  name: string,                  // "Vega System", "The Drift", "Unknown Signal"
  type: string,                  // "system", "route", "anomaly", "hidden"

  coordinates: { x: number, y: number },  // 2D map position
  connections: [                 // Edges to other systems
    {
      targetId: string,
      distance: number,          // Fuel cost
      hazards: string[],         // ["asteroid_field", "pirate_corridor"]
      known: boolean,            // Player has traveled this route
    }
  ],

  // Discovery state
  discovered: boolean,           // Visible on map
  visited: boolean,              // Actually been there
  scanLevel: string,             // "none", "basic", "detailed" (affects info shown on map)

  // Denormalized for map rendering
  locationCount: number,         // How many sub-locations
  dangerLevel: string,
  faction: string | null,
  hasServices: boolean,

  // Points of interest (teasers for unvisited systems)
  rumors: string[],              // "Traders say there's a hidden market in the third ring"
  signalStrength: string | null, // For anomaly types

  createdAt: timestamp,
  updatedAt: timestamp,
}
```

---

## 5. Context Assembly Engine

The most critical piece of the architecture. This module reads Firestore and builds the prompt context that Claude receives each turn.

### 5.1 Assembly Strategy

```
assembleContext(gameId, playerAction) → contextObject

1. Load game document (ship, player — always included)
2. Load current location document
3. Load active crew (status = 'active')
4. Load last N narrative entries (default 5, configurable)
5. Load entities at current location (residentEntityIds)
6. Load active quests
7. Load relevant items (equipped + quest-related)
8. Check token budget, trim low-priority content
9. Return structured context object
```

### 5.2 Relevance Scoring

When context exceeds the budget, entities and history are scored:

- **Recency:** Recently interacted entities score higher
- **Proximity:** Entities at the current location score highest
- **Quest relevance:** Connected to active quests = high priority
- **Player relationship:** Strong positive or negative reputation = high priority
- **Tag matching:** Entities whose tags overlap with the current situation

### 5.3 Context Object Shape

What gets sent to Claude alongside the system prompt:

```json
{
  "ship": { /* current ship state, abbreviated */ },
  "player": { /* name, reputation summary, traits */ },
  "location": { /* current location with points of interest */ },
  "crew": [ /* active crew with personality & morale */ ],
  "recentHistory": [ /* last 5 narrative summaries */ ],
  "nearbyEntities": [ /* people/factions/creatures here */ ],
  "activeQuests": [ /* quest names, current objectives */ ],
  "relevantItems": [ /* quest items, recently acquired */ ],
  "starMapContext": { /* adjacent systems, fuel range */ },
  "worldFacts": [ /* any persistent world rules or revealed secrets */ ]
}
```

---

## 6. Cloud Function: Story Proxy

A Cloud Function handles the Claude API call. The client never touches the API key.

### 6.1 Function: `voidOdysseyTurn`

```
Input:
  - gameId: string
  - playerAction: { type, actionId, input }
  - contextOverrides: {} (optional, for debug/testing)

Process:
  1. Verify caller auth + hasApp('void-odyssey') claim
  2. Load game state from Firestore
  3. Run context assembly
  4. Build Claude prompt (system + context + action)
  5. Call Anthropic API (claude-sonnet-4-20250514)
  6. Parse structured response
  7. Validate state mutations (sanity checks)
  8. Write mutations to Firestore (batched)
  9. Return narrative + available actions to client

Output:
  - narrative: string
  - availableActions: []
  - mood: string
  - shipStatus: {} (abbreviated for HUD update)
  - newEntities: [] (names only, for notification)
```

### 6.2 Function: `voidOdysseyNewGame`

Initializes a new campaign. Claude generates the opening scenario based on player choices during game creation (ship class, character backstory, starting region).

### 6.3 Function: `voidOdysseyQuery`

A read-only function for browsing game state — the player's codex/journal. Accepts a query type:

- `crew_roster` — Full crew details
- `ship_manifest` — Ship systems + cargo
- `quest_log` — Active and completed quests
- `star_map` — Discovered systems and routes
- `entity_dossier` — Details on a specific entity
- `narrative_search` — Full-text search through narrative log by tags/keywords

---

## 7. The UI

### 7.1 Layout

The app uses a three-panel concept that collapses for mobile:

```
┌──────────────────────────────────────────────────────────────┐
│  [Shared Olympus Header]                                      │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─── HUD BAR ──────────────────────────────────────────┐    │
│  │ Ship: The Daedalus  │ Hull: ████░ 78%  │ Fuel: ███░░ │    │
│  │ Location: Vega Station  │ Crew: 5  │ Turn: 47       │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─── NARRATIVE PANEL (main content) ───────────────────┐    │
│  │                                                       │    │
│  │  The airlock hisses open. Vega Station's central     │    │
│  │  concourse sprawls before you — a cathedral of       │    │
│  │  rust and neon. Somewhere below, the hum of a        │    │
│  │  thousand trade deals pulses like a heartbeat.       │    │
│  │                                                       │    │
│  │  Kira leans against the bulkhead, arms crossed.      │    │
│  │  "I don't like this place, Captain. Last time I      │    │
│  │  was here, I left in a hurry."                       │    │
│  │                                                       │    │
│  │  A figure in official-looking robes approaches.      │    │
│  │                                                       │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ┌─── ACTION PANEL ────────────────────────────────────┐     │
│  │  ▸ Greet the approaching official                    │     │
│  │  ▸ Ask Kira what happened last time                  │     │
│  │  ▸ Ignore them and head for the market               │     │
│  │  ▸ [Type your own action...]                         │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─── SIDEBAR TABS ────────────────────────────────────┐     │
│  │  [Ship] [Crew] [Codex] [Map] [Quests] [Log]        │     │
│  │                                                      │     │
│  │  (Expandable panels for browsing game state          │     │
│  │   without interrupting the narrative flow)           │     │
│  └──────────────────────────────────────────────────────┘     │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 Tabs / Sidebar Views

| Tab | Content |
|-----|---------|
| **Ship** | Ship name, class, hull/shields/fuel bars, weapons list, systems status, features, cargo summary |
| **Crew** | Crew roster with portraits (text-based), role, morale indicator, health status, assignment |
| **Codex** | Encyclopedia of discovered entities — people, factions, creatures, searchable by tag |
| **Map** | Visual star map showing discovered systems, current position, connections, fog of war |
| **Quests** | Active and completed quests with objectives, related entities/locations |
| **Log** | Scrollable narrative history, searchable, with turn numbers and summaries |

### 7.3 Mobile Considerations

Given your iOS-primary workflow, the mobile layout is critical:

- Narrative panel takes full width
- HUD becomes a compact strip (ship name + key stats)
- Sidebar tabs collapse into a bottom sheet or slide-over panel
- Action buttons are large touch targets
- Freeform input uses a standard text field at the bottom

---

## 8. Game Creation Flow

When starting a new campaign:

```
1. CHOOSE DIFFICULTY / TONE
   - "Frontier Explorer" (discovery-focused, lower danger)
   - "Smuggler's Run" (trade and intrigue, moderate danger)
   - "Warpath" (combat-heavy, high stakes)
   - "Custom" (mix and match)

2. NAME YOUR CAPTAIN
   - Player enters name and picks 2-3 traits from a list
   - Optionally writes a brief backstory (or Claude generates one)

3. CHOOSE YOUR SHIP
   - Present 3-4 ship classes with different stat profiles:
     - Light Freighter (high cargo, moderate speed, light weapons)
     - Scout Corvette (fast, good sensors, light cargo)
     - Gunship (heavy weapons, slow, low cargo)
     - Salvage Rig (specialized equipment, moderate everything)
   - Player names the ship

4. STARTING CREW
   - Claude generates 2-3 starting crew members based on ship class
   - Player can rename or adjust before confirming

5. OPENING SCENE
   - Claude generates the first narrative beat
   - Sets the initial location, situation, and first quest hook
   - All starting data written to Firestore
```

---

## 9. Firestore Security Rules

```
match /void_odyssey_games/{gameId} {
  // Only the game owner can read/write their game
  allow read, write: if request.auth != null
    && request.auth.uid == resource.data.userId
    && hasApp('void-odyssey');

  allow create: if request.auth != null
    && request.auth.uid == request.resource.data.userId
    && hasApp('void-odyssey');

  // Subcollections inherit the parent game's ownership check
  match /{subcollection}/{docId} {
    allow read, write: if request.auth != null
      && get(/databases/$(database)/documents/void_odyssey_games/$(gameId)).data.userId == request.auth.uid
      && hasApp('void-odyssey');
  }
}
```

---

## 10. Searchability & Claude Context Queries

### 10.1 Tag System

Every entity, location, item, and narrative entry carries a `tags[]` array. Tags are freeform strings applied by Claude during entity creation and updated as the story evolves. Examples:

- Person: `["merchant", "vega", "untrustworthy", "information_broker"]`
- Location: `["station", "frontier", "trade_hub", "criminal_element"]`
- Narrative: `["combat", "boarding", "pirates", "kira_injured"]`
- Quest: `["main_story", "magistrate_dren", "data_core", "vega"]`

### 10.2 Firestore Queries for Context Assembly

| Query | Firestore Pattern |
|-------|-------------------|
| Entities at location | `entities` where `currentLocationId == X` |
| Active crew | `crew` where `status == 'active'` |
| Recent narrative | `narrative_log` orderBy `turnNumber` desc, limit 5 |
| Active quests | `quests` where `status == 'active'` |
| Entity by tag | `entities` where `tags` array-contains `'merchant'` |
| Narrative search | `narrative_log` where `tags` array-contains `'combat'` |
| Items in cargo | `items` where `location == 'cargo'` |
| Connected systems | `star_map` where `connections` contains current system ID |

### 10.3 Composite Indexes Needed

```json
{
  "indexes": [
    {
      "collectionGroup": "narrative_log",
      "fields": [
        { "fieldPath": "locationId", "order": "ASCENDING" },
        { "fieldPath": "turnNumber", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "entities",
      "fields": [
        { "fieldPath": "currentLocationId", "order": "ASCENDING" },
        { "fieldPath": "type", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "crew",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "loyalty", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "quests",
      "fields": [
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ]
}
```

---

## 11. Cost Considerations

### API Costs

Each turn requires one Claude API call. Using `claude-sonnet-4-20250514` to balance quality and cost:

- Estimated input: ~2,000-4,000 tokens per turn (context assembly)
- Estimated output: ~500-1,000 tokens per turn (narrative + mutations)
- At ~$3/M input and ~$15/M output tokens: roughly $0.005-$0.02 per turn
- A 200-turn campaign costs roughly $1-4 in API usage

### Firestore Costs

- Reads: Context assembly does 5-10 reads per turn (well within free tier for hobby use)
- Writes: 3-8 writes per turn (mutations, narrative log, entity updates)
- Storage: Minimal — text data, no media files

### Mitigation

- Cache the game document in the client between turns (avoid redundant reads)
- Batch Firestore writes (single batch per turn)
- Limit narrative log reads to the most recent N entries
- Compress old narrative entries (summarize every 20 turns into a digest)

---

## 12. Module Structure

Following the Olympus IIFE pattern and script load order:

```
public/apps/void-odyssey/
├── index.html            # App shell, script loading
├── state.js              # Namespace init, constants, shared state
├── firestore.js          # All Firestore CRUD operations
├── context.js            # Context assembly engine
├── engine.js             # Turn execution, Claude proxy calls
├── narrative.js          # Narrative display, history scrolling
├── hud.js                # Ship status HUD rendering
├── crew-ui.js            # Crew roster panel
├── codex.js              # Entity browser / encyclopedia
├── star-map.js           # Star map visualization (canvas or SVG)
├── quests-ui.js          # Quest log panel
├── game-create.js        # New game wizard flow
├── app.js                # Event listeners, init, tab routing
└── styles.css            # App-specific styles (extends shared app.css)
```

### Load Order

```html
<!-- State first -->
<script src="state.js"></script>

<!-- Data layer -->
<script src="firestore.js"></script>
<script src="context.js"></script>

<!-- Game engine -->
<script src="engine.js"></script>

<!-- UI modules (any order among themselves) -->
<script src="narrative.js"></script>
<script src="hud.js"></script>
<script src="crew-ui.js"></script>
<script src="codex.js"></script>
<script src="star-map.js"></script>
<script src="quests-ui.js"></script>
<script src="game-create.js"></script>

<!-- App init last -->
<script src="app.js"></script>
```

---

## 13. Phased Implementation

### Phase 1: Foundation
- App scaffold (index.html, state.js, app.js, auth guard)
- Game document schema + Firestore rules
- New game wizard (basic: name captain, name ship, pick class)
- Cloud Function: `voidOdysseyNewGame` (creates game doc, Claude generates opening)

### Phase 2: Core Loop
- Context assembly engine (load game state, build prompt)
- Cloud Function: `voidOdysseyTurn` (proxy Claude call, write mutations)
- Narrative panel (display story text, action buttons)
- HUD bar (ship stats display)
- Rate limiting (session + weekly limits, admin bypass) — see §15
- Basic turn cycle working end-to-end

### Phase 3: World State
- Crew subcollection + crew UI panel
- Items subcollection + cargo display
- Entity subcollection + basic codex browser
- Location subcollection + location detail view
- Claude entity creation flow (newEntities → Firestore)

### Phase 4: Navigation & Quests
- Star map data model + basic map visualization
- Navigation actions (travel between systems, fuel consumption)
- Quest subcollection + quest log UI
- Claude quest management (create/update/complete quests)

### Phase 5: Polish & Depth
- Narrative log search and browsing
- Narrative compression (summarize old entries)
- Crew relationships and morale system
- Combat flow (structured combat turns with tactical choices)
- Trade and economy (buy/sell at stations)
- Mobile layout optimization

### Phase 6: Enrichment
- Star map visual polish (canvas rendering, fog of war)
- Sound/mood indicators (ambient mood text or subtle visual cues)
- Campaign management (multiple saves, delete/archive)
- Narrative export (download your story as markdown/text)
- Achievement or milestone tracking
- Seed data: starting star map templates, ship class presets

### Phase 7: Stretch Goals
- Retro-style image generation (low-res pixel art for scenes, character portraits, locations)
- Voice narration via Web Speech API (client-side, toggle in settings)
- Dynamic difficulty tuning (adapt system prompt based on player performance)

---

## 14. Design Decisions

1. **Multiplayer?** No. Single-player per user. The data model stays user-scoped with no shared campaigns.

2. **Image generation?** Deferred to Phase 7 (Stretch Goals). Plan is low-res retro-style imagery — pixel art or similar. Will use a separate API call, stored in Firebase Storage, referenced by URL in entities/narrative.

3. **Voice narration?** Deferred to Phase 7 (Stretch Goals). Web Speech API, client-side, zero additional API cost. Toggle in settings.

4. **Difficulty tuning?** Deferred to Phase 7 (Stretch Goals). Fixed per campaign setting for now; dynamic tuning can be explored later.

5. **Canon enforcement depth?** The tag system and significant moments are sufficient. Claude follows the "spirit of the story" with structured anchors (tags, significant moments, active quest state) rather than loading full narrative history. This balances consistency with context window efficiency.

6. **Turn pacing / rate limiting?** Yes — implemented in Phase 2 as part of the core turn loop. See §15 for full design.

---

## 15. Rate Limiting

### Goal

Prevent players from burning through API credits too quickly, while keeping the experience smooth and non-punitive.

### Session Limits

Track turns per rolling time window (e.g., per hour or per calendar day). Thresholds:

- **Session soft limit:** Warn after N turns in a short window (e.g., 30 turns/hour). Show a non-blocking notification: "You've been playing a while — the stars will wait for you."
- **Session hard limit:** After a higher threshold (e.g., 50 turns/hour), block further turns with a friendly message. No data is lost — the player can resume later. The game state remains intact.

### Weekly Limits

Track total turns per calendar week:

- **Weekly soft limit:** Warn when approaching the weekly cap (e.g., 80% of limit).
- **Weekly hard limit:** Block further turns for the week. Display remaining time until reset.

### Admin Bypass

Users with the `admin` custom claim bypass hard limits but still see soft-limit warnings. This allows admins to test and play without restriction while staying aware of usage.

### Implementation

- Turn counts tracked in the game document: `turnsThisHour`, `turnsThisWeek`, `lastTurnTimestamp`, `weekStartTimestamp`
- Limit check runs server-side in the `voidOdysseyTurn` Cloud Function before calling Claude
- If limit exceeded: return a structured response with `limitReached: true` and a message, no API call made
- Client displays the limit message in the narrative panel styled as a system notification
- Limits are configurable constants in the Cloud Function (easy to tune)
