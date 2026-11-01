#!/usr/bin/env node

/**
 * The map levels migration (planning/map-levels.md §4.4; L-902 / #720):
 * every world's world map, towns, town places and battle maps written into
 * maps and places, beside today's data (functions/cartographer/
 * migrate-levels.js). Saves are left as they are (none were left; decided
 * 2026-11-01).
 *
 * Usage:
 *   FIREBASE_SERVICE_ACCOUNT='<json>' APPLY=false node scripts/migrate-map-levels.js [worldId…]
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
const migrate = require('../functions/cartographer/migrate-levels.js');

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

try {
  initializeApp(credential ? { credential } : {});
  const reports = await migrate.run(getFirestore(), {
    apply,
    worldIds: worldIds.length ? worldIds : null,
  });
  const lines = [`## Map levels migration (${apply ? 'applied' : 'dry run'})`, ''];
  for (const r of reports) {
    if (r.missing) {
      lines.push(`- **${r.worldId}:** no such world`);
      continue;
    }
    const c = r.counts;
    const ch = r.changes;
    lines.push(
      `### ${r.name} (${r.worldId})`,
      '',
      `- Plans ${c.maps} maps (${c.regionMaps} region, ${c.areaMaps} area, ${c.gridMaps} grid), ` +
        `${c.places} new places, ${c.townPlaces} town places placed on their maps.`,
      `- ${apply ? 'Wrote' : 'Would write'}: ${ch.maps} maps, ${ch.places} places, ` +
        `${ch.townPlaces} town places, ${ch.world ? 'the world’s top map' : 'nothing on the world'}` +
        (ch.maps + ch.places + ch.townPlaces + ch.world === 0 ? ' (already migrated).' : '.'),
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
  console.error('Migration failed:', err);
  process.exit(3);
}
