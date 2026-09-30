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

## 2. Decisions (2026-09-27)

- **Graded and gated, never generated in play.** Unbuilt areas are unavailable. The player is turned back, and nothing is generated to fill the gap.
- **The Playable bar** is a written description (not the import text) **plus the layer you would step into**: a town layout for a settlement, and a battle map for a point of interest or a place in town. Residents and lore raise a place to **Rich** but never block entry.
- **Gating applies to every published world as soon as it ships**, Nisia included. Nisia closes down to the places already written up.
- **Gemini generators are building tools**, run from the Cartographer page or over MCP. Their output is validated, saved, and graded like any other edit.
- **Battle maps are for navigation first.** Combat stays narrated; tactical rules can come later with richer rule sets (L-202 / #313).
- **Epics are slices by layer**, each playable when it lands (§10).

---

## 3. Layers

| Layer    | What it is                                                        | You enter it by                             | Built by                                                         |
| -------- | ----------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------- |
| World    | Settlements and points of interest, realms, regions, routes       | Starting a game; travelling along routes    | The Cartographer import; written up over MCP                     |
| Burg     | A settlement's places: gates, harbour, market, temple, taverns, … | Arriving at a settlement                    | MCP tools, or Gemini's town-layout generator, seeded from Azgaar |
| Location | A battle map of a point of interest or a place in town            | Arriving at that point of interest or place | MCP tools, or Gemini's battle-map generator                      |

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

| Kind              | Playable                                                           | Rich                                              |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| Settlement        | Written description, **and** a town layout (once burgs exist)      | At least one resident and one lore entry about it |
| Point of interest | Written description, **and** a battle map (once battle maps exist) | At least one lore entry about it                  |
| Place in town     | Written description, **and** a battle map (once battle maps exist) | At least one resident, or one lore entry about it |
| Realm, region     | Graded for the work list only (written description); never gated   | Lore about it                                     |

- A **town layout** counts when it has at least one entrance, and all of its places are connected.
- A **battle map** counts when it validates and has at least one exit.
- **Static worlds** (hand-authored config, such as the Shattered Coast) are exempt: they are authored by definition.

The rubric is one pure, versioned module, `functions/loom-canon/grading.js`. The game's gate, the MCP tools, and the Cartographer page all use it, so there is only one definition of "built".

### 4.3 Where "written" comes from

Each entity records where its gradable fields came from: `sources: { description: 'import' | 'mcp' | 'gemini' }`.

- The **Cartographer loader** stamps `import`.
- The **MCP write tools** stamp `mcp`.
- The **Gemini generators** stamp `gemini`.
- A description counts as written when its source isn't `import`.

**Existing worlds** get the stamps from a local dry-run script, per the project convention of running one-off production fixes locally, not in Actions. The script re-runs the parser and mapper on the world's original Azgaar export (Nisia's is in the gitignored `maps/` folder). A description that still matches the mapper's output word for word is marked `import`, and anything else `mcp`. Without the original export, every description is marked `import`.

### 4.4 The bar rises with each layer

When burgs ship, a settlement also needs a town layout, and when battle maps ship, points of interest and places in town need a map. Places that were open close again until they are built to the new bar, and the work list shows exactly what they need.

---

## 5. In game: the gate

- **Travel.** The rules engine (ADJUDICATE) refuses a move into a place below Playable with a blocked outcome: "The way to _X_ is closed. Turn back." Nothing changes and no time passes.
- **Nobody is stranded.** A save standing in a place that is below the bar (after the bar rises, or a revision) stays there and can leave. Only entering is refused.
- **The narrator** is told which exits are closed, so it describes them as barred rather than inventing what lies beyond.
- **New games.** Publishing requires the starting location to be Playable, and `loomCreateSave` refuses a world whose start has since dropped below the bar ("This world isn't ready to play yet"). Setting a start that isn't Playable over MCP (`update_world`) succeeds but warns, since new games can't begin there until it is written up.
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
- **Per-layer tools** arrive with each layer's epic (§8, §9), including the Gemini generators: `generate_town_layout` and `generate_battle_map`.

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
  - **Moving:** you move between connected places in town, gated like the world map ("The way to _X_ is closed. Turn back.").
  - **Leaving:** you leave only from an entrance serving the route out ("To set out for Dunsmouth by trail, go to The North Gate first."). A closed or unreachable destination is reported first.
  - **Older saves:** a save with no `placeId` in a town that has a layout stands at its default entrance (the first open one). A recorded place is kept even if it is retired, so nobody is stranded.

  The position records `placeId` alongside `location`. INTERPRET knows the current town's places. NARRATE's scene is the place's cast, plus residents with no place of their own ("about town"), plus the realm; its exits are the town's links and, from an entrance, the routes out.

