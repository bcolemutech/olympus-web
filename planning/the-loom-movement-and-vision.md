# The Loom — Movement and Vision — Design Document v0.1

**Status:** Planned (2026-10-02)
**Project:** Olympus (`olympus-dfa00`)
**Follows:** Loom Phase 3b "Layered Worlds" ([`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md))
**Related:** [`the-loom-design.md`](./the-loom-design.md)

---

## 1. Purpose

Layered Worlds gave the Loom towns and battle maps. This phase makes **moving through them** feel right:

- **Walking a town is one trip along its streets.** Today you can only walk to a place linked to the one you're in, one turn per hop.
- **Walls and doors stop you.** Today nothing on a battle map blocks movement or sight, so a player can walk through a wall and see past a closed door.
- **Movement is limited per turn.** A character has a speed (20). A turn is that much movement plus one action, and it ends when the player ends it. Turns will grow (combat, reactions, other characters' turns), so they start now.
- **Waypoints.** The player picks a destination, a path is found around whatever blocks it, and the token walks as far as this turn allows, then carries on next turn. It works on battle maps and in towns.
- **Fog of war.** You see what your character can see. The GM does too.

Moving no longer calls Gemini: steps are worked out by the rules, and the GM narrates what the player types, and arrivals.

---

## 2. Decisions (2026-10-02)

Settled with the user through a gap sheet of 41 questions (the IDs in brackets).

- **A turn is movement plus one action** (A1). Your speed in movement, and one action (anything you type), in any order. You always end it yourself with **End turn** (A6), even with nothing left to do. Towns use the same turn (A7).
- **Steps don't call the GM** (A2). Moving is instant. The GM narrates what you type, and arrivals: going into a place, onto a map, or out by an exit. A plain line covers what comes into view ("Old Mags is at the bar."), with no model call.
- **Speed 20.** On a battle map, 1 point is 1 square, and a diagonal costs 1 like a straight step (A3). In town, 1 point is 20 m, so a turn covers 400 m, about 5 minutes' walk (E3).
- **Waypoints everywhere** (A4, C4, F1). You can put one anywhere you can see or have been, on battle maps and in towns. A path only crosses ground you know (C5), so it never gives away a hidden wall or room. A path longer than this turn's movement is kept as your **plan**, and the next turn offers **Continue** (A5). The token walks the path, quickly, and a tap skips ahead (A8).
- **Movement stops when someone comes into view** (C6). The plan is kept and you decide.
- **In town, "Walk there"** (F2) plays out your turns until you arrive, stopping if someone comes into view or something happens. One turn at a time is still there.
- **Walls run along the grid lines** (B1), between squares, with doors set in them. **Obstacles** fill squares (B2): **solid** blocks movement and sight (a pillar, a boulder); **low** blocks movement only (a table, the bar, a pit, deep water); **difficult** ground costs 2 movement a square (rubble, mud). Cover comes with combat.
- **Doors** (B3, B4, B5). A path through a closed door opens it. **Opening costs 1 movement and stops you at the door**, with your plan kept, so you can change your mind once you see what's on the other side (B4). Tap a door to close it. A locked door stops you: a key you carry opens it, and picking or forcing it is something you type, ruled on by the GM with dice.
- **Showing the layers** (B6). On a plain grid, walls and obstacles are drawn. On art, the art shows them. Doors are always marked.
- **Claude builds the layers over MCP** (B7, E4), checking them against the art with `view_image`. No editor on the Cartographer page and no imports for now.
- **Layers count toward Rich** (B8). A battle map with no walls or obstacles keeps its place short of Rich, as a generic map does.
- **Fog on battle maps** (C1, the user's note). Never seen: **total darkness**. Seen before: dimmed, the layout remembered, nobody shown. In sight: clear.
- **Fog in town** (C1 note, G1). The **whole town map shows, but dark** where you've never been. Your sight lights it up. Once you've moved on it darkens again, but not as dark as where you've never been.
- **Places in town appear when seen** (G1, the user's note). A public place shows on the town map once you've seen its door, and stays. **Ways in and out are known from the start**, since the roads lead to them. Hidden places, and places you learn of from a map or a conversation, come later.
- **Sight** (C2, G2). On battle maps, as far as walls allow: every room counts as lit. Light, darkness and darkvision come later. In town, about 100 m along the streets, with buildings blocking.
- **Only what you can see leaves the server** (C3). People, features, exits and walls behind fog never reach the browser. Art downloads whole and fog covers it.
- **The GM knows what you see** (C7). It won't describe what's behind fog, and actions aimed at something you can't see are turned down ("You don't see anyone like that here."). **Physical actions need reach** (C8): opening a chest, pulling a lever or picking a lock needs you on or beside its square. Talking only needs sight.
- **Characters stand on squares** (D1). Claude places them over MCP, and they show as tokens when in sight. They don't move on their own yet. **You can pass through a character's square but not end a move on it** (D2, the user's note). Passing costs nothing extra; later it may give someone a reaction.
- **A quick fix first** (E1). Before the bigger work, you can tap any place in town and walk there in one move, along the town's links.
- **Towns get a real size** (E2): by size, adjustable. A village is about 300 m across, a town 600 m, a city 1.2 km and a great city 2.5 km, and Claude can set any town's size.
- **What blocks you in town** (E5): buildings, water (bridges and fords cross it) and town walls (gates pass). Streets are **open ground** (E6): any route around the obstacles, the shortest wins.
- **No more chains of places** (E7, the user's note). Once a town has its shapes, links are retired there and you walk the streets. Towns without shapes keep using links.
- **A place's position is its door on the street** (E8). Reaching it takes you in, onto its battle map if it has one.
- **Settlements keep their ways in and out** (the user's note). You still walk to a gate or the harbour before you can travel the world map.
- **Order** (H1, H2, H3). The town quick fix comes first. Then battle maps: turns and movement, walls and doors, vision, characters. Then towns: their shapes, walking, vision. **Game time (L-370 / #421) follows this phase**, turning turns into seconds and minutes. The work is its own milestone, **The Loom — Phase 3c: Movement and Vision**.

**Also decided** (no objection):

- **The server decides.** Paths, movement left and what you can see are worked out on the server and checked on every move. The browser previews with the same rules (a shared module, kept identical by a test), so it can't cheat.
- **Speed belongs to the character** (`character.speed`, default 20), so race, class, load or injuries can change it later.
- **No cutting corners.** A diagonal step can't squeeze past the corner of a wall, or between two obstacles.
- **Each save keeps its own doors and explored areas**, as it will keep its own clock. Shared state comes with multiplayer (Phase 4).
- **Nobody is stranded.** A map is refused if an entry can't reach an exit, and a town if a place's door can't be reached from a way in.
- **Nothing breaks.** Maps and towns without the new layers keep working, as open ground, until they're built out.
- **Exits and features stay on squares.** Walking onto an exit still leaves by it. A feature may sit on an obstacle (the bar, the hearth): going to it walks to the nearest free square beside it, and that counts as reach.

---

## 3. The turn

- **Data.** `character.speed` (default 20) and `save.turn: { n, movementLeft, actionUsed, plan }`. Older saves get a fresh turn on their next request. `plan` is the rest of a path: `{ layer, to, path }`.
- **End turn** (`action: { verb: 'end-turn' }`, L-611 / #441) refills movement and the action, and counts the turn, with no model call. It is recorded in the turn history as a plain line ("Turn 3 ends.") and advances the shared `worldClock`. `loomGetMap` carries the turn: `{ n, movementLeft, speed, actionUsed, plan }`. Later it is where other characters act, and where game time passes (6 seconds a battle-map turn; about 5 minutes a town turn).
- **The action** (L-614 / #444). Anything typed that isn't a move uses the turn's action, whether it succeeds or not. A second typed action in one turn is turned down ("You've acted this turn. End your turn first.") after INTERPRET reads it, without narration and without a record. Typed moves on a battle map ("go to the bar", "go out by the front door") follow a path and spend movement, like a tap: partway, "You head for the bar." and the plan is kept. NARRATE is told the turn (movement left, and whether the player has acted) for pacing. Under the play box, a turn bar shows the turn, the movement and the action, with **End turn**, wherever the player is.
- **Moving without the GM.** A move is a structured request (a cell, a town point, or a feature) handled by the rules alone: it checks the path, spends movement, stops partway when movement runs out (keeping the plan), and stops at a door it opens or when someone comes into view. Exits and arrivals behave as today, and an arrival is narrated. Steps aren't written to the turn history; the turn's record is kept when it ends.
  - **On battle maps** (L-613 / #443; `functions/loom-turn/steps.js`): `action: { verb: 'move', cell }` and `{ verb: 'continue' }` (walk the plan) are worked out inside a transaction on the fresh save, so two moves at once can't spend the same movement. The answer has plain lines and `step: { cell, movementLeft, plan, lines }`; out of movement, "You're out of movement. End your turn to go on." The plan is `{ layer: 'battleMap', mapId, to, path }`, shown only while you're on that map; Continue walks its path as stored if it still starts beside you, else finds it afresh. A path never crosses an exit on the way somewhere else; one that reaches an exit leaves by it, narrated, with the walk's movement spent. End turn says how far you went ("Turn 2 ends. You moved 5 squares, to the hearth."). The grid card shows the movement left, with **Continue** and **End turn**.
- **Paths** (L-612 / #442): `grid-paths.js` finds the cheapest path (`pathTo`), the squares in reach of a budget (`reach`), and how far a budget walks a path, with the rest kept as the plan (`walk`). Of equal paths it takes the shortest on the ground, then the one keeping closest to the straight line, so a token walks a natural line. A `cost` hook prices steps (blocked, difficult) for L-624. The server and the Loom page run the same file: it lives in `functions/loom-canon/` and `public/apps/loom/js/`, kept identical by a test.
- **The browser** shows what's in reach, previews the path (this turn's part solid, the rest dashed), and shows movement left, **End turn** and **Continue**. On battle maps (L-615 / #445): this turn's reach is lit; tapping a square draws the path a move would take, found with the server's own rules (`grid-paths.js`, where exits are `avoid` squares: stepped onto, never through), and the card says what it costs and when it arrives ("10 movement · 2 turns"); a kept plan is drawn dashed; after a move the token walks its path, a square every 110 ms (a tap skips ahead; with reduced motion it jumps).

---

## 4. Battle maps: walls, doors and obstacles

- **The data and the rules** live in `functions/loom-canon/layers.js` (L-621 / #446): `compile` (the layers by edge, corner and square), `between` and `canStep` (what a step crosses, and whether it can be taken), `groundAt`, and `check` (the checks below, as plain sentences for the builders). It is written so the Loom page can share it (L-624).
- **Walls** (`walls: [{ points: [{ x, y }, …] }]`, since Firestore holds no lists of lists) are lines between grid points (integer corners, `0…width`, `0…height`), each run straight across or down, in the map's own coordinates, the same as SVG art's (one unit per square). They block movement and sight.
- **Doors** (`doors: [{ id, name, from: [x, y], to: [x, y], locked, key }]`) are one square long, on a grid line. They start closed. A locked door names the `key` (an inventory item) that opens it. Each save keeps its doors' state (open, closed, locked).
- **Obstacles** (`obstacles: [{ id, name, kind, x, y, w, h }]`) are rectangles of squares, `kind` one of `solid`, `low` or `difficult`.
- **Movement:** 8 directions, 1 a step, 2 into difficult ground. A step can't cross a wall, a closed door, or enter a solid or low square. A diagonal is blocked if a wall touches the corner it passes, or either square beside it is solid or low. Opening a door on a path costs 1 and ends the move at the door. Closing an adjacent door costs 1.
  - **Paths** (L-624 / #449): `layers.pathOptions(map, doorStates)` is the one set of rules, shared by the server (`steps.js`, typed moves) and the Loom page's previews (`Loom.mapLayers`, a byte-identical copy). A closed door on the way costs 1 more and marks its step `opens`; `grid-paths.walk` stops before it, opening it with 1, and reach doesn't go through a closed door this turn. A locked door is no way through. Each save remembers the doors it opens (`save.doors: { [mapId]: { [doorId]: 'open' | 'closed' | 'locked' } }`), so Continue goes on through; `loomGetMap` sends the layers with each door's state for that save. A door beside you (on either side of it) opens or closes with `action: { verb: 'door', door, open }` (L-625 / #450), for 1 movement, worked out without the model like a step ("You open the kitchen door."); one already open or shut, or locked, or across the room, is refused plainly. The grid view offers it with a tap (L-627 / #452): on a plain grid it draws walls (light lines) and obstacles (solid dark, low hatched, difficult dotted); over art, the art shows them; doors are always marked by their state for this save (closed amber, open dashed, locked red). Tapping a door's line opens its card: its state, and Open, Close or Try (when locked) from beside it, or "Walk beside it to open or close it."
  - **Locked doors** (L-626 / #451): a tap with the door's `key` in the character's inventory (matched loosely: case and "a", "an", "the" don't matter) unlocks and opens it, for 1 movement. Typed attempts target `door:<id>` (INTERPRET knows the doors on the map) and use the turn's action: with the key, it unlocks and opens; picked or forced, a d20 is rolled against the lock's `difficulty` (5–30 on the door, 15 if none), and a success unlocks it for this save (`closed`, unlocked). A typed open or close works on an unlocked door. Not beside it, no such door, or no lock to pick is turned down without using the action. NARRATE's map section lists the doors and their states once the turn resolves.
- **Checks:** the layers stay on the grid and on its lines, doors don't overlap walls or each other, ids are unique, obstacles are solid, low or difficult and don't overlap, nothing that blocks movement covers an entry or an exit (difficult ground may), and every entry reaches an exit without passing a locked door. A map without layers is open ground, and passes.
- **MCP** (L-622 / #447): `set_battle_map` takes the layers with the grid (replacing a grid without them keeps the ones it has), and `set_map_layers` changes them alone (each list given replaces that list; an empty one clears it). Both refuse what the checks refuse, with their sentences, and warn about a map with no layers and a feature nobody can reach. `get_battle_map` shows them, and `list_battle_maps` says which maps have them (`hasLayers`). `add_place` can give a new place its map (`battleMap`) in the same call. `view_image` draws them over the art or the plain grid (L-623 / #448): walls as white lines and doors as amber bars on the grid lines, obstacles shaded by kind (solid filled dark, low hatched, difficult dotted). Doors and obstacles are numbered after the features, and the legend gives each one's id, name and place (a door's corners and whether it's locked; an obstacle's kind and squares), with the number of walls.
- **Grading** (L-622, L-628): the battle-map requirement is on (2026-10-03). A place with its own map but no walls or obstacles falls short of Rich ("Its battle map has no walls or obstacles", need `layers`). `list_work` marks an own map's `layers` (true or false), and `need: 'battleMap'` lists every place whose map isn't finished: none, generic, or its own without layers.

---

## 5. Battle maps: vision and fog of war

- **Line of sight:** a square is in sight when an unblocked line runs from the centre of yours to some part of it. Walls, closed doors and solid obstacles block. Low obstacles and difficult ground don't.
  - **Worked out** (L-631 / #454) by `functions/loom-canon/sight.js`: `inSight(map, from, doorStates)` gives the squares in sight, keyed `"x,y"`, your own included, for a save's doors (closed and locked block, open doesn't). A solid square is seen itself and hides what's behind it. It goes out from you in four quarters, a column of squares at a time, keeping the slopes of the lines still open, so it is exact: a square seen only along a single line (through the point where two walls meet, between solid squares touching at a corner, or grazing a wall's end) stays hidden. It is checked against a plain ray caster on random maps, takes about 3 ms for an open 64 × 64 map, and runs only on the server.
- **Memory:** each save remembers the squares it has seen on each map.
- **What's sent:** `loomGetMap` sends walls, doors and obstacles only where seen, features and exits only on seen squares, and people only in sight.
- **Fog:** never seen is black; seen before is dimmed (layout only); in sight is clear.
- **Moves:** destinations and paths only on seen squares. A move stops when someone new comes into view.
- **The GM:** INTERPRET resolves targets among what you've seen. ADJUDICATE turns down targets out of sight, and physical actions out of reach. NARRATE's ON THE MAP lists only what's in sight.

---

## 6. Characters on battle maps

- **Squares:** a character at a place with a map can have `cell: { x, y }` on it, set with `add_character` and `update_character` (or by naming a feature). It must be on the grid and not on a wall, an obstacle or an exit.
- **Tokens** show when in sight. You can pass through their square but not end a move on it. A plan ending there stops on the last free square.
- **The GM** knows who stands where, and who is next to you.

---

## 7. Towns: the ground

- **Size:** `town.size` in metres across, by default from the settlement's size (the same village, town, city and great city as the Rich bar): 300 m, 600 m, 1.2 km, 2.5 km. Claude can set it.
- **Shapes** (`town.ground`), in the town's 0–1000 square: `buildings` and `water` (polygons), `walls` (lines), and `crossings` (polygons over water, for bridges and fords). A gate is a gap in a wall with a way in or out standing in it.
- **Doors:** a place's `position` is its door, on open ground. Reaching it takes you in.
- **Checks:** no door inside a building or water, and every door reachable from a way in.
- **MCP:** a tool to set a town's ground, `get_town` shows it, and `view_image` draws it over the art.
- **Grading:** in a town with ground, the town requirement checks paths from the ways in, not links.

---

## 8. Towns: walking

- **Paths:** a walking grid over the town square, built from the shapes, searched and then smoothed into straight runs. Lengths are in metres, from the town's size.
- **Movement:** 1 point is 20 m. A waypoint can go anywhere on open ground: the town's layout is known from the start (§9). Reaching a place's door takes you in. Leaving for the world map is from a way out, as now.
- **Typed moves** ("go to the market") follow paths.
- **The town view:** tap a point to see the path (this turn solid, the rest dashed) and how many turns it takes, then **Walk** or **Walk there**, **End turn** and **Continue**.
- **Links** are retired in towns with ground: paths replace them, and the tools say so.

---

## 9. Towns: vision

- **Fog:** the whole town shows. Never seen is dark, seen before is less dark, in sight is clear.
- **Sight:** about 100 m along the streets; buildings and walls block.
- **Places:** a place appears on the map once its door has been in sight, and stays. Ways in and out are known from the start.
- **What's sent:** only places you've found, and people in sight.

---

## 10. Epics and sub-issues

One milestone, **The Loom — Phase 3c: Movement and Vision**. Each story is tested on its own: pure-module tests for rules, emulator tests for the server, a real MCP client for the tools, renderer pixel tests for `view_image`, and headless Chrome with real taps for the views.

| Epic                                   | Sub-issues                                                                                                                                                                                    | Exit criterion                                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **L-600 Town quick fix** (one story)   | Walk to any place in town in one move, along the links                                                                                                                                        | Crossing Hatham is one tap                                                                             |
| **L-610 Turns and movement**           | L-611 the turn in saves · L-612 grid paths · L-613 moving without the GM · L-614 typed actions and the turn · L-615 the grid view                                                             | In The Lantern & Oar, a player walks 20 squares, ends their turn and continues                         |
| **L-620 Walls, doors and obstacles**   | L-621 the layers in canon · L-622 MCP layer tools · L-623 `view_image` draws them · L-624 paths respect them · L-625 doors in play · L-626 locked doors · L-627 the grid view · L-628 grading | Claude walls The Lantern & Oar; a player can't walk through the cellar wall, and opens the cellar door |
| **L-630 Vision and fog (battle maps)** | L-631 line of sight · L-632 explored memory · L-633 only what's seen is sent · L-634 fog in the grid view · L-635 moves on known ground · L-636 the GM sees what you see                      | Opening the cellar door reveals the cellar; the GM never mentions what's behind a closed door          |
| **L-640 Characters on battle maps**    | L-641 characters get squares · L-642 tokens in sight, passing through · L-643 the GM knows who is where                                                                                       | Old Mags stands at the bar, unseen until you come round the corner                                     |
| **L-650 Town ground**                  | L-651 town size and distance · L-652 shapes in canon · L-653 MCP ground tools · L-654 `view_image` draws ground · L-655 grading by paths                                                      | Claude gives Hatham its streets, river and wall                                                        |
| **L-660 Walking in town**              | L-661 town paths · L-662 walking on the server · L-663 typed moves follow paths · L-664 the town view · L-665 links retired                                                                   | From The Quay a player walks around the market hall, over the bridge and into the temple               |
| **L-670 Vision in town**               | L-671 sight and memory in town · L-672 fog in the town view · L-673 finding places, and the GM knows only those                                                                               | Arriving in Daldockley, the streets show dark, and its places are found by walking them                |

**Order:** L-600 first, as a quick win. L-610 lays the turn everything else uses. L-620 adds what blocks. L-630 needs the walls, and L-640 needs sight. L-650 to L-670 bring the same to towns. Game time (L-370) then follows.

---

## 11. Later

- **A cheaper model.** All three Gemini calls already use `gemini-2.5-flash` with thinking off. With steps no longer calling it, the saving here is in calls; Flash-Lite for INTERPRET could be tried separately, against recorded turns.
- **Combat:** initiative, other characters' turns, reactions (passing through someone's square), cover.
- **Light:** darkness, torches and darkvision.
- **Hidden places,** and places learned of from a map or a conversation.
- **Building tools:** a wall editor on the Cartographer page, walls from SVG art, and importing Watabou's City Generator JSON.
- **Multiplayer:** shared doors and fog.
