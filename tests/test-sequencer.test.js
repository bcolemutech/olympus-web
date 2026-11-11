'use strict';

/**
 * CI's shards (helpers/sequencer.js): every suite runs in exactly one shard,
 * and the shards are balanced by the times in suite-times.json, a suite not
 * listed counting as DEFAULT_SECONDS. Pure.
 *
 * Run: cd tests && npx jest test-sequencer --verbose
 */

const fs = require('fs');
const path = require('path');
const { split, DEFAULT_SECONDS } = require('./helpers/sequencer');

const suites = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => ({ path: path.join(__dirname, f) }));
const times = JSON.parse(fs.readFileSync(path.join(__dirname, 'suite-times.json'), 'utf8'));
const weigh = (t) => times[path.basename(t.path)] || DEFAULT_SECONDS;

test.each([2, 3, 4, 5])('%i shards take every suite exactly once', (count) => {
  const shards = split(suites, count, times);
  expect(shards).toHaveLength(count);
  const all = shards.flatMap((s) => s.tests.map((t) => t.path)).sort();
  expect(all).toEqual(suites.map((t) => t.path).sort());
});

test('the shards are balanced: none longer than the shortest by more than the slowest suite', () => {
  const shards = split(suites, 4, times);
  const seconds = shards.map((s) => s.tests.reduce((sum, t) => sum + weigh(t), 0));
  const slowest = Math.max(...suites.map(weigh));
  expect(Math.max(...seconds) - Math.min(...seconds)).toBeLessThanOrEqual(slowest);
});

test('the split is the same whatever order the suites come in', () => {
  const names = (shards) => shards.map((s) => s.tests.map((t) => t.path));
  const reversed = suites.slice().reverse();
  expect(names(split(reversed, 4, times))).toEqual(names(split(suites, 4, times)));
});

test('a suite not in the times counts as the default', () => {
  const a = { path: '/x/new-a.test.js' };
  const b = { path: '/x/new-b.test.js' };
  const c = { path: '/x/slow.test.js' };
  const shards = split([a, b, c], 2, { 'slow.test.js': DEFAULT_SECONDS * 2 });
  expect(shards.map((s) => s.tests.map((t) => path.basename(t.path)))).toEqual([
    ['slow.test.js'],
    ['new-a.test.js', 'new-b.test.js'],
  ]);
});

test('the times are seconds, by suite file name', () => {
  for (const [name, seconds] of Object.entries(times)) {
    expect(name).toMatch(/\.test\.js$/);
    expect(Number.isInteger(seconds) && seconds > 0).toBe(true);
  }
});
