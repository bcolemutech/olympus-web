# The Loom — Reference Games — v0.1

**Status:** Draft (2026-10-16). Four games the Loom should be able to run, and what each needs. The gaps (§3) are being settled with the user through a questionnaire; the answers place each gap on the roadmap.
**Project:** Olympus (`olympus-dfa00`)
**Related:** [`roadmap.md`](./roadmap.md), [`game-systems.md`](./game-systems.md) (Phase 9), [`worlds-without-azgaar.md`](./worlds-without-azgaar.md) (L-710), [`off-road-travel.md`](./off-road-travel.md) (L-360)

---

## 1. Purpose

These are **reference games**: the kinds of game the Loom is being built to run. Each design from here on is checked against them, so a feature built for one serves the others, and nothing one of them needs is designed out by accident (the rule "mechanics are modules; systems are data").

Each game is one world, or a family of worlds, on its own game system (Phase 9). Where two games share a mechanic, it is one module with two settings.

---

## 2. The four games

Status in the tables: **✅ shipped**, **📋 planned** (designed, with an epic), **❓ gap** (not designed yet; §3).

### 2.1 Sword and sorcery: travel and dungeon crawls

A D&D-style game: a party travels a realm of roads and wilds, takes work in towns, and goes down into dungeons to fight, search and loot.

| Needs                                                      | Where                                                       | Status  |
| ---------------------------------------------------------- | ----------------------------------------------------------- | ------- |
| A d20 system: sheet, checks, ladder, degrees               | L-800, L-810                                                | 📋      |
| Travel by road, game time, nights on the road              | L-370                                                       | ✅      |
| Wilderness travel and rolled encounters                    | L-360                                                       | 📋      |
| Towns, shops, inns, coin, inventory                        | L-750 to L-780                                              | 📋      |
| Companions who act and remember                            | L-790                                                       | 📋      |
| Combat: initiative, attacks, reactions, cover              | L-820 (combat module)                                       | 📋      |
| Spells                                                     | Powers module                                               | 📋      |
| Dungeon floors and wings                                   | Battle-map exits to other maps (L-351); tools to build them | ✅ / ❓ |
| Light and darkness, torches, darkvision                    | "Not yet placed"                                            | ❓      |
| Traps, secret doors, searching                             | —                                                           | ❓      |
| Monsters: hostile creatures with stat blocks and behaviour | L-790 templates and stat blocks; hostility                  | 📋 / ❓ |
| Loot in chests and on the fallen                           | L-770 containers                                            | 📋      |
| Conditions with durations, areas, saving throws            | —                                                           | ❓      |
| Short and long rests; recovering resources                 | —                                                           | ❓      |
| Falling to 0, dying, defeat                                | —                                                           | ❓      |
| Experience and levels                                      | Deferred in Phase 9 (CS6)                                   | ❓      |
| Quests and a journal                                       | "Not yet placed"                                            | ❓      |

### 2.2 Steampunk sword and sorcery: guns, machines, trains and airships

The same rules as 2.1 (a copy of its system), with gunpowder, clockwork and steam: firearms, constructs, railways between cities, and airships over the land.

| Needs                                                 | Where                                                | Status |
| ----------------------------------------------------- | ---------------------------------------------------- | ------ |
| Everything in 2.1                                     | As above                                             | —      |
| A copy of the d20 system with its own words and items | Phase 9 (SY5, copies)                                | 📋     |
| Firearms: range, ammunition, reloading, misfires      | Combat module options; ammunition as stackable items | ❓     |
| Machines and constructs as creatures                  | Stat blocks (L-790)                                  | 📋     |
| Building and repairing machines                       | Crafting module                                      | ❓     |
| Railways: a rail route kind and its speed             | L-710 route kinds (W7)                               | 📋     |
| Trains that run to a timetable; tickets               | Calendar and schedules; L-780 passage                | ❓     |
| Airships that fly over terrain                        | An air route kind, ignoring terrain                  | ❓     |
| A train or airship as a map you walk while it travels | Vehicles as places                                   | ❓     |
| Airship battles                                       | Ship battle module                                   | ❓     |

### 2.3 Space odyssey: a starship and a galaxy

A Star Trek-like game: the crew of a starship explore a galaxy, beam down to worlds, meet other powers, and fight ship to ship.

