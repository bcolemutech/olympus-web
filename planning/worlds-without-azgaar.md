# The Cartographer — Worlds Without Azgaar — Design Document v0.1

**Status:** Decided (2026-10-10). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-710 (#524)
**Phase:** 6 — Studio and new worlds ([`roadmap.md`](./roadmap.md) §4)
**Depends on:** L-700 (#523, the Image studio: map images). **Followed by:** L-360 (#418), whose terrain comes from this epic's layer.
**Related:** [`the-cartographer-design.md`](./the-cartographer-design.md), [`the-loom-game-time.md`](./the-loom-game-time.md) (route speeds), [`the-loom-grading.md`](./the-loom-grading.md) (criteria)

---

## 1. Purpose

New worlds stop depending on Azgaar. A world starts from a map image made in the Image studio, and Claude builds it over MCP: it pins places on the image, connects them, and paints the regions and terrain under it. The world also gets a **brief** that says what kind of world it is, so worlds can range from dark fantasy to alien planets rather than assuming medieval fantasy.

The intake (2026-10-09) gave the reasons:

- Azgaar's art can't carry those worlds.
- Its roads and sea lanes break.
- It isn't ours to charge for.
- A world whose making we control can be shaped to the story.

---

## 2. What there is today

- **Worlds are only ever created by an Azgaar import** (`cartographerImport`). It sets:
  - the world's size and scale (Nisia: 2 mi per map unit);
  - the map image;
  - positions in the image's pixels.
- **Imported settlements** carry population, port, capital, culture and town seeds (walls, plaza, temple, citadel, shanty town).
- **Over MCP**, Claude can update and connect locations, and add places in town, characters and lore. It can't create a world, a location, a realm or a region.
- **Realms and regions** are entities with names and descriptions but no shapes. A location records which realms are present (`factionIds`).
- **Routes** are road, trail or sea links between locations, drawn as straight lines. L-370 gives them lengths (straight line × scale × 1.25) and speeds (road 3 mph, trail 2, sea 5).
- **`view_image`** shows the world map with its markers, but without a coordinate grid.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-10). Items marked † took the recommendation without a question of their own.

### Starting a world

| ID     | Question                       | Decision                                                                                                                                                      |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W1** | How is a world created?        | **From the Cartographer page and over MCP (`create_world`)**                                                                                                  |
| **W2** | Can a world have no map image? | **No: a world starts from a studio image.** This replaces the intake's "start blank" option                                                                   |
| **W3** | Where do positions live?       | **In the world's own map units, set at creation.** The image is fitted to that space, so a new image or a new studio version never moves a pin                |
| **W4** | How is the scale set?          | **Miles per map unit, set when the world is made, and changeable**                                                                                            |
| **W5** | More than one map?             | **One world map for now.** Towns and battle maps sit below it, as today                                                                                       |
| **W6** | A world brief?                 | **Yes:** genre, tone, era or technology, and art direction, set over MCP. The GM is told it every turn, and it seeds the world's default studio style (L-709) |
| **W7** | Travel kinds?                  | **Each world names its own route kinds and speeds.** Road, trail and sea are the defaults                                                                     |

### Places and routes

| ID      | Question                     | Decision                                                                                                            |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **PL1** | Adding places                | **Over MCP (`add_location`)**, with a position and kind, checked with `view_image`                                  |
| **PL2** | Location kinds               | **Settlement and point of interest, as now, with a free sub-type** (ruin, shrine, mine, crash site, …)              |
| **PL3** | Azgaar's settlement facts    | **Kept as plain fields, set over MCP:** population, port, capital, culture, town seeds                              |
| **PL4** | Routes                       | **Optional waypoints**, so a route follows the road or rail drawn in the art. Its length follows the line           |
| **PL5** | A grid on the world map view | **Yes:** `view_image` for the world map gains a labelled coordinate grid, like battle maps and towns                |
| **PL6** | Many places at once †        | **Batch tools:** `add_locations` and `connect_locations` take a list, so a large world (§7) isn't hundreds of calls |

### The region layer

| ID     | Question                  | Decision                                                                                                                                                                                 |
| ------ | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | Areas, regions and realms | **Regions get shapes, and a realm's land is its regions together.** One source of truth. Terrain is a separate layer                                                                     |
| **R2** | Terrain kinds             | **A built-in list that a world can add to:** forest, hills, mountains, swamp, desert, plains, grassland, tundra, jungle, water, … and, say, `ashwaste` in one world                      |
| **R3** | Shapes                    | **Polygons in map units**, written by Claude, checked with `view_image`                                                                                                                  |
| **R4** | Overlaps                  | **Allowed; within a layer, the last one on top wins.** A lake inside a forest is drawn after it                                                                                          |
| **R5** | Who draws                 | **Claude over MCP.** No drawing tool on the page                                                                                                                                         |
| **R6** | Places' region and realm  | **Taken from where they sit**, and any one can be set by hand                                                                                                                            |
| **R7** | What reads the layer      | **The GM** (terrain, region and realm where the player is) **and off-road travel** (L-360). The Loom's map doesn't draw it, and the Cartographer page doesn't show it; `view_image` does |

### Azgaar worlds

| ID      | Question                  | Decision                                                                                                                 |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **AZ1** | The importer              | **A small "Import an Azgaar map (legacy)" link** on the Cartographer page                                                |
| **AZ2** | A layer for Azgaar worlds | **Converted once by a script** from their saved exports: province cells become region shapes, biome cells become terrain |
| **AZ3** | Azgaar-only fields        | **Moved to the fields new worlds use**                                                                                   |
| **AZ4** | Pixel positions           | **Converted:** an Azgaar world's pixel space becomes its map units. Nothing moves, and every world works one way         |

### The page and the end

| ID      | Question              | Decision                                                            |
| ------- | --------------------- | ------------------------------------------------------------------- |
| **PG1** | The Cartographer page | **New world** (from a studio image) and **editing the world brief** |
| **X1**  | Exit criterion        | **As in #524** (§5)                                                 |
| **X2**  | A first world         | A large steampunk continent, checked against this design in §7      |

---

## 4. Design

### 4.1 A world's space

- **`world.map`** is `{ width, height, imageId, distance: { unit: 'mi', perMapUnit } }`. Width and height are map units, chosen at creation; the default is 1000 on the long side, in the image's shape.
- **Every position** (locations' `geo.x`, `geo.y`, route waypoints, region and terrain polygons) is in those units. The image is drawn stretched to the space, so changing it moves nothing.
- **Azgaar worlds (AZ4):** their pixel space is renamed as map units: `width` and `height` stay, and `imagePath` moves to the library via L-705. No positions change.

### 4.2 Creating a world

- **`create_world`** (MCP) and **New world** (the Cartographer page) take a name, a studio image of kind `worldMap` (W2), the scale, and optionally the brief. The world starts as a draft, with no places.
- **The brief (W6)** is `world.brief: { genre, tone, era, artDirection }`, all short text.
  - Set with `update_world`, and editable on the page (PG1).
  - The GM's prompts carry a BRIEF line every turn.
  - `studio_generate` uses `artDirection` as the world's default style when no style is set (L-709).
- **Route kinds (W7)** are `world.routeKinds: [{ id, name, mph, landOnly?, waterOnly?, roundTheClock? }]`. They default to road 3, trail 2 and sea 5 (sea runs round the clock). L-370's travel reads speeds from here instead of its constants.

### 4.3 Places and routes

- **`add_location`** takes:
  - name, kind (`settlement` or `poi`), sub-type, position and description;
  - for settlements: population, port, capital, culture, town seeds (PL3);
  - optionally a region and realms, which are otherwise taken from where it sits (R6).
- **`add_locations`** takes the same as a list (PL6).
- **`add_realm`** and **`add_region`** create the entities that `update_faction` and `update_region` already edit.
- **Routes** take an optional list of waypoints (PL4). A route's length is the length of its line × scale × 1.25 (L-370's winding factor), unless waypoints are given: then the factor is 1.0, since the line already follows the road. `connect_locations` takes a list too (PL6).
- **`view_image` of the world map** gains a coordinate grid labelled in map units (PL5) and draws routes along their waypoints.

### 4.4 The region layer

- **Region shapes (R1):** `region.shape` is a list of polygons in map units. A realm's land is the union of its regions' shapes. A location's region is the topmost region containing it (R4), and its realm is that region's realm, unless set by hand (R6).
- **Terrain (R2):** `world.terrainKinds` (the built-in list plus the world's own) and a `terrain` subcollection of areas `{ id, kind, polygons, order }`. The terrain at a point is the topmost area there (R4). A point outside every area has none.
- **Tools:**
  - `set_region_shape` sets one region's polygons.
  - `set_terrain` adds, changes or removes areas, and their order.
  - `get_layer` reads what lies at a point or along a line.
  - `view_image` of the world map can draw regions or terrain on top, with a legend (R5, R7).
- **Readers (R7):**
  - The GM gets a WHERE line: terrain, region and realm at the player's location.
  - L-360 reads terrain along a cross-country line.
  - Nothing else draws the layer.

### 4.5 Azgaar worlds

- **The importer** moves behind a "legacy" link (AZ1).
- **The layer (AZ2):** a local dry-run script reads each Azgaar world's saved export, traces province cells into region polygons and biome cells into terrain areas (Azgaar's biomes mapped to the built-in list), and writes them.
- **Fields (AZ3):**
  - The `source` block stays as a record but nothing reads it.
  - Azgaar biome numbers are replaced by the location's terrain from the layer.
  - Settlement facts are already plain fields.

### 4.6 Grading

This epic adds the criteria the grading rework planned for it ([`the-loom-grading.md`](./the-loom-grading.md) §4.3), by the rule in its §4.6:

- **World:** a brief, and the region layer covering the land.
- **Settlement:** in a painted region.
- **Realm and region:** a painted shape.

---

## 5. Exit criterion

A world started from a studio map image, with places pinned and regions and terrain painted over MCP, is published and played with no Azgaar in the loop. The GM names the terrain and region the player is in, and the world's score counts its brief and layer.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                           | Depends on          | Model  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| L-711 | **A world's space:** map units, scale, image fitted to the space; Azgaar worlds' pixel space converted (AZ4)                                                    | L-704               | Opus   |
| L-712 | **Creating worlds:** `create_world`, New world on the page, the brief (fields, `update_world`, the page, the GM's BRIEF line)                                   | L-711               | Sonnet |
| L-713 | **Adding places:** `add_location(s)`, sub-types and settlement facts, `add_realm`, `add_region`, route waypoints and lengths, batch connect, the world-map grid | L-711               | Sonnet |
| L-714 | **Route kinds per world:** `world.routeKinds`, L-370 speeds read from it                                                                                        | L-713, L-373        | Sonnet |
| L-715 | **The region layer:** region shapes, terrain areas and kinds, topmost-wins lookup, places' region and realm from position, the tools, `view_image` overlays     | L-713               | Opus   |
| L-716 | **The GM knows where:** the WHERE line                                                                                                                          | L-715               | Sonnet |
| L-717 | **Azgaar worlds:** the legacy link, the layer from exports (script), fields moved                                                                               | L-715               | Sonnet |
| L-718 | **Grading criteria:** brief, layer coverage, painted regions and shapes (§4.6)                                                                                  | L-712, L-715, L-691 | Sonnet |

---

## 7. Checked against a first world

The user's first world: _"A large fantasy steampunk world. A single continent with many biomes and burgs. There should be a few visibly large cities. Should have a few large bodies of water and an inland sea. Should lean medieval with ancient looking cultures and one visibly advanced with railroads."_

| Need                                     | Where it is met                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------- |
| Steampunk, leaning medieval              | The brief (W6): genre, era and art direction, given to the GM and the studio                  |
| A single continent, visibly large cities | A studio map image (L-707); cities as settlements with population and capital (PL3)           |
| Many biomes                              | Terrain areas from the built-in list, plus the world's own kinds (R2)                         |
| Large bodies of water, an inland sea     | Water terrain (R2), and sea routes across it                                                  |
| Many burgs                               | `add_locations` in batches (PL6)                                                              |
| Ancient-looking cultures                 | Culture on settlements (PL3), realm descriptions and lore                                     |
| One advanced realm with railroads        | A `rail` route kind with its own speed (W7), routes following the rail drawn in the art (PL4) |
