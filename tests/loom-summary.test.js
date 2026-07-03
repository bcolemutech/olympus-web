'use strict';

/**
 * Unit tests for functions/loom-turn/summary.js (L-114 stub; L-116 fills in
 * the real regeneration).
 *
 * Run: cd tests && npx jest loom-summary --verbose
 */

const {
  SUMMARY_REGEN_THRESHOLD,
  shouldRegenerateSummary,
  maybeRegenerateSummary,
} = require('../functions/loom-turn/summary');

describe('shouldRegenerateSummary', () => {
  it('is false for turn indices before the threshold', () => {
    for (let i = 0; i < SUMMARY_REGEN_THRESHOLD - 1; i++) {
      expect(shouldRegenerateSummary(i)).toBe(false);
    }
  });

  it('is true exactly when the turn count completes a multiple of the threshold', () => {
    expect(shouldRegenerateSummary(SUMMARY_REGEN_THRESHOLD - 1)).toBe(true);
    expect(shouldRegenerateSummary(2 * SUMMARY_REGEN_THRESHOLD - 1)).toBe(true);
  });

  it('is false for turn indices between threshold multiples', () => {
    expect(shouldRegenerateSummary(SUMMARY_REGEN_THRESHOLD)).toBe(false);
  });
});

describe('maybeRegenerateSummary (stub)', () => {
  it('resolves without throwing', async () => {
    await expect(
      maybeRegenerateSummary({ db: {}, saveRef: {}, worldId: 'shattered-coast', turnIndex: 9 })
    ).resolves.toBeUndefined();
  });
});
