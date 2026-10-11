# The Loom — Portraits and Tokens — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-730 (#526)
**Phase:** 7 — Map-first Loom ([`roadmap.md`](./roadmap.md) §4). Comes before L-740 (X2).
**Depends on:** L-720 (#525, the map engine and menu bar), L-700 (#523, studio images and its generation service).
**Related:** [`click-actions.md`](./click-actions.md) (L-740), [`the-loom-grading.md`](./the-loom-grading.md) (criteria)

---

## 1. Purpose

Characters get faces.

- **Every NPC can have a portrait**, set over MCP from the studio.
- **The player's character has one too:** uploaded, chosen from the world's gallery, or generated from a prompt within a weekly allowance.
- **Tokens:** a token is the portrait in a small circle, cut at a focal point, so it is never a separate image. Its ring shows disposition.
- **Where portraits show:** beside an NPC's lines in the narration, on token cards, on your token on every map, and in two new panels on the menu bar, **Character** and **People**.

---

## 2. What there is today

- **A player's character** (`save.character`) has a name, condition, inventory (names), abilities, goals and speed. Nothing visual.
- **NPCs** have a name, description, faction, home, place and position (L-681). On battle maps they show as plain tokens when in sight (L-642). After L-720, tokens are discs with initials.
- **Dispositions:** `save.relationships` keeps a player's dispositions toward NPCs, and realms have a default disposition.
- **The studio** (L-700) is for Cartographer editors. Its generation runs as jobs on a queue, with every cost recorded and a $50 monthly warning.
- **Narration** is prose. Nothing marks which character speaks a line.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-11), with a follow-up on player images. Items marked † took the recommendation without a question of their own.

| ID      | Question                       | Decision                                                                                                                                                                                                                                    |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**  | A player's portrait comes from | **An upload, the world's gallery, or generation.** The player can always apply an upload, an image they generated before, or one from the gallery                                                                                           |
| **P2**  | Generation allowance           | **One generation a week, plus one edit a week.** A generation is from the player's prompt and their character's details. The edit is a retry or a correction by prompt. A dismissed image can be replaced by generating again the next week |
| **P2a** | Where player images live       | **A private shelf per player**, made with the studio's generation service but never shown in the builders' library. Each costs like any image and is counted under that player in the studio's cost ledger and its $50 monthly warning      |
| **P3**  | When it is set                 | **When starting a game, and any time later** from the Character panel                                                                                                                                                                       |
| **P4**  | The focal point                | **Drag and resize a circle over the portrait, with a live token preview**                                                                                                                                                                   |
| **P5**  | NPC portraits over MCP         | **Claude assigns a studio image of kind `portrait` and sets its focal point**, checking the token with `view_image`                                                                                                                         |
| **P6**  | Where portraits show           | **Beside an NPC's lines in the narration, on a card when a token is tapped or hovered, in the Character and People panels, and as your token on the world and town maps**                                                                   |
| **P7**  | The token's ring               | **Disposition:** friendly, neutral, hostile, toned to the frame                                                                                                                                                                             |
| **P8**  | A Character panel              | **Built here:** portrait, name, condition, abilities, goals, and what you carry (a list until L-770)                                                                                                                                        |
| **P9**  | A People panel                 | **Built here:** everyone you've met, with portraits and where you met them. L-750 adds their types                                                                                                                                          |
| **P10** | Who sees a player's portrait   | **Only that player**, until multiplayer. Uploads are private to the player and checked for size and type                                                                                                                                    |
| **X1**  | Exit criterion                 | **As in #526** (§5)                                                                                                                                                                                                                         |
| **X2**  | Order                          | **L-730 first, then L-740**                                                                                                                                                                                                                 |

---

## 4. Design

### 4.1 Data

- **NPCs:** `character.portrait: { imageId, focus: { x, y, r } }`.
  - `imageId` is a studio image of kind `portrait`.
  - `focus` is the token circle's centre and radius, as fractions of the image (0–1).
- **The world's gallery:** `world.portraitGallery: [imageId]`, the studio portraits players may choose from.
- **The player:** `save.character.portrait: { source: 'upload' | 'generated' | 'gallery', imageId, focus }`. Uploads and generated images are kept on the player's shelf.
- **The player's shelf** (P2a): `loom_player_images/{uid}/images/{imageId}`, with files under `players/{uid}/images/` in Storage.
  - Each record holds the prompt (if generated), parent (if an edit), size and cost.
  - Readable only by that player (P10). Writes go through the Admin SDK only.
