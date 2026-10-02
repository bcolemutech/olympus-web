# The Loom — Layered Worlds — Design Document v0.1

**Status:** Draft for review
**Project:** Olympus (`olympus-dfa00`)
**Follows:** Loom Phase 3 "Rapid worlds" (the Cartographer, [`the-cartographer-design.md`](./the-cartographer-design.md))
**Related:** [`the-loom-design.md`](./the-loom-design.md), [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)

---

## 1. Purpose

A Cartographer world starts as an Azgaar map: hundreds of places, each with a line of imported facts. This phase lets a world be **built out as it is played**, outward from where the player is, and **layer by layer**:

1. **World:** realms, regions, settlements, points of interest, and the routes between them.
2. **Burg:** inside a settlement, its districts and key places (gates, harbour, market, temple, citadel, taverns), linked like the world is.
3. **Location:** a **battle map** of one spot (a point of interest, or a place in town): a grid with walls, doors, water, cover, features, and exits.

The game never generates anything. Every place is **graded** on how built it is. Players can only enter places that are graded **Playable**, and anything less is closed ("the way is closed; turn back"). The same grades tell Claude, or any AI working through MCP, **what to build next**. Gemini's burg-layout and battle-map generators are **building tools** you invoke, not something play triggers.

This keeps the Loom's canon-authority rule unchanged (Loom design §10): the play pipeline never writes canon.

---

## 2. Decisions (2026-09-27, updated 2026-10-01)

