# The Loom — Off-Road Travel and the Wilderness — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-360 (#418)
**Phase:** 6 — Studio and new worlds ([`roadmap.md`](./roadmap.md) §4), after L-710.
**Depends on:**

- L-710 (#524): the painted terrain and regions, and route kinds (L-714);
- L-370 (#421): game time and travel (L-373);
- L-720 (#525): the map engine, for the preview;
- L-350: generic battle maps.

Event figures use L-792's templates once they exist.

**Related:** [`worlds-without-azgaar.md`](./worlds-without-azgaar.md), [`the-loom-game-time.md`](./the-loom-game-time.md), [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §5 (the gate), [`ai-characters.md`](./ai-characters.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

The open country between places is always open.

- **Travel cross-country:** set out toward any point on the map, taking the quickest way across the painted terrain, in day legs with a camp each night.
- **Routes** stay the quicker, safer way.
- **Wilderness events** happen on the way. Each is rolled, never guessed, from event tables Claude writes, and is played on a generic battle map that fits the terrain.
- **Closed places** stay closed, but you can reach them, by road or across country, and stand outside their gates (the user's note).

---

## 2. What there is today, and after its dependencies

- **Routes only:** players travel only along routes. L-370 gives routes lengths and speeds, and L-714 gives each world its route kinds.
- **The gate:** a move toward a place below Playable is turned back: "The way to X is closed. Turn back." (Layered worlds §5.)
- **After L-710:**
  - worlds have map units and a scale;
  - painted terrain areas, with a built-in list of kinds that a world can add to;
  - regions with shapes;
  - topmost-wins lookups.
- **Generic battle maps** (L-350) are tagged `generic: { kind, terrain }` and can be used by any place.
- **After L-792:** templates of generic NPCs can be placed as figures.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-11), with follow-ups on grading, odds and the exit criterion. Items marked † took the recommendation without a question of their own.

### Travelling

| ID      | Question              | Decision                                                                                                                                                                                |
| ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TR1** | Where you can head    | **Anywhere on the map.** Closed places stay closed, but you can travel to the wilderness right outside one, or by road to it, and stand outside: you just can't enter (the user's note) |
| **TR2** | Speed by terrain      | **An off-road pace times a factor per terrain kind:** 1.5 mph on plains; forest 0.5; hills 0.6; swamp 0.4; mountains 0.3; a world can change the factors, and its own kinds set theirs  |
| **TR3** | The path              | **The quickest way across the terrain**, worked out on a coarse grid of the map                                                                                                         |
| **TR4** | What can't be crossed | **Water, and whatever the world marks impassable** per terrain kind. Mountains are slow but passable unless marked                                                                      |
| **TR5** | Before setting out    | **A preview:** the path, distance, days, terrain crossed, and how wild it is, beside the route option if there is one                                                                   |
| **TR6** | Stopping              | **Day legs:** you camp each night at a point on the map, and can stop, turn or change course. Between places you are "in the wilds" at that point                                       |
| **TR7** | Finding places        | **Places within a few miles of your path become discovered**                                                                                                                            |

### Events

| ID      | Question                       | Decision                                                                                                                                                                                                                                     |
| ------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EV1** | When                           | **A chance per day leg**, scaled by how dangerous the terrain and region are                                                                                                                                                                 |
| **EV2** | Where they come from           | **Event tables written by Claude over MCP, with built-in fallbacks.** Each event has a name, what happens, where it can happen, a map tag, figures to place, and its odds                                                                    |
| **EV3** | Kinds                          | **Travellers, creatures and monsters, hazards and weather, finds, getting lost or delayed**                                                                                                                                                  |
| **EV4** | How they're played             | **On a generic battle map chosen by terrain**, with the event's figures placed. Small ones (a storm, getting lost) are narrated only                                                                                                         |
| **EV5** | No generic map for the terrain | **No event.** The work list asks for a map for that terrain                                                                                                                                                                                  |
| **EV6** | Danger                         | **Regions and terrain kinds have a danger level**, set over MCP, that raises the odds                                                                                                                                                        |
| **EV7** | Odds                           | **Rolled, never guessed** (the user's note): each day leg rolls against **25% × terrain danger × region danger** (each from 0.5, calm, to 2, deadly; 1 by default). The roll is seeded and recorded on the turn. A world can change the base |
| **EV8** | After an event                 | **You go on, turn back, or change course.** Leaving the event map by its edge resumes the journey                                                                                                                                            |

### Grading and the end

| ID     | Question       | Decision                                                                                                                                  |
| ------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **X1** | What counts    | **Each terrain kind on the world's land has a generic map (world), and regions have a danger level (region).** Written events don't count |
| **X2** | Exit criterion | **Kept, with the closed-place rule added** (§5)                                                                                           |

---

## 4. Design

### 4.1 Terrain and danger

- **Terrain kinds** gain `speed` (a factor), `danger` (0.5–2) and `impassable`. The built-in kinds get the defaults in TR2; water is impassable (TR4).
- **Regions** gain `danger` (0.5–2, default 1).
- **Over MCP:** both are set with L-710's tools: `update_world` for terrain kinds, `update_region` for regions.
- **The world's settings:** `world.wilds: { pace (mph, default 1.5), eventChance (default 0.25), discoverMiles (default 3) }`.

### 4.2 Paths

- **A shared module,** `wild-paths.js`, lives with identical bytes in `functions/loom-canon/` and `public/apps/loom/js/` (like `grid-paths.js`; a test checks the copies). It:
  - rasterises the terrain layer into a coarse grid, about 200 cells on the long side;
  - gives each cell the cost of crossing it (1 / speed);
  - finds the quickest path with A\*.
- **Leaving and joining routes:** a journey can start on a route and leave it, or end on one. Route sections use route speeds (L-370), and the rest use terrain speeds.
- **The preview** (TR5) runs the same module in the page:
  - the path drawn on the world map;
  - the distance, days and terrain crossed;
  - a wildness rating from the average danger;
  - beside the route option, if there is one.

### 4.3 Journeys

- **Starting:** a cross-country move is a structured action, `{ verb: 'travel', to: { x, y } | placeId, offRoad: true }`. ADJUDICATE checks it and stores the plan as `save.journey: { path, leg }`.
- **Day legs (TR6):** each leg is 8 hours of land travel (L-370 T9), advancing time.
  - A leg ends at a camp point. Between places the save stands "in the wilds": `save.position = { wild: { x, y } }`.
  - Continue walks the next leg. Stop ends the journey where you are, and a new destination changes course.
- **Closed places (TR1):**
  - Arriving at a place below Playable, by road or across country, leaves you **outside it**: in the wilds at its edge, with the narrator describing the closed gates.
  - Entering is refused as today.
  - This replaces the old rule that turned travel back before it began (layered worlds §5).
- **Discovery (TR7):** places within `discoverMiles` of the path become discovered.

### 4.4 Events

- **Event tables (EV2):** a world's `events` subcollection. Each event is `{ id, name, text, kind, terrain[], regions[], mapTag, figures: [{ templateId, count }], weight, narrated? }`, set with `set_events`.
  - Built-in fallback events exist for each kind (EV3), written plainly enough for any world.
- **The roll (EV7):** after each leg, a seeded roll draws from the save id and leg number. The chance is `eventChance × terrain danger × region danger`, using the cell where the leg ends, capped at 95%. The roll, the chance and the result are recorded on the turn.
- **Choosing the event:** a weighted pick among events that fit the terrain and region, the world's first, then the fallbacks.
  - A `narrated` event is told by NARRATE.
  - A map event needs a generic battle map tagged for that terrain. If there's none (EV5), there's no event, and the work list asks for a map for that terrain.

### 4.5 Playing an event

- **Arriving (EV4):** the player arrives at an entry of the chosen generic map. The event's figures are placed (L-792); before L-792 ships, the event names who is there, and the GM narrates them without tokens. The GM is told the event's text.
- **Play** is ordinary battle-map play: movement, sight, click actions, conversations.
- **Leaving (EV8):** leaving by an exit returns to the journey. The player can go on, turn back, or change course.

### 4.6 Grading

This epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.3):

- **World:** each terrain kind on its land has a generic battle map (10).
- **Region:** a danger level set (5).

---

## 5. Exit criterion

A player sets out cross-country, is stopped by an event in a painted forest on a generic map, and goes on. They also travel by road to a closed town, arrive outside its gates and can't enter, then set off cross-country from there.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                    | Depends on   | Model  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-361 | **Terrain costs and paths:** speed, danger and impassable per kind, region danger, `world.wilds`, the shared `wild-paths.js`, grading criteria           | L-715, L-691 | Opus   |
| L-362 | **Journeys:** the `travel` action off-road, day legs and camps, in the wilds, closed places reached from outside, discovery along the way, time by L-373 | L-361, L-373 | Opus   |
| L-363 | **Event tables and the roll:** `set_events`, built-in fallbacks, the seeded roll recorded on the turn, choosing an event and a map, the work-list ask    | L-362        | Sonnet |
| L-364 | **Playing an event:** arriving on the generic map, figures (when L-792 exists), the GM told, leaving to go on, turn back or change course                | L-363        | Sonnet |
| L-365 | **The map:** the preview, the journey line and camps, your position in the wilds on the world map                                                        | L-362, L-722 | Sonnet |

**Order:** L-361, then L-362. L-363 and L-365 can follow side by side, and L-364 follows L-363.