| Needs                                                                                 | Where                                 | Status |
| ------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| A dice-pool sci-fi system                                                             | L-800 (the second built-in system)    | 📋     |
| **More map levels:** galaxy → sector → star system → orbit → surface → town → ground  | Today: world → town → battle map only | ❓     |
| Distances and speeds per level: light-years and warp, then miles and hours            | L-370 works in miles                  | ❓     |
| The starship as a map you walk (bridge, engineering) that travels the levels above it | Vehicles as places                    | ❓     |
| Ship systems: power allocation; parts and subsystems that take damage; arcs; shields  | Ship battle module (MD6)              | ❓     |
| A crew larger than three, with roles and orders                                       | L-790 caps companions at three        | ❓     |
| Away teams: leaving the ship for a surface, and returning                             | Vehicles as places                    | ❓     |
| Exploring a galaxy too large to build by hand                                         | Templates, building on demand         | ❓     |
| Other powers, diplomacy, standing                                                     | Social conflict module; factions      | ❓     |
| Scanning, sensors                                                                     | A check, or a module option           | ❓     |

### 2.4 Wizarding world: spells, alchemy and a school

A wizarding game, loosely on the d20 rules: students learn complex spells, brew potions, and live by a school's timetable and houses.

| Needs                                                                       | Where                               | Status  |
| --------------------------------------------------------------------------- | ----------------------------------- | ------- |
| A copy of the d20 system, with magic at its centre                          | Phase 9                             | 📋      |
| Complex spells: schools, components, slots or mana, areas, durations, saves | Powers module, on an effects engine | ❓      |
| Learning spells: study, practice, a spellbook                               | Advancement                         | ❓      |
| Alchemy: ingredients, recipes, brewing over game time, potions with effects | Crafting module, items (L-770)      | ❓      |
| Gathering ingredients by terrain and place                                  | Crafting and gathering              | ❓      |
| A calendar and class timetables                                             | Deferred in L-370                   | ❓      |
| NPCs keeping hours: lessons, meals, curfew                                  | L-790 behaviours, by time           | 📋 / ❓ |
| Houses, points and standing                                                 | Social conflict module; factions    | ❓      |
| Magical creatures                                                           | Stat blocks (L-790)                 | 📋      |

---

## 3. The gaps

The ❓ rows above, grouped. Two are architectural and touch how worlds are made; they come first, since L-710 (worlds without Azgaar) reshapes worlds next and should not be built twice.

| Gap                                                                          | Sword | Steam | Space | Wizard | Kind         |
| ---------------------------------------------------------------------------- | ----- | ----- | ----- | ------ | ------------ |
| **G1. Map levels to any depth**                                              | ●     | ●     | ●●●   | ○      | Architecture |
| **G2. Vehicles as places** (a map that moves along the levels above it)      |       | ●●    | ●●●   |        | Architecture |
| **G3. Effects:** conditions with durations, areas on the grid, saving throws | ●●    | ●     | ●     | ●●●    | Phase 9      |
| **G4. Advancement:** experience, levels, learning                            | ●●    | ●●    | ●     | ●●     | Phase 9      |
| **G5. Defeat, death, rest and recovery**                                     | ●●    | ●     | ●     | ●      | Phase 9      |
| **G6. Dungeon features:** light, traps, secrets, searching                   | ●●●   | ●     | ○     | ●      | Epic         |
| **G7. Crafting and gathering:** alchemy, machines, repair                    | ○     | ●●    | ●     | ●●●    | Module       |
| **G8. A calendar and schedules:** timetables, routines, opening hours        | ○     | ●●    |       | ●●     | Epic         |
| **G9. Content at scale:** templates, building on demand                      | ●     | ●     | ●●●   | ○      | Architecture |
| **G10. A larger party and a crew**                                           | ○     | ●     | ●●●   | ○      | Epic         |
| **G11. Quests and a journal**                                                | ●●    | ●     | ●●    | ●●     | Epic         |
| **G12. Hostile creatures:** monsters that fight, flee and guard              | ●●●   | ●●    | ●     | ●      | With combat  |

● needed, ●● important, ●●● central; ○ nice to have.

**Already there, for the record:** battle maps can link to other maps through exits (`{ map, entry }`, L-351), so a dungeon's floors and wings can be built today; what's missing is building them easily and showing several maps per place ("Not yet placed").

---

## 4. Decisions

_To be settled through the questionnaire (2026-10-16)._