- **Graded and gated, never generated in play.** Unbuilt areas are unavailable. The player is turned back, and nothing is generated to fill the gap.
- **The Playable bar** is a written description (not the import text) **plus the layer you would step into**: a town layout for a settlement, and a battle map for a point of interest or a place in town. Residents and lore raise a place to **Rich** but never block entry.
- **Gating applies to every published world as soon as it ships**, Nisia included. Nisia closes down to the places already written up.
- **No Gemini world generation** (2026-10-01; this replaces the earlier plan for Gemini town-layout and battle-map generators, L-344 and L-353, now dropped). Gemini's job is **GM duties in the Loom**: interpreting and narrating turns, and summaries. Later it may also make **artwork** (L-500). It never generates world content in the Cartographer: every layer is built over MCP, by Claude or another AI, or by hand.
- **Battle maps are for navigation first.** Combat stays narrated; tactical rules can come later with richer rule sets (L-202 / #313).
- **Epics are slices by layer**, each playable when it lands (§10).
- **Travel stays on routes for now** (2026-10-01). Going anywhere, off-road included, with random events in the wilderness, is a later epic (L-360, §10).
- **You choose your way in** (2026-10-01). Arriving at a settlement, the player picks which of its ways in to arrive at, among those that serve how they're travelling (§8).
- **The town map is drawn, with art optional** (2026-10-01). Places and paths are drawn from their positions, and an uploaded image can sit behind them (§8).
- **Battle maps are artwork with a grid** (2026-10-01). A map is an image under a movement grid, with entry points and exits. Images are uploaded for now and generated later (L-500), and a map with no image is drawn as a plain grid. Movement is free at first: object layers that block movement, and objects to interact with, come later (§9).
- **Generic battle maps count once assigned** (2026-10-01). Generic maps (a tavern, a forest clearing, a stretch of road) are reusable. A place is Playable with its own map or a generic one assigned to it over MCP, so only notable places need their own art. But **a place using a generic map falls short of Rich**: Rich needs its own map, so the work list keeps showing the places still on a generic one.
- **Game time is each save's own** (2026-10-01). A character's travel and actions advance their own clock: minutes for steps in town, hours or days on world routes from the route's miles and kind, a few minutes for other turns. Dates are a day count and time of day ("Day 3, evening"), with no calendar. It is the groundwork for fatigue and hunger, and is built after battle maps (L-370, §10).
- **A location can have several maps** (2026-10-01), such as floors or the parts of a large structure, linked by exits. The data allows it from the start; tools and views for more than one map come later.

---

## 3. Layers

| Layer    | What it is                                                        | You enter it by                             | Built by                                           |
| -------- | ----------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------- |
| World    | Settlements and points of interest, realms, regions, routes       | Starting a game; travelling along routes    | The Cartographer import; written up over MCP       |
| Burg     | A settlement's places: gates, harbour, market, temple, taverns, … | Arriving at a settlement                    | MCP tools, seeded from Azgaar                      |
| Location | A battle map of a point of interest or a place in town            | Arriving at that point of interest or place | MCP tools: its own map, or an assigned generic one |

A save's position becomes a chain: **settlement or point of interest → place in town → cell on its map**. Each layer has its own movement rules (§8, §9).

---

## 4. Grading

### 4.1 Grades

| Grade        | Meaning                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------- |
| **Unbuilt**  | The layer the place needs doesn't exist yet (for example, a settlement with no town layout) |
| **Stub**     | Only imported facts                                                                         |
| **Playable** | Meets the bar (§4.2): players may enter                                                     |
| **Rich**     | Playable, plus residents and lore                                                           |

Grades are **computed from content**, never set by hand, so they are always current. Every grade comes with a **checklist** of what is missing, for example: "Burdendal: town layout missing; description is the import text; no residents."

### 4.2 The rubric

| Kind              | Playable                                                           | Rich                                                                          |
| ----------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Settlement        | Written description, **and** a town layout (once burgs exist)      | Residents and lore for its size (§8)                                          |
| Point of interest | Written description, **and** a battle map (once battle maps exist) | At least one lore entry about it, **and** its own battle map                  |
| Place in town     | Written description, **and** a battle map (once battle maps exist) | At least one resident, or one lore entry about it, **and** its own battle map |
| Realm, region     | Graded for the work list only (written description); never gated   | Lore about it                                                                 |

- A **town layout** counts when it has at least one entrance, and all of its places are connected.
- A **battle map** counts when it validates and has at least one exit. A **generic** map assigned to a place counts toward Playable but never Rich: a named place needs its own map to be Rich, and its checklist says it is still using a generic map (decision 2026-10-01).
- **Static worlds** (hand-authored config, such as the Shattered Coast) are exempt: they are authored by definition.

The rubric is one pure, versioned module, `functions/loom-canon/grading.js`. The game's gate, the MCP tools, and the Cartographer page all use it, so there is only one definition of "built".

### 4.3 Where "written" comes from

Each entity records where its gradable fields came from: `sources: { description: 'import' | 'mcp' | 'gemini' }`.

- The **Cartographer loader** stamps `import`.
- The **MCP write tools** stamp `mcp`.
- `gemini` is reserved and nothing writes it: Gemini doesn't generate world content (§2).
- A description counts as written when its source isn't `import`.

**Existing worlds** get the stamps from a local dry-run script, per the project convention of running one-off production fixes locally, not in Actions. The script re-runs the parser and mapper on the world's original Azgaar export (Nisia's is in the gitignored `maps/` folder). A description that still matches the mapper's output word for word is marked `import`, and anything else `mcp`. Without the original export, every description is marked `import`.

### 4.4 The bar rises with each layer

When burgs ship, a settlement also needs a town layout, and when battle maps ship, points of interest and places in town need a map. Places that were open close again until they are built to the new bar, and the work list shows exactly what they need. So each requirement is switched on only once the open places meet it: the town requirement was switched on after Nisia's open towns were laid out (§8), and the battle-map requirement will be switched on once the open places have maps, their own or generic (§9).

---

## 5. In game: the gate

