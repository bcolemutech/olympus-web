# The Loom — Businesses — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-780 (#531)
**Phase:** 8 — People and trade ([`roadmap.md`](./roadmap.md) §4). **Last of the trade epics.**
**Depends on:**

- L-770 (#530, items);
- L-760 (#529, coins and paying);
- L-750 (#528, proprietors' types);
- L-740 (#527, the click menu);
- L-370 (#421, game time), with L-374 (waiting and sleeping) and L-373 (travel).

**Related:** [`inventory.md`](./inventory.md), [`currency.md`](./currency.md), [`npc-types.md`](./npc-types.md), [`the-loom-grading.md`](./the-loom-grading.md)

---

## 1. Purpose

A business is a place with a proprietor.

- **Trade:** it sells from its stock and buys anything at half its value, while its till can pay.
- **Services:** it can offer a room for the night, a meal, or passage by ship.
- **Hours and stock:** it keeps opening hours, and its stock runs down and restocks on game time.
- **Defaults:** a place's kind gives it a starting business (market, tavern, smithy, temple, specialist shop), and Claude refines it.
- **The trade window:** you trade in a window opened from the proprietor's menu. The GM narrates the deal.

Stock lives in a locked container, so theft can come later.

---

## 2. What there is today, and after its dependencies

- **Places in town** have a kind (market, temple, harbour, …) and a cast.
- **Proprietors:** after L-750, characters have types (merchant, innkeeper, crafter, priest, …).
- **Money:** after L-760, everyone carries coins, and `pay` makes change.
- **Items:** after L-770, items have value and weight, and containers can be locked.
- **Time:** after L-370, the game has hours and days; L-374 adds waiting and sleeping, and L-373 travel time.

---

## 3. Gap sheet

Settled with the user through the trade questionnaire (2026-10-11), plus the intake (2026-10-09). Items marked † were decided without a question of their own.

| ID      | Question                          | Decision                                                                                                                                                                                                   |
| ------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BU1** | Defaults by place kind            | **Market** (general goods, food, trade goods), **tavern or inn** (food, drink, a room), **smithy** (weapons, armour, tools), **temple** (holy items), **specialist shop** (apothecary, bookseller, tailor) |
| **BU2** | Selling to a business             | **They buy anything, at a share of its value** (half by default), while their till can pay                                                                                                                 |
| **BU3** | Disposition and prices            | **No:** prices are fixed per item per business                                                                                                                                                             |
| **BU4** | Opening hours                     | **Defaults by kind, changeable per business:** shops 08–18, taverns 10–02, temples dawn to dusk. Closed means no trade                                                                                     |
| **BU5** | Restocking                        | **Per item:** each stocked item returns to its level daily or weekly; unique items never return. The till refills on the same schedule                                                                     |
| **BU6** | Stock across saves                | **Per save:** each game has its own stock and till. Shared stock is settled with multiplayer (Phase 4)                                                                                                     |
| **BU7** | Services shipped                  | **A room for the night, a meal or a drink, passage by ship**                                                                                                                                               |
| †       | Passage without a harbour default | Harbours aren't a default (BU1), so **passage is a service Claude adds** to a business, such as a captain at the docks                                                                                     |
| **BU8** | How trading looks                 | **A trade window:** their stock and prices beside your items, a basket, the total, Buy and Sell. The GM narrates the deal after                                                                            |
| **BU9** | Theft                             | **Later.** The locked stock makes room for it                                                                                                                                                              |
| **O4**  | Exit criterion                    | **As in #531** (§5)                                                                                                                                                                                        |

---

## 4. Design

### 4.1 A business

- **`place.business`** holds:
  - `proprietorId`;
  - `kind`;
  - `stock: [{ itemId, qty, price, restock: 'daily' | 'weekly' | null }]`;
  - `buyShare` (0.5 by default, BU2);
  - `till` (the coins it keeps on hand, as an amount);
  - `services: [{ id: 'room' | 'meal' | 'passage', price, to? }]`;
  - `hours: { open, close } | 'dawn-dusk'`.
- **Stock** sits in a locked container at the place, so it is a real container (L-770) that theft can open later.
- **The till** is coins in that container, so the business pays and makes change with `pay` (L-760).
- **The proprietor** must have a type that fits: merchant, innkeeper, crafter or priest, or any type a world marks as trading.

### 4.2 Defaults and MCP

- **`set_business`** sets or changes a business. With `fromDefaults`, it fills stock and services from the place's kind (BU1), using catalog items that match the kind's goods. Claude then refines it.
- **Defaults:**

  | Kind            | Sells                            | Services   | Hours        |
  | --------------- | -------------------------------- | ---------- | ------------ |
  | Market          | general goods, food, trade goods | —          | 08–18        |
  | Tavern or inn   | food, drink                      | room, meal | 10–02        |
  | Smithy          | weapons, armour, tools           | —          | 08–18        |
  | Temple          | holy items                       | —          | dawn to dusk |
  | Specialist shop | its specialty                    | —          | 08–18        |

- **Passage:** `services` can add `passage` with a destination port and price, on any business (†).
- **The work list** hints at missing businesses from place kinds, and groups businesses with empty stock.

### 4.3 Per save

- **What a save keeps:** `save.businesses[placeId] = { stock, till, lastRestockAt }`, starting from canon when the player first visits (BU6).
- **Restock (BU5):** on each visit, the business restocks to canon's levels for every daily or weekly item whose time has come, by game time (L-370). The till refills too. Unique items never return.
- **Hours (BU4):** outside its hours, Trade and services are hidden from the menu, and the GM is told the place is closed.

### 4.4 Trading

- **Opening the window:** Trade appears in the proprietor's menu (L-741) during opening hours. It opens the trade window (BU8):
  - their stock with prices;
  - your items with what they'd pay (`buyShare` × value);
  - a basket and the running total in coins (L-764), with Buy and Sell.
- **Confirming** sends one structured `trade` action: `{ buy: [...], sell: [...] }`.
  - **ADJUDICATE** checks stock, the till, your purse, and your carrying limit.
  - **COMMIT** moves the items, and the coins by `pay`, with change.
  - **NARRATE** narrates the deal briefly.
  - The trade uses your action for the turn.
- **Prices** are fixed (BU3). The GM can't change a price or a stock level.

### 4.5 Services

- **A room for the night:** pay, then sleep until morning, a `wait` until dawn (L-374).
- **A meal or a drink:** pay; narrated, and it takes a few minutes of game time.
- **Passage:** pay, then travel to the destination port by sea, with the travel time of L-373, and arrive at its harbour.

### 4.6 Grading

This epic adds ([`the-loom-grading.md`](./the-loom-grading.md) §4.3):

- **Settlement:** businesses for its size (10).
  - Village: 1, a tavern or a market.
  - Town: 3, including a tavern and a market.
  - City: 5, adding a smithy and a temple.
  - Great city: 7.
- **Place in town:** a business where its kind suggests one (10): tavern, market, smithy, temple, shop.
- **Character:** sells something, for proprietors (shared with "carries" from L-770, 10).

---

## 5. Exit criterion

A player buys a sword from the smith in the world's own coin; it lands in their inventory, and the shop's stock drops. Coming back at night, the shop is shut.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                     | Depends on          | Model  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------ |
| L-781 | **Businesses in canon:** data, defaults by kind, `set_business`, locked stock and till, work-list hints, grading criteria | L-773, L-761, L-751 | Sonnet |
| L-782 | **Per save, hours and restock:** a save's stock and till, opening hours, restocking by game time                          | L-781, L-371        | Opus   |
| L-783 | **The trade window and the `trade` action:** buy and sell, checks, coins and change, narration                            | L-782, L-762, L-775 | Opus   |
| L-784 | **Services:** a room for the night, meals, passage by ship                                                                | L-782, L-374, L-373 | Sonnet |

---

## 7. Later

- **Theft** from stock and tills (BU9).
- **Healing, repairs, training and hiring** as services, once condition, durability, skills and companions exist.
- **Harbours** as a default business.
