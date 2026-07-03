'use strict';

/**
 * Unit tests for functions/loom-canon/ (L-103).
 *
 * Pure module — no Firestore emulator required.
 *
 * Run: cd tests && npx jest loom-canon --verbose
 */

const {
  listWorldIds,
  getWorld,
  getLocation,
  getFaction,
  getCharacter,
  getLoreEntry,
  getEntity,
  getEntitySnippet,
} = require('../functions/loom-canon');

describe('listWorldIds', () => {
  it('includes the Phase 1 seed world', () => {
    expect(listWorldIds()).toContain('shattered-coast');
  });
});

describe('getWorld', () => {
  it('returns the world for a known id', () => {
    const world = getWorld('shattered-coast');
    expect(world).not.toBeNull();
    expect(world.id).toBe('shattered-coast');
    expect(world.name).toBe('The Shattered Coast');
  });

  it('returns null for an unknown world id', () => {
    expect(getWorld('nonexistent-world')).toBeNull();
  });

  it('is frozen — canon cannot be mutated at play time', () => {
    const world = getWorld('shattered-coast');
    expect(Object.isFrozen(world)).toBe(true);
    expect(Object.isFrozen(world.locations)).toBe(true);
    expect(Object.isFrozen(world.locations['widows-reach'])).toBe(true);

    expect(() => {
      'use strict';
      world.name = 'Hacked';
    }).toThrow();
    expect(getWorld('shattered-coast').name).toBe('The Shattered Coast');
  });
});

describe('getLocation / getFaction / getCharacter / getLoreEntry', () => {
  it('resolves a known location', () => {
    const location = getLocation('shattered-coast', 'widows-reach');
    expect(location).not.toBeNull();
    expect(location.name).toBe("Widow's Reach");
  });

  it('returns null for an unknown location', () => {
    expect(getLocation('shattered-coast', 'nonexistent')).toBeNull();
  });

  it('resolves a known faction', () => {
    const faction = getFaction('shattered-coast', 'pirate-brethren');
    expect(faction).not.toBeNull();
    expect(faction.disposition).toBe('friendly');
  });

  it('resolves a known character', () => {
    const character = getCharacter('shattered-coast', 'captain-orla-vance');
    expect(character).not.toBeNull();
    expect(character.locationId).toBe('widows-reach');
  });

  it('resolves a known lore entry', () => {
    const lore = getLoreEntry('shattered-coast', 'founding-of-widows-reach');
    expect(lore).not.toBeNull();
    expect(lore.entityRefs).toContain('widows-reach');
  });

  it('returns null for any lookup against an unknown world', () => {
    expect(getLocation('nope', 'widows-reach')).toBeNull();
    expect(getFaction('nope', 'pirate-brethren')).toBeNull();
    expect(getCharacter('nope', 'captain-orla-vance')).toBeNull();
    expect(getLoreEntry('nope', 'founding-of-widows-reach')).toBeNull();
  });
});

describe('getEntity', () => {
  it('resolves a location id with type "location"', () => {
    const result = getEntity('shattered-coast', 'widows-reach');
    expect(result).toEqual({ type: 'location', entity: getLocation('shattered-coast', 'widows-reach') });
  });

  it('resolves a faction id with type "faction"', () => {
    const result = getEntity('shattered-coast', 'spanish-crown');
    expect(result.type).toBe('faction');
  });

  it('resolves a character id with type "character"', () => {
    const result = getEntity('shattered-coast', 'commandant-de-alva');
    expect(result.type).toBe('character');
  });

  it('returns null for an id that matches nothing', () => {
    expect(getEntity('shattered-coast', 'nonexistent-entity')).toBeNull();
  });

  it('returns null for an unknown world', () => {
    expect(getEntity('nope', 'widows-reach')).toBeNull();
  });
});

describe('getEntitySnippet', () => {
  it('includes the entity description and any lore entries that reference it', () => {
    const snippet = getEntitySnippet('shattered-coast', 'skeleton-cove');
    expect(snippet).toContain('Skeleton Cove');
    expect(snippet).toContain('The Sunken Warship');
  });

  it('still returns a snippet for an entity with no referencing lore', () => {
    const snippet = getEntitySnippet('shattered-coast', 'quartermaster-doone');
    expect(snippet).toContain('Quartermaster Doone');
  });

  it('returns null for an entity that does not exist', () => {
    expect(getEntitySnippet('shattered-coast', 'nonexistent-entity')).toBeNull();
  });

  it('returns null for an unknown world', () => {
    expect(getEntitySnippet('nope', 'widows-reach')).toBeNull();
  });
});

describe('shattered-coast world content — structural integrity', () => {
  const world = getWorld('shattered-coast');

  it('every location connection points at another location that exists', () => {
    Object.values(world.locations).forEach(function (location) {
      location.connections.forEach(function (connectedId) {
        expect(world.locations[connectedId]).toBeDefined();
      });
    });
  });

  it('every location factionId/npcId reference resolves', () => {
    Object.values(world.locations).forEach(function (location) {
      location.factionIds.forEach(function (factionId) {
        expect(world.factions[factionId]).toBeDefined();
      });
      location.npcIds.forEach(function (npcId) {
        expect(world.characters[npcId]).toBeDefined();
      });
    });
  });

  it('every character factionId/locationId reference resolves', () => {
    Object.values(world.characters).forEach(function (character) {
      if (character.factionId) {
        expect(world.factions[character.factionId]).toBeDefined();
      }
      expect(world.locations[character.locationId]).toBeDefined();
    });
  });

  it('every lore entityRef resolves to a location, faction, or character', () => {
    Object.values(world.lore).forEach(function (loreEntry) {
      loreEntry.entityRefs.forEach(function (entityId) {
        const resolved =
          world.locations[entityId] || world.factions[entityId] || world.characters[entityId];
        expect(resolved).toBeDefined();
      });
    });
  });

  it('the starting location referenced by world.rules exists', () => {
    expect(world.locations[world.rules.startingLocationId]).toBeDefined();
  });
});
