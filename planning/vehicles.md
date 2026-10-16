# The Loom — Vehicles as Places — Design Document v0.1

**Status:** Decided (2026-10-16). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-910 _(to file)_
**Built:** after the dungeon epic, when the steampunk reference game is next (the roadmap's Build order).
**Depends on:**

- L-900 (map levels to any depth): a vehicle's decks are maps;
- L-370 (game time) and L-360 (journeys and event rolls);
- L-810 (sheets): a vehicle's stat block;
- L-790 (companions), for the crew; L-780 (businesses), for buying and passage.

**Related:** [`scenarios.md`](./scenarios.md) (G2, G10), [`map-levels.md`](./map-levels.md), [`game-systems.md`](./game-systems.md) (ship battle, MD6), [`off-road-travel.md`](./off-road-travel.md)

---

## 1. Purpose

Trains, airships, sailing ships and starships are both **a way to travel** and **a place you are in**: you walk the deck while it sails, talk to the crew, and fight on it when pirates board. This epic makes a vehicle **a map of its own that sits on a map above it and moves along it**, with a course set by its owner, its timetable or its captain, a sheet with parts that take damage, and a crew.

---

## 2. What there is today, and after its dependencies

- **Travel** is a move along a route between two places, taking time by route kind and speed (L-373); nothing travels with you.
- **Each save has its own clock** (L-371), so there is no shared "now" across saves.
- **After L-900:** maps sit inside places at any depth; a save stands at a path (`save.at`); exits link places across maps; `timeRules` reads the map you're on.
- **After L-360:** journeys go in legs, with event rolls per leg played on generic maps.
- **After L-810 and L-790:** stat blocks, and companions who follow, act and take orders.

---

## 3. Gap sheet

The outline was decided with the reference games ([`scenarios.md`](./scenarios.md) §4, VH1–VH6, CW1). The details were settled through a questionnaire (2026-10-16); every answer took the recommendation.

| ID      | Question                    | Decision                                                                                                                                                                  |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VH1** | What a vehicle is           | **A map of its own (its decks) that sits on a map above it and moves along it.** You walk its decks while it travels                                                      |
| **VH2** | Who sets its course         | **The player when it's theirs, a timetable, or its NPC captain**                                                                                                          |
| **VH3** | Its sheet                   | **A stat block from the system, with parts that take their own damage** (hull, sails or engines, shields by arc, weapons): what ship battle reads                         |
| **VH4** | Owning one                  | **Yes**                                                                                                                                                                   |
| **VH5** | Getting off                 | **Where it stops, or by smaller craft or transporter** to places within reach                                                                                             |
| **VH6** | Other vehicles moving       | **Later,** with the living world (Phase 2)                                                                                                                                |
| **VE1** | How it moves                | **Its position is worked out from its course and the save's time:** where it set off, when, and how fast. Nothing runs in the background                                  |
| **VE2** | Whose it is                 | **Line vehicles (trains, ferries, a captain's ship) are canon, and each save sees them by its own clock; owned vehicles live on the save**                                |
| **VE3** | Aboard while it travels     | **Turns on deck pass time on the voyage;** "Wait until we arrive" skips ahead                                                                                             |
| **VE4** | Events on the way           | **A voyage rolls events per leg,** like L-360, played on the vehicle's deck                                                                                               |
| **VE5** | Transporters, smaller craft | **They reach places on the map below the vehicle's current place;** a smaller craft is itself a vehicle carried by the bigger one                                         |
| **VE6** | Timetables                  | **A simple repeating timetable now** ("every 6 hours from 06:00"); the calendar epic adds dated ones                                                                      |
| **VE7** | The crew (G10)              | **Crew are companions with a station** (helm, tactical, engineering…), **a size per world;** they stay aboard unless picked for an away party. Orders from the click menu |
| **VE8** | Getting one                 | **Bought** (L-780), **given** in the story, **the game starts with one**, or **hired or chartered** for a trip                                                            |
| **PL2** | When                        | **After the dungeon epic,** when steampunk is next                                                                                                                        |
| **PL3** | Exit criterion              | **Kept** (§5)                                                                                                                                                             |

---

## 4. Design

### 4.1 A vehicle

- **Canon vehicles** in `loom_worlds/{worldId}/vehicles/{vehicleId}`; **owned vehicles** on the save, `save.vehicles/{vehicleId}`, with the same shape (VE2):
  - `name`, `kind` (train, airship, ship, starship, coach, shuttle…), `image`;
  - `decks`: the maps inside it (area or grid maps, L-900), with the deck you board onto;
  - `host`: the map it moves on (a region map, or a route kind on one: rail, sea, air, warp);
  - `course` (§4.2), or `timetable` (§4.4), or `captain` (a character, §4.4);
  - `statBlock`: from the world's system (VH3): parts with their own tracks (hull, sails or engines, shields by arc, weapons), speed by route kind, crew size (VE7);
  - `carries`: smaller craft it holds (VE5), each a vehicle.
- **Route kinds** gain `vehicle: true` for ways only vehicles travel (rail, air, warp), set per map (L-900, TV1). An airship's `air` route ignores terrain.

### 4.2 Where it is (VE1)

- **A course** is `{ path: [placeId…], departAt (save seconds), speed }` along the host map's routes.
- **Its position at a time** is worked out from the course: which leg, how far along, or stopped at a place. A pure function (`vehicles.js`), shared by the rules and the map view; never stored, never run in the background.
- **Canon line vehicles** are placed by their timetable against each save's own clock (VE2), so every save sees the 06:00 train leave at 06:00 on its own day.

### 4.3 Aboard (VE3, VE4)

- **Boarding:** at a place where the vehicle is stopped, a "Board" action (L-740's click menu) moves the save onto its boarding deck: `save.at` gains the vehicle as a step (`{ vehicleId }`) above its deck map.
- **On deck:** turns are ordinary turns on an area or grid map (6 s or 5 min, L-900 TV4); each one also moves the voyage on by that time. "Wait until we arrive" waits until the next stop (L-374's wait, capped as today).
- **Events (VE4):** each leg of a voyage rolls as L-360's journeys do (chance × danger along the leg), from the world's event tables; an event is played on the vehicle's deck (boarders arrive at its entries) rather than on a generic map.
- **Leaving (VH5):** at a stop, "Disembark" puts the save at the stop's place. Otherwise:
  - **Smaller craft (VE5):** board a carried vehicle and set its course to a place on the map below the big vehicle's current place (a boat ashore, a shuttle to the surface).
  - **Transporters:** a vehicle with `transporter` in its stat block moves people straight to a built place on the map below its current place, and back.
- **Time and the GM:** the TIME line (L-375) adds where the vehicle is ("aboard the _Brass Heron_, an hour out of Kelden").

### 4.4 Who sets the course (VH2)

- **The owner (VH4):** on an owned vehicle, "Set course" (from the helm, or the click menu on the host map) picks a destination; the path follows the host map's routes for the vehicle's route kinds, with a preview of the time (L-376's estimates).
- **A timetable (VE6):** `{ path, every (seconds), firstAt (seconds after midnight), dwell }`: "every 6 hours from 06:00, waiting 20 minutes at each stop". A ticket (an item, L-770) or the fare (L-760) is needed to board. The calendar epic later adds dated timetables.
- **A captain:** a character aboard who takes passengers or charters for a price (L-780 passage, a recorded change before then), and sets the course for the trip.

### 4.5 The crew (VE7)

- **Crew are companions** (L-790) aboard a vehicle the player owns or commands, each with a **station** (helm, tactical, engineering, navigation, medical…; the stations come from the system's words).
- **Size:** a world sets its crew limit (L-790's three companions still apply off the vehicle).
- **Orders** from the click menu: set course, man stations, hold position, follow me. Ship battle later reads who is at which station.
- **Away party:** leaving the vehicle, the player picks who comes (within the companion limit); the rest stay aboard at their stations.

### 4.6 Getting one (VE8)

- **Bought** at a business that sells vehicles (a shipwright, a dealer; L-780), **given** in the story as a recorded change, **at the start** of a game (a world's starting vehicle, set over MCP), or **hired or chartered** for a trip.

### 4.7 The Loom

- **On the host map,** vehicles show as tokens moving along their routes (their position at the save's time); line vehicles show their next departure on hover.
- **Aboard,** the trail (L-904) shows the vehicle as a step: "Vega › _Endeavour_ › Bridge". A voyage bar over the map shows the course, progress and arrival time.
- **Tools:** `add_vehicle` (canon or a world's starting vehicle), `set_timetable`, `set_course` (for tests), `get_vehicle`; decks are built with L-900's map tools.

### 4.8 Grading

A vehicle is content, so this epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.6):

- **Vehicle:** its decks graded as maps (L-900); a stat block set; a captain or crew where it has one.
- **World:** line vehicles have timetables that reach their stops.

---

## 5. Exit criterion

In a steampunk test world, a train carries the player between two towns on its timetable while they walk its carriage and talk to a passenger, and they get off at the second town at the time the timetable says. An airship they own flies where they set it, ignoring the terrain below, and drops them by rope ladder (a carried craft) onto a place below.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                                      | Depends on   | Model  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-911 | **Vehicles as data:** canon and owned vehicles, decks, host, stat block, carried craft; vehicle route kinds; `vehicles.js` (position from course and time); tools; grading | L-901, L-811 | Opus   |
| L-912 | **Aboard:** boarding and disembarking, the vehicle in `save.at`, turns on deck moving the voyage, "wait until we arrive", the TIME line                                    | L-911, L-903 | Opus   |
| L-913 | **Courses:** the owner's "Set course" with its estimate, simple timetables with tickets or fares, captains taking passengers and charters                                  | L-912        | Sonnet |
| L-914 | **Smaller craft and transporters:** carried vehicles to the map below; transporters to built places below and back                                                         | L-912        | Sonnet |
| L-915 | **Events on voyages:** a roll per leg, played on the deck                                                                                                                  | L-912, L-363 | Sonnet |
| L-916 | **The crew:** stations, the world's crew size, orders, choosing the away party                                                                                             | L-912, L-790 | Sonnet |
| L-917 | **The Loom:** vehicles moving on the host map, the trail through a vehicle, the voyage bar                                                                                 | L-912, L-904 | Sonnet |

**Order:** L-911, then L-912. L-913 to L-917 follow, side by side where their dependencies allow.

Tests: pure-module tests for positions from course and time (legs, stops, dwell, timetables against different clocks); pipeline tests for boarding, turns aboard and arrival; headless Chrome for the moving token, the trail and the voyage bar.
