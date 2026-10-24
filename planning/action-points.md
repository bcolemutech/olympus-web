# The Loom — Action Points — Design Document v0.1

**Status:** In progress. Decided 2026-10-23: the gap sheet (§3) is answered. Sub-issues filed 2026-10-24 (#681–#687, §6); L-831 shipped (#688); L-832 shipped (#690); L-833 shipped (#691); L-838 shipped (#693); L-834 shipped (#694); L-835 in progress.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-830 (#675), Phase 9 — Game systems (milestone #25). Built before advancement (now L-840); the modules after it start at L-850 (renumbered 2026-10-23).
**Depends on:** L-820 (#651, combat), L-810 (#607, sheets and effects), L-610 (turns and movement).
**Related:** [`game-systems.md`](./game-systems.md), [`combat.md`](./combat.md), [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md), [`the-loom-game-time.md`](./the-loom-game-time.md)

---

## 1. Purpose

Movement and actions become one pool: **Action Points (AP)**. The game system sets the pool, as a number or a formula from the sheet. AP pays for moving, for every action and for every reaction. A player can spend it all on their turn, or keep some back to act off their turn. Difficult ground costs double; a small thing (opening a door, speaking) costs a little; an attack costs a lot. Powers and abilities later on draw from the same pool (the user's idea, 2026-10-23).

It replaces three budgets that shipped with L-610 and L-820: movement points from the sheet's speed, one action a turn, and reactions counted per round.

---

## 2. What there is today

- **A grid turn** (`save.turn`, `functions/loom-models.js`): `{ n, movementLeft, actionUsed, plan }`. `movementLeft` starts at the sheet's speed (the system's `sheet.speed` formula: fantasy `20 + mod(DEX) + floor(Athletics / 2)`, sci-fi `14 + 2 × Reflex + Athletics`, plus traits' `modifiers.speed`); one action a turn.
- **Steps** (`functions/loom-turn/steps.js`, `functions/loom-canon/layers.js`, the shared `grid-paths.js`): a square costs 1, diagonals too; difficult ground 2; opening a closed door on the way 1 more.
- **Combat** (`functions/loom-modules/combat/`): the system's `economy { actions, reactions, quick? }`; reactions refresh each round (`reactions.js`); Dash, Dodge, Withdraw, Ready and Use spend the action (`others.js`, `position.js`); tactics and named characters' turns choose from whole turns (`tactics.js`, `named-turns.js`).
- **Conditions** (L-815): `noMove` and `noAction` flags; `modifiers.speed`.
- **Towns** walk by distance and 5-minute turns, or by squares on town ground; a grid turn is 6 seconds (L-371).
- **The Loom:** the turn bar shows movement left; the click menu offers the actions; a path preview shows where you'll walk; the turn-order bar runs across the top (L-828).

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-23); every answer took the recommendation, except that kept AP isn't shown on the turn-order bar.

### The pool, and where it applies

| ID      | Question      | Decision                                                                                                                                           |
| ------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AP0** | The idea      | **One pool of AP pays for moving, every action and every reaction;** spend it all on your turn or keep some for off-turn actions (the user's idea) |
| **AP1** | Size          | **The system's `ap` formula takes the place of speed, at about today's numbers (20 to 30).** A square stays 1 AP                                   |
| **AP2** | Sci-fi        | **The same scale and costs,** with its own pool formula from its attributes                                                                        |
| **WH1** | On grids      | **Every grid turn runs on AP,** in a fight or not                                                                                                  |
| **WH2** | In towns      | **Towns keep walking by distance and time;** actions there cost no AP                                                                              |
| **WH3** | A turn's time | **Still 6 seconds,** however much AP is spent                                                                                                      |

### Costs

| ID      | Question            | Decision                                                                                                                                                                                                                                         |
| ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CT1** | Defaults            | **Kept** (§4.2): a square 1; difficult ground 2; a door, a few words or starting a conversation 2; standing up, trying a lock or using an object 5; Withdraw and Defend 5; Dodge 8; an attack 10 (or its own); typed actions 3, 10 or 20 by tier |
| **CT2** | Where costs are set | **The system's cost table; each attack; a door, lever or feature on a map; and traits and conditions** that change costs                                                                                                                         |
| **CT3** | Typed actions       | **INTERPRET picks a tier** (minor, standard, major); the system sets each tier's cost. The model names a tier, never a number; plausibility (L-826) still applies                                                                                |
| **CT4** | Not enough AP       | **The action can't be taken this turn,** except **long actions** marked as such, which spread over several turns: the AP put in so far is kept until done or interrupted                                                                         |

### Keeping AP, order, conditions and other pools

| ID      | Question                  | Decision                                                                                                                                              |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KP1** | Unspent AP                | **Stays usable off your turn until your next turn starts,** then the pool refills; nothing carries into the next round                                |
| **KP2** | A limit                   | **None by default;** a system can set one                                                                                                             |
| **KP3** | Readying                  | **Sets the action's AP aside now;** if the trigger never comes, it's lost at your next turn                                                           |
| **KP4** | Reactions                 | **As many as kept AP pays for**                                                                                                                       |
| **TO1** | Turn order                | **Initiative as today;** AP doesn't change it                                                                                                         |
| **EF1** | Conditions                | **Change the pool or costs:** Stunned leaves 0 AP, Slowed takes some away, Prone doubles movement; `noMove` and `noAction` become these               |
| **FP1** | Powers later              | **AP plus their own resource** where they have one (mana, slots, charges): AP says how long it takes, the resource how often                          |
| **FP2** | Foes and named characters | **Plan turns that fit their AP** (move then strike, strike then step away, or hold AP to react); named characters' AI picks from whole turns that fit |

### In the Loom, the switch and the end

| ID      | Question       | Decision                                                                                                                                                                                                   |
| ------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI1** | Showing AP     | **An AP bar on the turn bar,** kept AP shown as held; **each menu entry shows its cost,** greyed out when unaffordable; **a path preview shows its cost** and where AP runs out. Not on the turn-order bar |
| **MG1** | The switch     | **Systems get an `ap` formula and a cost table in place of speed and `economy`; saves are converted,** a fight in progress carrying on with every pool full                                                |
| **PL1** | When           | **Its own epic now, before advancement**                                                                                                                                                                   |
| **PL2** | Exit criterion | **Kept** (§5)                                                                                                                                                                                              |

---

## 4. Design

### 4.1 The system's settings

- **`sheet.ap`** replaces `sheet.speed`: a formula over attributes, skill ranks and level. The built-ins keep today's numbers: fantasy `20 + mod(DEX) + floor(Athletics / 2)`, sci-fi `14 + 2 × Reflex + Athletics`.
- **`ap.costs`**, the cost table (§4.2), checked on save; a system may change any entry.
- **`ap.tiers`**: `{ minor, standard, major }` for typed actions (CT3).
- **`ap.keepLimit`**: none by default (KP2).
- **`modules.combat.economy`** is retired: actions and reactions are paid in AP.
- **AP can be off** (MD9, 2026-10-24): a system with `ap: false` plays without a pool (decided 2026-10-24: switched off explicitly, so a system with no `ap` keeps the defaults). Steps on a grid are then free and each turn takes one action, as before AP; combat sets its own turn rule (`modules.combat.turn: { actions, reactions }`, one each), reactions counting by the round (L-838).

### 4.2 Default costs (CT1), the same in both built-ins

| Spend                                                         | AP                           |
| ------------------------------------------------------------- | ---------------------------- |
| A square of movement (diagonals the same)                     | 1                            |
| A square of difficult ground                                  | 2                            |
| Open or close a door; speak a few words; start a conversation | 2                            |
| Stand up from prone                                           | 5                            |
| Try a lock; pick up, hand over or use an object               | 5                            |
| Withdraw; Defend (a reaction)                                 | 5                            |
| Dodge                                                         | 8                            |
| Attack                                                        | 10, or the attack's own `ap` |
| An attack off your turn (opportunity, readied)                | the attack's                 |
| Typed actions: minor / standard / major                       | 3 / 10 / 20                  |

- **Overrides (CT2):** an attack's `ap` (a dagger 7, a greataxe 14); a door's or feature's `ap` on a map (a rusted portcullis 10); traits and conditions with `modifiers.ap` (to the pool) and `costs` (multipliers or set costs: Light-footed makes difficult ground 1; Prone doubles movement).
- **Dash** goes: moving further is just spending AP on squares.

### 4.3 A turn on AP (WH1, WH3, CT4)

- **`save.turn`** becomes `{ n, ap, kept, reserved?, long?, plan }`: `ap` left this turn; `kept` after End turn (usable off-turn, KP1); `reserved` for a readied action (KP3); `long` for a long action in progress.
- **Every grid turn, in a fight or not,** starts with the full pool; a turn is 6 seconds however much is spent.
- **Steps** are priced by the cost table through `layers.pathOptions` and the shared `grid-paths.js` (both copies); a walk stops where AP runs out.
- **An action** checks its cost against `ap` and spends it; with too little, it's refused, spending nothing.
- **Long actions (CT4):** an action marked `long: { ap }` (a hard lock, a ritual, bandaging) takes AP over several turns; what's put in is kept on `turn.long` until it's done, interrupted (taking damage, moving away) or abandoned.
- **Towns (WH2)** are unchanged: walking by distance and time, actions costing no AP.

### 4.4 Off your turn (KP1–KP4, TO1)

- **Kept AP** from your turn lasts until your next turn starts. Reactions (an attack when a foe leaves your reach, Defend) are paid from it, as many as it covers (KP4).
- **Ready** sets the readied action's cost aside (`reserved`); it fires when its trigger comes, or the AP is lost at your next turn.
- **Initiative** is unchanged.

### 4.5 Conditions (EF1)

- **`modifiers.ap`** changes the pool (Slowed −10); **`costs`** change prices (Prone doubles movement); **`ap: 0`** empties it (Stunned).
- The built-ins' conditions are rewritten: `noMove` and `noAction` become these, and the flags are retired.

### 4.6 Typed actions (CT3)

INTERPRET proposes a tier (minor, standard, major) with its check, from the system's tiers; ADJUDICATE validates and charges it. Plausibility (L-826) applies first: an improbable action is still rolled at the top rung, an extraordinary one refused, a complicated one asked about, and a refusal or question spends nothing.

### 4.7 Foes and named characters (FP2)

- **Tactics** plan a turn that fits the pool: by role and posture, a brute closes and strikes; a skirmisher strikes then steps away; an archer keeps range and holds AP for a readied shot; a guard keeps AP to react.
- **Named characters' AI** (L-825) chooses from whole turns the rules list that fit their AP.

### 4.8 Later pools (FP1)

Powers (L-850) and other abilities cost AP plus their own resource where they have one (mana, slots, charges).

### 4.9 In the Loom (UI1)

- **The turn bar** shows an AP bar in place of movement left, with kept AP shown as held after End turn.
- **The click menu** shows each entry's cost, greyed out when you can't afford it.
- **A path preview** shows its cost, and where your AP would run out.

### 4.10 The switch (MG1)

- **Systems:** the built-ins get `sheet.ap`, `ap.costs` and `ap.tiers`; `sheet.speed` and `economy` are retired. A world's own systems are converted (speed becomes `ap`, economy dropped), with warnings for anything unclear.
- **Saves:** `turn.movementLeft` and `actionUsed` become `turn.ap`; a fight in progress carries on, every pool full at the next turn.

### 4.11 Grading

AP adds no content to the game, so no grading criteria (the system's `ap` settings are checked with the rest of the system, L-801).

---

## 5. Exit criterion

In both built-in systems, a player crosses difficult ground at double cost, opens a door, attacks once, and keeps AP to make an attack when a foe steps out of reach; a foe stunned for a round has no AP; the turn bar and the menu show every cost.

---

## 6. Sub-issues (filed 2026-10-24)

| ID           | Story                                                                                                                                                                                                                         | Depends on | Model  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ------ |
| L-831 (#681) | **The pool and costs as data:** `sheet.ap`, `ap.costs`, `ap.tiers`, `ap.keepLimit`; overrides on attacks, map features, traits and conditions; checked on save; the built-ins; retiring speed and economy, converting systems | —          | Opus   |
| L-832 (#682) | **Turns on AP:** `save.turn` with `ap`; steps priced by the table (both `grid-paths.js` copies); every action charged; refused when short; long actions; converting saves                                                     | L-831      | Opus   |
| L-833 (#683) | **Off your turn:** kept AP until your next turn, reactions paid from it, Ready reserving its cost                                                                                                                             | L-832      | Sonnet |
| L-834 (#684) | **Conditions on AP:** `modifiers.ap`, `costs`, Stunned at 0; the built-ins' conditions rewritten; `noMove` and `noAction` retired                                                                                             | L-832      | Sonnet |
| L-835 (#685) | **Typed actions by tier:** INTERPRET proposes a tier, ADJUDICATE charges it, with plausibility first                                                                                                                          | L-832      | Sonnet |
| L-836 (#686) | **Foes and named characters on AP:** tactics plan turns that fit the pool by role and posture; named characters choose from whole turns that fit                                                                              | L-833      | Opus   |
| L-837 (#687) | **In the Loom:** the AP bar with kept AP, costs on menu entries (greyed when unaffordable), path previews with their cost                                                                                                     | L-832      | Sonnet |
| L-838 (#692) | **AP off (MD9):** `ap: false` switches AP off; free steps on a grid, one action a turn, combat's own turn rule (`modules.combat.turn`), reactions by the round; warnings for AP settings left on it                           | L-833      | Opus   |

**Order:** L-831, then L-832. L-833, L-834, L-835 and L-837 follow; L-836 after L-833; L-838 (filed 2026-10-24 for MD9) after L-833.

Tests: pure-module tests for costs, overrides and long actions in both built-in systems (MD2); the `grid-paths.js` copies still match; pipeline tests for a turn spending AP, reactions from kept AP, a readied action, Stunned at 0; headless Chrome for the bar, the menu costs and the path preview.
