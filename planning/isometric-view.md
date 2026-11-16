# The Loom — The Isometric View — Design Document v0.1

**Status:** Decided (2026-11-15). The gap sheet (§3) is answered. The spike (§5) is built and reported ([`isometric-spike-report.md`](./isometric-spike-report.md)); its checkpoint is answered (§3, 2026-11-15). L-950's stories L-951 to L-957 are filed as #857–#863 (§6); L-960's are filed when it is next.
**Project:** Olympus (`olympus-dfa00`)
**Epics:** L-950 the isometric view (#852), L-960 reworking the worlds (#853); Phase 10 — Levels and Vehicles (milestone #26).
**Replaces:** the three-quarter view on grid maps ([`game-art.md`](./game-art.md), L-941). Town and region maps keep it.
**Depends on:** L-920 (maps drawn from their data), L-940 (the painter, art sets, the pipeline), L-930 (standing tokens).
**Related:** [`game-art.md`](./game-art.md), [`art-spike-report.md`](./art-spike-report.md), [`maps-from-data.md`](./maps-from-data.md), [`tokens.md`](./tokens.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

Grid maps (battle maps, interiors, dungeons, decks, wilderness event maps) are where players use objects, walls and doors. The three-quarter view (L-941) draws them awkwardly. The floor plan is seen straight on, and walls rise up the screen:

- east-west walls show a face;
- **north-south walls show only their top, a thin vertical line;**
- doors in them are hard to see and to click.

The user found this in play (2026-11-15).

An **isometric view** turns the map 45° and looks down at an angle. Walls in both directions show a face, doors in both stand upright, and 2D art gives a 3D feel, as in classic isometric RPGs.

**The rules don't change.** Movement, sight, fog and the geometry stay in feet on the flat map. Only drawing and clicking change, so worlds' data, saves and the server need no migration.

---

## 2. What there is today

- **The painter** (`paint.js`, L-924, L-941–L-943) draws every map from its geometry, in an oblique three-quarter view:
  - ground laid flat;
  - walls with faces rising 0.6 of their height up the screen;
  - doors and windows standing in east-west walls;
  - objects standing on their feet;
  - all of these sorted by how far down the screen they stand, with the drawer's tokens;
  - contact shadows, soft floor edges, variants and culling (L-943);
  - things over a token or the pointer fade (L-942).
- **The art set** `classic` (L-946): 119 pictures in three-quarter view. These are 65 materials (floors, wall faces, door and window fronts, lines) and 45 catalog objects and decor.
- **A grid map can have its own painting** (EX2), drawn in place of its floor and walls. Nisia has 43. They are top-down paintings.
- **A world's own art:** pictures for its object kinds, its own materials and single objects.
- **Grading** (L-947) counts a map's look; a map with its own art earns a small bonus.
- **`view_image`** draws maps top-down for Claude.
- **Worlds:** Nisia, The Border March (the combat test world) and The Corpse Tide are published. There is no way to unpublish a world.

---

## 3. Decisions (the user, 2026-11-15)

Settled through a questionnaire. AR2 was then refined by a follow-up question.

### The view

| ID      | Question            | Decision                                                                                                                                 |
| ------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **IS1** | Which maps          | **Grid maps only:** battle maps, building interiors, dungeons, decks and wilderness event maps. Region and town maps keep today's look   |
| **IS2** | The angle           | **Classic 2:1 game isometric:** a square becomes a diamond twice as wide as tall                                                         |
| **IS3** | Turning the camera  | **A fixed camera;** each prop drawn in two facings, mirrored to give all four, so a turned chest shows its side                          |
| **IS4** | Seeing behind walls | **Walls between the camera and a token, the pointer or the path fade** (as L-942), **plus a button that drops every wall to a low stub** |
| **IS5** | Wall thickness      | **Walls drawn with a thickness** (about a foot, by material) and a top cap. The geometry stays a line                                    |

### The art

| ID      | Question                | Decision                                                                                                                                                                                                                                                                                                  |
| ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AR1** | What gets painted again | **Only standing props:** the 45 catalog objects and decor, in isometric, in two facings (about 90 pictures, about $10). Floors, wall faces, doors and windows are reused, laid onto the isometric planes by the painter                                                                                   |
| **AR2** | Painted battle maps     | **Today's top-down paintings are retired at the grid level:** grid maps draw from their geometry and the art set; paintings stay on region and town maps. **An isometric painting of a grid map** (the user's note on PL3) is tried in the spike, and how it is drawn is decided at its checkpoint (§5.3) |
| **AR3** | A world's own art       | **A clean break:** library images get a view (isometric or not); the isometric painter ignores art not made for it and uses the set's instead, until the rework (L-960) replaces it                                                                                                                       |
| **AR4** | Review of the new props | **As L-946:** Claude rejects what fails the checks (angle, facing, key colour); the user approves each batch from a board                                                                                                                                                                                 |

### Clicking

| ID      | Question           | Decision                                                                                                                                                                                                          |
| ------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IN1** | What a click picks | **The front-most thing under the pointer by its drawn shape** (a token, a door, a prop, a wall), else the floor there; a hover outline shows what a click will pick, and a door's target covers its whole doorway |
| **IN2** | The 5 ft grid      | **A faint diamond grid shown while moving or aiming,** hidden otherwise                                                                                                                                           |
| **IN3** | What Claude sees   | **`view_image` stays top-down:** exact for building and checking geometry. An isometric preview can come later                                                                                                    |

### The worlds and the plan

| ID      | Question                       | Decision                                                                                                                                                                                                                                                               |
| ------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **WD1** | Publishing during the overhaul | **All three worlds are unpublished when the new view lands,** with no compatibility work; L-960 republishes each as it's done. A small unpublish tool (MCP and the page) is added                                                                                      |
| **WD2** | The rework's order             | **The Border March first** (small, the test bed), **then The Corpse Tide, then Nisia** (the largest)                                                                                                                                                                   |
| **PL1** | A spike first                  | **Yes:** a prototype on a branch, with isometric props from the studio, on a preview the user plays before the epic is filed (§5). The user: "with the spike we should be able to identify any issues with the rendering art"                                          |
| **PL2** | Where it goes                  | **L-950 next, then L-960 reworking the worlds, then the dungeon epic**                                                                                                                                                                                                 |
| **PL3** | Grading                        | **Unchanged:** a map's own art keeps its bonus. The user: "Gemini-generated images will always look better. It just needs to be generated in the same isometric perspective in order to support map data." Own art counts when it is made for the isometric view (AR3) |
| **PL4** | Exit criterion                 | **As proposed** (§7)                                                                                                                                                                                                                                                   |

### The checkpoint (the user, 2026-11-15, after playing the preview)

| ID     | Question                         | Decision                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | Go ahead?                        | **Yes**                                                                                                                                                                                                                                                                                       |
| **C2** | How tall walls look              | **The true 2:1 height:** a foot of height rises 1.22 floor units up the screen                                                                                                                                                                                                                |
| **C3** | The props' look                  | **Approved** for the whole set                                                                                                                                                                                                                                                                |
| **C4** | Isometric paintings of grid maps | **Floor only:** a grid's own painting is its floor, under walls, doors and props standing from its data                                                                                                                                                                                       |
| **C5** | Anything wrong in play           | **Props looked small and rooms empty.** Scaling floors, doors or props didn't help (tried on the preview); the user: "we probably just need to fill the rooms more so they don't seem so empty. Not a problem I want to deal with now." Left to the rework (L-960), with `dress_room` (L-945) |

---

## 4. Design

### 4.1 The projection (IS1, IS2)

- **Grid maps only** are drawn isometric. A grid opened from a town zooms in as today and is drawn in its own projection.
- **2:1 dimetric:** a point `(x, y)` in feet at height `z` is drawn at `sx = (x − y) · k`, `sy = (x + y) · k / 2 − z · k · r`.
  - `k` sets the zoom; a 5 ft square is a diamond twice as wide as tall.
  - `r` sets how tall a foot of height looks: 1.22, the true 2:1 height (C2).
  - The map's north points to the top right of the screen.
- **Clicks on the floor** are worked back from the screen (`x`, `y` at the floor's height under the pointer).
- **The camera** pans and zooms as now, over the map's diamond. A margin leaves room for walls and props rising at its top edge.
- **Walls at 45°** on the map appear as vertical lines in isometric. This is the old awkwardness, moved to diagonals. The generators build square-on walls, and the rework favours them.

### 4.2 The painter (IS3, IS5, AR1)

- **Floors:** each ground picture laid onto the isometric floor plane (an affine transform of the top-down texture), with L-943's soft edges and variants.
- **Walls** are prisms: the geometry's line given a thickness by material (about a foot) and its height. Each side face is drawn with the material's face picture laid onto it, shaded by its direction. The top cap uses the material's top texture.
- **Doors and windows** stand in walls in both directions as panels laid onto the wall's plane. An open door swings into the room.
- **Props** stand on their feet at their size in feet. Their picture is chosen by facing: the object's `turn` picks one of two painted facings, mirrored for the other two.
- **Depth order:** everything standing (walls, doors, props, tokens) is drawn back to front. One depth number per piece mis-orders a prop beside a wall (the spike's desk showed through a wall near its end), so pieces whose drawn shapes overlap are ordered by which side of a wall each stands on, the way isometric engines sort, and tokens are placed in that order as they move. Walls are cut into pieces of at most a tile and a half (7.5 ft).
  - **Decided in L-952 (the user, 2026-11-16), replacing half a tile:** ordered by footprint, the cut no longer decides the order. Pieces of up to a tile and a half order every overlapping pair right on the large fixture and 60 generated maps; at two tiles a few pairs in rings go wrong. Speed on the large fixture, CPU slowed 4×: half a tile 1.3–1.5× three-quarter (over the story's 1.2×), a tile 1.05–1.17×, a tile and a half about 0.9×. L-952 cuts walls at a tile and a half; fading (L-953) fades a stretch that long.
- **Contact shadows** sit under props and tokens and along walls' feet, laid on the floor plane. **Culling works on isometric screen boxes:** the spike drew 15–50% slower without it.
- **Fog** darkens the floor diamonds not seen, and dims what stands on them.

### 4.3 Seeing behind walls and clicking (IS4, IN1, IN2)

- **Fading:** anything standing in front of a token, the pointer or the path preview fades to 30%, as L-942 does, with "in front" judged on the isometric screen.
- **Walls low:** a button on the grid view drops every wall to a stub (about 2 ft) until pressed again.
- **Picking:** the front-most thing whose drawn shape is under the pointer, else the floor point.
  - A door's target is its whole doorway prism, so a door is easy to hit in either wall.
  - A hover outline shows what a click will pick.
- **The grid:** faint 5 ft diamonds while a move or an aim is being chosen.

### 4.4 Art by view (AR1–AR3)

- **The art set** gains isometric props: each catalog object and decor kind in two facings, made with the studio in a new saved style ("Loom painted isometric"). They are reviewed by board per batch (AR4) and packed into atlases within the size budget (L-944). The three-quarter props stay for town maps.
- **The manifest** gives each object an `iso: { facings: [picture, picture], foot }` beside its three-quarter picture.
- **Library images** get a `view`: `iso`, `three-quarter` or `top-down`, set by `studio_generate`, `studio_import` and `studio_update`. Assigning art to a grid map, an object kind, a world material or an object checks it. On grid maps the painter draws only `iso` art, else the set's.
- **Grid paintings (AR2, C4):** today's top-down paintings, which show walls and furniture, are no longer drawn on grid maps. A grid's own painting is a **floor painting** (`view: 'floor'`): its floors only, painted from a guide of the map's floor geometry (`view_image` with `floor: true`). The painter lays it under everything standing, as the isometric floor, exactly as it lays a floor picture. Walls, doors and props always stand from the data, so fading, walls-low and doors' states keep working.

### 4.5 Grading (PL3)

Unchanged in its criteria: a map's look counts (L-947), and a map's own art keeps its bonus. On a grid map, only art made for the isometric view counts toward the look, and a floor painting earns the own-art bonus.

### 4.6 Unpublishing (WD1)

- **`unpublish_world`** (MCP) and an Unpublish button on the Cartographer page set a world back to draft, kept whole.
- The Loom's world list hides it. A save in it says the world is being reworked and can't be played until it is published again. Nothing in the save is lost.

---

## 5. The spike (PL1)

### 5.1 What it answers

1. **Does the isometric view fix the feel in play?** That means doors in both directions easy to see and click, walls with faces, props reading clearly, and tokens behind walls.
2. **Can the studio paint isometric props** in two consistent facings, in the painted style, as reliably as three-quarter (18 of 18 in the last spike)?
3. **Do the reused flat surfaces look right** (floors, wall faces, doors and windows laid onto the planes)?
4. **What does the painter cost:** draw time on the large fixture with the CPU slowed four times, against the 2 s budget?
5. **Isometric paintings of a grid map** (AR2): can the studio paint one from an isometric guide of the map's geometry so that it lines up? Is it better drawn:
   - **whole,** with the painting's own walls redrawn over tokens behind them (cut out by the geometry); or
   - **as the floor only,** under walls, doors and props standing from the geometry?

### 5.2 How

- **On a branch** (`spike/isometric`): the painter's isometric mode, switched on for grid maps by `?view=iso`. It covers:
  - projection and floor picking;
  - walls as prisms in both directions, doors and windows both ways;
  - props by facing, depth order;
  - fading and the stub button.
- **About 12 props** in two facings from the studio: chest, barrel, crate, table, chair, bookshelf, bed, wardrobe, altar, brazier, statue and a pillar. They're made as sheets in a new style, through `scripts/art/`.
- **One isometric painting** of the test dungeon, made from an isometric layout guide of its geometry, drawn both ways (§5.1, question 5).
- **A playable preview:** the branch's preview channel serves the page against the live worlds. The user plays The Border March with `?view=iso` (walk, open doors in both directions, open chests, walk behind walls), since the view needs no server change.
- **Screenshots** of the test dungeon, a generated interior and a wilderness map, three-quarter and isometric side by side.

### 5.3 The checkpoint

The user plays the preview and rates the view, the props and the two ways of drawing a painting, then picks one of:

- whole with walls cut out;
- floor only;
- no isometric paintings.

The stories of §6 are then filed, updated for what the spike found.

### 5.4 Limits

- **Budget:** up to $10 of image generation; expected about $3.
- **The user's time:** one checkpoint, playing the preview (about 20 minutes).
- **Merged:** the report (`planning/isometric-spike-report.md`) and anything of the pipeline worth keeping; the prototype stays on the branch.

---

## 6. Epics and sub-issues

### L-950 The isometric view

| ID           | Story                                                                                                                                                                         | Depends on | Model  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| L-951 (#857) | **The projection and camera:** isometric grid maps in the engine, floor picking, pan and zoom, the margin, the 5 ft diamonds                                                  | —          | Opus   |
| L-952 (#858) | **The painter in isometric:** floors laid on the plane, walls as prisms with faces and caps, doors and windows both ways, props by facing, depth order, shadows, culling, fog | L-951      | Opus   |
| L-953 (#859) | **Seeing and picking:** fading in isometric, the walls-low button, front-most picking with the hover outline, doorway targets                                                 | L-952      | Opus   |
| L-954 (#860) | **The isometric props:** the style, 45 objects and decor in two facings, boards per batch, the manifest's facings, atlases in the budget                                      | —          | Sonnet |
| L-955 (#861) | **Art by view, and floor paintings:** images' `view`, a world's own art filtered on grids, top-down grid paintings retired, floor paintings (C4)                              | L-952      | Sonnet |
| L-956 (#862) | **Grading:** the look and the own-art bonus counting isometric art on grids                                                                                                   | L-955      | Sonnet |
| L-957 (#863) | **Unpublishing worlds:** `unpublish_world`, the page's button, saves paused                                                                                                   | —          | Sonnet |

**Order:** L-951, L-954 and L-957 can start at once. L-952 follows L-951. L-953 and L-955 follow L-952. L-956 follows L-955. When the epic ships, the three worlds are unpublished (WD1).

### L-960 Reworking the worlds

| ID    | Story                                                                                                                                                                                                     | Depends on | Model |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----- |
| L-961 | **The Border March:** every grid dressed from data (materials, props, and rooms filled with decor by `dress_room`, so they don't read empty, C5), its own art made isometric, played through, republished | L-950      | Opus  |
| L-962 | **The Corpse Tide:** the same                                                                                                                                                                             | L-961      | Opus  |
| L-963 | **Nisia:** the same, its 43 painted battle maps first, split by region as the work list shows                                                                                                             | L-962      | Opus  |

---

## 7. Exit criterion

On a phone and a desktop, the test dungeon and a generated interior play in isometric:

- walls in both directions with faces and thickness;
- doors in both directions easy to see and click;
- props standing in isometric art in their facings;
- walls fading behind tokens, and the stub button;
- clicks picking the right thing;
- drawn in under 2 s on a slow phone.

After L-960, all three worlds are republished.
