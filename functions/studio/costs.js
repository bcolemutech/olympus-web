'use strict';

const crypto = require('crypto');

/**
 * What the image studio spends (planning/the-image-studio.md §3 C1–C5, §4.5;
 * L-706 / #542). There is no spending limit, so every charged job's cost is
 * recorded, and the month's total is shown plainly: in the studio page's
 * header and in every studio tool result, with a warning once it passes the
 * figure.
 *
 *   studio_costs/{entryId}          one per charged job: { jobId, imageId,
 *                                   model, tier, kind, size, tokens, micros,
 *                                   usd, createdBy, via, failed, at, day,
 *                                   month }
 *   studio_costs_month/{yyyy-mm}    the month's running totals: { month,
 *                                   micros, count, days: { dd: { micros,
 *                                   count } }, models: { model: … }, who: {
 *                                   uid: { micros, count, page: …, mcp: … }
 *                                   }, updatedAt }
 *
 * Amounts are kept in micro-dollars (whole numbers), so adding them up never
 * drifts; they are shown in dollars. Days and months are UTC. An entry and
 * its month's totals are written in one batch, so the totals never miss an
 * entry. Both are written only by the server (the rules deny clients); the
 * page reads them through the studioCosts callable.
 */

// The warning figure: $50 a month (C4).
const WARN_AT_USD = 50;

/**
 * The price table (C1): Google's prices for the image models (checked
 * 2026-10-12, text rates 2026-10-14; functions/studio/config.js lists the
 * models), per million tokens (prompt, image output, and text and thinking
 * output) and per image by output size. A job is charged by the tokens the
 * provider reports, else per image. A model not listed here can't be charged
 * for, so it can't be run. Vertex's preview ids ("…-preview") share their
 * model's price.
 */
const PRICES = Object.freeze({
  // Gemini 3.1 Flash Image: 747 tokens at 512, 1120 at 1K, 1680 at 2K, 2520 at 4K.
  'gemini-3.1-flash-image': {
    perImage: { default: 0.067, 512: 0.045, '1k': 0.067, '2k': 0.101, '4k': 0.151 },
    perMillionTokens: { input: 0.5, output: 60, text: 3 },
  },
  // Gemini 3.1 Flash Lite Image: 1K only.
  'gemini-3.1-flash-lite-image': {
    perImage: { default: 0.0336, '1k': 0.0336 },
    perMillionTokens: { input: 0.25, output: 30, text: 1.5 },
  },
  // Gemini 3 Pro Image: 1120 tokens at 1K and 2K, 2000 at 4K.
  'gemini-3-pro-image': {
    perImage: { default: 0.134, '1k': 0.134, '2k': 0.134, '4k': 0.24 },
    perMillionTokens: { input: 2, output: 120, text: 12 },
  },
});

const MICROS = 1e6;
const VIAS = ['page', 'mcp'];

class CostError extends Error {
  constructor(message) {
    super(message);
    this.code = 'failed-precondition';
  }
}

const toMicros = (usd) => Math.round(usd * MICROS);
const toUsd = (micros) => Math.round(micros || 0) / MICROS;
// Dollars for reading: cents, or tenths of a cent below a dollar.
const money = (usd) => `$${usd < 1 && usd > 0 ? usd.toFixed(3) : usd.toFixed(2)}`;

/**
 * What a job costs, in dollars: by its token use when the provider reports
 * it and the model is priced by tokens, else per image at its size.
 */
function priceOf({ model, size, tokens, images = 1 }) {
  const price = PRICES[String(model || '').replace(/-preview$/, '')];
  if (!price) {
    throw new CostError(
      `No price for the model "${model}", so it can't be used. Known: ${Object.keys(PRICES).join(', ')}.`
    );
  }
  if (tokens && price.perMillionTokens) {
    // Image tokens (`output`) and text and thinking tokens (`text`) are
    // priced apart: thinking at the image price overcharged Pro by about 17%.
    const per = price.perMillionTokens;
    return (
      ((tokens.input || 0) * (per.input || 0) +
        (tokens.output || 0) * (per.output || 0) +
        (tokens.text || 0) * (per.text || per.output || 0)) /
      MICROS
    );
  }
  if (price.perImage) {
    const each = price.perImage[String(size || '').toLowerCase()] ?? price.perImage.default;
    return each * images;
  }
  throw new CostError(`The model "${model}" is priced by tokens; give the job's token use.`);
}

/** UTC month and day of a time: ['2026-10', '12']. */
function monthAndDay(ms) {
  const iso = new Date(ms).toISOString();
  return [iso.slice(0, 7), iso.slice(8, 10)];
}

/**
 * The cost line every studio tool result carries (C3, C5): what this call
 * cost, the month's total so far and the figure, and — once the month has
 * passed the figure — a plain warning.
 */
function costLine({ jobMicros = 0, monthMicros = 0, warnAt = WARN_AT_USD }) {
  const month = toUsd(monthMicros);
  const line = { job: toUsd(jobMicros), month, warnAt };
  if (month > warnAt) {
    line.warning =
      `WARNING: the image studio has spent ${money(month)} this month, past the ` +
      `${money(warnAt)} warning figure. There is no spending limit: every image made from ` +
      'now on adds to it.';
  }
  return line;
}

