# The Loom — Maps Drawn From Their Data — Design Document v0.1

**Status:** Decided (2026-10-28). Revised 2026-11-03 after L-900 shipped (GE5, EX4), and 2026-11-05 (EX1 dropped: Nisia's Azgaar export was lost; §4.7, §5). The gap sheet (§3) is answered. Sub-issues filed 2026-10-28 (#725–#733, §6).
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

| ID      | Question                                         | Decision                                                                                                                                                                                                                                                                                   |
| ------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **GE1** | Precision                                        | **Free geometry in map units:** walls, doors and windows as lines anywhere, rooms and areas as polygons, objects with a position, size and turn                                                                                                                                            |
| **GE2** | Movement                                         | **Free movement** (the user's note): waypoints on a grid-like structure, but **a gap smaller than a square is passable if it's wide enough for the character.** Today's design is plagued by blocked paths                                                                                 |
| **MV1** | AP for moving (follow-up)                        | **1 AP per 5 ft of the path, rounded up per move.** Paths are planned on a fine hidden grid (a quarter square), so **the preview and the cost always match what the server charges**                                                                                                       |
| **SZ1** | Sizes (follow-up)                                | **Built-in size classes:** tiny, small, medium, large, huge, gargantuan, each with a width (medium 2.5 ft). A gap lets you through if you're no wider than it. A system can rename them; sheets and stat blocks set one, medium by default                                                 |
| **DS1** | Distances (follow-up)                            | **Reach, ranges and areas in feet,** a square of today being 5 ft, drawn as true shapes. A square grid can still be shown as an overlay                                                                                                                                                    |
| **GE3** | Sight                                            | **Precise line of sight against the real lines and shapes,** with soft fog. **Some walls, doors and windows are see-through but not passable** (the user's note): a gate, a glass door, a window                                                                                           |
| **GE4** | Levels                                           | **One geometry for every level** (L-900): coasts, rivers, terrain and roads on region maps; streets, footprints and districts on area maps; rooms, walls and furniture on grids                                                                                                            |
| **GE5** | Where it lives (2026-11-03, after L-900 shipped) | **A grid's geometry lives in its battle map document** (same id as the grid map), beside today's layers until L-928 converts them, so frames, figures, hazards, `cell: "auto"` and `view_image` keep finding everything in one place. Region and area maps keep theirs on the map document |

### What map data holds

| ID       | Question                       | Decision                                                                                                                                                                                                                                                             |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DA1**  | Contents                       | **All of:** ground and terrain (floor kinds, water and depth, movement costs); walls, doors and windows with materials and heights; objects with their actions; hidden things; heights; light; spawn points; named zones; notes for the GM (sounds, smells, writing) |
| **DA1b** | Generic maps (the user's note) | **The GM may place different NPCs on generic maps for random encounters;** generic maps use generic features (spawn areas, unnamed zones) so they stay reusable                                                                                                      |
| **DA2**  | Height                         | **Heights as data:** floor height per area, height per wall and object; sight over low walls, high ground, falls, climbing; the GM is told; drawn as shading                                                                                                         |
| **DA3**  | Hidden things                  | **Built here:** hidden in the data, found per save by noticing (a passive check) or a Search action; traps use L-815's hazards                                                                                                                                       |
| **DA4**  | Spawn points                   | **Named points or areas where figures appear,** with what and how many: encounters, broken rests, L-360's events                                                                                                                                                     |

### Today's maps, building, and the plan

| ID      | Question                     | Decision                                                                                                                                                                                                                                                     |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **EX1** | Azgaar worlds                | **Converted into map data** (coasts, rivers, biomes as terrain, burgs, routes) and drawn. **Dropped 2026-11-05** (the user): imports never kept their exports, and Nisia's is lost (§4.7)                                                                    |
| **EX2** | Maps with art                | **Battle-map art stays an option,** image or SVG (the user's note): nothing breaks, and rich environments stay possible. **A map with art doesn't draw its floors and walls,** but always draws its objects: with their art, or the box with a question mark |
| **EX3** | Towns                        | **Drawn from their ground;** towns with only art keep it                                                                                                                                                                                                     |
| **EX4** | Old grid layers (2026-11-03) | **Converted, then dropped:** a dry-run-then-apply workflow like L-902's converts every battle map; once a replay of scripted fights gives the same paths, sight and costs, the code reads only the geometry and today's layers go                            |
| **AU1** | Who builds                   | **Claude over MCP,** with tools for rooms, walls, doors, windows, objects, heights, zones and spawns; `view_image` draws the data to check it                                                                                                                |
| **AU2** | Generators                   | **Yes:** rooms and corridors, caves, building interiors, ship decks; seeded                                                                                                                                                                                  |
| **AU3** | From existing art            | **Trace an image into data, or keep the image and make its walls and doors precise** (the user's note)                                                                                                                                                       |
| **PL1** | Where                        | **Its own epic in Phase 10 (L-920),** after L-900 and before L-710                                                                                                                                                                                           |
| **PL2** | Grading                      | **A map's data is enough to draw it** (floors and walls, or coasts and terrain)                                                                                                                                                                              |
| **PL3** | Exit criterion               | **Kept** (§5)                                                                                                                                                                                                                                                |
| **PL4** | Worries (the user's note)    | **Paths and AP must stay exact** off the grid (MV1's fine grid and one shared path module answer it); **drawing takes time,** so loading shows progress and the screen never looks frozen (§4.6)                                                             |

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
- **Where it lives (GE5):** a grid's shapes in its battle map document (the same id as its grid map, where L-905 keeps its layers); a region or area map's on its map document. The rules read them through L-903's frames.
- **As stored (L-921, 2026-11-03):** the lists sit under one `geometry` field (so today's `walls`, `doors` and an area map's `ground` stay as they are beside it), read with `frames.geometryOf`. Firestore keeps no arrays of arrays, so `normalize` stores each list of points as SVG path data (also the most compact); points elsewhere are `[x, y]`. Items without ids get them (`wall-3`). Doors and windows replace the wall where they stand. The material names are in `materials.js` (L-925), which `map-geometry.js` reads.
- **Materials, objects and their art (L-925, 2026-11-03):**
  - One list, `functions/loom-canon/materials.js` (and the page's copy, `Loom.materials`): each material has a kind (ground, line, wall, door, window), an id, a name and its art; each catalog object has an id, a name, a group, a default size in feet and its art. The set is fixed.
  - **The built-in art is drawn by `scripts/build-art.js` as SVG, not made with the studio** (departing from RD2's "may be used during the build", which was an option, not a rule): the studio spends money and its pictures need review one at a time, while the script is free, repeatable and reviewable as code. Tiles are 64 × 64 and repeat; walls, doors, windows and lines are 64 × 16 strips drawn along their length; an object's picture is its size at 16 units to the foot. Any file under `public/apps/loom/art/` can be replaced by studio-made art under the same name, and nothing else reads how it was made.
  - A world's own art for an object is a library image of kind `object`. `world.objectKinds[kind]` holds `{ art?, name?, size? }` for a catalog kind or a kind of the world's own; one object's art is its `art` in its map's geometry. The studio's assigner has `objectKind` and `object` targets (the id of the second is `<mapId>/<objectId>`), so "in use" stays right. An object is drawn with its own art, else its kind's in the world, else the catalog's, else a box with a question mark (`artFor`).
- **Shared and pure:** `map-geometry.js` (shapes, hits, checks), kept in `functions/loom-canon/` and `public/apps/loom/js/` with identical bytes, like `map-paths.js` and `town-paths.js`.
- **Compact shapes** (#735 gap 16): points as `[[x, y], …]` or SVG path data; circles and rectangles as shapes of their own.
- **Moving off the grid (L-922, 2026-11-03):**
  - **Two PRs** (the user's choice, 2026-11-03): first moving (sizes, paths and AP in feet, a save's point, the walk, the page's preview), then distances (combat's reach, ranges and areas, opportunity attacks, tactics, named turns, wary triggers and `cell: "auto"` in feet; foes' moves; `grid-paths.js` retired).
  - **The planner**, `map-paths.js`: a fine grid at 1.25 ft, each point nudged up to half a step to where the character fits, plus a point in the middle of every narrow gap and a ring round every corner; searched at any angle (Theta\*), then pulled straight by the cheapest way through its own points. Shortest paths come within 1% of the true ones.
  - **Old layers are read as geometry** in memory (`map-geometry.js` `fromLayers`: each door in a short wall of its own, solid and low obstacles as closed walls, difficult squares as ground costing 2), beside a map's own geometry, its items winning on an id. L-928 stores it.
  - **Rules settled in building:** a walk that runs out of AP inside the square it was going to has arrived; a closed door on the way is opened from the first point within 5 ft of it (beside it, as before); walking up to someone already beside you is refused, as before.
  - **The preview is the charge by construction:** the server plans a move on the map as far as the save has seen it (`functions/loom-turn/known-map.js`, which the grid view is sent) with the view's prices, through the same `viewPlanner` and `moveTo` the page runs. Hidden things are left out of it, so a hidden door leaves its wall whole.
  - **A save stands at a point** in feet: `gridPoint` beside `cell` (only while it lies in `cell`; a square set on its own reads as its centre), and a grid step of `at` is `{ mapId, point }`.
  - **Distances, as built (part 2, 2026-11-04):**
    - **Measured between people, edge to edge** (`map-paths.js` `spotOf`, `gapBetween`, `bandOf`): each at their point (a square read as its centre) and their width. An attack's reach and ranges stay written in squares and count as 5 ft each, so a reach of 1 touches anyone beside, a diagonal too, and a reach of 2 no longer reaches two squares diagonally (11.6 ft). The page measures the same way, and draws reach and range as rings.
    - **Areas are true shapes in feet** (`areas.js`): a burst or aura a circle, a cone 90° wide, a line 5 ft wide; a person is caught by where they stand (`areas.catches`), not by which squares the shape covers.
    - **Opportunity attacks** are checked at each station of a walk (every 1.25 ft), so leaving reach is noticed where it happens; a walk struck down stops at that station.
    - **Figures stand at points too:** `save.figures[id].point` beside `cell`, by the same rule as the save's. Foes and named characters plan on the same planner as the player (closed doors count as locked to them: they don't open doors), choose where to go by its costs, and their turns record their squares (`path`) and points (`points`) for the page to play out.
    - **Still by squares, for now:** line of effect and flanking, and an area's anchor square (cover moved to the geometry with L-923). A distance said to the GM or in a named turn's choices is in feet ("30 ft away", "move 15 ft and strike").
    - **`cell: "auto"`, the builders' reach checks and "an entry reaches an exit"** use `map-paths.js` `squaresReached` (a medium character, doors open unless locked), and place nearest in feet. `grid-paths.js` and `layers.js`' step rules (`canStep`, `pathOptions`, `reachable`) are gone; `layers.js` keeps what lies between squares, the ground and the checks.
    - **A turn's `moved`** is the feet walked, and End turn says "You moved 35 ft."
    - **A converted map plays the same:** a battle map whose layers are also stored as geometry (as L-928 will do) plays a scripted fight line for line as it did with layers alone.

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
- **Decided before building L-923 (the user, 2026-11-04):**
  - **Sight by eye level:** a wall or object hides what's beyond it when its top (the floor under it plus its `height`; none, full height) reaches the viewer's eyes: the floor they stand on plus their size's eyes (tiny 1 ft, small 2.5, medium 5, large 10, huge 20, gargantuan 30). Not a true 3D line to each target: faster, and enough for low walls and ledges.
  - **Ledges:** a rise of more than 2.5 ft can't be walked up (climbing comes later; stairs and ramps are ground with heights in steps); a drop of 10 ft or more can be walked off and is a fall; smaller drops are free.
  - **Rules as system data:** two combat settings, `highGround` (a formula added to an attack from at least 5 ft above the target) and `falls` (`{ per, damage, max }`), set in both built-ins (d20: +2, 1d6 per 10 ft up to 20d6; pool: +1, 1 per 10 ft up to 5); unset, they do nothing.
  - **Fog:** what's in sight and seen is worked out on the geometry but kept and sent by the square, as before; L-924 draws the fog to the exact sight lines.
- **As built (L-923, 2026-11-04):**
  - **`sight.js` on the geometry** (a map's own, with its layers read as geometry): the region seen from the eyes is cast to every end and crossing of what hides; a square is in sight when more than a line of it falls in that region, so nothing is seen through where two walls meet or along a line grazing a wall's end; a square something that hides stands in is in sight when its face there is seen. On old layered maps it agrees square for square with a plain ray caster on 80 random maps. Looks are kept per map; a fresh look on a 64 × 64 hall of 441 pillars takes about 7 ms in Node. `sight.sees` answers one square; `inSight` returns the kept squares, frozen.
  - **What hides:** walls (not glass, bars or a fence), doors not open and not see-through (a gate, a glass door), windows not see-through, and objects that hide (the catalog's tall ones, or their own `blocksSight`), each only where its top reaches the eyes. The ground never hides anything. Old solid obstacles read as tall objects (pillars), so they are seen themselves and hide what's behind; low ones stay 3 ft walls that hide nothing.
  - **Viewers look from where they stand:** the save's point and its sheet's size (`maps.viewerOf`), a figure's point and size.
  - **Cover from the geometry:** five lines from the attacker's eyes to points across the target's width; four or more stopped by something that hides, heavy; any stopped, or crossing something that stops movement but doesn't hide (a low wall, a table, glass or bars), partial.
  - **Falls** (`combat/falls.js`): the walk stops where a drop of 10 ft or more lands, ADJUDICATE rolls the system's damage and puts on Prone (at 0, down by the system's down kind), and NARRATE is told the fall. Foes never walk off a drop.
  - **The GM is told heights** when anyone in sight, or the player, stands off the floor ("Heights: the player stands 10 ft up; Grell is 10 ft below the player.").

### 4.4 Objects (RD3, OB1)

- **An object** is `{ id, kind, name, description, at, size, turn, art?, cardArt?, container?, locked?, unlocks?: { key | action }, movable? (later), hidden?, actions }`.
- **Containers** hold items once L-770 lands; until then, their contents are described.
- **Art:** the world's own (a transparent PNG from the studio, assigned over MCP), else the built-in catalog's, else **a box with a question mark**.
- **Click menu:** an object's actions (open, search, unlock, use) cost their AP (L-830).
- **Decided before building L-926 (the user, 2026-11-05):**
  - **Two PRs:** first the server (settings, state, actions through `loomPlayTurn`, "What's here?", the GM and INTERPRET told, wary triggers, what the page is sent), then the page (the click menu, the card, headless tests).
  - **Features and objects both stay.** Features remain named spots (decided 2026-11-04); objects are the richer thing over the geometry and share features' AP rules. A wary trigger's `featureTouched` may name either. Nothing is converted, so nothing becomes a "?" box.
  - **The card is on the click menu:** clicking an object opens the menu with its card across the top (card art, name, description, state) and its actions below, each at its AP cost. No new panel.
- **As built (L-926, first PR, server, 2026-11-05):**
  - **An object's settings**, checked with the rest of the geometry (`map-geometry.js` `check`, both copies):
    - `name`, `description` (600 letters), `cardArt` (a library image, as `art`);
    - `container` (`true`, or `{ contents?, search? }`: what it holds, described until L-770; `search` makes opening it a search, a bookshelf);
    - `locked` (needs a container), `unlocks` (`{ key?, action? }`: the item that opens it, or `action`, an object's id or `id.action` whose use unlocks it), `difficulty` (5–30), `ap` (its own cost), `long` (`{ ap }`, a long action: picking the lock over turns);
    - `actions` (up to 8 of `{ id, name?, ap?, long?, text? }`: its own, a lever's Pull; the ids `open`, `search`, `unlock`, `close` and `look` are its own).
    - An `unlocks.action` on a door or object must name an object with that action.
  - **The rules** are `functions/loom-canon/objects.js`, as `doors.js` is for doors: which objects there is something to do with, a name (its own, else "the" and its kind's), its state, the squares it covers (for reach and sight), what a proposed action is, what the menu offers, what using one unlocks, and what the page is sent.
  - **State per save**, `save.objects[mapId][id]` ('closed', 'open' or 'locked'), as `save.doors` is; a container starts 'closed', or 'locked' if it says so. Only containers keep state: a lever's use unlocks what names it and is not itself remembered.
  - **Actions** go through ADJUDICATE as `object:<id>` targets, reach and cost as any action on the map:
    - **Open or search** a closed container: it opens, and the GM is told what it holds, or that it is empty. An open one is a no-op.
    - **A locked container** is unlocked and opened by its key, for the price of handling an object. Without the key, **opening or searching it is refused**, spending nothing. **Unlocking it** (picking or forcing) rolls the system's lock check against its difficulty (15 if it has none); a success leaves it unlocked (closed), for the lock price, a long action where it says so. Opening it is then another action.
    - **One of its own actions:** its text (or "You pull the lever."), and each door or object that names it in `unlocks.action` and is still locked becomes unlocked; one in sight is named, any other "Somewhere nearby, a lock gives way."
    - **Costs:** `object` (5 in both built-ins) over the object's or action's own `ap`, `lock` for picking; the same in both systems' prices.
  - **The menu's action** is `{ verb: 'object', object, act }`, no model reading it; typed ones ("open the chest", "pick the lock", "pull the lever") reach the same rules through INTERPRET, which lists `object:<id>` among what the save has seen. A trigger on `featureTouched` fires for an object touched.
  - **"What's here?"** on an object (`{ verb: 'look', object }`, a typed look, or its square) gives its name, description and state, what it holds only once open, and what can be done with it; never its key or its lock's difficulty. NARRATE is told the objects in sight and their states.
  - **What the page is sent:** `battleMap.objects`, each seen object there is something to do with: `{ id, name, state?, description?, contents? (once open), actions: [{ id, name, cost?, long? }] }`, `cost` this character's price (none with AP off). Its geometry carries each object with its art and card art as links only, and **no key, lock difficulty, contents or action text**.
  - **A fix found on the way (L-928 part 2):** doors in the geometry went to the page whole, with the key that opens them, the lever that unlocks them and their lock's difficulty, which the page's view never carried before. Doors are now sent without them (`doors.js` `forPlayer`).
- **As built (L-926, second PR, the page, 2026-11-06):**
  - **A click on an object** opens the menu with its card across the top, in the grid view (`battle.js`; the menu is `engine.js` `openMenu`, which takes `{ title, subtitle, card?, items }`, `card` being `{ art?, text?, lines? }`):
    - **The card:** its picture, what it looks like (its description) and what is known of it, one line each: its state (Locked, Closed, Open, Searched), and, once it is open, what it holds. Never what it holds before, what unlocks it or how hard its lock is: the page was never sent them.
    - **The picture** is its `cardArt` when it has one, else the art it is drawn with on the map (its own `art`, the world's for its kind, the catalog's, else the question-mark box): the painter's one lookup (`Loom.mapPaint.cardUrl`).
    - **Its actions, below,** are what the server sent for this character, each at its AP cost as every other menu entry shows it: greyed out with the reason when you aren't beside it ("Walk beside it to unlock."), you have acted this turn with AP off, the AP left won't pay ("Costs 5 AP; you have 1."), or a turn is under way; a long action (picking a lock) shows its work, "30 AP of work, over turns", and is put in as AP allow. "What's here?" is last, free.
    - **Choosing** sends `{ verb: 'object', object, act }` (`Loom.play.objectAction`) or the look (`Loom.play.lookAt({ object })`): no model reads either.
  - **Hit-testing:** an object is clicked on its footprint, at least a square, so a lever can be hit; if two overlap, the one nearest its middle. Doors are tested first, then objects, then the square. Objects with nothing to do (a statue) are not in what the page is sent and get the square's menu.
  - **Selecting:** the object is outlined on the map, and the info card under it names it and its state, and says to walk beside it when you aren't. Clicking anything else clears it.
  - **Headless Chrome** (`tests/loom-objects-menu.test.js`, 26 tests, under both built-in systems): the vault drawn from the server's own `battleView` and `turnView`, clicked with a real mouse on the real engine, the menu read from the page. `drawers.html` now draws the click menu with Preact and htm (the page's versions, from the tests' own copy, as PixiJS is), and its taps reach `battle.tap`; the static server is shared in `tests/helpers/fixture-server.js`.

### 4.5 Hidden things, spawns and generic maps (DA3, DA4, DA1b)

- **Hidden things** are found per save by a passive check when in sight, or a Search action; once found, they're drawn and usable. Traps are L-815 hazards, hidden until found or triggered.
- **Spawns:** `{ id, name?, at (point or area), what (stat block or template), count }`, used by encounters, broken rests and L-360's events.
- **Generic maps** keep their spawns generic (areas, not named people), so the GM or an event can fill them with different figures each time (DA1b).
- **Decided before building L-927 (the user, 2026-11-06):**
  - **The passive check is rolled once per thing,** the first time it is in sight: the server rolls the noticing skill against the thing's `dc` (else the system's Moderate rung). A success finds it; a miss is remembered on the save and not rolled again, so only Search finds it after. The noticing skill is the system's `checks.notice` (`{ skill }` or `{ attribute }`, as `checks.lock` is): Perception in d20 Fantasy, Notice in the dice-pool system.
  - **Search is rolled over everything in sight,** at the standard AP price (10): the same check, once for each hidden thing not yet found that is in sight, against its `dc`; a hit finds it. It is the way to correct a missed passive check, and a hard secret can stay hidden. A search that finds nothing says so plainly and spends its AP either way, so it never tells whether anything is left.
  - **A trap is hidden by a setting on the hazard,** `hidden: true` or `{ dc }`, since hazards live in the battle map's `hazards`, not in the geometry. An unfound trap still triggers when walked into, which finds it. Nothing is moved.
  - **Spawns are filled by events, from an event table on the place.** A spawn with `what` (a stat block) brings its `count` of it; a generic spawn, with none, takes `{ what, count }` from the place's `encounters` table by the server's dice, so the same map gets different figures from different rows. The broken rest (L-827) is the one event today; L-360's will call the same fill.
- **As built (L-927, 2026-11-06):**
  - **The check:** `checks.notice` (`{ skill }` or `{ attribute }`, checked on save like `checks.lock`; a system without one rolls its combat module's surprise `notice`) against the thing's `dc`: a number on the d20 scale as a lock's is, or a rung's name; none is the system's Moderate rung. Its dice are the server's.
  - **What can be hidden and noticed:** walls, lines, doors, windows, objects and ground, in the geometry's `hidden` list (`[{ id, dc? }]`, `dc` now a number or a rung's name; both copies of `map-geometry.js`); and a hazard by its own `hidden: true | { dc }` (`set_hazards` takes it). Zones, spawns, lights and notes are never drawn to a player, so hiding them changes nothing.
  - **What a save has found** is `save.secrets[mapId][key]`, `'found'` or `'missed'` (a hazard's key is `hazard:<id>`), and nothing else about a map is kept per save. `functions/loom-canon/secrets.js` lays it over the map a save stands on (`maps.positionOf`): found things are no longer hidden, so the rules and the page read them as shown, and the world's own map is never changed. The same map found the same things is the same object, so what is worked out from it is kept.
  - **What an unfound thing does:** it is never sent, drawn or offered as a target, but it is still there: a secret door is a closed door to movement and sight (a wall to walk into), a trap springs when walked into. A trap sprung is a trap found.
  - **Passive:** after any action that leaves the save on a battle map (`functions/loom-turn/noticing.js`: ADJUDICATE for anything not turned down, and a step the rules walk alone), each hidden thing in sight with no state yet is rolled for once. A hit is `'found'` and said ("You notice a secret door."; a step says it itself, the rest tell NARRATE); a miss is `'missed'`, said nothing of and not rolled again. A map with nothing hidden rolls nothing, and works out no sight.
  - **Search:** `{ verb: 'search' }` from your own square's menu, or typed ("search the room": INTERPRET says "search" with no target; with one, the object's own search, L-926). It costs a standard action (10 AP), rolls every thing in sight not yet found (missed ones too), and says "You find …" for each hit, else "You search the area carefully and find nothing new." The same words and the same AP whether anything was left, so it never tells; no roll card, for the same reason.
  - **Spawns** (`functions/loom-modules/combat/spawns.js`): `fill(world, save, { dice })` fills each spawn whose figures aren't standing: `what` (a stat block) and `count` its own, or a row of the host's `encounters` (`[{ what, count?, weight? }]`, set with `update_place` and `update_location`, checked against the world's stat blocks) chosen by weight; its figures placed on free squares of its area by the dice (not on what blocks, an entry, an exit, anyone, the player, or each other; as many as fit). They are groups in the shape `place_figures` sets, kept on the save at `save.spawned[mapId]` and added to the world as the save sees it (`figures.withFigures`), so they fight, move and fall like any figure, and no other save has them. A spawn whose figures are all down or gone is filled again as a new group (`spawn-den-2`).
  - **Events:** a rest broken somewhere dangerous (L-827) fills the map's spawns, then the fight starts with whoever stands there. L-360's events will call the same `fill`. Encounters beyond broken rests, and a spawn with `what` as a template (a map, not a stat block), aren't built.
  - **Not here:** the tools to author them (`set_hidden`, `set_spawns`, and `cardArt`'s) and the grading criteria for hidden things and spawns are L-929's.
  - **Tests:** `tests/loom-hidden.test.js` (41, pure, both built-in systems), `tests/loom-hidden-play.test.js` (20, through `loomPlayTurn` and `loomGetMap`, both systems) on the crypt (`tests/helpers/crypt.js`), and the Search item in `tests/loom-objects-menu.test.js`.

### 4.6 Drawing (RD1, RD2, RD4, EX2, PL4)

- **Materials:** a fixed, built-in set for floors, walls, doors and windows, each with embedded art (tiles and wall edges seen from above), made with the studio during the build and committed to the repo. MCP assigns them; it can't add new ones.
- **The object catalog's art** is embedded the same way.
- **The engine draws** ground, then walls, doors and windows, then objects, then light and shading by height, then fog; the world's accent may tint.
- **Maps with art (EX2)** draw their art in place of ground and walls, and still draw objects.
- **Loading (PL4):** a map shows a progress effect while its textures load and its shapes draw; drawing is cached per map revision; never a frozen screen.
- **Decided before building L-924 (the user, 2026-11-04):**
  - **All three levels, one painter:** grids draw from their geometry now; loomGetMap also sends a region or area map's own geometry, and the world and town views draw it under their places when a map has some. Azgaar art and town ground stay as they are until L-928 converts them.
  - **The cache in memory, per session:** a map's drawing is kept while the Loom is open, so going back to a map, or a turn that changes nothing drawn, draws nothing again; a reload draws again.
  - **Light is drawing only:** dark areas are shaded and lights glow through them; sight and the rules ignore light for now (a later story, L-927's noticing or its own, can make darkness hide things).
  - **CI installs Chromium,** so the drawing tests and the screenshot comparison run on every PR (the swatch page's test with them).
- **As built (L-924, 2026-11-04):**
  - **One painter, `paint.js`** (`Loom.mapPaint`), for the grid, town and world views: ground as its material's tile repeating in map space, shading by height (higher lighter, lower darker, a shadow along each ledge), lines and walls as strips of their material along their lines, doors and windows by state (a closed door across its gap, an open one swung on its hinge, a locked one tinted red), objects with their art (their own, their world's for their kind, the catalog's, else the box with a question mark), then dark areas and lights (bright to their radius, dimmer to `dim`). The fog stays the views' own, over it. The world's own accent tints the ground and walls a little.
  - **Maps with art (EX2):** the art in place of ground, lines, walls and windows; doors over it as lines by their state, as before; objects on top. On a grid with art, the pillars old solid obstacles convert to are the art's own and aren't drawn again.
  - **Built in map units, one display object per item,** kept by what it is (kind, id and data) per map, at most eight maps kept: painting again builds only what changed (a door opened builds that door). Building runs 8 ms at a time across frames, never blocking input. A large dungeon (36 rooms, 144 objects, 72 doors) draws in about 150 ms with the CPU slowed four times.
  - **The progress effect** (`progress.js`): a bar along the top of the map panel with a shimmer and "Drawing the map…", shown after 150 ms (a map drawn at once never flickers it) until the drawing is done.
  - **The fog to the sight lines:** loomGetMap sends the outline of what's in sight (`fog.view`, from `sight.outline`), and the grid view dims what's been seen outside it, finer than before (12 px a square), so a wall's shadow and a doorway's cone show as they are. The dark over what's never been seen stays by the square.
  - **What the page is sent:** a grid's lines and lights with what's seen of it; objects' art and the world's object kinds' art as links only (`known-map.js` `drawnGeometry`, `artLink`; never the library's records, A5); a region or area map's geometry whole (hidden things left out) and its space.

### 4.7 Today's maps (EX1–EX3, AU3)

- **Battle maps (EX4):** walls, doors and obstacles convert to the geometry (grid lines become lines, obstacles become shapes) by a dry-run-then-apply workflow; their art stays. A replay of scripted fights checks paths, sight and costs before and after; then today's layers are dropped and only the geometry is read.
- **Towns** with ground are drawn from it.
- **Azgaar worlds** are converted from their saved exports: coasts and biomes into ground, rivers and routes into lines, burgs into places. With L-710's conversion of regions and terrain.
- **Tracing (AU3):** Claude can trace an image into data, or keep the image and make its walls and doors precise.
- **Decided before building L-928 (the user, 2026-11-04):**
  - **Three PRs**, since the code can read only the geometry once the live worlds are converted (a merge deploys at once):
    - first the conversion: the layers stored as geometry beside them, a dry-run-then-apply workflow whose report carries the replay, and the grid tools writing both. The user runs it on Nisia and The Border March;
    - then the layers dropped: the code reads only the geometry, the grid tools become shortcuts that write geometry, and the workflow clears the old fields;
    - then towns drawn from their ground, the Azgaar conversion and the tracing guidance.
  - **Azgaar exports, uploaded on the page:** imports delete their upload once the world is built, so no export was saved. An Azgaar world on the Cartographer page gets "Convert its map": its full export is uploaded once and converted on the server into its top map's geometry. New imports convert at once. A slimmed copy of Nisia's full export, with its cell outlines and rivers, becomes the test fixture. _Overtaken 2026-11-05: Nisia's full export is lost._
  - **Features stay named spots,** like entries, exits and areas: they aren't layers. L-926 (objects' actions) decides whether they become objects, which as things stand would be drawn as boxes with a question mark over every map's art.
  - **Art always wins** where a map has both art and data (EX2, at every level): Nisia's world map keeps its Azgaar picture, and its converted data is drawn once its art is removed over MCP. Towns with art keep it.
- **Decided 2026-11-05 (the user), after Nisia's full Azgaar export was found lost:** **EX1 is dropped from L-928.**
  - No Azgaar world can be converted: imports never kept their exports, and the repo's slim copy of Nisia's has no cell outlines or rivers. Nisia keeps its art, which wins anyway.
  - The epic's exit criterion "Nisia's world map is drawn from its converted Azgaar data" becomes "a region map is drawn from its own data" (§5), already shown headless since L-924.
  - Nisia's coasts and terrain come later: Claude can trace its map image with L-929's tools (AU3), or L-710's region layer (L-715) can paint them. L-717's plan to convert Azgaar worlds' layers from their saved exports (AZ2) is affected the same way (noted in `worlds-without-azgaar.md`).
  - The "Convert its map" upload isn't built. The third PR is towns drawn from their ground, and tracing guidance.
- **As built (L-928, first PR, 2026-11-04):**
  - **The conversion** (`functions/loom-canon/layer-geometry.js` `converted`) stores what play has read since L-922: a map's own geometry, and its layers read as geometry beside it (`fromLayers`, which now also keeps a door's long action and lock difficulty), its own items winning on an id, normalized. Every id is kept: doors keep their own, so a save's door states and wary triggers on them still find them; walls, doorways and obstacles keep the ids `fromLayers` gives them (`layer-wall-0`, `layer-doorway-<door>`, `layer-<obstacle>`). So the stored items shadow the ones read from the layers one for one, and nothing plays differently while both are there. The map a save is sent (`known-map.js`) leaves out the stored items its layers make while it still has layers, so it is the same before and after.
  - **The Convert Map Layers workflow** (`.github/workflows/convert-map-layers.yml`, `scripts/convert-map-layers.js`, `functions/cartographer/convert-layers.js`), like L-902's: a dry run reports, then apply (its confirm word was dropped 2026-11-05: iOS capitalised it, and the dry run is the check). It writes `geometry` on each battle map that has layers and whose stored geometry differs, and moves the world's `canonVersion` on once. Running it again writes nothing. Generic maps, floors reached by exits and templates (whose instances are made from them as the world loads) convert with them. Grid maps in `maps` keep the copies of the layers L-902 made, which nothing reads.
  - **The replay is in the report:** each map's questions are asked of it as played now and of its geometry alone, with its layers dropped:
    - the cost of the way, and where it ends, from each entry, exit, feature and figure (up to 16) to every square, for a medium and a large character;
    - the squares the entries reach, as `cell: "auto"` and the builders' checks ask, and with every door open;
    - the squares in sight from each of those spots.

    Any answer that differs is listed. It matches on random maps, and catches a conversion that loses a lock or a wall.

  - **The grid tools write both** (`set_battle_map`, `set_map_layers`, `set_grid`): new layers replace, item for item, what the old ones made in the geometry (`relayered`), keeping the map's own items. `set_battle_map` replacing a map keeps its own geometry, which it used to drop.
  - **Applied 2026-11-05** to Nisia and The Border March: all 56 battle maps written, and the replay matched on every one (1,483 checks).

- **As built (L-928, second PR, 2026-11-05): the layers dropped.**
  - **Play reads only the geometry.** `map-paths.js` `geometryOf` is a map's stored geometry and nothing else.
    - **Doors** come from the geometry through `functions/loom-canon/doors.js`: a door by id, its state for a save (the save's, else the map's, else closed), its key (`unlocks.key`), and the two squares either side of its middle, which it is opened and seen from. Hidden doors are left out.
    - **What covers a square** (`maps.blockerAt`; what an obstacle was): an object that blocks the way (solid if it hides, else low), a closed wall round the square's middle (low if it hides nothing), or ground that costs more (difficult). Standing, placing and looking ask it.
    - **The map a save is sent** (`known-map.js`) is its exits and its geometry as far as seen, each door in the save's state; the battle view takes its doors from it for clicks and selection.
    - A feature's squares "beside" it are those with no wall, door or window between, other than what the feature itself sits on.
    - Grading's "walls or obstacles" asks whether the geometry has ground, walls, doors, windows or objects (`layer-geometry.js` `hasShapes`).
  - **The grid tools are shortcuts onto the geometry.** `set_battle_map`, `set_map_layers` and `set_grid` take walls, doors and obstacles in squares and corners, as before, and store only what they make.
    - What the layers made is told by its ids: walls, doorways and obstacles start `layer-`, and a door sits in the doorway named after it. New layers replace that, and keep the map's own items.
    - `get_battle_map` and `view_image` read the walls, doors and obstacles back from the geometry (`layersOf`).
    - `layers.js` keeps only the shapes' checks, on the server: the page's copy is gone, since nothing there read it.
  - **Obstacles keep their names** in the geometry: low walls and rough ground now carry them, as pillars did.
  - **The workflow now deletes the layers.** Convert Map Layers stores each battle map's geometry again, from its layers (adding the obstacles' names), and deletes `walls`, `doors` and `obstacles`. It also deletes the copies L-902 left on grid maps in `maps`, and converts any grid map there with no battle map of its own. Its replay compares the map as it played before (its layers read as geometry beside what was stored) with its geometry alone.
  - **Every grid test plays on the geometry alone.** Tests write their maps in squares and corners and store them through `tests/helpers/grid.js` (`gridMap`), the same conversion.
- **As built (L-928, third PR, 2026-11-05): towns drawn from their ground, and tracing.**
  - **Towns with ground are drawn from it (EX3).** loomGetMap sends a town's ground as geometry (`ground.js` `geometryOf`), worked out each time, never stored, so it is always the ground players walk. The town's own geometry lies over it, its items winning on an id.
    - The streets are cobbles over the whole 0–1000 square.
    - Water, bridges (planks) and fords (stones) lie on the streets.
    - Buildings are roofs, raised 10 so the painter lightens them and lays a shadow along their edges.
    - Walls are stone.
    - Each item keeps its shape's name.
  - **The town view paints them** in place of its plain shapes, and keeps the water's shimmer. A town with art keeps its art, the painter drawing only what lies on top of it (EX2).
  - **Tracing (AU3)** is guidance in the tools' descriptions: `view_image` says how to trace art into data and that a map keeps its art; `set_map_layers` says how to follow a battle map's art onto the grid; `set_town_ground` and `set_area_ground` say how to follow a town's.

### 4.8 Tools and generators (AU1, AU2)

- **MCP tools:** `set_ground`, `set_walls`, `set_doors`, `set_windows`, `set_objects`, `set_zones`, `set_spawns`, `set_lights`, `set_hidden`, `list_materials`, `list_object_kinds`, `set_object_art`. Each patches shapes by id (features, entries and exits too), keeping what saves have seen and opened (#735 gap 17). `view_image` draws the data (with or without fog, heights shaded).
- **Generators,** seeded: rooms and corridors, caves, building interiors, ship decks. Claude calls one, then edits.

- **Decided before building L-929 (the user, 2026-11-06):**
  - **Three PRs:** (1) the patch tools, with features, entries and exits patched the same way, and a save's seen map kept; (2) `view_image` drawing the geometry, with fog and heights, and the grading criterion; (3) the four seeded generators, with their seed-set tests.
  - **A patch is `set` and `remove`, in one call:** `{ worldId, mapId, set: [{ id, ...fields }], remove: [ids] }`. An id already on the map has only the fields given changed (null takes one away), so moving an exit sends its id and new square; a new id is added and must be whole. Everything is checked together and nothing is written if any is refused. The same shape for every tool, on any map kind, and it never bumps the map's `revision`, so saves keep what they have seen.
  - **`view_image` extends its own raster drawing,** not an SVG route: ground in each material's colour, lines, walls, doors and windows by state, objects as their kind's coloured box, zones, spawns, lights and hidden things outlined and labelled, heights shaded; `sightFrom` stays the fog, with a point as well as an entry. For grids, area maps and region maps.
  - **Grading, grids now:** a battle map's `layers` criterion becomes `drawn`, met by art or by its geometry having both ground and walls, half met by either alone; `place.ownMap` follows it. Region and area maps keep grading through their places and settlement (a town's `ground` and `townArt` already score drawing) until L-710's region layer gives coasts and terrain a tool.

- **As built (L-929, first PR, the patch tools, 2026-11-06):**
  - **The tools** (`functions/mcp/apps/cartographer/patch-tools.js`, over the pure `functions/loom-canon/geometry-patch.js`): `set_ground`, `set_walls`, `set_doors`, `set_windows`, `set_objects`, `set_zones`, `set_spawns`, `set_lights`, `set_hidden`, and two the geometry has that the design's list left out, `set_lines` (rivers, roads, pipes) and `set_notes` (the narrator's notes), since nothing else could write them; `set_features`, `set_entries` and `set_exits` for a grid's named spots, ways in and ways out; and `get_geometry`, which reads a map back as stored (points as path data), so a patch can name what is there.
  - **A patch** is `{ mapId, set, remove }`, as decided: an id the list has gets only the fields given (null takes one away), a new id is added whole, an item with no id is given one (`wall-3`, in `added`, in the order given), and `remove` takes shapes away by id, a removed thing leaving `hidden` with it (`unhidden`).
  - **Which maps:** a grid (its geometry on its battle map, in feet), and a region or area map made with `add_map` (on its map doc, in its own units). A world map or town in today's shape has no document of its own: a town takes `set_town_ground`.
  - **Checks:** the whole geometry is normalised and checked by `map-geometry.js` against the map's bounds, and only what the patch makes wrong is said, so a map with an old fault can still be edited. Ids are unique across a map's shapes (`"chest" is already an object`). What a shape names must exist, so the order matters: a lever before the gate it unlocks, a wall before the door in it, and a wall can't go while its door does. Nothing is written if any part is refused.
  - **A grid's spots** are checked as `set_battle_map` checks them (on the grid, not on an exit, exits sharing no square, an exit's entry existing, no entry another map's exit leads to removed), each patched item as a whole one against its schema, and the map keeps at least one entry and one exit.
  - **Players keep what they have seen:** a patch never bumps the map's `revision`, so a save's seen map is kept when one exit moves. `set_battle_map`, `set_grid` and `set_map_layers`, which replace, still make players forget it. After a patch a grid says what no entry reaches and who stands where they can't.
  - **Tests:** `tests/loom-geometry-patch.test.js` (12, pure) and `tests/cartographer-mcp-patch.test.js` (13, a real MCP client: a dungeon built one kind of shape a tool and read back, patch semantics, every refusal, a region map, a world map in today's shape turned away, features, entries and exits, and a save's seen map kept).
  - **Still to come:** `view_image` drawing the geometry and the grading criterion (the next PR), and the generators (the last).

### 4.9 Grading (PL2)

**Map:** its data is enough to draw it (floors and walls on a grid; coasts and terrain on a region map; streets and footprints on an area map), or it has art.

---

## 5. Exit criterion

A dungeon built over MCP from data alone, with no image, draws with character from its materials; a wall runs at an angle off the old grid lines and hides what it should; a character slips through a gap narrower than a square; a secret door is found by searching; a ledge gives high ground; bandits appear at a spawn point. A region map is drawn from its own data (revised 2026-11-05 from "Nisia's world map is drawn from its converted Azgaar data": Nisia's export was lost, §4.7).

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
| L-928 (#732) | **Today's maps:** battle-map layers converted, towns drawn from ground, art kept; tracing (Azgaar exports converted to region data: dropped 2026-11-05, §4.7)                                | L-921        | Opus   |
| L-929 (#733) | **Tools and generators:** the MCP tools, `view_image` of the data, seeded generators (rooms and corridors, caves, interiors, decks); the grading criterion                                   | L-921        | Sonnet |

**Order:** L-921 and L-925 first. L-922, L-923, L-926, L-928 and L-929 follow L-921; L-924 follows L-925; L-927 follows L-923.

Tests: the `map-geometry.js` copies match; pure tests for gaps by size, AP by distance (preview against charge), sight through glass and over low walls, in both built-in systems; a converted Nisia renders; headless Chrome for drawing, loading progress, a path through a narrow gap and the box with a question mark.
