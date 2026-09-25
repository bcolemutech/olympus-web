# The Loom — Design Document v0.1

**Status:** Draft for review
**Project:** Olympus (`olympus-dfa00`)
**Related:** The Cartographer (canon source — Azgaar-map-based world builder), `sustainable-ai-game-worlds.md`

---

## 1. Overview

The Loom is a shared narrative engine for Olympus: a way to **rapidly stand up a persistent game world and then play inside it like a sandbox.** It combines a server-owned AI-GM turn loop, a shared-world-plus-private-saves structure, and a build-vs-play mode split — with The Cartographer supplying world generation — into one reusable substrate rather than a separate app per setting.

The motivation is concrete. Existing platforms in this space are either too expensive to run a real campaign on (AI Dungeon's credit/context tiers, NovelAI's Opus tier) or the AI experience is weak in exactly the ways that break immersion. By building on Olympus and routing AI through Gemini 2.5 Flash, cost stays low. The harder problem is the AI experience, and the entire design is organized around two failures that every competitor exhibits:

1. **Memory** — characters and platforms forget what happened (AI Dungeon's "dragon turns into a dentist"). The fix is a layered, server-owned state model where hard facts never decay.
2. **Control** — the model breaks its own world's rules and invents contradicting facts. The fix is a turn pipeline where **the model proposes interpretation and prose, and the deterministic core owns truth.**

Naming: **The Loom** (confirmed — see §10). The Fates weave the thread of fate; the world is woven from threads of play. It pairs deliberately with The Cartographer — the Cartographer draws the map, the Loom weaves the story upon it. (_Mnemosyne_ was considered and passed over.)

---

## 2. Goals and Non-Goals

**Goals**

- One reusable narrative substrate that any setting (sci-fi, historical, fantasy, generic sandbox) sits on top of as a thin world config.
- Persistent, shared world state that survives across sessions and (eventually) players.
- Demonstrable resistance to the three failure modes: forgotten events, hallucinated facts, rule-breaking.
- Low marginal cost per turn; expensive AI work concentrated into batch runs that benefit the whole world.
- Canon ingestion from The Cartographer as the "rapidly build a world" half of the loop.

**Non-Goals (for now)**

- Deep tactical combat simulation — defer.
- Real-time synchronous multiplayer — defer to a later phase; design the data model so it isn't precluded.
- Image generation — defer to a later phase (Imagen 4 already proven elsewhere in Olympus).

---

## 3. Design Principles

These inherit directly from Olympus conventions and add one:

- **Server-side logic, AI-side interpretation.** Randomness, adjudication, and state mutation live in Cloud Functions. The model interprets results into narrative. (Carried over and made central.)
- **The LLM proposes, the server disposes.** _(New, and the spine of this doc.)_ The model may parse intent and write prose. It never holds authority over state, rules, or canon. Any fact it invents is provisional until the server promotes it.
- **LLM for flavor, not structure.** Geography and mechanics are algorithmic/deterministic; the model handles naming, prose, and fuzzy intent.
- **Minimize per-player real-time LLM calls.** Per-turn play needs cheap real-time calls; everything richer (world simulation, summarization, enrichment) is batched into infrequent shared runs.
- **Static config over Firestore for stable data.** Hand-authored worlds and rule definitions are static config; only mutable and generated data lives in Firestore.
- **Single app with mode routing.** The Loom is one embedded app; world/scenario selection is routing, not separate apps.
- **Design docs first, MVP discipline, explicit phase exit criteria.**

---

## 4. Memory Architecture

Four layers, each with a different mutability and owner. The separation is what prevents forgetting: hard state lives in Firestore and is never truncated to fit a context window; only the _narrative recap_ is ever summarized.

| Layer                           | Source / store                                                            | Mutability                                    | Role                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Canon**                       | Static JS config, or Firestore for Cartographer-generated/editable worlds | Read-only at play time                        | World definition: places, factions, characters, rules, lore                                                            |
| **World State**                 | Firestore (`loom_world_state`)                                            | Server-mutated, shared                        | The live persistent simulation — who's where, what's changed, faction standings. Makes the world feel alive and shared |
| **Character/Session State**     | Firestore (`loom_saves`)                                                  | Server-mutated, private per player            | Private saved games: position, inventory, personal goals, relationship deltas, private flags                           |
| **Event Log + Rolling Summary** | Firestore (`loom_turns` subcollection) + a regenerated summary field      | Append-only log; summary regenerated in batch | History plus a dense recap. Entity-keyed retrieval surfaces specific past beats when relevant                          |

This gives a shared world across players with private saved games: World State is the shared layer, Character State is the private layer.

**Why this beats Story Cards.** AI Dungeon's memory is keyword-triggered text injection plus capped slots, so anything not matched silently falls out. Because the Loom's events are _structured_ (entity references, not just prose), retrieval is keyed on the actual entities in play — when an NPC re-enters a scene, their full history and disposition is pulled deterministically, not hoped for.

---

## 5. The Turn Pipeline (Control Structures)

Every player turn runs through a fixed server pipeline. This is the answer to hallucination and rule-breaking.

```
1. INTAKE        Player free-text action arrives
2. INTERPRET     LLM (Flash, structured output) → proposed action
                 { verb, targets[], params }  — fuzzy intent only, no authority
3. ADJUDICATE    Deterministic rules engine + server-side dice, against
                 authoritative World/Character state →
                 Resolution { outcome, state_mutations[], narrative_constraints[] }
4. NARRATE       LLM (Flash) receives canon snippet + current state + the FIXED
                 Resolution + rolling summary → prose. Interprets, never decides.
5. COMMIT        Server applies state_mutations; quarantines any model-invented
                 entities as provisional soft-canon; appends turn to event log;
                 triggers async summary regen past a threshold
```

How each failure mode is contained:

| Failure                     | Where it's stopped                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Rule-breaking**           | Stage 3. The model never adjudicates legality. "I fly across the chasm" is checked against whether the character can fly; the rules engine resolves it, the model only narrates the result  |
| **Hallucinated hard facts** | Stages 3 and 5. Hard facts are _supplied_ to the narrator as constraints; any new entity the model names in prose is captured as **provisional soft-canon**, not silently promoted to truth |
| **Forgotten events**        | Layers 2–4. Hard state persists in Firestore and is never trimmed; the event log is summarized rather than dropped; entity-keyed retrieval re-surfaces specifics                            |

The narration prompt is explicitly told the Resolution is final: it may color _how_ something happened, never _whether_.

**Rules seam (L-140).** ADJUDICATE calls the rules engine only through a fixed interface — `evaluate(proposedAction, worldState, characterState, dice) → Resolution` — with hand-coded per-world JS rules behind it for MVP. A data-driven rule schema (Phase 2, L-202) swaps in behind the same interface without reshaping the pipeline. See §10.

**Soft-canon promotion.** When the model invents a detail to fill a gap ("a barkeep named Doral"), it's written to a provisional pool tied to the world. When referenced again or confirmed, it is promoted to an _established world fact in World State_ — never into Canon, which no one writes at play time (L-141, §10). This prevents one-off inventions from accreting into contradictions while still letting the world grow organically. MVP promotion rule: promote on second reference, behind a seam for later tuning (see §10).

---

## 6. AI Usage Split (Cost & Sustainability)

This reconciles turn-based play with the "concentrate spend into batch world-sim runs" principle from `sustainable-ai-game-worlds.md`.

| Mode                     | When                                        | Model                                     | Examples                                                                                                            |
| ------------------------ | ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Real-time / per-turn** | Every player action; latency-sensitive      | Gemini 2.5 Flash                          | Intent parse, narration (~1–2 calls/turn)                                                                           |
| **Batch / async**        | Infrequent; benefits the whole shared world | Flash or Claude Sonnet where quality pays | World-tick simulation (off-screen NPCs/factions act), event-log summary regeneration, Cartographer canon enrichment |

Per-turn cost is held to a couple of cheap Flash calls. The expensive, world-enriching work runs as scheduled batch jobs whose output is shared by everyone in the world — the per-turn calls are the one deliberate exception to the minimize-real-time-calls principle.

---

## 7. Olympus Integration

Standard "add a new app" path from the architecture doc — nothing exotic.

| Concern   | Implementation                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------- |
| App       | Embedded app at `/public/apps/loom/`, IIFE namespace modules, no build step                                               |
| Registry  | `apps.yaml` entry, `type: embedded`, `path: /apps/loom/`                                                                  |
| Auth      | Custom claim `hasApp('loom')`; admin-granted via The Pantheon                                                             |
| Frontend  | Vanilla JS + Firebase compat SDK; Leaflet only if a world surfaces a map                                                  |
| Functions | `loomPlayTurn` (callable), `loomCreateWorld`, `loomWorldTick` (scheduled/batch) — Node 22, CommonJS, Vertex calls proxied |
| Rules     | Default-deny; `loom_*` collections gated on `hasApp('loom')`; saves owner-scoped                                          |
| Deploy    | Existing GitHub Actions; Environment Protection Rules for approval                                                        |

### Firestore collections

```
loom_worlds          // world metadata + canon pointer (or canon inline for small worlds)
loom_world_state     // shared mutable simulation state, keyed by worldId
loom_saves           // private per-player character/session state
  └─ loom_turns      // subcollection: append-only event log per save
loom_softcanon       // provisional model-invented entities pending promotion
```

### Cloud Function contract (MVP)

```
loomPlayTurn(worldId, saveId, actionText)
  → { narration, stateSummary, suggestedActions? }
  // runs the full §5 pipeline server-side; client never sees raw state authority

loomWorldTick(worldId)                 // scheduled/batch
  → advances off-screen world state, regenerates summaries
  // presence-aware: defers locations with an active player,
  // queuing changes as pending world events (see §10, L-201)
```

---

## 8. Data Models (sketch)

```
loom_world_state
  worldId, updatedAt,
  locations{ id: { presentEntities[], stateFlags{} } },
  factions{ id: { standing, posture } },
  globalFlags{}, worldClock

loom_saves
  ownerUid, worldId, name,
  character{ name, condition, inventory[], abilities, goals[] },
  location, privateFlags{},
  relationships{ npcId: disposition },
  recentSummary,            // rolling recap, regenerated in batch
  createdAt, updatedAt

loom_turns (subcollection)
  index, actionText,
  proposedAction{ verb, targets[], params },
  resolution{ outcome, mutations[], constraints[] },
  narration,
  entityRefs[],             // for entity-keyed retrieval
  createdAt
```

Denormalize per Olympus convention: copy the canon details a turn needs into the turn/state docs at write time rather than joining at read time.

Write model (per §10 decisions): all `loom_world_state` writes run in Firestore transactions, and `state_mutations` are expressed as deltas (add/remove/increment/set-flag) rather than whole-document overwrites — this is what makes the batch tick (L-201) and later concurrent multiplayer turns (L-401) merge cleanly without a migration.

---

## 9. Roadmap

Explicit phase exit criteria, MVP-first.

| Phase                | Scope                                                                                                      | Exit criterion                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**          | Single-player, one hand-authored world, text-only, full §5 pipeline + four-layer memory + a small rule set | A multi-session adventure that, across a session gap, **never forgets hard state, never breaks the seeded rules, and never silently contradicts canon.** Resume works |
| **2 — Living world** | `loomWorldTick` batch simulation; richer rule sets                                                         | Off-screen world visibly changes between sessions without per-turn cost increase                                                                                      |
| **3 — Rapid worlds** | Cartographer (generalized for the Loom, Azgaar map import) → Loom canon ingestion                          | A new playable world stands up from Cartographer output without hand-authoring                                                                                        |
| **4 — Multiplayer**  | Four tiers: shared leaderboards → shared world → async co-op → sync co-op                                  | Shared World State is consistent across two concurrent players                                                                                                        |
| **5 — Visuals**      | Imagen 4 scene/portrait generation                                                                         | Images generated within batch budget                                                                                                                                  |

MVP is the explicit gate: Phase 1's exit criterion is the whole thesis of the project. If it doesn't hold, nothing downstream matters.

---

## 10. Open Questions & Decisions

### Decided (2026-07-02)

- **Rule-engine expressiveness** (L-140 / #309) — **Hand-coded rules behind a stable seam.**
  MVP rules are plain JS per world, but the pipeline only ever sees a fixed interface:

  ```
  rulesEngine.evaluate(proposedAction, worldState, characterState, dice)
    → Resolution { outcome, state_mutations[], narrative_constraints[] }
  ```

  A data-driven rule engine can later implement the same interface without touching the
  pipeline (Phase 2, L-202 / #313). Rationale: fastest path to testing the MVP thesis;
  the seam — not the engine — is the architectural commitment.

- **Canon authority** (L-141 / #310) — **Nobody writes Canon at play time.**
  The model and players write only World/Character state and the soft-canon pool. Soft-canon
  promotion (L-115 / #302) elevates entities to _established world facts inside World State_ —
  never into Canon. Canon changes only through authoring: static-config commits now,
  Cartographer/admin tooling in Phase 3. Rationale: Canon stays a trustable hand-authored
  layer, and the security model stays clean — there is no runtime write path into canon,
  client or server.

- **World-tick vs. player presence** (L-201 / #312) — **Presence-aware tick + transactional
  writes.** Every `loom_world_state` write — batch tick or player turn — runs in a Firestore
  transaction, so writes are never torn. The tick additionally checks presence (recent-turn
  timestamp per location) and defers simulating locations with an active player, emitting the
  deferred changes as pending world events applied on that player's next turn. Rationale: no
  global locks, no blocked player turns, no tick starvation in busy shared worlds — and it is
  the same transactional model multiplayer (L-401) requires.

- **Name** — **"The Loom" confirmed** (maintainer call, 2026-07-02). _Mnemosyne_ considered and
  passed over. The `loom` app id, `loom_*` collections, and `loom*` function names stand as
  specified throughout this doc.

- **Multiplayer conflict resolution** (L-401 / #317) — **Transactional turns.**
  Each turn's COMMIT applies its `state_mutations` inside a Firestore transaction that
  re-reads World State; conflicting concurrent turns retry automatically. Mutations are
  expressed as _deltas_ (add/remove/increment/set-flag), never whole-document overwrites, so
  retried turns merge cleanly. The Phase 1/2 write model (L-114 / #301) already specifies
  transactional delta commits, so it is compatible as-is — no migration needed for the
  shared-world tier.

### Still open

- **Soft-canon promotion policy** — MVP default is promote-on-second-reference behind a seam
  (L-115 / #302); tuning (time-based decay, explicit confirmation) stays open.
