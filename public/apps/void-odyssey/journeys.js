(function () {
  'use strict';

  var VO = (window.VoidOdyssey = window.VoidOdyssey || {});

  // ── Journey archetype definitions (static config, not Firestore) ──────────
  VO.JOURNEYS = {
    frontier_explorer: {
      id: 'frontier_explorer',
      name: 'Frontier Explorer',
      tagline: 'Chart the unknown. Name the stars.',
      icon: '🔭',
      description:
        'A discovery-focused campaign at the edge of charted space. Danger exists but is not the focus — the void is vast, strange, and worth exploring. Alien life, anomalies, and first-contact moments define the journey.',
      tone: 'wonder_discovery',
      dangerLevel: 'low_moderate',
      themes: ['exploration', 'science', 'first_contact', 'moral_dilemmas'],
      availableShips: ['survey_vessel', 'scout_corvette', 'light_freighter'],
      startingRegion: {
        name: 'The Outer Threshold',
        description:
          'A sparsely charted frontier beyond the last trade routes. A handful of relay stations, vast unexplored systems, and strange signal sources.',
        tags: ['frontier', 'unexplored', 'anomalous_signals', 'sparse_traffic'],
      },
      startingResources: {
        fuelPercent: 90,
        hullPercent: 100,
        credits: 'low',
        bonusItems: ['advanced_sensor_array'],
      },
      narrativeDirectives: [
        'Emphasize awe, scale, and the uncanny',
        'Alien life should feel genuinely alien, not humanoid defaults',
        'Favor environmental puzzles and first-contact diplomacy over combat',
        'Let the player name discoveries (planets, species, anomalies)',
        'Crew conversations lean philosophical — what does it mean to be the first?',
      ],
      openingHookTemplate:
        "The player's ship detects an anomalous signal from an uncharted system. Their survey commission says investigate. Simple enough — except the signal appears to be artificial, and there are no known civilizations in this sector.",
      order: 1,
    },

    smugglers_run: {
      id: 'smugglers_run',
      name: "Smuggler's Run",
      tagline: 'Every border is a business opportunity.',
      icon: '📦',
      description:
        'Gritty, witty, and morally gray. Back-alley deals, corrupt officials, and loyalty bought by the job. Danger is constant but manageable if you are clever. Reputation matters more than firepower.',
      tone: 'gritty_morally_gray',
      dangerLevel: 'moderate',
      themes: ['trade', 'deception', 'reputation', 'rival_crews', 'authority_evasion', 'loyalty'],
      availableShips: ['light_freighter', 'blockade_runner', 'salvage_rig'],
      startingRegion: {
        name: 'The Lattice',
        description:
          'A dense network of stations, trade hubs, and contested border zones between three rival factions. Lots of places to hide, lots of people to cross.',
        tags: ['contested', 'trade_hubs', 'faction_borders', 'high_traffic'],
      },
      startingResources: {
        fuelPercent: 75,
        hullPercent: 85,
        credits: 'moderate',
        bonusItems: ['smugglers_hold'],
      },
      narrativeDirectives: [
        'Dialogue-heavy — NPCs should be colorful, scheming, and quotable',
        'Every deal has a catch; every ally has an angle',
        'Reputation matters more than firepower — burned bridges close routes',
        'Law enforcement is an active threat, not background decoration',
        'The crew is a found family held together by mutual self-interest (at first)',
      ],
      openingHookTemplate:
        'The player owes a debt to a powerful broker. The first job is straightforward: transport a sealed container across a faction border. No questions. Easy money. The container hums faintly when no one is watching.',
      order: 2,
    },

    warpath: {
      id: 'warpath',
      name: 'Warpath',
      tagline: "They started it. You'll finish it.",
      icon: '⚔️',
      description:
        'Intense, tactical, high stakes. Military sci-fi with moral weight — war is hell, but sometimes unavoidable. Crew bonds forged under fire. Combat is frequent and lethal; losses are real.',
      tone: 'intense_tactical',
      dangerLevel: 'high',
      themes: [
        'military_campaigns',
        'tactical_decisions',
        'crew_survival',
        'enemy_intelligence',
        'sacrifice',
        'cost_of_command',
      ],
      availableShips: ['gunship', 'corvette_warfit', 'carrier_escort'],
      startingRegion: {
        name: 'The Shatter',
        description:
          "A contested war zone where two major factions have been grinding each other down for years. Debris fields, fortified stations, and no-man's-space between the lines.",
        tags: ['war_zone', 'debris_fields', 'contested', 'fortified_stations'],
      },
      startingResources: {
        fuelPercent: 60,
        hullPercent: 70,
        credits: 'low',
        bonusItems: ['military_grade_weapons', 'priority_distress_beacon'],
      },
      narrativeDirectives: [
        'Combat should be visceral and consequential — no throwaway encounters',
        'Tactical choices matter (flanking, retreating, boarding vs. bombardment)',
        'Crew injuries and deaths are permanent; morale is fragile',
        'The enemy should have coherent motivations, not be faceless evil',
        'Quiet moments between battles carry emotional weight',
      ],
      openingHookTemplate:
        'The player is a newly assigned captain on a warship that just lost half its crew in an ambush. Command says hold the sector. The enemy is regrouping. The surviving crew is shaken and looking to the new captain for a reason to keep fighting.',
      order: 3,
    },

    deep_salvage: {
      id: 'deep_salvage',
      name: 'Deep Salvage',
      tagline: 'Dead ships tell the best stories.',
      icon: '🔧',
      description:
        'Atmospheric horror meets treasure hunting. Creeping dread, claustrophobic derelicts, and the occasional genuine find that makes it all worthwhile. Think Alien meets Sunless Sea.',
      tone: 'atmospheric_horror',
      dangerLevel: 'moderate_high',
      themes: [
        'salvage_operations',
        'mystery',
        'resource_scarcity',
        'crew_psychology',
        'abandoned_technology',
      ],
      availableShips: ['salvage_rig', 'light_freighter', 'scout_corvette'],
      startingRegion: {
        name: 'The Graveyard Drift',
        description:
          'A region where an ancient battle or catastrophe left hundreds of derelict ships and stations scattered across a nebula. Salvage crews pick through the edges. Nobody goes to the center.',
        tags: ['nebula', 'derelicts', 'salvage_zone', 'dangerous_interior'],
      },
      startingResources: {
        fuelPercent: 80,
        hullPercent: 90,
        credits: 'low',
        bonusItems: ['cutting_torch', 'eva_kit', 'cargo_scanner'],
      },
      narrativeDirectives: [
        'Atmosphere is everything — silence, darkness, the creak of dead hulls',
        'Derelicts should feel like crime scenes or archaeological digs, not empty loot boxes',
        'Each wreck has a story: crew logs, damage patterns, cargo manifests that do not add up',
        'Resource management is tight — every EVA costs air, every repair costs parts',
        'Horror is slow-burn and psychological, not jump-scare gore',
      ],
      openingHookTemplate:
        "The player's salvage crew picks up a faint automated distress signal from deep inside the Drift — deeper than anyone profitably goes. The signal is old. Very old. But the ship it's coming from shouldn't exist according to any known registry.",
      order: 4,
    },

    first_contact: {
      id: 'first_contact',
      name: 'First Contact',
      tagline: 'We are not alone. Now what?',
      icon: '👽',
      description:
        'Cerebral, tense, diplomatic. The weight of representing your species in the face of the genuinely unknown. Heavy on communication puzzles, cultural misunderstanding, and the gap between intention and perception.',
      tone: 'cerebral_diplomatic',
      dangerLevel: 'low_combat_high_stakes',
      themes: [
        'diplomacy',
        'xenolinguistics',
        'cultural_exchange',
        'ethical_dilemmas',
        'communication_under_uncertainty',
        'politics_of_first_contact',
      ],
      availableShips: ['survey_vessel', 'diplomatic_cruiser', 'scout_corvette'],
      startingRegion: {
        name: 'The Threshold Array',
        description:
          'A diplomatic station at the edge of known space, positioned near where the alien signals originate. A mix of military, scientific, and political personnel, all with competing agendas.',
        tags: ['diplomatic_station', 'edge_of_known_space', 'alien_signals', 'political_tension'],
      },
      startingResources: {
        fuelPercent: 95,
        hullPercent: 100,
        credits: 'moderate',
        bonusItems: ['universal_translator_array', 'diplomatic_protocols_database'],
      },
      narrativeDirectives: [
        'Alien civilizations should be deeply thought out — biology shapes culture shapes communication',
        'Misunderstandings are the primary source of tension, not malice',
        "The player's crew includes specialists (linguists, anthropologists, biologists) whose expertise matters",
        'Political pressure from home adds a second layer of conflict — not everyone wants peace',
        'Let the player develop actual protocols and approaches; reward creative diplomacy',
      ],
      openingHookTemplate:
        "An alien vessel has appeared at the boundary of the system. It's not approaching, not retreating — just waiting. All attempts at communication have received responses, but no one can decode them yet. The player's ship has been assigned as the contact vessel. Approach carefully.",
      order: 5,
    },

    the_long_haul: {
      id: 'the_long_haul',
      name: 'The Long Haul',
      tagline: 'Fifteen thousand light-years from home. Better make it count.',
      icon: '🌌',
      description:
        'Intimate, long-form, character-driven. A generation-style voyage where the journey is the story. Crew dynamics evolve deeply over many turns. Think Voyager meets The Long Way to a Small, Angry Planet.',
      tone: 'intimate_character_driven',
      dangerLevel: 'variable',
      themes: [
        'crew_relationships',
        'resource_management',
        'isolation',
        'self_sufficiency',
        'adaptation',
        'what_home_means',
      ],
      availableShips: ['long_range_cruiser', 'light_freighter', 'survey_vessel'],
      startingRegion: {
        name: 'The Departure Point',
        description:
          'A well-known system. The destination is on the other side of the galaxy. The path between is uncharted.',
        tags: ['known_space', 'departure', 'long_voyage', 'one_way'],
      },
      startingResources: {
        fuelPercent: 100,
        hullPercent: 100,
        credits: 'moderate',
        bonusItems: ['hydroponics_bay', 'long_range_comms_array', 'extended_life_support'],
      },
      narrativeDirectives: [
        'Crew development is the core — relationships deepen, conflict simmers, bonds form',
        'Downtime scenes are as important as crisis scenes',
        'The ship itself becomes a character — modifications, wear, personality',
        'Each region of space the ship passes through should feel distinct',
        'The overarching question: will you make it, and who will you be when you arrive?',
      ],
      openingHookTemplate:
        'The player has accepted a contract to captain a long-range vessel on a one-way journey to establish contact with a distant colony that went silent decades ago. The trip will take years. The crew knows this. Departure is tomorrow.',
      order: 6,
    },

    ships_company: {
      id: 'ships_company',
      name: "Ship's Company",
      tagline: 'One ship. A thousand souls. Your corner of it.',
      icon: '🚀',
      description:
        'Intimate and massive simultaneously. You are one crew member among hundreds aboard a capital warship. The mission is fleet-scale; your experience of it is personal, tactical, and immediate. Think Das Boot meets Battlestar Galactica.',
      tone: 'intimate_and_massive',
      dangerLevel: 'high_scoped',
      themes: [
        'chain_of_command',
        'personal_heroism',
        'departmental_loyalty',
        'expertise_under_pressure',
        'cost_of_war',
        'finding_meaning_in_a_role',
      ],
      availableShips: ['fleet_carrier', 'line_battleship', 'heavy_cruiser'],
      startingRegion: {
        name: 'The Armada Assembly',
        description:
          "A staging fleet in a secure system preparing for a major offensive. The player's vessel is freshly crewed and assigned to the fleet. Everyone is waiting for orders everyone already knows are coming.",
        tags: ['fleet_staging', 'military', 'pre_offensive', 'capital_ships'],
      },
      startingResources: {
        fuelPercent: 90,
        hullPercent: 95,
        credits: 'low',
        bonusItems: ['role_kit'],
      },
      narrativeDirectives: [
        "The player has a role — filter events, access, and conversations through that role's perspective",
        'The commanding officer is an NPC with personality, agenda, and blind spots',
        'Inter-departmental tension is a rich source of drama (pilots vs. engineers, intelligence vs. command)',
        'The player can act outside their role, but the institution will react',
        'Heroism is personal and local, even when the mission is fleet-scale',
        'The ship should feel alive — a community of hundreds with culture, hierarchy, and gossip',
      ],
      openingHookTemplate:
        "The player's posting orders finally came through. Their assignment: a capital warship whose last operation went badly enough that half the senior crew was rotated out. The crew that stayed doesn't talk about what happened. The new commanding officer doesn't ask. The player's job is to show up, prove their worth, and figure out why everyone is so careful not to say certain things aloud.",
      roleOptions: [
        {
          id: 'fighter_pilot',
          name: 'Fighter Pilot',
          focus:
            'Sortie missions, dogfights, recon runs — the ship is a launching pad, not the battlefield',
        },
        {
          id: 'weapons_officer',
          name: 'Weapons Officer',
          focus: 'Main battery control, targeting, the weight of who you fire on',
        },
        {
          id: 'helmsman',
          name: 'Helmsman',
          focus: 'Navigation, evasion, FTL execution — the ship obeys your hands',
        },
        {
          id: 'chief_engineer',
          name: 'Chief Engineer',
          focus: 'Damage control, systems, keeping the impossible running',
        },
        {
          id: 'ships_surgeon',
          name: "Ship's Surgeon",
          focus: 'Medical bay, triage, measuring every engagement in lives',
        },
        {
          id: 'intelligence_analyst',
          name: 'Intelligence Analyst',
          focus: "Enemy movements, signals intercepts, knowing what command won't say",
        },
        {
          id: 'marine_sergeant',
          name: 'Marine Sergeant',
          focus: 'Boarding actions, internal security, fighting in corridors',
        },
      ],
      order: 7,
    },
  };
})();
