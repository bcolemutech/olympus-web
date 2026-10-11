# The Loom — NPC Types and Interactions — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-750 (#528)
**Phase:** 8 — People and trade ([`roadmap.md`](./roadmap.md) §4)
**Depends on:** L-740 (#527, the click menu and conversations); L-730 (#526, the People panel and tokens).
**Related:** [`click-actions.md`](./click-actions.md), [`portraits-and-tokens.md`](./portraits-and-tokens.md), [`the-loom-grading.md`](./the-loom-grading.md); L-760 to L-780 add the interactions that need money and items.

---

## 1. Purpose

Characters get types: innkeeper, guard, merchant, priest, and so on. A type does two things:

- **It says what the character offers.** These become actions in the click menu, each opening a conversation on that topic.
- **It says how the GM must play them.** Most rules are told to the GM. One is kept in code: a guard who sees a crime always responds.

There is a built-in set. Each world can rename or hide built-in types and add its own, and a character can have several. **Types are not a cage** (the user's note): when the story calls for it, the GM can set a character's type aside in one save, and its interactions and rules stop there.

---

## 2. What there is today

- **Characters** have a name, description, realm, home, place and position. The GM reads the description and improvises.
- **ADJUDICATE** applies a few hard rules from canon: blocked routes, required abilities, hostile realms. Everything else is narration.
- **L-740** brings the click menu (Move, Look, Talk, Open/close/unlock, Enter/leave), conversations in the panel, and custom actions over MCP. **L-730** brings tokens and the People panel.
- **Lore entries** name the entities they concern, and retrieval already finds lore for the place and people in a scene.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-11), with a follow-up on setting types aside. Items marked † took the recommendation without a question of their own.

### The types

| ID      | Question                 | Decision                                                                                                                                                                                                         |
| ------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TY1** | The built-in types       | **Commoner, merchant, innkeeper, guard, priest, crafter, guide, mercenary, trainer, entertainer**                                                                                                                |
| **TY2** | Creatures and monsters   | **Not types:** a separate creature kind, with combat (L-202)                                                                                                                                                     |
| **TY3** | Other genres             | **A world can rename or hide built-in types, and add its own** (a guard becomes a "Constable"; a priest is hidden in a godless world)                                                                            |
| **TY4** | Several types            | **The first is the primary type**, shown first; all give their interactions and rules                                                                                                                            |
| **TY5** | Secret types             | **No:** all types are shown                                                                                                                                                                                      |
| **TY6** | Types that no longer fit | **Set aside in play, per save, by the GM**, with a reason. The type's interactions and rules, hard ones included, stop for that save, and the GM can restore it. Claude can still change types in canon over MCP |

### Interactions

| ID      | Question                | Decision                                                                                                                                                                                        |
| ------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **IN1** | Shipped with this epic  | **Ask for rumours, ask the way, ask for work, ask for a blessing or healing.** Interactions that need money or items arrive with L-760 to L-780 (trade, rent a room, hire, train, paid healing) |
| **IN2** | How they play out       | **Each opens the conversation (L-743) on that topic**; the character answers in their own voice                                                                                                 |
| **IN3** | Where answers come from | **From canon:** lore about nearby places and people the character would know. The GM can't invent facts the world doesn't hold                                                                  |
| **IN4** | Work and quests         | **Narrative only.** A quests epic, with a journal, goes on the roadmap                                                                                                                          |

### Rules for the GM

| ID      | Question                   | Decision                                                                                                                                |
| ------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **RU1** | Who writes rules           | **Built-in types come with rules; worlds can override them; custom types bring their own**                                              |
| **RU2** | How firmly                 | **Some in code now:** a guard who sees a crime always responds (§4.4). The rest are told to the GM each turn the character is present   |
| **RU3** | One character's exceptions | **A character can carry its own rule lines**, which win over its types' rules (a corrupt guard)                                         |
| **RU4** | What breaks the law        | **Each realm, or the world, has a short laws text.** Theft and violence are crimes by default. Set over MCP; the GM and guards go by it |

### Giving types, and showing them

| ID      | Question              | Decision                                                                                                                                                              |
| ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AS1** | Existing characters   | **Claude sets types, led by the work list and grading** ("34 characters have no type")                                                                                |
| **AS2** | Places suggest types  | **Yes, as hints in the work list** ("The tavern has no innkeeper")                                                                                                    |
| **AS3** | A settlement's spread | **Village 2 types; town 4, including a guard and a merchant; city 6, adding a priest and a crafter; great city 8.** Hidden built-in types don't count against a world |
| **DI1** | Where types show      | **In the People panel, and as a small badge on the token** (a coin for a merchant, a shield for a guard)                                                              |
| **X1**  | Exit criterion        | **As in #528** (§5)                                                                                                                                                   |

---

## 4. Design

### 4.1 Data

- **Built-in types** live in code, `functions/loom-canon/npc-types.js`. Each is `{ id, label, icon, rules, interactions }`, where `rules` is short text for the GM.
- **A world's types:** `world.npcTypes: { [typeId]: { label?, icon?, rules?, hidden?, interactions?, custom? } }`.
  - For a built-in type, an entry renames it, hides it or overrides its rules.
  - An entry marked `custom` adds a type.
- **A character:** `character.types: [typeId]`, primary first, and `character.rules`, its own rule lines (RU3).
- **Laws (RU4):** `realm.laws` and `world.laws`, short text. A realm's laws apply on its land; the world's apply elsewhere and fill gaps. With neither, theft and violence are crimes.
- **Set aside (TY6):** `save.typesSetAside: { [characterId]: { [typeId]: { reason, atTurn } } }`.

### 4.2 Over MCP

- **`set_npc_types`** renames, hides or overrides built-in types, and adds or changes custom ones. `get_world` lists the world's types.
- **Characters:** `add_character` and `update_character` take `types` and `rules`, checked against the world's types.
- **Laws:** `update_faction` and `update_world` take `laws`.
- **The work list:**
  - it groups characters without types (AS1);
  - it hints at types from place kinds (AS2): tavern → innkeeper, market → merchant, temple → priest, smithy → crafter, gate → guard, harbour → guide.

### 4.3 For the GM

When a character is present, the GM's prompts carry a PEOPLE line for them:

- their active types (minus any set aside in this save);
- those types' rules;
- the character's own rules, which win over the types';
- and the laws where the player is.

**Setting aside (TY6):**

- **The GM's output:** NARRATE can return `typeChanges: [{ characterId, typeId, setAside: true | false, reason }]`.
- **COMMIT** accepts only types the character has, for characters present this turn, and records them on the save.
- **The People panel** shows a set-aside type struck through, with its reason.

### 4.4 The rule in code: a guard sees a crime

- **INTERPRET** is given the laws where the player is and marks an action that breaks them, `crime: { law }`. Click actions are marked by their verb (no click action is a crime yet).
- **ADJUDICATE:** if a character with an active guard type (or any type whose rules a world marks `enforcesLaw`) has the player in sight, the outcome gains `lawResponse: { by: characterId, law }`.
- **NARRATE must narrate the response**, following the guard's rules and own rules: stop, arrest, fine or, for a corrupt guard, a bribe. A guard whose type is set aside in this save doesn't respond.

### 4.5 Interactions

- **Each interaction belongs to types:**

  | Interaction                   | Types                                      |
  | ----------------------------- | ------------------------------------------ |
  | Ask for rumours               | innkeeper, entertainer, merchant, commoner |
  | Ask the way                   | guide, commoner, guard                     |
  | Ask for work                  | innkeeper, merchant, crafter               |
  | Ask for a blessing or healing | priest                                     |

  A world's custom types list their own.

- **In the click menu (L-741)** they appear under Talk for a character with an active type that offers them.
- **Choosing one** opens the conversation (L-743) with that topic. Its first line comes from the character, drawing on lore they would know (IN3): lore about their place, settlement, region and people, found by retrieval. When nothing is known, they say so.
- **Ask for work** is told in narration only (IN4).
- **Set-aside types** drop their interactions in that save.

### 4.6 Showing types

- **The People panel** shows each character's types, primary first, with set-aside ones struck through.
- **Tokens** carry a small badge for the primary type, using the built-in icons or a world's own (DI1).

### 4.7 Grading

This epic adds the criteria planned for it ([`the-loom-grading.md`](./the-loom-grading.md) §4.3):

- **Character:** has types (15).
- **Settlement:** a spread of types for its size (10), by the tiers in AS3.
- **Quality:** a settlement's residents span types (variety).

---

## 5. Exit criterion

Clicking a guard and an innkeeper offers different actions. The guard acts as their type says when the player breaks the law.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                  | Depends on   | Model  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-751 | **Types in canon:** built-in types, a world's types, character types and rules, laws, the MCP tools, work-list hints, grading criteria | L-691        | Opus   |
| L-752 | **Types for the GM:** the PEOPLE line, laws, setting aside and restoring in a save                                                     | L-751        | Opus   |
| L-753 | **A guard sees a crime:** INTERPRET marks crimes against the laws, ADJUDICATE's law response, NARRATE narrates it                      | L-752        | Opus   |
| L-754 | **Interactions:** rumours, the way, work, blessing in the click menu by type, opening conversations, answers from canon lore           | L-751, L-743 | Sonnet |
| L-755 | **Showing types:** the People panel, token badges                                                                                      | L-751, L-736 | Sonnet |

**Order:** L-751 first. L-752 and L-754 can follow side by side; L-753 follows L-752; L-755 any time after L-751.

---

## 7. Later

- **Quests and a journal** (IN4): work taken on, from whom, and its progress. On the roadmap's "Not yet placed" list.
- **Interactions that need money or items:** trade (L-780), rent a room and meals (L-780), hire a mercenary and train (L-760, L-780).
- **Creatures** as their own kind, with combat (L-202).
