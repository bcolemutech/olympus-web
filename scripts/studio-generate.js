#!/usr/bin/env node

/**
 * Makes images with the real model, by hand (planning/the-image-studio.md
 * §4.3; L-707 / #543): one image, or the big-map trial (M2). It runs the same
 * jobs the studio runs (functions/studio/jobs.js) against Vertex and
 * production, so every image goes into the library with its prompt and every
 * cost is recorded, under STUDIO_BY (default "script").
 *
 *   node scripts/studio-generate.js one "<prompt>" [--tier draft|final]
 *        [--model <id>] [--kind worldMap] [--size 1K|2K|4K] [--ratio 16:9]
 *   node scripts/studio-generate.js trial ["<prompt>"]
 *
 * The trial (M2) makes one world map three ways, for comparing:
 *   a. largest: Gemini 3 Pro Image at 4K, 16:9, in one go;
 *   b. upscale: a 1K draft, then Pro at 4K redrawing it from the draft;
 *   c. extend:  Pro at 2K, 1:1, for the middle, then Pro at 4K, 21:9,
 *               extending it outward on both sides.
 * The images are labelled "m2 trial", saved in --out (default studio-out/)
 * and summed up in studio-out/summary.md: size, seconds and cost per step.
 *
 * Spending money needs a confirmation: STUDIO_CONFIRM=spend (the Studio
 * Generate workflow passes its `confirm` input). FIREBASE_SERVICE_ACCOUNT
 * (the key JSON) gives both Firestore and Vertex access; the account needs
 * the Vertex AI User role.
 */

import { createRequire } from 'module';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const require = createRequire(import.meta.url);
const { createLibrary } = require('../functions/studio/library.js');
const { createCosts, money } = require('../functions/studio/costs.js');
const { createJobs } = require('../functions/studio/jobs.js');
const { createImageModel } = require('../functions/studio/image-model.js');
const { rasterize } = require('../functions/studio/index.js');
const { FORMATS } = require('../functions/studio/formats.js');

const DEFAULT_MAP =
  'A fantasy world map of a large continent and its islands, in the style of an old ' +
  'hand-drawn atlas: ink linework on aged parchment, mountain ranges drawn as small peaks, ' +
  'forests as clustered trees, rivers running to the sea, a compass rose. No text or labels.';

