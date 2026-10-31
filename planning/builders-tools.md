# The Loom — Builder's Tools — Design Document v0.1

**Status:** Shipped (2026-10-31): L-391 to L-397 (#737–#743), each built as §4 says. Decided 2026-10-29. The bug, #744, is still open.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-390 (#736), Phase 9 — Game systems (milestone #25), built before L-840 advancement. From idea #735.
**Depends on:** L-820 (combat), L-813 (NPC sheets), the Cartographer connector.
**Related:** [`worlds-without-azgaar.md`](./worlds-without-azgaar.md) (L-710), [`combat.md`](./combat.md), [`ai-characters.md`](./ai-characters.md) (L-790), [`map-levels.md`](./map-levels.md), [`maps-from-data.md`](./maps-from-data.md)

---

## 1. Purpose

While building Nisia, Claude kept a list of what the Cartographer tools couldn't do, or could do only by slow workarounds (#735). The biggest gap: **a world can only start as an Azgaar import.** The next planned build, a small combat test world (a fort, two towns, five fight sites), can't begin without that, and needs guards who challenge before they fight.

This epic builds what's needed now:

- creating a world from scratch, as a minimal slice of L-710;
- wary figures with triggers;
- named stat blocks;
- a set of small fixes to building, the studio and the Scriptorium.

The rest of the list is folded into designed epics, or dropped (§3).

---

## 2. What there is today

- **Worlds** start from `cartographerImport` (an Azgaar map). There is no `create_world` or `add_location`.
- **Figures** (`place_figures`, characters on battle maps) have a side: hostile (the default), party or neutral. Hostiles start a fight on sight (L-821).
- **Sheets** are set one character at a time (`set_sheet`); stat blocks have a shape (L-813) but no names.
- **`view_image`** draws battle maps without their figures.
- **`list_work`** pages criteria (`limit`, `offset`) but shows at most 10 entities in each.
- **`entranceFor`** on a town's way in lists route kinds only.
- **Studio jobs** run once (`maxAttempts: 1`); a 429 from the model fails the job.
- **Scriptorium's `list_notes`** returns every note's full body.

---

## 3. Gap sheet

The list in #735, judged 2026-10-29, with the user's answers (each took the recommendation).

### Decisions

| ID      | Question          | Decision                                                                                                                                                                                                                   |
| ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BT1** | Where             | **A new epic, L-390, built next, before L-840,** so the combat test world exists to test advancement too                                                                                                                   |
| **BT2** | World creation    | **A minimal slice of L-710:** `create_world` with no image (a plain backdrop in today's coordinate space), `add_location(s)`, batch connect. L-712 and L-713 later add the brief, realms, regions, waypoints and map units |
| **BT3** | Wary figures      | **A wary side and per-figure triggers,** as a combat module setting, tested in both built-in systems                                                                                                                       |
| **BT4** | Named stat blocks | **On the world** (they're content, like characters); the system stays rules only                                                                                                                                           |

### The list

| #   | Gap                                                | Verdict                                                                                                   |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | No way to add a location or create a world         | **Now** (L-391)                                                                                           |
| 27  | Hostiles fight on sight; no wary side or triggers  | **Now** (L-392)                                                                                           |
| 18  | No bulk sheets or named stat blocks                | **Now** (L-393)                                                                                           |
| 28  | `view_image` doesn't draw figures                  | **Now** (L-394)                                                                                           |
| 26  | No cheap way to find a free square                 | **Now** (L-394)                                                                                           |
| 8   | Rooms behind locked doors warn as "walled in"      | **Now** (L-394)                                                                                           |
| 25  | Layout report stale after `set_town_ground`        | **Now** (L-395)                                                                                           |
| 6   | `entranceFor` by route kind only                   | **Now** (L-395): it also takes a destination                                                              |
| 12  | `list_work` shows 10 entities per criterion        | **Now** (L-395)                                                                                           |
| 13  | No lore coverage per town                          | **Now** (L-395)                                                                                           |
| 22  | 429s fail studio jobs                              | **Now** (L-396)                                                                                           |
| 20  | Art can't match a grid's shape                     | **Now** (L-396): crop or pad in `studio_assign`; art stays an option after L-920                          |
| 5   | `list_notes` returns full bodies                   | **Now** (L-397)                                                                                           |
| 15  | `view_image` 502s on 8-digit hex colours           | **Now, as a bug** (#744)                                                                                  |
| 14  | `add_character`'s schema omitted `townPoint`       | **Fixed already:** the schema lists it                                                                    |
| 9   | Two-way stairs take three calls                    | **Later, in L-905:** `add_exit` makes both directions                                                     |
| 17  | Moving one feature resends the grid, losing `seen` | **Later, in L-929:** per-shape tools patch, and keep `seen`                                               |
| 10  | Routes can't carry rules                           | **Later, in L-713:** rules on routes with their kinds and waypoints                                       |
| 19  | Hazards can only apply a condition                 | **Later, in the dungeon epic:** with traps                                                                |
| 16  | Ground in a compact point format, circles          | **Later, in L-921:** the geometry's shapes                                                                |
| 16  | Art upload by file or URL, art patches             | **Not built:** art goes through the studio (`studioUpload`, `studio_assign`)                              |
| 24  | Rescaling a grid                                   | **Not built:** L-920 measures in feet, so a map's size is one number                                      |
| 11  | A shared SVG library for art                       | **Not built:** L-925's materials and object catalog replace hand-drawn SVG                                |
| 21  | A layout-guide render as the studio's reference    | **Not built:** under L-920 painted art is optional; `view_image` of the data already works as a reference |
| 23  | Rejecting images with a horizon                    | **Not built:** as 21                                                                                      |

---

## 4. Design

### 4.1 Worlds from scratch (BT2, gap 1)

- **`create_world`:** a name, a system (`systemId`), and a backdrop: a plain colour or a studio image, in today's coordinate space (the size Azgaar worlds use). It makes a draft world, as an import does.
- **`add_location` and `add_locations`:** a settlement or point of interest at `{ x, y }`, with its kind, name, description and settlement facts; for an existing world too (the smugglers' trail between Hatham and Daldockley).
- **`connect_locations` in batch:** many links in one call, each with its route kind; lengths from distance as today (L-372).
- **Built (L-391):** a world made this way is `source: { kind: 'scratch' }`, its map `{ width, height, backdrop: '#rrggbb', distance? }` (default 1600 × 1200 map units, 3 mi each; `milesPerUnit` sets it); `loomGetMap` sends the backdrop and the Loom's world map draws it under any art; the Cartographer page says "Made from scratch". `connect_locations` takes `links` (up to 100) or one pair.
- **The New world button** on the Cartographer page is left to L-712. Publishing works as it does for an imported world.
- **L-902's migration** moves these locations like any other, so nothing here is built twice.

### 4.2 Wary figures and triggers (BT3, gap 27)

- **A `wary` side,** beside hostile, party and neutral. A wary figure in sight doesn't start a fight. NARRATE is told it's wary and what it wants (`challenge`: "Halt. Name your business."), and the player can talk.
- **It turns hostile** (and a fight starts, L-821) when:
  - the player attacks it or an ally;
  - a check against it fails, where its `challenge` names one (a Deception check against the guard);
  - one of its triggers fires.
- **Triggers,** on a figure or a group: `{ on, target?, then }`.
  - `on`: `doorOpened`, `doorForced`, `featureTouched`, `allyAttacked`, `enteredArea`;
  - `target`: the door, feature or area;
  - `then`: `hostile` or `neutral`.
  - The Hulks' guards turn hostile if the hold grating is forced.
- **A combat module setting** (`modules.combat.wary`: on by default), so a system can turn it off; tested in both built-ins.
- **Named characters** can be wary too; L-790's behaviours build on this later.
- **Built (L-392):** `loom-modules/combat/wary.js`. A side turned in a save is `save.sides[id]`, put on the figure by `withFigures`. Attacking someone turns them, the wary of their figure group, and anyone whose `allyAttacked` trigger names them (or names no one); the wary stay out of a fight begun by others until turned; those turned while a fight is under way join it (`fight.join`), and one turned hostile in sight out of a fight starts one (`by: 'event'`, no surprise). `doorForced` is a lock given way without its key; `enteredArea` fires on a walk into the area, typed or clicked. NARRATE's people in sight carry "wary of the player: they challenge, …". Wary figures count as a dangerous place's foes in grading. The Loom draws them amber and offers Talk before Attack.

### 4.3 Named stat blocks (BT4, gap 18)

- **`loom_worlds/{worldId}/statBlocks/{id}`:** a name ("gate guard", "innkeeper") and a stat block in L-813's shape, checked against the world's system.
- **Tools:** `set_stat_block`, `list_stat_blocks`, and `statBlock: id` on `add_character`, `update_character` and `place_figures`, with overrides for the parts that differ.
- **Bulk:** `set_sheets` takes many characters at once, each a sheet or a stat block's name.
- **A change to a stat block** reaches everyone who names it; overrides stay. L-927's spawns will name them.
- **Built (L-393):** `loom-canon/stat-blocks.js`. A character names one as `statBlock: id` with `overrides` (attributes, skills and resources merge by id; level, traits and attacks replace), and their sheet is worked out when the world loads, for its system as it is then; a figure group's `statBlock` may be an id, resolved as its figures are made. `set_stat_block` takes one or up to 20 (`blocks`), all checked before any is written, and deletes one (null) only once nobody names it; `list_stat_blocks` shows who names each and what of it no longer fits the system; `set_sheets` takes up to 50. `set_sheet` with a sheet of a character's own drops their block.

### 4.4 Seeing and placing (gaps 28, 26, 8)

- **`view_image` draws figures** on battle maps as numbered markers coloured by side (wary its own colour), with a key, and sight lines from an entry on request.
- **`cell: "auto"`** on `add_character` and `place_figures` takes the nearest open square to a place or feature. A refusal for a taken or walled square names the nearest open one.
- **"Behind a locked door":** the reachability check treats locked doors as passable and says so, instead of "walled in".
- **Built (L-394):** `view_image` of a battle map draws characters and figures as numbered diamonds coloured by side (red hostile, green party, yellow wary, teal neutral), with `sides` as the key and each figure's group; `sightFrom: entryId` shades what that entry can't see (closed doors shut) and marks each person seen or not. `cell` takes `"auto"` (the nearest open square to the map's entry), `{ x, y, nearest: true }`, and `{ feature }` falls back to the nearest open square; `place_figures` cells take `"auto"`, given in turn so none share. Every refused square names the nearest open one (`maps.nearestOpen`, preferring squares a walk from an entry reaches). `layers.reachable` takes a door rule, so what lies behind a locked door warns "behind a locked door: only someone who opens it gets there".

### 4.5 Towns, routes and the work list (gaps 25, 6, 12, 13)

- **`set_town_ground`** re-checks the town's layout and returns it, so "Not reachable" never goes stale.
- **`entranceFor`** also takes destinations: `{ via: ['trail'], to: [locationId] }`. A traveller to or from those places uses that way; others use any way serving the route.
- **`list_work`** pages the entities inside a criterion (`entityLimit`, `entityOffset`).
- **`get_town`** gives each place's lore count, and the town's.
- **Built (L-395):** a way in's `entrance` may carry `to` (world places linked to the settlement); `town.serves(place, via, otherId)` and `town.waysFor` prefer a way set aside for the place at the other end, and leave it out for every other. Arrivals, leaving (the first leg's next stop on a journey), journeys' crossings, the town checks, `get_town`'s routes, the map view's ways out and NARRATE all pass the far end. `set_town_ground` returns the layout as it is with the new ground. `list_work` pages a criterion's entities (`entityLimit`, `entityOffset`, `nextEntityOffset`). `get_town` gives each place's `loreCount` and the town's `lore`: about the town, its places', and the places with none.

### 4.6 Studio jobs (gaps 22, 20)

- **Retries:** a 429 (`RESOURCE_EXHAUSTED`) puts the job back on the queue with backoff (up to 5 tries over about 10 minutes) instead of failing it; it isn't charged until it runs.
- **Shapes:** `studio_assign` (and the map and town image functions) take `fit: 'crop' | 'pad' | 'stretch'`, so art made at 4:3 fits a 26 × 20 grid.
- **Built (L-396):** a call the model turns away as busy (429, `RESOURCE_EXHAUSTED`) puts the job back to `queued` with `tries` and `retryAt`, and queues it again after 30, 60, 120 and 180 s; the fifth busy answer fails it ("The model stayed busy through 5 tries…"); nothing is charged for a try that came back with nothing; other errors fail at once. `fit` (`functions/studio/fit.js`, with sharp) crops the middle or pads with see-through margins to the grid's shape (a town's: square), as a new version made current, the original kept as the one before; an image used elsewhere is copied (`via: 'fit'`) so its other uses keep their shape; SVG is refused (its viewBox gives its shape); `stretch` keeps today's behaviour, without the warning.

### 4.7 Scriptorium (gap 5)

- **`get_note`** returns one note; **`list_notes`** returns titles and dates without bodies, paged by a cursor.
- **Built (L-397):** `list_notes` takes `limit` and `cursor` and answers with `next_cursor` while there are more, newest update first (ties by id); a cursor is the last note's update time and id, and a made-up one is refused. `get_note` reads one of the caller's notes whole; anyone else's, or an unknown id, is "Note not found." The `scriptorium://notes` resource still gives every note with its text.

### 4.8 Grading

The epic adds no content kind of its own. Named stat blocks fill the existing NPC sheet criterion (L-813) when characters use them.

---

## 5. Exit criterion

The combat test world is built over MCP from scratch:

- a fort hub, two towns and five fight sites, linked in one call;
- twenty guards set up from three named stat blocks in a few calls;
- their squares checked with `view_image`.

In play:

- the fort's gate guard challenges first, and a failed bluff starts the fight;
- forcing the hold grating turns the Hulks' guards hostile.

A batch of studio jobs that hits the model's limit finishes without failures.

---

## 6. Sub-issues (filed 2026-10-29)

| ID           | Story                                                                                                                          | Depends on | Model  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------ |
| L-391 (#737) | **Worlds from scratch:** `create_world` with a backdrop, `add_location(s)`, batch `connect_locations`                          | —          | Sonnet |
| L-392 (#738) | **Wary figures and triggers:** the wary side, challenges, turning hostile, triggers on figures and groups, the combat setting  | —          | Opus   |
| L-393 (#739) | **Named stat blocks:** the world's stat blocks, `set_stat_block`, `list_stat_blocks`, `statBlock` with overrides, `set_sheets` | —          | Sonnet |
| L-394 (#740) | **Seeing and placing:** figures in `view_image`, `cell: "auto"` and nearest-square refusals, "behind a locked door"            | —          | Sonnet |
| L-395 (#741) | **Towns, routes and the work list:** `set_town_ground` re-checks, `entranceFor` destinations, entity paging, lore per place    | —          | Sonnet |
| L-396 (#742) | **Studio jobs:** 429 retries with backoff, `fit` in `studio_assign`                                                            | —          | Sonnet |
| L-397 (#743) | **Scriptorium notes:** `get_note`, a paged list without bodies                                                                 | —          | Sonnet |

**Order:** L-391, L-392 and L-393 first (the test world needs them); the rest in any order.

The bug (gap 15) is filed on its own as #744.

Tests: a real MCP client for every tool; pipeline tests for a wary figure's challenge, a failed check and each trigger, in both built-in systems; a studio job retried after a 429 with the model faked; headless Chrome for figures in `view_image`.
