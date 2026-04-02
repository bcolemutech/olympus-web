(function () {
  'use strict';

  window.VoidOdyssey = window.VoidOdyssey || {};
  var VO = window.VoidOdyssey;

  // ── Ship definitions (all 13 ships from §8.3 of void-odyssey-creation-amendment) ──
  VO.SHIPS = {
    // ── 1. Light Freighter ─────────────────────────────────
    light_freighter: {
      id: 'light_freighter',
      className: 'Kestrel-class Light Freighter',
      icon: '🚀',
      description:
        'The workhorse of independent spacers. Not fast, not tough, not armed — but she carries cargo and she keeps flying. A ship for people who solve problems with resourcefulness, not firepower.',
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
          description:
            'Configurable hold — can be sectioned for different cargo types or converted for passengers',
          functional: true,
        },
      ],
      availableInJourneys: ['frontier_explorer', 'smugglers_run', 'deep_salvage', 'the_long_haul'],
      order: 1,
    },

    // ── 2. Scout Corvette ──────────────────────────────────
    scout_corvette: {
      id: 'scout_corvette',
      className: 'Peregrine-class Scout Corvette',
      icon: '🛸',
      description:
        'Fast, agile, and fitted with the best sensors money can buy. Built for getting in, seeing everything, and getting out before anyone notices. Light on cargo and crew space — this is a ship that travels light.',
      stats: {
        hull: 60,
        hullMax: 60,
        shields: 70,
        shieldsMax: 70,
        fuel: 75,
        cargoMax: 40,
        crewCapacity: 4,
      },
      startingWeapons: [
        {
          id: 'wpn_pulse_lasers',
          name: 'Twin Pulse Lasers',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: 'Fast-tracking, good for small targets',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_sensors',
          name: 'Advanced Sensor Array',
          status: 'operational',
          notes: 'Long-range scanning, anomaly detection',
        },
        {
          id: 'sys_stealth',
          name: 'Stealth Coating',
          status: 'operational',
          notes: 'Reduces sensor signature when running silent',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_obs_deck',
          name: 'Observation Deck',
          description:
            'A reinforced viewport bay with integrated scanning displays — part cockpit, part observatory',
          functional: true,
        },
      ],
      availableInJourneys: ['frontier_explorer', 'deep_salvage', 'first_contact'],
      order: 2,
    },

    // ── 3. Salvage Rig ─────────────────────────────────────
    salvage_rig: {
      id: 'salvage_rig',
      className: 'Tortoise-class Salvage Platform',
      icon: '🔧',
      description:
        'Ugly, slow, and indispensable. The Tortoise is a mobile workshop built around a massive articulated cutting arm and a cavernous cargo bay. She strips wrecks like a surgeon and hauls the bones home.',
      stats: {
        hull: 90,
        hullMax: 90,
        shields: 40,
        shieldsMax: 40,
        fuel: 70,
        cargoMax: 150,
        crewCapacity: 6,
      },
      startingWeapons: [
        {
          id: 'wpn_cutting_laser',
          name: 'Industrial Cutting Laser',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: 'Meant for bulkheads, works on hostiles in a pinch',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_cargo_scanner',
          name: 'Cargo Scanner',
          status: 'operational',
          notes: 'Identifies valuable materials and hazards in wrecks',
        },
        {
          id: 'sys_eva',
          name: 'EVA Deployment System',
          status: 'operational',
          notes: 'Airlock staging for spacewalk operations',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_cutting_arm',
          name: 'Cutting Arm',
          description:
            'Articulated industrial arm with plasma torch — can breach hulls, cut structural members, and extract components',
          functional: true,
        },
        {
          id: 'feat_drone_bay',
          name: 'Drone Bay',
          description: 'Houses 2 remote salvage drones for hazardous retrieval operations',
          functional: true,
        },
        {
          id: 'feat_decon_chamber',
          name: 'Decontamination Chamber',
          description: 'Scans and cleans salvaged materials before they enter the main hold',
          functional: true,
        },
      ],
      availableInJourneys: ['smugglers_run', 'deep_salvage'],
      order: 3,
    },

    // ── 4. Blockade Runner ─────────────────────────────────
    blockade_runner: {
      id: 'blockade_runner',
      className: 'Shadowfin-class Blockade Runner',
      icon: '👤',
      description:
        "A smuggler's dream — fast enough to outrun patrol ships, quiet enough to slip past sensor nets, and just armed enough to discourage anyone who gets too close. The hidden compartments are the real feature.",
      stats: {
        hull: 55,
        hullMax: 55,
        shields: 65,
        shieldsMax: 65,
        fuel: 80,
        cargoMax: 70,
        crewCapacity: 5,
      },
      startingWeapons: [
        {
          id: 'wpn_flak_cannon',
          name: 'Rear-Facing Flak Cannon',
          type: 'kinetic',
          damage: 'moderate',
          status: 'operational',
          notes: 'Discourages pursuit, useless in a head-on fight',
        },
        {
          id: 'wpn_emp',
          name: 'EMP Disruptor',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Disables electronics — great for escapes, not for kills',
        },
      ],
      startingSystems: [
        {
          id: 'sys_ftl',
          name: 'FTL Drive',
          status: 'operational',
          notes: 'Modified for rapid spin-up — emergency jumps possible',
        },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_spoofing',
          name: 'Sensor Spoofing Suite',
          status: 'operational',
          notes: 'Generates false sensor signatures, masks cargo scans',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
        {
          id: 'sys_interceptor',
          name: 'Signal Interceptor',
          status: 'operational',
          notes: 'Monitors local comms traffic for patrol movements',
        },
      ],
      startingFeatures: [
        {
          id: 'feat_smugglers_hold',
          name: "Smuggler's Hold",
          description:
            'Shielded hidden compartments — invisible to standard cargo scans. Holds ~20 units of contraband cargo.',
          functional: true,
        },
        {
          id: 'feat_docking_clamps',
          name: 'Rapid Docking Clamps',
          description: 'Modified docking system for fast attach/detach — 30 seconds flat',
          functional: true,
        },
      ],
      availableInJourneys: ['smugglers_run'],
      order: 4,
    },

    // ── 5. Corvette (War Refit) ────────────────────────────
    corvette_warfit: {
      id: 'corvette_warfit',
      className: 'Peregrine-class Corvette (War Refit)',
      icon: '⚔️',
      description:
        "The scout corvette's bigger, meaner sibling. Same agile frame, but the sensor arrays have been swapped for weapon mounts and the observation deck is now a tactical operations center. She's fast, she hits hard, but she can't take a punch.",
      stats: {
        hull: 70,
        hullMax: 70,
        shields: 80,
        shieldsMax: 80,
        fuel: 65,
        cargoMax: 25,
        crewCapacity: 6,
      },
      startingWeapons: [
        {
          id: 'wpn_pulse_array',
          name: 'Rapid Pulse Laser Array',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: 'High rate of fire, excellent for strafing runs',
        },
        {
          id: 'wpn_torpedo',
          name: 'Torpedo Launcher',
          type: 'missile',
          damage: 'heavy',
          status: 'operational',
          notes: 'Limited torpedoes, each one counts',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_tactical',
          name: 'Tactical Sensors',
          status: 'operational',
          notes: 'Target acquisition, weak-point analysis',
        },
        {
          id: 'sys_ew',
          name: 'Electronic Warfare Suite',
          status: 'operational',
          notes: 'Jamming and countermeasures',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_tac_ops',
          name: 'Tactical Operations Center',
          description:
            'Compact command room with holographic battle display — coordinates multi-target engagements',
          functional: true,
        },
      ],
      availableInJourneys: ['warpath'],
      order: 5,
    },

    // ── 6. Gunship ─────────────────────────────────────────
    gunship: {
      id: 'gunship',
      className: 'Mauler-class Assault Gunship',
      icon: '🔫',
      description:
        "A blunt instrument with engines. Heavy armor, heavy guns, and the subtlety of a brick through a window. She won't win any races, but she'll be the last ship standing when the shooting stops.",
      stats: {
        hull: 120,
        hullMax: 120,
        shields: 90,
        shieldsMax: 90,
        fuel: 55,
        cargoMax: 30,
        crewCapacity: 8,
      },
      startingWeapons: [
        {
          id: 'wpn_plasma_cannons',
          name: 'Twin Plasma Cannons',
          type: 'energy',
          damage: 'heavy',
          status: 'operational',
          notes: 'Main batteries, devastating at close range',
        },
        {
          id: 'wpn_missile_rack',
          name: 'Missile Rack',
          type: 'missile',
          damage: 'heavy',
          status: 'operational',
          notes: 'Limited magazine, high impact',
        },
        {
          id: 'wpn_pd_grid',
          name: 'Point Defense Grid',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Automated anti-missile and anti-fighter screen',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_mil_sensors',
          name: 'Military Sensors',
          status: 'operational',
          notes: 'Tactical targeting, threat assessment',
        },
        {
          id: 'sys_dmg_ctrl',
          name: 'Damage Control System',
          status: 'operational',
          notes: 'Automated hull breach response',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_armory',
          name: 'Armory',
          description:
            'Weapons locker and tactical planning room — boarding actions launch from here',
          functional: true,
        },
        {
          id: 'feat_reinforced_bridge',
          name: 'Reinforced Bridge',
          description: 'Blast-shielded command deck with redundant controls',
          functional: true,
        },
      ],
      availableInJourneys: ['warpath'],
      order: 6,
    },

    // ── 7. Carrier Escort ──────────────────────────────────
    carrier_escort: {
      id: 'carrier_escort',
      className: 'Bulwark-class Escort Carrier',
      icon: '🛡️',
      description:
        "Not a true carrier — she doesn't launch fighters. But the Bulwark carries a squadron of combat drones and has the command infrastructure to coordinate them. A force multiplier for a captain who thinks three moves ahead.",
      stats: {
        hull: 100,
        hullMax: 100,
        shields: 75,
        shieldsMax: 75,
        fuel: 60,
        cargoMax: 50,
        crewCapacity: 10,
      },
      startingWeapons: [
        {
          id: 'wpn_autocannons',
          name: 'Broadside Autocannons',
          type: 'kinetic',
          damage: 'moderate',
          status: 'operational',
          notes: 'Port and starboard mounted, good coverage',
        },
        {
          id: 'wpn_drone_sqn',
          name: 'Combat Drone Squadron',
          type: 'special',
          damage: 'varies',
          status: 'operational',
          notes: '4 autonomous combat drones — can attack, screen, or scout',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        { id: 'sys_life', name: 'Life Support', status: 'operational', notes: null },
        {
          id: 'sys_drone_net',
          name: 'Drone Command Network',
          status: 'operational',
          notes: 'AI-assisted coordination of up to 8 drones',
        },
        { id: 'sys_sensors', name: 'Standard Sensors', status: 'operational', notes: null },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
        {
          id: 'sys_medical',
          name: 'Medical Bay',
          status: 'operational',
          notes: 'Full surgical suite — critical with a crew this size',
        },
      ],
      startingFeatures: [
        {
          id: 'feat_drone_bay',
          name: 'Drone Bay',
          description:
            'Automated launch and recovery system for combat drones. Houses 4 drones with maintenance berths for field repair.',
          functional: true,
        },
        {
          id: 'feat_war_room',
          name: 'War Room',
          description:
            'Strategic planning space with long-range communication equipment. Can coordinate with allied vessels.',
          functional: true,
        },
      ],
      availableInJourneys: ['warpath'],
      order: 7,
    },

    // ── 8. Survey Vessel ───────────────────────────────────
    survey_vessel: {
      id: 'survey_vessel',
      className: 'Meridian-class Survey Vessel',
      icon: '🔭',
      description:
        "A floating laboratory with engines. The Meridian is designed for extended deep-space missions — well-equipped, comfortable (by spacer standards), and packed with every scanner and probe known to science. She's not winning any fights, but she'll find things no one else can.",
      stats: {
        hull: 75,
        hullMax: 75,
        shields: 55,
        shieldsMax: 55,
        fuel: 90,
        cargoMax: 60,
        crewCapacity: 8,
      },
      startingWeapons: [
        {
          id: 'wpn_mining_laser',
          name: 'Mining Laser',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: "Asteroid sampling tool. Technically a weapon if you're desperate.",
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'Extended-duration rated — recycling systems for long voyages',
        },
        {
          id: 'sys_deep_sensors',
          name: 'Deep Space Sensor Array',
          status: 'operational',
          notes: 'The best scanning package available — gravitational, electromagnetic, quantum',
        },
        {
          id: 'sys_probe_launcher',
          name: 'Probe Launcher',
          status: 'operational',
          notes: 'Deploys autonomous survey probes into systems before arrival',
        },
        {
          id: 'sys_lab_net',
          name: 'Laboratory Network',
          status: 'operational',
          notes: 'Interconnected lab modules for biological, chemical, and physical analysis',
        },
        {
          id: 'sys_comms',
          name: 'Communications Array',
          status: 'operational',
          notes: 'Long-range, high-bandwidth for transmitting research data home',
        },
      ],
      startingFeatures: [
        {
          id: 'feat_science_lab',
          name: 'Science Lab',
          description:
            'Multi-discipline research laboratory. Can analyze alien biology, unknown materials, and anomalous energy signatures.',
          functional: true,
        },
        {
          id: 'feat_probe_bay',
          name: 'Probe Bay',
          description: 'Carries 6 deployable survey probes for remote system scanning',
          functional: true,
        },
      ],
      availableInJourneys: ['frontier_explorer', 'first_contact', 'the_long_haul'],
      order: 8,
    },

    // ── 9. Diplomatic Cruiser ──────────────────────────────
    diplomatic_cruiser: {
      id: 'diplomatic_cruiser',
      className: 'Envoy-class Diplomatic Cruiser',
      icon: '🕊️',
      description:
        'More embassy than spaceship. The Envoy is designed to impress, accommodate, and communicate — with meeting halls, translation suites, and quarters comfortable enough for species with very different ideas about comfort. Lightly armed because showing up with guns sends the wrong message.',
      stats: {
        hull: 85,
        hullMax: 85,
        shields: 60,
        shieldsMax: 60,
        fuel: 80,
        cargoMax: 55,
        crewCapacity: 12,
      },
      startingWeapons: [
        {
          id: 'wpn_deterrent_laser',
          name: 'Deterrent Laser',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Visible but non-threatening. A polite reminder.',
        },
      ],
      startingSystems: [
        { id: 'sys_ftl', name: 'FTL Drive', status: 'operational', notes: null },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'Configurable atmospheric zones — can accommodate non-standard biology',
        },
        {
          id: 'sys_translator',
          name: 'Universal Translator Array',
          status: 'operational',
          notes: 'Experimental real-time translation — imperfect but invaluable',
        },
        {
          id: 'sys_dip_comms',
          name: 'Diplomatic Communications Suite',
          status: 'operational',
          notes: 'Encrypted multi-channel comms with real-time conference capability',
        },
        { id: 'sys_sensors', name: 'Standard Sensors', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_conf_hall',
          name: 'Conference Hall',
          description:
            "Modular meeting space that can be reconfigured for different species' physical needs. Holographic display for presentations and cultural demonstrations.",
          functional: true,
        },
        {
          id: 'feat_xenobio',
          name: 'Xenobiology Suite',
          description:
            'Medical and biological analysis lab focused on understanding alien physiology — essential for hospitality and safety protocols',
          functional: true,
        },
        {
          id: 'feat_guest_quarters',
          name: 'Guest Quarters',
          description:
            'Four configurable guest suites with adjustable gravity, atmosphere, temperature, and lighting',
          functional: true,
        },
      ],
      availableInJourneys: ['first_contact'],
      order: 9,
    },

    // ── 10. Long-Range Cruiser ─────────────────────────────
    long_range_cruiser: {
      id: 'long_range_cruiser',
      className: 'Horizon-class Long-Range Cruiser',
      icon: '🌌',
      description:
        "Built for the journey, not the destination. The Horizon is self-sustaining — hydroponics, water recycling, fabrication workshops, and the kind of crew quarters that acknowledge people will be living here for years, not weeks. She's a small town with an FTL drive.",
      stats: {
        hull: 95,
        hullMax: 95,
        shields: 60,
        shieldsMax: 60,
        fuel: 100,
        cargoMax: 100,
        crewCapacity: 15,
      },
      startingWeapons: [
        {
          id: 'wpn_pd_turret',
          name: 'Point Defense Turret',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Debris and asteroid defense',
        },
        {
          id: 'wpn_pulse_cannon',
          name: 'Pulse Cannon',
          type: 'energy',
          damage: 'moderate',
          status: 'operational',
          notes: 'Enough to discourage, not enough to conquer',
        },
      ],
      startingSystems: [
        {
          id: 'sys_ftl',
          name: 'FTL Drive',
          status: 'operational',
          notes: 'Efficiency-rated for sustained long-range travel',
        },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'Closed-loop recycling — air, water, waste',
        },
        { id: 'sys_sensors', name: 'Standard Sensors', status: 'operational', notes: null },
        {
          id: 'sys_comms',
          name: 'Communications Array',
          status: 'operational',
          notes: 'Long-range tightbeam for periodic check-ins with home',
        },
        {
          id: 'sys_fabrication',
          name: 'Fabrication System',
          status: 'operational',
          notes: '3D printing and basic manufacturing from raw materials',
        },
      ],
      startingFeatures: [
        {
          id: 'feat_hydroponics',
          name: 'Hydroponics Bay',
          description:
            'Food production system — grows enough to supplement rations for the full crew. Fresh vegetables are a morale miracle.',
          functional: true,
        },
        {
          id: 'feat_workshop',
          name: 'Workshop',
          description:
            'Machine shop and fabrication lab. Can manufacture replacement parts, tools, and basic equipment from raw materials.',
          functional: true,
        },
        {
          id: 'feat_rec_commons',
          name: 'Rec Commons',
          description:
            "Shared living space with a galley, entertainment, and exercise equipment. The heart of the ship's social life.",
          functional: true,
        },
        {
          id: 'feat_medical_bay',
          name: 'Medical Bay',
          description:
            "Full surgical and recovery suite. Long voyages mean you can't just limp to the nearest station.",
          functional: true,
        },
      ],
      availableInJourneys: ['the_long_haul'],
      order: 10,
    },

    // ── 11. Fleet Carrier ──────────────────────────────────
    fleet_carrier: {
      id: 'fleet_carrier',
      className: 'Ascendant-class Fleet Carrier',
      icon: '✈️',
      description:
        "A city with engines. The Ascendant carries three full fighter squadrons, a marine complement, and hundreds of crew across dedicated departments. She doesn't win fights by being tough — she wins by projecting power across a battlespace simultaneously. No single crew member understands everything happening aboard her at once.",
      stats: {
        hull: 160,
        hullMax: 160,
        shields: 110,
        shieldsMax: 110,
        fuel: 40,
        cargoMax: 250,
        crewCapacity: 200,
      },
      startingWeapons: [
        {
          id: 'wpn_pd_network',
          name: 'Point Defense Network',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes:
            'Continuous automated coverage — destroys incoming missiles and fighters at close range',
        },
        {
          id: 'wpn_broadside_batt',
          name: 'Broadside Batteries',
          type: 'kinetic',
          damage: 'moderate',
          status: 'operational',
          notes: "Port and starboard mounted — not the ship's primary offensive arm",
        },
        {
          id: 'wpn_fighter_wing',
          name: 'Fighter Wing',
          type: 'special',
          damage: 'varies',
          status: 'operational',
          notes:
            "Three squadrons of eight fighters — the ship's real teeth. Fighters operate independently but return to her for fuel, repair, and orders.",
        },
      ],
      startingSystems: [
        {
          id: 'sys_ftl',
          name: 'FTL Drive',
          status: 'operational',
          notes: 'Capital-scale — requires 8-minute spool time; planned jumps only',
        },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'City-grade redundant loops — six independent systems',
        },
        {
          id: 'sys_fleet_cmd',
          name: 'Fleet Command Network',
          status: 'operational',
          notes: 'Coordinates with up to 40 allied vessels simultaneously',
        },
        {
          id: 'sys_flight_ops',
          name: 'Flight Operations System',
          status: 'operational',
          notes:
            'Manages launch cycles, recovery, fighter tracking, and bay assignments for all three squadrons',
        },
        {
          id: 'sys_tac_intel',
          name: 'Tactical Intelligence Suite',
          status: 'operational',
          notes: 'Strategic overview, fleet-scale threat assessment',
        },
        {
          id: 'sys_medical',
          name: 'Medical Complex',
          status: 'operational',
          notes: 'Full hospital — surgery, trauma, psychiatric services. Not a bay — a complex.',
        },
        {
          id: 'sys_comms',
          name: 'Communications Array',
          status: 'operational',
          notes: 'Fleet broadcast, secure command channels, civilian-band intercept',
        },
      ],
      startingFeatures: [
        {
          id: 'feat_flight_deck',
          name: 'Flight Deck',
          description:
            'Three active runways and catapult systems. Recovery nets and arrestor cables on the aft end. Organized chaos on launch day, precision mechanics every other hour.',
          functional: true,
        },
        {
          id: 'feat_cic',
          name: 'CIC — Combat Information Center',
          description:
            "The ship's nerve center: holographic tactical displays, all department heads at stations, the commanding officer at the center of it all.",
          functional: true,
        },
        {
          id: 'feat_hangar_bay',
          name: 'Hangar Bay',
          description:
            'Fighter storage, arming, and maintenance across two decks. The pilots live here between sorties — bunks, lockers, a coffee machine that always burns it.',
          functional: true,
        },
        {
          id: 'feat_marine_barracks',
          name: 'Marine Barracks',
          description:
            'Full armory, training simulators, briefing rooms, and the particular quiet of soldiers waiting for work.',
          functional: true,
        },
      ],
      availableInJourneys: ['ships_company'],
      order: 11,
    },

    // ── 12. Line Battleship ────────────────────────────────
    line_battleship: {
      id: 'line_battleship',
      className: 'Ironwall-class Line Battleship',
      icon: '💥',
      description:
        "The hammer of the fleet. The Ironwall is built to absorb punishment and deliver it at range. Heavy armor, layered shields, and guns that can crack open other capital ships at extreme distance. She's slow, she knows it, and she doesn't care. Everything about the Ironwall says: come to me.",
      stats: {
        hull: 200,
        hullMax: 200,
        shields: 150,
        shieldsMax: 150,
        fuel: 35,
        cargoMax: 120,
        crewCapacity: 120,
      },
      startingWeapons: [
        {
          id: 'wpn_main_battery',
          name: 'Main Battery',
          type: 'kinetic',
          damage: 'capital',
          status: 'operational',
          notes:
            'Three twin-mount heavy railguns — designed for capital ship engagements at extreme range. Each gun has a crew of twelve.',
        },
        {
          id: 'wpn_secondary_batt',
          name: 'Secondary Batteries',
          type: 'energy',
          damage: 'heavy',
          status: 'operational',
          notes:
            'Anti-cruiser batteries port and starboard — each handled by a dedicated weapons team',
        },
        {
          id: 'wpn_pd_grid',
          name: 'Point Defense Grid',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Automated close-range protection against missiles and strike craft',
        },
      ],
      startingSystems: [
        {
          id: 'sys_ftl',
          name: 'FTL Drive',
          status: 'operational',
          notes: 'Capital-scale — slow spool, not designed for emergency jumps',
        },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'Redundant capital-grade — multiple independent zones',
        },
        {
          id: 'sys_fire_ctrl',
          name: 'Fire Control System',
          status: 'operational',
          notes:
            'Targeting coordination across all batteries — integrates sensor data for firing solutions at range',
        },
        {
          id: 'sys_dmg_net',
          name: 'Damage Control Network',
          status: 'operational',
          notes:
            'Ship-wide automated breach response, fire suppression, bulkhead sealing, repair party routing',
        },
        {
          id: 'sys_sensors',
          name: 'Tactical Sensors',
          status: 'operational',
          notes: 'Long-range detection optimized for fleet engagements',
        },
        { id: 'sys_comms', name: 'Communications Array', status: 'operational', notes: null },
      ],
      startingFeatures: [
        {
          id: 'feat_main_batt_ctrl',
          name: 'Main Battery Control',
          description:
            'The gun deck — a cathedral of machinery. The railguns run the full length of the ship. Each crew team has been running the same gun for years.',
          functional: true,
        },
        {
          id: 'feat_armored_bridge',
          name: 'Armored Bridge',
          description:
            "Buried behind three meters of reinforced hull in the superstructure's core. The commanding officer fights from here. It never sees natural light.",
          functional: true,
        },
        {
          id: 'feat_dmg_ctrl_ctr',
          name: 'Damage Control Center',
          description:
            "Engineering's headquarters: real-time hull integrity maps, repair party coordination, emergency power routing. The people who keep the ship alive work here.",
          functional: true,
        },
      ],
      availableInJourneys: ['ships_company'],
      order: 12,
    },

    // ── 13. Heavy Cruiser ──────────────────────────────────
    heavy_cruiser: {
      id: 'heavy_cruiser',
      className: 'Resolution-class Heavy Cruiser',
      icon: '⚓',
      description:
        "The fleet's versatile officer. Large enough to project real power, independent enough to operate without a fleet, and adaptable enough to fill almost any mission role. The Resolution is the ship command sends when they need the job done without committing a battleship — which means she ends up in more interesting situations than either.",
      stats: {
        hull: 130,
        hullMax: 130,
        shields: 100,
        shieldsMax: 100,
        fuel: 55,
        cargoMax: 120,
        crewCapacity: 60,
      },
      startingWeapons: [
        {
          id: 'wpn_heavy_guns',
          name: 'Heavy Gun Batteries',
          type: 'energy/kinetic',
          damage: 'heavy',
          status: 'operational',
          notes:
            'Main offensive armament — effective against cruisers and below, uncomfortable for capital ships',
        },
        {
          id: 'wpn_torpedo_tubes',
          name: 'Torpedo Tubes',
          type: 'missile',
          damage: 'heavy',
          status: 'operational',
          notes: 'Six-tube bow array — the answer when the target is bigger than you',
        },
        {
          id: 'wpn_pd_turrets',
          name: 'Point Defense Turrets',
          type: 'energy',
          damage: 'light',
          status: 'operational',
          notes: 'Anti-fighter and anti-missile coverage',
        },
      ],
      startingSystems: [
        {
          id: 'sys_ftl',
          name: 'FTL Drive',
          status: 'operational',
          notes: 'Military-rated, faster spool than capital ships — emergency jumps possible',
        },
        {
          id: 'sys_life',
          name: 'Life Support',
          status: 'operational',
          notes: 'Fully rated for extended independent operations',
        },
        {
          id: 'sys_combat_sensors',
          name: 'Combat Sensors',
          status: 'operational',
          notes: 'Multi-mode — surface, deep space, and signals intelligence',
        },
        {
          id: 'sys_ew',
          name: 'Electronic Warfare Suite',
          status: 'operational',
          notes: 'Jamming, spoofing, and active countermeasures',
        },
        {
          id: 'sys_comms',
          name: 'Communications Array',
          status: 'operational',
          notes: 'Fleet integration plus independent encrypted channels for detached operations',
        },
        {
          id: 'sys_medical',
          name: 'Medical Bay',
          status: 'operational',
          notes: "Full surgical suite — independent operations mean you can't limp to a station",
        },
      ],
      startingFeatures: [
        {
          id: 'feat_ops_center',
          name: 'Operations Center',
          description:
            "Decentralized command — dedicated stations for navigation, weapons, intelligence, and comms. Designed for independent operations where there's no fleet to call.",
          functional: true,
        },
        {
          id: 'feat_marine_det',
          name: 'Marine Detachment Quarters',
          description:
            'Barracks and armory for a platoon-strength force — boarding actions, security operations, landing missions.',
          functional: true,
        },
      ],
      availableInJourneys: ['ships_company'],
      order: 13,
    },
  };
})();
