# The Loom — Inventory — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-770 (#530)
**Phase:** 8 — People and trade ([`roadmap.md`](./roadmap.md) §4). **First of the trade epics:** inventory, then currency (L-760, whose coins are items), then businesses (L-780).
**Depends on:** L-740 (#527, the click menu and structured actions); L-720 (#525, the panel and menu bar); L-700 (#523, item art).
**Related:** [`currency.md`](./currency.md), [`businesses.md`](./businesses.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

Items become canon.

- **Catalog and instances:** each world has an item catalog, defined over MCP. Saves hold instances of catalog items, or items the GM made up in play.
- **Carrying:** items stack and have weight. Past the carrying limit you slow down.
- **Equipment and containers:** you wear and wield things in slots, and carry bags.
- **Items in the world:** they lie on battle-map squares, sit in chests, and are carried by characters.
- **The panel:** a Baldur's Gate-style grid with a weight bar, slots beside a figure, and containers in tabs.

Coins (L-760) are items too, so this epic comes first.

---

## 2. What there is today

- `save.character.inventory` is a list of names.
- A locked door names its `key`, and a tap with a matching name in the inventory unlocks it (L-626). Matching ignores case and "a", "an", "the".
- A character has a `speed` (movement points a turn, default 20).
- No weight, value, slots or containers exist. The GM mentions items freely in narration.

---

## 3. Gap sheet

Settled with the user through the trade questionnaire (2026-10-11), with a follow-up on order. Items marked † took the recommendation without a question of their own.

| ID       | Question                | Decision                                                                                                                               |
| -------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **IV1**  | Item kinds              | **Weapon, armour and clothing, tool, consumable, key, document, treasure, trade goods, other.** A world can add kinds. L-760 adds coin |
| **IV2**  | Over the carrying limit | **Half speed up to twice the limit; nothing more can be picked up beyond that**                                                        |
| **IV3**  | Limit and units         | **A limit set per world, in the world's unit (lb or kg).** A character can have their own                                              |
| **IV4**  | Slots                   | **Main hand, off hand, body, head, feet, cloak, neck, two rings, belt**                                                                |
| **IV5**  | What equipping does     | **The GM is told what you wear and wield**, and narrates with it. Numbers come with combat (L-202)                                     |
| **IV6**  | Containers              | **One level** (no bags in bags), each with a capacity. In the world they can be locked                                                 |
| **IV7**  | Items in the world      | **On battle-map squares** (markers once seen), **in containers on maps**, and **carried by characters**                                |
| **IV8**  | Items the GM invents    | **Freely, at any value**, as soft items on the save                                                                                    |
| **IV9**  | Item art                | **Catalog items can have a studio image** (kind `item`), shown as their icon. Counts toward grading                                    |
| **IV10** | The panel               | **A grid of icons with a weight bar, slots beside a figure, containers in tabs**                                                       |
| **IV11** | Actions shipped         | **Pick up, drop, equip and unequip, put in and take out of containers.** Give, use, search and read come later                         |
| **IV12** | Today's inventories     | **Each name becomes a soft item on the save**; keys keep opening their doors                                                           |
| **O1**   | Order                   | **This epic first**, then currency, then businesses                                                                                    |
| **O3**   | Item art in grading     | **Yes:** catalog items with art (world, 5)                                                                                             |
| **O4**   | Exit criterion          | **As in #530** (§5)                                                                                                                    |

---

## 4. Design

### 4.1 The catalog

- **Where:** a world's `items` subcollection.
- **An item:** `{ id, name, kind, description, value, weight, stackable, slot?, unique?, imageId?, capacity?, opens?, text? }`.
  - `value` is in the world's smallest money unit (L-760). It is 0 until a currency exists.
  - `weight` is in the world's unit.
  - `slot` is one of the IV4 slots.
  - `capacity` (a weight) makes the item a container.
  - `opens` lists door ids it unlocks.
  - `text` is what a document says.
- **Kinds:** a world adds its own in `world.itemKinds`.
- **Carrying:** `world.carry: { unit: 'lb' | 'kg', limit }`, and a character may set `carryLimit`.

### 4.2 What a save holds

- **The inventory** moves to `save.character.items: [{ id, itemId? , soft?, qty, where }]`.
  - Each entry is either a catalog item (`itemId`) or a soft item (`soft: { name, kind, value, weight, description }`).
  - `where` is `pack`, a slot name, or the id of a carried container.
- **Weight** is the sum of everything carried.
  - Over the limit, speed is halved (IV2): `speedOf` reads the load.
  - At twice the limit, pick-ups are refused with a reason.
- **Migration (IV12):** each name in today's `inventory` becomes a soft item (kind `misc`, value 0, weight 0) in the pack.
  - Door keys match catalog items by `opens`.
  - They also match any item by name, loosely as today, so old saves keep working.

### 4.3 Items in the world

- **On battle maps:** `map.items: [{ id, itemId | soft, qty, cell }]`, drawn as markers once their square has been seen.
- **Containers on maps:** `map.containers: [{ id, name, cell, locked?, key?, capacity?, contents: [...] }]`, opened with L-740's Open and Unlock.
- **Carried by characters:** `character.carries: [{ itemId | soft, qty, slot? }]`. They show on the character's card, and are taken only by story or trade.
- **Per save:** what a save has taken or left is kept on the save (`save.mapItems`), not in canon, as doors and fog are.

### 4.4 Over MCP

- **`add_item`, `update_item`, `retire_entity`:** the catalog.
- **`set_map_items`:** items and containers on a battle map.
- **`update_character`:** gains `carries`.
- **`update_world`:** gains `carry` and `itemKinds`.
- **Images:** `studio_assign` gains the `item` target.
- **`view_image`** of a battle map draws item and container markers.
- **The work list** groups soft items worth adding to the catalog.

### 4.5 Actions and the GM

- **Click actions (IV11):**
  - **Pick up:** from your square or the next one, or from an open container.
  - **Drop:** onto your square.
  - **Equip and unequip.**
  - **Put in / take out:** between your pack, your containers, and an open container beside you.
- **Turn rules:** these are structured actions under L-740's rules. Pick up and drop use the action; equip and moving between your own containers are free.
- **The GM:**
  - is told what you wear, wield and carry (names and kinds);
  - can add or remove items in the story through recorded changes, `itemChanges: [{ add | remove, item, qty, reason }]`, which COMMIT applies;
  - can invent soft items freely (IV8).
- **Removing from the world:** a pick-up that empties a map item or a container's slot removes it from that save's map.

### 4.6 The panel

The Inventory panel joins the menu bar (L-720):

- a grid of icons with a weight bar (IV10);
- the slots beside a figure;
- each carried container as a tab.

Icons are the item's studio image, or a built-in icon for its kind. Dragging moves items between pack, slots and containers.

### 4.7 Grading

This epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.3):

- **World:**
  - an item catalog (15);
  - catalog items with art (5).
- **Point of interest and place in town:** items to find, on its battle map or in its containers (10).
- **Battle map:** items or filled containers on it (10).
- **Character:** carries something (10, shared with "sells" from L-780).

---

## 5. Exit criterion

A player picks up a sword from the floor of a battle map, equips it, and puts a rope in their pack. Both are still there after a session gap, with the right weight.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                         | Depends on   | Model  |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-771 | **The catalog:** items, kinds, carrying units and limits, `add_item`, `update_item`, item art, grading criteria               | L-691        | Sonnet |
| L-772 | **A save's items:** instances and soft items, the migration, weight and the slowed speed, slots, keys by `opens` and by name  | L-771        | Opus   |
| L-773 | **Items in the world:** map items, containers, characters' carries, per-save state, `set_map_items`, `view_image` markers     | L-772        | Opus   |
| L-774 | **Item actions and the GM:** pick up, drop, equip, move between containers; the GM told what you carry; recorded item changes | L-773, L-742 | Sonnet |
| L-775 | **The Inventory panel:** grid, weight bar, slots, container tabs, dragging                                                    | L-772, L-721 | Sonnet |
