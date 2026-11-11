'use strict';

/**
 * Splits the suites between CI's shards by how long they take, so the shards
 * finish together (.github/workflows/firestore-rules.yml runs them at once,
 * each with its own emulators; jest --shard=i/n).
 *
 * Jest's own split takes the suites in order of a hash of their paths, so
 * the slow ones (headless Chrome, MCP through the emulators, images) can
 * clump in one shard. Here every suite is weighed by its time in
 * ../suite-times.json (seconds, from a full run; a suite not listed counts
 * as DEFAULT_SECONDS) and dealt slowest first to the shard with the least so
 * far. Every shard works the split out from the same list and the same file,
 * so each suite runs in exactly one.
 *
 * Without --shard (npm test, locally) nothing changes: every suite runs, in
 * Jest's own order. Refresh the times with helpers/suite-times.js.
 */

const path = require('path');
const fs = require('fs');
const Sequencer = require('@jest/test-sequencer').default;

const DEFAULT_SECONDS = 3;

function readTimes() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, '../suite-times.json'), 'utf8'));
  } catch {
    return {};
  }
}

/** Which suites go in each of `count` shards: arrays of tests, balanced by time. */
function split(tests, count, times = readTimes()) {
  const weigh = (t) => {
    const seconds = times[path.basename(t.path)];
    return typeof seconds === 'number' && seconds > 0 ? seconds : DEFAULT_SECONDS;
  };
  const name = (t) => path.basename(t.path);
  const ordered = tests
    .slice()
    .sort((a, b) => weigh(b) - weigh(a) || (name(a) < name(b) ? -1 : name(a) > name(b) ? 1 : 0));
  const shards = Array.from({ length: count }, () => ({ tests: [], seconds: 0 }));
  for (const test of ordered) {
    // The lightest shard; the first of them on a tie.
    let least = shards[0];
    for (const s of shards) if (s.seconds < least.seconds) least = s;
    least.tests.push(test);
    least.seconds += weigh(test);
  }
  return shards;
}

class BalancedSequencer extends Sequencer {
  shard(tests, { shardIndex, shardCount }) {
    return split(tests, shardCount)[shardIndex - 1].tests;
  }
}

module.exports = BalancedSequencer;
module.exports.split = split;
module.exports.DEFAULT_SECONDS = DEFAULT_SECONDS;
