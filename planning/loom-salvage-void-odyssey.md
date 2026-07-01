# Loom Salvage — Void Odyssey

Companion to `the-loom-design.md` §9 (Salvage table). Captures the two things worth
carrying out of Void Odyssey before its code is removed (L-004 / #289): the
journeys/ships static config as a seeded scenario draft, and the server-side
resolution-injection pattern as the precedent for the §5 ADJUDICATE/NARRATE stage.

This document is self-contained — it does not depend on the live VO app or its
source files remaining in the repository.

---

## 1. Scenario seed: journeys & ships

Source: `public/apps/void-odyssey/journeys.js` (`VO.JOURNEYS`, 8 entries) and
`public/apps/void-odyssey/ships.js` (`VO.SHIPS`, 13 entries), as they stood at the
time of Loom Phase 0.

This is a draft — the actual Canon schema (locations, factions, characters, lore)
is designed in L-103 / #296. What follows is the raw content reshaped just enough
to read as scenario material, parked for L-103 to map onto whatever schema it
settles on.

### 1.1 Journeys (campaign archetypes → candidate Loom scenarios)

Each journey bundles: a tone/danger profile, a starting region, starting
resources, narrative directives (voice/pacing rules for the narrator), an opening
hook, and which ships are available. In Loom terms, a journey is close to a
**scenario** — a starting configuration for a world, not the world itself.

| Journey | Tone | Danger | Starting region | Ships available |
|---|---|---|---|---|
| Frontier Explorer | wonder / discovery | low–moderate | The Outer Threshold — sparse frontier, anomalous signals | survey_vessel, scout_corvette, light_freighter |
| Smuggler's Run | gritty / morally gray | moderate | The Lattice — dense trade hubs, contested borders | light_freighter, blockade_runner, salvage_rig |
| Warpath | intense / tactical | high | The Shatter — active war zone, debris fields | gunship, corvette_warfit, carrier_escort |
| Deep Salvage | atmospheric horror | moderate–high | The Graveyard Drift — nebula full of derelicts | salvage_rig, light_freighter, scout_corvette |
| First Contact | cerebral / diplomatic | low combat, high stakes | The Threshold Array — diplomatic station at known-space edge | survey_vessel, diplomatic_cruiser, scout_corvette |
| The Long Haul | intimate / character-driven | variable | The Departure Point — one-way voyage across the galaxy | long_range_cruiser, light_freighter, survey_vessel |
| Ship's Company | intimate-and-massive | high (scoped to player's role) | The Armada Assembly — fleet staging before an offensive | fleet_carrier, line_battleship, heavy_cruiser |
| Custom Journey | flexible, narrator-adapted | variable | (player/AI defined) | any |

Full detail per journey (themes, starting resources, narrative directives, and
opening hook), preserved verbatim from the source config:

