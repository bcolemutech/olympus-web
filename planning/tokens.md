# The Loom — Tokens — Design Document v0.1

**Status:** Decided (2026-11-06). Revised 2026-11-07: tokens stand (TK5), built after L-940's view. Sub-issues filed 2026-11-06 (#789–#792, §6).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-930 (#788), Phase 10 — Levels and Vehicles (milestone #26).
**Depends on:** L-393 (named stat blocks), L-922 (size classes), L-700 (the image studio).
**Related:** [`art-spike.md`](./art-spike.md) (map art; tokens are kept apart from it), [`builders-tools.md`](./builders-tools.md), [`maps-from-data.md`](./maps-from-data.md)

---

## 1. Purpose

Today every person on a battle map is a disc with their initials. Tokens become what a virtual tabletop shows: **a picture in a circular frame.**

- The picture comes from whatever is already stored: a figure's own, its character's, or its stat block's.
- A guard's picture is drawn once and every "gate guard" shares it. A named villain has their own.
- Pictures can be any style.

Animation is not wanted (the user, 2026-11-06).

---

## 2. What there is today

- **`draw.js` `token()`:** a filled disc with a dark edge, an optional ring, and the name's initials, coloured by side.
- **People on a battle map** come from characters, placed figures (`place_figures`) and spawned figures (L-927). Figures name a stat block (L-393), and sheets carry a size class (L-922).
- **The image studio** has `portrait` and `token` kinds, but nothing assigns them. Its assign targets are world map, cover, town, battle map, object kind and object.
- **Players** have the `loom` claim, not `cartographer`, so they can't add to the library.

---

## 3. Decisions (the user, 2026-11-06)

| ID      | Question                          | Decision                                                                                                                                                                                                                                                                                        |
| ------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TK1** | Where a picture comes from        | **The figure's own, else its character's, else its stat block's, else today's disc with initials.** A template instance's figures use their stat block's                                                                                                                                        |
| **TK2** | The player's own token            | **Both:** pick from portraits the world's builder offers to players, or upload their own                                                                                                                                                                                                        |
| **TK3** | The frame                         | **One built-in frame,** a ring coloured by side (party, hostile, neutral, wary) as today's discs are, the token sized by the creature's size class                                                                                                                                              |
| **TK5** | Standing (2026-11-07, with L-940) | **Tokens stand:** the round framed portrait stands upright on a small base in the three-quarter view's depth order, with a contact shadow, fading with walls; down, it lies flat. Built after L-941 and L-942 ([`game-art.md`](./game-art.md) TK1, TK2). Full standing figures are a later epic |
| **TK4** | Where it goes                     | **Its own small epic now,** apart from the art spike                                                                                                                                                                                                                                            |

---

## 4. Design

### 4.1 Token pictures as data (TK1)

- **A token picture** is `{ image, crop? }`:
  - `image` is a library image (`img_…`), or for a player's upload its stored file (§4.3);
  - `crop` is `{ x, y, zoom }`, the circle's centre on the image (0–1) and how far in, so a full portrait can be framed on its face. The default is centred and fitted.
- **On:** a character (`character.token`), a stat block (`statBlock.token`), and a placed figure or group (`token` beside its `statBlock`, overriding it).
- **Resolved on the server** (`functions/loom-canon/tokens.js`, `tokenOf(person, world)`): figure, then character, then stat block, else none. The page gets a link and the crop only, never library records.
- **The studio's assigner** gains `character`, `statBlock` and `figure` targets, kind `token` (or `portrait`), so "in use" stays right.
- **MCP:** `set_token` (a target, an image, a crop), and `token` on `add_character`, `update_character`, `set_stat_block` and `place_figures`.
- **`view_image`** draws tokens as the Loom does, so a builder can check them.

### 4.2 Drawing (TK3)

- **The token** is the picture clipped to a circle inside a ring.
  - The ring is coloured by side, and the player's own has today's highlight.
  - Its diameter comes from the size class's width (medium 2.5 ft, drawn at least a square across, as today).
- **States** are shown as today:
  - down is greyed with a mark;
  - the current turn is ringed;
  - a foe's card shows over it while its turn plays.
- **No picture** draws today's disc with initials inside the same ring.
- **Textures** are cached by link, loaded without blocking, and show the initials until loaded.
- **One frame** for every world, drawn by `draw.js`; no frame art files.

### 4.3 The player's own token (TK2)

- **Picking:**
  - a world offers player portraits (`world.tokens.player`: library images, set by `set_world_tokens` or the Cartographer page);
  - the new-game form (`creation.js`) and the Character panel show them to pick from, with a crop;
  - a world with none offers upload only.
- **Uploading:**
  - `loomUploadToken` (callable, `loom` claim, own save) takes a PNG, JPEG or WebP of at most 5 MB;
  - the server checks it is an image, squares and resizes it to 512 px with `sharp`, strips its metadata, and stores it as WebP;
  - it lives at `loom_tokens/{uid}/{saveId}.webp` in Storage, readable by its owner only and written by the function only. The save gets `character.token`;
  - deleting the save deletes it.
- **Saves from before** have no token and draw initials until one is chosen.

### 4.4 Making portraits

- **Studio prompts** for kind `token` or `portrait`:
  - a head-and-shoulders portrait;
  - the face centred;
  - a plain background;
  - nothing important near the edge, so a circle crop works.
- Generating `from` a character or stat block uses its description.
- **The Cartographer page** shows each named character's and stat block's token as the Loom draws it, with its crop.

### 4.5 Grading

People are content, so their pictures count (CLAUDE.md, "Content features add to grading"). In `grading.js`, with `the-loom-grading.md` updated:

- **Character:** has a token picture, toward Vivid.
- **World:** every stat block placed on a map has a token picture.

---

## 5. Exit criterion

- In a test dungeon, a named villain shows their own portrait.
- Six bandits from one stat block share its picture, and a seventh placed with its own token shows that one.
- A spawned group uses its stat block's picture.
- A creature with no picture shows initials in the frame.
- Rings tell party, hostile, neutral and wary apart, and a large creature's token is drawn larger.
- A player picks a portrait from the world's set at creation. Another uploads their own, cropped to the face, and only they can read the file.
- `view_image` shows the same tokens.

---

## 6. Sub-issues (filed 2026-11-06)

| ID           | Story                                                                                                                                                                        | Depends on | Model  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| L-931 (#789) | **Token pictures as data:** `{ image, crop }` on characters, stat blocks and figures; `tokenOf`; the studio's new targets; `set_token` and the tools' `token`; sent as links | —          | Sonnet |
| L-932 (#790) | **Drawing tokens:** the framed picture by side and size class, states, the initials fallback, texture caching; `view_image` draws them                                       | L-931      | Sonnet |
| L-933 (#791) | **The player's token:** the world's player portraits, picking at creation and in the Character panel, `loomUploadToken`, its storage and rules, deletion with the save       | L-932      | Opus   |
| L-934 (#792) | **Making portraits and grading:** studio prompts for tokens, the Cartographer page's previews, the grading criteria                                                          | L-931      | Sonnet |

**Order:** L-931 first; L-932 and L-934 follow it; L-933 last.

Tests:

- pure tests for `tokenOf`'s order;
- rules tests for the upload's storage (owner read, client writes denied);
- emulator tests for `loomUploadToken` (a good image stored and resized; a non-image, an oversize file and another's save refused);
- headless Chrome for the tokens (picture, ring by side, size, fallback) and the picker;
- a real MCP client for `set_token`.