- **The allowance** (P2): `loom_player_images/{uid}` holds `{ lastGenerationAt, lastEditAt }`. One generation and one edit are allowed in any 7 days, each counted from the last one.
- **People met** (P9): `save.met: { [characterId]: { firstAtTurn, placeId } }`, written by COMMIT when a character is seen in sight or spoken with.

### 4.2 NPC portraits over MCP

- **`studio_assign`** gains two targets:
  - `portrait`, with a character id and a focal point;
  - `portraitGallery`, which adds the image to the world's gallery or removes it.
- **`studio_set_focus`** changes a portrait's focal point.
- **`view_image`** of a battle map or town draws portrait tokens, so Claude can check the crop.

### 4.3 Player portraits

- **The portrait screen**, reached when starting a game (P3) or from the Character panel, offers:
  - **Upload:** PNG, JPEG or WebP, up to 10 MB, checked on the server and stored on the shelf.
  - **Gallery:** the world's gallery.
  - **Generate** (P2), from a prompt plus the character's name, abilities and goals and the world's art direction (L-710's brief, when there is one).
    - The job runs on the studio's queue (L-707). The image lands on the shelf, and its cost is recorded under the player (P2a).
    - The player can then **edit once** by prompt, or dismiss the image.
    - The screen shows when the next generation and edit are available.
  - **My images:** anything on the shelf.
- **The focal point editor** (P4): a circle over the image to drag and resize, with the token beside it at actual size.

### 4.4 Tokens

- **Drawing:** the map engine (L-722) draws a portrait token as the image clipped to a circle at its focal point, with a metal ring tinted by disposition (P7).
- **Disposition** is the save's relationship with that character if there is one, otherwise the character's realm's default.
- **Without a portrait**, the L-720 disc with initials stays.
- **The player's token** is drawn on the battle map, in town, and as the player's marker on the world map (P6).
- **Cards:** tapping or hovering a token shows a card with the portrait, name and disposition. L-740's menu attaches to the same card.

### 4.5 Speaking portraits

- **NARRATE marks speakers.** Its output gains a list of spans, `{ characterId, from, to }`, for lines a character speaks. Only characters present can be named.
- **The panel** sets a small portrait beside each spoken line (P6). Lines with no speaker are plain narration.
- **The cost:** a few output tokens a turn; no extra model call.

### 4.6 The panels

- **Character** (P8) joins the menu bar: the portrait (with Change), name, condition, abilities, goals, and the inventory as a list until L-770 replaces it.
- **People** (P9) joins the menu bar: everyone in `save.met`, with portrait, name, disposition and where you met them. Tapping one shows their card. L-750 adds types.

### 4.7 Grading

This epic adds the criteria the grading rework planned for it ([`the-loom-grading.md`](./the-loom-grading.md) §4.3), by the rule in its §4.6:

- **Character:** a portrait (20).
- **Settlement:** its residents have portraits (10).

Player portraits aren't world content, so they don't count.

---

## 5. Exit criterion

On a battle map, the player and an NPC show as round tokens cut from their portraits, and the NPC's full portrait shows when you talk to them.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                 | Depends on   | Model  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-731 | **Portraits in canon:** `character.portrait`, the world's gallery, `studio_assign` targets, `studio_set_focus`, `view_image` tokens, grading criteria | L-704, L-691 | Sonnet |
| L-732 | **Portrait tokens:** clipped at the focal point, disposition rings, on battle maps, in town and on the world map; token cards                         | L-731, L-722 | Sonnet |
| L-733 | **Player portraits:** the shelf, upload, gallery, the focal point editor, at the start of a game and from the Character panel                         | L-731        | Sonnet |
| L-734 | **Player generation:** the weekly allowance, prompt and character details, the studio's queue, the edit, costs under the player                       | L-733, L-707 | Opus   |
| L-735 | **Speaking portraits:** NARRATE marks speakers, portraits beside spoken lines                                                                         | L-731, L-726 | Opus   |
| L-736 | **Character and People panels:** the character sheet, `save.met`, the People list                                                                     | L-731, L-721 | Sonnet |

**Order:** L-731 first. L-732, L-733, L-735 and L-736 can follow side by side, and L-734 follows L-733.
