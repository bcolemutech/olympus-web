# The Loom — Game Time — Design Document v0.1

**Status:** Decided (2026-10-08), revisited 2026-10-15 after the UI rewrite (§3, R1–R4). Sub-issues filed: L-371 to L-376 (#499–504). ✅ Shipped (2026-10-15), all six: L-371, time in saves: `save.time` (seconds since Day 1, 00:00; a new game and an older save's next turn start at 08:00), the clock module (`functions/loom-canon/clock.js`: the part of day, labels, dawn and dusk crossed, durations in words) with `timeRules(world)` holding every number, and End turn adding 6 s on a battle map and 5 min anywhere else. L-372, route lengths: `functions/loom-canon/routes.js` gives each route its miles when read (the straight line × the map's scale in miles × 1.25; a world without a scale takes Azgaar's default, 3 mi a map unit; no position, no length), and `get_location` shows `miles` on each connection. L-373, travel takes time: `functions/loom-canon/travel.js` times a world trip (miles at the route's speed; on land, a night camped of 16 h before each travel day past the first, so a 10-hour trail is 26 h; the sea sails through) and a walk across a town without ground (80 m a minute); ADJUDICATE sets `save.time` and says how long it took and what fell on the way ("Night falls on the trail.", "After about 6 hours on the trail, you arrive at Daldockley."), and keeps `time: { from, to, seconds, crossed }` in the resolution for L-375; `loomGetMap` gives each route out of here `travel: { miles, seconds, label, arrives }` from the same `trip()`. L-375, the GM knows the time: INTERPRET gets a TIME line with the day and part of day, and NARRATE one with how much passed and any dusk or dawn on the way ("Day 1, night. About 6 hours passed; dusk fell on the way.", or "No time passed."), from `clock.timeLine`, and is told to honour it. L-374, waiting, resting and sleeping: INTERPRET reads `wait` with `{ minutes }` or `{ until }` (and `how`: sleep or rest), and ADJUDICATE waits that long, capped at 24 h, or to the next start of that part of day (`clock.nextStartOf`: sleeping until dawn at dawn waits for the next one), uses the action and ends the turn ("You sleep until dawn."); a wait with neither asks how long and spends nothing. L-376, time in the play view: `loomGetMap` and every turn and step answer carry `time: { seconds, label }`; the overlay's top-left slot shows the label ("Day 1, evening") at every level and on phones; a world place's Move entry reads "Travel to Daldockley · about 6 hours by trail", with the part of day on arrival when night falls or day breaks on the way ("arriving at night", "arriving on Day 2, in the morning"). No night look yet (R4).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-370 (#421)
**Follows:** Phase 3c "Movement and Vision" ([`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md))
**Related:** [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §2, §10; [`roadmap.md`](./roadmap.md) §3

---

## 1. Purpose

Give each save a clock. Travel, turns and waiting move it on, the GM knows the time of day, and the play view shows it ("Day 1, evening"). This is the groundwork for light and darkness, fatigue and hunger, which come later.

**Already decided** (#421, 2026-10-01 and 2026-10-02):

- **The clock is each save's own.** How saves line up with a world time is a multiplayer question (Phase 4).
- **A day count only**, with no calendar.
- **Built after Movement and Vision**, which turns its turns into time: 6 seconds a battle-map turn, about 5 minutes a town turn (400 m at walking pace).
- **`worldClock` stays** a turn counter in the shared world state.

---

## 2. What there is today

Found in the code (2026-10-07), and what it means for this epic:

- **A turn is a turn record, not a duration.** `save.turn` is `{ n, movementLeft, actionUsed, plan }` (`functions/loom-models.js`). End turn refills it and bumps `worldClock` (`evaluateEndTurn`, `functions/loom-turn/adjudicate.js`). Time can attach to it in one place.
- **Every move resolves in ADJUDICATE.** World travel (`evaluateMove`), a walk across town (`evaluateTownMove`), map moves and exits each return `{ outcome, mutations, constraints }`, which COMMIT applies. A time mutation fits in the same shape.
- **Steps on a battle map skip the pipeline** (`functions/loom-turn/steps.js`). They spend movement inside a transaction. Their time is best charged when the turn ends, not per step.
- **Routes have no length.** A link stores only its kind: `geo.links[otherId] = 'road' | 'trail' | 'sea'`. The route's path (`cellIds`) is dropped at import (`functions/cartographer/map.js`).
- **Places have positions, and worlds have a scale.** Locations have `geo.x`, `geo.y` in map units, and imported worlds have `map.distance: { unit, perMapUnit }` from Azgaar (Nisia: **2 mi per map unit**). The MCP tools already report straight-line distance between linked places, in map units (`functions/mcp/apps/cartographer/views.js`).
- **The numbers in #421's exit criterion didn't hold.** `get_location` shows Hatham to Daldockley as 5, but that's **map units**, not miles. In miles that's about 10 straight-line (positions 153, 615 and 156.6, 611.7), so about 5 hours by trail at 2 mph, not 2½. The lore says "barely an hour's walk apart" and "visible across the bay". The map, the lore and the exit criterion all disagreed. The map wins (T6, T7).
- **Towns get a size in Phase 3c.** `town.size`, in metres across, from the settlement's size by default (L-651 / #463). A walk in a town without ground can then be timed by distance like everything else (T11).
- **INTERPRET's verbs are free-form** (`functions/loom-turn/interpret.js`). Waiting needs a verb with a duration that ADJUDICATE can check.

---

## 3. Gap sheet

Settled with the user (2026-10-08). T1, T8, T11 and T14 took the recommendation without a question.

| ID      | Question                                             | Decision                                                                                                                                                |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1**  | What does the clock count?                           | **Seconds** (`save.time`), since a battle-map turn is 6 s                                                                                               |
| **T2**  | When does a game begin?                              | **Day 1, 08:00.** A world's opening hour can come later                                                                                                 |
| **T3**  | Which times of day are there?                        | **Named parts, no hours shown:** dawn 05–07, morning 07–12, midday 12–14, afternoon 14–17, evening 17–20, night 20–05                                   |
| **T4**  | How does a turn take time?                           | **A fixed length, charged at End turn:** 6 s on a battle map, 5 min elsewhere (town, or a place with no map)                                            |
| **T5**  | Do typed actions take time of their own?             | **No.** The turn covers them. Only travel and waiting add time                                                                                          |
| **T6**  | Where do route lengths come from?                    | **The map only:** straight line × map scale × **1.25** for winding. No override over MCP                                                                |
| **T7**  | What happens to Hatham and Daldockley?               | **The map's distance stands** (about 12 mi, 6 hours by trail), and **the lore is fixed** to match                                                       |
| **T8**  | How fast is travel by route kind?                    | **Road 3 mph, trail 2, sea 5**                                                                                                                          |
| **T9**  | How long is a day's travel?                          | **8 h a day on land**; ships sail round the clock                                                                                                       |
| **T10** | What about travel that starts late in the day?       | **By length only.** Each full 8 h of land travel past the first adds a night (16 h). The narrator covers the dark                                       |
| **T11** | How long is a walk in a town without ground (links)? | **By distance**, at the town turn's 80 m a minute                                                                                                       |
| **T12** | How do waiting, resting and sleeping work?           | **A `wait` with `{ minutes }` or `{ until }`** (dawn, morning, midday, afternoon, evening, night), capped at 24 h. It uses the action and ends the turn |
| **T13** | Does the time of day change any rules yet?           | **Narration only.** Light and opening hours come later                                                                                                  |
| **T14** | What does the GM get told?                           | **The time of day, the time that passed, and any dusk or dawn on the way**                                                                              |
| **T15** | What does the play view show?                        | **"Day 1, evening" on the map** (revisited, R1, R3)                                                                                                     |
| **T16** | Where do older saves start?                          | **Day 1, 08:00**                                                                                                                                        |

### Revisited after the UI rewrite (2026-10-15)

L-720 rebuilt the play view and Phase 9 (game systems) was planned since this was decided. Settled with the user:

| ID     | Question                         | Decision                                                                                                                                                                                                     |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **R1** | Where the clock shows            | **Top left of the map**, beside where you are. L-725's overlay already has the slot (`turn.time`). There is no turn bar text                                                                                 |
| **R2** | Turn lengths, travel day, speeds | **Defaults behind one function** that takes the world: `timeRules(world)`. L-710 (L-714) then supplies route speeds from `world.routeKinds`, and Phase 9 lets a system set turn lengths, with no rework here |
| **R3** | Travel time before you go        | **In the click menu:** a place's Move entry says "Travel to Daldockley · about 6 hours by trail", and the part of day you'd arrive in when the trip crosses dusk. Town walks don't show it yet               |
| **R4** | Night on the map                 | **Not yet.** The map looks the same by day and night until the light epic, so darkness looks and plays right together (T13 stands)                                                                           |

---

## 4. Design

### 4.1 The clock

- **Data.** `save.time`: whole seconds since the game began, Day 1 at 00:00. A new game starts at 08:00 (28,800). Older saves get it on their next turn (T16).
- **A clock module** (`functions/loom-canon/clock.js`): the day and part of day for a time (T3); a label ("Day 1, evening"); the parts of day crossed between two times ("dusk", "dawn"); and duration words ("about 1½ hours", "2 days").
- **Turns** (T4). End turn adds the turn's length: 6 s on a battle map, 300 s elsewhere. "Walk there" in town plays several turns, so it adds several.
- **The rules in one place** (R2). `timeRules(world)` returns `{ turnSeconds: { battle: 6, other: 300 }, travelDayHours: 8, routeSpeeds: { road: 3, trail: 2, sea: 5 }, roundTheClock: ['sea'] }`. Every use reads it; nothing else holds these numbers. L-714 and Phase 9 change only this function.

### 4.2 Travel

- **Miles per link** (T6). A link's length is the straight line between the two places × `map.distance.perMapUnit` × 1.25, worked out when read, never stored. Worlds with no scale (the static seed world) take a default per world, set in canon. `get_location` shows it in miles, not map units.
- **Speed by route** (T8): road 3 mph, trail 2, sea 5, from `timeRules` (R2).
- **Days on the road** (T9, T10). On land, each full 8 h of travel past the first adds 16 h for a night camped. At sea there are no stops.
- **ADJUDICATE** adds the time to every world move, and says how long it took and what it crossed: "After about 6 hours on the trail, you arrive at Daldockley." / "Night falls on the trail."
- **In town without ground** (T11): the walk's length in metres (place positions on the 0–1000 square, scaled by `town.size`) at 80 m a minute.

### 4.3 Waiting

- **INTERPRET** reads `wait` with `params: { minutes }` or `{ until }` (T12).
- **ADJUDICATE** caps it at 24 h, adds the time, uses the action and ends the turn. "You sleep until dawn." Sleeping when it's already dawn waits for the next one.

### 4.4 The GM and the play view

- **INTERPRET and NARRATE** get a TIME line: "Day 3, evening. 1½ hours passed; dusk fell on the way." (T14)
- **`loomGetMap`** and step answers carry `time: { seconds, label }`, and the turn's `time` label feeds the overlay.
- **Travel estimates** (R3): `loomGetMap` gives each route out of here `travel: { miles, seconds, label, arrives }` ("about 6 hours by trail", and the part of day on arrival when it differs), worked out by the same code that charges the trip, so the estimate and the result always agree.
- **The play view** (T15, R1, R3): "Day 1, evening" top left of the map, and the Move entry of a place's click menu carries its travel estimate. No night look yet (R4).

---

## 5. Sub-issues

| ID    | Story                                                                                                                                                     | Depends on          | Model  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| L-371 | **Time in saves:** `save.time`, the clock module, `timeRules(world)`, older saves, End turn adds the turn's length                                        | —                   | Sonnet |
| L-372 | **Route lengths:** miles per link (scale, winding, per-world default), shown in miles in `get_location`                                                   | —                   | Sonnet |
| L-373 | **Travel takes time:** world moves by route and speed, nights on the road, town walks without ground, the arrival lines, travel estimates in `loomGetMap` | L-371, L-372, L-651 | Opus   |
| L-374 | **Waiting, resting and sleeping:** the `wait` verb, its checks, the turn after it                                                                         | L-371               | Sonnet |
| L-375 | **The GM knows the time:** the TIME line in INTERPRET and NARRATE, dusk and dawn on the way                                                               | L-373               | Sonnet |
| L-376 | **Time in the play view:** "Day 1, evening" top left of the map; travel estimates in the Move entry of the click menu                                     | L-371, L-373        | Sonnet |

**Order:** L-371 and L-372 can run side by side. L-373 is the spine. L-374, L-375 and L-376 follow it.

**Content, not code:** ✅ Done (2026-10-08, canon version 323). The Drowned Ledger of Hatham now has the two towns "half a day's hard walk apart by the muddy trail that winds around the shore", in place of "barely an hour's walk apart". The two towns' descriptions keep "a short one": at about 12 miles it's still Hatham's shortest trail (Skipton and Brorough are about 30 and 45).

Each story is tested on its own: pure-module tests for the clock and route lengths, emulator tests for the pipeline with Gemini stubbed, a real MCP client for `get_location`, and headless Chrome for the clock on the map and the Move entry's estimate.

---

## 6. Exit criterion

In Nisia, a player leaves Hatham's Trailhead on Day 1, morning, and arrives at Daldockley about 6 hours later (about 12 miles by trail), on Day 1, afternoon. A few turns in town take minutes. After sleeping until evening, the map shows "Day 1, evening". Before setting out, the Move entry for Midhurstle says how long it takes. Setting out for Midhurstle (about 20 miles by trail), the narrator describes nightfall on the trail, and the player arrives on Day 2.

---

## 7. Later

- **Light:** darkness limits sight at night, with torches and darkvision (Movement and Vision §11).
- **Fatigue and hunger**, from the time spent travelling and awake.
- **Opening hours** for places in town.
- **A world's opening hour**, and a calendar.
- **Travel times for town walks** and on the map cards, and setting a route's miles over MCP (T6), if play shows they're wanted.
- **Night on the map** (R4): with light, a darker look at night and warm light at dusk and dawn.
- **Mounts and ships** with their own speeds.
- **Saves and a shared world time**, in multiplayer (Phase 4).
