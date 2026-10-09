# The Loom and the Cartographer — Roadmap

**Status:** Living plan. Update it whenever an epic opens, ships or moves.
**Updated:** 2026-10-08
**Project:** Olympus (`olympus-dfa00`)
**Replaces:** the milestone tables in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md), which now covers Phase 1 only.

This is the one place that says what has shipped, what is in progress, and what comes next. Each phase still has its own design document, which says _what_ the phase is and records its decisions; this document only orders the work.

---

## 1. Phases

| Phase                        | Milestone    | Design doc                                                                   | State                                         | Exit criterion                                                                                                                                                          |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — MVP**                  | #14          | [`the-loom-design.md`](./the-loom-design.md)                                 | ✅ Shipped ([sign-off](./phase-1-signoff.md)) | Across a session gap, never forgets hard state, never breaks the seeded rules, never silently contradicts canon. Resume works                                           |
| **MCP Initiative 1**         | —            | [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)         | ✅ Shipped (#347–357)                         | An MCP connector works end to end from Claude on iOS (Scriptorium)                                                                                                      |
| **3 — Rapid worlds**         | #16          | [`the-cartographer-design.md`](./the-cartographer-design.md)                 | ✅ Shipped (L-300 / #314, C-1 to C-7)         | An uploaded Azgaar map becomes a published, playable world; a later MCP fix reaches games on their next turn                                                            |
| **3b — Layered worlds**      | #19          | [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md)                 | ✅ Shipped (L-320 to L-350)                   | Travel to an unbuilt place is turned back, and opens once built; a player walks from the world map into a town and across a battle map                                  |
| **3c — Movement and vision** | #20          | [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md)       | 🔨 In progress (§2)                           | Each epic's own exit criterion (§2)                                                                                                                                     |
| **3d — Time and travel**     | _(proposed)_ | [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §10, #421, #418 | 📋 Next (§3)                                  | Hatham to Daldockley by trail takes about 2½ hours and the play view shows "Day 1, evening"; a cross-country trip is stopped by an event in the rainforest, and goes on |
| **2 — Living world**         | #15          | [`the-loom-design.md`](./the-loom-design.md) §9                              | 💤 Later (§4)                                 | The off-screen world visibly changes between sessions without raising the per-turn cost                                                                                 |
| **4 — Multiplayer**          | #17          | [`the-loom-design.md`](./the-loom-design.md) §9                              | 💤 Later (§4)                                 | Shared World State is consistent across two concurrent players                                                                                                          |
| **5 — Visuals**              | #18          | [`the-loom-design.md`](./the-loom-design.md) §9                              | 💤 Later (§4)                                 | Images generated within the batch budget                                                                                                                                |

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
| L-680 Everyone has a place         | #512 (#513–517, #519) | **Next**   |
| L-650 Town ground                  | #438 (#463–467)       | Planned    |
| L-660 Walking in town              | #439 (#468–472)       | Planned    |
| L-670 Vision in town               | #440 (#473–475)       | Planned    |

**Order:** L-640 needs sight (L-630). L-680 gives every character a position (§6a of the design doc; decided 2026-10-08) and comes before the town epics. L-650 to L-670 bring the same to towns, in that order. L-650's MCP tools and `view_image` work (L-653, L-654) are the Cartographer's part of this phase.

---

## 3. Next: Phase 3d — Time and travel (proposed)

Both epics sit in the Phase 3b milestone today (#19) but were always planned for after it. The proposal is to move them into a milestone of their own.

| Epic                                 | Issue | State                                                                                                          | Depends on                                                                   |
| ------------------------------------ | ----- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| L-370 Game time                      | #421  | Designed in [`the-loom-game-time.md`](./the-loom-game-time.md) (decided 2026-10-08); sub-issues L-371 to L-376 | Phase 3c: turns become time (6 s a battle-map turn, about 5 min a town turn) |
| L-360 Off-road travel and wilderness | #418  | First sketch only                                                                                              | L-370 (cross-country travel takes time); generic battle maps                 |

**Order:** L-370 first. Plan its sub-issues while Phase 3c finishes, so it is ready to start.

---

## 4. Later

### Deferred phases

- **Phase 2 — Living world.** L-200 `loomWorldTick` (#311), L-202 richer rule sets (#313). L-201 (#312, world tick vs. player presence) is decided. Richer rule sets are also where combat lands (below).
- **Phase 4 — Multiplayer.** L-400 (#316). L-401 (#317, conflict resolution) is decided. Shared doors and fog, and how each save's clock lines up with a world time (L-370), are settled here.
- **Phase 5 — Visuals.** L-500 Imagen 4 (#318). Could also paint battle maps and town art from the same data (Layered Worlds §11).

### Not yet placed

Ideas from earlier phases with no epic yet. Each needs a home before it is planned.

| Idea                                                                                                      | From                    | Likely home                              |
| --------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------- |
| Combat: initiative, other characters' turns, reactions, cover                                             | Movement and vision §11 | L-202 richer rule sets                   |
| Light: darkness, torches, darkvision                                                                      | Movement and vision §11 | After L-370 (night needs time)           |
| Hidden places; places learned of from a map or a conversation                                             | Movement and vision §11 | After L-670                              |
| Fatigue and hunger                                                                                        | L-370 (#421)            | After L-370                              |
| Building tools: a wall editor on the Cartographer page, walls from SVG art, Watabou City Generator import | Movement and vision §11 | A Cartographer epic                      |
| Several maps per location (floors, parts of a large structure): tools and views                           | Layered worlds §2       | A Cartographer epic                      |
| A cheaper model for INTERPRET (Flash-Lite), tried against recorded turns                                  | Movement and vision §11 | Its own story, any time                  |
| Fixing World State and saves over MCP                                                                     | Cartographer §6         | Needs its own rules for live player data |

---

## 5. Open questions

Unresolved questions, kept in their design docs:

- **Soft-canon promotion tuning** — [`the-loom-design.md`](./the-loom-design.md) §10.
- **Settlement filtering, narrower scopes for live worlds, fixing saves over MCP** — [`the-cartographer-design.md`](./the-cartographer-design.md) §6.
- **Rich criteria, whether regions ever gate** — [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §11.

---

## 6. How work is split

- **Each phase gets a design doc** with a dated **Decisions** section (settled with the user, often through a gap sheet), then an **Epics and sub-issues** table. Its status line says Planned, In progress or Shipped.
- **Each epic** has an `L-x00`/`L-x10` ID, an issue titled `L-xxx — [Epic] …`, an exit criterion that can be played, and sub-issues titled `L-xxx · …`. Cartographer work in a Loom phase takes the Loom IDs.
- **Issues** carry the `loom` label, link their design doc section, name what they depend on, and suggest a model.
- **Model routing** follows the rubric in [`the-loom-issue-plan.md`](./the-loom-issue-plan.md): the smallest model for mechanical edits, the mid-tier model for implementation against a clear spec and an in-repo pattern, and the top-tier model for the control spine, decisions and epic decomposition.
