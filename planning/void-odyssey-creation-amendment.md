# Expanded Game Creation — Journeys & Ships

> This replaces Section 8 (Game Creation Flow) in the main design document.
> It also adds new data structures to Section 4 (Data Architecture).

-----

## Section 8 (Replacement): Game Creation Flow

When starting a new campaign, the player moves through a guided wizard. The journey selection drives everything downstream — which ships are available, what kind of starting crew Claude generates, the opening star map seed, and the tone of Claude’s system prompt.

### 8.1 Creation Steps

```
1. CHOOSE YOUR JOURNEY
   Select a campaign archetype that defines the world, tone, and stakes.
   Each journey restricts which ships are available.

2. NAME YOUR CAPTAIN
   Player enters name and picks 2-3 traits from a curated list.
   Optionally writes a brief backstory (or Claude generates one
   tuned to the selected journey).

3. ASSIGN SKILLS
   Player distributes 10 skill points across 15 available skills.
   Each skill costs 1 point to acquire (+1 bonus), then follows
   a Fibonacci cost scale to level up (+2 costs 2 more, +3 costs
   3 more). Skills provide concrete modifiers in the AI's scenario
   formulas during dice rolls. The UI shows remaining points and
   previews the total cost for each upgrade.

4. CHOOSE YOUR SHIP
   Filtered to ships compatible with the selected journey.
   Each ship shows stat bars, a flavor description, and its
   starting loadout (weapons, systems, features).
   Player names the ship.

5. STARTING CREW
   Claude generates 2-3 crew members tailored to the journey
   and ship class. A smuggler's freighter gets different crew
   than a science vessel on a deep-space survey.
   Player can rename or adjust before confirming.

6. OPENING SCENE
   Claude generates the first narrative beat using the journey's
   opening prompt template, the player's ship/crew/traits, and
   the starting star map region.
   All starting data written to Firestore.
```

### 8.2 Journeys

Each journey is a campaign template that shapes the entire experience. Journeys are defined as static configuration in code (not Firestore) — new journeys are added by developers, not generated at runtime. This keeps the curated experience tight while making expansion straightforward.

#### Journey: Frontier Explorer

**ID:** `frontier_explorer`
**Tagline:** “Chart the unknown. Name the stars.”
**Tone:** Wonder, discovery, first contact. Danger exists but isn’t the focus — the void is vast and strange and worth exploring.
**Danger Level:** Low to moderate. Combat is rare but consequential.
**Primary Themes:** Exploration, science, alien encounters, cataloguing the unknown, moral dilemmas about interference.

**Narrative Direction for Claude:**

- Emphasize awe, scale, and the uncanny
- Alien life should feel genuinely alien, not humanoid defaults
- Favor environmental puzzles and first-contact diplomacy over combat
- Let the player name discoveries (planets, species, anomalies)
- Crew conversations lean philosophical — what does it mean to be the first?

**Starting Region:** The Outer Threshold — a sparsely charted frontier beyond the last trade routes. A handful of relay stations, vast unexplored systems, and strange signal sources.

**Opening Hook:** The player’s ship detects an anomalous signal from an uncharted system. Their survey commission says investigate. Simple enough — except the signal appears to be artificial, and there are no known civilizations in this sector.

**Available Ships:** `survey_vessel`, `scout_corvette`, `light_freighter`

**Starting Resources:**

- Fuel: 90%
- Hull: 100%
- Credits: Low (academic funding, not merchant wealth)
- Special: Advanced sensor array (pre-installed system)

-----

#### Journey: Smuggler’s Run

**ID:** `smugglers_run`
**Tagline:** “Every border is a business opportunity.”
**Tone:** Gritty, witty, morally gray. Think back-alley deals, corrupt officials, and loyalty bought by the job. Danger is constant but manageable if you’re clever.
**Danger Level:** Moderate. Combat happens but can usually be talked or bribed out of.
**Primary Themes:** Trade, deception, reputation management, rival crews, authority evasion, loyalty under pressure.

**Narrative Direction for Claude:**

- Dialogue-heavy — NPCs should be colorful, scheming, and quotable
- Every deal has a catch; every ally has an angle
- Reputation matters more than firepower — burned bridges close routes
- Law enforcement is an active threat, not background decoration
- The crew is a found family held together by mutual self-interest (at first)

**Starting Region:** The Lattice — a dense network of stations, trade hubs, and contested border zones between three rival factions. Lots of places to hide, lots of people to cross.

**Opening Hook:** The player owes a debt to a powerful broker. The first job is straightforward: transport a sealed container across a faction border. No questions. Easy money. The container hums faintly when no one is watching.

**Available Ships:** `light_freighter`, `blockade_runner`, `salvage_rig`

**Starting Resources:**

- Fuel: 75%
- Hull: 85% (ship has seen some things)
- Credits: Moderate (enough to operate, not enough to be comfortable)
- Special: Smuggler’s hold (hidden cargo compartment, pre-installed feature)

-----

#### Journey: Warpath

**ID:** `warpath`
**Tagline:** “They started it. You’ll finish it.”
**Tone:** Intense, tactical, high stakes. Military sci-fi with moral weight — war is hell, but sometimes it’s unavoidable. Crew bonds forged under fire.
**Danger Level:** High. Combat is frequent and lethal. Losses are real.
**Primary Themes:** Military campaigns, tactical decisions, crew survival, enemy intelligence, sacrifice, the cost of command.

**Narrative Direction for Claude:**

- Combat should be visceral and consequential — no throwaway encounters
- Tactical choices matter (flanking, retreating, boarding vs. bombardment)
- Crew injuries and deaths are permanent; morale is fragile
- The enemy should have coherent motivations, not be faceless evil
- Quiet moments between battles carry emotional weight

**Starting Region:** The Shatter — a contested war zone where two major factions have been grinding each other down for years. Debris fields, fortified stations, and no-man’s-space between the lines.

**Opening Hook:** The player is a newly assigned captain on a warship that just lost half its crew in an ambush. Command says hold the sector. The enemy is regrouping. The surviving crew is shaken and looking to the new captain for a reason to keep fighting.

**Available Ships:** `gunship`, `corvette_warfit`, `carrier_escort`

**Starting Resources:**

- Fuel: 60% (supply lines are thin)
- Hull: 70% (battle damage, partially repaired)
- Credits: Low (military requisition, not personal funds)
- Special: Military-grade weapons (pre-installed), Priority distress beacon

-----

#### Journey: Deep Salvage

**ID:** `deep_salvage`
**Tagline:** “Dead ships tell the best stories.”
**Tone:** Atmospheric horror meets treasure hunting. Creeping dread, claustrophobic derelicts, and the occasional genuine find that makes it all worthwhile. Think Alien meets Sunless Sea.
**Danger Level:** Moderate to high. Danger is environmental and unpredictable rather than military.
**Primary Themes:** Salvage operations, mystery, resource scarcity, crew psychology under isolation, ancient or abandoned technology, things that should have stayed buried.

**Narrative Direction for Claude:**

- Atmosphere is everything — silence, darkness, the creak of dead hulls
- Derelicts should feel like crime scenes or archaeological digs, not empty loot boxes
- Each wreck has a story: crew logs, damage patterns, cargo manifests that don’t add up
- Resource management is tight — every EVA costs air, every repair costs parts
- Horror is slow-burn and psychological, not jump-scare gore

**Starting Region:** The Graveyard Drift — a region where an ancient battle or catastrophe left hundreds of derelict ships and stations scattered across a nebula. Salvage crews pick through the edges. Nobody goes to the center.