- **Travel.** The rules engine (ADJUDICATE) refuses a move into a place below Playable with a blocked outcome: "The way to _X_ is closed. Turn back." Nothing changes and no time passes.
- **Nobody is stranded.** A save standing in a place that is below the bar (after the bar rises, or a revision) stays there and can leave. Only entering is refused.
- **The narrator** is told which exits are closed, so it describes them as barred rather than inventing what lies beyond.
- **New games.** Publishing requires the starting location to be Playable, and `loomCreateSave` refuses a world whose start has since dropped below the bar ("This world isn't ready to play yet"). Setting a start that isn't Playable over MCP (`update_world`) succeeds but warns, since new games can't begin there until it is open (written up, with its town laid out).
- **Shared by everyone.** Grades are world-level, so every player, and every future multiplayer tier, sees the same open and closed places.

---

## 6. Over MCP

- **`list_work`** (`worldId`, and optionally `kind`, `grade`, `need`, `near`, `limit`, `offset`) lists what to build, each item with its grade and what it is missing, in priority order:
  1. Closed places on the **frontier**: next to a Playable place, or the starting location itself (or `near`), nearest first. The world grows outward from where you play.
  2. Other closed places, by travel steps from the start.
  3. Playable places missing what would make them Rich.
  4. Realms and regions to describe (never gated).

  Layers show up as needs (`town`, `battleMap`) once they ship, so `need` filters by layer as well as by description, residents or lore. Each page explains the needs on it once, naming the tool that fills each.

- **Grades in the read tools.** `get_world` shows completion by grade (places, realms, regions); `get_location`, `get_faction` and `get_region` show their grade and checklist; connections and `find_locations` rows carry a grade, and `find_locations` can filter by one.
- **`update_region`** writes a region's name and description. Regions arrive from Azgaar with none, so without it their grades could never rise.
- **Write tools stamp sources** (§4.3), so a place's grade updates on the next read.
- **Per-layer tools** arrive with each layer's epic (§8, §9).

The Cartographer page shows each world's completion, the Playable places and their share, graded on the server by the `cartographerCompletion` callable.

---

## 7. World map navigation

The Loom's play screen gains a **map** beside the story:

