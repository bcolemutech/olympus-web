# The Loom — Maps Drawn From Their Data — Design Document v0.1

**Status:** Decided (2026-10-28). The gap sheet (§3) is answered. Sub-issues filed 2026-10-28 (#725–#733, §6).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-920 (#710), Phase 10 — Levels and Vehicles (milestone #26). From idea #709.
**Built:** right after L-900 (map levels to any depth) and before L-710 (worlds without Azgaar), so L-710's regions and terrain use this geometry from the start.
**Depends on:** L-900 (one model for every map), L-830 (action points), L-815 (effects, areas, hazards), L-720 (the map engine).
**Related:** [`map-levels.md`](./map-levels.md), [`worlds-without-azgaar.md`](./worlds-without-azgaar.md), [`action-points.md`](./action-points.md), [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md), [`the-image-studio.md`](./the-image-studio.md)

---

## 1. Purpose

Every map is **drawn from its data**, and the data is precise enough to play on: walls, doors and windows anywhere (not only on grid lines), floors and terrain, objects you can click, hidden things, heights, light, spawn points, named zones and notes for the GM.

Today's art has character but shows things that look interactive and aren't, and walls are hard to line up with it; plain SVG is precise but has no character (the user's note, #709). So the look comes from **materials**: every floor, wall, door and window has a material, and the engine draws it with that material's art, seen from above. Objects carry their own art. Whole-map art stays possible as an option, with objects always drawn on top.

---

## 2. What there is today

- **Battle maps** (`functions/loom-canon/layers.js`, shared with the page): walls are lines along grid lines between integer corners; doors are one square long on a grid line; obstacles are rectangles of squares (solid, low, difficult); features are named squares. Art is an image (or SVG) drawn under the grid (L-724).
- **Movement and AP** count squares: 1 AP a square, diagonals the same, difficult ground 2 (L-832); paths in the shared `grid-paths.js`. Paths are often blocked where the grid leaves no square to step through.
- **Sight** is worked out on the grid against wall lines (L-630); **areas** catch squares whose centre is inside (L-815).
- **Towns** draw their art or their ground polygons (L-650). **The world map** draws its art; Azgaar worlds came from exports holding cells, biomes, coasts, rivers, burgs and routes.
- **L-900** (designed) makes every map a region, area or grid map at any depth.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-28) and four follow-ups (AP for moving, sizes, object art, distances). Notes from the user are marked.

### The look

| ID      | Question                | Decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **RD1** | The map's picture       | **Drawn from data, with art per feature, not one image** (the user's note): wall segments drawn as top-down walls, floors as floors. Everything drawn has a **material**. **A fixed set of built-in materials** for floors, walls, doors and windows, assignable over MCP; new materials can't be added over MCP. Their art is **embedded in the engine** (in the repo), not referenced from the library |
| **RD2** | Generated whole-map art | **No.** The studio may be used during the build to make the materials' and objects' art, which is then embedded (the user's note)                                                                                                                                                                                                                                                                        |
| **RD3** | Interactive things      | **Always drawn by the engine on top.** **Objects** are configurable (the user's note): a container (with an inventory, once L-770 lands), locked and what unlocks it (a key or an action), movable (later), a description, studio art for its card and notes, and **its own art** (a transparent PNG). Objects can be as varied as walls, floors, doors and windows                                      |
| **OB1** | Object art (follow-up)  | **A built-in catalog** of common objects (chests, tables, barrels, crates, beds, altars…) with embedded art, **plus a world's own art** from the studio, a transparent PNG assigned over MCP. **No art at all: a box with a question mark**                                                                                                                                                              |
| **RD4** | Style                   | **The material of every line drawn carries the look** (the user's note). No style packs that constrain a world; the world's accent may tint                                                                                                                                                                                                                                                              |

### Geometry, movement and sight

| ID      | Question                  | Decision                                                                                                                                                                                                                                   |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GE1** | Precision                 | **Free geometry in map units:** walls, doors and windows as lines anywhere, rooms and areas as polygons, objects with a position, size and turn                                                                                            |
| **GE2** | Movement                  | **Free movement** (the user's note): waypoints on a grid-like structure, but **a gap smaller than a square is passable if it's wide enough for the character.** Today's design is plagued by blocked paths                                 |
| **MV1** | AP for moving (follow-up) | **1 AP per 5 ft of the path, rounded up per move.** Paths are planned on a fine hidden grid (a quarter square), so **the preview and the cost always match what the server charges**                                                       |
| **SZ1** | Sizes (follow-up)         | **Built-in size classes:** tiny, small, medium, large, huge, gargantuan, each with a width (medium 2.5 ft). A gap lets you through if you're no wider than it. A system can rename them; sheets and stat blocks set one, medium by default |
| **DS1** | Distances (follow-up)     | **Reach, ranges and areas in feet,** a square of today being 5 ft, drawn as true shapes. A square grid can still be shown as an overlay                                                                                                    |
| **GE3** | Sight                     | **Precise line of sight against the real lines and shapes,** with soft fog. **Some walls, doors and windows are see-through but not passable** (the user's note): a gate, a glass door, a window                                           |
| **GE4** | Levels                    | **One geometry for every level** (L-900): coasts, rivers, terrain and roads on region maps; streets, footprints and districts on area maps; rooms, walls and furniture on grids                                                            |

### What map data holds

| ID       | Question                       | Decision                                                                                                                                                                                                                                                             |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DA1**  | Contents                       | **All of:** ground and terrain (floor kinds, water and depth, movement costs); walls, doors and windows with materials and heights; objects with their actions; hidden things; heights; light; spawn points; named zones; notes for the GM (sounds, smells, writing) |
| **DA1b** | Generic maps (the user's note) | **The GM may place different NPCs on generic maps for random encounters;** generic maps use generic features (spawn areas, unnamed zones) so they stay reusable                                                                                                      |
| **DA2**  | Height                         | **Heights as data:** floor height per area, height per wall and object; sight over low walls, high ground, falls, climbing; the GM is told; drawn as shading                                                                                                         |
| **DA3**  | Hidden things                  | **Built here:** hidden in the data, found per save by noticing (a passive check) or a Search action; traps use L-815's hazards                                                                                                                                       |
| **DA4**  | Spawn points                   | **Named points or areas where figures appear,** with what and how many: encounters, broken rests, L-360's events                                                                                                                                                     |

### Today's maps, building, and the plan

| ID      | Question                  | Decision                                                                                                                                                                                                                                                     |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EX1** | Azgaar worlds             | **Converted into map data** (coasts, rivers, biomes as terrain, burgs, routes) and drawn                                                                                                                                                                     |
| **EX2** | Maps with art             | **Battle-map art stays an option,** image or SVG (the user's note): nothing breaks, and rich environments stay possible. **A map with art doesn't draw its floors and walls,** but always draws its objects: with their art, or the box with a question mark |
| **EX3** | Towns                     | **Drawn from their ground;** towns with only art keep it                                                                                                                                                                                                     |
| **AU1** | Who builds                | **Claude over MCP,** with tools for rooms, walls, doors, windows, objects, heights, zones and spawns; `view_image` draws the data to check it                                                                                                                |
| **AU2** | Generators                | **Yes:** rooms and corridors, caves, building interiors, ship decks; seeded                                                                                                                                                                                  |
| **AU3** | From existing art         | **Trace an image into data, or keep the image and make its walls and doors precise** (the user's note)                                                                                                                                                       |
| **PL1** | Where                     | **Its own epic in Phase 10 (L-920),** after L-900 and before L-710                                                                                                                                                                                           |
| **PL2** | Grading                   | **A map's data is enough to draw it** (floors and walls, or coasts and terrain)                                                                                                                                                                              |
| **PL3** | Exit criterion            | **Kept** (§5)                                                                                                                                                                                                                                                |
| **PL4** | Worries (the user's note) | **Paths and AP must stay exact** off the grid (MV1's fine grid and one shared path module answer it); **drawing takes time,** so loading shows progress and the screen never looks frozen (§4.6)                                                             |

---

## 4. Design

### 4.1 The geometry (GE1, GE4, DA1)

- **A map's shapes** (on L-900's maps, in map units; feet on grids):
  - `ground`: polygons with a material (stone, wood, grass, water…), a floor height, a movement cost, and water depth where it's water;
  - `walls`: polylines with a material, a height and flags `blocksMove`, `blocksSight` (a glass wall or a gate blocks movement only, GE3);
  - `doors` and `windows`: segments in walls, with a material, a state (open, closed, locked), what unlocks them (a key item or an action), see-through or not;
  - `objects`: a position, size and turn, a kind (from the catalog or the world's own), its art, and its settings (§4.4);
  - `zones` (named polygons), `spawns` (points or areas, §4.5), `lights` (sources and dark areas), `notes` (for the GM), `hidden` (any of the above hidden until found).
- **Region and area maps** use the same vocabulary at their scale: coasts and terrain as ground, rivers and roads as lines, building footprints as shapes, districts as zones.
- **Shared and pure:** `map-geometry.js` (shapes, hits, checks), kept in `functions/loom-canon/` and `public/apps/loom/js/` with identical bytes, like `grid-paths.js`.
- **Compact shapes** (#735 gap 16): points as `[[x, y], …]` or SVG path data; circles and rectangles as shapes of their own.

### 4.2 Movement and AP (GE2, MV1, SZ1, DS1)

- **Sizes:** `sheet.size` (and on stat blocks), from the built-in classes and widths; a system may rename them (`words`).
- **Paths** are planned on a fine hidden grid (a quarter of a 5 ft square) over the geometry: a cell is open where the character's width fits clear of walls, objects and solid ground; a path may pass any gap at least as wide as the character.
- **AP:** the path's length, at 1 AP per 5 ft, rounded up for each move, times the ground's cost (difficult ground double, conditions' `costs`). The same module computes the preview in the page and the charge on the server, so they always agree (PL4).
- **Distances (DS1):** reach, ranges and L-815's areas are measured in feet and drawn as true shapes (a burst a circle, a cone a cone); the grid can still be drawn as an overlay.
- **Replaces** `grid-paths.js` and `layers.js`' grid rules; combat's reach, opportunity attacks, tactics and named characters' turns read distances.

### 4.3 Sight (GE3, DA2)

- **Line of sight** against the real lines and shapes; doors and windows by their state and flags; heights decide sight over low walls and from ledges.
- **Fog** stays soft (L-724), now shaped by the geometry.
- **High ground** and falls follow heights; the GM is told heights in sight.

### 4.4 Objects (RD3, OB1)

- **An object** is `{ id, kind, name, description, at, size, turn, art?, cardArt?, container?, locked?, unlocks?: { key | action }, movable? (later), hidden?, actions }`.
- **Containers** hold items once L-770 lands; until then, their contents are described.
- **Art:** the world's own (a transparent PNG from the studio, assigned over MCP), else the built-in catalog's, else **a box with a question mark**.
- **Click menu:** an object's actions (open, search, unlock, use) cost their AP (L-830).

### 4.5 Hidden things, spawns and generic maps (DA3, DA4, DA1b)

- **Hidden things** are found per save by a passive check when in sight, or a Search action; once found, they're drawn and usable. Traps are L-815 hazards, hidden until found or triggered.
- **Spawns:** `{ id, name?, at (point or area), what (stat block or template), count }`, used by encounters, broken rests and L-360's events.
- **Generic maps** keep their spawns generic (areas, not named people), so the GM or an event can fill them with different figures each time (DA1b).

### 4.6 Drawing (RD1, RD2, RD4, EX2, PL4)

- **Materials:** a fixed, built-in set for floors, walls, doors and windows, each with embedded art (tiles and wall edges seen from above), made with the studio during the build and committed to the repo. MCP assigns them; it can't add new ones.
- **The object catalog's art** is embedded the same way.
- **The engine draws** ground, then walls, doors and windows, then objects, then light and shading by height, then fog; the world's accent may tint.
- **Maps with art (EX2)** draw their art in place of ground and walls, and still draw objects.
- **Loading (PL4):** a map shows a progress effect while its textures load and its shapes draw; drawing is cached per map revision; never a frozen screen.

### 4.7 Today's maps (EX1–EX3, AU3)

- **Battle maps:** walls, doors and obstacles convert to the geometry (grid lines become lines, obstacles become shapes); their art stays.
- **Towns** with ground are drawn from it.
- **Azgaar worlds** are converted from their saved exports: coasts and biomes into ground, rivers and routes into lines, burgs into places. With L-710's conversion of regions and terrain.
- **Tracing (AU3):** Claude can trace an image into data, or keep the image and make its walls and doors precise.

### 4.8 Tools and generators (AU1, AU2)

- **MCP tools:** `set_ground`, `set_walls`, `set_doors`, `set_windows`, `set_objects`, `set_zones`, `set_spawns`, `set_lights`, `set_hidden`, `list_materials`, `list_object_kinds`, `set_object_art`. Each patches shapes by id (features, entries and exits too), keeping what saves have seen and opened (#735 gap 17). `view_image` draws the data (with or without fog, heights shaded).
- **Generators,** seeded: rooms and corridors, caves, building interiors, ship decks. Claude calls one, then edits.

### 4.9 Grading (PL2)

**Map:** its data is enough to draw it (floors and walls on a grid; coasts and terrain on a region map; streets and footprints on an area map), or it has art.

---

## 5. Exit criterion

A dungeon built over MCP from data alone, with no image, draws with character from its materials; a wall runs at an angle off the old grid lines and hides what it should; a character slips through a gap narrower than a square; a secret door is found by searching; a ledge gives high ground; bandits appear at a spawn point. Nisia's world map is drawn from its converted Azgaar data.

---

## 6. Sub-issues (filed 2026-10-28)

| ID           | Story                                                                                                                                                                                        | Depends on   | Model  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-921 (#725) | **The geometry:** ground, walls, doors, windows, objects, zones, spawns, lights, notes, hidden; materials and flags; heights; `map-geometry.js` (both copies); on L-900's maps               | L-901        | Opus   |
| L-922 (#726) | **Moving and AP:** sizes; paths on the fine grid through gaps wide enough; 1 AP per 5 ft rounded up; preview equals charge; reach, ranges and areas in feet; combat and tactics on distances | L-921        | Opus   |
| L-923 (#727) | **Sight:** line of sight on the geometry, see-through flags, heights, high ground and falls, fog shaped by it                                                                                | L-921        | Opus   |
| L-924 (#728) | **Drawing:** materials and objects drawn from embedded art, heights shaded, light, fog; maps with art; loading progress and caching                                                          | L-921, L-925 | Opus   |
| L-925 (#729) | **Materials and the object catalog:** the built-in set and its art, made with the studio and committed; assigning over MCP; a world's own object art; the box with a question mark           | —            | Sonnet |
| L-926 (#730) | **Objects:** their settings, containers, locks and what unlocks them, descriptions and card art, their click-menu actions and costs                                                          | L-921        | Sonnet |
| L-927 (#731) | **Hidden things and spawns:** noticing and Search, traps as hidden hazards, spawn points, generic maps' spawns filled by the GM or an event                                                  | L-923        | Sonnet |
| L-928 (#732) | **Today's maps:** battle-map layers converted, towns drawn from ground, Azgaar exports converted to region data, art kept; tracing                                                           | L-921        | Opus   |
| L-929 (#733) | **Tools and generators:** the MCP tools, `view_image` of the data, seeded generators (rooms and corridors, caves, interiors, decks); the grading criterion                                   | L-921        | Sonnet |

**Order:** L-921 and L-925 first. L-922, L-923, L-926, L-928 and L-929 follow L-921; L-924 follows L-925; L-927 follows L-923.

Tests: the `map-geometry.js` copies match; pure tests for gaps by size, AP by distance (preview against charge), sight through glass and over low walls, in both built-in systems; a converted Nisia renders; headless Chrome for drawing, loading progress, a path through a narrow gap and the box with a question mark.