const tally = (node) => ({ usd: toUsd(node && node.micros), count: (node && node.count) || 0 });

function createCosts({ db, FieldValue, now = () => Date.now(), warnAt = WARN_AT_USD }) {
  const entries = () => db.collection('studio_costs');
  const months = () => db.collection('studio_costs_month');
  const thisMonth = () => monthAndDay(now())[0];

  /**
   * Records a charged job (or a failed one the provider charged for, §4.3)
   * and adds it to its month's totals, in one batch. `usd` overrides the
   * price table when the provider reports what it charged. Returns the entry
   * and the job's cost line.
   */
  async function record(job) {
    if (!job || typeof job.createdBy !== 'string' || !job.createdBy) {
      throw new CostError('A cost needs who asked (createdBy).');
    }
    if (!VIAS.includes(job.via)) throw new CostError('A cost is from the page or from MCP.');
    const usd = job.usd !== undefined ? job.usd : priceOf(job);
    if (!Number.isFinite(usd) || usd < 0) throw new CostError('A cost is a sum of dollars.');
    const micros = toMicros(usd);
    const at = now();
    const [month, day] = monthAndDay(at);
    const id = `cost_${crypto.randomBytes(8).toString('hex')}`;
    const entry = {
      id,
      jobId: job.jobId || null,
      imageId: job.imageId || null,
      model: job.model || null,
      tier: job.tier || null,
      kind: job.kind || null,
      size: job.size || null,
      tokens: job.tokens || null,
      failed: Boolean(job.failed),
      micros,
      usd: toUsd(micros),
      createdBy: job.createdBy,
      via: job.via,
      at,
      month,
      day,
    };
    const add = { micros: FieldValue.increment(micros), count: FieldValue.increment(1) };
    const batch = db.batch();
    batch.set(entries().doc(id), entry);
    // Nested objects with merge: keys such as model names (with dots) are
    // taken as they are, not as field paths.
    batch.set(
      months().doc(month),
      {
        month,
        ...add,
        days: { [day]: add },
        models: { [entry.model || 'unknown']: add },
        who: { [job.createdBy]: { ...add, [job.via]: add } },
        updatedAt: at,
      },
      { merge: true }
    );
    await batch.commit();
    const snap = await months().doc(month).get();
    return {
      entry,
      cost: costLine({ jobMicros: micros, monthMicros: snap.data().micros, warnAt }),
    };
  }

  /** The cost line for a call that made nothing: this month's total so far. */
  async function line(jobMicros = 0) {
    const snap = await months().doc(thisMonth()).get();
    return costLine({ jobMicros, monthMicros: snap.exists ? snap.data().micros : 0, warnAt });
  }

  /**
   * A month's totals (C2): the total, by day, by model and by who (each
   * editor, split by page and MCP), against the figure. `month` is yyyy-mm,
   * this month by default. `recent` adds its latest entries.
   */
  async function totals({ month, recent = 0 } = {}) {
    const at = month || thisMonth();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(at)) {
      throw new CostError('A month is written yyyy-mm, like 2026-10.');
    }
    const snap = await months().doc(at).get();
    const data = snap.exists ? snap.data() : {};
    const out = {
      month: at,
      total: toUsd(data.micros),
      count: data.count || 0,
      warnAt,
      days: Object.keys(data.days || {})
        .sort()
        .map((day) => ({ date: `${at}-${day}`, ...tally(data.days[day]) })),
      models: Object.entries(data.models || {})
        .map(([model, node]) => ({ model, ...tally(node) }))
        .sort((a, b) => b.usd - a.usd || a.model.localeCompare(b.model)),
      who: Object.entries(data.who || {})
        .map(([uid, node]) => ({
          uid,
          ...tally(node),
          page: tally(node.page),
          mcp: tally(node.mcp),
        }))
        .sort((a, b) => b.usd - a.usd || a.uid.localeCompare(b.uid)),
    };
    const line = costLine({ monthMicros: data.micros || 0, warnAt });
    if (line.warning) out.warning = line.warning;
    if (recent > 0) {
      const latest = await entries()
        .where('month', '==', at)
        .orderBy('at', 'desc')
        .limit(Math.min(recent, 100))
        .get();
      out.recent = latest.docs.map((doc) => {
        const e = doc.data();
        return {
          id: e.id,
          at: new Date(e.at).toISOString(),
          usd: e.usd,
          model: e.model,
          kind: e.kind,
          imageId: e.imageId,
          jobId: e.jobId,
          createdBy: e.createdBy,
          via: e.via,
          failed: e.failed,
        };
      });
    }
    return out;
  }

  return { record, line, totals, priceOf, warnAt };
}

module.exports = {
  createCosts,
  priceOf,
  costLine,
  monthAndDay,
  money,
  CostError,
  PRICES,
  WARN_AT_USD,
};
