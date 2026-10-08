'use strict';

/**
 * Unit tests for functions/loom-canon/ (L-103): resolving entities and their
 * snippets on a world object, and that there are no built-in worlds (L-686 /
 * #519): every world is a Cartographer world, loaded from Firestore. The
 * Shattered Coast survives only as a test fixture (tests/fixtures/coast-world.js).
 *
 * Pure module — no Firestore emulator required.
 *
 * Run: cd tests && npx jest loom-canon --verbose
 */

const loomCanon = require('../functions/loom-canon');
const { findEntity, entitySnippet, loadWorld } = loomCanon;
const { COAST } = require('./helpers/coast');

describe('no built-in worlds (L-686)', () => {
  it('the canon module has no static worlds to list or get', () => {
    for (const helper of [
      'listWorldIds',
      'getWorld',
      'getLocation',
      'getFaction',
      'getCharacter',
      'getLoreEntry',
      'getEntity',
      'getEntitySnippet',
    ]) {
      expect(loomCanon[helper]).toBeUndefined();
    }
  });

  it('the old built-in world id loads nothing without Firestore', async () => {
    expect(await loadWorld('shattered-coast')).toBeNull();
    expect(await loadWorld('shattered-coast', {})).toBeNull();
  });
});

describe('findEntity', () => {
  it('resolves a location id with type "location"', () => {
    expect(findEntity(COAST, 'widows-reach')).toEqual({
      type: 'location',
      entity: COAST.locations['widows-reach'],
    });
  });

  it('resolves a faction id with type "faction"', () => {
    expect(findEntity(COAST, 'spanish-crown').type).toBe('faction');
  });

  it('resolves a character id with type "character"', () => {
    expect(findEntity(COAST, 'commandant-de-alva').type).toBe('character');
  });

  it('returns null for an id that matches nothing, or no world', () => {
    expect(findEntity(COAST, 'nonexistent-entity')).toBeNull();
    expect(findEntity(null, 'widows-reach')).toBeNull();
  });
});

describe('entitySnippet', () => {
  it('includes the entity description and any lore entries that reference it', () => {
    const snippet = entitySnippet(COAST, 'skeleton-cove');
    expect(snippet).toContain('Skeleton Cove');
    expect(snippet).toContain('The Sunken Warship');
  });

  it('still returns a snippet for an entity with no referencing lore', () => {
    expect(entitySnippet(COAST, 'quartermaster-doone')).toContain('Quartermaster Doone');
  });

  it('returns null for an entity that does not exist', () => {
    expect(entitySnippet(COAST, 'nonexistent-entity')).toBeNull();
  });
});

describe('the coast fixture — structural integrity', () => {
  const world = COAST;

  it('is a world with geometry: a world map, and every location on it', () => {
    expect(world.map.width).toBeGreaterThan(0);
    expect(world.map.height).toBeGreaterThan(0);
    Object.values(world.locations).forEach(function (location) {
      expect(location.geo.x).toBeGreaterThanOrEqual(0);
      expect(location.geo.x).toBeLessThanOrEqual(world.map.width);
      expect(location.geo.y).toBeGreaterThanOrEqual(0);
      expect(location.geo.y).toBeLessThanOrEqual(world.map.height);
    });
  });

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
