# The Loom — Click Actions — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-740 (#527)
**Phase:** 7 — Map-first Loom ([`roadmap.md`](./roadmap.md) §4). Follows L-730 (X2).
**Depends on:** L-720 (#525, the map engine, clickable things and their small menu); L-730 (#526, portraits for conversations and cards).
**Related:** [`portraits-and-tokens.md`](./portraits-and-tokens.md), [`the-map-first-loom.md`](./the-map-first-loom.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

Clicking the map is how the player acts on the world.

- **Every click opens a menu** of what can be done with the thing clicked. Menus are layered by category and can open a pop-up for complex actions, because the list will grow with every feature.
- **Choosing an action** sends a structured action that skips INTERPRET, but is still adjudicated and narrated under the same rules as typed play.
- **The first actions** are Move, Look, Talk, Open, close or unlock, and Enter or leave.
- **Talk** opens a conversation in the side panel.
- **Claude can add custom actions** to things over MCP, such as "Pull the lever", with a rule for the GM.

---

## 2. What there is today

- **Typed turns** go through INTERPRET, which turns text into `{ verb, targets, params }`, then ADJUDICATE and NARRATE.
- **Structured actions** already skip INTERPRET:
  - `move` (to a place, or to a cell on a battle map);
  - `continue` (walk the plan);
  - `end-turn`;
  - `door` (open or close);
  - `leave` (by an exit).
- **Turn rules:** each turn has movement and one action (L-611). Sight-only verbs such as look don't use the action.
- **The GM's suggested actions** show as buttons after each turn.
- **After L-720,** everything on the map is clickable, and a click opens a small menu of Move and Look.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-11), with follow-ups on scope and Look. Items marked † took the recommendation without a question of their own.

| ID      | Question                   | Decision                                                                                                                                                                                                                                    |
| ------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1**  | The first actions          | **Move here / travel to, Look, Talk to, Open / close / unlock, Enter / leave.** Search, pick up and use come later (pick up with L-770's items)                                                                                             |
| **C2**  | Talk                       | **Opens a conversation in the panel:** their portrait at the top, suggested replies to tap, typing still allowed; leaving ends it                                                                                                           |
| **C3**  | Attack before combat       | **Not offered** until combat rules exist (L-202). Players can still type it, and the GM handles it as today                                                                                                                                 |
| **C4**  | Actions that need more     | **Two steps:** pick the action, then the target (on the map or from a short list), such as which key unlocks a door                                                                                                                         |
| **C5**  | Turn rules                 | **The same as typed actions:** moves use movement, Look is free, the rest use the action                                                                                                                                                    |
| **C6**  | The menu                   | **A short list beside what was clicked**, with icons, in the Baldur's Gate trim                                                                                                                                                             |
| **C7**  | Tap or menu                | **Every click opens the menu**, with no one-tap shortcuts. The user's note: there will be more options later, so every click gives the menu. It may be layered to group actions, and may open pop-ups for complex actions. Keep it explicit |
| **C8**  | Hover (desktop)            | **A small card:** name, a line of description                                                                                                                                                                                               |
| **C9**  | Actions not possible now   | **Hidden**                                                                                                                                                                                                                                  |
| **C10** | Custom actions over MCP    | **Yes:** on features, places and characters, with a rule for the GM. They count toward grading as content                                                                                                                                   |
| **C11** | The GM's suggested actions | **Kept, and linked to the map:** hovering one lights its target. The user's note: this may be removed later if it reveals things that shouldn't be obvious                                                                                  |
| **X1**  | Exit criterion             | **Changed:** without typing anything, the player walks to a character, talks to them, unlocks a door and enters a place (§5)                                                                                                                |

---

## 4. Design

### 4.1 The menu

- **Every click** on the map (C7) opens a menu beside the thing clicked (C6). This covers ground, a token, a place, a feature, a door or an exit. The thing's card (name, line, portrait for a character; L-730) sits at its top.
- **Layers:** actions are grouped into categories: **Move**, **Interact**, **Talk**, **Inspect**, and later **Trade**, **Items** and more.
  - A category with one action shows it directly.
  - A category with several opens a second level.
  - An action that needs more (C4) moves to a target step or opens a pop-up.
- **Hidden when not possible (C9):** an action shows only if the server's rules would allow it now, in reach and with what it needs. "Unlock" shows only with a key that fits.
- **Hover (C8):** a small card with the thing's name and a line of description.
- **Keyboard:** the menu works with arrow keys, Enter and Escape.

### 4.2 The registry

- **Actions are data:** `{ id, label, icon, category, appliesTo, available(state, thing), build(thing, target?) }`.
  - `available` mirrors the server's checks (reach, keys, state), so hidden matches what would be refused.
  - `build` makes the structured action.
- **Later epics register their own:** trade (L-780), equip and give (L-770), hire (L-750).
- **Custom actions** (C10) come from the world's data (§4.4).

### 4.3 Structured actions on the server

- **The set grows to:**
  - `move` and `leave` (as now);
  - `door` (as now, plus `unlock` with a key);
  - `look`;
  - `talk`;
  - `enter`;
  - `custom`.
- **Checks:** each is adjudicated like a typed action (C5). Reach is checked on the server:
  - Talk needs the character in sight and within 6 squares on a battle map, or in the same place in town.
  - Doors and features need adjacency, as doors do today.
- **No INTERPRET call.** The action goes straight to ADJUDICATE and NARRATE, with the target ids already resolved.
- **Attack** is not in the menu (C3).

### 4.4 Custom actions over MCP

- **Where they live:** features on battle maps, places, points of interest and characters can carry `actions: [{ id, label, category, rule, requires?, costs: 'action' | 'free' }]`.
  - `rule` is text for the GM saying what happens.
  - `requires` names an item or a door state, until L-770 gives items ids.
- **The tool:** `set_actions` adds, changes or removes them. Reads show them.
- **In play:** choosing one sends `{ verb: 'custom', target, actionId }`. ADJUDICATE checks `requires` and `costs`, and NARRATE is given the rule.

### 4.5 Conversations

- **Starting:** choosing Talk (C2) sends `talk`, and the panel enters conversation mode.
  - The character's portrait and name sit at the top (L-730).
  - The narration below shows their lines with speaking portraits (L-735).
  - Suggested replies appear as buttons, and the input box stays.
- **During:** `save.conversation: { characterId, sinceTurn }` tells INTERPRET and NARRATE that typed lines are spoken to that character.
- **Ending:** the conversation ends when the player chooses **Leave**, moves away out of range, or the character leaves.

### 4.6 Suggestions linked to the map

The GM's suggested actions (C11) carry the target ids NARRATE already resolves. Hovering one lights its target on the map. A world setting can turn this off if it gives away too much.

### 4.7 Grading

Custom actions are content (C10), so this epic adds, by the rule in [`the-loom-grading.md`](./the-loom-grading.md) §4.6:

- **Battle map:** features with actions (10).
- **Point of interest and place in town:** something to do there, a custom action on it or its features (5).

---

## 5. Exit criterion

Without typing anything, the player walks to a character, talks to them, unlocks a door and enters a place.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                                            | Depends on   | Model  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ | ------ |
| L-741 | **The menu and registry:** every click opens a layered menu, categories, hidden-when-impossible, hover cards, target steps and pop-ups, keyboard | L-722        | Opus   |
| L-742 | **Structured actions:** `look`, `talk`, `unlock`, `enter` on the server, with reach checks and the same turn rules; no INTERPRET                 | L-741        | Opus   |
| L-743 | **Conversations:** conversation mode in the panel, `save.conversation`, suggested replies, ending                                                | L-742, L-735 | Sonnet |
| L-744 | **Custom actions:** `actions` on things, `set_actions`, the `custom` verb, the GM's rule, grading criteria                                       | L-742, L-691 | Sonnet |
| L-745 | **Suggestions on the map:** suggested actions carry targets, hover lights them, a world switch                                                   | L-741        | Sonnet |

**Order:** L-741, then L-742. L-743, L-744 and L-745 can follow side by side.
