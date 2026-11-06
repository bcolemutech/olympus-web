# The Loom — Game Art Spike — Scope v0.1

**Status:** Scoped (2026-11-06). Not an epic: a time-boxed experiment whose report decides whether, and how, an art epic is designed.
**Project:** Olympus (`olympus-dfa00`)
**Follows:** L-920 maps drawn from their data (#710, shipped 2026-11-06)
**Related:** [`maps-from-data.md`](./maps-from-data.md) (RD1–RD4, OB1, L-924, L-925), [`the-image-studio.md`](./the-image-studio.md)

---

## 1. Why

The aim is scenes drawn the way video games draw them:

- built live from map data;
- in one consistent art style;
- from a library of assets;
- with no AI images made during play.

L-920 built the engine half of this. `paint.js` draws every map from its geometry, one display object per item, cached and built a few milliseconds at a time.

What it draws with is not game art. The 95 files under `public/apps/loom/art/` are flat SVG made by `scripts/build-art.js`. They are consistent, but they read as placeholders.

The open question is whether **Claude, through the image studio, can make a coherent, game-ready asset library** at a cost and effort that's worth it. If it can't, a free open-licence pack might do better. This spike answers that with evidence before anything is designed.

---

## 2. What it answers

1. **Consistency:** do ~23 assets made in the studio look like one game?
2. **Fitness:**
   - do tiles repeat without visible seams?
   - do props cut out cleanly with transparent edges?
   - is everything truly top-down, at the right scale?
3. **Effort:** how many tries per accepted asset, and how much review from you?
4. **Cost:** dollars per accepted asset, and so a projection for a full setting (~150–300 assets).
5. **Method:** which way of generating works best?
   - one asset per call;
   - several related assets on one sheet, cut apart;
   - with or without reference images.
6. **Engine:** what PNG art costs in the painter (texture memory, draw time on the large fixture), and what it still lacks (culling, atlases, blending between materials).
7. **Direction:** studio-led, pack-led or hybrid?

---

## 3. Decisions (the user, 2026-11-06)

| ID      | Question             | Decision                                                                                                                                                                                 |
| ------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SP1** | The look             | **Hand-painted top-down,** like a painted virtual-tabletop map: textured stone, soft shadows, muted colour                                                                               |
| **SP2** | Budget               | **Up to $30** of image generation. Checked with `studio_costs` before each batch; the spike stops and reports if it nears the cap                                                        |
| **SP3** | An open-licence pack | **One CC0 top-down pack tried beside the studio's art,** as a third column. Its licence is checked before use; none of its files are merged                                              |
| **SP4** | What's merged        | **The report and the pipeline:** the asset pipeline scripts and the PNG switch in `materials.js` are merged, so an epic starts from them; the trial art itself stays on the spike branch |

---

## 4. The assets (23)

Chosen to dress the painter's test dungeon (`tests/fixtures/paint/dungeon.js`) and a generated dungeon (`generate_map`), and to cover every kind of art.

| Kind         | Assets                                                                 | Count |
| ------------ | ---------------------------------------------------------------------- | ----- |
| Ground tiles | flagstone, stone, marble, rock, dirt, wood, water                      | 7     |
| Line         | stream                                                                 | 1     |
| Walls        | stone, brick, rock                                                     | 3     |
| Doors        | wood, iron                                                             | 2     |
| Window       | glass                                                                  | 1     |
| Objects      | chest, barrel, crate, table, bookshelf, altar, brazier, statue, pillar | 9     |

Each replaces the SVG of the same name, so the painter, the swatch page and the screenshot tests use it without other changes.

---

## 5. How

### 5.1 Style first (checkpoint 1)

- A named studio style (`studio_set_style`) for SP1: its prompt text, plus up to 3 reference images made first and approved by you.
- **Checkpoint 1:** you approve the style from a board of 4–6 trial images, before any asset is made. About $2.

### 5.2 Three methods, compared

Each is tried on a few assets, then the best one makes the rest.

- **A. One per call:** each asset alone, with the style.
- **B. Sheets:** related assets on one image (a 3 × 3 sheet of props, a row of four ground tiles), cut apart by script. Items made together should match better and cost less each.
- **C. References:** A or B, with an approved asset as a reference image for the next.

Drafts (Gemini 3.1 Flash Image) are used to explore; finals (Gemini 3 Pro Image) only for what's accepted.

### 5.3 The pipeline (merged, SP4)

Under `scripts/art/`, run by hand from the repo root, each step on its own:

- **`fetch`:** download a library image by its stable link.
- **`slice`:** cut a sheet into its cells, by grid or by detecting the key colour between them.
- **`key`:** prompts ask for a flat key colour behind props, doors and windows; this step makes that colour transparent, with a soft edge, and trims.
- **`seamless`:** for ground tiles, offset by half, blend the seams, and check that the edges match across the wrap.
- **`fit`:** resize to the art's own scale. Tiles are 64 × 64 units, and walls, doors, windows and lines 64 × 16 strips. Objects are 16 units to the foot by their catalog size. All are rasterised at 4× (a tile 256 px) and written as PNG (or WebP if smaller).
- **`check`:** a report for each asset: size, transparent edges, seam difference, top-down score (Claude's look, recorded).

The scripts use `sharp`, already a dependency in `functions/`.

### 5.4 The PNG switch (merged, SP4)

- `materials.js` (both copies, identical bytes) reads an art file's extension from a small manifest (`public/apps/loom/art/manifest.json`, id → file), falling back to today's `.svg`.
- `build-art.js --check` and the test that every material has art accept either.
- Nothing else changes, so the SVG set stays the default until art replaces it.

### 5.5 The comparison (checkpoint 2)

- **Three columns,** for the test dungeon and a generated one:
  - today's SVG;
  - the studio's art;
  - the CC0 pack (SP3), its nearest assets mapped to the same names.
- **Headless Chrome screenshots** of each, plus the swatch page.
- **Checkpoint 2:** you rate each column (look, consistency, readability) and pick a direction.

### 5.6 The engine, measured

- Draw time of the large fixture (36 rooms, 144 objects, 72 doors) with the CPU slowed four times: SVG against PNG.
- Texture memory with all 23 assets loaded.
- What's missing, with estimates:
  - culling off-screen items;
  - packing into atlases;
  - soft blending where two ground materials meet;
  - code-driven motion for figures.

---

## 6. What it delivers

- **`planning/art-spike-report.md`:**
  - the answers to §2, with numbers (tries, cost and time per accepted asset; seam and edge pass rates; draw time and memory);
  - the screenshots;
  - your ratings;
  - a recommendation (studio-led, pack-led or hybrid);
  - a projected cost and size for a full setting and for all four reference games;
  - the open questions an art epic's gap sheet should ask.
- **Merged:** the report, `scripts/art/`, and the PNG switch with its tests.
- **On the spike branch only:** the 23 trial assets and the pack's files, for looking at; the library keeps the studio images either way.

---

## 7. Limits

- **Budget:** $30 of image generation (SP2). Expected spend is about $10–20:
  - style trials about $2;
  - explore with ~120 drafts at $0.07, about $8;
  - ~25 finals at $0.17, about $4;
  - retries.
- **Your time:** two checkpoints. Approving the style (5–10 minutes) and rating the comparison (15–20 minutes).
- **Stops early** if, after the style checkpoint and one round of each method, under half the assets are usable: that is the answer, and the report says so.
- **Out of scope:**
  - animation;
  - tokens (their own epic, L-930 #788, [`tokens.md`](./tokens.md): pictures framed as circular tokens);
  - towns and the world map;
  - building culling, atlases or blending (measured and estimated only).
