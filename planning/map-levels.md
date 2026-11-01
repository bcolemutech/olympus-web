# The Loom — Map Levels to Any Depth — Design Document v0.1

**Status:** **Shipped** 2026-11-01 (L-901 to L-906, #719–#724). Decided 2026-10-16; the gap sheet (§3) is answered; sub-issues filed 2026-10-28 (§6). As built: L-901 the model shipped (2026-11-01; `functions/loom-canon/levels.js`): additive, beside today's shapes. Places in the new shape share `places` with today's town places (they have a `mapId`; town places a `locationId`) until L-902 migrates them; `save.at` is accepted and checked, and nothing that plays reads the model until L-903. L-902 the migration built (2026-11-01; `functions/cartographer/migrate-levels.js`, the Migrate Map Levels workflow). Decided with the user 2026-11-01: worlds only, no saves (none were left), and the old fields stay until L-903 plays from the new model. As built: the top map is `map_world`, towns `map_town_<locationId>`, grids keep their battle map's id; a battle map reached only by an exit (a floor below) sits under that exit's place; places with no settlement load as `world.mapPlaces`, apart from today's town places. The replay runs scripted actions through ADJUDICATE before and after (no recorded turns were left). Applied to Nisia and The Border March 2026-11-01. L-903 rules at any depth shipped (2026-11-01; `functions/loom-canon/frames.js`, `functions/loom-turn/depth.js`). Decided with the user 2026-11-01: **frames** (today's rules run on the world seen from the lowest region map on the save's path: its places as locations, the area maps under them as towns, grids as battle maps; their moves written back as `save.at`), **every world plays from the model** (a world with no top map gets the migration's plan in memory, `functions/loom-canon/level-plan.js`), and **a region map is entered by its way in** (a place on it with `entrance`, the one facing where the traveller came from; left by one too). As built: `save.at` is where a save stands, its frame's fields (`location`, `placeId`, `townPoint`, `mapId`, `cell`) kept beside it for the frame; `discovered`, `visited` and `waysKnown` stay flat lists by place (place ids are the world's); places in the new shape with no doc of today's shape open when written (MP6), a place opening a region map only when that map has a way in; `timeRules(world, map)` takes route kinds with speeds (`routeKinds: { kind: { speed, roundTheClock } }`) and `travelDayHours` from the region map, then `world.rules.time`, then the defaults, and a region map below the top measured in a unit that isn't a length (light-years, AU) is travelled in that unit; between parents, only to places discovered, through open ones, crossing each region map along its links. L-904 the Loom at any depth shipped (2026-11-01; `public/apps/loom/js/map.js`): the drawers were already chosen by kind through the frame (the region map stood on in `world.js`, its town in `town.js`, its grid in `battle.js`); the trail replaces the level switcher bottom left, each map from the top down with the current one last, a click on the frame's region map, town or grid showing that level and on a region map above peeking at it (`loomGetMap`'s `peek`, that map from the place on it the save's path goes through; the trail's entries carry that place); Back to you returns; moving onto another region map, or peeking and coming back, zooms out of or into the place that opens the deeper map; on a phone the trail shows the current map and its parent, the rest behind "…". L-905 tools and grading shipped (2026-11-01; `functions/mcp/apps/cartographer/level-tools.js`): `add_map`, `get_map`, `list_maps`, `add_places`, `add_exit` (two-way in one call; between places on any maps with their time, or grid to grid as stairs) and `set_grid`, `set_area_ground`; `add_place` takes a `mapId` and `connect_places` links places on any map. As built: the new tools write only the new shape and today's tools keep writing today's (their descriptions name them shortcuts), and every reader sees one model, what's stored over the plan of today's shape (`level-plan.js` `modelOf`), so a shortcut's change shows up through the new tools; a grid's layers live in its battle map of the same id, so today's grid tools (layers, hazards, figures with cell "auto", `view_image`) work at any depth; under a place in today's shape only a grid can be added (its battle map); a second map under one place sits beside the first, reached by exits; `create_world` makes its top region map, `map_world`. Grading per §4.8 (`gradeMaps`), the work list's closed maps, and the Cartographer page's tree. L-906 templates shipped (2026-11-01; `functions/loom-canon/templates.js`). Decided with the user 2026-11-01: the world criterion (`world.templates`) weighs 10, and a region map of 25 places or more is large; fill tables are named slots (`fill: { shop: [...] }` on a template's place, {shop} in its text; {place} and {placeDescription} the using place's). As built: each place using a template plays its own instance of it, made as the world loads for play, the template's maps and places copied with ids ending `__<placeId>` and filled, so doors, fog, discovered places and taken items are kept per place by the rules as they are (two moons from one template never share a door); a template is made with `add_map` (`template: true`, no parent) and assigned with `assign_template` (by ids, or every place of a kind on a map that opens no map of its own); a templated place passes the gate, scores on its own criteria only, and its instance stays out of the tree of maps; `list_maps` lists templates with how many places use each.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-900 (#625), milestone #26 (Phase 10 — Levels and Vehicles)
**Built:** just before L-710 (worlds without Azgaar), which then builds on it (the roadmap's Build order).
**Depends on:** L-720 (the map engine), L-370 (game time, `timeRules`).
**Related:** [`scenarios.md`](./scenarios.md) (G1, G9), [`vehicles.md`](./vehicles.md) (L-910), [`worlds-without-azgaar.md`](./worlds-without-azgaar.md), [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

The Loom has three fixed levels: the world map, towns and battle maps. The reference games need more: a dungeon's floors, an airship's decks, and for the space game **galaxy → sector → star system → orbit → surface → town → ground**.

This epic replaces the three fixed levels with **maps inside maps, to any depth**. Every map is one of three kinds, every place sits on one map and may open into a map below, and the rules, the build gate, the zoom and the tools work the same at every depth. Ordinary places can use **templates**, so a galaxy can be explored without building every star system by hand.

---

## 2. What there is today

- **Three shapes in canon** (`loom_worlds/{worldId}/…`):
  - **`locations`**: the world map's settlements and points of interest, with `geo.x`, `geo.y` in map units and `geo.links` (route kinds) to each other.
  - **A settlement's town:** places on a 0–1000 square with `connections`, `entrance` and a `position`; a real `size` in metres (L-651); optional ground walked as a grid (L-650).
  - **`battleMaps`**: grids (at most 64 each way) with walls, doors, obstacles, features, `entries` and `exits`. An exit can already lead to another map (`{ map, entry }`, L-351), which is how floors work. A map can be `generic: { kind, terrain }` and shared by any number of places.
- **A save stands at** `location`, `placeId`, `townPoint` (on a town's street), `mapId` and `cell`. It keeps `discovered` (location ids), `doors` by map, and what it has `seen` per battle map (`loom_saves/{saveId}/seen/{mapId}`).
- **Time:** `timeRules(world)` (L-371) holds turn lengths (6 s on a battle map, 5 min elsewhere), the travel day and route speeds. Routes are miles from the map's scale × 1.25 (L-372).
- **The Loom:** the engine (L-722) draws three layers, world, town and battle (L-723, L-724), with a zoom between them, a level switcher, peeking and a minimap (L-725).
- **The gate:** a place below Playable is closed; the work list asks for what it lacks (layered worlds §5).

---

## 3. Gap sheet

The outline was decided with the reference games ([`scenarios.md`](./scenarios.md) §4, LV1–LV6, SC1). The details were settled through a questionnaire (2026-10-16); every answer took the recommendation.

### The model

| ID      | Question              | Decision                                                                                                                                                                                             |
| ------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LV1** | How levels work       | **Any map can hold places that open into a map below, to any depth.** World, town and battle map become kinds of map, not levels                                                                     |
| **LV2** | Kinds of map          | **Region** (places and routes), **area** (places and paths, or ground) and **grid**                                                                                                                  |
| **MP1** | Storage               | **One shape for all:** a world's maps, each with its kind, its parent (a place on the map above) and its space; and places, each on one map. Locations, town places and battle maps all move into it |
| **MP2** | Where a save stands   | **A path from the top down:** each map you're inside, and where you are on the last one (a place, a point or a square). It replaces `location`, `placeId`, `townPoint`, `mapId` and `cell`           |
| **MP3** | Moving today's worlds | **A one-time migration** (dry run, then apply); the code reads only the new model after it. A test plays the same turns before and after                                                             |
| **MP4** | The top of a world    | **Any region map:** a continent, a planet or a galaxy. One world holds the whole space game                                                                                                          |
| **MP5** | What sits inside what | **Any kind inside any kind**                                                                                                                                                                         |
| **MP6** | A place with no map   | **You can still go there and stand at it;** the narrator covers it, as points of interest without a map do today                                                                                     |

### Travel and time

| ID      | Question                  | Decision                                                                                                                                        |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **TV1** | Units and travel          | **Each region map sets its unit** (miles, kilometres, light-years, AU) **and its route kinds with speeds.** `timeRules` reads the map you're on |
| **TV2** | Between different parents | **Climb to the lowest map that holds both, travel there, and descend.** Each stage takes its own map's time                                     |
| **TV3** | Direct links across maps  | **Yes, as exits:** a place or square can lead to a place on any other map, with the time it takes set on the exit (portals, jump gates, stairs) |
| **TV4** | Turn lengths              | **By kind, through `timeRules`:** grids 6 s a turn, area maps 5 min, region maps travel only                                                    |

### Templates (G9)

| ID      | Question             | Decision                                                                                                                                                                                  |
| ------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SC1** | Content at scale     | **Ordinary places use a template of their kind and open at once; Claude builds the notable ones**                                                                                         |
| **TM1** | What a template is   | **A map (with its places) marked as a template, shared read-only** by every place that uses it, its names and details filled in from the place. Each save keeps its own changes per place |
| **TM2** | Which places use one | **A place names its template, set by Claude in bulk over MCP**                                                                                                                            |
| **TM3** | Grading              | **A templated place counts as Playable;** only its own built content raises it to Rich, Vivid or Legendary                                                                                |
| **TM4** | Variety              | **Seeded rolls from tables** fill a template's places, so each use differs but stays the same for that place                                                                              |

### The Loom and the tools

| ID      | Question              | Decision                                                                                                                         |
| ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **LV5** | Moving between levels | **The same zoom at any depth**                                                                                                   |
| **UI1** | Where you are         | **A trail replaces the level switcher:** each map above you, click to peek at it ("Andor sector › Vega › Vega III › Port Ellis") |
| **UI2** | Drawing               | **Three drawers (region, area, grid), used at any depth;** today's world, town and battle layers become them                     |
| **UI3** | MCP tools             | **New general tools taking a map;** today's tools stay as shortcuts for a while                                                  |
| **UI4** | The Cartographer page | **A world's maps as a tree, each with its grade**                                                                                |
| **LV4** | The gate              | **As today, at every depth:** a place opens when its map is built enough; the work list and grading cover every level            |
| **PL1** | When                  | **Its own epic, just before L-710.** L-710's stories are revised to use maps and places                                          |
| **PL3** | Exit criterion        | **Kept** (§5)                                                                                                                    |

---

## 4. Design

### 4.1 Maps and places

- **`loom_worlds/{worldId}/maps/{mapId}`:**
  - `kind`: `region`, `area` or `grid`;
  - `parent`: `{ mapId, placeId }`, or null for the world's top map (`world.topMapId`);
  - `name`, `image` (a library image, L-704), `space`:
    - region: `{ width, height, distance: { unit, perUnit } }` and `routeKinds` (TV1);
    - area: `{ width, height, size }` (metres across, as `town.size`), and optional ground;
    - grid: `{ width, height, squareSize }`, walls, doors, obstacles, features, entries;
  - `template`: true for a template map (§4.6); `generic` as today for grids;
  - `revision`, `sources`, `retired`.
- **`loom_worlds/{worldId}/places/{placeId}`:**
  - `mapId` (the map it sits on) and where on it: `{ x, y }` (region, area) or a square (grid features become places on their grid);
  - `name`, `kind`, `description`, and what it already carries today (population, NPCs, rules, art);
  - `opens`: the map below it, if any (`{ mapId }` or `{ template: mapId }`, §4.6);
  - `links`: routes (region maps: `{ placeId, kind, waypoints? }`) or paths (area maps: connections, entrances);
  - `exits`: links to places on other maps (TV3): `{ placeId, seconds, name }`.
- **Characters, lore, regions and factions** keep their collections. A character's home and place point at a `placeId`; regions and terrain (L-710) belong to a region map.
- **Pure helpers** (`functions/loom-canon/levels.js`): a place's map, a map's parent chain, the path to a place, the lowest map that holds two places (TV2), and the children of a map.

### 4.2 Where a save stands (MP2)

- **`save.at`:** `[{ mapId, placeId }…]` from the top map down, ending with where you are on the last map: `{ mapId, placeId }`, `{ mapId, point: { x, y } }` (on a street, or in the wilds for L-360) or `{ mapId, cell: { x, y } }`.
- **Per map, as today:** `discovered` becomes `{ [mapId]: [placeId…] }`; `doors` and `seen` stay keyed by map.
- **Validation** checks every step of the path against canon.

### 4.3 Moving

- **On one map:** travel along routes (region; L-373's time), walks along paths or ground (area; L-660), steps on a grid (L-611). Each is today's rule, keyed by map kind instead of level.
- **Down:** enter a place that opens a map, arriving at its entry (or the place's entrance). **Up:** leave by an exit marked out, or a way out of an area map, arriving at the parent place.
- **Between different parents (TV2):** the move climbs to the lowest common map, travels across it, and descends. Each stage takes its own map's time; the arrival line names the whole journey.
- **Exits (TV3):** a place or square can lead to a place on any map, taking the exit's time. Today's battle-map exits to other maps become these.
- **The gate (LV4):** a place below Playable is closed at any depth. A place with no map below (MP6) can be visited and stood at; the narrator covers it.
- **Time (TV1, TV4):** `timeRules(world, map)`: turn length by map kind (grid 6 s, area 5 min), and units, route kinds and speeds from the region map you travel on (falling back to the world's, then the defaults).

### 4.4 Migration (MP3)

A dry-run-then-apply workflow, like the earlier backfills:

- The world map becomes the top **region** map; each **location** becomes a place on it, keeping its id, position and links.
- Each **town** becomes an **area** map under its settlement place; town places become places on it (positions, connections, entrances, ground kept).
- Each **battle map** becomes a **grid** map under the place that had it; generic battle maps stay shared; exits to other maps become exits (§4.3).
- **Saves:** `location`, `placeId`, `townPoint`, `mapId` and `cell` become `save.at`; `discovered` is keyed by the world's top map; `doors` and `seen` are unchanged.
- **Checked:** a replay of recorded Nisia turns gives the same positions, times and refusals before and after. The old fields are removed once the replay passes.

### 4.5 The Loom (LV5, UI1, UI2)

- **The engine** keeps three drawers, region (today's world layer), area (town) and grid (battle), chosen by the map's kind, at any depth.
- **The zoom** goes into a place's map and back out at any depth; peeking works up and down.
- **The trail** replaces the level switcher (bottom left): each map above you, the current one last; clicking one peeks at it, and Back to you returns.
- **`loomGetMap`** returns the map the save stands on (or is peeking at), its places and links, the trail, and `travel` for routes out (L-373).

### 4.6 Templates (G9)

- **A template** is a map marked `template: true`, with its places, built like any map (a "barren moon", a "gas giant system", a "hamlet").
- **A place uses one** with `opens: { template: mapId }`, set in bulk by `assign_template` (TM2). The place's name and description fill the template's (`{place}` in its text).
- **Variety (TM4):** a template's places can carry fill tables (which shop, which hazard, which crew); each use rolls them, seeded by the place, so a given place is always the same.
- **Per save:** doors, fog, discovered places and taken items are kept per save and per place, as generic battle maps keep them today.
- **The gate and grading (TM3):** a templated place counts as Playable; Rich, Vivid and Legendary need its own content.

### 4.7 Tools (UI3, UI4)

- **New MCP tools:** `add_map` (kind, parent place, space), `get_map`, `list_maps` (the tree), `add_place` / `add_places` (on a map), `connect_places`, `add_exit` (both directions in one call, `twoWay`, naming a map or place made in the same call; #735 gap 9), `set_grid` (walls, doors and features of a grid), `set_area_ground`, `assign_template`.
- **Shortcuts:** today's tools (`add_location`, `add_place`, `set_battle_map`, `connect_locations`…) keep working for a while, mapping onto the new ones, and say so in their descriptions.
- **The work list** and **`cartographerCompletion`** cover every map.
- **The Cartographer page** shows a world's maps as a tree, each with its grade and what it lacks.

### 4.8 Grading

This epic adds layers of content, so it adds to the rubric ([`the-loom-grading.md`](./the-loom-grading.md) §4.6):

- **Every map is graded by its kind** with today's criteria (region maps as the world map, area maps as towns, grids as battle maps). A world's score rolls up its tree, weighted toward the maps players reach.
- **Templates (TM3):** a templated place counts as Playable and adds no more.
- **World:** templates assigned to the ordinary places of a large map (so none is closed for want of work).

---

## 5. Exit criterion

Nisia is migrated and plays as before: the same trips take the same time, towns and battle maps work, and saves resume where they were. A test star system, three maps deep under a sector map, is played from the sector map down to a square on a station's deck, with the trail showing each map above, and back out again; an ordinary moon in it opens from a template.

---

## 6. Sub-issues (filed 2026-10-28)

| ID           | Story                                                                                                                                                                  | Depends on   | Model  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-901 (#719) | **The model:** `maps` and `places`, kinds and spaces, parents and exits, `world.topMapId`; `levels.js` helpers; `loadWorld` gives the tree; `save.at` and its checks   | —            | Opus   |
| L-902 (#720) | **The migration:** locations, towns, town places and battle maps into maps and places; saves into `save.at`; the replay test; dry run, then apply; old fields removed  | L-901        | Opus   |
| L-903 (#721) | **Rules at any depth:** moves on each kind, up and down, between parents, through exits; the gate at every depth; `timeRules(world, map)`; `loomGetMap` with the trail | L-901        | Opus   |
| L-904 (#722) | **The Loom at any depth:** the three drawers by kind, the zoom and peeking at any depth, the trail in place of the level switcher                                      | L-903        | Sonnet |
| L-905 (#723) | **Tools and grading:** the new MCP tools, today's as shortcuts, the work list and completion over every map, the Cartographer page's tree, grading by map kind         | L-901        | Sonnet |
| L-906 (#724) | **Templates:** template maps, `assign_template`, filling from the place, seeded fill tables, per-save changes per place, the gate and grading                          | L-903, L-905 | Opus   |

**Order:** L-901 first. L-902, L-903 and L-905 follow it; L-902 must pass before the old fields go. L-904 follows L-903, and L-906 comes last.

**L-710** is revised when this ships: its stories use maps and places (`add_place` on the top region map, region and terrain layers on a region map, route kinds per map).

Tests: pure-module tests for the helpers and the path; the replay of recorded Nisia turns (L-902); pipeline tests for moves at depth, between parents and through exits; headless Chrome for the trail and the zoom; a real MCP client for the new tools.
