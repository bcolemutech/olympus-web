'use strict';

// Parser and validator for Azgaar Fantasy Map Generator "Save as JSON" full
// exports — step 1 of the Cartographer's programmatic load (design
// planning/the-cartographer-design.md §3.2; C-2 / #369).
//
// parseAzgaarExport(input) accepts the raw upload (Buffer or string) or an
// already-parsed object and returns a normalized ParsedMap, or throws an
// AzgaarFormatError with a message fit to show the uploader. It is pure: no
// I/O, no Firebase, and the input is never mutated.
//
// Everything downstream (the mapper, C-3) reads only this shape, never raw
// Azgaar fields. Ids are Azgaar's own numeric `i` values; the mapper turns them
// into Loom ids. `stateId` / `provinceId` 0 means "none".
//
//   ParsedMap
//     source       { format: 'azgaar-json', version, seed, mapName, exportedAt, width, height }
//     scale        { populationRate, urbanization, distanceUnit, distanceScale }
//     biomes       [{ id, name, color }]
//     features     [{ id, type, cells }]                    — 'island' | 'ocean' | 'lake' | …
//     settlements  [{ id, name, x, y, cellId, featureId, stateId, provinceId, biomeId,
//                     population, port, capital, type, group }]   — population in people
//     states       [{ id, name, fullName, form, formName, color, capitalSettlementId,
//                     relations: { [stateId]: relation } }]
//     provinces    [{ id, name, fullName, formName, stateId, capitalSettlementId, color }]
//     routes       [{ id, kind: 'road' | 'trail' | 'sea', name, cellIds }]
//     markers      [{ id, type, icon, name, note, x, y, cellId, featureId, settlementId }]
//     warnings     [{ code, message, count }]
//
// Tested against Azgaar 1.153.1 (tests/fixtures/azgaar/nisia.json).

const TESTED_VERSION = [1, 153];
const MAX_BYTES = 50 * 1024 * 1024;
const LIMITS = {
  cells: 500_000,
  settlements: 20_000,
  states: 2_000,
  provinces: 10_000,
  routes: 50_000,
  markers: 5_000,
};
const MAX_NAME = 100;
const MAX_NOTE = 2_000;

const RELATIONS = {
  ally: 'ally',
  friendly: 'friendly',
  neutral: 'neutral',
  suspicion: 'suspicion',
  enemy: 'enemy',
  rival: 'rival',
  vassal: 'vassal',
  suzerain: 'suzerain',
  unknown: 'unknown',
};
const ROUTE_KINDS = { roads: 'road', trails: 'trail', searoutes: 'sea' };

class AzgaarFormatError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AzgaarFormatError';
    this.code = code;
  }
}

const fail = (code, message) => {
  throw new AzgaarFormatError(code, message);
};

// Collects warnings by code so one problem repeated a thousand times is one
// line with a count, not a thousand lines.
function createWarnings() {
  const byCode = new Map();
  return {
    add(code, message) {
      const existing = byCode.get(code);
      if (existing) existing.count += 1;
      else byCode.set(code, { code, message, count: 1 });
    },
    list: () => [...byCode.values()],
  };
}

