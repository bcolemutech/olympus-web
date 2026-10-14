'use strict';

/**
 * The image studio, wired for production (L-707, L-708, L-709): the library,
 * the cost ledger, styles and generation jobs over the Admin SDK, Cloud Storage, the Gemini
 * image models on Vertex and the studioRunJob task queue. Built once, on
 * first use, and shared by the callables, the task function and the
 * Cartographer connector's studio tools.
 */

let built;

// SVG references are drawn to PNG for the model (it reads PNG, JPEG, WebP).
function rasterize(bytes) {
  const { Resvg } = require('@resvg/resvg-js');
  const probe = new Resvg(Buffer.from(bytes).toString('utf8'));
  const long = Math.max(probe.width, probe.height) || 1;
  const fitTo =
    probe.width >= probe.height
      ? { mode: 'width', value: Math.round((probe.width / long) * 1024) }
      : { mode: 'height', value: Math.round((probe.height / long) * 1024) };
  return new Resvg(Buffer.from(bytes).toString('utf8'), { fitTo }).render().asPng();
}

function studio() {
  if (built) return built;
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const { createLibrary } = require('./library');
  const { createCosts } = require('./costs');
  const { createJobs } = require('./jobs');
  const { createStyles } = require('./styles');
  const { createImageModel } = require('./image-model');
  const loomCanon = require('../loom-canon');
  const town = require('../loom-canon/town');

  const db = getFirestore();
  const bucket = getStorage().bucket();
  const library = createLibrary({ db, bucket });
  const costs = createCosts({ db, FieldValue });
  const styles = createStyles({ db, library });
  const jobs = createJobs({
    db,
    library,
    costs,
    model: createImageModel(),
    enqueue: (data) => {
      const { getFunctions } = require('firebase-admin/functions');
      return getFunctions().taskQueue('studioRunJob').enqueue(data);
    },
    loadWorld: (worldId) => loomCanon.loadWorld(worldId, { db, playableOnly: false }),
    placesOf: town.placesOf,
    rasterize,
    styles,
    load: async (path) => (await bucket.file(path).download())[0],
    // An edit's new version (L-708): each world using the image is assigned it
    // again, through the Cartographer's service, so it holds the new size.
    refreshUses: async (record, uid) => {
      const { createCartographerService } = require('../cartographer/service');
      const { createFirestoreWorldWriter } = require('../mcp/apps/cartographer/writer');
      const service = createCartographerService({
        db,
        bucket,
        writer: createFirestoreWorldWriter(() => db),
      });
      const done = [];
      for (const use of record.usedIn || []) {
        await service.assignImage(uid, { ...use, imageId: record.id });
        done.push(use);
      }
      return done;
    },
  });
  built = { db, bucket, library, costs, jobs, styles };
  return built;
}

module.exports = { studio, rasterize };
