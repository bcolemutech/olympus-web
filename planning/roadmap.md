# The Loom and the Cartographer — Roadmap

**Status:** Living plan. Update it whenever an epic opens, ships or moves.
**Updated:** 2026-10-09
**Project:** Olympus (`olympus-dfa00`)
**Replaces:** the milestone tables in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md), which now covers Phase 1 only.

This is the one place that says what has shipped, what is in progress, and what comes next. Each phase still has its own design document, which says _what_ the phase is and records its decisions; this document only orders the work.

---

## 1. Phases

| Phase                         | Milestone    | Design doc                                                             | State                                         | Exit criterion                                                                                                                                                                                                                   |
| ----------------------------- | ------------ | ---------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**                   | #14          | [`the-loom-design.md`](./the-loom-design.md)                           | ✅ Shipped ([sign-off](./phase-1-signoff.md)) | Across a session gap, never forgets hard state, never breaks the seeded rules, never silently contradicts canon. Resume works                                                                                                    |
| **MCP Initiative 1**          | —            | [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)   | ✅ Shipped (#347–357)                         | An MCP connector works end to end from Claude on iOS (Scriptorium)                                                                                                                                                               |
| **3 — Rapid worlds**          | #16          | [`the-cartographer-design.md`](./the-cartographer-design.md)           | ✅ Shipped (L-300 / #314, C-1 to C-7)         | An uploaded Azgaar map becomes a published, playable world; a later MCP fix reaches games on their next turn                                                                                                                     |
| **3b — Layered worlds**       | #19          | [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md)           | ✅ Shipped (L-320 to L-350)                   | Travel to an unbuilt place is turned back, and opens once built; a player walks from the world map into a town and across a battle map                                                                                           |
| **3c — Movement and vision**  | #20          | [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md) | 🔨 In progress (§2)                           | Each epic's own exit criterion (§2)                                                                                                                                                                                              |
| **3d — Time**                 | _(proposed)_ | [`the-loom-game-time.md`](./the-loom-game-time.md), #421               | 📋 Next (§3)                                  | Hatham to Daldockley by trail takes about 2½ hours and the play view shows "Day 1, evening"                                                                                                                                      |
| **6 — Studio and new worlds** | _(proposed)_ | _(to write, one per epic)_                                             | 📋 Planned (§4); L-700 starts alongside 3c/3d | A world begun from a studio-made map image, its places pinned and its regions painted over MCP, is published and played with no Azgaar in the loop. A cross-country trip is stopped by an event in a painted forest, and goes on |
| **7 — Map-first Loom**        | _(proposed)_ | _(to write, one per epic)_                                             | 📋 Planned (§4)                               | A game is played from a full-window map: narration and rolls in a side panel, characters as round portrait tokens, and a click on ground, a place or a person offers what can be done there                                      |
| **8 — People and trade**      | _(proposed)_ | _(to write, one per epic)_                                             | 📋 Planned (§4)                               | A player buys a sword from the smith in the world's own coin; it lands in their inventory, and the shop's stock drops. A companion follows them out and speaks in a voice of their own                                           |
| **2 — Living world**          | #15          | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | The off-screen world visibly changes between sessions without raising the per-turn cost                                                                                                                                          |
| **4 — Multiplayer**           | #17          | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | Shared World State is consistent across two concurrent players                                                                                                                                                                   |
| **5 — Visuals**               | #18          | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | Images generated within the batch budget                                                                                                                                                                                         |

Phases are numbered in the order they were planned, not the order they are built. Phase 2 was deferred once the Cartographer made worlds large enough that building them out, and moving through them, came first.

---

## 2. Now: Phase 3c — Movement and vision

| Epic                               | Issues                | State      |
| ---------------------------------- | --------------------- | ---------- |
| L-600 Town quick fix               | #433                  | ✅ Shipped |
| L-610 Turns and movement           | #434 (L-611 to L-615) | ✅ Shipped |
| L-620 Walls, doors and obstacles   | #435 (L-621 to L-628) | ✅ Shipped |
| L-630 Vision and fog (battle maps) | #436 (L-631 to L-636) | ✅ Shipped |
| L-640 Characters on battle maps    | #437 (#460–462)       | ✅ Shipped |
| L-680 Everyone has a place         | #512 (#513–517, #519) | ✅ Shipped |
| L-650 Town ground                  | #438 (#463–467)       | **Next**   |
| L-660 Walking in town              | #439 (#468–472)       | Planned    |
| L-670 Vision in town               | #440 (#473–475)       | Planned    |

**Order:** L-640 needs sight (L-630). L-680 gives every character a position (§6a of the design doc; decided 2026-10-08) and comes before the town epics. L-650 to L-670 bring the same to towns, in that order. L-650's MCP tools and `view_image` work (L-653, L-654) are the Cartographer's part of this phase.

---

## 3. Next: Phase 3d — Time (proposed)

L-370 sits in the Phase 3b milestone today (#19) but was always planned for after it. The proposal is to move it into a milestone of its own.

| Epic            | Issue | State                                                                                                          | Depends on                                                                   |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L-370 Game time | #421  | Designed in [`the-loom-game-time.md`](./the-loom-game-time.md) (decided 2026-10-08); sub-issues L-371 to L-376 | Phase 3c: turns become time (6 s a battle-map turn, about 5 min a town turn) |

**Order:** plan L-370's sub-issues while Phase 3c finishes, so it is ready to start.

**L-360 off-road travel (#418) moved to Phase 6** (decided 2026-10-09). Its terrain was to come from Azgaar's cells; it now comes from the region layer that replaces Azgaar (L-710).

---

## 4. Then: Phases 6 to 8 (planned 2026-10-09)

Ten enhancements, placed through an intake questionnaire on 2026-10-09. Each epic below has an issue with a short story list. **Sub-issues are not filed until the epic is next**: each epic gets its own design doc and gap sheet first, since the plan may change a lot before then. The answers recorded here are a starting point for those design docs, not settled decisions.

**Order:** the phases follow the ranking, and come after Phase 3d, so game time exists for opening hours, restocking and schedules. The exception is **L-700 Image studio**, which is its own app and touches no play code: it runs alongside 3c and 3d in its own sessions. The UI rewrite comes after Phase 3c, so the town views (L-650 to L-670) are built once on the old base and then carried over.

### Phase 6 — Studio and new worlds

| Epic                                            | Rank | Intake answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Depends on         |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **L-700 Image studio** (#523)                   | 1    | **Designed** in [`the-image-studio.md`](./the-image-studio.md) (decided 2026-10-09); sub-issues L-701 to L-709 (#537–545). Its own app for Cartographer editors; its MCP tools join the Cartographer connector, and everything it does can be done from MCP. Generates (Gemini image models on Vertex) and edits images. A library not tied to a world: every image keeps its prompt and is searchable by labels and keywords, and is then assigned to worlds as maps, portraits, item art, or used in the app itself. No spending limit yet, but every image's cost is recorded and shown in the UI and over MCP | —                  |
| **L-710 Worlds without Azgaar** (#524)          | 2    | A new world starts blank (built over MCP) or from a map image, made in the studio or uploaded, with places pinned on it. Under the image, a data layer: MCP marks regions of the map for terrain, biome, faction ownership and the like. Why: Azgaar's art can't carry dark fantasy or alien worlds, its roads and sea lanes break, it isn't ours to charge for, and a controlled world can be shaped to the story. Existing Azgaar worlds stay; the importer is hidden as legacy and removed later                                                                                                               | L-700 (map images) |
| **L-360 Off-road travel and wilderness** (#418) | —    | Moved here from Phase 3d. Terrain comes from L-710's painted regions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | L-370, L-710       |

### Phase 7 — Map-first Loom

| Epic                                         | Rank | Intake answers                                                                                                                                                                                                                                                                                                                                                                                                                                                | Depends on                     |
| -------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **L-720 UI rewrite** (#525)                  | 3    | The Loom only. Driven by look and by coming features. Played from the map, which fills the window; the GM's narration and roll results in a side panel; pop-ups for character, inventory and NPC panels later. iPad or larger landscape first; phones work, with a suggestion to use a bigger screen where play suffers. Maps move to canvas or WebGL. The technology (stay vanilla, React from the CDN, or a build step) is compared in its design doc first | Phase 3c done (town epics)     |
| **L-730 Character images and tokens** (#526) | 4    | Portraits for NPCs (set over MCP) and for the player's character. A token is the portrait in a small circle, cut from it at a focal point, not a separate image. Uploads first; studio images can be assigned. Players make their own portraits in a Loom feature of their own                                                                                                                                                                                | L-720; L-700 for generated art |
| **L-740 Click actions** (#527)               | 5    | How the player acts on the world. A click on empty ground offers moves; on a place or feature, its interactions; on a character, talk and more (trade, if they keep a shop); on your own items, use, equip, drop. Choosing one sends a structured action that skips INTERPRET but is adjudicated and narrated. The list grows with each feature, and comes from the thing's kind plus its NPC type or business                                                | L-720                          |

### Phase 8 — People and trade

| Epic                                        | Rank | Intake answers                                                                                                                                                                                                                                                                                                     | Depends on                 |
| ------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- |
| **L-750 NPC types and interactions** (#528) | 6    | A built-in set of types that worlds can add to over MCP; a character can have several. A type gives the interactions on offer and rules the GM must follow                                                                                                                                                         | L-740                      |
| **L-760 Currency** (#529)                   | 7    | Each world names its own denominations over MCP, stored as one amount in the smallest unit. Money is hard state, owned by the server; the GM can't invent or lose it. Starting money is set per world                                                                                                              | —                          |
| **L-770 Inventory** (#530)                  | 8    | Items become canon: a catalog per world over MCP, with saves holding instances. Stacking, weight and a carrying limit, equipped slots, containers, items lying in the world, unique named items. The GM may create items during play (soft canon). Replaces today's list of names; locked doors (L-626) move to it | —                          |
| **L-780 Businesses** (#531)                 | 9    | A business is a place with a proprietor. It buys and sells, offers services, keeps opening hours, and its stock runs out and restocks. Prices are fixed per item per business. Defaults come from the place's kind, refined by Claude. Stock is a locked container, so theft can be added later                    | L-750, L-760, L-770, L-370 |
| **L-790 AI characters** (#532)              | 10   | Characters who act on their own in a scene, have their own memory and voice, and can travel with the player as companions. Separate from Phase 2's off-screen world. Combat stays in L-202                                                                                                                         | L-750                      |

---

## 5. Later

### Deferred phases

- **Phase 2 — Living world.** L-200 `loomWorldTick` (#311), L-202 richer rule sets (#313). L-201 (#312, world tick vs. player presence) is decided. Richer rule sets are also where combat lands (below).
- **Phase 4 — Multiplayer.** L-400 (#316). L-401 (#317, conflict resolution) is decided. Shared doors and fog, and how each save's clock lines up with a world time (L-370), are settled here.
- **Phase 5 — Visuals.** L-500 Imagen 4 (#318): scene images during play. Kept separate from the Image studio (L-700), which makes art for building worlds (decided 2026-10-09). Could also paint battle maps and town art from the same data (Layered Worlds §11).

### Not yet placed

Ideas from earlier phases with no epic yet. Each needs a home before it is planned.

| Idea                                                                                                      | From                    | Likely home                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| Combat: initiative, other characters' turns, reactions, cover                                             | Movement and vision §11 | L-202 richer rule sets                   |
| Theft: stealing from a shop's locked stock, and what follows                                              | L-780 intake            | After L-780                              |
| Spending limits on image generation (L-700 only records cost at first)                                    | L-700 intake            | When costs call for it                   |
| Light: darkness, torches, darkvision                                                                      | Movement and vision §11 | After L-370 (night needs time)           |
| Hidden places; places learned of from a map or a conversation                                             | Movement and vision §11 | After L-670                              |
| Fatigue and hunger                                                                                        | L-370 (#421)            | After L-370                              |
| Building tools: a wall editor on the Cartographer page, walls from SVG art, Watabou City Generator import | Movement and vision §11 | A Cartographer epic                      |
| Several maps per location (floors, parts of a large structure): tools and views                           | Layered worlds §2       | A Cartographer epic                      |
| A cheaper model for INTERPRET (Flash-Lite), tried against recorded turns                                  | Movement and vision §11 | Its own story, any time                  |
| Fixing World State and saves over MCP                                                                     | Cartographer §6         | Needs its own rules for live player data |

---

## 6. Open questions

Unresolved questions, kept in their design docs:

- **Soft-canon promotion tuning** — [`the-loom-design.md`](./the-loom-design.md) §10.
- **Settlement filtering, narrower scopes for live worlds, fixing saves over MCP** — [`the-cartographer-design.md`](./the-cartographer-design.md) §6.
- **Rich criteria, whether regions ever gate** — [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §11.

---

## 7. How work is split

- **Each phase gets a design doc** with a dated **Decisions** section (settled with the user, often through a gap sheet), then an **Epics and sub-issues** table. Its status line says Planned, In progress or Shipped.
- **Each epic** has an `L-x00`/`L-x10` ID, an issue titled `L-xxx — [Epic] …`, an exit criterion that can be played, and sub-issues titled `L-xxx · …`. Cartographer work in a Loom phase takes the Loom IDs.
- **Issues** carry the `loom` label, link their design doc section, name what they depend on, and suggest a model.
- **Model routing** follows the rubric in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md): the smallest model for mechanical edits, the mid-tier model for implementation against a clear spec and an in-repo pattern, and the top-tier model for the control spine, decisions and epic decomposition.