**Opening Hook:** The player’s salvage crew picks up a faint automated distress signal from deep inside the Drift — deeper than anyone profitably goes. The signal is old. Very old. But the ship it’s coming from shouldn’t exist according to any known registry.

**Available Ships:** `salvage_rig`, `light_freighter`, `scout_corvette`

**Starting Resources:**

- Fuel: 80%
- Hull: 90%
- Credits: Low (salvage is speculative income)
- Special: Cutting torch & EVA kit (pre-installed), Cargo scanner

-----

#### Journey: First Contact

**ID:** `first_contact`
**Tagline:** “We are not alone. Now what?”
**Tone:** Cerebral, tense, diplomatic. The weight of representing your species in the face of the genuinely unknown. Heavy on communication puzzles, cultural misunderstanding, and the gap between intention and perception.
**Danger Level:** Low combat, high stakes. A wrong word could mean war; the right gesture could mean alliance.
**Primary Themes:** Diplomacy, xenolinguistics, cultural exchange, ethical dilemmas, communication under uncertainty, the politics of first contact.

**Narrative Direction for Claude:**

- Alien civilizations should be deeply thought out — biology shapes culture shapes communication
- Misunderstandings are the primary source of tension, not malice
- The player’s crew includes specialists (linguists, anthropologists, biologists) whose expertise matters
- Political pressure from home adds a second layer of conflict — not everyone wants peace
- Let the player develop actual protocols and approaches; reward creative diplomacy

**Starting Region:** The Threshold Array — a diplomatic station at the edge of known space, positioned near where the alien signals originate. A mix of military, scientific, and political personnel, all with competing agendas.

**Opening Hook:** An alien vessel has appeared at the boundary of the system. It’s not approaching, not retreating — just waiting. All attempts at communication have received responses, but no one can decode them yet. The player’s ship has been assigned as the contact vessel. Approach carefully.

**Available Ships:** `survey_vessel`, `diplomatic_cruiser`, `scout_corvette`

**Starting Resources:**

- Fuel: 95%
- Hull: 100%
- Credits: Moderate (government-funded mission)
- Special: Universal translator array (experimental, pre-installed), Diplomatic protocols database

-----

#### Journey: The Long Haul

**ID:** `the_long_haul`
**Tagline:** “Fifteen thousand light-years from home. Better make it count.”
**Tone:** Intimate, long-form, character-driven. A generation-style voyage where the journey is the story. Think Voyager meets The Long Way to a Small, Angry Planet. Crew dynamics evolve deeply over many turns.
**Danger Level:** Variable. Long stretches of calm punctuated by crises. Resource management is the constant tension.
**Primary Themes:** Crew relationships, resource management, isolation, self-sufficiency, adaptation, what “home” means when you can’t go back.

**Narrative Direction for Claude:**

- Crew development is the core — relationships deepen, conflict simmers, bonds form
- Downtime scenes are as important as crisis scenes
- The ship itself becomes a character — modifications, wear, personality
- Each region of space the ship passes through should feel distinct
- The overarching question: will you make it, and who will you be when you arrive?

**Starting Region:** The departure point — a well-known system. The destination is on the other side of the galaxy. The path between is uncharted.

**Opening Hook:** The player has accepted a contract (or been assigned, or volunteered — shaped by backstory) to captain a long-range vessel on a one-way journey to establish contact with a distant colony that went silent decades ago. The trip will take years. The crew knows this. Departure is tomorrow.

**Available Ships:** `long_range_cruiser`, `light_freighter`, `survey_vessel`

**Starting Resources:**

- Fuel: 100%
- Hull: 100%
- Credits: Moderate (expedition fund, but no resupply)
- Special: Hydroponics bay (pre-installed), Long-range comms array, Extended life support

-----

#### Journey: Ship's Company

**ID:** `ships_company`
**Tagline:** "One ship. A thousand souls. Your corner of it."
**Tone:** Intimate and massive simultaneously. You are one crew member among hundreds aboard a capital warship. The mission is fleet-scale; your experience of it is personal, tactical, and immediate. Think Das Boot meets Battlestar Galactica — the drama lives in the space between what command orders and what the crew endures.
**Danger Level:** High, but scoped. The ship is formidable; the player character is not invincible.
**Primary Themes:** Chain of command, personal heroism inside a larger institution, departmental loyalty vs. orders from above, expertise under pressure, what war costs at the human level, finding meaning in a role.

**Narrative Direction for Claude:**

- The player has a role — filter events, access, and conversations through that role's perspective
- The commanding officer is an NPC with personality, agenda, and blind spots
- Inter-departmental tension is a rich source of drama (pilots vs. engineers, intelligence vs. command)
- The player can act outside their role, but the institution will react
- Heroism is personal and local, even when the mission is fleet-scale
- The ship should feel alive — a community of hundreds with culture, hierarchy, and gossip

**Role Selection (chosen during creation — replaces ship-naming in Step 3, since the ship already has a name):**

| Role | Focus |
|------|-------|
| Fighter Pilot | Sortie missions, dogfights, recon runs — the ship is a launching pad, not the battlefield |
| Weapons Officer | Main battery control, targeting, the weight of who you fire on |
| Helmsman | Navigation, evasion, FTL execution — the ship obeys your hands |
| Chief Engineer | Damage control, systems, keeping the impossible running |
| Ship's Surgeon | Medical bay, triage, measuring every engagement in lives |
| Intelligence Analyst | Enemy movements, signals intercepts, knowing what command won't say |
| Marine Sergeant | Boarding actions, internal security, fighting in corridors |

**Creation Note:** In Step 3, the player selects which capital vessel they're assigned to from the available options, then picks their role within it. They do not name the ship — it arrives with a name, a history, and a reputation.

**Starting Region:** The Armada Assembly — a staging fleet in a secure system preparing for a major offensive. The player's vessel is freshly crewed and assigned to the fleet. Everyone is waiting for orders everyone already knows are coming.

**Opening Hook:** The player's posting orders finally came through. Their assignment: a capital warship whose last operation went badly enough that half the senior crew was rotated out. The crew that stayed doesn't talk about what happened. The new commanding officer doesn't ask. The player's job is to show up, prove their worth, and figure out why everyone is so careful not to say certain things aloud.

**Available Ships:** `fleet_carrier`, `line_battleship`, `heavy_cruiser`

**Starting Resources:**