```
frontier_explorer:
  tagline: "Chart the unknown. Name the stars."
  themes: [exploration, science, first_contact, moral_dilemmas]
  startingResources: { fuelPercent: 90, hullPercent: 100, credits: low, bonusItems: [advanced_sensor_array] }
  narrativeDirectives:
    - Emphasize awe, scale, and the uncanny
    - Alien life should feel genuinely alien, not humanoid defaults
    - Favor environmental puzzles and first-contact diplomacy over combat
    - Let the player name discoveries (planets, species, anomalies)
    - Crew conversations lean philosophical — what does it mean to be the first?
  openingHook: >
    The player's ship detects an anomalous signal from an uncharted system. Their
    survey commission says investigate. Simple enough — except the signal appears
    to be artificial, and there are no known civilizations in this sector.

smugglers_run:
  tagline: "Every border is a business opportunity."
  themes: [trade, deception, reputation, rival_crews, authority_evasion, loyalty]
  startingResources: { fuelPercent: 75, hullPercent: 85, credits: moderate, bonusItems: [smugglers_hold] }
  narrativeDirectives:
    - Dialogue-heavy — NPCs should be colorful, scheming, and quotable
    - Every deal has a catch; every ally has an angle
    - Reputation matters more than firepower — burned bridges close routes
    - Law enforcement is an active threat, not background decoration
    - The crew is a found family held together by mutual self-interest (at first)
  openingHook: >
    The player owes a debt to a powerful broker. The first job is straightforward:
    transport a sealed container across a faction border. No questions. Easy money.
    The container hums faintly when no one is watching.

warpath:
  tagline: "They started it. You'll finish it."
  themes: [military_campaigns, tactical_decisions, crew_survival, enemy_intelligence, sacrifice, cost_of_command]
  startingResources: { fuelPercent: 60, hullPercent: 70, credits: low, bonusItems: [military_grade_weapons, priority_distress_beacon] }
  narrativeDirectives:
    - Combat should be visceral and consequential — no throwaway encounters
    - Tactical choices matter (flanking, retreating, boarding vs. bombardment)
    - Crew injuries and deaths are permanent; morale is fragile
    - The enemy should have coherent motivations, not be faceless evil
    - Quiet moments between battles carry emotional weight
  openingHook: >
    The player is a newly assigned captain on a warship that just lost half its
    crew in an ambush. Command says hold the sector. The enemy is regrouping. The
    surviving crew is shaken and looking to the new captain for a reason to keep
    fighting.

deep_salvage:
  tagline: "Dead ships tell the best stories."
  themes: [salvage_operations, mystery, resource_scarcity, crew_psychology, abandoned_technology]
  startingResources: { fuelPercent: 80, hullPercent: 90, credits: low, bonusItems: [cutting_torch, eva_kit, cargo_scanner] }
  narrativeDirectives:
    - Atmosphere is everything — silence, darkness, the creak of dead hulls
    - Derelicts should feel like crime scenes or archaeological digs, not empty loot boxes
    - Each wreck has a story: crew logs, damage patterns, cargo manifests that do not add up
    - Resource management is tight — every EVA costs air, every repair costs parts
    - Horror is slow-burn and psychological, not jump-scare gore
  openingHook: >
    The player's salvage crew picks up a faint automated distress signal from deep
    inside the Drift — deeper than anyone profitably goes. The signal is old. Very
    old. But the ship it's coming from shouldn't exist according to any known
    registry.

first_contact:
  tagline: "We are not alone. Now what?"
  themes: [diplomacy, xenolinguistics, cultural_exchange, ethical_dilemmas, communication_under_uncertainty, politics_of_first_contact]
  startingResources: { fuelPercent: 95, hullPercent: 100, credits: moderate, bonusItems: [universal_translator_array, diplomatic_protocols_database] }
  narrativeDirectives:
    - Alien civilizations should be deeply thought out — biology shapes culture shapes communication
    - Misunderstandings are the primary source of tension, not malice
    - The player's crew includes specialists (linguists, anthropologists, biologists) whose expertise matters
    - Political pressure from home adds a second layer of conflict — not everyone wants peace
    - Let the player develop actual protocols and approaches; reward creative diplomacy
  openingHook: >
    An alien vessel has appeared at the boundary of the system. It's not
    approaching, not retreating — just waiting. All attempts at communication have
    received responses, but no one can decode them yet. The player's ship has been
    assigned as the contact vessel. Approach carefully.

the_long_haul:
  tagline: "Fifteen thousand light-years from home. Better make it count."
  themes: [crew_relationships, resource_management, isolation, self_sufficiency, adaptation, what_home_means]
  startingResources: { fuelPercent: 100, hullPercent: 100, credits: moderate, bonusItems: [hydroponics_bay, long_range_comms_array, extended_life_support] }
  narrativeDirectives:
    - Crew development is the core — relationships deepen, conflict simmers, bonds form
    - Downtime scenes are as important as crisis scenes
    - The ship itself becomes a character — modifications, wear, personality
    - Each region of space the ship passes through should feel distinct
    - The overarching question: will you make it, and who will you be when you arrive?
  openingHook: >
    The player has accepted a contract to captain a long-range vessel on a one-way
    journey to establish contact with a distant colony that went silent decades
    ago. The trip will take years. The crew knows this. Departure is tomorrow.

ships_company:
  tagline: "One ship. A thousand souls. Your corner of it."
  themes: [chain_of_command, personal_heroism, departmental_loyalty, expertise_under_pressure, cost_of_war, finding_meaning_in_a_role]
  startingResources: { fuelPercent: 90, hullPercent: 95, credits: low, bonusItems: [role_kit] }
  roleOptions: [fighter_pilot, weapons_officer, helmsman, chief_engineer, ships_surgeon, intelligence_analyst, marine_sergeant]
  narrativeDirectives:
    - The player has a role — filter events, access, and conversations through that role's perspective
    - The commanding officer is an NPC with personality, agenda, and blind spots
    - Inter-departmental tension is a rich source of drama (pilots vs. engineers, intelligence vs. command)
    - The player can act outside their role, but the institution will react
    - Heroism is personal and local, even when the mission is fleet-scale
    - The ship should feel alive — a community of hundreds with culture, hierarchy, and gossip
  openingHook: >
    The player's posting orders finally came through. Their assignment: a capital
    warship whose last operation went badly enough that half the senior crew was
    rotated out. The crew that stayed doesn't talk about what happened. The new
    commanding officer doesn't ask. The player's job is to show up, prove their
    worth, and figure out why everyone is so careful not to say certain things
    aloud.

custom:
  tagline: "Your story, your rules."
  narrativeDirectives:
    - Adapt tone and danger level to match the story as it develops
```

