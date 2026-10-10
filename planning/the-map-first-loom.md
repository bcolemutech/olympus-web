# The Loom — A Map-First Loom (UI Rewrite) — Design Document v0.1

**Status:** Decided (2026-10-10). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-720 (#525)
**Phase:** 7 — Map-first Loom. Built right after L-700, the Image studio, so it shows the studio's art well, and before Phase 3d (the Build order in [`roadmap.md`](./roadmap.md)).
**Depends on:** Phase 3c done (L-650, L-660, L-670), whose town views it carries over; L-700 (#523), whose art it shows.

---

## 1. Purpose

The Loom is played from its maps. Click actions, tokens, portraits, inventory and people are about to fill them, and the Image studio is about to give every world real art. This epic rebuilds the play view around **a map that fills the window**:

- the GM's narration, rolls and input sit in a **side panel** on the right;
- a **menu bar** opens the game's other panels as they arrive;
- **one map engine** draws the world map, towns and battle maps, with a smooth zoom between them.

The look is Roll20's layout with Baldur's Gate's trim: a dark frame that lets the art lead, finished with thin gold edges and serif headings.

This covers the Loom only, not the Cartographer or the rest of Olympus. It adds no content to the game, so it adds no grading criteria ([`the-loom-grading.md`](./the-loom-grading.md) §4.6).

---

## 2. What there is today

- **The code:** `public/apps/loom/` is about 4,800 lines of vanilla JS in the IIFE pattern, with no build step. The biggest parts are:
  - `battle.js` (the grid, about 990 lines);
  - `map.js` (the world map, about 680);
  - `layers.js` (walls, doors, obstacles, about 460);
  - `town.js` (about 420).
- **Drawing:** each level is SVG over an `<img>` of its art. A layer switcher (battle, town, world) and zoom buttons sit on the map.
- **Narrow screens:** **Story** and **Map** tabs swap the narration and the map.
- **Narration:** a log, suggested actions, a summary, and a turn form. The turn bar shows movement left, End turn and Continue.
- **Shared with the server:** `grid-paths.js` lives in `functions/loom-canon/` and `public/apps/loom/js/` with identical bytes, and a test checks them.
- **Turns:** `loomPlayTurn` is a callable, so a turn's narration arrives whole.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-10), with two follow-ups (the look, the menu bar). Items marked † took the recommendation without a question of their own.

### Technology

| ID     | Question                         | Decision                                                                                                                  |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **T1** | How is the page built?           | **Preact with htm, from the CDN, no build.** Components and state without a compiler, keeping the project's no-build rule |
| **T2** | What draws the maps?             | **PixiJS (WebGL, from the CDN)**, falling back to canvas without WebGL                                                    |
| **T3** | One engine for all three levels? | **Yes:** world, town and battle map are layers in one engine, with the same pan, zoom, markers and clicks                 |
| **T4** | How does it go live?             | **Replaced piece by piece, in place.** Each story leaves the Loom working; there is no second page                        |

### Layout

| ID     | Question                     | Decision                                                                                                                                                                |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | The panel's side             | **Right**                                                                                                                                                               |
| **L2** | Its size                     | **Drag to resize, and collapse to a slim strip** that shows the latest line and pops open on a new one                                                                  |
| **L3** | On the map, not in the panel | **The turn bar** (movement left, End turn, Continue), **the time of day**, **where you are**, **the level switcher and zoom**, and **a minimap**                        |
| **L4** | Rolls                        | **Small cards in the narration:** the roll, what it was against, pass or fail, collapsed to one line once read                                                          |
| **L5** | The Olympus header in play   | **Hidden.** The menu bar's Main menu gives back, saves and sign-out                                                                                                     |
| **L6** | Moving between levels        | **A smooth zoom**; entering a town zooms into it. You can still peek at another level                                                                                   |
| **L7** | On a phone                   | **The map full-screen, with the panel as a bottom sheet.** A one-time note suggests a bigger screen                                                                     |
| **L8** | A menu bar                   | **Yes, built now with what exists:** Main menu, Map levels, Journal (the narration). Inventory, Character and People are added by L-770, L-730 and L-750 when they ship |

### Showing the art

| ID     | Question                | Decision                                                                                                                        |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | Big world maps          | **A screen-sized copy first, the full image when zoomed in.** Tiles only if L-707's big-map trial makes maps too large for that |
| **A2** | Markers and labels      | **Quiet:** small pins; labels on hover or when zoomed in                                                                        |
| **A3** | Fog                     | **Soft-edged, with a texture:** remembered ground dimmed, unseen ground dark, edges feathered                                   |
| **A4** | Cover images            | **Large cards on the world list**, and **while a game loads**                                                                   |
| **A5** | Arriving somewhere      | **A banner of the place's art** atop the narration on arrival                                                                   |
| **A6** | Tokens before portraits | **Clean discs with initials**, built to take a portrait from L-730                                                              |

### Look and controls

| ID     | Question              | Decision                                                                                                                                                                                                             |
| ------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **K1** | One look or per world | **One Loom look, with each world's accent colour** (from the brief's art direction, L-710; a default until then)                                                                                                     |
| **K2** | Direction             | **A dark frame with Baldur's Gate trim:** Roll20's layout (big map, side panel, toolbar), Baldur's Gate's dark panels, thin gold or bronze edges and serif headings. Ornament stays on the frame, never over the art |
| **K3** | Motion                | **Tokens walk along their path, the camera follows the player** (who can pan away), **narration appears as it is written**, and **ambient touches** (drifting fog, water shimmer)                                    |
| **I1** | Controls              | **Wheel zoom and drag to pan, pinch and drag on touch, keyboard shortcuts** (Enter to type, E to end the turn, C to continue, arrows to pan, numbers for suggested actions)                                          |
| **I2** | Room for click menus  | **Yes:** everything on the map is clickable, and a click opens a small menu (Move and Look for now). L-740 then only adds actions                                                                                    |
| **X1** | Exit criterion        | **As in #525** (§5)                                                                                                                                                                                                  |
| **X2** | World list and saves  | **Restyled to match**, with cover art                                                                                                                                                                                |

---

## 4. Design

### 4.1 Code

- **Libraries:** Preact and htm (for components) and PixiJS (for the map), each from the CDN with an exact pinned version, loaded before the app's own scripts.
- **Scripts:** the app keeps the IIFE namespace pattern (`window.Loom`) and its load order. Components are plain functions that return `` html`…` `` templates.
- **State:** one small store holds the save, the map, the turn and the UI state (panel size, level, selection). Components subscribe to it.
- **Shared code:** `grid-paths.js` stays shared with the server, byte-for-byte. The new code reads it from `window.Loom` as today.
- **Pure modules stay pure:** `map-math.js` and `town-layout.js` keep their logic and tests. Only how things are drawn changes.

### 4.2 Layout

- **The map** fills the window.
- **The side panel** sits on the right, resizable and collapsible (L1, L2). From top to bottom it holds:
  - the arrival banner (A5);
  - the narration, with roll cards (L4);
  - the suggested actions;
  - the input box, always visible.
- **On the map**, as a light overlay (L3):
  - the turn bar, bottom centre;
  - the time and where you are, top left;
  - the level switcher and zoom, bottom left;
  - the minimap, bottom right.
- **The menu bar** (L8) is a slim bar along the top. Its first buttons are Main menu (back to the world list, saves, sign-out), Map levels and Journal. Later epics add their own buttons.
- **On a phone** (L7), the panel becomes a bottom sheet over a full-screen map, and the overlay compacts.
- **The Olympus header** is hidden during play (L5); the world list and saves keep it.

### 4.3 The map engine

- **One PixiJS stage** (T2, T3) with a camera (pan, zoom, follow) and a layer for each level:
  - **world:** art, routes, places, discovered and locked;
  - **town:** art or ground, places, paths;
  - **battle:** art, grid, walls, doors, obstacles, features, exits, tokens, reach and paths.
- **Fog** sits over the town and battle layers.
- **Moving between levels** (L6) is a zoom that cross-fades into the layer below, and back out.
- **Clicks:** every thing on the map can be hit-tested. A click opens a small menu (I2) of Move and Look for now. Today's actions (travel, move, open a door, plan a path) become menu entries or stay one-tap where they are one-tap today.
- **Art (A1):** the engine loads a screen-sized copy of a layer's art first, and the full image once the camera zooms past it. The studio makes the screen-sized copy when it stores a version (see L-727 below). Markers stay quiet (A2).
- **Fog (A3):** a render texture, feathered at its edges. Seen, remembered and unseen are kept as today; only how they are drawn changes.
- **Motion (K3):**
  - tokens walk their path, and the camera eases after the player;
  - ambient effects run on the battle and town layers, and stop when `prefers-reduced-motion` is set.
- **Performance:** a battle map of 100 × 100 squares with fog and 30 tokens pans at 60 frames a second on a recent iPad.

### 4.4 Narration and rolls

- **Narration appears as it is written (K3):** a turn's text arrives whole from `loomPlayTurn`, so the panel reveals it at reading speed, and a tap shows the rest at once. True streaming from the server would need a different transport and is left for later (§7).
- **Rolls** are cards in the narration (L4).
- **The narration** keeps a live region for screen readers.

### 4.5 Look

- **Tokens** are CSS custom properties on one stylesheet. The world's accent colour (K1) is set per world.
- **The frame (K2):**
  - dark panels;
  - a thin metallic edge on panels and the menu bar;
  - serif headings, with a plain sans for narration and controls.
- **Ornament** stays on the frame, never over the art.
- **The world list and saves** (X2) are restyled with large cover cards (A4). A cover shows while a game loads.

### 4.6 Going live piece by piece

T4: each story leaves the Loom working. The shell and panel come first, around the old views. Then each level moves to the new engine in turn, and the old SVG view for that level is deleted in the same story.

---

## 5. Exit criterion

A whole session is played from the full-window map, on the world map, in a town and on a battle map, with the narration in the side panel. Nothing the old view could do is lost.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                           | Depends on   | Model  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-721 | **The shell:** Preact and htm, the store, the full-window layout, the side panel (resize, collapse), the menu bar, the hidden header, around today's views      | —            | Opus   |
| L-722 | **The map engine and the world map:** PixiJS stage, camera, art loading, routes and places, quiet markers, clicks with a small menu; the old world view removed | L-721        | Opus   |
| L-723 | **The town level:** art or ground, places, paths, movement; the old town view removed                                                                           | L-722        | Sonnet |
| L-724 | **The battle level:** grid, walls, doors, obstacles, features, tokens, reach, paths, soft fog; the old battle view removed                                      | L-722        | Opus   |
| L-725 | **Between levels and over the map:** the zoom between levels, peeking, the turn bar, time and place overlay, the minimap, the camera following the player       | L-723, L-724 | Sonnet |
| L-726 | **The panel's content:** the narration revealed as written, roll cards, arrival banners, suggested actions, the input box, keyboard shortcuts                   | L-721        | Sonnet |
| L-727 | **Art at its best:** a screen-sized copy made when the studio stores a version, the full image when zoomed in, ambient effects                                  | L-722, L-701 | Sonnet |
| L-728 | **Phones:** the bottom sheet, the compact overlay, pinch and drag, the bigger-screen note                                                                       | L-725, L-726 | Sonnet |
| L-729 | **The look and the screens around play:** the Baldur's Gate trim, the world accent, the world list and saves with cover cards, the cover while loading          | L-721        | Sonnet |

**Order:** L-721 first. L-722, L-726 and L-729 can run side by side after it. L-723 and L-724 follow L-722, and L-725 follows both. L-727 and L-728 come last.

Tests: headless Chrome for each story (the layout, every level's view, clicks and menus, the zoom between levels, the phone layout); the existing pure-module tests unchanged; and a check that `grid-paths.js` still matches the server's copy.

---

## 7. Later

- **True streaming of narration** from the server.
- **Panels from later epics** join the menu bar: Inventory (L-770), Character (L-730), People (L-750).
- **Deep-zoom tiles** for very large maps, if L-707's trial calls for them.
- **The Cartographer page** in the same look.
