# The Loom — Off-Road Travel and the Wilderness — Design Document v0.2

**Status:** Decided (2026-10-11), refreshed 2026-11-14 (§3). Sub-issues L-361 to L-368 filed as #835–#842 (§6).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-360 (#418)
**Phase:** 6 — Studio and new worlds ([`roadmap.md`](./roadmap.md) §4), after L-710.
**Depends on:** L-710 (terrain as region maps' ground, regions, a world's own materials, routes with rules), L-900 (region maps at any depth, a save's `at`), L-370 (time and travel), L-384 (journeys), L-393 (named stat blocks), L-927 (encounters and spawns), L-929 (`generate_map`), the module rule ([`game-systems.md`](./game-systems.md)).
**Related:** [`worlds-without-azgaar.md`](./worlds-without-azgaar.md), [`journeys-and-arrivals.md`](./journeys-and-arrivals.md), [`the-loom-game-time.md`](./the-loom-game-time.md), [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §5 (the gate), [`maps-from-data.md`](./maps-from-data.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

The open country between places is always open.

- **Travel cross-country:** set out toward any point on a region map, taking the quickest way across its painted ground, in day legs with a camp each night.
- **Routes** stay the quicker, safer way.
- **Finding the way** is a roll: off the road, the system's survival skill keeps you on course.
- **Wilderness events** happen on the way. Each is rolled, never guessed, from encounter tables Claude writes, and is played on a battle map that fits the terrain: the world's own if it has one, else one made on the spot.
- **Closed places** stay closed, but you can reach them, by road or across country, and stand outside their gates (the user's note, 2026-10-11).

---

## 2. What there is today (2026-11-14)

- **Travel is along routes only:** moves to places and journeys through visited settlements (L-370, L-384), each route at its kind's speed, its length along its waypoints, its rules checked (L-715).
- **Terrain is ground** on region maps (L-710, R1): ground items made of materials (grassland, forest, hills, mountains, swamp, desert, tundra, ocean, lake…) and a world's own (`world.materials`, each `like` a built-in). Ground items carry a moving `cost` or `'never'`. `where` reads the terrain, region and realm at a point; the GM is told them (L-716).
- **Region maps nest at any depth** (L-900), each with its own units, scale and route kinds. A save's position (`at`) can already be a `point` on a region map.
- **Figures and encounters:** named stat blocks (L-393), `place_figures`, and places' and locations' `encounters` tables (`{ what, count?, weight? }`) filled into spawns by a broken rest (L-927).
- **Maps:** generic battle maps (`generic: { kind, terrain }`, L-350) can serve any place. `generate_map` (L-929) makes seeded maps, but only rooms, caves, interiors and decks.
- **The gate:** a move toward a place below Playable is turned back: "The way to X is closed. Turn back."
- **Modules:** combat and advancement are modules whose settings each game system sets (`system.modules`), tested with the d20 and dice-pool built-ins.

---

## 3. Decisions

### 3.1 Refreshed 2026-11-14

Settled with the user through a questionnaire; every answer took the recommendation. These replace the 2026-10-11 decisions where they differ (§3.2).

| ID      | Question                         | Decision                                                                                                                                                                                                                                                        |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TR2** | How fast each terrain is crossed | **A speed per ground material:** built-in defaults (plains 1, forest 0.5, hills 0.6, swamp 0.4, mountains 0.3…), a world's own material taking its `like`'s, any of them changeable per world; a ground item's own `cost` slows it further                      |
| **TR3** | Finding the way                  | **A coarse-grid planner for region maps** (about 200 cells on the long side), shared by the server and the page, with routes as fast lanes it can join and leave. The battle-map planner stays as it is                                                         |
| **TR4** | What can't be crossed            | **Water materials** (ocean, lake, deep water) **and any ground with cost `'never'`**; a world can mark more materials impassable. Rivers are crossed where a route crosses them, else slowly. Boats and ships come with vehicles (L-910)                        |
| **TR8** | Which maps                       | **Any region map at any depth.** In the wilds is a point on that map, in the save's `at`                                                                                                                                                                        |
| **MD1** | Where its numbers live           | **A `wilds` module:** the pace, the base event chance, the discovery distance and the navigation check are its settings, set by each system; a world can override them or turn off-road travel off                                                              |
| **MD2** | Getting lost                     | **A navigation check each day leg off-road,** its skill named by the system (Survival in d20, a survival pool in the dice-pool system), harder in worse terrain; a failure loses part of the day and drifts the camp. Rolled by the rules, shown as a roll card |
| **EV2** | Where events are written         | **The `encounters` format, extended** (`text`, `kind`, `terrain`, `narrated`), on regions and region maps, with the world's as a fallback and built-in narrated ones last; figures are stat blocks                                                              |
| **EV5** | The map an event is played on    | **A generic battle map tagged for the terrain if the world has one; otherwise a seeded wilderness map made on the spot** by a new outdoor generator (clearing, forest track, ford, ridge, marsh path, ruins), so no event is ever skipped                       |
| **EV6** | Danger                           | **A danger level on regions** (`update_region`) **and per ground material** (with the speeds), 0.5 calm to 2 deadly, 1 by default                                                                                                                               |
| **X1**  | Grading                          | **A region:** a danger level, and an encounter table that fits its terrain. **A world:** a generic map for each terrain on its land counts as a bonus, not a gap, since the generator covers it                                                                 |
| **X2**  | Exit criterion                   | **As proposed** (§5)                                                                                                                                                                                                                                            |

### 3.2 From 2026-10-11, as they stand

- **Kept:** TR1 (head anywhere; closed places reached and stood outside of, never entered), TR5 (a preview before setting out), TR6 (day legs, a camp each night, stop, turn or change course), TR7 (places near the path discovered), EV1 (a chance per day leg, scaled by danger), EV3 (kinds: travellers, creatures and monsters, hazards and weather, finds), EV4 (played on a battle map; small ones narrated only), EV7 (25% × terrain danger × region danger, seeded and recorded on the turn), EV8 (after an event: go on, turn back or change course).
- **Replaced:** TR2 and TR4 (by TR2 and TR4 above: on materials, not terrain kinds), EV2 (by EV2: the encounters format, not an events collection), EV5 (by EV5: a generated map, not no event), EV6 (by EV6: on materials and regions), X1 (by X1 above). Getting lost moves from an event to a check (MD2), and the numbers into a module (MD1).

---

## 4. Design

### 4.1 Terrain speed and danger (TR2, TR4, EV6)

- **Built-in defaults** in `materials.js` (both copies), per ground material: `wild: { speed, danger, impassable? }`. Plains-like ground 1; farmland 0.9; savanna 0.9; desert 0.6; hills 0.6; forest 0.5; taiga 0.5; jungle 0.4; swamp and marsh 0.4; tundra 0.6; mountains 0.3; glacier 0.2; ocean, lake and deep water impassable.
- **A world's own material** takes its `like`'s unless it sets its own.
- **Per world:** `world.wilds.materials: { [materialId]: { speed?, danger?, impassable? } }`, set with `set_wilds` (MCP).
- **A ground item's `cost`** divides its speed further; `'never'` is impassable.
- **Regions** gain `danger` (0.5–2, default 1), set with `update_region` or `add_regions`.

### 4.2 The planner (TR3, TR8)

- **`wild-paths.js`**, with identical bytes in `functions/loom-canon/` and `public/apps/loom/js/` (a test checks the copies):
  - rasterises a region map's ground into a coarse grid, about 200 cells on the long side;
  - each cell's cost is 1 / speed at its centre (the topmost ground, `groundAt`), impassable cells closed;
  - routes are lanes: a path may join a route at any point on its line and leave it, at the route kind's speed;
  - lines of `river` material cost extra to cross except where a route crosses them;
  - A\* gives the quickest path, its length in the map's distance unit, its time, the terrain crossed and the average danger.
- **Any region map at any depth** (TR8). A journey stays on one region map; reaching a place there that opens a map below goes in as today.

### 4.3 The `wilds` module (MD1, MD2)

- **`functions/loom-modules/wilds/`**, its settings in each system's `modules.wilds`:
  - `pace` (map distance units per hour off-road at speed 1; d20 1.5 mph),
  - `dayHours` (8, from L-370's travel day unless set),
  - `eventChance` (0.25),
  - `discover` (miles within which places on the path are discovered: 3),
  - `navigation: { check, dc, harder }`: the system's check (d20: Survival; dice-pool: its survival skill), its difficulty on the ladder, and how much harder per step of terrain danger above 1.
- **Both built-ins** set it; a system can leave it out, and a world can override any setting (`world.rules.wilds`) or turn off-road travel off (`world.rules.wilds: false`).
- **The navigation check** (MD2): each off-road day leg rolls it. A failure loses a share of the day (by degree) and drifts the camp off the path by the lost distance; the next leg replans from there. Shown as a roll card in the journal.

### 4.4 Journeys across country (TR1, TR5–TR7)

- **Starting:** `{ verb: 'travel', to: { mapId, point } | placeId, offRoad: true }`. The plan is the planner's path, kept as `save.journey: { mapId, path, leg, by }`.
- **Day legs** (TR6): each leg is the module's `dayHours` of travel, advancing time; a leg ends at a camp, the save standing in the wilds at a point on that map (`at` ends `{ mapId, point }`).
- **Continue** walks the next leg; **Stop** ends the journey where it is; a new destination changes course.
- **Closed places** (TR1): arriving at a place below Playable, by road or across country, leaves the save outside it, in the wilds at its edge, the narrator describing the closed gates. Entering is refused as today. This replaces the turn-back (layered worlds §5) for moves and journeys.
- **Discovery** (TR7): places within the module's `discover` distance of a leg's path become discovered.
- **The GM** is told the leg: terrain crossed, the camp's terrain, region and realm (L-716's WHERE line), the navigation roll.

### 4.5 Events on the way (EV1–EV3, EV7)

- **Encounter tables** (EV2): the `encounters` format extended to `{ what?, count?, weight?, text?, kind?, terrain?, narrated? }`:
  - `what` a stat block (or a figure group as `place_figures` takes), `text` what happens, `kind` one of travellers, creatures, hazard, weather, find;
  - `terrain` the materials it fits (any when absent), `narrated` for one told by the GM with no map;
  - set on regions, region maps and the world with `set_encounters` (MCP: a target, `{ regionId }`, `{ mapId }` or the world, and its rows), the world's as a fallback; places keep theirs as today.
- **Built-in fallbacks:** narrated events of each kind, plain enough for any world.
- **The roll** (EV7): after each leg, a roll seeded by the save and leg against `eventChance × material danger × region danger` at the camp, capped at 95%; the roll, chance and result recorded on the turn.
- **Choosing:** a weighted pick among the rows that fit the camp's terrain: the region's, then the map's, then the world's, then the built-ins.

### 4.6 Wilderness maps and playing an event (EV4, EV5, EV8)

- **The map** (EV5): a generic battle map tagged for the camp's terrain (`generic.terrain`), the world's own first; else a seeded wilderness map from a new `generate_map` kind, `wilds`, with a `terrain` and a `scene` (clearing, forest track, ford, ridge, marsh path, ruins), built from the same seed for the same event. It is kept on the save, not the world, unless a builder saves it.
- **Arriving** (EV4): at an entry of the map, the event's figures placed from their stat blocks as `place_figures` places them; the GM told the event's text. A narrated event has no map.
- **Play** is ordinary battle-map play.
- **Leaving** (EV8): by any edge or exit, back to the journey: go on, turn back or change course.

### 4.7 The map in play (TR5)

- **The preview** runs the planner in the page: the path drawn on the region map, its distance, days, terrain crossed and a wildness rating from its average danger, beside the route option if there is one.
- **The journey** on the map: the path, each camp, and the save's position in the wilds.
- **Setting out:** a point on the map, or a place, with "Travel across country".

### 4.8 Grading (X1)

This epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.3), by the rule in its §4.6:

- **Region:** a danger level set; an encounter table with rows that fit its terrain.
- **World (bonus):** a generic battle map for each terrain on its land.

---

## 5. Exit criterion

A player sets out cross-country on a region map below the top, sees the preview, camps, fails a navigation roll once and loses time, is stopped by an event in a painted forest played on a generated wilderness map with stat-block figures, and goes on. They travel by road to a closed town, arrive outside its gates and can't enter, then set off cross-country from there. Both built-in systems play it.

---

## 6. Sub-issues (filed 2026-11-14)

| ID           | Story                                                                                                                              | Depends on   | Model  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-361 (#835) | **Terrain speed and danger, and the planner:** materials' `wild` defaults, `set_wilds`, region danger, the shared `wild-paths.js`  | —            | Opus   |
| L-362 (#836) | **The wilds module:** its settings in both built-ins, world overrides and off, the navigation check                                | —            | Sonnet |
| L-363 (#837) | **Journeys across country:** the `travel` action off-road, day legs and camps, in the wilds, closed places from outside, discovery | L-361, L-362 | Opus   |
| L-364 (#838) | **Events on the way:** the extended encounters, built-in fallbacks, the seeded roll on the turn, choosing an event                 | L-363        | Sonnet |
| L-365 (#839) | **Wilderness maps:** `generate_map` kind `wilds` by terrain and scene                                                              | —            | Opus   |
| L-366 (#840) | **Playing an event:** choosing the map, arriving with figures, the GM told, leaving back to the journey                            | L-364, L-365 | Sonnet |
| L-367 (#841) | **The map:** the preview, the journey line and camps, the position in the wilds, setting out                                       | L-363        | Sonnet |
| L-368 (#842) | **Grading:** region danger and encounter tables; generic maps per terrain as a bonus                                               | L-361, L-364 | Sonnet |

**Order:** L-361, L-362 and L-365 can start at once. L-363 follows L-361 and L-362; L-364 and L-367 follow L-363; L-366 follows L-364 and L-365; L-368 follows L-361 and L-364.
