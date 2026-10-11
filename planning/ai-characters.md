# The Loom — AI Characters — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-790 (#532)
**Phase:** 8 — People and trade ([`roadmap.md`](./roadmap.md) §4), last.
**Depends on:**

- L-750 (#528, types and their rules);
- L-743 (conversations);
- L-735 (speaking portraits);
- L-770 and L-760 (#530, #529, items and coins, for carrying and hiring).

**Related:** [`npc-types.md`](./npc-types.md), [`click-actions.md`](./click-actions.md), [`the-loom-grading.md`](./the-loom-grading.md). Separate from Phase 2's off-screen world. Combat stays in L-202.

---

## 1. Purpose

Characters act and speak for themselves.

- **In a scene,** NPCs take their turn when you end yours. They follow simple behaviours (keep a post, patrol, wander), and react together when you do something notable.
- **Memory:** characters remember you, through short notes about each meeting.
- **Voice and goals:** named characters have their own voice and goals.
- **Companions:** up to three travel with you, whether asked or hired. They follow, act, take commands, carry things, and speak up now and then.
- **Generic NPCs:** many NPCs are generic: guards, soldiers, monsters (the user's note). They come from **templates placed many times**. They take turns like anyone, gain a memory once you deal with them, and don't need a voice or count against grading.

All of this stays within a cost ceiling: **at most one extra cheap model call a turn** for the scene, plus one when a conversation ends. Turns where nothing notable happens cost what they do today.

---

## 2. What there is today

- **Characters** stand where Claude placed them and never move.
- **The GM** voices everyone inside NARRATE.
- **A turn** is movement plus one action, ended with End turn (L-611).
- **The pipeline** makes two Gemini Flash calls a turn, INTERPRET and NARRATE. The summary is a third, now and then.
- **The GM** sees the save's history with each entity and its disposition.
- **The Loom's founding design** holds each turn to a couple of cheap calls and puts expensive work into batch jobs.
- **Other designs this builds on:**
  - L-743: conversations;
  - L-735: speaker marks;
  - L-750: types, rules, setting types aside, and hiring left for this epic;
  - L-770 and L-760: items and coins.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-11), with follow-ups on generic NPCs. Items marked † took the recommendation without a question of their own.

### Acting in a scene

| ID      | Question            | Decision                                                                                                                                           |
| ------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AC1** | When NPCs act       | **When you end your turn**, each NPC in the scene takes theirs; their moves play out on the map, and the narration covers them                     |
| **AC2** | Who decides         | **Behaviours in code by default; one extra model call for the whole scene when something notable happens** (a weapon drawn, a shout, a law broken) |
| **AC3** | Which NPCs          | **Those in your scene:** the same battle map, or the same place in town                                                                            |
| **AC4** | How they move       | **By the player's rules:** speed, walls, doors, sight. They open unlocked doors, and locked ones with keys they carry                              |
| **AC5** | What else they do   | **Speak to you unprompted, open and close doors, pick up and drop items, follow, approach or keep away, leave the scene**                          |
| **AC6** | Behaviours over MCP | **Yes:** stay, post, patrol (waypoints), wander (radius). Defaults come from type                                                                  |

### Memory and voice

| ID      | Question           | Decision                                                                                            |
| ------- | ------------------ | --------------------------------------------------------------------------------------------------- |
| **ME1** | What they remember | **Short notes about each meeting**, kept per save                                                   |
| **ME2** | When it's written  | **When a conversation or a scene with them ends**, in one cheap call                                |
| **ME3** | Their voice        | **Voice notes set over MCP**, which NARRATE writes their lines from. No separate call per character |
| **ME4** | Goals              | **Goals per character, set over MCP**, which shape what they say and do                             |
| **ME5** | Model              | **Gemini Flash**, as today                                                                          |

### Generic NPCs

| ID      | Question         | Decision                                                                                                                                                                                                                                 |
| ------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GE1** | How they're made | **Templates placed many times.** A template ("Ashford city guard": types, look, behaviour, rules, what they carry) is placed as unnamed figures. Once you interact with one, that save gives it a memory, and the GM can name it in play |
| **GE2** | Grading          | **Not as individuals:** they're exempt from character criteria and don't count as residents, but their types count toward a settlement's spread                                                                                          |

### Companions

| ID      | Question          | Decision                                                                                                                         |
| ------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **CO1** | How someone joins | **Asked in conversation** (the GM decides, as a recorded change), or **hired** (mercenaries and guides, for coin per day)        |
| **CO2** | How many          | **Up to three**                                                                                                                  |
| **CO3** | What they do      | **Follow you everywhere, act on their own turn, take commands from the click menu, speak up now and then, carry things for you** |
| **CO4** | How they leave    | **When told, when the story says so** (a recorded change), **or when hired help isn't paid**                                     |
| **CO5** | Where they are    | **With you in this save, at home in every other save**                                                                           |
| **CO6** | A Party panel     | **Yes:** portraits, condition, what they carry, commands                                                                         |

### Cost and order

| ID      | Question       | Decision                                                                                                                        |
| ------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **CS1** | Cost ceiling   | **At most one extra Flash call a turn for the scene, and one per conversation for memory.** Quiet turns cost what they do today |
| **CS2** | First          | **Memory and voice, then acting in scenes, then companions**                                                                    |
| **CS3** | Grading        | **Voice notes, goals, and a behaviour** count for named characters                                                              |
| **CS4** | Exit criterion | **As in #532** (§5)                                                                                                             |

---

## 4. Design

### 4.1 Data

- **Named characters** gain:
  - `voice` (short notes);
  - `goals` (a few lines);
  - `behaviour: { kind: 'stay' | 'post' | 'patrol' | 'wander', post?, waypoints?, radius? }`.
- **Default behaviours from type:** a guard keeps a post, a merchant or innkeeper stays, a commoner wanders.
- **Templates (GE1):** a `templates` subcollection: `{ id, name, types, description, portrait?, behaviour, rules, carries, voice? }`.
- **Figures:** a `figures` subcollection of placed templates, `{ id, templateId, locationId, placeId?, battleMapId?, cell?, position?, behaviour? }`. A figure is shown as its template's name ("City guard") unless named in play.
- **Per save:**
  - `save.memories: { [characterOrFigureId]: [{ turn, note }] }`;
  - `save.names: { [figureId]: name }`, names the GM gave in play;
  - `save.npcPositions` (where NPCs have moved in this save);
  - `save.companions: [{ id, since, hired?: { perDay, paidUntil } }]`.

### 4.2 Over MCP

- **Characters:** `update_character` takes `voice`, `goals` and `behaviour`.
- **Templates:** `add_template` and `update_template`.
- **Figures:** `place_figures` places a template at cells or places, several at once. `retire_entity` removes figures.
- **`view_image`** draws figures like tokens.
- **Hiring:** a character can be marked for hire, `hire: { perDay }`. Mercenary and guide types suggest it.

### 4.3 Memory and voice

- **When a memory is written (ME2):** when a conversation ends (L-743), or a scene with a character ends (you leave, or they do).
  - One Flash call writes a short note per character involved: what was said or done, and how it went.
  - The note is added to `save.memories`.
  - A figure gets memories the same way once interacted with (GE1).
- **Reading memory:** NARRATE and conversations are given a present character's last few notes, plus their voice and goals (ME3, ME4). Speaker marks (L-735) keep each line attributed.
- **Naming figures:** the GM can name a figure in play with a recorded change, which writes `save.names`.

### 4.4 The NPC phase

- **When:** after End turn (AC1), NPCs and figures in the scene take turns, in a fixed order. Scene means the same battle map, or the same place in town (AC3).
- **Behaviours in code:**
  - each NPC follows its behaviour (stay, post, patrol along waypoints, wander within a radius);
  - moves use the same rules as the player (AC4): `grid-paths.js` and `town-paths.js`, walls, doors, and keys they carry.
  - Their steps animate on the map (L-720).
- **Notable events:** ADJUDICATE flags a turn as notable when the player:
  - breaks a law (L-753);
  - draws or uses a weapon, shouts, or enters a guarded or private place;
  - or speaks to someone, or attacks.
- **The scene call:** on a notable turn, one extra Flash call (CS1) decides a reaction for each NPC present (AC5):
  - move toward, follow or keep away;
  - say a line;
  - open or close a door;
  - pick up or drop an item;
  - leave by an exit.

  Each reaction is checked by the rules before it happens. NARRATE weaves the reactions into the turn's narration.

- **Types:** types and rules (L-750) shape both behaviours and the scene call. A type set aside in the save stops shaping them.

### 4.5 Companions

- **Joining (CO1):**
  - The GM can accept a request in conversation with a recorded change, `companions: [{ join | leave, id, reason }]`.
  - A character marked for hire offers **Hire** in the click menu. It pays the first day with `pay` (L-760) and pays each new game day while you have the coins; otherwise they leave (CO4).
- **At most three (CO2).**
- **Following (CO3):**
  - companions travel with you across the world map;
  - in town they arrive at the same place;
  - on battle maps they're placed beside your entry.
- **Acting:** on battle maps and in town they act in the NPC phase with the `follow` behaviour, or as commanded.
- **Commands** from the click menu: Follow, Wait here, Go there, Stay close.
- **Speaking up:** NARRATE may include one remark from a companion at most every five turns, with no extra call.
- **Carrying:** a companion's items appear as a tab in the Inventory panel (L-775), and moving items to or from it is free.
- **Per save (CO5):** a companion is with you in this save and at home in every other. Their position and companionship are save state. The GM may set their home type aside while they're away (L-750).
- **The Party panel (CO6)** joins the menu bar: portraits, condition, what they carry, and commands.

### 4.6 Cost (CS1)

- **A quiet turn** costs what it does today.
- **A notable turn** adds one Flash call for the scene.
- **The end of a conversation or scene** adds one call for memory notes.
- **Companions' remarks** ride on NARRATE.
- **Measured:** the turn record keeps a count of calls, so the ceiling can be checked.

### 4.7 Grading

This epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.3), for **named characters**:

- voice notes (5);
- goals (5);
- a behaviour (5).

**Generic figures (GE2)** are exempt from character criteria and don't count as residents. Their types count toward a settlement's spread (L-750).

---

## 5. Exit criterion

A companion follows the player out of town and onto a battle map, moves on their own there, and later recalls something from an earlier session in a voice of their own.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                                | Depends on   | Model  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-791 | **Voice, goals and memory:** fields and MCP, memory notes at the end of conversations and scenes, fed to NARRATE and conversations, grading criteria | L-743, L-735 | Sonnet |
| L-792 | **Generic NPCs:** templates, placing figures, figures' memories and names in play, grading exemptions                                                | L-791, L-751 | Opus   |
| L-793 | **Behaviours and the NPC phase:** behaviours and type defaults, MCP, NPCs moving by the rules after End turn, doors and keys, a behaviour criterion  | L-792, L-773 | Opus   |
| L-794 | **Reactions:** notable turns, the scene call, checked reactions, the cost count                                                                      | L-793, L-753 | Opus   |
| L-795 | **Companions:** joining and leaving, following across levels, commands, remarks, carrying, per save                                                  | L-794        | Opus   |
| L-796 | **Hiring and the Party panel:** hire for coin per day, unpaid leaving, the Party panel                                                               | L-795, L-762 | Sonnet |

**Order (CS2):** L-791 first (memory and voice). Then L-792 to L-794 (acting in scenes), then L-795 and L-796 (companions).
