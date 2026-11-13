# The Cartographer — Worlds Without Azgaar — Design Document v0.2

**Status:** Decided (2026-10-10), refreshed 2026-11-12 (§3). Sub-issues L-711 to L-718 filed as #816–#823 (§6). L-711 (the brief and New world) built 2026-11-12: the BRIEF line is in the narrator's prompt. L-712 (realms, regions and terrain) built 2026-11-12: `add_realms`, `add_regions`, regions' zones, places' region and realm from where they sit, `where`, and `view_image`'s overlays. L-713 (a world's own terrain) built 2026-11-12: `world.materials`, `set_world_materials`, ground checks, `list_materials` with a world, the `material` assigner target, and the painter drawing them. L-714 (realm borders in play) built 2026-11-13: `loomGetMap`'s `map.realms` (each realm's edge with the border between its own regions left out, its land, colour and name's centre; `functions/loom-canon/realm-borders.js`) and the world view drawing a soft inner edge and a name for each, on region maps with no image.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-710 (#524)
**Phase:** 6 — Studio and new worlds ([`roadmap.md`](./roadmap.md) §4)
**Depends on:** L-700 (#523, the image studio), L-391 (worlds from scratch), L-900 (map levels), L-920 (maps drawn from their data), L-940 (painted art). **Followed by:** L-360 (#418), whose terrain comes from this epic's ground.
**Related:** [`builders-tools.md`](./builders-tools.md) (L-391, gap 10), [`map-levels.md`](./map-levels.md), [`maps-from-data.md`](./maps-from-data.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

New worlds stop depending on Azgaar. Claude builds a world from scratch over MCP: it pins places, connects them, and paints the land's terrain, regions and realms. A **brief** says what kind of world it is, so worlds can range from dark fantasy to alien planets rather than assuming medieval fantasy. Azgaar stays as a second way in: its importer is kept, and Nisia gets its full layer from its recovered save.

The intake (2026-10-09) gave the reasons:

- Azgaar's art can't carry those worlds.
- Its roads and sea lanes break.
- It isn't ours to charge for.
- A world whose making we control can be shaped to the story.

---

## 2. What there is today (2026-11-12)

Much of the 2026-10-10 design has been built by other epics since:

- **Worlds from scratch (L-391):** `create_world` with no image (a plain backdrop), `add_locations` and `connect_locations` in batches.
- **Map levels (L-900):** every world has region maps at any depth, each with its own size, units and scale, and its own route kinds with speeds, which travel reads through `timeRules(world, map)`. This was the old L-711 (a world's space) and L-714 (route kinds).
- **Maps drawn from data (L-920):** region maps have a geometry: `ground` items with materials (a later one lies over an earlier one), `lines` for rivers and roads, and `zones` with shapes, edited with the patch tools and drawn by `view_image`. The built-in materials include terrain: grassland, farmland, forest, jungle, savanna, desert, hills, mountains, tundra, taiga, glacier, swamp, marsh, lake and ocean.
- **The painter (L-924, L-940):** the Loom draws a region map from its geometry in the world's art set, and a map's own art in place of its ground and lines.

**Not built:**

- the brief, and a New world button on the Cartographer page;
- realms and regions with shapes, and tools to add them;
- a world's own terrain kinds;
- route waypoints, and rules on routes (#735 gap 10);
- the GM being told where the player is;
- Nisia's layer: imports never kept their exports, so L-928 dropped converting it. **The user has since found Nisia's original Azgaar save**, which holds every cell's outline, biome, province and state, its rivers and its coast.

---

## 3. Decisions

### 3.1 Refreshed 2026-11-12

Settled with the user through a questionnaire. These replace the 2026-10-10 decisions where they differ (§3.2).

| ID      | Question                       | Decision                                                                                                                                                                                                                                 |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **W2**  | Does a world need a map image? | **Optional.** A world can start on a plain backdrop, and a studio image can be set on any region map at any time without moving a pin                                                                                                    |
| **W6**  | The world brief                | **As designed:** genre, tone, era, art direction; set with `create_world` and `update_world` and on the page; the GM is told it every turn; the studio uses its art direction as the world's default style when none is set              |
| **PG1** | The Cartographer page          | **A New world button** (name, optional image, scale) and editing the brief on the page; everything else over MCP                                                                                                                         |
| **R1**  | Where terrain lives            | **As the region map's ground:** terrain areas are ground items with terrain materials, the topmost wins at a point. No separate layer                                                                                                    |
| **R2**  | A world's own terrain kinds    | **A world can add its own ground material** over MCP: an id, a name, the built-in one it behaves as (for travel and cost) and its own art                                                                                                |
| **R3**  | Region shapes                  | **A zone on the region map that names its region.** A realm's land is its regions together                                                                                                                                               |
| **R4**  | Adding realms and regions      | **`add_realms` and `add_regions` in batches.** A place's region and realm are taken from where it sits unless set by hand                                                                                                                |
| **R7**  | Is terrain drawn in play?      | **Drawn when the region map has no image,** in the world's art set; with an image, the image is the look and terrain is data under it (as the painter already does)                                                                      |
| **R8**  | Borders on the map             | **Realm borders as a soft coloured edge, with names,** on region maps that have no image                                                                                                                                                 |
| **PL4** | A route's path                 | **Optional waypoints:** drawn along them, its length following the line (no 1.25 winding factor)                                                                                                                                         |
| **PL7** | Rules on routes                | **In this epic:** routes take the same rules as places (`requiresAbility`, `hostileToFactionId`), set with `connect_locations`                                                                                                           |
| **AZ1** | The Azgaar importer            | **Kept as it is,** as a second way to start a world. New world from scratch becomes the primary path on the page (the user, 2026-11-12: "I do not want to lose the Azgaar import option, but it should no longer be the primary method") |
| **AZ2** | What to take from Nisia's save | **Everything:** biomes as terrain ground, the coast and lakes as water, rivers as lines, provinces as regions' zones, states as realms                                                                                                   |
| **AZ5** | How the conversion runs        | **The user shares the save by a Drive link** (never committed); a script in the repo turns it into geometry; Claude checks it with `view_image` and writes it with the patch tools after a dry-run report. No workflow                   |
| **GR1** | Grading                        | **A world:** its brief. **A region map:** terrain covering its land, every region with a shape. **A settlement:** inside a region. **A realm:** its land                                                                                 |
| **X1**  | Exit criterion                 | **As proposed** (§5)                                                                                                                                                                                                                     |

### 3.2 From 2026-10-10, as they stand

- **Kept:** W1 (worlds made on the page and over MCP), W4 (scale set at creation and changeable), PL1–PL3 (adding places, kinds with a free sub-type, settlement facts as plain fields), PL5 (a grid on the world map in `view_image`), PL6 (batch tools), R4 (overlaps: the topmost wins), R5 (Claude draws over MCP; no drawing tool on the page), R6 (a place's region and realm from where it sits).
- **Done by other epics:** W3 and W5 (positions in a map's own units, many maps: L-900), W7 (route kinds per map: L-900), AZ4 (Azgaar's pixel space is Nisia's map units: L-902).
- **Replaced:** W2 (by W2 above), R1–R3 and R7 (by R1–R3, R7 and R8 above: the layer is the region map's geometry), AZ1–AZ3 (by AZ1, AZ2 and AZ5 above; the `source` block stays as a record).

---

## 4. Design

### 4.1 The brief and New world (W2, W6, PG1, AZ1)

- **`world.brief`** is `{ genre, tone, era, artDirection }`, all short text, set with `create_world` and `update_world`.
- **The GM** gets a BRIEF line in its prompts every turn.
- **The studio:** `studio_generate` for a world with no style (`world.studio.styleId`) uses `artDirection` as its style text.
- **The Cartographer page:**
  - **New world** is the main button: a name, an optional studio image of kind `worldMap`, the scale. It makes a draft as `create_world` does.
  - The brief is shown and edited on the world's page.
  - **Import an Azgaar map** stays, as the second option beside it.

### 4.2 Realms, regions and terrain (R1–R4, R6)

- **Terrain is ground** on a region map: ground items with terrain materials, a later one over an earlier one. The terrain at a point is `groundAt`; a point outside every item has none.
- **A region's shape** is one or more zones on a region map with `region: <regionId>`. A region's land is its zones together; a **realm's land** is its regions' land. A region may have zones on more than one map.
- **A place's region** is the topmost zone naming a region at its position, and its realm is that region's realm, unless set by hand (R6).
- **`add_realms`** and **`add_regions`** create the entities `update_faction` and `update_region` already edit, in batches; a region names its realm.
- **`where`** (MCP) reads what lies at a point on a map: terrain, region, realm, and the zones there.
- **`view_image`** of a region map can draw regions or realms on top, with a legend.

### 4.3 A world's own terrain (R2)

- **`world.materials`**: `[{ id, name, like, art? }]`, set with `set_world_materials`. `like` names the built-in ground material it behaves as (travel cost, water); `art` a library image, drawn by the painter in place of `like`'s.
- Geometry checks accept a world's own ids as ground materials. The ids can't clash with built-in ones.
- `list_materials` lists them with the built-ins; `loomGetMap` sends them as links, as it does objects' art.

### 4.4 The map in play (R7, R8)

- **Terrain:** already drawn from the ground on a region map with no image, and hidden under a map's own art (L-924, EX2). No change.
- **Realm borders:** on a region map with no image, each realm's land gets a soft edge in its colour (a new `colour` on the realm, set with `add_realms` or `update_faction`, else one picked from its id) and its name at its land's centre, under routes and places.

### 4.5 Routes (PL4, PL7)

- **Waypoints:** a route (`connect_locations`, and a region map's `links`) takes optional `waypoints`, a list of points in the map's units. It's drawn along them, and its length is the line's length × scale, with no winding factor.
- **Rules:** a route takes `rules: { requiresAbility, hostileToFactionId }`, read as they are on places: travel and journeys refuse or warn by the same rules.

### 4.6 The GM knows where

- A WHERE line in the GM's prompts: the terrain, region and realm at the player's position on the lowest region map of their path, from `where`.

### 4.7 Nisia from its save (AZ2, AZ5)

- **`scripts/azgaar/`** reads an Azgaar save file and writes the geometry for its top region map as JSON, with a dry-run report (counts, areas, warnings):
  - **Terrain:** cells merged by biome into polygons, Azgaar's biomes mapped to the built-in terrain materials;
  - **Water:** the ocean, lakes and the coast as water ground;
  - **Rivers:** as `river` lines;
  - **Regions:** provinces as zones, each naming a region (made if missing, matched by name);
  - **Realms:** states as realms.
- Nisia's pixel space is already its map units (L-902), so nothing moves.
- **Claude runs it from a session:** the user shares the save by a Drive link (never committed); Claude checks the result with `view_image` and writes it with the patch tools and `add_realms`/`add_regions`. No workflow or service account.

### 4.8 Grading (GR1)

This epic adds the criteria the grading rework planned for it ([`the-loom-grading.md`](./the-loom-grading.md) §4.3), by the rule in its §4.6:

- **World:** a brief.
- **Region map:** terrain covering its land; every region on it with a shape.
- **Settlement:** inside a region.
- **Realm:** its land (at least one region with a shape).

---

## 5. Exit criterion

A world made from scratch over MCP, with a brief, its land painted as terrain and its regions and realms shaped, is published and played with no Azgaar in the loop and no map image; it looks painted in play. The GM names the terrain, region and realm the player is in. Nisia has its terrain, rivers, regions and realms from its save. Both worlds' scores count the brief and the layer.

---

## 6. Sub-issues (filed 2026-11-12)

| ID           | Story                                                                                                                                                             | Depends on   | Model  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-711 (#816) | **The brief and New world:** `world.brief`, the BRIEF line, the studio's default style, New world and the brief on the page, the importer kept                    | —            | Sonnet |
| L-712 (#817) | **Realms, regions and terrain:** regions' zones, realms' land, `add_realms`/`add_regions`, places' region and realm from position, `where`, `view_image` overlays | —            | Opus   |
| L-713 (#818) | **A world's own terrain:** `world.materials`, `set_world_materials`, checks, travel cost, art in the painter                                                      | —            | Sonnet |
| L-714 (#819) | **Realm borders in play:** soft edges and names on region maps with no image                                                                                      | L-712        | Sonnet |
| L-715 (#820) | **Routes:** waypoints, length along the line, rules on routes                                                                                                     | —            | Sonnet |
| L-716 (#821) | **The GM knows where:** the WHERE line                                                                                                                            | L-712        | Sonnet |
| L-717 (#822) | **Nisia from its save:** the converter script, its dry run, and Nisia's layer written                                                                             | L-712        | Opus   |
| L-718 (#823) | **Grading:** brief, terrain coverage, shaped regions and realms, settlements in regions                                                                           | L-711, L-712 | Sonnet |

**Order:** L-711, L-712, L-713 and L-715 can start at once. L-714, L-716 and L-717 follow L-712. L-718 follows L-711 and L-712.

---

## 7. Checked against a first world

The user's first world: _"A large fantasy steampunk world. A single continent with many biomes and burgs. There should be a few visibly large cities. Should have a few large bodies of water and an inland sea. Should lean medieval with ancient looking cultures and one visibly advanced with railroads."_

| Need                                     | Where it is met                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Steampunk, leaning medieval              | The brief (W6): genre, era and art direction, given to the GM and the studio               |
| A single continent, visibly large cities | Terrain ground for the land (R1), or a studio map image (W2); cities with population (PL3) |
| Many biomes                              | Terrain materials, plus the world's own (R2)                                               |
| Large bodies of water, an inland sea     | Water ground (R1), and sea routes across it                                                |
| Many burgs                               | `add_locations` in batches (PL6)                                                           |
| Ancient-looking cultures                 | Culture on settlements (PL3), realm descriptions and lore                                  |
| One advanced realm with railroads        | A `rail` route kind on the region map (L-900), routes along the rail by waypoints (PL4)    |