- **Grading.** Places in town are graded (Playable once written up; Rich with someone there or lore about them) and gated. A settlement's town requirement (a layout with an open entrance, every place reachable from one) is implemented but **switched on only after the MCP town tools (L-343 / #397) have been used to lay out the start town and its open neighbours**, in a one-line follow-up. Turning it on before towns can be built would close every settlement, including every open place in Nisia. The **Rich bar scales** with a settlement (requested 2026-09-29), counting residents and lore anywhere in its town:

  | Size       | Population  | Residents | Lore |
  | ---------- | ----------- | --------- | ---- |
  | Village    | under 1,000 | 1         | 1    |
  | Town       | 1,000+      | 2         | 1    |
  | City       | 10,000+     | 4         | 2    |
  | Great city | 30,000+     | 6         | 3    |

  A capital counts as one size larger. The Playable bar is unchanged.

- **MCP.**
  - **Reading:** `get_town` shows a settlement's layout.
  - **Editing:** `add_place`, `update_place`, `connect_places` and `retire_entity` work in town with the same integrity rules as the world layer (names unique within the town, links two-way, casts follow homes).
- **Gemini.** `generate_town_layout` (worldId, locationId, optional guidance) sends the seeds, description and culture to Gemini for structured JSON against a schema. The result is validated (connected, named, with the places the seeds require) and saved as `gemini`. It only fills an unbuilt town, unless asked to replace one.
- **UI.** A town view, drawn as an SVG from the places' positions: where you are, where you can go, and a click to move.

---

## 9. Battle maps (navigation first)

- **Data.** A point of interest or a place in town can carry `battleMap: { width, height, rows, features, exits, sources }`. `rows` is the grid, one character per cell from a fixed legend (floor, wall, door, water, trees, rubble, and so on). `features` are named cells (the bar, the altar, the well), and `exits` are cells that lead out, to the town or to the world. Maps are capped at 64 × 64.
- **Movement.** A save's position adds `cell: { x, y }`. You move step by step, or straight to a feature or exit. Walls block and doors pass, and leaving by an exit returns you to the layer above. Combat stays narrated.
- **MCP.** `get_battle_map` reads a map, and `set_battle_map` writes one. It validates the size, the legend, and that every exit and feature can be reached from an entry.
- **Gemini.** `generate_battle_map` (worldId, placeId, optional guidance) returns a validated grid, saved as `gemini`.
- **UI.** A grid view (canvas) with tokens for you and the people there, and a tap on a cell to move.

---

## 10. Epics and sub-issues

One milestone, **The Loom — Phase 3b: Layered Worlds**, with four epics, each ending in something playable.

| Epic                           | Sub-issues                                                                                                                                                                                                                                           | Exit criterion                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **L-320 Grading and gating**   | L-321 grading module, `sources` stamping (loader, MCP), backfill script · L-322 the gate: ADJUDICATE, NARRATE, `loomCreateSave`, publish · L-323 MCP `list_work` and grades in the read tools; completion on the Cartographer page                   | In Nisia, travel to an unwritten place is turned back; Claude finds it with `list_work`, writes it up, and it opens on the game's next turn |
| **L-330 World map navigation** | L-331 discovered places in saves, structured moves · L-332 the map view: image, markers, routes, discovered and locked places, click to travel                                                                                                       | Nisia is played from the map: discovered places show, closed ones are locked, travel is a click                                             |
| **L-340 Burgs**                | L-341 Azgaar settlement seeds (parser, mapper, backfill) · L-342 the town layer in canon and saves, movement in town, graded and gated · L-343 MCP town tools · L-344 Gemini town-layout generator (MCP and Cartographer page) · L-345 the town view | Burdendal is laid out (by Claude, or Gemini on request); a player arrives at the harbour, walks to the market, and leaves by a gate         |
| **L-350 Battle maps**          | L-351 the battle-map layer in canon and saves, grid movement, graded and gated · L-352 MCP battle-map tools · L-353 Gemini battle-map generator · L-354 the grid view                                                                                | A Burdendal tavern gets a battle map; a player walks it cell by cell and leaves by the door                                                 |

**Order:** L-320 comes first, because everything else is graded and gated through it. L-330 can follow immediately, since it needs no new data. L-340 comes before L-350, since places in town are where most battle maps live.

---

## 11. Open questions

- **Rich criteria.** Start with §4.2 and tune after building out a region of Nisia.
- **Regions and realms** are graded but never gated. Should a region ever open or close as a whole?
- **Travel time** between settlements (days on the road) is out of scope.
- **Art.** Imagen (L-500 / #318) could later paint town views and battle maps from the same data.
