# The Loom — Journeys and Arrivals — Design Document v0.1

**Status:** Shipped (2026-10-28): L-381 to L-384 built. Decided 2026-10-25: the gap sheet (§3) is answered. Sub-issues filed 2026-10-25 (#700–#703, §6); L-381 shipped (#704); L-382 shipped (#705); L-383 shipped (#706); L-384 with this epic's close-out.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-380 (#699), Phase 3d — Time and travel (milestone #21)
**Depends on:** L-342 to L-346 (ways in and out), L-373 (trip times), L-660 and L-670 (walking and vision in town), #669 (setting out from anywhere in town)

---

## 1. Purpose

Travel through a world should get quicker the more of it you know, and its menus simpler:

- **Leaving a town**, a way out offers only its neighbouring settlements (and, once L-360 ships, the wilderness), one entry each.
- **A long journey** takes the player to any settlement they have been to before, in one move, passing through the towns between on the way.
- **Arriving somewhere new**, the player comes in by the most direct way in, and knows only that one; the town's other ways in and out, and its places, are found by exploring it.
- **Arriving somewhere known**, the player gets the town map, with all they found there before. Only a first visit lands on the way in's battle map.

## 2. What there is today

- **A way out's menu** lists each route it serves, and repeats each one for every way in at the other end ("Set out for Dunscombe by road, arriving by the North Gate", "… arriving by the Harbour"; L-346, #669).
- **Travel** is one leg at a time, to a linked neighbour (`leavingTown`, `functions/loom-turn/adjudicate.js`); its time is the leg's (`travel.trip`, L-373).
- **Arrival** lands at the way in chosen, or the first open one serving the route (`town.arrivalPlace`); a way in with a battle map always lands on it (`maps.arrivalMutations`).
- **Ways in and out** are known from the start in a town with ground (`town-found.js`: `isEntrance` places are always found); its other places are found by sight (L-673).
- **What the save remembers:** `discovered` (where it has been, and those places' neighbours: `discovery.js`), and per town the squares seen (`town-seen.js`). Visits as such are not kept.

## 3. Gap sheet (answered 2026-10-25)

| #   | Question                                                          | Decided                                                                                                                                                                        |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JA1 | Which settlements can a journey go to, and through?               | **Visited to visited:** only to settlements the player has arrived in before, along a path whose every stop they have also been to.                                            |
| JA2 | What makes a settlement "explored", for arriving on its town map? | **Been there once:** the first arrival lands on the way in's battle map; every later one on the town map at the way in, with what was found there before still known.          |
| JA3 | What happens in the towns a journey passes through?               | **Straight through:** one move; the legs' travel time plus each town's walk from way in to way out, summed; narrated as one journey naming the towns passed. Nothing stops it. |
| JA4 | Arriving somewhere new, which ways in and out are known?          | **Only the one you came by:** the others are found by exploring, like any place. Leaving needs a way out you know that serves the route.                                       |
| JA5 | Crossing a visited town by a gate not yet found there             | **Crossing finds the gates:** passing through uses the way in and way out the legs need, and both become known in that town.                                                   |
| JA6 | Where do journeys appear?                                         | **The world map only:** a click on a settlement you've been to offers the journey with its time. A way out lists its neighbours only.                                          |

## 4. Design

### 4.1 Visits

- **`save.visited`**: the settlements the save has arrived in, in order of first arrival. A move that changes `location` adds the place arrived at, and every town a journey crosses.
- **Saves from before:** the settlement it's in, and every settlement with a town record (`loom_saves/{id}/towns`, L-670), are taken as visited. A place only seen on the map (`discovered`) isn't.

### 4.2 The way in (JA4)

- **The most direct way in:** an open way in serving the route arrived by, and of those the one facing where the traveller came from. That is the way in whose position in town lies nearest the bearing from the settlement to the origin on the world map. A chosen way in (L-346) is no longer offered; one arriving by an older save's pending choice is still honoured.
- **Knowing it:** the way in arrived by is found in that town (kept with the town's record), as are the ways a journey crosses by (JA5). A town's other ways in and out are found like any place: by sighting their door (L-673).
- **Leaving** needs a way out the save knows that serves the route (`leavingTown`). With none, the way out's line says so: "You know no way out of Hatham by road. Explore to find one."

### 4.3 Arriving on the town map (JA2)

- **First visit:** as today, a way in with a battle map lands on it, at its entry.
- **Later visits:** the save lands on the town map at the way in (its place, or its street point in a town with ground). The way in's battle map is entered from the town as any place's is.
- **Towns without ground** are known whole as today (`foundIn` null); only the battle-map rule changes.

### 4.4 The way out's menu

- **A way out** lists each neighbouring settlement it serves, once, with its trip time: "Set out for Dunscombe by road · about 14½ hours". It arrives by the most direct way in (§4.2).
- **The wilderness** (L-360) joins this list when it ships, as one more entry.

### 4.5 Journeys (JA1, JA3, JA5, JA6)

- **The route:** the quickest path by travel time over the world's links between settlements in `visited`, from here to the one chosen. Every stop on it must be visited, and each leg passable for the save (not closed, no ability missing).
- **Offered** on the world map: a click on a visited settlement that isn't a neighbour offers "Journey to Keton · 3 days, through Hatham and Bridgeford". A neighbour still offers Travel, as now. A visited settlement with no path through visited ones says why: "No way you know leads there."
- **Setting out from anywhere:** as with #669, the player first walks to the way out serving the first leg (on the streets turn after turn, through a town's places in one go).
- **The time:** each leg's trip time (L-373), plus each crossed town's walk from its way in to its way out (`travel.townWalk`). Nights are camped as on any trip.
- **Crossing a town** finds the way in and way out it uses there (JA5), and adds the town to `visited`; nothing else there is found.
- **Arriving** at the end lands by the most direct way in for the last leg, on the town map (it's visited, by JA1).
- **NARRATE** tells it as one passage, naming the towns passed and the time taken. The rules' lines are "You journey 3 days by road and sea, through Hatham and Bridgeford, and arrive at Keton, at the Water Gate."

### 4.6 Grading

None: journeys and arrivals add no content to the game.

## 5. Exit criterion

On Nisia, a new save leaves Hatham by its only known way out with one entry per neighbour; arrives at Bridgeford by the way in facing Hatham, on its battle map, knowing no other gate; leaves and returns to land on Bridgeford's town map; and from Bridgeford makes one journey back to Hatham through a town it has visited, the time summed and that town's gates found.

## 6. Sub-issues (filed 2026-10-25)

| Story | What                                                                                                                                                           | Depends on | Model  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| L-381 (#700) | **Visits and the way in:** `save.visited` (older saves derived); the most direct way in; only the ways arrived or crossed by known; leaving by a known way out | —          | Opus   |
| L-382 (#701) | **Arriving on the town map:** a visited settlement lands on its town map at the way in; a first visit on the way in's battle map                               | L-381      | Sonnet |
| L-383 (#702) | **The way out's menu:** one entry per neighbour with its time, arriving by the most direct way in; chosen ways in retired from the menu                        | L-381      | Sonnet |
| L-384 (#703) | **Journeys:** the quickest path through visited settlements, its time, crossing towns finds their gates; the world map's Journey to, narrated as one passage   | L-381      | Opus   |

**Order:** L-381 first; L-382, L-383 and L-384 follow in any order. Each is checked in headless Chrome against the emulators on Nisia-like data, and on a phone width.
