# The Loom — Combat — Design Document v0.1

**Status:** In progress. Decided (2026-10-20); sub-issues filed (#653–#660). L-821 fights and rounds built: the module at `functions/loom-modules/combat/`, sides over MCP, fights starting on sight or an attack, rounds on End turn, ending by fleeing, talking down or foes standing down. The GM's and events' starts, and moving a fight onto a battle map (SE3), come with the stories that bring their callers (L-824, L-827). L-822 attacks and damage built: attacks on sheets and stat blocks, the built-ins' combat settings (fantasy against Armour, sci-fi opposed pools), damage by degree and type, conditions on a hit, areas, ammunition, Subdue, foes' wounds in `save.figures`, the character criterion. L-824 foes and allies built: figures on battle maps (`place_figures`), roles and postures (`set_tactics`), tactics in code, everyone else's turns, morale, allies, the player knocked out at 0 until L-827, places' danger and the place criterion. L-827 falling to 0 and rest built: the system's down kinds (dying with saves, wounds, out at once), the world's death setting, death ending the save with an epilogue, fates chosen by NARRATE, coming round with an injury, short and long rests broken by danger. L-823 position and reactions built: reach and range with long range's penalty, cover from walls and obstacles, flanking as an option (off in both built-ins), Dodge, defending only by a trait's reaction, attacks drawn by leaving reach and Withdraw, Ready, Dash and Use.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-820 (#651), Phase 9 — Game systems (milestone #25)
**Depends on:** L-810 (#607: sheets, NPC sheets, effects), L-800 (#606: systems, formulas, checks), L-720 (the map engine and click menu).
**Related:** [`game-systems.md`](./game-systems.md) (MD4, §4.10 effects), [`scenarios.md`](./scenarios.md) (G5, G12), [`the-loom-movement-and-vision.md`](./the-loom-movement-and-vision.md), [`ai-characters.md`](./ai-characters.md) (L-790), [`inventory.md`](./inventory.md) (L-770)

---

## 1. Purpose

Combat is Phase 9's first module: fights on battle maps in rounds, with initiative, attacks, damage, cover, reactions, foes that fight back, falling to 0, and rest. It is code configured by each world's system, tested with both built-in systems.

**Combat is programmatic** (the user's note). Fights and player actions run on rules and the server's dice, with **no GM or AI deciding anything**. The model is used only for **named characters' turns**, for **unique actions the GM must reason about**, and for **narration at key moments**.

Combat comes before NPC turns, templates, items and click actions (Phases 7 and 8), so it brings small parts of them forward: its own turn order, figures placed from a stat block, attacks on the sheet, and combat entries in today's click menu.

---

## 2. What there is today

- **Turns:** on a battle map a turn is 6 seconds: movement (the sheet's speed) plus one action, then End turn (L-610, L-371). Only the player takes turns; NPCs stand where Claude placed them (L-640).
- **The system engine (L-800):** systems as data, the formula language with breakdowns, checks to five degrees, opposed checks, roll cards you tap to roll.
- **Sheets (L-810):** attributes, skills, resources, level, traits, conditions; NPC sheets and stat blocks (`set_sheet`); the Character panel and the strip.
- **Effects (L-815):** conditions as data (modifiers, damage each turn, `noAction`, `noMove`), effects with durations and saves, areas in line of effect, hazards on battle maps. "A round is a turn until L-820."
- **The grid:** walls, doors, low and solid obstacles, difficult ground (L-620); sight and fog (L-630); paths (`grid-paths.js`).
- **The Loom:** tokens on the map engine, a click menu (Move, Look, a door's actions), the turn bar, roll cards, the strip.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-20) and four follow-ups (named characters' AI, narration, tactics, non-lethal). Notes from the user are marked.

### The principle

| ID      | Question         | Decision                                                                                                                                                                                               |
| ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **CB0** | Who runs a fight | **The rules** (the user's note): combat and player actions need no GM or AI. The model is used only for named characters' turns, unique actions the GM must reason about, and narration at key moments |

### Turns

| ID      | Question                       | Decision                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TN1** | When rounds start              | **Once a fight starts;** outside one, today's turns. A round is everyone in the fight taking a turn once, 6 seconds                                                                                                                                                                                                                                             |
| **TN2** | Order                          | **Each combatant by initiative:** the system's formula, rolled once when the fight starts; ties by a stated attribute, then the player                                                                                                                                                                                                                          |
| **TN3** | A turn                         | **The system sets it:** movement, actions (default 1) and reactions per round (default 1)                                                                                                                                                                                                                                                                       |
| **TN4** | Reactions                      | **An attack when a foe leaves your reach; a readied action; defend** (parry or dodge, as the system allows)                                                                                                                                                                                                                                                     |
| **TN5** | Actions                        | **Attack, Dash, Dodge or take cover, Use something, and anything else typed** (Help left out). Typed actions are held to plausibility (CB1)                                                                                                                                                                                                                     |
| **CB1** | Plausibility (the user's note) | **Never make the improbable seem easy.** An improbable action takes a very high rung; an extraordinary one is refused. A complicated one asks the player to explain exactly how; then the check follows from the explanation, and if they can't explain, it's refused. A refused action spends nothing: the player can try something else. In and out of combat |

### Attacks and damage

| ID      | Question                                     | Decision                                                                                                                                                                                                                                                               |
| ------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AT1** | Hitting                                      | **The system says:** a roll against a defence value (derived on the sheet), or an opposed roll                                                                                                                                                                         |
| **AT2** | Damage                                       | **A damage formula per attack, changed by degree** by the system's rules: a critical doubles the dice; success at a cost costs the attacker; extra successes add damage in a pool                                                                                      |
| **AT3** | Types                                        | **Damage types per system,** with traits or conditions giving resistance (half) or weakness (double)                                                                                                                                                                   |
| **AT4** | Before L-770                                 | **Attacks on the sheet or stat block** (name, reach or range, attack and damage formulas), with an unarmed attack by default; L-770 later moves them onto weapons                                                                                                      |
| **AT5** | More                                         | **Conditions on a hit, area attacks, and ammunition.** Ammunition is a sheet resource (arrows: 20) until L-770 makes it items                                                                                                                                          |
| **AT6** | Player attacks before L-770 (2026-10-21)     | **The system's starting list:** each system's combat settings name starting attacks (fantasy: a sword and a bow; sci-fi: a knife and a pistol), which a player character without attacks of its own has, besides the unarmed default; a premade sheet can list its own |
| **AT7** | Success at a cost (2026-10-21)               | **A plain hit for now,** in every system, until a later story defines costs                                                                                                                                                                                            |
| **EN7** | The player at 0 before L-827 (2026-10-21)    | **Knocked out:** the fight ends, the foes the winners; the player comes round an hour later with 1 health where they fell. L-827 replaces it                                                                                                                           |
| **EN8** | Where figures live before L-792 (2026-10-21) | **On the battle map:** `battleMap.figures`, groups `{ id, name, statBlock, side, role, posture, leader, cells }`, set with `place_figures`; L-792 moves them onto templates                                                                                            |
| **GR3** | Danger before encounter tables (2026-10-21)  | **A place's `danger`** (none, low, high), set over MCP; the place criterion: a dangerous place has hostile figures or characters placed. Encounter tables join it with wilderness travel and rests                                                                     |
| **DF6** | Who picks the fate, death off (2026-10-22)   | **NARRATE picks, the rules apply it:** captured or rescued, they come round in the nearest settlement (captured marked so); robbed, where they fell, their belongings gone; 1 health, hours later. The pick is recorded on the turn                                    |
| **DF7** | A rest broken by danger (2026-10-22)         | **Cut short, foes come:** each hour rolls (low 1 in 6, high 1 in 3); breaking, no more time passes and nothing is restored, and hostiles placed there start a fight. Encounter tables add more later                                                                   |
| **DF8** | Dying alone, death on (2026-10-22)           | **The saves decide:** three successes and they are left for dead, coming round 1d4 hours later at 1 health; three failures and they die                                                                                                                                |
| **DF4** | Foes at 0 (the user's note)                  | **Set by the weapon, not by the GM:** each attack is lethal or not by default (a club subdues, a sword kills); a **Subdue** toggle lets the player strike to knock out, at a penalty the system sets for lethal weapons                                                |

### Position

| ID      | Question                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PS1** | Reach and range                         | **Melee reach in squares; ranged attacks with a normal and a long range** (a penalty), needing line of sight                                                                                                                                                                                                                                                                                                      |
| **PS2** | Cover                                   | **From walls and obstacles between attacker and target, by the sight rules:** partial or heavy, its effect set by the system                                                                                                                                                                                                                                                                                      |
| **PS3** | Flanking                                | **A system option,** off in both built-in systems                                                                                                                                                                                                                                                                                                                                                                 |
| **PS4** | Leaving reach                           | **Provokes an attack,** unless you spend your action to withdraw                                                                                                                                                                                                                                                                                                                                                  |
| **PS5** | What Ready waits for (2026-10-22)       | **A foe coming into reach:** a readied attack (and perhaps whom it's for) goes off at the first foe who comes into its reach, or its range in sight, before the player's next turn                                                                                                                                                                                                                                |
| **PS6** | Defending (the user's note, 2026-10-22) | **Only from something the character has:** a reaction is part of the character, an ability or a spell; nobody has a defending reaction by default. A system's trait can give one (`reaction: { defend, against }`); the built-ins have Parry (+2 Armour against melee) and Combat Reflexes (+1 success against all), held only by sheets that list them. Attacks on leaving reach and Ready stay open to everyone |
| **PS7** | Use something (2026-10-22)              | **A feature beside you, the GM saying what it does:** the action is spent and NARRATE tells what happens; doors keep their tap for 1 movement                                                                                                                                                                                                                                                                     |
| **PS8** | The built-ins' numbers (2026-10-22)     | **5e-like:** fantasy cover +2 / +5 Armour, long range −5, Dodge +5 Armour; sci-fi cover +1 / +2 successes on the defence, long range −1 success, Dodge +2                                                                                                                                                                                                                                                         |

### Starting and ending

| ID      | Question        | Decision                                                                                                                                                                                                     |
| ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SE1** | What starts one | **The player attacks; a hostile sees the player; the GM as a recorded change** (an ambush, a betrayal); **an event** (a wilderness roll, a trap)                                                             |
| **SE2** | Surprise        | **An ambushed side loses the first round:** Stealth against noticing, an opposed check                                                                                                                       |
| **SE3** | Where           | **Always on a grid:** a fight in town or on the road moves to the place's battle map, or a generic one by terrain; with none, the work list asks for one, and the fight is narrated in rounds without a grid |
| **SE4** | How it ends     | **One side is down, flees, surrenders, or is talked down** by a social check                                                                                                                                 |

### Falling to 0, and rest

| ID      | Question     | Decision                                                                                                                                                                                                         |
| ------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DF1** | What 0 means | **The system picks a built-in kind:** dying with saves each round (three of one kind), wounds that worsen, or out at once. Fantasy: dying with saves; sci-fi: out, with a lasting injury                         |
| **DF2** | No one helps | **By the world's setting:** death on ends the character; death off, they wake captured, robbed or rescued, the GM choosing as a recorded change                                                                  |
| **DF3** | Death        | **The save ends with an epilogue;** a new character can start in the same world, and what the save changed stays                                                                                                 |
| **DF5** | Rests        | **A short rest (an hour) and a long rest (8 hours, once a day),** restoring by the system's formulas; a rest somewhere dangerous can be interrupted by a roll against the place's danger, starting a fight there |

### Foes and allies

| ID       | Question                           | Decision                                                                                                                                                                                                                                                             |
| -------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EN1**  | Sides                              | **Every character has a side** (with you, against you, neutral), set over MCP; a neutral can turn hostile as a recorded change                                                                                                                                       |
| **EN2**  | Many from one                      | **Figures placed from a stat block** ("bandit × 4"), each with its own health in the save. Brought forward from L-792; L-790 adds the rest of templates                                                                                                              |
| **EN3**  | Unnamed foes (the user's note)     | **Tactics in code by role plus a posture:** a role (brute, skirmisher, archer, guard, caster, leader) sets how a foe fights; a posture from cowardly to reckless sets how much risk it takes and when it flees. Both set over MCP, with defaults from the stat block |
| **EN3b** | Named characters (the user's note) | **Controlled by AI:** one Flash call per named character's turn, choosing from the legal moves the rules list, guided by their play notes. Its choice is checked by the rules like any other                                                                         |
| **EN4**  | Morale                             | **A morale check when half a side is down or its leader falls,** its difficulty from posture (the user's note): fail and they flee or surrender                                                                                                                      |
| **EN5**  | Narration                          | **Key moments only** (follow-up): roll cards and short lines written by the rules ("The bandit hits you for 6") carry each round; NARRATE writes a passage when the fight starts and ends, when a named character acts, and for a unique action                      |
| **EN6**  | Allies                             | **Characters on your side fight by the same tactics;** no orders until L-790 and L-916                                                                                                                                                                               |

### The Loom, grading and the end

| ID      | Question                         | Decision                                                                                                                                                                                                   |
| ------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UI1** | Turn order                       | **A bar across the top of the map:** each token in order, whose turn, the round. **Reused outside combat too** (the user's note), with an **obvious change of look in combat**                             |
| **UI2** | Attacking                        | **Click a foe: Attack lists your attacks;** choosing one shows reach or range and cover on the grid, and the roll you'll make                                                                              |
| **UI3** | Foes' turns                      | **Played out on the map,** their cards rolling themselves; a Faster setting skips the animation                                                                                                            |
| **GR1** | Grading                          | **The system's combat settings are set and pass their checks (world); fighters have attacks on their stat blocks (character); dangerous places have foes placed or an encounter table (place).** Not cover |
| **GR2** | Exit criterion (the user's note) | **Kept simple:** combat works with little or no GM or AI involvement (§5)                                                                                                                                  |

---

## 4. Design

### 4.1 The module and the system's settings

- **`functions/loom-modules/combat/`**, pure where it can be, tested with both built-in systems (MD2).
- **A system's `modules.combat`** (checked on save, L-801):
  - `initiative`: a formula, and the tie-break attribute;
  - `economy`: `{ actions, reactions, quick? }` per turn;
  - `attack`: `defence` (a derived value's name) or `opposed` (the defence pool's formula), and how degrees change damage (`critical: 'doubleDice'`, `cost`, `extraSuccesses`);
  - `damageTypes`, `cover: { partial, heavy }` (a term added to the defence or the attack), `flanking` (off by default), `subduePenalty`;
  - `down`: `dyingWithSaves { saves: 3 }`, `wounds { … }` or `outAtOnce { injury }`;
  - `rests`: `short` and `long` restore formulas per resource;
  - `morale`: the check and its rungs by posture.
- **The built-in systems** gain their settings: the fantasy system rolls `d20 + mod(DEX)` initiative, hits against Armour, doubles dice on a critical, and is dying with saves; the sci-fi system rolls a Reflex pool, opposes attack and defence pools, adds a die of damage per extra success, and is out at once with an injury.

### 4.2 A fight (TN1, TN2, SE1–SE4)

- **The fight** is on the save: `save.fight: { id, round, order: [combatantId…], turn, combatants: { [id]: { kind: 'player' | 'character' | 'figure', side, initiative, reactionsLeft, readied? } } }`.
- **It starts** when the player attacks, a hostile sees the player (checked after each move by the sight rules), the GM records one, or an event or trap calls for one. On a town or world map it moves to the place's battle map, or a generic one by terrain (SE3).
- **Surprise (SE2):** the ambushed side rolls to notice against the ambushers' Stealth; those who fail lose the first round.
- **Rounds:** initiative is rolled once; each combatant takes a turn in order; a round is 6 s of game time; effects tick by round (L-815's rounds now mean this).
- **It ends** when one side is down, has fled (off the map by an exit, or out of sight and not pursued), has surrendered, or is talked down by a social check. `save.fight` is cleared and play returns to today's turns.

### 4.3 Turns and actions (TN3–TN5, CB1)

- **A turn:** movement and the system's actions; reactions refresh each round.
- **Actions:** Attack, Dash (move again), Dodge or take cover (harder to hit until your next turn), Use something (a door, a lever, a potion once L-770 lands), and anything typed.
- **Reactions:** an attack when a foe leaves your reach (PS4; Withdraw spends the action to avoid it); a readied action with its trigger; defend (parry or dodge), where the system has one.
- **Plausibility (CB1)**, for every typed action in and out of combat, in INTERPRET's prompt and ADJUDICATE's checks:
  - ordinary: a check at the rung it deserves;
  - improbable: the top rungs only ("Nearly impossible"), never an easy roll;
  - extraordinary (beyond what the character or the world allows): refused;
  - complicated: the player is asked how exactly; the explanation sets the check; no explanation, no attempt;
  - a refusal or a question spends nothing.

### 4.4 Attacks and damage (AT1–AT5, DF4)

- **An attack** on a sheet or stat block (until L-770 moves it onto a weapon): `{ id, name, reach | range: { normal, long }, attack (formula), damage (formula), type, lethal, ammo?, onHit? (an effect), area? }`. Every fighter has an unarmed attack (the system's default).
- **Hitting:** against the target's defence, or opposed, as the system says (AT1), with cover (PS2), range and conditions in the breakdown.
- **Damage:** the formula, changed by degree (AT2), then the target's resistance or weakness to its type (AT3), taken from the target's health.
- **More (AT5):** `onHit` applies an effect (L-815); `area` catches the squares in line of effect (L-815's areas), each target rolling its own defence or save; `ammo` spends a sheet resource and can't fire when it's empty.
- **Lethal or not (DF4):** an attack's `lethal` decides what 0 means for a foe; the **Subdue** toggle makes a lethal attack knock out instead, at the system's `subduePenalty`.
- **As built (L-822):** `modules.combat.attack` is `{ hit: 'defence', defence }` (a formula of the target's sheet: the fantasy system's derived **Armour**, `10 + mod(DEX)`) or `{ hit: 'opposed', defend }` (the target's roll: the sci-fi system's Reflex and Athletics pool), with `critical: 'doubleDice'` and `extraSuccesses: 'addDie'`; `damageTypes`, `health`, `subduePenalty`, `unarmed` and the starting `attacks` (AT6) sit beside it. Damage is at least 1 on a hit. A foe's wounds, conditions and whether they are down (`dead` or `out`) are the save's, in `save.figures[id]`. An attack in a fight that neither starts nor ends it is the rules' lines and roll card (EN5); one out of a fight starts it. Reach is checked here and range's long limit; long range's penalty and cover are L-823's.

### 4.5 Position (PS1–PS4)

- **Reach** in squares; **range** normal and long (a penalty past normal), with line of sight (`sight.js`).
- **Cover:** a wall corner or solid obstacle between attacker and target gives heavy cover, a low obstacle partial; the system's terms apply. Shown when choosing an attack.
- **Flanking:** a system option, off in both built-in systems.

- **As built (L-823):** `modules.combat` gains `cover` `{ partial, heavy }`, `longRange`, `dodge` and `flanking` (null: off), each a formula term (./position.js). Cover follows the line between the two squares' centres: across a wall or a door that isn't open, round a corner a wall touches, or through a solid obstacle, heavy; grazing a wall's end or through a low obstacle, partial. Range's long band adds `longRange` to the roll; flanking (a friend of the attacker on the target's far side, melee) adds `flanking`; Dodge adds `dodge` to the defence until the player's next turn; terms are named in the roll's breakdown. Defending is a system trait's `reaction: { defend, against }` (PS6), spent only when it turns a hit into a miss. Reactions (./reactions.js), one a round by the system's economy: anyone in a fight strikes a foe who steps out of their melee reach (the player's own walk too, unless they withdrew this turn), and the player's readied attack goes off at the first foe to come into it (PS5); a walker struck down stops where they were struck. Foes' turns draw the same reactions. Dash, Dodge, Withdraw, Ready and Use are `{ verb }` actions (or typed), the first four ruled and unnarrated; Dodge, Withdraw and Ready only in a fight.

### 4.6 Foes and allies (EN1–EN6)

- **Sides (EN1):** `character.side` (`party`, `hostile`, `neutral`), set over MCP; the GM may turn a neutral hostile as a recorded change.
- **Figures (EN2):** `place_figures` puts N figures from a stat block on a battle map (`{ statBlockId, count, squares | area }`); each has its own health and conditions in the save (`save.figures`), and a name with a number ("Bandit 3").
- **Unnamed tactics (EN3):** a pure tactics function picks each figure's turn from the legal moves by its **role** (brute: close and strike; skirmisher: hit and step away; archer: keep range and cover; guard: hold a spot; caster: areas first; leader: rally) and **posture** (cowardly to reckless: how close it gets, whom it targets, when it flees). Set with `set_tactics`; defaults from the stat block.
- **Named characters (EN3b):** a Flash call on each of their turns, given the legal moves the rules list, the fight's state and their play notes (`character.combatNotes`, set over MCP), returns one move; the rules check it like any other, and a failed or illegal answer falls back to their role's tactics.
- **Morale (EN4):** when half a side is down or its leader falls, each foe rolls morale at a rung set by its posture; failing, it flees or surrenders.
- **Allies (EN6):** characters on the player's side fight by the same tactics; no orders yet.
- **As built (L-824):** figures are `battleMap.figures` (EN8); in play each is a fighter like a character (`fig-<group>-<n>`, "Bandit 2"), standing at the save's place, with its moves, wounds and whether it fled in `save.figures` (the world as the save sees it: `withFigures`). Each fighter's turn is `tactics.planTurn` (paths around whoever stands in the way; only a caster throws an area, and only where it hits no friend) and `others.playOthers` (the attack rolled, conditions ticked, morale rolled once a fighter when half the hostile side is down or its leader falls, at the system's `morale.rungs` by posture; a cowardly fighter at a quarter of its health runs without a roll). A broken fighter runs for the nearest exit, or surrenders with none. The player at 0 is knocked out (EN7).

### 4.7 Falling to 0, and rest (DF1–DF5)

- **At 0:** the system's `down` kind (DF1). Dying with saves rolls each round; a heal or a successful Medicine check stabilises.
- **The player down with no one to help (DF2):** the world's `rules.death` (`on` by default in the fantasy system). On: the character dies, and the save ends with an epilogue (DF3); a new character can start in the same world. Off: they wake captured, robbed or rescued, the GM choosing as a recorded change.
- **Foes at 0:** dead, or knocked out by a non-lethal or subdued blow; knocked-out foes can be tied, questioned or robbed.
- **Rests (DF5):** "Short rest" (an hour) and "Long rest" (8 hours, once a day) are waits (L-374) that restore resources by the system's formulas; in a place with danger set, a rest rolls against it and may be interrupted by a fight there.
- **As built (L-827):** `modules.combat.down` `{ kind, death, save?, need, wounds, stabilise?, injury?, hours }` and `rests` `{ short, long }` (`restore` by formula or `full`, `clears`), checked on save. Fantasy: dying with Constitution saves at Easy, Wisdom stabilises, death on; a short rest heals `1d6 + mod(CON)`, a long one all. Sci-fi: out at once, coming round Wounded (one die fewer until a long rest), Medicine stabilises, death off; a short rest eases 2 Stress, a long one restores all and clears Wounded and Bleeding. The player down is `save.down`; down, they can only end their turn, rolling a dying save each one; the fight goes on while an ally of theirs stands, and nobody targets them. When it ends: helped (their side won), an ally stabilises them and they come round; alone, DF2 and DF8; dead, `save.ended` and NARRATE's epilogue, and the save takes no more turns. The world's `rules.death` (`update_world death`) wins over the system's default. Rests are `{ verb: 'rest', rest }` or typed; a long rest once a day (`save.rested`); broken by danger (DF7).

### 4.8 Narration (EN5)

- **Rules write the round:** each attack, move and effect adds a short line ("Bandit 2 hits you for 6 — cutting.") and its roll card. No model call.
- **NARRATE** writes a passage only when the fight starts, when it ends, when a named character acts, and for a unique typed action the GM had to reason about.

### 4.9 In the Loom (UI1–UI3)

- **The turn-order bar** across the top of the map: tokens in order, whose turn, the round. Outside combat it shows who's present; in combat the frame changes plainly (a combat border and "Round 2"), so it's never unclear.
- **Attack:** clicking a foe offers Attack with your attacks; choosing one shows reach or range and cover on the grid, and the roll. Dash, Dodge, Withdraw, Ready and Use sit in the menu too, and the Subdue toggle on the turn bar.
- **Foes' turns** play out on the map (moves animated, their cards rolling themselves); a Faster setting skips the animation.

### 4.10 Grading

This epic adds content kinds ([`the-loom-grading.md`](./the-loom-grading.md) §4.6):

- **World:** the system's combat settings are set and pass their checks.
- **Character:** named fighters and stat blocks have attacks.
- **Place:** a place with danger set has foes placed or an encounter table.

---

## 5. Exit criterion

A fight runs from start to end on a battle map with no GM or AI deciding anything: initiative, attacks with cover and damage types, a foe fleeing when morale breaks, and the player falling to 0 and being saved. It does so in both built-in systems, with the model called only to narrate the start and the end.

---

## 6. Sub-issues (filed 2026-10-20)

| ID           | Story                                                                                                                                                                                                                | Depends on   | Model  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-821 (#653) | **Fights and rounds:** the module, the system's combat settings and the built-ins'; `save.fight`; starting, surprise, initiative, rounds and their time; effects by round; ending                                    | —            | Opus   |
| L-822 (#654) | **Attacks and damage:** attacks on sheets and stat blocks, hitting by defence or opposed, damage by degree, types and resistance, conditions on a hit, areas, ammunition, lethal and Subdue; the character criterion | L-821        | Opus   |
| L-823 (#655) | **Position and reactions:** reach and range with sight, cover, flanking as an option, attacks on leaving reach and Withdraw, Ready, Defend, Dash, Dodge, Use                                                         | L-822        | Sonnet |
| L-824 (#656) | **Foes and allies:** sides, figures from stat blocks (`place_figures`), roles and posture (`set_tactics`), tactics in code, morale, allies; the place criterion                                                      | L-822        | Opus   |
| L-825 (#657) | **Named characters' turns:** a Flash call per named turn from the legal moves and play notes, checked by the rules, falling back to tactics                                                                          | L-824        | Sonnet |
| L-826 (#658) | **Plausibility:** ordinary, improbable, extraordinary and complicated typed actions; asking how; refusals spend nothing; in and out of combat                                                                        | —            | Sonnet |
| L-827 (#659) | **Falling to 0, and rest:** the system's down kinds, the world's death setting, the epilogue and a new character, foes knocked out, short and long rests with interruptions                                          | L-822        | Sonnet |
| L-828 (#660) | **In the Loom:** the turn-order bar and the combat look, Attack and the other entries with reach, range and cover shown, Subdue, foes' turns played out with Faster, rule lines and narration at key moments         | L-823, L-824 | Sonnet |

**Order:** L-821 first; L-826 any time. L-822 follows L-821; L-823, L-824 and L-827 follow L-822; L-825 follows L-824; L-828 comes last.

Tests: pure-module tests for initiative, hitting, damage by degree, cover and tactics, in both built-in systems (MD2); pipeline tests for a whole fight with no model call but the start and end; headless Chrome for the bar, the combat look, targeting and foes' turns.
