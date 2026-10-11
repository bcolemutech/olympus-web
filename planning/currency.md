# The Loom — Currency — Design Document v0.1

**Status:** Decided (2026-10-11). The gap sheet (§3) is answered. Sub-issues are planned (§6) and are filed when this epic is next.
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-760 (#529)
**Phase:** 8 — People and trade ([`roadmap.md`](./roadmap.md) §4). **Second of the trade epics:** after inventory (L-770), before businesses (L-780).
**Depends on:** L-770 (#530): coins are items.
**Related:** [`inventory.md`](./inventory.md), [`businesses.md`](./businesses.md)

---

## 1. Purpose

Money becomes real.

- **Each world names its own coins.** For example, 10 copper make a silver and 20 silver make a crown.
- **Coins are items.** They stack, weigh something, and can be dropped or stolen.
- **Everyone has a purse:** the player and every character.
- **Paying** uses the fewest coins, and change comes back.
- **Amounts** show broken into coins: "2 crowns, 3 silver, 4 copper".
- **The GM can move any amount in the story**, but only as changes the server applies and records. Narration alone never changes a purse.

---

## 2. What there is today

- There is no money in the game state. The GM mentions coins in narration only.
- L-770 brings the item catalog, stacking, weight and characters' carried items.

---

## 3. Gap sheet

Settled with the user through the trade questionnaire (2026-10-11), with follow-ups on order, the GM and change. Items marked † took the recommendation without a question of their own.

| ID      | Question                    | Decision                                                                                                                                                                           |
| ------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CU1** | How denominations relate    | **Whole-number ratios set per world** (10 copper to a silver, 20 silver to a crown)                                                                                                |
| **CU2** | How amounts show            | **Broken into denominations:** "2 crowns, 3 silver, 4 copper"                                                                                                                      |
| **CU3** | Are coins things you carry? | **Yes: coins are items**, one stackable catalog item per denomination, with weight. They can be dropped or stolen. This replaces the intake's single amount on the save            |
| **CU4** | Who holds money             | **Everyone:** the player and every character carry coins                                                                                                                           |
| **CU5** | Money from the story        | **Any amount, but only as recorded changes:** the GM proposes a change (a reward, a fine, coins found), and the server applies and records it. Narration alone never changes money |
| **CU7** | Making change               | **Automatic:** a payment uses the fewest coins, and change comes back, as long as the other side has the coins                                                                     |
| †       | Starting money              | **Set per world** (intake), given as the fewest coins                                                                                                                              |
| **O2**  | Grading                     | **No criterion:** every world has money; it isn't richness                                                                                                                         |
| **O4**  | Exit criterion              | **As in #529** (§5)                                                                                                                                                                |

---

## 4. Design

### 4.1 A world's currency

- **`world.currency`** is `{ denominations: [{ id, name, plural, value, weight }], starting }`.
  - `value` is in the smallest unit, and each value is a whole multiple of the next smaller one (CU1).
  - `starting` is an amount in the smallest unit.
- **`set_currency`** (MCP) sets it. Each denomination becomes, or updates, a catalog item of kind `coin`: stackable, with its value and weight.
- **Prices and values** everywhere (catalog items, L-780's stock) are amounts in the smallest unit.

### 4.2 Purses

- **A purse** is the coin stacks in an inventory (CU3). The player's are in `save.character.items`. A character's are in `character.carries`, set over MCP, and their per-save changes are kept on the save.
- **New games** start with the world's `starting` amount as the fewest coins.
- **Coins count toward weight** like any item.

### 4.3 Paying and change

- **`pay(from, to, amount)`** takes the fewest coins from the payer that cover the amount, then hands back change from the payee's coins (CU7).
  - If the payee can't make change, the smallest overpayment the payer can make is offered: "They can't change a crown. Pay 1 crown for 15 silver?" Otherwise the payment is refused.
  - If the payer can't cover it, it's refused with what's missing.
- **Every payment is a recorded change** on the turn: who, to whom, the coins each way, and why.

### 4.4 Money from the story

- **Recorded changes (CU5):** NARRATE can return `moneyChanges: [{ from?, to?, amount, reason }]` for a reward, a fine, a price paid in a scene, or coins found.
  - **COMMIT** applies each change with `pay` when both sides hold coins, or adds or removes coins when one side is the world.
  - It checks that the payer has the coins.
  - It records every change on the turn.
- **No other path:** narration that mentions money without a change moves nothing. The GM is told the player's purse each turn, so it can stay true to it.

### 4.5 Showing money

- **The Inventory panel** (L-775) shows the purse total, broken down (CU2), above the coin stacks.
- **Turn records and the narration** show money changes as small lines ("You paid 3 silver to Edda").
- **Characters' cards** don't show their purse.

---

## 5. Exit criterion

A player pays a ferryman in the world's own coin, and the purse is right on the next session.

---

## 6. Sub-issues (planned; filed when this epic is next)

| ID    | Story                                                                                                                   | Depends on   | Model  |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-761 | **A world's currency:** denominations as coin items, ratios, starting money, `set_currency`, characters' coins over MCP | L-771        | Sonnet |
| L-762 | **Paying and change:** `pay`, fewest coins, change and overpayment, recorded payments                                   | L-761, L-772 | Opus   |
| L-763 | **Money from the story:** `moneyChanges` from NARRATE, COMMIT's checks, the GM told the purse                           | L-762        | Opus   |
| L-764 | **Showing money:** the purse in the Inventory panel, money lines in the narration                                       | L-762, L-775 | Sonnet |