const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
function cleanText(value, max, { multiline = false } = {}) {
  if (typeof value !== 'string') return '';
  // Normalize line endings first, so \r (a control character) isn't turned
  // into a stray space before the \n it belongs to.
  let text = value.replace(/\r\n?/g, '\n').replace(CONTROL, ' ');
  if (!multiline) text = text.replace(/\s+/g, ' ');
  return text.trim().slice(0, max);
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isIndex = (v, length) => Number.isInteger(v) && v >= 0 && v < length;

// Real entries only: Azgaar keeps a placeholder at index 0 of burgs, states
// and provinces, and marks deletions with `removed` rather than splicing.
const realEntries = (list) =>
  Array.isArray(list)
    ? list.filter((e) => e && Number.isInteger(e.i) && e.i > 0 && !e.removed)
    : [];

function readInput(input, maxBytes) {
  if (Buffer.isBuffer(input) || typeof input === 'string') {
    const bytes = Buffer.isBuffer(input) ? input.length : Buffer.byteLength(input);
    if (bytes > maxBytes) {
      fail(
        'too_large',
        `The file is ${Math.round(bytes / 1e6)} MB; the limit is ${Math.round(maxBytes / 1e6)} MB.`
      );
    }
    try {
      return JSON.parse(Buffer.isBuffer(input) ? input.toString('utf8') : input);
    } catch {
      fail(
        'not_json',
        'This file is not JSON. In Azgaar, use Save → "Save as JSON" (not the .map file or another export).'
      );
    }
  }
  return input;
}

function checkShape(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    fail('not_azgaar', 'This is not an Azgaar map export.');
  }
  if (doc.type === 'FeatureCollection') {
    fail('geojson', 'This is a GeoJSON export. In Azgaar, use Save → "Save as JSON" instead.');
  }
  const { info, pack } = doc;
  if (!info || typeof info !== 'object' || !pack || typeof pack !== 'object') {
    fail('not_azgaar', 'This is not an Azgaar "Save as JSON" export (no map info or data pack).');
  }
  if (
    !(
      isFiniteNumber(info.width) &&
      info.width > 0 &&
      isFiniteNumber(info.height) &&
      info.height > 0
    )
  ) {
    fail('invalid_dimensions', 'The export is missing valid map dimensions.');
  }
  for (const key of ['cells', 'burgs', 'states']) {
    if (!Array.isArray(pack[key])) {
      fail(
        'not_azgaar',
        `The export is incomplete: it has no ${key} data. Re-export with "Save as JSON".`
      );
    }
  }
  for (const [key, max] of Object.entries(LIMITS)) {
    const source = key === 'settlements' ? pack.burgs : pack[key];
    if (Array.isArray(source) && source.length > max) {
      fail('too_many', `The map has too many ${key} (${source.length}; the limit is ${max}).`);
    }
  }
}

function versionOlderThanTested(version) {
  const parts = String(version || '')
    .split('.')
    .map((n) => parseInt(n, 10));
  if (!parts.length || parts.some(Number.isNaN)) return true;
  for (let i = 0; i < TESTED_VERSION.length; i += 1) {
    const a = parts[i] || 0;
    if (a !== TESTED_VERSION[i]) return a < TESTED_VERSION[i];
  }
  return false;
}

function parseBiomes(doc, warnings) {
  const { pack } = doc;
  if (Array.isArray(pack.biomes) && pack.biomes.length) {
    return pack.biomes
      .filter((b) => b && Number.isInteger(b.i))
      .map((b) => ({ id: b.i, name: cleanText(b.name, MAX_NAME), color: b.color || null }));
  }
  // Older exports: parallel arrays in a top-level biomesData.
  const data = doc.biomesData;
  if (data && Array.isArray(data.name)) {
    return data.name.map((name, i) => ({
      id: i,
      name: cleanText(name, MAX_NAME),
      color: (Array.isArray(data.color) && data.color[i]) || null,
    }));
  }
  warnings.add('biomes_missing', 'The export has no biome list; terrain types will be unknown.');
  return [];
}

