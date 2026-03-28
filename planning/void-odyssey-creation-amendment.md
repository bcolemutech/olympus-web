# DRAFT: Expanded Game Creation — Journeys & Ships

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

3. CHOOSE YOUR SHIP
   Filtered to ships compatible with the selected journey.
   Each ship shows stat bars, a flavor description, and its
   starting loadout (weapons, systems, features).
   Player names the ship.

4. STARTING CREW
   Claude generates 2-3 crew members tailored to the journey
   and ship class. A smuggler's freighter gets different crew
   than a science vessel on a deep-space survey.
   Player can rename or adjust before confirming.

5. OPENING SCENE
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

### 8.3 Ships

Ships are defined as static configuration in code alongside journeys. Each ship has base stats, a starting loadout, and a flavor profile that Claude uses when describing the vessel. Ships are not interchangeable reskins — they meaningfully shape what the player can do.

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

### 8.4 Journey → Ship Mapping (Reference)

|Journey          |Available Ships                                   |
|-----------------|--------------------------------------------------|
|Frontier Explorer|Survey Vessel, Scout Corvette, Light Freighter    |
|Smuggler’s Run   |Light Freighter, Blockade Runner, Salvage Rig     |
|Warpath          |Gunship, Corvette (War-Fit), Carrier Escort       |
|Deep Salvage     |Salvage Rig, Light Freighter, Scout Corvette      |
|First Contact    |Survey Vessel, Diplomatic Cruiser, Scout Corvette |
|The Long Haul    |Long-Range Cruiser, Light Freighter, Survey Vessel|

Each journey offers exactly three ship choices — enough variety to support different playstyles within the journey’s theme, but not so many that the choice becomes overwhelming.

**Design Principle:** Some ships appear across multiple journeys (Light Freighter in 4, Scout Corvette in 3, Survey Vessel in 3). These are versatile generalist ships. Others are journey-exclusive specialists (Gunship, Blockade Runner, Diplomatic Cruiser, Long-Range Cruiser). This creates a natural tier: the specialist ships are exciting because you only see them in their journey.

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

-----

### 8.6 Extensibility Notes

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

## Notes for Review

**Decisions baked into this draft:**

1. **Six journeys, no custom.** Each is a curated experience with distinct tone, ships, and narrative direction. The data structure makes adding more trivial, but the player always picks from a designed set.
1. **Ten ships total.** Four generalists (Light Freighter, Scout Corvette, Survey Vessel, Salvage Rig) that appear across multiple journeys. Six specialists that are journey-exclusive. Every journey offers exactly 3 choices.
1. **Config lives in code, not Firestore.** Journeys and ships are developer-defined constants. The relevant data is denormalized into the game document at creation time. This means no admin UI for journey management and no Firestore reads to load the config — it’s just JavaScript objects.
1. **Journey data in the game document is immutable after creation.** The tone and narrative directives set at game start persist for the whole campaign. Claude always receives the same genre instructions regardless of where the story goes.
1. **Starting resources vary by journey.** A war campaign starts with less fuel and a damaged hull. An exploration mission starts pristine. This creates mechanical flavor beyond just the narrative tone.

**Things I’m unsure about — flag for discussion:**

- Should the player see ALL journeys at once, or should some unlock after completing others?
- Should ships have a “lore blurb” visible during selection that hints at the journey’s flavor? (Currently they have descriptions but they’re ship-focused, not journey-contextual.)
- The stat values (hull 80, shields 50, etc.) are relative right now. Do we need to define what the scale means mechanically, or is it enough that Claude uses them relatively?
- Crew capacity varies from 4 to 15. Should there be a minimum viable crew mechanic (ship can’t function below X crew)?