# The Loom — Grading That Asks for More — Design Document v0.1

**Status:** Decided (2026-10-10). The gap sheet (§3) is answered; sub-issues are ready to file (§6).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-690 (#551)
**Runs:** right after Phase 3c, before L-700 and L-720, so every new content feature adds to it from the start (Build order in [`roadmap.md`](./roadmap.md))
**Replaces:** the Rich grade in [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §4. The gate (Unbuilt, Stub, Playable) is unchanged.

---

## 1. Purpose

Grading says how built a world is. Its lower grades are the gate: players can only enter Playable places. Its top grade, Rich, is meant to show that a place is fully built, but it asks for so little that places reach it quickly, and nothing asks for more. Art, portraits, town ground and everything Phases 6 to 8 add don't count at all.

This rework keeps the gate as it is and replaces Rich with a **score from 0 to 100**, made of weighted criteria. A top score takes real content, and the score grows as the game does: **every feature that adds content to the game adds its criteria to the score** (the user's note: "We have to make sure new features add to the grading if they add to the game content"). When a feature ships, scores drop and the work list points at the new work, which is how new features get used.

---

## 2. What there is today

- **`functions/loom-canon/grading.js`** (rubric version 2) is the one definition of "built". The gate (ADJUDICATE, `loomCreateSave`, publish), the MCP tools (`list_work`, the read tools) and the Cartographer page (`cartographerCompletion`) all use it. Grades are computed, never stored.
- **Grades:** Unbuilt (a required layer is missing), Stub (description is still the import text), Playable (players may enter), Rich.
- **Rich today:**
  - **Settlements:** residents and lore by size. A village needs 1 resident and 1 lore entry, a town 2 and 1, a city 4 and 2, a great city 6 and 3; a capital counts one size up.
  - **Points of interest:** 1 lore entry and their own battle map with walls, doors or obstacles.
  - **Places in town:** someone there or 1 lore entry, plus their own battle map.
  - **Realms and regions:** a description and 1 lore entry. They are never gated.
- **Not graded:** characters, battle maps on their own, lore entries, towns as a whole, the world.
- **Content:** a description counts as written when it came from MCP, however short. Lore entries name the entities they concern (`entityRefs`).

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-10). Items marked † were left to Claude ("You choose") or took the recommendation without a question of their own.

### The scale

| ID     | Question                   | Decision                                                                                                                                                                                         |
| ------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **G1** | What sits above Playable?  | **A score from 0 to 100, with named bands.** Playable stays the gate                                                                                                                             |
| **G2** | Does the gate change?      | **No. Only the top grows.** A new feature never closes an open place                                                                                                                             |
| **G3** | How are points shared out? | **Weighted criteria.** Big content (art, a map, a business) is worth more than small                                                                                                             |
| **G4** | Band names †               | **Playable** (under 40), **Rich** (40), **Vivid** (70), **Legendary** (90). Rich at 40 keeps today's meaning: the weights are calibrated so a place that met today's Rich bar lands there (§4.3) |

### What gets graded

| ID     | Question                           | Decision                                                                                                                                              |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | What has a score?                  | **Places (settlements, points of interest, places in town), realms and regions, characters, battle maps, towns as a whole, and the world**            |
| **S2** | Does a score include what's in it? | **Yes, in part:** a settlement's score counts its own criteria plus its town's places and its people, so a city can't top out with a thin town (§4.2) |
| **S3** | The world's score?                 | **An average weighted toward where play happens:** the start, open places and their frontier count most; distant unbuilt places least (§4.4)          |

### Criteria for the top

The user ticked these (C1 to C5). Criteria from features not built yet switch on when the feature ships (E2). Weights are in §4.3.

| ID     | Kind                                  | Criteria                                                                                                                                                                                                        |
| ------ | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Settlements                           | Residents and lore for its size (higher counts) · town ground (L-650) · town art · a spread of NPC types (L-750) · businesses for its size (L-780) · residents' portraits (L-730) · in a painted region (L-710) |
| **C2** | Points of interest and places in town | Its own battle map with walls · battle-map art · someone there · lore about it · items to find (L-770) · a business where its kind suggests one (L-780)                                                         |
| **C3** | Characters                            | A written description · lore about them · a faction · a portrait (L-730) · NPC types (L-750) · what they carry or sell (L-770, L-780) · a voice and goals (L-790)                                               |
| **C4** | Realms and regions                    | A written description · lore, more for larger realms · notable people · a painted shape (L-710)                                                                                                                 |
| **C5** | The world                             | A world brief (L-710) · a cover image (L-704) · map art · the region layer covers the land (L-710) · an item catalog (L-770) · world-wide lore                                                                  |
| **C6** | Quality                               | **Minimum lengths** (short text doesn't count), **variety** (not every resident the same type; lore of more than one kind), **links** (lore that names other entities; people with a faction). No AI review     |

Not ticked, so not criteria: more than one exit or doors on a map, relations between realms, a world's default style, a world's currency. A later epic can still propose them (E1).

### Encouraging new features

| ID     | Question                           | Decision                                                                                                                                                                                                                    |
| ------ | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** | How does a feature join the grade? | **A rule:** every epic that adds content to the game adds its criteria, as part of the epic. A content epic isn't done until its criteria are in the rubric. Written into the roadmap's "How work is split" and `CLAUDE.md` |
| **E2** | When do new criteria count?        | **At once**, when the feature ships. Only the top moves, never the gate                                                                                                                                                     |
| **E3** | How does `list_work` push them?    | **Closed places first, as now; then by score gained per piece of work. Each item names the tool that fills it, and the same work is grouped across places** ("12 residents have no portrait")                               |
| **E4** | Where is the score shown?          | **The Cartographer page** (score and band by kind, biggest gaps), **MCP reads**, and **players see a world's rating on the Loom's world list**                                                                              |
| **E5** | A minimum score to publish?        | **No.** The gate per place is enough                                                                                                                                                                                        |
| **P1** | When is it built?                  | **Now**, before L-700's content features, so they add to it from the start                                                                                                                                                  |
| **P2** | The Phase 6–8 epics?               | **Each gets a "Grading" line now**, from the ticks above                                                                                                                                                                    |

---

## 4. Design

### 4.1 Criteria

A criterion is data in one registry inside the grading module:

```js
{ id: 'settlement.townArt', kind: 'settlement', weight: 10, feature: 'L-704',
  label: 'Town art', need: 'townArt', tool: 'studio_assign',
  check: (world, entity) => ({ met, have?, want? }) }
```

- **`kind`** is one of `settlement`, `poi`, `place`, `character`, `battleMap`, `realm`, `region`, `world`.
- **`check`** is pure, like the rest of the module. It can report progress (`have` 2 of `want` 4), and partial progress earns that share of the weight.
- **A feature adds its criteria in the PR that ships it** (E1). A criterion for a feature that hasn't shipped isn't in the registry, so it never counts or shows.
- **Weights and quality thresholds live in one table** in the module, so tuning is a one-line change, and every change bumps `RUBRIC_VERSION`.

### 4.2 Scores

- **An entity's own score** is the weight of its met criteria (with partial progress) over the weight of all its criteria, from 0 to 100.
- **Rollup (S2):** a settlement's score is 60% its own, plus 40% the average of its town's places and its residents. A point of interest's or a place's score is 70% its own, plus 30% its battle map and the people there. A realm's is 70% its own, plus 30% its regions. Characters, battle maps and regions score only themselves.
- **The gate comes first.** A place below Playable is shown as Unbuilt or Stub, as now, and scores 0 wherever it is averaged. A score's band applies once a place is Playable.
- **Bands (G4):** Playable under 40, Rich from 40, Vivid from 70, Legendary from 90. The `grade` field keeps `unbuilt`, `stub` and `playable`, and gains `score` and `band`. Code that asked for `'rich'` (the work list) moves to `band`.

### 4.3 The first criteria and weights

Criteria that today's content can meet go in with this epic. The rest are listed with the epic that adds them; their weights are a starting point that epic can change.

| Kind                         | Now (L-690)                                                                                             | Added later                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Settlement**               | Residents for size 20 · lore for size 15 · town art 10 · description long enough 10 · lore that links 5 | Town ground 10 (L-655) · NPC types spread 10 (L-750) · businesses for size 10 (L-780) · residents' portraits 10 (L-730) · in a painted region 5 (L-710) |
| **Point of interest, place** | Own battle map with walls 20 · map art 15 · someone there 10 · lore 10 · description long enough 10     | Items to find 10 (L-770) · a business where its kind suggests one 10 (L-780)                                                                            |
| **Character**                | Description long enough 25 · lore about them 15 · a faction 10                                          | Portrait 20 (L-730) · NPC types 15 (L-750) · carries or sells 10 (L-770, L-780) · voice and goals 10 (L-790)                                            |
| **Battle map**               | Walls or obstacles 30 · art 30 · features 20 · exits placed 20                                          | Items on the map (L-770)                                                                                                                                |
| **Realm, region**            | Description long enough 30 · lore for its size 30 · notable people 20                                   | Painted shape 20 (L-710)                                                                                                                                |
| **World**                    | Map art 20 · world-wide lore 20 · opening hook and tagline 10                                           | World brief 20 (L-710) · cover image 15 (L-704) · region layer covers the land 15 (L-710) · item catalog 15 (L-770)                                     |

- **Size counts rise (C1):** a village wants 2 residents and 2 lore entries, a town 4 and 3, a city 8 and 5, a great city 12 and 8. A capital counts one size up, as now.
- **Quality (C6):**
  - **Lengths:** at least 60 words for a place's description, 40 for a character's, 80 for a realm's or region's, and 60 for a lore entry to count anywhere.
  - **Variety:** a settlement's lore counts fully only if it touches more than one of its places or people. Once L-750 ships, its residents must span types.
  - **Links:** "lore that links" means an entry naming two or more entities.
- **Calibration:** the weights are tuned on Nisia's real content in L-691, so that a place that met rubric 2's Rich bar lands at about 40, which is Rich. Its checklist then shows what Vivid needs. The tuned weights replace the ones above in this doc.

### 4.4 The world's score

- **Weights by distance from play (S3):** each place's score is weighted by how near it is to play. The start, open places and the frontier next to them weigh 3. Other places weigh 1 at two travel steps beyond the frontier, falling to 0.25 beyond that.
- **The formula:** the world's score is 80% that weighted average of its places, plus 20% its own criteria (C5).
- **Its band is shown to players** on the Loom's world list (E4) as the band name.

### 4.5 The work list and reads

- **`list_work` order (E3):** closed frontier places, then other closed places, as now. Then every unmet criterion, ordered by **score gained for the world** (its weight × the entity's place weight in §4.4). Items doing the same work are grouped ("12 residents have no portrait · 9 points · `studio_assign`"). Each item names its tool.
- **Reads:** `get_world`, `get_location`, `get_faction`, `get_region`, `get_character` and `get_battle_map` show score, band and checklist with each criterion's weight. `find_locations` can filter by band.
- **The Cartographer page** shows each world's score and band, counts by band per kind, and its five biggest gaps (`cartographerCompletion`).

### 4.6 The rule for new features

- **Planning (E1):** written into [`roadmap.md`](./roadmap.md) §7 and `CLAUDE.md`. An epic that adds content lists its criteria and weights in its design doc's gap sheet. One of its stories adds them to the registry, with tests.
- **Shipping:** an epic isn't closed until its criteria are in the registry.

---

## 5. Exit criterion

On Nisia, the Cartographer page shows the world's score and band, and Hatham's score with its gaps. Over MCP, `list_work` lists the work after the closed places by score gained, grouped across places with the tool for each. Places that were Rich under rubric 2 score about 40 (Rich), and reaching Vivid takes visibly more content. The Loom's world list shows Nisia's band.

---

## 6. Sub-issues

| ID           | Story                                                                                                                                                                                                | Depends on | Model  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| L-691 (#552) | **The score:** the criteria registry, today's criteria and weights (§4.3), quality checks, rollup, bands, the world's score; `grade` gains `score` and `band`; rubric version 3; calibrated on Nisia | —          | Opus   |
| L-692 (#553) | **Reads and the work list:** score, band and weighted checklists in the MCP reads; `list_work` by score gained, grouped, with tools; `find_locations` by band                                        | L-691      | Sonnet |
| L-693 (#554) | **The Cartographer page:** world score and band, counts by band per kind, biggest gaps                                                                                                               | L-691      | Sonnet |
| L-694 (#555) | **Players see the rating:** a world's band on the Loom's world list                                                                                                                                  | L-691      | Sonnet |

**Order:** L-691 first; the other three can run side by side after it.

Tests: pure-module tests for every criterion, the rollup, bands and the world's score (and the calibration against a copy of Nisia); a real MCP client for the reads and `list_work`; headless Chrome for the two pages.

---

## 7. Later

- **An AI review of writing quality** (C6, not chosen): a model rating a place's text, kept until it changes.
- **Score history**, to see building progress over time.
