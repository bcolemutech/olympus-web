'use strict';

/**
 * The image studio's costs (planning/the-image-studio.md §4.5; L-706 / #542):
 * the price table, recording a job's cost with its month's totals in one
 * write, totals across days and months, the warning exactly once the month
 * passes the figure, and the studioCosts callable the page reads. Runs
 * against the Firestore emulator.
 *
 * Run: firebase emulators:exec --only firestore,storage --project demo-olympus-rules-test \
 *        "cd tests && npx jest studio-costs --verbose"
 */

const PROJECT = 'demo-studio-costs';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.FIREBASE_STORAGE_EMULATOR_HOST =
  process.env.FIREBASE_STORAGE_EMULATOR_HOST || '127.0.0.1:9199';
process.env.GCLOUD_PROJECT = PROJECT;

require('firebase-functions-test')(
  { projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` },
  null
);
const { studioCosts } = require('../functions/index');
const path = require('path');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const {
  createCosts,
  priceOf,
  costLine,
  monthAndDay,
  PRICES,
  WARN_AT_USD,
} = require('../functions/studio/costs');

const db = getFirestore();
const BUILDER = { uid: 'builder-001', token: { apps: ['cartographer'] } };
const PLAYER = { uid: 'player-001', token: { apps: ['loom'] } };

let clock = Date.parse('2026-10-30T23:30:00Z');
const costs = createCosts({ db, FieldValue, now: () => clock });
const flash = (fields = {}) => ({
  model: 'gemini-3.1-flash-image',
  createdBy: 'builder-001',
  via: 'mcp',
  kind: 'worldMap',
  ...fields,
});
const monthDoc = async (month) =>
  (await db.collection('studio_costs_month').doc(month).get()).data();

beforeAll(async () => {
  await db.recursiveDelete(db.collection('studio_costs'));
  await db.recursiveDelete(db.collection('studio_costs_month'));
});

afterAll(async () => {
  await db.terminate();
});

describe('the price table', () => {
  test('prices per image by size, or by tokens', () => {
    expect(priceOf({ model: 'gemini-3.1-flash-image' })).toBe(0.067);
    expect(priceOf({ model: 'gemini-3.1-flash-image', size: '512' })).toBe(0.045);
    expect(priceOf({ model: 'gemini-3-pro-image-preview', size: '4K' })).toBe(0.24);
    expect(priceOf({ model: 'gemini-3-pro-image', size: '2k' })).toBe(0.134);
    expect(priceOf({ model: 'gemini-3.1-flash-lite-image', images: 3 })).toBeCloseTo(0.1008, 10);
    // 2K from Pro: 1120 output tokens at $120 a million, and the prompt.
    expect(
      priceOf({ model: 'gemini-3-pro-image', tokens: { input: 1000, output: 1120 } })
    ).toBeCloseTo(0.002 + 0.1344, 10);
  });

  test('a model without a price can’t be charged for', () => {
    expect(() => priceOf({ model: 'some-new-model' })).toThrow(/No price for the model/);
    expect(Object.keys(PRICES).length).toBeGreaterThan(0);
    expect(WARN_AT_USD).toBe(50);
  });

  test('months and days are UTC', () => {
    expect(monthAndDay(Date.parse('2026-10-31T23:59:59Z'))).toEqual(['2026-10', '31']);
    expect(monthAndDay(Date.parse('2026-11-01T00:00:00Z'))).toEqual(['2026-11', '01']);
  });
});

describe('recording costs', () => {
  test('a job’s entry and its month’s totals, by day, model and who', async () => {
    const { entry, cost } = await costs.record(flash({ jobId: 'job_1', imageId: 'img_1' }));
    expect(entry).toMatchObject({
      jobId: 'job_1',
      imageId: 'img_1',
      model: 'gemini-3.1-flash-image',
      micros: 67000,
      usd: 0.067,
      month: '2026-10',
      day: '30',
      failed: false,
    });
    expect(cost).toEqual({ job: 0.067, month: 0.067, warnAt: 50 });
    const stored = (await db.collection('studio_costs').doc(entry.id).get()).data();
    expect(stored).toEqual(entry);
  });

  test('totals add up across days, models, editors and page or MCP', async () => {
    clock = Date.parse('2026-10-31T08:00:00Z'); // the next day
    // A minute apart, so "latest first" has one order.
    const later = () => {
      clock += 60000;
    };
    await costs.record(flash());
    later();
    await costs.record(flash({ via: 'page', createdBy: 'editor-002' }));
    later();
    await costs.record({
      model: 'gemini-3-pro-image-preview',
      size: '4k',
      createdBy: 'builder-001',
      via: 'page',
    });
    later();
    // A failed job the provider charged for still counts (§4.3).
    await costs.record(flash({ failed: true, usd: 0.01 }));

    const month = await monthDoc('2026-10');
    expect(month.micros).toBe(67000 * 3 + 240000 + 10000);
    expect(month.count).toBe(5);
    expect(month.days).toEqual({
      30: { micros: 67000, count: 1 },
      31: { micros: 67000 * 2 + 240000 + 10000, count: 4 },
    });
    // A model name with dots is one key, not a path.
    expect(month.models['gemini-3.1-flash-image']).toEqual({ micros: 67000 * 3 + 10000, count: 4 });

    const totals = await costs.totals({ month: '2026-10', recent: 2 });
    expect(totals).toMatchObject({
      month: '2026-10',
      total: 0.451,
      count: 5,
      warnAt: 50,
      days: [
        { date: '2026-10-30', usd: 0.067, count: 1 },
        { date: '2026-10-31', usd: 0.384, count: 4 },
      ],
      models: [
        { model: 'gemini-3-pro-image-preview', usd: 0.24, count: 1 },
        { model: 'gemini-3.1-flash-image', usd: 0.211, count: 4 },
      ],
      who: [
        {
          uid: 'builder-001',
          usd: 0.384,
          count: 4,
          page: { usd: 0.24, count: 1 },
          mcp: { usd: 0.144, count: 3 },
        },
        {
          uid: 'editor-002',
          usd: 0.067,
          count: 1,
          page: { usd: 0.067, count: 1 },
          mcp: { usd: 0, count: 0 },
        },
      ],
    });
    expect(totals.warning).toBeUndefined();
    expect(totals.recent).toHaveLength(2);
    expect(totals.recent.map((r) => [r.usd, r.failed])).toEqual([
      [0.01, true],
      [0.24, false],
    ]);
  });

  test('a new month starts from nothing', async () => {
    clock = Date.parse('2026-11-01T00:00:01Z');
    expect(await costs.line()).toEqual({ job: 0, month: 0, warnAt: 50 });
    const { cost } = await costs.record(flash());
    expect(cost).toEqual({ job: 0.067, month: 0.067, warnAt: 50 });
    expect((await costs.totals()).month).toBe('2026-11');
    expect((await monthDoc('2026-10')).count).toBe(5); // October unchanged
  });

  test('refuses a cost without who asked, or from elsewhere', async () => {
    await expect(costs.record(flash({ createdBy: '' }))).rejects.toThrow(/who asked/);
    await expect(costs.record(flash({ via: 'upload' }))).rejects.toThrow(/page or from MCP/);
    await expect(costs.record(flash({ model: 'mystery' }))).rejects.toThrow(/No price/);
    await expect(costs.totals({ month: '2026-13' })).rejects.toThrow(/yyyy-mm/);
  });
});

describe('the warning', () => {
  test('appears exactly when the month’s total passes the figure', async () => {
    clock = Date.parse('2026-12-05T12:00:00Z');
    // Exactly at the figure: no warning yet.
    let { cost } = await costs.record(flash({ usd: 49.99 }));
    expect(cost.warning).toBeUndefined();
    ({ cost } = await costs.record(flash({ usd: 0.01 })));
    expect(cost).toEqual({ job: 0.01, month: 50, warnAt: 50 });
    // A cent past it: the warning, on this result and every one after.
    ({ cost } = await costs.record(flash({ usd: 0.01 })));
    expect(cost.month).toBe(50.01);
    expect(cost.warning).toMatch(
      /WARNING: .*\$50\.01 this month, past the \$50\.00 warning figure/
    );
    expect((await costs.line()).warning).toMatch(/past the \$50\.00/);
    expect((await costs.totals()).warning).toMatch(/past the/);
  });

  test('the line reads plainly below a dollar', () => {
    expect(costLine({ jobMicros: 67000, monthMicros: 51e6 }).warning).toMatch(/\$51\.00/);
    expect(costLine({ monthMicros: 0 })).toEqual({ job: 0, month: 0, warnAt: 50 });
  });
});

describe('studioCosts (the page)', () => {
  test('gives the month’s totals against the figure, and the latest charges', async () => {
    const res = await studioCosts.run({ data: { month: '2026-10' }, auth: BUILDER });
    expect(res).toMatchObject({ month: '2026-10', total: 0.451, warnAt: 50, names: {} });
    expect(res.recent.length).toBe(5);
    expect(res.who.map((w) => w.uid)).toEqual(['builder-001', 'editor-002']);
  });

  test('refuses anyone without the claim, and a bad month', async () => {
    await expect(studioCosts.run({ data: {}, auth: PLAYER })).rejects.toMatchObject({
      code: 'permission-denied',
    });
    await expect(studioCosts.run({ data: {}, auth: null })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(
      studioCosts.run({ data: { month: 'October' }, auth: BUILDER })
    ).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
