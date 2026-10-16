# The Loom — Game Systems and Modules — Design Document v0.1

**Status:** Decided (2026-10-14). L-800's sub-issues filed (2026-10-16): L-801 to L-805 (#627–631). The gap sheet (§3) is answered. In progress. Shipped: L-801, systems as data: `loom_systems` (server only) and `functions/loom-canon/systems.js` (the shape, its checks on save, the built-in `d20-fantasy` as a placeholder until L-804, copies); `world.systemId`, and `loadWorld` gives every world its system at its latest version (`world.system`); the MCP tools `list_systems`, `get_system`, `set_system`, `copy_system`, and `update_world`'s `systemId`; the world criterion `world.system` (weight 15, rubric version 6). L-802, the formula language: `functions/loom-canon/formula.js` parses formulas to a tree (dice with keep, arithmetic, `min`/`max`/`floor`/`ceil`, sheet fields, `mod()`, `table()`, `count()` for pools, one comparison for rolling under), checks names and types and sizes, works out ranges, and evaluates with a dice source it is given to `{ total, type, breakdown }`, the breakdown's `shown` line evaluating back to the total. A system's formulas are checked where they stand on save; systems gain lookup `tables`; warnings for unused attributes and ladder rungs no check can reach. L-803, checks: `functions/loom-canon/checks.js` validates and rolls a check `{ skill or attribute, rung, opposedBy? }` by the system's formula, reads the result as one of five degrees (the system's degree formulas, which may read `natural`, the first die kept, tried critical success, critical failure, success, success at a cost; else reaching the rung), and rolls opposed checks from both sheets (ties to the defender unless `checks.ties: 'attacker'`). INTERPRET is given the system's skills, attributes and rungs and proposes `params.check`; ADJUDICATE refuses an unknown skill or rung, rolls with the server's dice (a plain attempt at the easiest rung when none is proposed), and a lock's difficulty wins, placed on the ladder (as it is on a d20-scale ladder, by place on any other), rolled with `checks.lock`. Characters without sheets roll with base attributes, untrained. The turn's `roll` carries the formula, breakdown, rung and degree; `test_roll` over MCP. The placeholder fantasy system gains criticals on a natural 20 or 1 and Dexterity for locks. L-804 is next.
**Project:** Olympus (`olympus-dfa00`)
**Phase:** 9 — Game systems (milestone #25, [`roadmap.md`](./roadmap.md)). Built after Phase 3d and before L-710 (the Build order).
**Replaces:** L-202 "richer rule sets" (#313). Its combat becomes this phase's first module; L-200, the world tick, stays in Phase 2.
**Depends on:** L-720 (#525), whose menu bar and roll cards (L-726) this builds on.
**Related:** [`the-loom-design.md`](./the-loom-design.md) §10 (the rules seam), [`the-loom-grading.md`](./the-loom-grading.md), [`portraits-and-tokens.md`](./portraits-and-tokens.md) (the Character panel), [`npc-types.md`](./npc-types.md), [`inventory.md`](./inventory.md), [`ai-characters.md`](./ai-characters.md)

---

## 1. Purpose

The Loom will run many games, each with its own play and feel: a pirate world with naval battles, a starship world with space battles, a sword-and-sorcery world with spells. They share mechanics, and they shouldn't drift too far apart. So:

- **A world has one game system.** A system is **data**, written over MCP like canon: its sheet, its dice formulas, its words, and which modules it uses.
- **Mechanics are modules**, built once in code and configured by each system. A ship-battle module serves both pirates and starships; the system sets how ships move, their weapons and what takes damage.
- **The sheet and checks come first.** Combat, powers, ship battle and the rest are later modules on the same base.
- **Faithful to tabletop play:** real dice, real attributes, real difficulty. Rules are our own, or openly licensed and credited; never copied from a closed system.

---

## 2. What there is today

- **The rules seam:** every outcome goes through `evaluate(proposedAction, worldState, characterState, dice) → Resolution` in `functions/loom-turn/adjudicate.js` (L-140). Behind it are hand-coded rules (movement, doors, locks, `requiresAbility`) and a fallback server d20 against a difficulty. The design always meant data-driven rules to replace that body (L-202).
- **Dice:** rolled on the server, never by the client or the model, and recorded on the turn. The GM narrates outcomes and never decides them.
- **A character** has a name, a `condition` word ("healthy"), `abilities` (tags such as `swim` that open routes and places), a `speed` and a position.
- **Locks** have a `difficulty` (default when unset), checked against the d20.
- **Coming:** roll cards in the narration (L-726); a Character panel (L-730); NPC types (L-750); items (L-770); generic NPC templates (L-790).

---

## 3. Gap sheet

Settled with the user in the session (one system per world, systems over MCP, faithful to tabletop, sheet and checks first), then through a questionnaire (2026-10-14) with three follow-ups (the sheet's core, breaking changes, module UI).

### Systems and worlds

| ID      | Question                    | Decision                                                                                                                                                                                                                 |
| ------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SY0** | Systems per world, authors  | **One system per world. Systems are written over MCP**, like canon. **Faithful to tabletop play**, without copying published rules word for word. **The sheet and checks first** (the session, 2026-10-14)               |
| **SY1** | What a system holds         | **Its sheet, its check formula and difficulty ladder, how characters are made, how they grow, which modules it uses and their settings, its words** ("Hit points" or "Hull") **and notes for the GM** on tone and pacing |
| **SY2** | Changes to a system in play | **Every save uses the latest version.** A change that no longer fits a character is **allowed, then fixed**: such characters are flagged, and the GM repairs them in play (follow-up)                                    |
| **SY3** | Built-in systems            | **Two of our own:** a d20-style fantasy system and a dice-pool sci-fi system, so the modules are shared from the start                                                                                                   |
| **SY4** | Worlds made before systems  | **Get the built-in fantasy system** and play on: lock difficulties and abilities carry over                                                                                                                              |
| **SY5** | A small change for a world  | **Copy the system and change the copy.** A system is always whole and named; a world never quietly drifts from it                                                                                                        |
| **SY6** | Openly licensed rules       | **Openly licensed text may be used, credited** (for example the d20 SRD 5.1 under CC BY 4.0). Never anything under a closed licence                                                                                      |
| **SY7** | Rules for players           | **A rules reference in the Loom**, made from the system: what each attribute and skill does, how checks work                                                                                                             |

### The character sheet

| ID      | Question                 | Decision                                                                                                                                                                                                                           |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CS1** | The core                 | **Required in every system: attributes, resources and level.** **Optional parts a system may switch on: skills, traits, conditions and derived values.** A module relies on an optional part only if the system has it (follow-up) |
| **CS2** | Attributes               | **Named by the system**, which sets their range and modifier formula (3–18 with (score − 10) / 2, or 1–5 as a pool size)                                                                                                           |
| **CS3** | Skills                   | **A list per system, each tied to an attribute, with a rank or proficiency**                                                                                                                                                       |
| **CS4** | Today's abilities        | **Become traits**, and still open routes and places as today                                                                                                                                                                       |
| **CS5** | Making a character       | **The system picks a built-in method** (array, point buy or rolling), and the Loom walks the player through it                                                                                                                     |
| **CS6** | Growing stronger         | **Not in the first epics.** The sheet has a level, and the system has room for an advancement method. Since 2026-10-16: L-830, after combat                                                                                        |
| **CS7** | NPCs                     | **Named characters get full sheets; generic templates (L-790) get a short stat block**, written once and used by every figure placed                                                                                               |
| **CS8** | Where the sheet is shown | **The Character panel**, drawn from the system, **plus a compact strip on the map** with health and the main resources                                                                                                             |

### Checks and dice

| ID      | Question                  | Decision                                                                                                                                                                                                                                         |
| ------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **DC1** | Kinds of check            | **Roll and add against a target** (d20 + modifier), **roll under** (d100 ≤ skill), **dice pools counting successes**, **result bands** (2d6 + modifier: 10+, 7–9, 6−) and **roll two, keep one** (advantage). Not exploding or step dice for now |
| **DC2** | Results                   | **Degrees:** critical failure, failure, success at a cost, success, critical success. Each system maps its rolls onto them; the GM narrates by degree                                                                                            |
| **DC3** | Who calls for a check     | **INTERPRET proposes** the check, skill and difficulty from the system's lists; **ADJUDICATE validates it and rolls.** Difficulty comes from canon where set (a lock), else the model picks a rung of the ladder                                 |
| **DC4** | Difficulty                | **A named ladder per system** (Easy, Moderate, Hard, Very hard, Nearly impossible) with its numbers. The model picks a rung, never a number                                                                                                      |
| **DC5** | Rolling                   | **The player taps to roll**; the dice tumble and land on the server's result                                                                                                                                                                     |
| **DC6** | Roll cards                | **The formula and its parts:** d20 (14) + Agility (3) + Stealth (2) = 19 vs Hard (18): success                                                                                                                                                   |
| **DC7** | Spending to change a roll | **Later;** the check leaves room for it                                                                                                                                                                                                          |
| **DC8** | Opposed checks            | **Yes:** both sides roll from their sheets                                                                                                                                                                                                       |

### Formulas

| ID      | Question     | Decision                                                                                                                                                                                |
| ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **FX1** | Writing them | **A small expression language:** dice (`2d6`, `4d10`, `2d20kh1`), arithmetic, `min`, `max`, `floor`, sheet fields by name, lookup tables. Parsed and checked on save; never run as code |
| **FX2** | Tables       | **Yes:** score to modifier, size to damage, range bands                                                                                                                                 |
| **FX3** | Testing      | **Test rolls** for a sample character with the breakdown, and **warnings on save** (unused attributes, impossible difficulties, unknown fields). No odds tool for now                   |

### Modules

| ID       | Question                   | Decision                                                                                                                                                                                                                                                                                                                                             |
| -------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **MD1**  | What a module declares     | **Its settings and their checks, the sheet fields it reads and adds, the actions it adds to the click menu (L-740), and its grading criteria**                                                                                                                                                                                                       |
| **MD1b** | A module's UI              | **Drawn generically from data:** sheets, tracks and roll cards come from the fields and settings a module declares. A module adds UI code only for what a generic view can't show, such as ship arcs on the map (follow-up)                                                                                                                          |
| **MD2**  | Two configurations         | **Every module is tested with at least two systems' settings from its first story.** A rule in CLAUDE.md and the roadmap                                                                                                                                                                                                                             |
| **MD3**  | How far systems may differ | **Only by settings, formulas, words and which modules they use.** A difference that needs code becomes a module option every system can use                                                                                                                                                                                                          |
| **MD4**  | Combat                     | **A module:** the first after the sheet and checks, built on them. It takes in L-202's combat and Movement and vision §11 (initiative, reactions, cover)                                                                                                                                                                                             |
| **MD5**  | Module order               | **Combat, powers, social conflict, crafting, ship battle, chases, hacking, mass battle**                                                                                                                                                                                                                                                             |
| **MD6**  | Ship battle, noted now     | **More detailed than personal combat** (the user's note): ships have **many components and subsystems that take damage**. A destroyed shield generator leaves its side taking more damage; a destroyed sail or engine immobilises the ship. **Weapons have firing arcs; shields defend arcs.** Many kinds of weapon, each with its own chance to hit |

### Grading and the plan

| ID      | Question       | Decision                                                                                                                                                                                |
| ------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GR1** | Build order    | **After Phase 3d, before L-710.** New worlds pick a system as they are made, and Phases 7 and 8 build on the sheet                                                                      |
| **GR2** | Organisation   | **A new phase, Phase 9 — Game systems:** the system engine first, the sheet next, then each module its own epic                                                                         |
| **GR3** | Grading        | **The system is set and passes its checks (world); named characters have sheets (character); templates have stat blocks (world); weapons and armour have their system's stats (world)** |
| **GR4** | Exit criterion | **Kept** (§5)                                                                                                                                                                           |

---

## 4. Design

### 4.1 Systems

- **A system** is a document in a new `loom_systems` collection (server only; read through the Loom's functions and the Cartographer connector):
  - `id`, `name`, `version` (a number raised on each change), `credits` (licences and sources, SY6);
  - `words`: names for the things the Loom shows (`health: 'Hull'`, `currency: 'Credits'`);
  - `sheet`: its attributes, resources, level and optional parts (§4.2);
  - `checks`: the check formula, degree mapping and difficulty ladder (§4.4);
  - `creation`: the method and its settings (§4.5);
  - `advancement`: empty in this phase (CS6);
  - `modules`: the modules it uses, each with its settings (§4.6);
  - `gmNotes`: tone and pacing for NARRATE.
- **A world** names its system: `world.systemId`. Worlds without one get the built-in fantasy system (SY4).
- **Changes (SY2):** a save always uses the system's latest version. When a change no longer fits a sheet (a removed attribute, a renamed skill), the sheet is **flagged** with what no longer fits. The GM is told, and repairs it in play as a recorded change. The Character panel shows the flag.
- **Copies (SY5):** `copy_system` makes a new, named system from another; worlds change only by pointing at a different system.
- **MCP tools** (Cartographer connector): `list_systems`, `get_system`, `set_system` (create or replace, validated), `copy_system`, `test_roll` (FX3), and `update_world` takes `systemId`.

### 4.2 The sheet

- **Required (CS1):** `attributes` (named by the system, with range and modifier formula, CS2), `resources` (tracks with current and maximum: health, stamina, mana, hull), `level`.
- **Optional parts** a system switches on: `skills` (each tied to an attribute, with a rank, CS3), `traits` (today's abilities become traits, CS4), `conditions` (each with effects the rules apply), `derived` (values worked out by formula: a defence, carrying capacity).
- **Modules** read only the core, the optional parts their system has, and fields they declare (MD1).
- **On saves:** `save.character.sheet`. Today's `speed` and `condition` move into it (a derived value and a condition); `abilities` become traits. A backfill gives existing characters the fantasy system's sheet.
- **NPCs (CS7):** named characters have full sheets on their canon record, set over MCP. Stat blocks (attributes, resources, a few skills) are the shape L-790's templates will carry.

### 4.3 The formula language

- **Shared and pure:** `functions/loom-canon/formula.js`, with no I/O. Server only: the page shows breakdowns the server sends, never evaluates.
- **Grammar:** numbers; dice `NdX` with `khN`/`klN` (keep highest or lowest); `+ − × ÷`; `min`, `max`, `floor`, `ceil`; names of sheet fields (`STR`, `Stealth`, `level`); `table(name, value)`; comparison for pools (`count(pool, ≥ 7)`).
- **Checked on save:** unknown names, wrong types and impossible ranges are errors; unused attributes and unreachable ladder rungs are warnings (FX3).
- **Evaluation** takes a seeded dice source (as `rollDie` is today) and returns the total and a **breakdown**: each term, its value, and each die rolled. The breakdown goes on the turn and the roll card (DC6).

### 4.4 Checks

- **A check** is `{ skill or attribute, difficulty rung, opposed by? }`.
- **Calling one (DC3):** INTERPRET proposes a check for free text, choosing from the system's skills and ladder rungs it is given. ADJUDICATE validates it (the skill exists; the rung exists; canon difficulty wins where set, such as a lock's) and rolls. Structured actions (open a lock) call their check directly.
- **The check formula** comes from the system. The kinds in DC1 are all expressible: roll and add, roll under, pools, bands, keep highest.
- **Degrees (DC2):** the system maps the result onto five degrees. NARRATE is told the degree and the system's words, and narrates by it.
- **Opposed checks (DC8):** both sides roll from their sheets; the higher result wins, with ties by the system's rule.
- **The seam stays:** this replaces the body of `evaluate`, not its interface (the Loom design §10).
- **Room left:** spending a resource to change a roll (DC7) and advancement (CS6) have places in the check and the sheet, unused for now.

### 4.5 Making a character

- **Methods (CS5):** a standard array, point buy (with a budget and costs) or rolling (a formula per attribute). The system names one and its settings.
- **In the Loom:** a new save walks the player through it: attributes, then skills and traits if the system has them, then a review. Premade characters set over MCP still work.

### 4.6 Modules

- **A module** is code in `functions/loom-modules/<name>/` (and the page, where it draws anything of its own). It declares (MD1):
  - its **settings**, with their checks, run when a system is saved;
  - the **sheet fields** it reads and adds;
  - its **actions** for the click menu (L-740);
  - its **grading criteria**.
- **UI (MD1b):** the Loom draws sheets, tracks and roll cards generically from what a module declares. A module adds UI code only for what a generic view can't show (ship arcs on the map).
- **Two configurations (MD2):** every module is tested with the settings of at least two systems from its first story.
- **No scripts in systems (MD3):** a difference that needs code becomes a module option.
- **The order (MD5):** combat, powers, social conflict, crafting, ship battle, chases, hacking, mass battle. Each is designed when it is next.
- **Ship battle, noted for its design (MD6):** components and subsystems with their own damage tracks and effects (shield generators per arc, sails and engines that immobilise when lost), weapons with firing arcs and their own chance to hit, shields that defend arcs, a pluggable movement model (wind for sail, thrust for starships).

### 4.7 In the Loom

- **Rolling (DC5):** a check's result is fixed on the server when the turn runs. Its roll card shows the dice to tap; tapping tumbles them and lands on the server's result, then shows the breakdown (DC6). Tapping is how the player sees the roll, not a second chance.
- **The Character panel (CS8):** a menu-bar button showing the sheet, drawn from the system. L-730 later adds the portrait and token to the same panel.
- **The strip:** health and the system's main resources, always on the map.
- **The rules reference (SY7):** made from the system: attributes, skills, the check, the ladder and degrees, in the system's words.

### 4.8 The built-in systems (SY3)

- **A d20-style fantasy system:** six attributes, skills tied to them, d20 + modifier against a ladder, health, level. Our own wording, or SRD 5.1 text credited where used (SY6). Every existing world gets it (SY4).
- **A dice-pool sci-fi system:** a few attributes as pool sizes, skills that add dice, d10s counting successes of 7 or more, stress and health as resources. Our own.

### 4.9 Grading

This phase adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.6):

- **World:** a system is set and passes its checks (in L-800).
- **Character:** a named character has a sheet (in L-810).
- **Added later by the epics that bring the content:** templates have stat blocks (L-790); weapons and armour have their system's stats (L-770).

---

## 5. Exit criterion

Two worlds on different systems, a d20 fantasy and a dice-pool sci-fi. In each, picking the same lock rolls by that system's formula and shows its breakdown on a card, and the player's sheet shows the attributes and skill it used.

---

## 6. Epics and sub-issues (planned; filed when this phase is next)

### L-800 — The system engine (#606)

| ID           | Story                                                                                                                                                                                                           | Depends on   | Model  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-801 (#627) | **Systems as data:** `loom_systems`, the system's shape and checks, `world.systemId`, latest-version saves with flags, copies; `list_systems`, `get_system`, `set_system`, `copy_system`; the grading criterion | —            | Opus   |
| L-802 (#628) | **The formula language:** `formula.js`: parser, dice with keep, arithmetic, functions, fields, tables, pool counts; checks on save; seeded evaluation with a breakdown                                          | —            | Opus   |
| L-803 (#629) | **Checks:** the check formula, degrees, the ladder; INTERPRET proposes, ADJUDICATE validates and rolls; canon difficulties; opposed checks; locks through checks; `test_roll`                                   | L-801, L-802 | Opus   |
| L-804 (#630) | **The two built-in systems:** the d20 fantasy and the dice-pool sci-fi; existing worlds get the fantasy system                                                                                                  | L-803        | Sonnet |
| L-805 (#631) | **Rolls in the Loom:** the roll card's dice to tap, landing on the server's result, and the breakdown; NARRATE by degree and in the system's words; the rules reference                                         | L-803, L-726 | Sonnet |

### L-810 — Character sheets (#607)

| ID    | Story                                                                                                                                                                        | Depends on   | Model  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-811 | **The sheet on saves:** the core and optional parts, validation against the system, flags for what no longer fits; `speed`, `condition` and `abilities` moved in; a backfill | L-801        | Opus   |
| L-812 | **Making a character:** array, point buy and rolling; the Loom's guided flow for a new save                                                                                  | L-811, L-802 | Sonnet |
| L-813 | **NPC sheets:** full sheets on named characters, set over MCP; the stat-block shape for templates; opposed checks against them; the grading criterion                        | L-811, L-803 | Sonnet |
| L-814 | **The Character panel and the strip:** the sheet drawn from the system, flags shown, health and main resources on the map                                                    | L-811, L-721 | Sonnet |

| L-815 | **Effects:** conditions with durations (in rounds, turns or game time), areas on the grid (burst, cone, line, square or cube, aura), saving throws; used by combat, powers, traps and potions. Added 2026-10-16 ([`scenarios.md`](./scenarios.md), EF1, EF2); its details are settled with a gap sheet before L-810's stories are filed | L-811, L-803 | Opus |

**Order:** L-801 and L-802 side by side, then L-803, then L-804 and L-811. L-805, L-812, L-813, L-814 and L-815 follow.

**After L-810** (revised 2026-10-16 from the reference games, [`scenarios.md`](./scenarios.md) §4):

- **L-820 Combat**, the first module. It also covers falling to 0 (the system decides: down and dying, then saved, captured or dead; a world can turn death off), short and long rests as waits that restore resources, and hostile creatures with fight behaviours (attack, guard, flee when hurt, call for help).
- **L-830 Advancement:** experience and levels, and improving by use (not milestones or study). CS6 is no longer deferred.
- **Then the other modules** in MD5's order, from L-840: powers, social conflict, crafting (alchemy, machines, repair, gathering), ship battle, chases, hacking, mass battle.

Each is designed when it is next.

Tests: the formula language against every DC1 kind with fixed dice; each system checked on save; checks in both built-in systems (the two-configuration rule); headless Chrome for the roll card, the guided creation and the Character panel.