- **The Azgaar image** (`worlds/{worldId}/map.png`, stored at import with its pixel size and the map's coordinate size), with pan and zoom, markers for settlements and points of interest, the routes between them, and where you are.
- **Discovered places.** A save discovers the places it visits and their neighbours; the rest of the map stays hidden. Discovery is recorded in the save as a delta at COMMIT, like other save state.
- **Open and closed.** Closed places show as locked ("Not built yet").
- **Click to travel.** Clicking a connected, open place sends a **structured move**. It skips INTERPRET's Gemini call but is still adjudicated on the server like any typed move.
- **Phone first.** The map and story share the screen on a phone.

---

## 8. Burgs

- **Data.** A world gains a `places` subcollection: `{ id, locationId (its settlement), name, kind, description, connections, entrance, npcIds, rules, sources, position }`. `kind` is one of gate, harbour, market, temple, citadel, tavern, district, and so on. `position` is in the town's own coordinates, for drawing. An **entrance** place (a gate, or a harbour) links to the settlement's routes on the world map.
- **Azgaar seeds.** The importer keeps Azgaar's settlement details as `geo.seeds`: walls, citadel, plaza (the market square), temple, shanty town, settlement type (naval, lake, river, hunting, …), and culture, alongside the port and capital flags it already kept. (Azgaar's `market` field is a trade-region id, not a building, so it isn't a seed.) In Nisia, for example, 168 settlements have walls, 148 a port, 101 a citadel, 26 a plaza, 14 a shanty town, and 13 a temple. They seed layouts: walls mean gates, a port means a harbour, a citadel means a citadel. The same backfill script (§4.3) adds them to already-imported worlds, and optionally Azgaar's distance scale, so the map can show miles.
- **Entrances.** An entrance carries `entrance: { via: [...] }`, the world routes it serves: a harbour `['sea']`, a gate `['road', 'trail']`. With no list, it serves every route. Characters can have a `placeId` in town as well as their `locationId`.
- **Movement** (L-342 / #396; `functions/loom-canon/town.js`):
  - **Arriving:** you land at the open entrance serving your route (the harbour by sea, a gate by road), else any open entrance. A town with no open entrance is entered as a whole, as before towns existed.
  - **Choosing the way in** (L-346 / #415): a move can target a way into the next town instead of the town itself ("to the King's Causeway", or the town and then its way in), and you arrive by it. On the map, when more than one open way in serves your route, the place card asks which; INTERPRET knows the ways into the towns next to here. The server checks that the way in is open and serves the route ("The Quay is no way in by trail. Arrive by The Town Gate or The West Gate."), after the leaving rules. With no way in named, you arrive as above.
  - **Moving:** you move between connected places in town, gated like the world map ("The way to _X_ is closed. Turn back.").
  - **Leaving:** you leave only from an entrance serving the route out ("To set out for Dunsmouth by trail, go to The North Gate first."). A closed or unreachable destination is reported first.
  - **Older saves:** a save with no `placeId` in a town that has a layout stands at its default entrance (the first open one). A recorded place is kept even if it is retired, so nobody is stranded.

  The position records `placeId` alongside `location`. INTERPRET knows the current town's places. NARRATE's scene is the place's cast, plus residents with no place of their own ("about town"), plus the realm; its exits are the town's links and, from an entrance, the routes out.

- **Grading.** Places in town are graded (Playable once written up; Rich with someone there or lore about them) and gated. A settlement's town requirement (a layout with an open entrance, every place reachable from one) is **on**: a settlement without a working layout is Unbuilt and closed. It was switched on (2026-10-01) only after the MCP town tools (L-343 / #397) had laid out Nisia's open towns, Hatham and Daldockley, so nothing open closed. The **Rich bar scales** with a settlement (requested 2026-09-29), counting residents and lore anywhere in its town:

  | Size       | Population  | Residents | Lore |
  | ---------- | ----------- | --------- | ---- |
  | Village    | under 1,000 | 1         | 1    |
  | Town       | 1,000+      | 2         | 1    |
  | City       | 10,000+     | 4         | 2    |
  | Great city | 30,000+     | 6         | 3    |

  A capital counts as one size larger. The Playable bar is unchanged.

- **MCP** (L-343 / #397).
  - **Reading:** `get_town` shows a settlement's layout: each place (kind, links, grade, residents), which places are ways in and out and which world routes each serves, and a layout report (what keeps it from working: no written-up way in, unreachable places; and routes no way out serves). A settlement's `get_location` carries a short town summary.
  - **Editing:** `add_place` (with `entranceFor` for ways in and out, `connectTo` for links, an optional `position`), `update_place`, `connect_places`, `disconnect_places`, and `retire_entity` with type `place`. Every result includes the layout report after the edit. Place ids are `plc_<settlement>_<name>`, for example `plc_1_the-harbour`.
  - **Rules:** place names are unique within the town and never a world place, realm or character's name. Links are two-way and stay inside one town. A town with places keeps at least one way in and out. Descriptions are stamped as written up.
  - **Characters** can be given a `placeId` in their town with `add_character` and `update_character`. Moving them to another settlement clears it.
  - **Removal:** in a published world, places are retired. In a draft, a place is deleted and every link to it cleaned; this is refused while characters are found there, and a settlement with a town can't be deleted until its places are.
  - **Work list:** places inside towns that aren't Rich form a `town` tier, right after the frontier and nearest town first.
- **UI** (L-345, L-347). The town view is a drawn map, an SVG from the places' positions (0–1000 each way): the places and the paths between them, where you are, which are open, and a click to move. When a town has art, an uploaded image sits behind the places, fitted inside the town's square (L-347 / #416). It's uploaded on the Cartographer page (**Town art…** on a world) as a PNG of up to 30 MB. `cartographerTownImage` checks it, copies it beside the world's map image under a new name each time, and records `town.image: { path, width, height }` on the settlement through the shared write layer, so games see it on their next turn; replacing or removing art deletes the old file. `get_town` reports its size (`art`), and place positions are set over MCP to line up with it. Azgaar links each settlement to Watabou's Medieval Fantasy City Generator, whose image export is one source of town art.

---

## 9. Battle maps (navigation first)

- **Maps** are documents of their own: a world gains a `battleMaps` subcollection, `{ id, name, width, height, image, entries, exits, features, generic, sources }`.
  - The **grid** is `width × height` cells, at most 64 × 64, laid over the map's `image` (a Cloud Storage path), or drawn plain when it has none.
  - **Entries** are the cells you arrive on. **Exits** are cells that lead out: to the town, to the world, or to an entry on another map (a floor above, another part of a large structure). **Features** are named cells (the bar, the altar, the well).
  - **Generic maps** carry tags, `generic: { kind, terrain }` (a tavern; a forest clearing; a stretch of road), and can be assigned to any number of places. An image file can be shared by generic maps in several worlds.
- **Places use maps.** A point of interest or a place in town carries `battleMap: { mapId }`, pointing at its own map or a generic one. That map is where you arrive. Its exits can lead on to other maps of the same location, so several floors need no new data later.
- **Movement** (L-351 / #400; `functions/loom-canon/maps.js`). A save's position adds `mapId` and `cell: { x, y }`. Combat stays narrated.
  - **Arriving:** arriving at a place in town or a point of interest that has a map lands you on it, at its first entry. A new game that starts at one starts on it. Going to the place you're standing outside of steps back onto its map ("You go into The Gull & Anchor.").
  - **Moving:** you move to any cell of the grid, or straight to a feature. Nothing blocks movement yet, but the edges do ("That's off the map."). The grid view sends `action: { verb: 'move', cell: { x, y } }`. Typed moves name features and exits, which INTERPRET knows as `feature:<id>` and `exit:<id>`.
  - **Leaving:** stepping onto an exit leaves by it. An exit `to: 'out'` returns you to the layer above, standing outside the place. An exit `to: { map, entry }` takes you onto another map, at that entry.
  - **Waiting to leave:** while you're on a map, any other move waits until you've left it ("To leave The Gull & Anchor, go out by the front door first."), as leaving a town waits for a gate.
  - **Nobody is stranded:** a map with no exits holds nobody. A retired map is never entered, but a save already on one can still leave by its exits.
  - **The narrator:** its ways-on section becomes ON THE MAP: where you stand, the features, and the exits, which are the only ways on.
- **Later: object layers.** Walls and doors that block or pass, and objects to interact with (a lever, a chest, a locked door), sit on top of the grid as layers, with no change to the map's art.
- **Grading.** A point of interest or a place in town needs a live map, its own or an assigned generic one, to be Playable. A generic map stops it short of Rich: Rich needs its own map, and its checklist says so ("It uses a generic battle map"). Like the town requirement, this is switched on only once the open places have maps, so nothing open closes (§4.4).
- **MCP** (L-352 / #401; `functions/mcp/apps/cartographer/map-tools.js`).
  - **Reading:** `get_battle_map` reads a map in full, including where its exits lead and which places use it. `list_battle_maps` lists a world's maps, with filters for generic ones and by kind and terrain.
  - **Drawing:** `set_battle_map` creates a map (`bm_<name>`), or replaces one's grid while keeping its image. It checks that the map has at least one entry and one exit, that every cell it names is on the grid (at most 64 × 64), that ids are unique, that no two exits share a cell, and that no feature sits on an exit. An exit to another map must name a live map and an entry that exists, and a change can't remove an entry another map's exit leads to. It warns when the grid shrinks; players beyond the new edge move to its entry.
  - **Assigning:** `assign_battle_map` gives a point of interest or a place in town a map, its own or generic, or takes it away with `null`. Settlements are refused: they have towns.
  - **Showing:** `get_location` (for points of interest) and `get_town` (for each place) show the map.
  - **Work list:** `list_work` gives each point of interest and place in town a `battleMap` status (`own`, `generic` or `none`). `need: 'battleMap'` lists every one without its own map, Rich or not.
  - **Removing:** `retire_entity` with type `battleMap` retires a map (published) or deletes it (draft). It's refused while a place uses the map or another map's exit leads to it.
  - **Images** can't be sent over MCP: they are uploaded on the Cartographer page.
- **Art** (L-355). The Cartographer page uploads a map's image, for its own maps or generic ones, to Cloud Storage. A map without one is drawn as a plain grid. Generated art comes later with Imagen (L-500 / #318).
- **UI** (L-354). A grid view: the map's image (or a plain grid) with the grid over it, tokens for you and the people there, exits and features marked, and a tap on a cell to move. It works on a phone.

---

## 10. Epics and sub-issues

One milestone, **The Loom — Phase 3b: Layered Worlds**, with six epics, each ending in something playable. The last two, game time and off-road travel, are planned for later.

| Epic                              | Sub-issues                                                                                                                                                                                                                                                                                                    | Exit criterion                                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L-320 Grading and gating**      | L-321 grading module, `sources` stamping (loader, MCP), backfill script · L-322 the gate: ADJUDICATE, NARRATE, `loomCreateSave`, publish · L-323 MCP `list_work` and grades in the read tools; completion on the Cartographer page                                                                            | In Nisia, travel to an unwritten place is turned back; Claude finds it with `list_work`, writes it up, and it opens on the game's next turn                             |
| **L-330 World map navigation**    | L-331 discovered places in saves, structured moves · L-332 the map view: image, markers, routes, discovered and locked places, click to travel                                                                                                                                                                | Nisia is played from the map: discovered places show, closed ones are locked, travel is a click                                                                         |
| **L-340 Burgs**                   | L-341 Azgaar settlement seeds (parser, mapper, backfill) · L-342 the town layer in canon and saves, movement in town, graded and gated · L-343 MCP town tools · L-345 the town view (a drawn map, clickable places) · L-346 choosing the way in · L-347 town map art (an uploaded backdrop)                   | Burdendal is laid out by Claude over MCP; a player arrives at the harbour, walks to the market, and leaves by a gate                                                    |
| **L-350 Battle maps**             | L-351 the battle-map layer: maps as documents, generic maps, free movement on the grid, graded and gated · L-352 MCP battle-map tools · L-355 battle-map art uploads · L-354 the grid view                                                                                                                    | A tavern in town is assigned a generic tavern map; a player walks it cell by cell and leaves by the door                                                                |
| **L-370 Game time** (later)       | To be planned: `save.time` and how long each resolution takes (steps in town, travel by miles and route kind, nights on the road, other turns, waiting and resting) · the narrator and interpreter know the time · the day and time in the play view, and travel times on the map cards · time on battle maps | Walking from Hatham to Daldockley by trail takes about 2½ hours, steps in town take minutes, the narrator describes nightfall, and the play view shows "Day 1, evening" |
| **L-360 Off-road travel** (later) | To be planned: terrain for the whole map from the Azgaar export (biome, height, land or sea for every cell) · travel cross-country to any known place · random events in the wilderness, played on generic terrain maps                                                                                       | A player sets out cross-country, is stopped by an event in the rainforest on a generic map, and goes on                                                                 |

**Order:** L-320 comes first, because everything else is graded and gated through it. L-330 can follow immediately, since it needs no new data. L-340 comes before L-350, since places in town are where most battle maps live. L-370 comes after L-350, so battle-map moves take time from the start. L-360 comes last, since wilderness events are played on generic battle maps, and cross-country travel takes time.

---

## 11. Open questions

- **Rich criteria.** Start with §4.2 and tune after building out a region of Nisia.
- **Regions and realms** are graded but never gated. Should a region ever open or close as a whole?
- **Travel time** between settlements (days on the road) comes with game time (L-370).
- **Art.** Imagen (L-500 / #318) could later paint battle maps, generic and specific, and town art, from the same data.
