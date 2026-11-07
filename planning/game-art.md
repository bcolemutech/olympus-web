# The Loom — Game Art in Three-Quarter View — Design Document v0.1

**Status:** Decided (2026-11-07). The gap sheet (§3) is answered. Sub-issues filed 2026-11-07 (#795–#801, §6).
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