function parseAzgaarExport(input, { maxBytes = MAX_BYTES } = {}) {
  const doc = readInput(input, maxBytes);
  checkShape(doc);

  const { info, pack } = doc;
  const settings = doc.settings || {};
  const warnings = createWarnings();
  const cells = pack.cells;

  if (versionOlderThanTested(info.version)) {
    warnings.add(
      'version_untested',
      `Azgaar version ${info.version || 'unknown'} is older than the tested ${TESTED_VERSION.join('.')}; some data may be missing.`
    );
  }

  const biomes = parseBiomes(doc, warnings);
  const biomeIds = new Set(biomes.map((b) => b.id));

  let features = [];
  if (Array.isArray(pack.features)) {
    features = pack.features
      .filter((f) => f && Number.isInteger(f.i))
      .map((f) => ({
        id: f.i,
        type: typeof f.type === 'string' ? f.type : 'unknown',
        cells: f.cells || 0,
      }));
  } else {
    warnings.add(
      'features_missing',
      'The export has no landmass data; landmasses will be unknown.'
    );
  }

  const stateIds = new Set(realEntries(pack.states).map((s) => s.i));
  const provinceIds = new Set(realEntries(pack.provinces).map((p) => p.i));
  const populationRate = isFiniteNumber(settings.populationRate) ? settings.populationRate : 1000;
  const urbanization = isFiniteNumber(settings.urbanization) ? settings.urbanization : 1;

  const cellAt = (cellId) => (isIndex(cellId, cells.length) && cells[cellId]) || null;
  const featureOf = (cell) => (cell && Number.isInteger(cell.f) ? cell.f : null);

  // ── Settlements ───────────────────────────────────────────────────────
  const settlements = [];
  for (const b of realEntries(pack.burgs)) {
    const cell = cellAt(b.cell);
    if (!cell || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) {
      warnings.add(
        'settlement_invalid',
        'Some settlements had no valid position and were skipped.'
      );
      continue;
    }
    let stateId = Number.isInteger(b.state) ? b.state : 0;
    if (stateId !== 0 && !stateIds.has(stateId)) {
      warnings.add(
        'settlement_state_missing',
        'Some settlements belong to a state that no longer exists.'
      );
      stateId = 0;
    }
    const provinceId =
      Number.isInteger(cell.province) && provinceIds.has(cell.province) ? cell.province : 0;
    settlements.push({
      id: b.i,
      name: cleanText(b.name, MAX_NAME),
      x: b.x,
      y: b.y,
      cellId: b.cell,
      featureId: Number.isInteger(b.feature) ? b.feature : featureOf(cell),
      stateId,
      provinceId,
      biomeId: Number.isInteger(cell.biome) && biomeIds.has(cell.biome) ? cell.biome : null,
      population: isFiniteNumber(b.population)
        ? Math.max(0, Math.round(b.population * populationRate * urbanization))
        : 0,
      port: Boolean(b.port),
      capital: Boolean(b.capital),
      type: typeof b.type === 'string' ? b.type : null,
      group: typeof b.group === 'string' ? b.group : null,
    });
  }
  if (settlements.length === 0) {
    fail(
      'no_settlements',
      'The map has no settlements. Add some burgs in Azgaar and export again.'
    );
  }
  const settlementIds = new Set(settlements.map((s) => s.id));
  const settlementOrNull = (id) => (Number.isInteger(id) && settlementIds.has(id) ? id : null);

  // ── States (factions) ─────────────────────────────────────────────────
  const states = realEntries(pack.states).map((s) => {
    const relations = {};
    if (Array.isArray(s.diplomacy)) {
      s.diplomacy.forEach((value, otherId) => {
        // Index 0 is the Neutrals placeholder; `x` marks the state itself.
        if (otherId === 0 || otherId === s.i || !stateIds.has(otherId) || value === 'x') return;
        const relation = typeof value === 'string' ? RELATIONS[value.toLowerCase()] : undefined;
        if (relation) relations[otherId] = relation;
        else
          warnings.add(
            'relation_unknown',
            'Some diplomatic relations had unrecognized values and were skipped.'
          );
      });
    }
    const capitalSettlementId = settlementOrNull(s.capital);
    if (s.capital && capitalSettlementId === null) {
      warnings.add('state_capital_missing', 'Some states have a capital that no longer exists.');
    }
    return {
      id: s.i,
      name: cleanText(s.name, MAX_NAME),
      fullName: cleanText(s.fullName || s.name, MAX_NAME),
      form: typeof s.form === 'string' ? s.form : null,
      formName: typeof s.formName === 'string' ? s.formName : null,
      color: typeof s.color === 'string' ? s.color : null,
      capitalSettlementId,
      relations,
    };
  });

  // ── Provinces (regions) ───────────────────────────────────────────────
  const provinces = realEntries(pack.provinces).map((p) => ({
    id: p.i,
    name: cleanText(p.name, MAX_NAME),
    fullName: cleanText(p.fullName || p.name, MAX_NAME),
    formName: typeof p.formName === 'string' ? p.formName : null,
    stateId: Number.isInteger(p.state) && stateIds.has(p.state) ? p.state : 0,
    capitalSettlementId: settlementOrNull(p.burg),
    color: typeof p.color === 'string' ? p.color : null,
  }));

  // ── Routes (connections) ──────────────────────────────────────────────
  const routes = [];
  if (!Array.isArray(pack.routes)) {
    warnings.add(
      'routes_missing',
      'The export has no routes (older Azgaar versions); connections will be inferred from nearby settlements.'
    );
  } else {
    for (const r of pack.routes) {
      if (!r || !Array.isArray(r.points)) continue;
      const cellIds = r.points
        .map((point) => (Array.isArray(point) ? point[2] : undefined))
        .filter((cellId) => isIndex(cellId, cells.length));
      if (cellIds.length < 2) {
        warnings.add(
          'route_invalid',
          'Some routes had fewer than two valid points and were skipped.'
        );
        continue;
      }
      let kind = ROUTE_KINDS[r.group];
      if (!kind) {
        warnings.add(
          'route_kind_unknown',
          'Some routes had an unrecognized type and were treated as trails.'
        );
        kind = 'trail';
      }
      routes.push({
        id: Number.isInteger(r.i) ? r.i : routes.length,
        kind,
        name: cleanText(r.name, MAX_NAME),
        cellIds,
      });
    }
  }

  // ── Markers (points of interest) ──────────────────────────────────────
  const markers = [];
  for (const m of Array.isArray(pack.markers) ? pack.markers : []) {
    if (!m || !Number.isInteger(m.i)) continue;
    const cell = cellAt(m.cell);
    if (!cell || !isFiniteNumber(m.x) || !isFiniteNumber(m.y)) {
      warnings.add('marker_invalid', 'Some map markers had no valid position and were skipped.');
      continue;
    }
    const type = typeof m.type === 'string' ? m.type : 'marker';
    markers.push({
      id: m.i,
      type,
      icon: typeof m.icon === 'string' ? m.icon.slice(0, 16) : null,
      name: cleanText(m.name, MAX_NAME) || cleanText(type.replace(/-/g, ' '), MAX_NAME),
      note: cleanText(m.note, MAX_NOTE, { multiline: true }),
      x: m.x,
      y: m.y,
      cellId: m.cell,
      featureId: featureOf(cell),
      settlementId: settlementOrNull(cell.burg),
    });
  }

  return {
    source: {
      format: 'azgaar-json',
      version: typeof info.version === 'string' ? info.version : null,
      seed: info.seed != null ? String(info.seed) : null,
      mapName: cleanText(info.mapName, MAX_NAME) || 'Unnamed map',
      exportedAt: typeof info.exportedAt === 'string' ? info.exportedAt : null,
      width: info.width,
      height: info.height,
    },
    scale: {
      populationRate,
      urbanization,
      distanceUnit: typeof settings.distanceUnit === 'string' ? settings.distanceUnit : null,
      distanceScale: isFiniteNumber(settings.distanceScale) ? settings.distanceScale : null,
    },
    biomes,
    features,
    settlements,
    states,
    provinces,
    routes,
    markers,
    warnings: warnings.list(),
  };
}

module.exports = { parseAzgaarExport, AzgaarFormatError, LIMITS, MAX_BYTES, TESTED_VERSION };
