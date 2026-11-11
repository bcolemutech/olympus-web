'use strict';

/**
 * Refreshes ../suite-times.json, the seconds each suite takes, which
 * helpers/sequencer.js balances CI's shards by. Give it Jest's JSON report
 * from a full run (every shard's, when run in shards):
 *
 *   cd tests && npx jest --json --outputFile=times.json   (with the emulators up)
 *   node helpers/suite-times.js times.json [more.json …]
 *
 * Only the ratios matter, so a run on any machine will do.
 */

const fs = require('fs');
const path = require('path');

const reports = process.argv.slice(2);
if (!reports.length) {
  console.error('Usage: node helpers/suite-times.js <jest --json report> […]');
  process.exit(1);
}
const times = {};
for (const file of reports) {
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const suite of report.testResults || []) {
    const seconds = Math.max(1, Math.round((suite.endTime - suite.startTime) / 1000));
    times[path.basename(suite.name)] = seconds;
  }
}
const sorted = Object.fromEntries(
  Object.entries(times).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
);
fs.writeFileSync(path.join(__dirname, '../suite-times.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`${Object.keys(sorted).length} suites written to suite-times.json`);
