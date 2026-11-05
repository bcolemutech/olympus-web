#!/usr/bin/env node

/**
 * Today's battle maps converted (planning/maps-from-data.md §4.7, EX4;
 * L-928 / #732): every battle map's walls, doors and obstacles stored as its
 * geometry and the layers deleted, with a replay showing each plays the same
 * on its geometry alone (functions/cartographer/convert-layers.js).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' APPLY=false node scripts/convert-map-layers.js [worldId…]
 *
 * APPLY=true writes; anything else is a dry run that writes nothing and
 * reports what it would change. Running it again changes nothing.
 *
 * Exit codes:
 *   0 - done
 *   1 - bad arguments
 *   3 - Firebase error
 */

import { createRequire } from 'module';
import { appendFileSync } from 'fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const require = createRequire(import.meta.url);
const convert = require('../functions/cartographer/convert-layers.js');

const apply = process.env.APPLY === 'true';
const worldIds = process.argv.slice(2).filter(Boolean);
if (worldIds.some((id) => !/^[a-z0-9-]{1,64}$/.test(id))) {
  console.error('Error: a world id is letters, digits and dashes.');
  process.exit(1);
}

let credential;
try {
  credential = process.env.FIREBASE_SERVICE_ACCOUNT
    ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    : undefined;
} catch {
  console.error('Error: FIREBASE_SERVICE_ACCOUNT is not valid JSON.');
  process.exit(1);
}

const where = (d) =>
  [d.from ? `from ${d.from}` : '', d.size || '', d.at ? `at (${d.at.x}, ${d.at.y})` : '']
    .filter(Boolean)
    .join(', ');

try {
  initializeApp(credential ? { credential } : {});
  const reports = await convert.run(getFirestore(), {
    apply,
    worldIds: worldIds.length ? worldIds : null,
  });
  const lines = [`## Battle maps converted (${apply ? 'applied' : 'dry run'})`, ''];
  for (const r of reports) {
    if (r.missing) {
      lines.push(`- **${r.worldId}:** no such world`);
      continue;
    }
    const rp = r.replay;
    lines.push(
      `### ${r.name} (${r.worldId})`,
      '',
      `- ${r.converted} maps (of ${r.maps} battle maps) have layers to convert; ` +
        `${apply ? 'stored' : 'would store'} their geometry and ` +
        `${apply ? 'deleted' : 'would delete'} their layers` +
        (r.changed === 0 ? ' (none: already converted).' : ':') +
        (r.changed ? ' ' + r.changedIds.join(', ') + (r.changed > 50 ? ', …' : '') + '.' : ''),
      `- ${r.gridCopies} grid maps' copies of their battle map's layers ` +
        `${apply ? 'deleted' : 'to delete'}.`,
      `- The replay: ${rp.matched} of ${rp.maps} maps play the same on their geometry alone ` +
        `(${rp.checks} checks: ways from each entry, exit, feature and figure, reach and sight).`,
      ...(rp.differences.length
        ? [
            '',
            `${rp.differences.length} answers differ:`,
            ...rp.differences.map(
              (d) =>
                `  - ${d.map}: ${d.check} ${where(d)}: ` +
                `before ${JSON.stringify(d.before)}, after ${JSON.stringify(d.after)}`
            ),
          ]
        : []),
      ...(r.problems.length
        ? [
            '',
            `${r.problems.length} to look at:`,
            ...r.problems.slice(0, 50).map((p) => `  - ${p}`),
          ]
        : []),
      ''
    );
  }
  const text = lines.join('\n');
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
  process.exit(0);
} catch (err) {
  console.error('Conversion failed:', err);
  process.exit(3);
}
