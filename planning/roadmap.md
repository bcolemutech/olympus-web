# The Loom and the Cartographer — Roadmap

**Status:** Living plan. Update it whenever an epic opens, ships or moves.
**Updated:** 2026-10-12
**Project:** Olympus (`olympus-dfa00`)
**Replaces:** the milestone tables in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md), which now covers Phase 1 only.

This is the one place that says what has shipped, what is in progress, and what comes next. Each phase still has its own design document, which says _what_ the phase is and records its decisions; this document only orders the work.

---

## 1. Phases

| Phase                         | Milestone | Design doc                                                             | State                                         | Exit criterion                                                                                                                                                                                                                   |
| ----------------------------- | --------- | ---------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**                   | #14       | [`the-loom-design.md`](./the-loom-design.md)                           | ✅ Shipped ([sign-off](./phase-1-signoff.md)) | Across a session gap, never forgets hard state, never breaks the seeded rules, never silently contradicts canon. Resume works                                                                                                    |
| **MCP Initiative 1**          | —         | [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)   | ✅ Shipped (#347–357)                         | An MCP connector works end to end from Claude on iOS (Scriptorium)                                                                                                                                                               |
| **3 — Rapid worlds**          | #16       | [`the-cartographer-design.md`](./the-cartographer-design.md)           | ✅ Shipped (L-300 / #314, C-1 to C-7)         | An uploaded Azgaar map becomes a published, playable world; a later MCP fix reaches games on their next turn                                                                                                                     |
| **3b — Layered worlds**       | #19       | [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md)           | ✅ Shipped (L-320 to L-350)                   | Travel to an unbuilt place is turned back, and opens once built; a player walks from the world map into a town and across a battle map                                                                                           |
| **3c — Movement and vision**  | #20       | [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md) | ✅ Shipped (L-600 to L-680, §2)               | Each epic's own exit criterion (§2)                                                                                                                                                                                              |
| **3d — Time**                 | #21       | [`the-loom-game-time.md`](./the-loom-game-time.md), #421               | 🚧 In progress (§3)                           | Hatham to Daldockley by trail takes about 2½ hours and the play view shows "Day 1, evening"                                                                                                                                      |
| **6 — Studio and new worlds** | #22       | One per epic (§4)                                                      | ✅ L-700 and L-720 shipped (Build order)      | A world begun from a studio-made map image, its places pinned and its regions painted over MCP, is published and played with no Azgaar in the loop. A cross-country trip is stopped by an event in a painted forest, and goes on |
| **7 — Map-first Loom**        | #23       | One per epic (§4)                                                      | 📋 Planned (§4)                               | A game is played from a full-window map: narration and rolls in a side panel, characters as round portrait tokens, and a click on ground, a place or a person offers what can be done there                                      |
| **8 — People and trade**      | #24       | One per epic (§4)                                                      | 📋 Planned (§4)                               | A player buys a sword from the smith in the world's own coin; it lands in their inventory, and the shop's stock drops. A companion follows them out and speaks in a voice of their own                                           |
| **9 — Game systems**          | #25       | [`game-systems.md`](./game-systems.md)                                 | 📋 Planned (§4)                               | Two worlds on different systems (d20 fantasy, dice-pool sci-fi): picking the same lock rolls by each system's formula, shows its breakdown on a card, and the sheet shows the attributes and skill used                          |
| **2 — Living world**          | #15       | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | The off-screen world visibly changes between sessions without raising the per-turn cost                                                                                                                                          |
| **4 — Multiplayer**           | #17       | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | Shared World State is consistent across two concurrent players                                                                                                                                                                   |
| **5 — Visuals**               | #18       | [`the-loom-design.md`](./the-loom-design.md) §9                        | 💤 Later (§5)                                 | Images generated within the batch budget                                                                                                                                                                                         |

Phases are numbered in the order they were planned, not the order they are built. Phase 2 was deferred once the Cartographer made worlds large enough that building them out, and moving through them, came first.

---

## Build order (decided 2026-10-10)

1. **Finish Phase 3c:** L-650 Town ground, L-660 Walking in town, L-670 Vision in town (all shipped).
2. **L-690 Grading that asks for more** (#551), so every content feature after it adds its criteria (shipped).
3. **L-700 Image studio** (#523). **Shipped** (L-701 the library, L-702 the studio page, L-703 library tools, L-704 worlds use library images, L-705 today's art into the library, L-706 costs, L-707 generation, L-708 editing and L-709 styles).
4. **L-720 UI rewrite** (#525), right after the studio, to show the new artwork well. It carries over the finished town views. **Shipped** (L-721 the shell, L-722 the map engine, L-723 the town level, L-724 the battle level, L-725 between levels, L-726 the panel's content, L-727 the art, L-728 phones and L-729 the look).
5. **Phase 3d:** L-370 Game time (#421). **In progress** (L-371 time in saves shipped).
6. **Phase 9 — Game systems:** L-800 the system engine, then L-810 character sheets (decided 2026-10-14). New worlds then pick a system as they are made, and Phases 7 and 8 build on the sheet.
7. **L-710 Worlds without Azgaar** (#524), then L-360 off-road travel (#418), then the rest of Phases 7 and 8 in their order (§4).

Phases are planned groups. This list, not the phase numbers, says what is built next.

---

## 2. Shipped: Phase 3c — Movement and vision

| Epic                               | Issues                | State      |
| ---------------------------------- | --------------------- | ---------- |
| L-600 Town quick fix               | #433                  | ✅ Shipped |
| L-610 Turns and movement           | #434 (L-611 to L-615) | ✅ Shipped |
| L-620 Walls, doors and obstacles   | #435 (L-621 to L-628) | ✅ Shipped |
| L-630 Vision and fog (battle maps) | #436 (L-631 to L-636) | ✅ Shipped |
| L-640 Characters on battle maps    | #437 (#460–462)       | ✅ Shipped |
| L-680 Everyone has a place         | #512 (#513–517, #519) | ✅ Shipped |
| L-650 Town ground                  | #438 (#463–467)       | ✅ Shipped |
| L-660 Walking in town              | #439 (#468–472)       | ✅ Shipped |
| L-670 Vision in town               | #440 (#473–475)       | ✅ Shipped |

**Order:** L-640 needs sight (L-630). L-680 gives every character a position (§6a of the design doc; decided 2026-10-08) and comes before the town epics. L-650 to L-670 bring the same to towns, in that order. L-650's MCP tools and `view_image` work (L-653, L-654) are the Cartographer's part of this phase.

### After Phase 3c

| Epic                             | Issue | State                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L-690 Grading that asks for more | #551  | ✅ Shipped (L-691 to L-694, #552–555). [`the-loom-grading.md`](./the-loom-grading.md): a 0–100 score above the gate, in bands, calibrated on Nisia; criteria added by every content feature (§4.6)                                                                                                                               |
| L-700 Image studio (Phase 6)     | #523  | ✅ **Shipped**: L-701 the library (#537), L-702 the studio page (#538), L-703 library tools (#539), L-704 worlds use library images (#540), L-705 today's art into the library (#541), L-706 costs (#542), L-707 generation (#543), L-708 editing (#544) and L-709 styles (#545). [`the-image-studio.md`](./the-image-studio.md) |

**Order:** L-690 comes first, once Phase 3c is done, so the content features that follow add their criteria to it from the start. L-700 follows it, then L-720 (§4).

---

## 3. Next: Phase 3d — Time

L-370 and its sub-issues (#499–504) moved from the Phase 3b milestone (#19) to their own, #21 (2026-10-14). L-690, which belongs to no phase, sits with the studio in Phase 6's milestone (#22).

| Epic            | Issue | State                                                                                                                                                                | Depends on                                                                   |
| --------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L-370 Game time | #421  | Designed in [`the-loom-game-time.md`](./the-loom-game-time.md) (decided 2026-10-08, revisited 2026-10-15 after the UI rewrite); sub-issues L-371 to L-376 (#499–504) | Phase 3c: turns become time (6 s a battle-map turn, about 5 min a town turn) |

**Order:** Phase 3d follows L-690, L-700 and L-720 (Build order, above). Plan L-370's sub-issues before it starts.

**L-360 off-road travel (#418) moved to Phase 6** (decided 2026-10-09). Its terrain was to come from Azgaar's cells; it now comes from the region layer that replaces Azgaar (L-710).

---

## 4. Then: Phases 6 to 9 (planned 2026-10-09; Phase 9 added 2026-10-14)

Ten enhancements, placed through an intake questionnaire on 2026-10-09. Each epic below has an issue with a short story list. **Sub-issues are not filed until the epic is next**: each epic gets its own design doc and gap sheet first, since the plan may change a lot before then. The answers recorded here are a starting point for those design docs, not settled decisions.

**Order** (revised 2026-10-10; see Build order, above): **L-700** and **L-720** come before Phase 3d, right after L-690: the UI rewrite follows the studio to show its artwork well, and carries over the finished town views (L-650 to L-670). Everything else here comes after Phase 3d, so game time exists for opening hours, restocking and schedules: L-710 first, then L-360, then Phases 7 and 8.

### Phase 6 — Studio and new worlds

| Epic                                            | Rank | Intake answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Depends on         |
| ----------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **L-700 Image studio** (#523)                   | 1    | **Designed** in [`the-image-studio.md`](./the-image-studio.md) (decided 2026-10-09); sub-issues L-701 to L-709 (#537–545). Its own app for Cartographer editors; its MCP tools join the Cartographer connector, and everything it does can be done from MCP. Generates (Gemini image models on Vertex) and edits images. A library not tied to a world: every image keeps its prompt and is searchable by labels and keywords, and is then assigned to worlds as maps, portraits, item art, or used in the app itself. No spending limit yet, but every image's cost is recorded and shown in the UI and over MCP | —                  |
| **L-710 Worlds without Azgaar** (#524)          | 2    | **Designed** in [`worlds-without-azgaar.md`](./worlds-without-azgaar.md) (decided 2026-10-10); sub-issues L-711 to L-718 planned, filed when next. A world starts from a studio map image, in its own map units, with a brief (genre, tone, era, art direction) and its own route kinds. Claude adds places in batches, pins routes along waypoints, and paints region shapes and terrain as polygons; the GM and off-road travel read them. Azgaar worlds keep working, with their layer converted from their exports, and the importer becomes a legacy link                                                    | L-700 (map images) |
| **L-360 Off-road travel and wilderness** (#418) | —    | **Designed** in [`off-road-travel.md`](./off-road-travel.md) (decided 2026-10-11); sub-issues L-361 to L-365 planned, filed when next. Travel anywhere on the map, the quickest way across L-710's painted terrain, in day legs with camps; closed places reached and stood outside of, never entered; events rolled per leg (25% × terrain and region danger, seeded and recorded) from Claude's event tables and played on generic maps by terrain                                                                                                                                                              | L-370, L-710       |

### Phase 7 — Map-first Loom

| Epic                                         | Rank | Intake answers                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Depends on                     |
| -------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| **L-720 UI rewrite** (#525)                  | 3    | **Shipped** (2026-10-15). **Designed** in [`the-map-first-loom.md`](./the-map-first-loom.md) (decided 2026-10-10); sub-issues L-721 to L-729 (#592–600). Preact with htm and PixiJS, no build step; one map engine for world, town and battle map with a zoom between them; a resizable side panel on the right, a menu bar, a minimap; soft fog and quiet markers so the art leads; Roll20's layout with Baldur's Gate trim. Replaced piece by piece in place | Phase 3c done (town epics)     |
| **L-730 Character images and tokens** (#526) | 4    | **Designed** in [`portraits-and-tokens.md`](./portraits-and-tokens.md) (decided 2026-10-11); sub-issues L-731 to L-736 planned, filed when next. NPC portraits from the studio over MCP; players upload, pick from the world's gallery, or generate (one a week plus one edit, on a private shelf, costs under the player); tokens cut at a focal point with disposition rings; speaking portraits in the narration; Character and People panels               | L-720; L-700 for generated art |
| **L-740 Click actions** (#527)               | 5    | **Designed** in [`click-actions.md`](./click-actions.md) (decided 2026-10-11); sub-issues L-741 to L-745 planned, filed when next. Every click opens a layered menu (no one-tap shortcuts), impossible actions hidden; first actions Move, Look, Talk, Open/close/unlock, Enter/leave as structured actions under the same turn rules; Talk opens a conversation in the panel; custom actions over MCP, counted in grading; suggestions linked to the map      | L-720                          |

### Phase 8 — People and trade

| Epic                                        | Rank | Intake answers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Depends on                 |
| ------------------------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **L-750 NPC types and interactions** (#528) | 6    | **Designed** in [`npc-types.md`](./npc-types.md) (decided 2026-10-11); sub-issues L-751 to L-755 planned, filed when next. Ten built-in types (commoner, merchant, innkeeper, guard, priest, crafter, guide, mercenary, trainer, entertainer) that worlds can rename, hide or add to; several per character, primary first; rules for the GM, with a guard who sees a crime always responding; laws per realm; the GM can set a type aside in a save; rumours, the way, work and blessings open conversations answered from canon lore | L-740                      |
| **L-770 Inventory** (#530)                  | 8    | **Designed** in [`inventory.md`](./inventory.md) (decided 2026-10-11); sub-issues L-771 to L-775 planned, filed when next. First of the trade epics. A catalog per world with item art; instances and soft items on saves; weight per world, half speed past the limit; ten slots; one-level containers; items on battle-map squares, in containers and carried by characters, kept per save; pick up, drop, equip, move; a grid panel                                                                                                 | —                          |
| **L-760 Currency** (#529)                   | 7    | **Designed** in [`currency.md`](./currency.md) (decided 2026-10-11); sub-issues L-761 to L-764 planned, filed when next. Now after L-770: coins are items, one stackable catalog item per denomination, with whole-number ratios per world; everyone carries coins; paying uses the fewest coins with automatic change; the GM moves money only as recorded changes; no grading criterion                                                                                                                                              | —                          |
| **L-780 Businesses** (#531)                 | 9    | **Designed** in [`businesses.md`](./businesses.md) (decided 2026-10-11); sub-issues L-781 to L-784 planned, filed when next. Defaults for markets, taverns, smithies, temples and shops, refined over MCP; fixed prices, buying anything at half value while the till can pay; hours and per-item restock on game time; stock and till per save; a trade window; rooms, meals and passage                                                                                                                                              | L-750, L-760, L-770, L-370 |
| **L-790 AI characters** (#532)              | 10   | **Designed** in [`ai-characters.md`](./ai-characters.md) (decided 2026-10-11); sub-issues L-791 to L-796 planned, filed when next. Memory notes per save, voice and goals over MCP; NPCs in your scene take turns after yours by behaviours in code (post, patrol, wander), with one extra Flash call for the whole scene on notable turns; generic NPCs as templates placed many times, exempt from character grading; up to three companions, asked or hired, who follow, act, take commands and carry; a Party panel                | L-750                      |

**Order** (decided 2026-10-11): L-750, then **inventory (L-770) before currency (L-760)**, since coins are items, then L-780 and L-790.

---

### Phase 9 — Game systems

Designed in [`game-systems.md`](./game-systems.md) (decided 2026-10-14). A world has one game system, written as data over MCP: its sheet, dice formulas, difficulty ladder, words and modules. Mechanics are modules built once and configured per system. Built after Phase 3d and before L-710. Replaces L-202 (#313).

| Epic                                      | Order | State                                                                                                                                                                                                                                                                                                                                          | Depends on               |
| ----------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| **L-800 The system engine** (#606)        | 1     | **Designed**; sub-issues L-801 to L-805 planned, filed when next. Systems as data with MCP tools; a safe formula language with dice, tables and breakdowns; checks with degrees, a named difficulty ladder, opposed rolls, INTERPRET proposing and ADJUDICATE rolling; a d20 fantasy and a dice-pool sci-fi system built in; tap-to-roll cards | L-720 (L-726 roll cards) |
| **L-810 Character sheets** (#607)         | 2     | **Designed**; sub-issues L-811 to L-814 planned, filed when next. Attributes, resources and level in every system, with skills, traits, conditions and derived values optional; guided creation; NPC sheets and stat blocks; the Character panel (which L-730 later adds portraits to) and a strip on the map                                  | L-800                    |
| **Modules**, each its own epic from L-820 | 3+    | Not yet designed. In order: combat (L-820), powers, social conflict, crafting, ship battle, chases, hacking, mass battle                                                                                                                                                                                                                       | L-810                    |

## 5. Later

### Deferred phases

- **Phase 2 — Living world.** L-200 `loomWorldTick` (#311). L-201 (#312, world tick vs. player presence) is decided. L-202 richer rule sets (#313) moved to Phase 9, Game systems (2026-10-14).
- **Phase 4 — Multiplayer.** L-400 (#316). L-401 (#317, conflict resolution) is decided. Shared doors and fog, and how each save's clock lines up with a world time (L-370), are settled here.
- **Phase 5 — Visuals.** L-500 Imagen 4 (#318): scene images during play. Kept separate from the Image studio (L-700), which makes art for building worlds (decided 2026-10-09). Could also paint battle maps and town art from the same data (Layered Worlds §11).

### Not yet placed

Ideas from earlier phases with no epic yet. Each needs a home before it is planned.

| Idea                                                                                                      | From                    | Likely home                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| Quests and a journal: work taken on, from whom, and its progress                                          | L-750 (IN4)             | Its own epic, after Phase 8              |
| Combat: initiative, other characters' turns, reactions, cover                                             | Movement and vision §11 | Phase 9: the combat module (L-820)       |
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
- **Content features add to grading.** An epic that adds content to the game (art, people, items, places, layers) lists its grading criteria and weights in its design doc and adds them to the rubric in one of its stories. It isn't closed until they are in ([`the-loom-grading.md`](./the-loom-grading.md) §4.6).
- **Mechanics are modules; systems are data.** A mechanic (combat, ship battle, powers) is built once as a module that declares its settings, and is tested with at least two systems' settings from its first story. A game system never needs new code: a difference that would is a module option every system can use ([`game-systems.md`](./game-systems.md) §4.6).
- **Model routing** follows the rubric in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md): the smallest model for mechanical edits, the mid-tier model for implementation against a clear spec and an in-repo pattern, and the top-tier model for the control spine, decisions and epic decomposition.
