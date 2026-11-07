# The Loom — Game Art in Three-Quarter View — Design Document v0.1

**Status:** Decided (2026-11-07). The gap sheet (§3) is answered. Sub-issues filed 2026-11-07 (#795–#801, §6). **In progress:** L-941 the three-quarter view shipped 2026-11-07 (#803); L-944 art sets and delivery shipped 2026-11-07 (#804); L-943 the painter's finish built 2026-11-07 (§4.2, Decisions).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-940 (#794), Phase 10 — Levels and Vehicles (milestone #26). Built next, before L-930 tokens and L-710 worlds without Azgaar.
**Depends on:** L-920 (maps drawn from their data), L-700 (the image studio), the game art spike (`scripts/art/`, the painter's PNG art).
**Related:** [`art-spike.md`](./art-spike.md), [`art-spike-report.md`](./art-spike-report.md), [`maps-from-data.md`](./maps-from-data.md), [`tokens.md`](./tokens.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

The spike showed that the image studio can make a coherent game art library, and that a **three-quarter view** suits both the art and the look (`art-spike-report.md` §7):

- 18 of 18 three-quarter props were usable first time;
- rooms read as built spaces.

This epic makes the three-quarter view, and the art for it, the way every map drawn from data looks:

- walls with faces, doors and props standing, people as standing tokens;
- the painter doing shadows, soft floor edges and fades;
- the whole built-in set painted in one sword-and-sorcery look, with decor to fill rooms.

Maps with their own artwork stay as they are, and score a little higher.

---

## 2. What there is today

- **The painter** (`paint.js`, L-924) draws every map from its geometry, top-down, item by item, cached per map. It scales art by each picture's own size and a ground picture's span; `PNG_ART` in `materials.js` names art made as pictures (empty).
- **The art** is 95 SVG files drawn by `scripts/build-art.js`.
- **`scripts/art/`** (the spike) fetches, slices, keys, makes seamless, fits and checks studio images.
- **The spike branch** (`spike/game-art`) holds a three-quarter prototype in `paint.js` (`view: 'oblique'`), 28 top-down and 18 three-quarter assets, and two saved studio styles.
- **Maps with their own art** (EX2) draw it in place of their ground and walls, with objects on top.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-11-07) and three follow-ups. Every answer took the recommendation; the user's notes are marked.

### The view

| ID      | Question            | Decision                                                                                                       |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------- |
| **TV1** | Seeing behind walls | **A wall's face fades to a ghost** when a token, the cursor or a path preview is behind it                     |
| **TV2** | Height and angle    | **Each wall's own height** (its geometry's, 8 ft unless set), **one angle for the game**                       |
| **TV3** | Open doors          | **An open door swings into the room** as a thin upright leaf seen edge-on, depth-sorted like a prop            |
| **TV4** | The top edge        | **A margin above the map** for walls and props on its top edge to rise into                                    |
| **TV5** | Top-down            | **Only the painter's fallback:** an object with no three-quarter art is drawn flat, as today; no player switch |

### Tokens

| ID      | Question | Decision                                                                                                                                                                                    |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TK1** | People   | **Standing tokens:** L-930's round framed portrait on a small base, upright and depth-sorted. **Full standing figures come later, in an epic of their own, low priority** (the user's note) |
| **TK2** | When     | **L-930 is built after this epic's view work,** its drawing revised to stand (§4.7)                                                                                                         |

### The art

| ID      | Question       | Decision                                                                                                                                                                       |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **AR1** | The first set  | **Every built-in material and catalog object,** sword and sorcery: about 60 materials (floors and terrain, walls with faces, doors, windows, lines) and the 30 catalog objects |
| **AR2** | Other games    | **Their sets come with the epics that bring them,** in the same pipeline                                                                                                       |
| **AR3** | A world's look | **Art sets:** the built-in set is the default; a world can name another set, and keeps its own objects' art over MCP                                                           |
| **AR4** | Floor variants | **Up to three per floor,** made without references; the painter picks one per area by its id                                                                                   |
| **AR5** | Wood and lines | **Remade until they repeat cleanly,** the seam check deciding                                                                                                                  |
| **AR6** | Review         | **Claude rejects what fails the checks; the user approves each batch from one board** before it's committed                                                                    |
| **AR7** | Where it lives | **In the repo** under `public/apps/loom/art/`                                                                                                                                  |

