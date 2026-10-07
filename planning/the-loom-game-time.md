# The Loom — Game Time — Design Document v0.1

**Status:** Draft. The gap sheet (§3) needs answers before sub-issues are filed.
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
- **The numbers in the exit criterion don't hold.** `get_location` shows Hatham to Daldockley as 5, but that's **map units**, not miles. In miles that's about 10 straight-line (positions 153, 615 and 156.6, 611.7), so about 5 hours by trail at 2 mph, not 2½. The lore says "barely an hour's walk apart" and "visible across the bay". The map, the lore and the exit criterion all disagree (T6).
- **Towns get a size in Phase 3c.** `town.size`, in metres across, from the settlement's size by default (L-651 / #463). A walk in a town without ground can then be timed by distance like everything else (T11).
- **INTERPRET's verbs are free-form** (`functions/loom-turn/interpret.js`). Waiting needs a verb with a duration that ADJUDICATE can check.

---

## 3. Gap sheet

Each question has a recommendation. Answer by ID. "Rec" is what §4 assumes.

| ID      | Question                                             | Options                                                                                                                               | Rec                                                                                                                                                         |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1**  | What does the clock count?                           | Minutes · seconds                                                                                                                     | **Seconds** (`save.time`), since a battle-map turn is 6 s                                                                                                   |
| **T2**  | When does a game begin?                              | Day 1 at dawn · morning (08:00) · set per world over MCP                                                                              | **Day 1, 08:00**; a world's opening hour can come later                                                                                                     |
| **T3**  | Which times of day are there?                        | Hours shown · named parts only                                                                                                        | **Named parts:** dawn 05–07, morning 07–12, midday 12–14, afternoon 14–17, evening 17–20, night 20–05                                                       |
| **T4**  | How does a turn take time?                           | A fixed length, charged when the turn ends · by movement spent                                                                        | **Fixed:** 6 s on a battle map, 5 min elsewhere (town, or a place with no map), charged at End turn                                                         |
| **T5**  | Do typed actions take time of their own?             | No, the turn covers them · a few minutes each (#421's sketch)                                                                         | **No.** The turn covers them. Only travel and waiting add time                                                                                              |
| **T6**  | Where do route lengths come from?                    | (a) straight line × map scale · (b) (a) × a winding factor · (c) (a) or (b), and Claude can set a link's miles over MCP               | **(c):** straight line × scale × **1.25** for winding, and Claude can set a link's miles. That's about 12 mi for Hatham to Daldockley unless Claude sets it |
| **T7**  | What happens to Hatham and Daldockley?               | Keep the map's distance and fix the lore · Claude sets the link to match the lore (about 3 mi) · the exit criterion uses another pair | **Claude sets the link to 3 mi** (1½ hours by trail), and the exit criterion says so                                                                        |
| **T8**  | How fast is travel by route kind?                    | Road 3 mph, trail 2, sea 5 (#421's sketch) · others                                                                                   | **As sketched**                                                                                                                                             |
| **T9**  | How long is a day's travel?                          | 8 h on land, then camp until 07:00 · sea sails day and night · both                                                                   | **Both:** 8 h a day on land, round the clock at sea                                                                                                         |
| **T10** | What about travel that starts late in the day?       | Count travel hours only, with nights added by length · travel only between dawn and dusk                                              | **By length only.** Each full 8 h of land travel past the first adds a night (16 h). It's predictable, and the narrator covers the dark                     |
| **T11** | How long is a walk in a town without ground (links)? | By distance at walking pace (needs `town.size`, L-651) · a fixed time per place passed                                                | **By distance**, at the same 80 m a minute as the town turn                                                                                                 |
| **T12** | How do waiting, resting and sleeping work?           | A `wait` verb with `{ minutes }` or `{ until }` (dawn, morning, midday, evening, night) · minutes only                                | **Both forms**, capped at 24 h. It uses the turn's action and ends the turn                                                                                 |
| **T13** | Does the time of day change any rules yet?           | Narration only · darkness limits sight · places close at night                                                                        | **Narration only.** Light and opening hours come later                                                                                                      |
| **T14** | What does the GM get told?                           | The time of day · and the time that passed, and whether dusk or dawn came on the way                                                  | **Both.** The resolution carries "Night falls on the trail." when travel crosses dusk                                                                       |
| **T15** | What does the play view show?                        | "Day 1, evening" in the turn bar · and travel times on the world map cards · and the time a walk takes in town                        | **All three:** turn bar, map cards ("about 1½ hours by trail"), and the town view's path card                                                               |
| **T16** | Where do older saves start?                          | Day 1, 08:00 · estimated from their turn count                                                                                        | **Day 1, 08:00**                                                                                                                                            |

---

## 4. Design (assuming the recommendations)

### 4.1 The clock

- **Data.** `save.time`: whole seconds since the game began, Day 1 at 00:00. A new game starts at 08:00 (28,800). Older saves get it on their next turn (T16).
- **A clock module** (`functions/loom-canon/clock.js`): the day and part of day for a time (T3); a label ("Day 1, evening"); the parts of day crossed between two times ("dusk", "dawn"); and duration words ("about 1½ hours", "2 days").
- **Turns** (T4). End turn adds the turn's length: 6 s on a battle map, 300 s elsewhere. "Walk there" in town plays several turns, so it adds several.

### 4.2 Travel

- **Miles per link** (T6). A link's length is the straight line between the two places × `map.distance.perMapUnit` × 1.25, worked out when read, never stored. Claude can set it, stored as `geo.miles[otherId]` on both ends. Worlds with no scale (the static seed world) take a default per world, set in canon.
- **Speed by route** (T8): road 3 mph, trail 2, sea 5.
- **Days on the road** (T9, T10). On land, each full 8 h of travel past the first adds 16 h for a night camped. At sea there are no stops.
- **ADJUDICATE** adds the time to every world move, and says how long it took and what it crossed: "After about 1½ hours on the trail, you arrive at Daldockley." / "Night falls on the trail."
- **In town without ground** (T11): the walk's length in metres (place positions on the 0–1000 square, scaled by `town.size`) at 80 m a minute.

### 4.3 Waiting

- **INTERPRET** reads `wait` with `params: { minutes }` or `{ until }` (T12).
- **ADJUDICATE** caps it at 24 h, adds the time, uses the action and ends the turn. "You sleep until dawn." Sleeping when it's already dawn waits for the next one.

### 4.4 The GM and the play view

- **INTERPRET and NARRATE** get a TIME line: "Day 3, evening. 1½ hours passed; dusk fell on the way." (T14)
- **`loomGetMap`** carries `time: { seconds, label }`, and each link from here carries `miles` and `travel` ("about 1½ hours by trail").
- **The play view** (T15): the turn bar shows "Day 1, evening"; world map cards show the travel time; the town path card shows the walk ("2 turns · about 10 minutes").

---

## 5. Sub-issues (proposed)

| ID    | Story                                                                                                                   | Depends on          | Model  |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| L-371 | **Time in saves:** `save.time`, the clock module, older saves, End turn adds the turn's length                          | —                   | Sonnet |
| L-372 | **Route lengths:** miles per link (scale, winding, per-world default), set over MCP, shown in `get_location`            | —                   | Sonnet |
| L-373 | **Travel takes time:** world moves by route and speed, nights on the road, town walks without ground, the arrival lines | L-371, L-372, L-651 | Opus   |
| L-374 | **Waiting, resting and sleeping:** the `wait` verb, its checks, the turn after it                                       | L-371               | Sonnet |
| L-375 | **The GM knows the time:** the TIME line in INTERPRET and NARRATE, dusk and dawn on the way                             | L-373               | Sonnet |
| L-376 | **The clock in the play view:** turn bar, map card travel times, the town path card                                     | L-371, L-373        | Sonnet |

**Order:** L-371 and L-372 can run side by side. L-373 is the spine. L-374 to L-376 follow it, in any order.

Each story is tested on its own: pure-module tests for the clock and route lengths, emulator tests for the pipeline with Gemini stubbed, a real MCP client for the miles tool, and headless Chrome for the views.

---

## 6. Exit criterion (proposed, per T7)

In Nisia, after Claude sets the Hatham to Daldockley trail to 3 miles, a player leaves Hatham's Trailhead at Day 1, morning and arrives at Daldockley about 1½ hours later. A few turns in town take minutes. After sleeping until evening, the play view shows "Day 1, evening". Setting out for Midhurstle (about 20 miles by trail), the narrator describes nightfall on the trail, and the player arrives on Day 2.

---

## 7. Later

- **Light:** darkness limits sight at night, with torches and darkvision (Movement and Vision §11).
- **Fatigue and hunger**, from the time spent travelling and awake.
- **Opening hours** for places in town.
- **A world's opening hour**, and a calendar.
- **Mounts and ships** with their own speeds.
- **Saves and a shared world time**, in multiplayer (Phase 4).
