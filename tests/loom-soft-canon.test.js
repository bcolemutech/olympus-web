'use strict';

/**
 * Unit tests for functions/loom-turn/soft-canon.js (L-114 stub; L-115 fills
 * in the real quarantine write).
 *
 * Run: cd tests && npx jest loom-soft-canon --verbose
 */

const { quarantineEntities } = require('../functions/loom-turn/soft-canon');

describe('quarantineEntities (stub)', () => {
  it('resolves without throwing when inventedEntities is empty', async () => {
    await expect(
      quarantineEntities({
        transaction: {},
        db: {},
        worldId: 'shattered-coast',
        inventedEntities: [],
      })
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when inventedEntities is omitted', async () => {
    await expect(
      quarantineEntities({ transaction: {}, db: {}, worldId: 'shattered-coast' })
    ).resolves.toBeUndefined();
  });

  it('resolves without throwing when inventedEntities is non-empty (still a no-op)', async () => {
    await expect(
      quarantineEntities({
        transaction: {},
        db: {},
        worldId: 'shattered-coast',
        inventedEntities: ['a barkeep named Doral'],
      })
    ).resolves.toBeUndefined();
  });
});