function flag(args, name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

function connect() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('Set FIREBASE_SERVICE_ACCOUNT (the key JSON).');
    process.exit(1);
  }
  const account = JSON.parse(raw);
  // Vertex reads the same key through Application Default Credentials.
  const keyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-')), 'key.json');
  fs.writeFileSync(keyFile, raw, { mode: 0o600 });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFile;
  process.env.GCLOUD_PROJECT = account.project_id;
  initializeApp({ credential: cert(account), projectId: account.project_id });
  const bucketName =
    process.env.FIREBASE_STORAGE_BUCKET || `${account.project_id}.firebasestorage.app`;
  return { db: getFirestore(), bucket: getStorage().bucket(bucketName) };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (!['one', 'trial'].includes(mode)) {
    console.error('Usage: studio-generate.js one "<prompt>" [...] | trial ["<prompt>"]');
    process.exit(1);
  }
  if (process.env.STUDIO_CONFIRM !== 'spend') {
    console.error('This spends money on the image model: set STUDIO_CONFIRM=spend to run it.');
    process.exitCode = 1;
    return;
  }
  const out = flag(args, 'out', 'studio-out');
  fs.mkdirSync(out, { recursive: true });
  const by = process.env.STUDIO_BY || 'script';

  const { db, bucket } = connect();
  const library = createLibrary({ db, bucket });
  const costs = createCosts({ db, FieldValue });
  const jobs = createJobs({
    db,
    library,
    costs,
    model: createImageModel(),
    enqueue: async () => {}, // run here, below
    loadWorld: async () => null,
    placesOf: () => [],
    rasterize,
    load: async (at) => (await bucket.file(at).download())[0],
  });

  const rows = [];
  // Makes one image and saves it; returns its library record.
  async function make(step, request) {
    const t0 = Date.now();
    const job = await jobs.start(by, { kind: 'worldMap', ...request }, 'mcp');
    await jobs.run(job.id);
    const done = await jobs.getJob(job.id);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    if (done.state !== 'done') {
      console.log(`${step}: FAILED after ${seconds}s: ${done.error}`);
      rows.push({ step, failed: done.error, seconds, cost: done.cost || 0 });
      return null;
    }
    const record = await library.getImage(done.imageId);
    const version = record.versions[0];
    const file = path.join(
      out,
      `${step.replace(/[^a-z0-9]+/gi, '-')}.${FORMATS[version.format].ext}`
    );
    fs.writeFileSync(file, (await bucket.file(version.path).download())[0]);
    const row = {
      step,
      model: done.request.model,
      size: `${version.width}×${version.height}`,
      asked: `${done.request.size} ${done.request.aspectRatio || ''}`.trim(),
      bytes: version.bytes,
      seconds,
      cost: done.cost,
      tokens: done.usage,
      imageId: record.id,
      link: record.link,
      file,
    };
    rows.push(row);
    console.log(`${step}: ${row.size} in ${seconds}s for ${money(done.cost)} → ${record.id}`);
    if (done.note) console.log(`  the model said: ${done.note}`);
    return record;
  }

  if (mode === 'one') {
    const prompt = args[1] && !args[1].startsWith('--') ? args[1] : DEFAULT_MAP;
    await make('one', {
      prompt,
      kind: flag(args, 'kind', 'worldMap'),
      tier: flag(args, 'model') ? undefined : flag(args, 'tier', 'draft'),
      model: flag(args, 'model'),
      size: flag(args, 'size'),
      aspectRatio: flag(args, 'ratio'),
      labels: ['by hand'],
    });
  } else {
    const prompt = args[1] && !args[1].startsWith('--') ? args[1] : DEFAULT_MAP;
    const labels = ['m2 trial'];
    const pro = 'gemini-3-pro-image';
    await make('a-largest-4k', {
      prompt,
      model: pro,
      size: '4K',
      aspectRatio: '16:9',
      title: 'M2 trial a: Pro at 4K',
      labels,
    });
    const draft = await make('b1-draft-1k', {
      prompt,
      tier: 'draft',
      aspectRatio: '16:9',
      title: 'M2 trial b1: the 1K draft',
      labels,
    });
    if (draft) {
      await make('b2-upscaled-4k', {
        prompt:
          'Redraw this map exactly, at full detail: the same coastlines, mountains, rivers ' +
          'and layout, sharper and finer. Change nothing else.',
        model: pro,
        size: '4K',
        aspectRatio: '16:9',
        references: [draft.id],
        title: 'M2 trial b2: the draft redrawn at 4K',
        labels,
      });
    }
    const middle = await make('c1-middle-2k', {
      prompt,
      model: pro,
      size: '2K',
      aspectRatio: '1:1',
      title: 'M2 trial c1: the middle',
      labels,
    });
    if (middle) {
      await make('c2-extended-4k', {
        prompt:
          'This map is the middle of a wider one. Extend it outward to the left and right ' +
          'into a wide map, keeping the middle exactly as it is and continuing its ' +
          `coastlines, mountains and style seamlessly. ${prompt}`,
        model: pro,
        size: '4K',
        aspectRatio: '21:9',
        references: [middle.id],
        title: 'M2 trial c2: extended outward',
        labels,
      });
    }
  }

  const total = rows.reduce((sum, r) => sum + (r.cost || 0), 0);
  const lines = [
    `# Studio generation (${mode})`,
    '',
    '| Step | Model | Asked | Got | Seconds | Cost | Image |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      r.failed
        ? `| ${r.step} | | | FAILED: ${r.failed} | ${r.seconds} | ${money(r.cost)} | |`
        : `| ${r.step} | ${r.model} | ${r.asked} | ${r.size} | ${r.seconds} | ${money(r.cost)} | ${r.imageId} |`
    ),
    '',
    `Total: ${money(total)}. Month so far: ${money((await costs.line()).month)}.`,
  ];
  fs.writeFileSync(path.join(out, 'summary.md'), lines.join('\n') + '\n');
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(rows, null, 2));
  console.log(lines.join('\n'));
  if (rows.some((r) => r.failed)) process.exitCode = 1;
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
