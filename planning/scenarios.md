# The Loom — Reference Games — v0.1

**Status:** Decided (2026-10-16). Four games the Loom should be able to run, what each needs, and where each gap lands (§4, §5).
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
| Experience and levels                                      | L-830 Advancement (§5)                                      | ❓      |
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

### 2.4 A darker wizarding world: magic, alchemy and the war over it

Loosely on the d20 rules. Magic exists, but **not everyone can use it**, and there is open violence between those who can and those who can't. No schools (the user's note, 2026-10-16): the game is living in that world, with complex spells and alchemy, and the danger of being what you are.

| Needs                                                                               | Where                                        | Status |
| ----------------------------------------------------------------------------------- | -------------------------------------------- | ------ |
| A copy of the d20 system, with magic at its centre                                  | Phase 9                                      | 📋     |
| Being able to use magic, or not: a trait that opens spellcasting                    | Sheet traits (L-810)                         | 📋     |
| Complex spells: schools, components, slots or mana, areas, durations, saves         | Powers module, on the effects engine         | ❓     |
| Growing in magic: experience, and spells and skills improving with use              | Advancement (L-830)                          | ❓     |
| Alchemy: ingredients, recipes, brewing over game time, potions with effects         | Crafting module, items (L-770)               | ❓     |
| Gathering ingredients by terrain and place                                          | Crafting and gathering                       | ❓     |
| Hostility between the magical and the mundane: factions, standing, hunters and mobs | Social conflict module; factions; combat     | ❓     |
| Who knows what you are: being seen casting, rumour, being hunted                    | Social conflict module; L-750 rules for NPCs | ❓     |
| Magical creatures                                                                   | Stat blocks (L-790)                          | 📋     |

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

Settled with the user through a questionnaire (2026-10-16). Every answer took the recommendation, except where noted.

### The games

| ID      | Question            | Decision                                                                                                                                                                        |
| ------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GM1** | Which game first    | **Sword and sorcery, then steampunk, then the wizarding world, then the space odyssey.** The first game's needs come first                                                      |
| **GM2** | The wizarding world | **Darker, and no schools** (the user's note): magic exists, not everyone can use it, and the magical and the mundane fight. §2.4 is rewritten; nothing school-related is needed |
| **OR2** | Test worlds         | **A small playable world per game**, built over MCP as features land and used in each epic's exit criterion: a dungeon, an airship line, a hunted mage's city, a star system    |

### G1. Map levels to any depth

| ID      | Question              | Decision                                                                                                                                  |
| ------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **LV1** | How levels work       | **Any map can hold places that open into a map below, to any depth.** World, town and battle map become kinds of map, not fixed levels    |
| **LV2** | Kinds of map          | **The three we have:** a region map (places and routes), an area map (places and paths, or ground) and a grid. Every level is one of them |
| **LV3** | Distances and travel  | **Each map has its own unit and ways of travelling** (light-years and warp; miles and roads; squares), read through `timeRules`           |
| **LV4** | Built and unbuilt     | **As today, at every depth:** a place opens when its map is built enough to play; the work list and grading cover every level             |
| **LV5** | Moving between levels | **The same zoom at any depth, with a trail of where you are**; peeking up or down as now                                                  |
| **LV6** | When                  | **Designed now, and built as part of L-710 or just before it**, so worlds aren't rebuilt twice                                            |

### G2. Vehicles as places

| ID      | Question              | Decision                                                                                                                  |
| ------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **VH1** | What a vehicle is     | **A map of its own (its decks) that sits on a map above it and moves along it.** You walk its decks while it travels      |
| **VH2** | Who sets its course   | **The player when it's theirs, a timetable, or its NPC captain**: all three                                               |
| **VH3** | Its sheet             | **A stat block from the system, with parts that take their own damage** (hull, sails or engines, shields by arc, weapons) |
| **VH4** | Owning one            | **Yes:** bought, given, or the game starts with one                                                                       |
| **VH5** | Getting off           | **Where it stops, or by a smaller craft or transporter** to places within reach                                           |
| **VH6** | Other vehicles moving | **Later,** with the living world (Phase 2)                                                                                |

### Rules (Phase 9)

| ID      | Question                | Decision                                                                                                                                                        |
| ------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EF1** | Effects (G3)            | **A small effects engine in Phase 9, before combat:** conditions with durations, areas on the grid, saving throws. Combat, powers, traps and potions all use it |
| **EF2** | Areas                   | **Burst, cone, line, square or cube, and aura** (moves with its source)                                                                                         |
| **AD1** | Advancement (G4)        | **Into Phase 9, as its own epic after combat**                                                                                                                  |
| **AD2** | Ways of growing         | **Experience and levels, and improving by use.** Not milestones or study (the user's choice)                                                                    |
| **DF1** | Falling to 0 (G5)       | **The system decides;** by default you're down and dying, then saved, captured or dead. A world can turn death off                                              |
| **DF2** | Rest and recovery       | **Short and long rests are waits** (L-374) that restore resources by the system's rules, with a chance of being disturbed in the wilds (L-360's roll)           |
| **HC1** | Hostile creatures (G12) | **With the combat module:** hostility, and fight behaviours (attack, guard, flee when hurt, call for help) on L-790's behaviours                                |

### The other gaps

| ID      | Question                    | Decision                                                                                                                                                        |
| ------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DG1** | Dungeon features (G6)       | **One epic after combat:** light and darkness, traps, secret doors, searching, and tools to build floors                                                        |
| **CR1** | Crafting and gathering (G7) | **The crafting module** covers alchemy, building machines and repair, with gathering by terrain and place; recipes as data; brewing and building take game time |
| **CA1** | A calendar (G8)             | **Timetables, NPC routines by hour, opening hours, and dated events.** No named days, months or seasons (the user's choice): days stay numbered                 |
| **SC1** | Content at scale (G9)       | **Templates:** an ordinary place uses a template of its kind and opens at once; Claude builds the notable ones. Designed with G1                                |
| **CW1** | A crew (G10)                | **Companions extend to a crew:** a size per world, roles (helm, tactical, engineering) and orders. Built with vehicles                                          |
| **QJ1** | Quests and a journal (G11)  | **Their own epic after Phase 8**                                                                                                                                |
| **OR1** | Planning                    | **G1 and G2 are designed now**, before L-710 is built; the rest get a design doc and gap sheet when each is next                                                |

---

## 5. Where each gap lands

| Gap                   | Home                                                                          | When                                                                |
| --------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| G1 Map levels         | **L-900 Map levels** (design: `map-levels.md`, to write), with G9's templates | Designed now; built with or just before L-710                       |
| G2 Vehicles           | **L-910 Vehicles** (design: `vehicles.md`, to write), with G10's crew         | Designed now; built after L-900 (order set with its design)         |
| G3 Effects            | **L-815 Effects**, in L-810                                                   | Phase 9, before combat                                              |
| G4 Advancement        | **L-830 Advancement**                                                         | Phase 9, after combat                                               |
| G5 Defeat, rests      | **L-820 Combat** (rests: a wait that restores)                                | Phase 9                                                             |
| G12 Hostile creatures | **L-820 Combat**                                                              | Phase 9                                                             |
| G6 Dungeon features   | **A dungeon epic** (light, traps, secrets, searching, floor tools)            | After combat; first after Phase 9, as sword and sorcery comes first |
| G7 Crafting           | **The crafting module**                                                       | Phase 9's module order                                              |
| G8 Calendar           | **A calendar epic**                                                           | Before the steampunk game's trains                                  |
| G11 Quests            | **A quests epic**                                                             | After Phase 8                                                       |
