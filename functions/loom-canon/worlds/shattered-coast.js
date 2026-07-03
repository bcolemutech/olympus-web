'use strict';

/**
 * The Shattered Coast — Phase 1 MVP seed world.
 *
 * A compact pirate-age Caribbean scenario, hand-authored from the salvaged
 * Tortuga Caribbean flavor material (planning/loom-salvage-tortuga-caribbean.md)
 * and shaped to the canon schema in functions/loom-canon/index.js. This is a
 * deliberately small world sized for one multi-session single-player
 * adventure (Phase 1 exit criterion), not the full Caribbean/VO conversion —
 * that broader effort is L-301 (#315), a Phase 3 issue.
 */

module.exports = {
  id: 'shattered-coast',
  name: 'The Shattered Coast',
  tagline: 'Where hidden coves and old scores meet the tide.',
  openingHook:
    "Your ship limps into Widow's Reach with a Spanish patrol closing on your wake and the " +
    "hold half-empty. Captain Orla Vance is waiting on the dock — she has a job, and it isn't " +
    'the last one that went bad.',

  locations: {
    'widows-reach': {
      id: 'widows-reach',
      name: "Widow's Reach",
      description:
        'A hidden cove behind a wall of black rock, deep enough for a keel and narrow enough ' +
        'that no patrol has ever found the entrance twice. Lean-tos and a careened hull crowd ' +
        'the shingle; smoke from the cookfires never rises above the treeline.',
      connections: ['skeleton-cove', 'the-drowned-shoals'],
      factionIds: ['pirate-brethren'],
      npcIds: ['captain-orla-vance'],
      rules: {},
    },
    'skeleton-cove': {
      id: 'skeleton-cove',
      name: 'Skeleton Cove',
      description:
        'A shallow bay choked with the ribs of wrecked hulls, some centuries old. The locals ' +
        'say the cove takes a ship a generation and gives nothing back but splinters and ' +
        'stories.',
      connections: ['widows-reach'],
      factionIds: ['pirate-brethren'],
      npcIds: ['old-mireille'],
      rules: {},
    },
    'the-drowned-shoals': {
      id: 'the-drowned-shoals',
      name: 'The Drowned Shoals',
      description:
        'Open water threading between reefs sharp enough to gut a hull in a swell. Every ' +
        'crossing is a gamble with the weather and with whoever else is crossing it that day.',
      connections: ['widows-reach', 'free-city-of-marabel', 'fort-augustine'],
      factionIds: [],
      npcIds: [],
      rules: { requiresAbility: 'seaworthy-vessel' },
    },
    'free-city-of-marabel': {
      id: 'free-city-of-marabel',
      name: 'The Free City of Marabel',
      description:
        'A crowded, lawless trading port that answers to no crown. Every flag flies here for ' +
        'the right price, and the only law is the Guild ledger.',
      connections: ['the-drowned-shoals', 'fort-augustine'],
      factionIds: ['free-traders-guild'],
      npcIds: ['quartermaster-doone'],
      rules: {},
    },
    'fort-augustine': {
      id: 'fort-augustine',
      name: 'Fort Augustine',
      description:
        'A stone garrison town flying the Spanish Crown’s colors, its harbor guarded by a ' +
        'battery that has sunk more smuggler hulls than storms have.',
      connections: ['the-drowned-shoals', 'free-city-of-marabel'],
      factionIds: ['spanish-crown'],
      npcIds: ['commandant-de-alva'],
      rules: { hostileToFactionId: 'pirate-brethren' },
    },
  },

  factions: {
    'pirate-brethren': {
      id: 'pirate-brethren',
      name: 'The Pirate Brethren',
      description:
        "A loose confederation of crews who answer to no crown, held together by the Reach's " +
        'unwritten codes more than by any flag.',
      disposition: 'friendly',
    },
    'spanish-crown': {
      id: 'spanish-crown',
      name: 'The Spanish Crown',
      description:
        'The colonial authority holding Fort Augustine and the shipping lanes around it. ' +
        'Views every unflagged hull as a smuggler until proven otherwise.',
      disposition: 'hostile',
    },
    'free-traders-guild': {
      id: 'free-traders-guild',
      name: 'The Free Traders’ Guild',
      description:
        "Marabel's merchant council. Neutral by policy and profitable by habit — the Guild " +
        'will deal with pirates and crown officers alike, at a price.',
      disposition: 'neutral',
    },
  },

  characters: {
    'captain-orla-vance': {
      id: 'captain-orla-vance',
      name: 'Captain Orla Vance',
      description:
        'Weathered, sharp-eyed, and missing two fingers on her left hand. She built Widow’s ' +
        "Reach's fragile peace between a dozen quarrelsome crews and does not intend to lose it " +
        'to anyone’s recklessness — including the player’s.',
      factionId: 'pirate-brethren',
      locationId: 'widows-reach',
    },
    'old-mireille': {
      id: 'old-mireille',
      name: 'Old Mireille',
      description:
        'A lookout who has outlived three captains and reads the wrecks at Skeleton Cove like ' +
        'other people read scripture. Superstitious, half-blind, and usually right.',
      factionId: 'pirate-brethren',
      locationId: 'skeleton-cove',
    },
    'quartermaster-doone': {
      id: 'quartermaster-doone',
      name: 'Quartermaster Doone',
      description:
        'Keeper of the Guild ledger in Marabel. Knows the price of everything and the loyalty ' +
        'of no one, including the highest bidder.',
      factionId: 'free-traders-guild',
      locationId: 'free-city-of-marabel',
    },
    'commandant-de-alva': {
      id: 'commandant-de-alva',
      name: 'Commandant de Alva',
      description:
        "Fort Augustine's garrison commander. Ambitious, correct to the point of cruelty, and " +
        'convinced that hanging the right pirate captain will finally earn him a posting back ' +
        'home.',
      factionId: 'spanish-crown',
      locationId: 'fort-augustine',
    },
  },

  lore: {
    'founding-of-widows-reach': {
      id: 'founding-of-widows-reach',
      title: "The Founding of Widow's Reach",
      text:
        'Three generations ago a single crew, widowed of their captain in a Crown ambush, ' +
        'found the cove and swore no flag would ever find it again. The name stuck; the oath ' +
        'mostly held.',
      entityRefs: ['widows-reach', 'pirate-brethren'],
    },
    'the-sunken-warship': {
      id: 'the-sunken-warship',
      title: 'The Sunken Warship',
      text:
        'The cannon-pocked hull of a naval sloop lies on a sandbar in Skeleton Cove, gun-ports ' +
        'still open. No one alive knows which crown she sailed for, and Old Mireille insists ' +
        'the not-knowing is the point.',
      entityRefs: ['skeleton-cove', 'old-mireille'],
    },
    'the-ghost-ship-omen': {
      id: 'the-ghost-ship-omen',
      title: 'The Ghost Ship Omen',
      text:
        'A full-rigged ship under all sail with no crew visible and no flag at her masthead is ' +
        'said to cross the Drowned Shoals before a bad storm. Sailors who claim to have seen ' +
        'her rarely tell the same story twice.',
      entityRefs: ['the-drowned-shoals'],
    },
    'the-guild-neutrality-pact': {
      id: 'the-guild-neutrality-pact',
      title: "The Guild's Neutrality Pact",
      text:
        "Marabel's charter forbids any crown or crew from raising arms within the city walls " +
        'on pain of the Guild closing its warehouses to the offender for a year — a penalty ' +
        'feared more than any navy.',
      entityRefs: ['free-city-of-marabel', 'free-traders-guild'],
    },
    'de-alvas-standing-order': {
      id: 'de-alvas-standing-order',
      title: "De Alva's Standing Order",
      text:
        'Fort Augustine’s battery has standing orders to fire on any vessel that cannot ' +
        'produce Crown papers within hailing distance. Commandant de Alva has never rescinded ' +
        'it, even in a storm.',
      entityRefs: ['fort-augustine', 'commandant-de-alva'],
    },
    'the-tropical-typhoon-season': {
      id: 'the-tropical-typhoon-season',
      title: 'Typhoon Season',
      text:
        'The Shoals turn treacherous for months each year: the barometer can drop like a ' +
        'stone and leave a ship fighting for its life in mountainous swells within the hour.',
      entityRefs: ['the-drowned-shoals'],
    },
  },

  // Small world-level rule-set hooks. Data only — the deterministic rules
  // engine that reads these (§5 ADJUDICATE, L-112 / #299) does not exist yet.
  rules: {
    startingLocationId: 'widows-reach',
    startingAbilities: ['seaworthy-vessel'],
  },
};
