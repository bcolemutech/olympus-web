# The Loom — Advancement — Design Document v0.1

**Status:** Decided (2026-10-28). The gap sheet (§3) is answered. Sub-issues filed 2026-10-28 (#713–#717, §6). **In progress:** L-841 advancement as data shipped (2026-10-31; `functions/loom-modules/advancement/`); L-842 earning experience shipped (2026-10-31; `advancement/earn.js`): foes are paid as they're overcome, when the fight ends or before (a foe dropped in round 1 is paid then), checked at commit against the fight as it stood. L-843 taking a level shipped (2026-10-31; `advancement/level-up.js`): offered at a long rest and kept as `save.levelOffer` until any other turn; the choices spend exactly what the level grants. L-844 improving by use shipped (2026-10-31; `advancement/use.js`): in a fight every success counts as having stakes; out of one, INTERPRET's `stakes` flag decides; a rise is one rank a rest however far past the threshold. L-845 in the Loom built (2026-10-31): the experience bar on the Character panel (labelled with the next level), the strip's mark, the level-up form in the journal (so in the bottom sheet on a phone; loomGetMap carries an offer not yet taken, with the rules' suggestion, after a reload), journal lines for awards and rises, and the rules reference; checked in headless Chrome under both built-ins and with advancement off.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-840 (#712), Phase 9 — Game systems (milestone #25).
**Depends on:** L-810 (sheets, creation), L-820 (combat: fights' ends, rests), L-830 (action points).
**Related:** [`game-systems.md`](./game-systems.md) (CS6, AD1, AD2), [`scenarios.md`](./scenarios.md) (G4), [`combat.md`](./combat.md)

---

## 1. Purpose

Characters grow. A game system grows them in one or both of two ways, as settings of one **advancement module**:

- **Experience and levels:** overcoming foes, story moments and quests pay experience by the system's formulas. A level is earned when its total is reached and taken at the next long rest, choosing what it grants.
- **Improving by use:** each success with real stakes counts toward the skill or attack used. At a long rest, any that reached its threshold rises.

The d20 built-in uses experience and levels. The dice-pool built-in uses both: experience raises its Rank, and skills and attacks improve by use. That gives two systems that differ in kind, as the module rule asks.

---

## 2. What there is today

- **A sheet** has a `level` in the system's range (d20: Level 1–20; dice pool: Rank 1–10), skill ranks, attributes, traits and attacks (L-811, L-822). Formulas read `level`, so d20 hit points (`level × (6 + mod(CON))`) already rise with it.
- **A system's `advancement`** is an empty object (CS6). Nothing awards anything.
- **Making a character** (L-812) is a guided flow with choices checked by the server (`functions/loom-canon/creation.js`).
- **Fights** know who was defeated, knocked out, fled or surrendered (L-822, L-824). **Rests** restore by the system's rests, a long one once a day (L-827). **INTERPRET** judges plausibility (L-826), and rolls come back with their degree (L-803, L-805).
- **Attacks** are formulas (`attack`, `damage`) with no rank of their own.

---

## 3. Gap sheet

Settled with the user through a questionnaire and three follow-ups (2026-10-28).

### The shape of it

| ID      | Question                  | Decision                                                                                                                                  |
| ------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **MX1** | How the two ways fit      | **One advancement module with two parts,** experience and levels, and improving by use; each system turns on either or both and sets them |
| **MX3** | The built-ins (follow-up) | **d20: experience and levels only. Dice pool: both:** experience raises its Rank; skills and attacks improve by use                       |
| **MX2** | Turning it off            | **A world can turn advancement off,** like death (a one-shot, a fixed-power story)                                                        |

### Experience

| ID      | Question           | Decision                                                                                                                                                                                                |
| ------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **XP1** | What earns it      | **Overcoming foes by any means** (defeated, knocked out, driven off, surrendered, talked down); **story moments** the GM judges; **quests finished,** once quests exist. Not checks, traps or discovery |
| **XP2** | Who sets how much  | **The system's formulas:** a foe's worth by its level against yours; the GM picks only a story moment's size (small, notable, major). Same deed, same reward                                            |
| **XP3** | Repeats and shares | **Each foe or moment pays once per save;** allies take no share                                                                                                                                         |

### Levels

| ID      | Question      | Decision                                                                                                                                               |
| ------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LV1** | The curve     | **The system's own,** a formula or a table of experience per level                                                                                     |
| **LV2** | What it gives | **Data per level:** what formulas read rises by itself (hit points), plus grants to choose: attribute points, skill ranks, traits from a list, attacks |
| **LV3** | When          | **Earned at once, taken at the next long rest,** through a guided level-up like making a character; never in a fight                                   |
| **LV4** | Choices       | **The player chooses,** with a suggestion from the GM, taken in one tap                                                                                |

### Improving by use

| ID      | Question                  | Decision                                                                                                                                    |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **US1** | How                       | **Uses count up to a threshold**                                                                                                            |
| **US5** | The threshold (follow-up) | **A formula of the current rank** (say `3 × (rank + 1)`), so each step takes longer. Checked at a long rest; the count resets when it rises |
| **US2** | What counts               | **Only successes with real stakes,** as INTERPRET judges them                                                                               |
| **US3** | What improves             | **Skills and attacks.** Not attributes; powers when that module comes                                                                       |
| **US4** | Does use raise the level  | **No;** the level comes only from experience                                                                                                |
| **US6** | A ceiling (follow-up)     | **The system's top rank only;** not tied to level                                                                                           |

### Others, the Loom and the plan

| ID      | Question             | Decision                                                                                                                                   |
| ------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **NP1** | NPCs and companions  | **Not in this epic;** their sheets change only over MCP (companions can advance with L-750)                                                |
| **NP2** | Scaling foes         | **No:** the world is as built. The GM is told the player's level against a foe's, so a deadly fight reads as one                           |
| **NP3** | Losing ground        | **Nothing is lost,** on falling or on coming round with death off                                                                          |
| **UI1** | What the player sees | **Experience toward the next level** on the Character panel (a mark on the strip when one is ready), and **a journal line** for each award |
| **SV1** | Older saves          | **Start at the experience their level needs,** with no uses counted                                                                        |
| **PL1** | Exit criterion       | **Kept,** reworded for counting uses (§5)                                                                                                  |

### Settled while building (2026-10-31)

Asked when L-841 began; the user asked to keep it simple.

| ID      | Question                     | Decision                                                                                                                                                                                          |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AR1** | Where an attack's rank lives | **On the sheet, `sheet.attackRanks: { [attackId]: n }`,** beside `uses`, so the system's starting attacks (not on the sheet) can rise too; each attack reads its own as `rank`, 0 when not listed |
| **AR2** | A story moment paid twice    | **At most one story moment a turn, its id normalised on the server** (lower case, dashes); no fuzzy matching (L-842)                                                                              |
| **AR3** | Nisia's Wanderlust           | **No code:** once L-842 ships, Wanderlust gets an `experience` curve over MCP in which a major story moment is one Circle; `use` stays off                                                        |
| **AR4** | A skill's top rank           | **`experience.skillMax`** (default and at most 20, a sheet's top rank): what grants and use raise a skill to; a grant of more ranks than it is refused                                            |

---

## 4. Design

### 4.1 The module's settings (MX1, MX3, LV1, LV2, US5, US6)

`system.advancement`, checked on save like combat's settings:

- `experience` (or absent, off):
  - `curve`: a formula of `level` giving the total for that level, or a table;
  - `foe`: a formula of the foe's `level` and yours (`foeLevel`, `level`) giving its worth;
  - `story`: `{ small, notable, major }`, amounts or formulas;
  - `quest`: a formula or amount, used once quests exist;
  - `grants`: `{ every?, at?: { [level]: grant } }`, a level in `at` taking its grant's parts in place of `every`'s; a grant is `{ attributePoints?, skillRanks?, traits?: { from: [id], choose: n }, attacks?: { from: [attack], choose: n } }`, each with creation's limits (a score's range, a skill's top rank);
  - `skillMax`: a skill's top rank by grants or use (AR4).
- `use` (or absent, off):
  - `threshold`: a formula of `rank` (default `3 * (rank + 1)`);
  - `skills: true`, `attacks: true`: what improves;
  - the top rank is the system's (skills) or its `use.maxRank` (attacks).
- **World switch (MX2):** `world.rules.advancement: false` turns it off for that world.
- **The built-ins:** d20 sets `experience` (a rising curve to 20, a foe's worth by level difference, grants of skill ranks every level and attribute points every fourth); the dice pool sets `experience` for Rank (with its own curve and grants) and `use` for skills and attacks.

### 4.2 On the sheet

- `sheet.xp`: the total earned; `sheet.levelsReady`: levels earned and not yet taken (worked out from `xp` and the curve).
- `sheet.uses`: `{ skills: { [id]: n }, attacks: { [id]: n } }`, successes counted since each last rose.
- **Attacks get a `rank`** (default 0), kept on the sheet as `attackRanks` (AR1) and readable as `rank` in their own `attack` and `damage` formulas, so they can improve by use.
- `save.earned`: the ids of foes and moments already paid for (XP3).
- **Older saves (SV1):** `xp` is the curve's total for their level; no uses.

### 4.3 Earning experience (XP1–XP3, NP2)

- **Foes:** when a fight ends (or a foe is talked down out of one), each foe overcome pays its worth once per save: defeated, knocked out, fled or surrendered. Recorded in `save.earned`.
- **Story moments:** INTERPRET or NARRATE names a moment and its size (small, notable, major), with an id (so it pays once); the server pays the system's amount. The GM can't name an amount.
- **Quests:** a hook paid when quests exist (not this epic).
- **The GM is told** the player's level against each foe's in sight (NP2).
- **Each award** is a journal line saying what it was for.

### 4.4 Taking a level (LV3, LV4)

- At a long rest with a level ready, the turn answers with a **level-up**: the grants to choose, their limits, and the GM's suggestion (one Flash call from the character so far).
- `{ verb: 'levelUp', choices }` takes it: the server checks the choices like creation's, raises `level`, and the formulas do the rest. A second ready level comes straight after.
- Never in a fight. A level left untaken stays ready until the next long rest.

### 4.5 Improving by use (US1–US6)

- **A use** is a roll with real stakes (INTERPRET's judgement, a new `stakes` flag beside plausibility) that succeeds: every attack that hits in a fight, a skill check that matters. One count per roll.
- **At a long rest,** each skill or attack whose count reached its threshold rises one rank (up to the top), and its count resets. A journal line says what rose.
- **Not attributes, not the level** (US3, US4).

### 4.6 In the Loom (UI1)

- **The Character panel:** experience toward the next level as a bar; the level-up form when one is taken (like the new-game form, with the suggestion filled in).
- **The strip:** a mark when a level is ready.
- **The journal:** a line for each award and each rise.

### 4.7 Grading

Advancement is a mechanic, not content, so it adds no criterion of its own.

---

## 5. Exit criterion

In a d20 world, a character drives off bandits and talks a guard down; each pays experience once, shown on the panel and in the journal. A story moment the GM names pays its size. At a long rest they take level 2 through the guided level-up, choosing a skill, and their hit points rise. In a dice-pool world, a character picks locks under fire; each success counts, and at the long rest after the threshold the skill rises. Picking the same lock again in safety counts nothing. In a world with advancement off, nothing is earned.

---

## 6. Sub-issues (filed 2026-10-28)

| ID           | Story                                                                                                                                                                   | Depends on   | Model  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-841 (#713) | **Advancement as data:** the module's settings checked on save; the built-ins; the world switch; `xp`, `levelsReady`, `uses` and attacks' `rank` on sheets; older saves | —            | Opus   |
| L-842 (#714) | **Earning experience:** foes overcome by any means, paid once; story moments by size; the quest hook; the GM told levels; journal lines                                 | L-841        | Sonnet |
| L-843 (#715) | **Taking a level:** the level-up at a long rest, its grants and limits, the GM's suggestion, `levelUp` checked like creation                                            | L-841        | Opus   |
| L-844 (#716) | **Improving by use:** the `stakes` flag, successes counted, thresholds by rank, rising at a long rest, the top rank                                                     | L-841        | Sonnet |
| L-845 (#717) | **In the Loom:** the experience bar, the level-ready mark, the level-up form, journal lines for awards and rises                                                        | L-842, L-843 | Sonnet |

**Order:** L-841 first; L-842, L-843 and L-844 follow it; L-845 last.

Tests: the settings checked in both built-in systems; pure tests for a foe's worth, the curve, thresholds and grants' limits; pipeline tests for a fight paying once, a level taken at a long rest, a skill rising by use, nothing in a world with it off; headless Chrome for the bar, the mark and the level-up form.