### 1.2 Ships (13 hulls, grouped by which journeys they serve)

Each ship has: hull/shields/fuel/cargo/crew stats, starting weapons, starting
systems, and functional "features" (roleplay hooks like a cutting arm, a
hydroponics bay, a CIC). Stats are illustrative scale references, not a combat
ruleset to port directly — the Loom's own rules engine (§5 ADJUDICATE) would own
actual resolution math.

| Ship | Class | Role | Journeys | Hull / Shields / Fuel / Cargo / Crew |
|---|---|---|---|---|
| Light Freighter | Kestrel-class | independent workhorse | frontier_explorer, smugglers_run, deep_salvage, the_long_haul | 80 / 50 / 85 / 120 / 6 |
| Scout Corvette | Peregrine-class | fast recon | frontier_explorer, deep_salvage, first_contact | 60 / 70 / 75 / 40 / 4 |
| Salvage Rig | Tortoise-class | wreck stripping | smugglers_run, deep_salvage | 90 / 40 / 70 / 150 / 6 |
| Blockade Runner | Shadowfin-class | smuggling/evasion | smugglers_run | 55 / 65 / 80 / 70 / 5 |
| Corvette (War Refit) | Peregrine-class | strafing/tactical | warpath | 70 / 80 / 65 / 25 / 6 |
| Gunship | Mauler-class | blunt-force assault | warpath | 120 / 90 / 55 / 30 / 8 |
| Carrier Escort | Bulwark-class | drone force multiplier | warpath | 100 / 75 / 60 / 50 / 10 |
| Survey Vessel | Meridian-class | deep-space science | frontier_explorer, first_contact, the_long_haul | 75 / 55 / 90 / 60 / 8 |
| Diplomatic Cruiser | Envoy-class | embassy-in-a-hull | first_contact | 85 / 60 / 80 / 55 / 12 |
| Long-Range Cruiser | Horizon-class | generation-voyage | the_long_haul | 95 / 60 / 100 / 100 / 15 |
| Fleet Carrier | Ascendant-class | capital power projection | ships_company | 160 / 110 / 40 / 250 / 200 |
| Line Battleship | Ironwall-class | capital line-of-battle | ships_company | 200 / 150 / 35 / 120 / 120 |
| Heavy Cruiser | Resolution-class | independent-ops generalist | ships_company | 130 / 100 / 55 / 120 / 60 |

