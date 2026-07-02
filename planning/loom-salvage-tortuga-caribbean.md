# Loom Salvage — Tortuga Caribbean Setting

Companion to `planning/tortuga-design.md` (superseded, see its banner) and
`planning/the-loom-design.md` §9 (Tortuga retirement). Captures the
hand-authored flavor content from the Tortuga app's source code — content that
lived only in JS config/data, not in the design doc — ahead of Tortuga's code
removal (L-007 / #292). Parked for L-301 (#315, "Convert Caribbean/VO settings
into worlds") to draw from when the Caribbean becomes an actual Loom world.

This document is self-contained — it does not depend on the Tortuga app or its
source files remaining in the repository.

---

## 1. Starter ships (flavor descriptions)

Source: `public/apps/tortuga/play/ship-types.js`. Stat values (hull/sails/guns/
crew/speed/etc.) are Tortuga-specific game mechanics already captured in
`tortuga-design.md` §5 — not reproduced here. What's preserved is the prose,
which existed only in code:

- **Sloop** ⛵ — "A nimble single-masted raider. Fast enough to close, agile
  enough to disengage, and small enough to hide in coves no patrol dares
  follow."
- **Schooner** 🚢 — "A two-masted workhorse that earns her keep on trade runs.
  Generous hold, good speed, and enough guns to discourage casual trouble."
- **Cutter** ⚔️ — "A stout fore-and-aft rigged warship favored by privateers.
  She takes a punch better than anything her size, and her broadside makes
  escorts think twice."
- **Pinnace** 🛶 — "A tiny open-decked scout. No ship in the archipelago is
  faster or harder to spot. She slips through shallows that strand heavier
  vessels."

## 2. Era faction catalogs (Cartographer overlay generator)

Source: `public/apps/tortuga/cartographer/overlay.js` (`ERA_FACTION_CATALOG`).
The Cartographer's Azgaar-import overlay mapped generated world states onto
one of four historical/genre eras, each with its own faction archetype set —
useful reference if a future Loom world wants period-flavored factions instead
of generic ones.

**Caribbean golden age** (the setting L-301 will actually convert):
- Spanish Crown (`spanish_crown`, `#c8a000`)
- British Crown (`british_crown`, `#8b0000`)
- French Crown (`french_crown`, `#00408b`)
- Dutch Trading Co. (`dutch_trading_co`, `#005e00`)
- Indigenous Confederacy (`indigenous_confederacy`, `#7a5200`)
- Free City (`free_city`, `#555555`)

**Mediterranean corsair** (unused era preset, kept for reference):
- Ottoman Regency, Venetian Republic, Papal States, Corsair Republic, Free City

**Indian Ocean** (unused era preset, kept for reference):
- Mughal Empire, Portuguese Estado, Arab Sultanate, East India Company, Free City

**Freeform / fantasy** (unused era preset, kept for reference):
- Realm, Confederacy, Guild, Free City

**Always present regardless of era:** Pirate Brethren (`pirate_brethren`,
`#222222`) — a synthetic faction with no Azgaar state backing, representing
the player's own kind.

## 3. Hidden cove names

Source: `public/apps/tortuga/cartographer/overlay.js` (`COVE_NAMES`). Flavor
names for procedurally-placed hidden coves — good ready-made location names
for a Caribbean Loom world's canon:

> The Devil's Notch · Wraith's Anchorage · Corsair's Inlet · The Blind Eye ·
> Widow's Reach · Skeleton Cove · The Rat's Hole · Murk Bay · The Forgotten
> Shore · Jackal's Landing · Serpent Cove · The Dark Passage

## 4. World-event narrative prose

Source: `public/apps/tortuga/play/event-packs.js` (`T.EVENT_PACKS`). Random
travel events with multiple narrative variants each (one picked at random per
occurrence) — this prose existed only in code, not in the design doc. Useful
as narration seed material for the Loom's NARRATE stage or as soft-canon
flavor events.

**Storms**

- *Sudden Squall* —
  - "Black clouds pile on the horizon with frightening speed. The lookout
    shouts 'All hands!' before the first wave crashes over the bow."
  - "A wall of rain sweeps in from the east. Lightning splits the sky as the
    wind tears at the rigging."
  - "Without warning the sea turns from grey to green. The crew scramble to
    furl sail before the gust hits."
- *Tropical Typhoon* —
  - "A full typhoon closes from the south-west. For three hours the ship is
    at the mercy of the sea."
  - "The barometer drops like a stone. By nightfall the flagship is fighting
    for her life in mountainous swells."

**Wreckage**

- *Merchant Wreck* —
  - "A shattered hull bobs in the swell — a merchant brig, recently broken
    apart. Barrels and bales drift around her."
  - "Smoke still rises from a beached wreck on a reef ahead. The crew spot
    cargo floating free."
  - "Half-submerged crates mark the grave of an unlucky merchantman. No
    survivors, but her cargo endures."
- *Sunken Warship* —
  - "The cannon-pocked hull of a naval sloop lies on a sandbar. Powder and
    shot litter the shallows."
  - "A patrol frigate, caught by some terrible broadside, rests
    half-submerged. Her gun-ports are still open."

**Sightings**

- *Giant Sea Turtle* —
  - "A leatherback the size of a jolly-boat surfaces alongside the flagship,
    regarding the crew with an ancient eye before diving."
  - "The helmsman nearly puts the wheel hard over when a great shell breaks
    the surface ahead. The old hands assure the young ones it is a good
    omen."
- *Ghost Ship* —
  - "A full-rigged ship glides through the fog under all sail — no crew
    visible, no flag at her masthead. She rounds a headland and vanishes."
  - "The night watch wakes the captain: a dark vessel with no running lights
    crosses the flagship's bows without a sound."
- *Pod of Whales* —
  - "A pod of sperm whales breaches off the starboard bow, soaking the watch
    with spray and drawing a cheer from the crew."
  - "Fins cut the water all around. The flagship picks her way through a
    gathering of giants, close enough to touch."
- *Distant Fleet* —
  - "A dozen sails are counted on the horizon before they disappear into
    haze. Their flag is impossible to make out."
  - "The lookout reports a column of smoke, then topgallants — a fleet,
    moving fast. They pass without incident."

## 5. Status

- Content above is preserved independent of the live Tortuga app.
- `planning/tortuga-design.md` remains in the repo (marked superseded, not
  deleted) as the primary source for mechanical/structural design content
  (ship stats, factions schema, settlement types, etc.).
- This document captures only the hand-authored prose/flavor data that lived
  in code and would otherwise have been lost on app removal.
- Tortuga app code itself is untouched by this document — removal is scoped
  to L-007 (#292).