- Fuel: 90% (fleet-maintained — the player doesn't manage this directly)
- Hull: 95% (recently refit after the crew rotation)
- Credits: Low (military pay — regular, modest, and resented)
- Special: Role kit (assigned at posting — sidearm and armor for marines, diagnostic tools for engineers, flight suit for pilots, etc.)

-----

### 8.3 Ships

Ships are defined as static configuration in code alongside journeys. Each ship has base stats, a starting loadout, and a flavor profile that Claude uses when describing the vessel. Ships are not interchangeable reskins — they meaningfully shape what the player can do.

#### Stat System & Minimum Crew

Stats use absolute values rather than percentages, establishing capability tiers that give Claude consistent narrative guidance for combat and operations without requiring arithmetic.

**Hull Tiers**

| Tier | Range | Character |
|------|-------|-----------|
| Light | 40–70 | Fast ships built to evade, not absorb |
| Standard | 70–100 | Workhorses and generalists |
| Heavy | 100–140 | Military vessels designed to take punishment |
| Capital | 140–200+ | Massive ships that end engagements by existing |

**Shield Tiers**

| Tier | Range | Character |
|------|-------|-----------|
| Minimal | 30–50 | Civilian-grade, better than nothing |
| Standard | 50–80 | Military deflectors, reliable under fire |
| Military | 80–120 | Warship barriers, rapid recharge |
| Capital | 120–160+ | Fleet-grade layered emitter arrays |

**Weapon Damage Guidance for Claude**

| Damage Class | Relative Impact |
|--------------|----------------|
| Light | Noticeable on light hulls, trivial on heavy — attrition and harassment |
| Moderate | Meaningful against standard hulls, uncomfortable for heavy |
| Heavy | Dangerous to standard and heavy hulls, annoying to capital |
| Capital | Designed for capital ships — devastating against anything smaller |

This gives Claude consistent narrative logic: a gunship shrugging off a light weapon hit feels right; the same hit on a scout corvette feels like a crisis.

**Minimum Crew**

Every ship requires a minimum operating crew below which systems degrade. As a guideline:

- **Solo-capable ships** (Scout Corvette, Blockade Runner): Can be operated by a single skilled crew member with meaningful limitations — heroic, not comfortable
- **Small ships** (2–6 capacity): Functional at 50% crew; below that, non-critical systems go dark
- **Medium ships** (7–15 capacity): Require roughly 40–50% crew for full operations; skeleton crew is dangerous
- **Capital ships** (50+ capacity): Below 50% crew, entire departments go offline — the ship becomes a liability

Claude treats minimum crew as a source of tension and narrative, not a hard mechanical cutoff.

-----

#### Ship: Light Freighter

**ID:** `light_freighter`
**Class Name:** Kestrel-class Light Freighter
**Description:** The workhorse of independent spacers. Not fast, not tough, not armed — but she carries cargo and she keeps flying. A ship for people who solve problems with resourcefulness, not firepower.

**Base Stats:**

|Stat         |Value|Notes                            |
|-------------|-----|---------------------------------|
|Hull         |80   |Decent, not built for combat     |
|Shields      |50   |Basic deflectors                 |
|Fuel         |85   |Good range for a freighter       |
|Cargo Max    |120  |High — this is the ship’s purpose|
|Crew Capacity|6    |Compact but livable              |

**Starting Weapons:**

- Light Point Defense Turret (type: energy, damage: light, notes: “More for debris than dogfights”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Basic Sensors (status: operational)
- Cargo Management System (status: operational)
- Communications Array (status: operational)

**Starting Features:**

- Modular Cargo Bay (description: “Configurable hold — can be sectioned for different cargo types or converted for passengers”)

**Available In:** `frontier_explorer`, `smugglers_run`, `deep_salvage`, `the_long_haul`

-----

#### Ship: Scout Corvette

**ID:** `scout_corvette`
**Class Name:** Peregrine-class Scout Corvette
**Description:** Fast, agile, and fitted with the best sensors money can buy. Built for getting in, seeing everything, and getting out before anyone notices. Light on cargo and crew space — this is a ship that travels light.

**Base Stats:**

|Stat         |Value|Notes                            |
|-------------|-----|---------------------------------|
|Hull         |60   |Light frame, speed over armor    |
|Shields      |70   |Good deflectors for evasion      |
|Fuel         |75   |Moderate — burns hot when running|
|Cargo Max    |40   |Minimal storage                  |
|Crew Capacity|4    |Tight quarters                   |

**Starting Weapons:**

- Twin Pulse Lasers (type: energy, damage: moderate, notes: “Fast-tracking, good for small targets”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Advanced Sensor Array (status: operational, notes: “Long-range scanning, anomaly detection”)
- Stealth Coating (status: operational, notes: “Reduces sensor signature when running silent”)
- Communications Array (status: operational)

**Starting Features:**

- Observation Deck (description: “A reinforced viewport bay with integrated scanning displays — part cockpit, part observatory”)

**Available In:** `frontier_explorer`, `deep_salvage`, `first_contact`

-----

#### Ship: Gunship

**ID:** `gunship`
**Class Name:** Mauler-class Assault Gunship
**Description:** A blunt instrument with engines. Heavy armor, heavy guns, and the subtlety of a brick through a window. She won’t win any races, but she’ll be the last ship standing when the shooting stops.

**Base Stats:**

|Stat         |Value|Notes                         |
|-------------|-----|------------------------------|
|Hull         |120  |Heavy armor plating           |
|Shields      |90   |Military-grade barriers       |
|Fuel         |55   |Thirsty engines               |
|Cargo Max    |30   |Ammo and armor eat the space  |
|Crew Capacity|8    |Needs hands for all those guns|

**Starting Weapons:**

- Twin Plasma Cannons (type: energy, damage: heavy, notes: “Main batteries, devastating at close range”)
- Missile Rack (type: missile, damage: heavy, notes: “Limited magazine, high impact”)
- Point Defense Grid (type: energy, damage: light, notes: “Automated anti-missile and anti-fighter screen”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Military Sensors (status: operational, notes: “Tactical targeting, threat assessment”)
- Damage Control System (status: operational, notes: “Automated hull breach response”)
- Communications Array (status: operational)

**Starting Features:**

- Armory (description: “Weapons locker and tactical planning room — boarding actions launch from here”)
- Reinforced Bridge (description: “Blast-shielded command deck with redundant controls”)

**Available In:** `warpath`

-----

#### Ship: Salvage Rig

**ID:** `salvage_rig`
**Class Name:** Tortoise-class Salvage Platform
**Description:** Ugly, slow, and indispensable. The Tortoise is a mobile workshop built around a massive articulated cutting arm and a cavernous cargo bay. She strips wrecks like a surgeon and hauls the bones home.

**Base Stats:**

|Stat         |Value|Notes                             |
|-------------|-----|----------------------------------|
|Hull         |90   |Built tough for debris fields     |
|Shields      |40   |Minimal — relies on armor         |
|Fuel         |70   |Efficient but slow                |
|Cargo Max    |150  |The largest hold of any ship class|
|Crew Capacity|6    |Plus room for salvage drones      |

**Starting Weapons:**

- Industrial Cutting Laser (type: energy, damage: moderate, notes: “Meant for bulkheads, works on hostiles in a pinch”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Cargo Scanner (status: operational, notes: “Identifies valuable materials and hazards in wrecks”)
- EVA Deployment System (status: operational, notes: “Airlock staging for spacewalk operations”)
- Communications Array (status: operational)

**Starting Features:**

- Cutting Arm (description: “Articulated industrial arm with plasma torch — can breach hulls, cut structural members, and extract components”)
- Drone Bay (description: “Houses 2 remote salvage drones for hazardous retrieval operations”)
- Decontamination Chamber (description: “Scans and cleans salvaged materials before they enter the main hold”)

**Available In:** `smugglers_run`, `deep_salvage`

-----

#### Ship: Blockade Runner

**ID:** `blockade_runner`
**Class Name:** Shadowfin-class Blockade Runner
**Description:** A smuggler’s dream — fast enough to outrun patrol ships, quiet enough to slip past sensor nets, and just armed enough to discourage anyone who gets too close. The hidden compartments are the real feature.

**Base Stats:**

|Stat         |Value|Notes                                |
|-------------|-----|-------------------------------------|
|Hull         |55   |Light frame, built for speed not hits|
|Shields      |65   |Tuned for quick recharge             |
|Fuel         |80   |Efficient at high speed              |
|Cargo Max    |70   |Moderate — plus hidden compartments  |
|Crew Capacity|5    |Small, trusted crew                  |

**Starting Weapons:**

- Rear-Facing Flak Cannon (type: kinetic, damage: moderate, notes: “Discourages pursuit, useless in a head-on fight”)
- EMP Disruptor (type: energy, damage: light, notes: “Disables electronics — great for escapes, not for kills”)

**Starting Systems:**

- FTL Drive (status: operational, notes: “Modified for rapid spin-up — emergency jumps possible”)
- Life Support (status: operational)
- Sensor Spoofing Suite (status: operational, notes: “Generates false sensor signatures, masks cargo scans”)
- Communications Array (status: operational)
- Signal Interceptor (status: operational, notes: “Monitors local comms traffic for patrol movements”)

**Starting Features:**

- Smuggler’s Hold (description: “Shielded hidden compartments — invisible to standard cargo scans. Holds ~20 units of contraband cargo.”)
- Rapid Docking Clamps (description: “Modified docking system for fast attach/detach — 30 seconds flat”)

**Available In:** `smugglers_run`

-----

#### Ship: Corvette (War-Fit)

**ID:** `corvette_warfit`
**Class Name:** Peregrine-class Corvette (War Refit)
**Description:** The scout corvette’s bigger, meaner sibling. Same agile frame, but the sensor arrays have been swapped for weapon mounts and the observation deck is now a tactical operations center. She’s fast, she hits hard, but she can’t take a punch.

**Base Stats:**

|Stat         |Value|Notes                                |
|-------------|-----|-------------------------------------|
|Hull         |70   |Light frame with bolt-on armor       |
|Shields      |80   |Military upgrade from the scout model|
|Fuel         |65   |Burns fast in combat maneuvers       |
|Cargo Max    |25   |Almost entirely weapons and crew     |
|Crew Capacity|6    |Lean fighting crew                   |

**Starting Weapons:**

- Rapid Pulse Laser Array (type: energy, damage: moderate, notes: “High rate of fire, excellent for strafing runs”)
- Torpedo Launcher (type: missile, damage: heavy, notes: “Limited torpedoes, each one counts”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Tactical Sensors (status: operational, notes: “Target acquisition, weak-point analysis”)
- Electronic Warfare Suite (status: operational, notes: “Jamming and countermeasures”)
- Communications Array (status: operational)

**Starting Features:**

- Tactical Operations Center (description: “Compact command room with holographic battle display — coordinates multi-target engagements”)

**Available In:** `warpath`

-----

#### Ship: Carrier Escort

**ID:** `carrier_escort`
**Class Name:** Bulwark-class Escort Carrier
**Description:** Not a true carrier — she doesn’t launch fighters. But the Bulwark carries a squadron of combat drones and has the command infrastructure to coordinate them. A force multiplier for a captain who thinks three moves ahead.

**Base Stats:**

|Stat         |Value|Notes                              |
|-------------|-----|-----------------------------------|
|Hull         |100  |Solid construction, not heavy armor|
|Shields      |75   |Adequate for a support vessel      |
|Fuel         |60   |Drones eat power                   |
|Cargo Max    |50   |Moderate — drone bay takes priority|
|Crew Capacity|10   |Largest crew complement            |

**Starting Weapons:**

- Broadside Autocannons (type: kinetic, damage: moderate, notes: “Port and starboard mounted, good coverage”)
- Combat Drone Squadron (type: special, damage: varies, notes: “4 autonomous combat drones — can attack, screen, or scout”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational)
- Drone Command Network (status: operational, notes: “AI-assisted coordination of up to 8 drones”)
- Standard Sensors (status: operational)
- Communications Array (status: operational)
- Medical Bay (status: operational, notes: “Full surgical suite — critical with a crew this size”)

**Starting Features:**

- Drone Bay (description: “Automated launch and recovery system for combat drones. Houses 4 drones with maintenance berths for field repair.”)
- War Room (description: “Strategic planning space with long-range communication equipment. Can coordinate with allied vessels.”)

**Available In:** `warpath`

-----

#### Ship: Survey Vessel

**ID:** `survey_vessel`
**Class Name:** Meridian-class Survey Vessel
**Description:** A floating laboratory with engines. The Meridian is designed for extended deep-space missions — well-equipped, comfortable (by spacer standards), and packed with every scanner and probe known to science. She’s not winning any fights, but she’ll find things no one else can.

**Base Stats:**

|Stat         |Value|Notes                             |
|-------------|-----|----------------------------------|
|Hull         |75   |Standard civilian construction    |
|Shields      |55   |Basic protection                  |
|Fuel         |90   |Exceptional range for long surveys|
|Cargo Max    |60   |Sample storage and probe inventory|
|Crew Capacity|8    |Scientists need space             |

**Starting Weapons:**

- Mining Laser (type: energy, damage: light, notes: “Asteroid sampling tool. Technically a weapon if you’re desperate.”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational, notes: “Extended-duration rated — recycling systems for long voyages”)
- Deep Space Sensor Array (status: operational, notes: “The best scanning package available — gravitational, electromagnetic, quantum”)
- Probe Launcher (status: operational, notes: “Deploys autonomous survey probes into systems before arrival”)
- Laboratory Network (status: operational, notes: “Interconnected lab modules for biological, chemical, and physical analysis”)
- Communications Array (status: operational, notes: “Long-range, high-bandwidth for transmitting research data home”)

**Starting Features:**

- Science Lab (description: “Multi-discipline research laboratory. Can analyze alien biology, unknown materials, and anomalous energy signatures.”)
- Probe Bay (description: “Carries 6 deployable survey probes for remote system scanning”)

**Available In:** `frontier_explorer`, `first_contact`, `the_long_haul`

-----

#### Ship: Diplomatic Cruiser

**ID:** `diplomatic_cruiser`
**Class Name:** Envoy-class Diplomatic Cruiser
**Description:** More embassy than spaceship. The Envoy is designed to impress, accommodate, and communicate — with meeting halls, translation suites, and quarters comfortable enough for species with very different ideas about comfort. Lightly armed because showing up with guns sends the wrong message.

**Base Stats:**

|Stat         |Value|Notes                                       |
|-------------|-----|--------------------------------------------|
|Hull         |85   |Solid, reassuring construction              |
|Shields      |60   |Enough to survive misunderstandings         |
|Fuel         |80   |Good range for diplomatic missions          |
|Cargo Max    |55   |Gifts, supplies, cultural exchange materials|
|Crew Capacity|12   |Diplomats, translators, aides, security     |

**Starting Weapons:**

- Deterrent Laser (type: energy, damage: light, notes: “Visible but non-threatening. A polite reminder.”)

**Starting Systems:**

- FTL Drive (status: operational)
- Life Support (status: operational, notes: “Configurable atmospheric zones — can accommodate non-standard biology”)
- Universal Translator Array (status: operational, notes: “Experimental real-time translation — imperfect but invaluable”)
- Diplomatic Communications Suite (status: operational, notes: “Encrypted multi-channel comms with real-time conference capability”)
- Standard Sensors (status: operational)

**Starting Features:**

- Conference Hall (description: “Modular meeting space that can be reconfigured for different species’ physical needs. Holographic display for presentations and cultural demonstrations.”)
- Xenobiology Suite (description: “Medical and biological analysis lab focused on understanding alien physiology — essential for hospitality and safety protocols”)
- Guest Quarters (description: “Four configurable guest suites with adjustable gravity, atmosphere, temperature, and lighting”)

**Available In:** `first_contact`

-----

#### Ship: Long-Range Cruiser

**ID:** `long_range_cruiser`
**Class Name:** Horizon-class Long-Range Cruiser
**Description:** Built for the journey, not the destination. The Horizon is self-sustaining — hydroponics, water recycling, fabrication workshops, and the kind of crew quarters that acknowledge people will be living here for years, not weeks. She’s a small town with an FTL drive.

**Base Stats:**

|Stat         |Value|Notes                                             |
|-------------|-----|--------------------------------------------------|
|Hull         |95   |Durable, designed for years of micrometeorite wear|
|Shields      |60   |Standard civilian grade                           |
|Fuel         |100  |Maximum range, efficiency-optimized engines       |
|Cargo Max    |100  |Expedition supplies and fabrication feedstock     |
|Crew Capacity|15   |Largest crew — this is a community                |

**Starting Weapons:**

- Point Defense Turret (type: energy, damage: light, notes: “Debris and asteroid defense”)
- Pulse Cannon (type: energy, damage: moderate, notes: “Enough to discourage, not enough to conquer”)

**Starting Systems:**

- FTL Drive (status: operational, notes: “Efficiency-rated for sustained long-range travel”)
- Life Support (status: operational, notes: “Closed-loop recycling — air, water, waste”)
- Standard Sensors (status: operational)
- Communications Array (status: operational, notes: “Long-range tightbeam for periodic check-ins with home”)
- Fabrication System (status: operational, notes: “3D printing and basic manufacturing from raw materials”)

**Starting Features:**

- Hydroponics Bay (description: “Food production system — grows enough to supplement rations for the full crew. Fresh vegetables are a morale miracle.”)
- Workshop (description: “Machine shop and fabrication lab. Can manufacture replacement parts, tools, and basic equipment from raw materials.”)
- Rec Commons (description: “Shared living space with a galley, entertainment, and exercise equipment. The heart of the ship’s social life.”)
- Medical Bay (description: “Full surgical and recovery suite. Long voyages mean you can’t just limp to the nearest station.”)

**Available In:** `the_long_haul`

-----

#### Ship: Fleet Carrier

**ID:** `fleet_carrier`
**Class Name:** Ascendant-class Fleet Carrier
**Description:** A city with engines. The Ascendant carries three full fighter squadrons, a marine complement, and hundreds of crew across dedicated departments. She doesn't win fights by being tough — she wins by projecting power across a battlespace simultaneously. No single crew member understands everything happening aboard her at once.

**Base Stats:**

|Stat         |Value|Notes                                           |
|-------------|-----|------------------------------------------------|
|Hull         |160  |Capital-grade construction                      |
|Shields      |110  |Fleet-grade barrier arrays                      |
|Fuel         |40   |Enormous engines drink accordingly              |
|Cargo Max    |250  |Fighter munitions, fuel reserves, crew supplies |
|Crew Capacity|200  |Multiple departments across a small city's worth|

**Starting Weapons:**

- Point Defense Network (type: energy, damage: light, notes: "Continuous automated coverage — destroys incoming missiles and fighters at close range")
- Broadside Batteries (type: kinetic, damage: moderate, notes: "Port and starboard mounted — not the ship's primary offensive arm")
- Fighter Wing (type: special, damage: varies, notes: "Three squadrons of eight fighters — the ship's real teeth. Fighters operate independently but return to her for fuel, repair, and orders.")

**Starting Systems:**

- FTL Drive (status: operational, notes: "Capital-scale — requires 8-minute spool time; planned jumps only")
- Life Support (status: operational, notes: "City-grade redundant loops — six independent systems")
- Fleet Command Network (status: operational, notes: "Coordinates with up to 40 allied vessels simultaneously")
- Flight Operations System (status: operational, notes: "Manages launch cycles, recovery, fighter tracking, and bay assignments for all three squadrons")
- Tactical Intelligence Suite (status: operational, notes: "Strategic overview, fleet-scale threat assessment")
- Medical Complex (status: operational, notes: "Full hospital — surgery, trauma, psychiatric services. Not a bay — a complex.")
- Communications Array (status: operational, notes: "Fleet broadcast, secure command channels, civilian-band intercept")

**Starting Features:**

- Flight Deck (description: "Three active runways and catapult systems. Recovery nets and arrestor cables on the aft end. Organized chaos on launch day, precision mechanics every other hour.")
- CIC — Combat Information Center (description: "The ship's nerve center: holographic tactical displays, all department heads at stations, the commanding officer at the center of it all.")
- Hangar Bay (description: "Fighter storage, arming, and maintenance across two decks. The pilots live here between sorties — bunks, lockers, a coffee machine that always burns it.")
- Marine Barracks (description: "Full armory, training simulators, briefing rooms, and the particular quiet of soldiers waiting for work.")

**Available In:** `ships_company`

-----

#### Ship: Line Battleship

**ID:** `line_battleship`
**Class Name:** Ironwall-class Line Battleship
**Description:** The hammer of the fleet. The Ironwall is built to absorb punishment and deliver it at range. Heavy armor, layered shields, and guns that can crack open other capital ships at extreme distance. She's slow, she knows it, and she doesn't care. Everything about the Ironwall says: come to me.

**Base Stats:**

|Stat         |Value|Notes                                             |
|-------------|-----|--------------------------------------------------|
|Hull         |200  |Maximum capital armor — the highest of any vessel |
|Shields      |150  |Multiple layered emitter arrays                   |
|Fuel         |35   |Enormous reactors drink deeply                    |
|Cargo Max    |120  |Mostly munitions inventory for the main batteries |
|Crew Capacity|120  |Gun teams, engineering, command, and support staff|

**Starting Weapons:**

- Main Battery (type: kinetic, damage: capital, notes: "Three twin-mount heavy railguns — designed for capital ship engagements at extreme range. Each gun has a crew of twelve.")
- Secondary Batteries (type: energy, damage: heavy, notes: "Anti-cruiser batteries port and starboard — each handled by a dedicated weapons team")
- Point Defense Grid (type: energy, damage: light, notes: "Automated close-range protection against missiles and strike craft")

**Starting Systems:**

- FTL Drive (status: operational, notes: "Capital-scale — slow spool, not designed for emergency jumps")
- Life Support (status: operational, notes: "Redundant capital-grade — multiple independent zones")
- Fire Control System (status: operational, notes: "Targeting coordination across all batteries — integrates sensor data for firing solutions at range")
- Damage Control Network (status: operational, notes: "Ship-wide automated breach response, fire suppression, bulkhead sealing, repair party routing")
- Tactical Sensors (status: operational, notes: "Long-range detection optimized for fleet engagements")
- Communications Array (status: operational)

**Starting Features:**

- Main Battery Control (description: "The gun deck — a cathedral of machinery. The railguns run the full length of the ship. Each crew team has been running the same gun for years.")
- Armored Bridge (description: "Buried behind three meters of reinforced hull in the superstructure's core. The commanding officer fights from here. It never sees natural light.")
- Damage Control Center (description: "Engineering's headquarters: real-time hull integrity maps, repair party coordination, emergency power routing. The people who keep the ship alive work here.")

**Available In:** `ships_company`

-----

#### Ship: Heavy Cruiser

**ID:** `heavy_cruiser`
**Class Name:** Resolution-class Heavy Cruiser
**Description:** The fleet's versatile officer. Large enough to project real power, independent enough to operate without a fleet, and adaptable enough to fill almost any mission role. The Resolution is the ship command sends when they need the job done without committing a battleship — which means she ends up in more interesting situations than either.

**Base Stats:**

|Stat         |Value|Notes                                            |
|-------------|-----|-------------------------------------------------|
|Hull         |130  |Heavy frame — substantial without capital plating|
|Shields      |100  |Military-grade with good regeneration rates      |
|Fuel         |55   |Efficient for its class — built for independent ops|
|Cargo Max    |120  |Configurable for the mission                     |
|Crew Capacity|60   |Full complement across all departments           |

**Starting Weapons:**

- Heavy Gun Batteries (type: energy/kinetic, damage: heavy, notes: "Main offensive armament — effective against cruisers and below, uncomfortable for capital ships")
- Torpedo Tubes (type: missile, damage: heavy, notes: "Six-tube bow array — the answer when the target is bigger than you")
- Point Defense Turrets (type: energy, damage: light, notes: "Anti-fighter and anti-missile coverage")

**Starting Systems:**

- FTL Drive (status: operational, notes: "Military-rated, faster spool than capital ships — emergency jumps possible")
- Life Support (status: operational, notes: "Fully rated for extended independent operations")
- Combat Sensors (status: operational, notes: "Multi-mode — surface, deep space, and signals intelligence")
- Electronic Warfare Suite (status: operational, notes: "Jamming, spoofing, and active countermeasures")
- Communications Array (status: operational, notes: "Fleet integration plus independent encrypted channels for detached operations")
- Medical Bay (status: operational, notes: "Full surgical suite — independent operations mean you can't limp to a station")

**Starting Features:**

- Operations Center (description: "Decentralized command — dedicated stations for navigation, weapons, intelligence, and comms. Designed for independent operations where there's no fleet to call.")
- Marine Detachment Quarters (description: "Barracks and armory for a platoon-strength force — boarding actions, security operations, landing missions.")

**Available In:** `ships_company`

-----

### 8.4 Journey → Ship Mapping (Reference)

|Journey          |Available Ships                                       |
|-----------------|------------------------------------------------------|
|Frontier Explorer|Survey Vessel, Scout Corvette, Light Freighter        |
|Smuggler’s Run   |Light Freighter, Blockade Runner, Salvage Rig         |
|Warpath          |Gunship, Corvette (War-Fit), Carrier Escort           |
|Deep Salvage     |Salvage Rig, Light Freighter, Scout Corvette          |
|First Contact    |Survey Vessel, Diplomatic Cruiser, Scout Corvette     |
|The Long Haul    |Long-Range Cruiser, Light Freighter, Survey Vessel    |
|Ship’s Company   |Fleet Carrier, Line Battleship, Heavy Cruiser         |

Each journey offers exactly three ship choices — enough variety to support different playstyles within the journey’s theme, but not so many that the choice becomes overwhelming.

**Design Principle:** Some ships appear across multiple journeys (Light Freighter in 4, Scout Corvette in 3, Survey Vessel in 3). These are versatile generalist ships. Others are journey-exclusive specialists (Gunship, Blockade Runner, Diplomatic Cruiser, Long-Range Cruiser, and all three capital ships). This creates a natural tier: the specialist ships are exciting because you only see them in their journey.

**Ship’s Company Note:** The three capital ships in Ship’s Company are also role-filtered at presentation time — a player choosing Fighter Pilot will find the Fleet Carrier the most relevant assignment; a Helmsman might gravitate toward the Heavy Cruiser. The choice still belongs to the player, but the UI can surface the affinity.

-----

### 8.5 Data Structures

#### Journey Configuration (in code, not Firestore)

```javascript
// Defined in state.js or a dedicated journeys.js config module
const JOURNEYS = {
  frontier_explorer: {
    id: 'frontier_explorer',
    name: 'Frontier Explorer',
    tagline: 'Chart the unknown. Name the stars.',
    icon: '🔭',
    description: 'Explore uncharted space, encounter alien life, and push the boundaries of known space. Discovery-focused with moderate danger.',
    tone: 'wonder_discovery',
    dangerLevel: 'low_moderate',
    themes: ['exploration', 'science', 'first_contact', 'moral_dilemmas'],
    availableShips: ['survey_vessel', 'scout_corvette', 'light_freighter'],
    startingRegion: {
      name: 'The Outer Threshold',
      description: 'A sparsely charted frontier beyond the last trade routes...',
      tags: ['frontier', 'unexplored', 'relay_stations', 'anomalies'],
    },
    startingResources: {
      fuelPercent: 90,
      hullPercent: 100,
      credits: 'low',
      bonusItems: ['advanced_sensor_array'],
    },
    narrativeDirectives: [
      'Emphasize awe, scale, and the uncanny',
      'Alien life should feel genuinely alien',
      'Favor environmental puzzles and diplomacy over combat',
      'Let the player name discoveries',
    ],
    openingHookTemplate: 'Your ship detects an anomalous signal from an uncharted system...',
    order: 1,
  },
  // ... additional journeys follow the same shape
};
```

#### Ship Configuration (in code, not Firestore)

```javascript
// Defined in state.js or a dedicated ships.js config module
const SHIPS = {
  light_freighter: {
    id: 'light_freighter',
    className: 'Kestrel-class Light Freighter',
    icon: '🚀',
    description: 'The workhorse of independent spacers...',
    stats: {
      hull: 80,
      hullMax: 80,
      shields: 50,
      shieldsMax: 50,
      fuel: 85,
      cargoMax: 120,
      crewCapacity: 6,
    },
    startingWeapons: [
      {
        id: 'wpn_point_defense',
        name: 'Light Point Defense Turret',
        type: 'energy',
        damage: 'light',
        status: 'operational',
        notes: 'More for debris than dogfights',
      },
    ],
    startingSystems: [
      { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
      { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
      { id: 'sys_sensors', name: 'Basic Sensors', status: 'operational', notes: null },
      { id: 'sys_cargo', name: 'Cargo Management System', status: 'operational', notes: null },
      { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
    ],
    startingFeatures: [
      {
        id: 'feat_cargo_bay',
        name: 'Modular Cargo Bay',
        description: 'Configurable hold — can be sectioned for different cargo types or converted for passengers',
        functional: true,
      },
    ],
    availableInJourneys: [
      'frontier_explorer', 'smugglers_run', 'deep_salvage', 'the_long_haul'
    ],
    order: 1,
  },
  // ... additional ships follow the same shape
};
```

#### Game Document Updates

The root game document (Section 4.2 in main doc) gains a `journey` field:

```
{
  // ... existing fields ...

  // --- Journey (set at creation, immutable) ---
  journey: {
    id: string,              // "frontier_explorer"
    name: string,            // "Frontier Explorer"
    tone: string,            // "wonder_discovery"
    dangerLevel: string,     // "low_moderate"
    themes: string[],        // Denormalized for context assembly
    narrativeDirectives: string[],  // Passed to Claude system prompt each turn
  },
}
```

This is denormalized from the code config into the game document at creation time so that the context assembly engine doesn’t need to reference the config — everything Claude needs is in the game state.

#### Player Character (stored on game document)

Unlike the ship — which can be damaged, lost, or replaced — the player character persists as the campaign’s constant. Their stats, condition, and history travel with them regardless of what vessel they’re aboard or whether they still command one.

```javascript
// Added to root game document under ‘character’
character: {
  name: string,                  // Set in Step 2

  // ‘captain’ for most journeys.
  // For ships_company: ‘fighter_pilot’ | ‘weapons_officer’ | ‘helmsman’ |
  //   ‘chief_engineer’ | ‘ships_surgeon’ | ‘intel_analyst’ | ‘marine_sergeant’
  role: string,

  traits: string[],              // 2–3 selected in Step 2 (e.g. ‘stubborn’, ‘loyal’, ‘reckless’)
  backstory: string,             // Player-written or Claude-generated in Step 2

  // Stats — set at creation from traits/journey, can evolve over the campaign.
  // Base value is 50; traits adjust up or down. Not roll tables — narrative anchors.
  stats: {
    physique: number,            // 0–100: combat capability, manual endurance, injury resistance
    agility: number,             // 0–100: speed, evasion, piloting, quick reactions
    intellect: number,           // 0–100: problem-solving, technical tasks, reading situations
    presence: number,            // 0–100: command authority, persuasion, diplomacy, intimidation
  },

  // Condition — updated by Claude each turn as events warrant
  condition: {
    health: number,              // 0–100; reaching 0 is incapacitation (death if Claude narrates it)
    healthMax: 100,
    stress: number,              // 0–100; high stress degrades presence and intellect narratively
    statusEffects: string[],     // e.g. [‘injured’, ‘exhausted’, ‘grieving’, ‘inspired’, ‘wanted’]
  },

  // Persistent narrative memory — Claude appends as the campaign develops
  notes: string,                 // Injuries, relationships, past decisions — Claude’s running record
},
```

**Design notes:**

- **Stats are narrative anchors, not roll tables.** Claude references them when describing how the character handles a challenge — high physique handles a brawl differently than high intellect or presence. They inform narrative flavor but do not directly modify dice rolls.
- **Traits inform starting stats.** A "reckless" trait might mean higher agility but lower presence; "cautious" might mean lower physique but higher intellect. Claude allocates adjustments from a base of 50 — no rigid formula, just a consistent signal.
- **Skills are the mechanical layer.** While stats shape narrative tone, skills provide concrete +1 to +3 modifiers in the AI's scenario formulas. See Section 8.6 for the full skills system.
- **Stress is a second condition track.** A character can be physically fine and psychologically fraying. Claude accumulates stress through events and lets it ease through rest, crew interaction, and downtime — not a mechanic, a narrative texture.
- **`notes` is Claude’s memory for the character.** Injuries that healed but left marks, relationships formed or broken, decisions that followed the character home — this field grounds continuity across a long campaign.
- **For Ship’s Company**, `role` becomes the primary narrative lens. A marine and an engineer aboard the same ship encounter different problems, have access to different spaces, and carry different kinds of knowledge. Claude should treat the role as a filter on everything the character sees and does.

-----

### 8.6 Captain Skills

Skills are the player's primary mechanical expression during character creation. While stats (physique, agility, intellect, presence) shape how Claude narrates the character, skills provide concrete numerical modifiers that the AI factors into its scenario formulas when resolving dice rolls.

#### Skill Point Economy

The player receives **10 skill points** at creation to distribute across 15 available skills.

**Cost per level (Fibonacci progression):**

| Level | Bonus | Upgrade Cost | Total Investment |
|-------|-------|-------------|-----------------|
| 0 | +0 | — | 0 points |
| 1 | +1 | 1 point | 1 point |
| 2 | +2 | 2 points | 3 points |
| 3 | +3 | 3 points | 6 points |

Each level grants exactly +1 more to the roll modifier, but the cost to reach the next level increases. A +3 skill costs 6 total points — more than half the budget — forcing hard choices about depth vs. breadth.

**Example builds with 10 points:**

| Build Style | Allocation | Character |
|-------------|-----------|-----------|
| Specialist | One skill at +3 (6), one at +2 (3), one at +1 (1) | Master of one domain, competent in a second |
| Generalist | Ten skills at +1 (10) | Broad but shallow — a little of everything |
| Dual Focus | Two skills at +2 (6), four at +1 (4) | Two strong suits with supporting breadth |
| Focused Expert | One skill at +3 (6), four at +1 (4) | Deep specialist with basic coverage |

No build can cover everything. A player who maxes Piloting and Gunnery has nothing left for Diplomacy or Medicine. This is the point — the captain's skill profile shapes which problems they solve personally and which ones they rely on crew for.

#### Skill List

Skills are deliberately general enough to apply across many scenarios but specific enough that the AI can identify when each one is relevant. Each skill includes example formula applications.

| # | Skill | Description | Example Formula Applications |
|---|-------|-------------|------------------------------|
| 1 | **Piloting** | Ship maneuvering, evasive action, precision flying, docking in hazardous conditions | Navigating debris fields, evasive combat maneuvers, emergency landings, threading asteroid belts |
| 2 | **Gunnery** | Weapon targeting, fire control, turret operation, shot timing | Ship-to-ship combat, disabling specific systems, suppressive fire, shooting under pressure |
| 3 | **Engineering** | Ship repair, system maintenance, jury-rigging, power management | Fixing damaged systems mid-combat, rerouting power, improvising repairs with limited parts |
| 4 | **Medicine** | Treating injuries, surgery, disease identification, pharmaceutical knowledge | Stabilizing wounded crew, performing surgery, identifying alien pathogens, triage under fire |
| 5 | **Diplomacy** | Negotiation, persuasion, de-escalation, reading social dynamics | Bartering prices, convincing NPCs, de-escalating hostilities, forging alliances |
| 6 | **Intimidation** | Coercion, threatening, projecting authority through force of will | Forcing surrender, establishing dominance, interrogation, deterring aggression |
| 7 | **Deception** | Lying, bluffing, disguise, falsifying records, misdirection | Bluffing past checkpoints, running cons, forging documents, feigning surrender |
| 8 | **Investigation** | Searching, analyzing clues, forensic analysis, connecting disparate information | Examining derelicts, analyzing wreckage, decoding messages, finding hidden compartments |
| 9 | **Survival** | EVA operations, harsh environments, rationing, endurance under deprivation | Spacewalks, surviving hull breaches, rationing supplies, enduring extreme conditions |
| 10 | **Hacking** | Cybersecurity, cracking encrypted systems, data extraction, electronic warfare | Breaking into terminals, disabling security systems, intercepting comms, cracking encryption |
| 11 | **Stealth** | Moving undetected, silent operations, ambush setup, reducing sensor signature | Sneaking through stations, silent boarding, evading patrols, hiding cargo |
| 12 | **Leadership** | Commanding crews under pressure, tactical coordination, inspiring action | Rallying panicked crew, coordinating multi-team operations, maintaining discipline in crisis |
| 13 | **Xenology** | Alien languages, customs, biology, first-contact protocols | Communicating with alien species, understanding alien tech, cultural negotiations, identifying alien life |
| 14 | **Commerce** | Market knowledge, appraising goods, supply chain awareness, deal-making | Evaluating salvage, spotting counterfeits, finding buyers for rare goods, reading market conditions |
| 15 | **Perception** | Spotting threats, reading people, situational awareness, noticing details others miss | Detecting ambushes, reading NPC intentions, noticing environmental hazards, spotting hidden objects |

**Design rationale for 15 skills:**

- **15 skills with 10 points means you can't even get +1 in everything.** The player must leave gaps. Those gaps matter — a captain with no Medicine relies entirely on their ship's surgeon; one with no Stealth can't sneak past anything.
- **Skills overlap with crew roles intentionally.** A captain with Engineering +3 and an engineer crew member stack their bonuses. A captain with no Engineering depends entirely on crew. This creates a push-pull between personal capability and crew dependency.
- **Some skills are journey-weighted but none are journey-locked.** Diplomacy is more valuable in First Contact, Gunnery in Warpath — but any skill can matter in any journey. The player's build shapes *how* they approach problems within the journey's framework.
- **Social skills are split three ways** (Diplomacy, Intimidation, Deception) to prevent a single "charisma" dump stat from covering all social encounters. Talking down a pirate (Intimidation) is mechanically different from negotiating a trade deal (Diplomacy) or bluffing past a checkpoint (Deception).

#### How Skills Integrate with Dice Rolls

Skills plug directly into the existing modifier formula system. When the AI constructs a `rollInterpretation` for a turn, it draws skill modifiers from the captain's skill levels alongside other modifier sources.

**Current modifier sources (from MODIFIER SOURCES in the system prompt):**
- Captain traits: +1 to +2 each when relevant
- Crew skills: +1 to +3 for relevant crew role
- Ship system status: operational +1, damaged -2, destroyed -4
- Ship weapons: +1 to +2 in combat
- Current morale: inspired +1, content 0, uneasy -1, fearful -2, broken -3
- Injuries: minor -1, serious -2, critical -3
- Relevant cargo items: +1 for useful equipment

**New modifier source — Captain skills: +1 to +3 based on skill level.**

The AI includes the relevant captain skill in the `modifierFormula` string. Example formulas:

```
"+2 (piloting skill) +1 (operational sensors) -1 (low morale)"
"+3 (engineering skill) +1 (chief engineer crew) -2 (damaged system)"
"+1 (diplomacy skill) +2 (silver-tongued trait) +1 (inspired morale)"
"+0 (no relevant skill) +1 (operational sensors)"
```

The AI determines which skill applies based on the player's action. Most actions map to a single obvious skill; ambiguous cases are the AI's judgment call. If no skill is relevant, no skill modifier is added.

**The 5-modifier cap still applies.** Captain skill is one of up to 5 total modifiers. This keeps formulas readable and prevents modifier stacking from overwhelming the d20 roll.

#### Data Structure

```javascript
// Added to the character object on the root game document
character: {
  // ... existing fields (name, role, traits, backstory, stats, condition, notes) ...

  // Skills — set at creation in Step 3, immutable after game start.
  // Only skills the player has chosen are present (omitted = level 0).
  // Each value is the skill level: 1, 2, or 3.
  // Example: { piloting: 2, engineering: 3, diplomacy: 1 }
  skills: {
    // Possible keys (only include those the player selected):
    // piloting, gunnery, engineering, medicine, diplomacy,
    // intimidation, deception, investigation, survival, hacking,
    // stealth, leadership, xenology, commerce, perception
  },
}
```

**Validation at creation:**
- Total points spent must equal exactly 10 (no saving points)
- Each skill level must be 1, 2, or 3
- Cost verification: sum of (level 1 = 1pt, level 2 = 3pt, level 3 = 6pt) across all skills = 10

#### Context Assembly

The captain's skills are included in the context sent to the AI each turn, as part of the player/character block:

```javascript
// In assembleContext, add to the player object:
player: {
  name: gameDoc.character.name,
  traits: gameDoc.character.traits || [],
  skills: gameDoc.character.skills || {},  // { piloting: 2, engineering: 3, diplomacy: 1 }
}
```

The system prompt's MODIFIER SOURCES instruction is updated to include:

```
- Captain skills: +1 to +3 based on skill level (piloting, gunnery, engineering, medicine,
  diplomacy, intimidation, deception, investigation, survival, hacking, stealth, leadership,
  xenology, commerce, perception). Apply the most relevant skill to the action. If no skill
  applies, do not add a skill modifier.
```

#### Skills Are Immutable After Creation

Unlike stats (which evolve narratively) and condition (which changes every turn), skills are locked at creation. This is a deliberate design choice:

- **Skills represent trained expertise**, not moment-to-moment condition. The captain brought these capabilities to the voyage.
- **Immutability preserves the weight of creation choices.** If skills could be gained mid-campaign, the initial allocation would feel less meaningful.
- **Crew recruitment is the mid-game answer.** A captain who skipped Medicine can recruit a surgeon. A captain who skipped Hacking can find a slicer. The crew system already handles capability growth — skills define what the *captain personally* brings to the table.

-----

### 8.7 Extensibility Notes

Adding a new journey requires:

1. Add the journey object to `JOURNEYS` config
1. Define or reuse ship IDs in the `availableShips` array
1. Write the narrative directives and opening hook template
1. Optionally add journey-specific starting items to the `bonusItems` list
1. No Firestore schema changes, no new collections, no migration

Adding a new ship requires:

1. Add the ship object to `SHIPS` config
1. Reference its ID in the relevant journeys’ `availableShips` arrays
1. No Firestore schema changes — the ship data writes into the existing `ship` object on the game document

The structure supports future additions like seasonal or event journeys, community-suggested journeys, or even a “random journey” option that picks one and surprises the player — all without data model changes.

-----

## Design Decisions

**Decisions:**

1. **Seven journeys, no custom.** Each is a curated experience with distinct tone, ships, and narrative direction. The data structure makes adding more trivial, but the player always picks from a designed set.
1. **Thirteen ships total.** Four generalists (Light Freighter, Scout Corvette, Survey Vessel, Salvage Rig) appear across multiple journeys. Nine specialists are journey-exclusive, including the three capital ships reserved for Ship’s Company. Every journey offers exactly 3 choices.
1. **Config lives in code, not Firestore.** Journeys and ships are developer-defined constants. The relevant data is denormalized into the game document at creation time. This means no admin UI for journey management and no Firestore reads to load the config — it’s just JavaScript objects.
1. **Journey data in the game document is immutable after creation.** The tone and narrative directives set at game start persist for the whole campaign. Claude always receives the same genre instructions regardless of where the story goes.
1. **Starting resources vary by journey.** A war campaign starts with less fuel and a damaged hull. An exploration mission starts pristine. This creates mechanical flavor beyond just the narrative tone.
1. **All journeys visible from the start.** No unlock system — the player sees all seven options when beginning a new campaign. The design makes adding more journeys trivial later, including an unlock system if we want it, but default is full access.
1. **Ship descriptions are self-contained; no journey-contextual lore blurbs needed.** The ship’s own description and stats are sufficient. The journey’s tone carries the context.
1. **Stats use a tiered absolute-value system.** Hull and shield values fall into named tiers (Light / Standard / Heavy / Capital) that give Claude consistent narrative guidance. Weapon damage classes map to those tiers. No arithmetic required — Claude uses the tiers as narrative logic, not as math.
1. **Minimum crew is ~40–50% of capacity; some ships support skeleton or solo operation.** Capital ships lose whole departments below 50%. Claude treats minimum crew as narrative tension, not a hard cutoff.
1. **The player character persists separately from the ship.** Characters carry four stats (physique, agility, intellect, presence), a dual condition track (health + stress), and a `notes` field for campaign memory. The ship can be lost or changed; the character is the constant. The `role` field enables journey-specific perspectives — particularly for Ship’s Company, where the player is not the commanding officer.
1. **15 skills, 10 points, Fibonacci cost curve.** Skills are the captain’s mechanical identity — they provide +1 to +3 modifiers in dice roll formulas. The Fibonacci cost (1 / 3 / 6 total for +1 / +2 / +3) forces real trade-offs: depth in a few areas or breadth across many. 10 points with 15 options means every build has meaningful gaps. Skills are immutable after creation — crew recruitment handles mid-campaign capability growth.
1. **Skills complement crew, not replace them.** Captain skills and crew skills can stack in the modifier formula but share the 5-modifier cap. A captain with Engineering +3 and an engineer crew member is exceptionally capable at repairs; a captain with no Engineering relies entirely on crew. This creates distinct play experiences from the same journey.
1. **Social skills split three ways.** Diplomacy, Intimidation, and Deception are separate skills to prevent a single social stat from dominating all NPC interactions. Each maps to different kinds of social encounters with different narrative flavors.