### Dressing, scale and grading (the user's notes, and follow-ups)

| ID      | Question     | Decision                                                                                                                                                                                                                   |
| ------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DR1** | Empty rooms  | **Decor:** objects marked decor have no click menu and block movement only if large; a **decor set** comes in the first batch; a seeded **`dress_room`** tool fills a zone to a chosen density                             |
| **SC1** | Scale        | **Art is always drawn at the object's size in feet,** never the picture's. An object far from its kind's usual size, or overlapping a wall, **warns** on save (not refused); `view_image` can show sizes                   |
| **GR1** | Grading      | **A map's look:** every material and object on it has painted art (none falling back to SVG or the "?" box)                                                                                                                |
| **GR2** | Art and size | **Maps with their own artwork earn a small bonus** ("art-based maps still look best", the user's note); **a large map drawn from data can still reach the top grade on its data alone**, with no penalty for having no art |

### Engine and plan

| ID      | Question    | Decision                                                                                                  |
| ------- | ----------- | --------------------------------------------------------------------------------------------------------- |
| **EN1** | Format      | **WebP,** floors at most 1024 px for five squares, props at their size; **a size budget the tests check** |
| **EN2** | Atlases     | **Now:** props, decor and wall faces packed into atlases by the build                                     |
| **EN3** | Floor edges | **Soft:** the upper floor fades over the lower along their border                                         |
| **EN4** | Shadows     | **Drawn by the painter** under every prop and token and along the foot of each wall                       |
| **EN5** | Culling     | **In this epic:** items outside the view aren't drawn                                                     |
| **PL1** | Where       | **L-940, Phase 10, built next,** before L-930 and L-710                                                   |
| **PL3** | Exit        | **Kept** (§5)                                                                                             |

---

## 4. Design

### 4.1 The view (TV1–TV5)

- **The painter draws three-quarter** for every map drawn from data; there's no top-down switch. It builds on the spike's prototype:
  - walls: a front face up the screen, its top strip on it, 0.6 of its height per foot (one constant), angled walls slanted, north-south walls showing their top;
  - closed doors and windows: upright panels; open doors swing as an upright leaf;
  - walls, doors, windows, objects and tokens in one layer, ordered by how far down the screen their foot stands;
  - a margin above the map (the tallest wall's height) so nothing is clipped.
- **Objects stand** on the south edge of their footprint, drawn at their size in feet (SC1): as wide as their size, as tall as their three-quarter picture's proportions. One with only top-down art (or the "?" box) is drawn flat, as today (TV5).
- **The rules don't change:** movement, sight, fog, clicks and paths stay on the flat map. A click on a standing object's picture selects it.
- **Maps with their own art** (EX2) keep their art; their objects and tokens stand on it.
- **Fading (TV1):** a wall face, and a tall object, that covers a token, the cursor or the path preview fades to a ghost.

### 4.2 The painter's finish (EN3–EN5, AR4)

- **Contact shadows:** a soft ellipse under each object and token, and a soft band along the foot of each wall.
- **Soft floor edges:** where two ground shapes meet, the upper one fades over the lower along its border.
- **Floor variants:** a material with variants draws one per ground area, picked by the area's id, so a floor never visibly repeats over a large room.
- **Culling:** items whose bounds lie outside the view (plus a margin) aren't drawn, and are drawn again as the view moves.

### 4.3 Art sets and delivery (AR3, AR7, EN1, EN2)

- **An art set** is a folder of pictures under `public/apps/loom/art/sets/<set>/` with a manifest: for each material and object, its file, its span (ground) or its picture's foot (objects), its variants, and its atlas frame.
- **The built-in set**, `classic`, is the default. A world names another with `world.art.set` (`update_world`); `list_art_sets` lists them. A world's own object art (`set_object_art`) still wins over any set's.
- **Today's SVGs** stay as the fallback for anything a set lacks.
- **Format (EN1):** WebP. Floors at most 1024 px for five squares, props at their size at 64 px a foot. A test fails if any picture, or a set's total, passes its budget.
- **Atlases (EN2):** the build packs a set's props, decor and wall faces into atlas sheets with a frame map; the painter loads the atlas once.
- **`materials.js`** reads the manifest instead of `PNG_ART`; both copies stay identical.

### 4.4 Making the first set (AR1, AR2, AR4–AR6)

- **Two studio styles:** "Loom painted three-quarter" for props, decor, doors and wall faces; flat textures for floors, wall tops and lines with the floor reference.
- **Props and decor in sheets of nine,** square-on to the viewer (a review check: no diagonal, isometric-looking props).
- **Floors** up to three variants each, made without references; wood and other lined textures remade until the seam check passes (AR5).
- **Walls:** a top texture and a face texture for every wall material.
- **The pipeline** (`scripts/art/`) gains `webp`, `atlas` and `board` steps. `board` lays a batch out for the user to approve (AR6).
- **About $10–15** of generation for the set, checked with `studio_costs` per batch.
- **Other games' sets** come with their epics (AR2).

### 4.5 Decor (DR1)

- **`decor: true`** on an object: no click menu, never noticed or searched, and it blocks movement only if its size is over 2.5 ft in both directions (a pile of crates does; candles, cobwebs and bones don't). It still blocks sight if tall.
- **Decor kinds** in the catalog, painted in the first set: rubble, bones, candles, cobwebs, sacks, crate piles, tapestries, banners, plants, books, bottles, straw, puddles, chains.
- **`dress_room`** (MCP): fills a zone with decor to a density (sparse, lived-in, cluttered) for a theme (dungeon, tavern, crypt, store, bedroom), seeded, keeping clear of doors, walkways and existing objects, so the way through stays open (L-922's paths are checked). Claude edits the result with the patch tools.

### 4.6 Scale (SC1)

- **Art is drawn at the object's size in feet,** whatever the picture's size.
- **Warnings on save** (`set_objects`, `place_figures`, generators): an object whose size is under half or over twice its kind's usual size, or which overlaps a wall. The warning names it and its usual size.
- **`view_image`** gains `sizes: true`: each object's footprint and size drawn over it.

### 4.7 Tokens (TK1, TK2)

- **L-930 is revised** before it's built: its round framed portrait stands on a small base, upright, depth-sorted, with its contact shadow. It still has the ring coloured by side, is sized by size class, and fades with walls. Its other stories (pictures as data, the player's token, portraits and grading) are unchanged.
- **Full standing figures** go to "Not yet placed" as a later, low-priority epic (TK1).

### 4.8 Grading (GR1, GR2)

In `grading.js`, with `the-loom-grading.md` updated:

- **Map, the look (GR1):** every material and object on it has painted art in its world's set or its own; none falls back to SVG or the "?" box.
- **Map, art (GR2):** a map with its own artwork earns a small bonus.
- **Large maps (GR2):** a map over 60 squares a side drawn from data can reach the top grade on its data alone.

---

### 4.9 Decisions while building

- **L-941, 2026-11-07:**
  - **Standing pictures are named in `materials.js`** (`STAND_ART`: a wall material's `face`, an object kind's `stand`), empty until L-946 paints them; L-944's art sets replace the table. An object with art of its own or its world's (a library image) lies flat until sets say which pictures stand (TV5). So until then only walls, doors and windows stand.
  - **Walls are cut into pieces 5 ft down the screen** (a grid's square; a tile elsewhere), so an angled or north-south wall takes its place in the depth order along its length; one running across the screen is one piece. A north-south wall shows its top and its south end.
  - **Doors and windows:** a door 7 ft high (or its own `height`, or its wall's if lower), the wall going on over it; a window from a 3 ft sill to 6.5 ft (or its `height`). In a wall running down the screen a shut door's picture is the top strip over its gap, so it still shows. An open door's leaf is a thin slab swung 75° on its hinge, as before.
  - **The grid view's order:** ground, art and the flat map; its overlays (reach, grid, areas, hazards); the dark fog and mist; the standing layer, with the tokens (yours too), cut to the columns over the squares seen so a face rises over squares unseen and nothing beyond shows; then the dimming of squares out of sight, over everything standing too; names, the way and cards. The town and world views keep their tokens on top: their maps have few walls, and standing tokens come with L-930.
  - **A foot of height** is a map unit on a grid, a foot in metres on an area map, and on a region map what a wall a foot and a half thick would rise on a grid.
  - **Room above:** the grid view's top margin is its tallest wall's rise and a little (at least the 60 px of before), and the map is framed with it in view.

- **L-944, 2026-11-07:**
  - **A picture** in a manifest is `{ file }` (under the set's folder) or `{ atlas, frame: [x, y, w, h] }`; materials are keyed `<kind>/<id>`, objects by kind. An entry is its picture seen from above, with `span` and `variants` (a ground's), `face` (a wall's) and `stand` with its `foot` (an object's: the point of the picture, 0–1 across and down, on its footprint's south edge; `[0.5, 1]` unless it says). A manifest naming a material or object the catalog hasn't, an atlas it hasn't, or a frame outside its atlas, isn't registered.
  - **`materials.js` keeps a registry of sets** (`registerSet`), filled on the page by the painter fetching a set's manifest the first time a map names it, and on the server by `art-sets.js` from its copies (`functions/loom-canon/art-sets/<set>.json`, the same bytes as the public manifests, a test checking). `STAND_ART` and `PNG_ART` are gone: `classic`'s manifest replaces them, empty until L-946.
  - **A world's set** is `art.set`, written by `update_world` (`art: { set }`), which refuses a set there isn't; a world naming one there isn't (a set later removed) is drawn with `classic` and `get_world` warns. `loomGetMap` sends `artSet` on the map, the town and the battle map.
  - **Atlases hold props, decor and wall faces** (EN2): the pipeline's `atlas` step packs a set's object pictures and faces that are files into sheets of at most 2048 px (shelves, 2 px apart, lossless WebP), turns their entries into frames and removes the files; floors, strips and lines stay files, since they repeat. The painter loads an atlas once and cuts each frame from it; a frame drawn repeating (a face) is copied out of the atlas once, as a frame can't repeat inside its atlas.
  - **The budget** (`scripts/art/budget.cjs`): every set picture WebP; a floor at most 1024 px for five squares of its span, 400 KB; a strip 1024 × 256 px, 200 KB; a face 1024 × 512 px (64 px a foot of an 8 ft wall), 300 KB; an object 64 px a foot of its width and 1024 px high, 200 KB; an atlas 2048 px a side, 1.5 MB; a set 16 MB. The `webp` step fits a picture to its role's limits; the `budget` step and a test check every set the Loom serves.
  - **A card's picture** (L-926) is the object's set's standing picture when it's a file; a frame of an atlas can't be put on a card, so then the catalog's.

- **L-943, 2026-11-07:**
  - **Contact shadows** are the painter's, in a flat `shadows` layer on the floor, under the standing layer (so the grid view's dark fog covers them where unseen): a band along the foot of each wall, window and shut door, 1.5 ft out on the side its face shows, darkest at the foot; a wall running more down the screen than across, whose face can't be seen, a fainter, narrower band on its other side too; and a soft ellipse under each object standing, as wide as its footprint turned and a little more, drawn toward its foot so it shows below its picture. An object lying flat has none. Tokens standing in the grid view have their own, under their disc (`draw.js` `token`, `shadow: true`), from the painter's `shadowTexture()`.
  - **Soft floor edges** are drawn, not masked: a floor's edges whose outside lies on a floor drawn before it are stroked outward with the floor's own picture, in five strokes growing narrower and fainter to a foot past the edge, joined round at corners and cut square where a run ends. An edge over nothing (the map's edge, a gap) stays hard. Built once with the floor, nothing is done per frame, where a mask per floor would be a filter pass each frame; the issue's "a mask built once per map" is met by the strokes kept with the floor.
  - **Floor variants:** a floor picks among its picture and its set's variants by a hash of its id (FNV-1a), so the same area always shows the same one; a floor with no id by its index.
  - **Culling:** each piece of the drawing keeps its bounds in the map's units (a standing part's is its box). `cull(key, width, height)` works out what a screen that size shows of the map from where its drawer placed it (its root's and parents' position and scale), grows it by 15% of its long side (at least two tiles), and hides what lies wholly outside; everything stays built, and shows again as the view comes back. The grid, town and world views call it every draw. `describe()` marks a culled piece `culled: true`. In headless Chrome the large dungeon at 14 px a foot culls about nine in ten pieces and pans faster culled than not.

## 5. Exit criterion

- The test dungeon and a generated interior are drawn in the three-quarter view entirely in painted art:
  - walls with faces in stone, brick and wood;
  - doors that stand and swing;
  - every catalog object standing;
  - soft floor edges and contact shadows.
- A wall in front of the player fades.
- A room dressed with `dress_room` looks lived-in and can still be walked through.
- A large map draws in under 2 s on a slow phone, with all its art under the size budget.
- Nisia's battle maps look right with no change to their data.

---

## 6. Sub-issues (filed 2026-11-07)

| ID           | Story                                                                                                                                                                                                         | Depends on   | Model  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-941 (#795) | **The three-quarter view:** walls with faces, doors and windows standing and swinging, one depth-sorted layer, objects standing at their size, the top margin, the flat fallback, clicks on standing pictures | —            | Opus   |
| L-942 (#796) | **Seeing behind walls:** faces and tall objects fade when a token, the cursor or the path preview is behind them                                                                                              | L-941        | Sonnet |
| L-943 (#797) | **The painter's finish:** contact shadows, soft floor edges, floor variants by area, culling                                                                                                                  | L-941        | Opus   |
| L-944 (#798) | **Art sets and delivery:** sets and manifests, `world.art.set`, `list_art_sets`, WebP, the size budget and its test, atlases, `materials.js` from the manifest                                                | —            | Opus   |
| L-945 (#799) | **Decor and scale:** `decor` objects, the decor kinds, `dress_room`, size warnings on save, `view_image` sizes                                                                                                | L-941        | Sonnet |
| L-946 (#800) | **The first set:** every built-in material and catalog object and the decor set, in three-quarter view, through the pipeline (`webp`, `atlas`, `board`), approved in batches                                  | L-944, L-945 | Sonnet |
| L-947 (#801) | **Grading:** the look, the art bonus, large maps on their data                                                                                                                                                | L-944        | Sonnet |

**Order:** L-941 and L-944 first. L-942, L-943 and L-945 follow L-941. L-946 follows L-944 and L-945. L-947 follows L-944.

Tests:

- headless Chrome screenshots of the test dungeon and a generated interior in three-quarter view, with the fade, shadows and soft edges;
- depth order and culling checked by `describe()`;
- the size budget test;
- pure tests for decor blocking, `dress_room` keeping paths open (seeded), size warnings and the grading criteria;
- a real MCP client for `dress_room`, `list_art_sets` and the warnings.