Weapons/systems/features are full, flavorful lists in the source config
(`public/apps/void-odyssey/ships.js`) — e.g. the Salvage Rig's cutting arm and
decontamination chamber, the Fleet Carrier's flight deck and CIC, the Diplomatic
Cruiser's configurable-atmosphere guest quarters. These read directly as
Loom-style location/feature flavor text and don't need reshaping — L-103 can pull
them in as-is when it defines the actual schema.

---

## 2. Resolution-injection pattern (the §5 ADJUDICATE precedent)

Source: `functions/index.js`, `voidOdysseyTurn` (callable, starts at line 1355),
specifically the dice-roll block (~1432–1450), prompt assembly (~1452–1468), and
the AI-response validation/clamping block (~1546–1625).

This is the mechanism the-loom-design.md §5 and §9 point to as already-proven:
**the server computes the authoritative outcome before the model narrates it, and
never trusts the model's own math.**

### 2.1 The flow, step by step

1. **Server rolls first.** Two d20s are generated server-side with
   `crypto.randomInt(1, 21)` before any AI call: an `actionRoll` and a
   `savingThrowRoll`. A difficulty modifier (`+5` … `-2`, keyed to the player's
   stored difficulty preference) is also computed server-side.
2. **Rolls are injected into the prompt as fixed facts, not requests.** The
   user message sent to Gemini literally states:
   > `Dice roll (server-generated, cannot be changed): Action d20: {roll}...`
   The model is told to produce a `rollInterpretation` (a modifier formula, a
   difficulty class, a narrative summary) that explains *why* the roll produced
   the outcome it did — but the model does not get to pick the outcome.
3. **The model responds with interpretation, not authority.** Gemini returns a
   `rollInterpretation` object (`totalModifier`, `difficultyClass`, `skipRoll`,
   `savingThrow`, etc.) alongside the narrative and any state mutations it
   proposes.
4. **The server re-derives the real result and ignores the model's claimed
   outcome.** Every numeric field from the model is clamped
   (`totalModifier` to ±20, `difficultyClass` to 1–30) and `finalResult` /
   `success` are recomputed server-side from the *server's own* dice values:
   `finalResult = actionRoll + totalModifier + difficultyModifier`, with natural
   20/1 forced to critical success/failure regardless of what the model said.
   `skipRoll` (the model's claim that a trivial action needs no roll) is only
   honored if the model's own stated difficulty class is ≤ 5 — another
   server-side check, not a model-trusted flag.
5. **Mutations commit only after this**, inside a Firestore transaction that
   re-reads current state, validates each mutation against fresh data, and
   applies them — the COMMIT stage of §5, downstream of adjudication.

### 2.2 Why this maps directly onto §5 ADJUDICATE/NARRATE

| §5 stage | VO equivalent |
|---|---|
| INTERPRET | The player's free-text `playerAction.input` plus `type`/`actionId` — already loosely structured, not full verb/targets/params parsing |
| ADJUDICATE | Server-generated dice + difficulty modifier, computed *before* the AI call; the AI's own `rollInterpretation` is clamped and recomputed from those server values, never trusted directly |
| NARRATE | Gemini receives the fixed dice/result as unchangeable facts and produces prose + a rollInterpretation gloss — it colors *how*, never *whether* |
| COMMIT | `db.runTransaction` re-reads fresh state, validates `stateMutations` against it, and applies them |

The one gap relative to the Loom's target design: VO calls the model once per
turn with dice already rolled, rather than running a separate INTERPRET pass
first. The Loom's fuller pipeline (fuzzy intent parse → deterministic
adjudication → narration as distinct stages) is a refinement of this same
core idea, not a different mechanism.

---

## 3. Status

- Journeys/ships content above is preserved independent of the live VO app.
- Resolution-injection pattern documented; no VO-specific code needs to remain
  live for either salvage item to be useful to L-103 (#296) or L-110 (#297).
- VO app code itself is untouched by this issue — removal is scoped to L-004
  (#289).
