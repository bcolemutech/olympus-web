'use strict';

// Mapper — step 2 of the Cartographer's programmatic load (design
// planning/the-cartographer-design.md §3.2; C-3 / #370).
//
// mapToCanon(parsed) turns the parser's ParsedMap (functions/cartographer/
// parse.js) into a draft Loom world: the CanonWorld shape functions/loom-canon
// documents, extended with optional `geo`, `politics`, `regions` and `map`
// data. It is pure and deterministic — the same map always produces the same
// world, down to the order of each location's connections — and runs no LLM:
// Azgaar supplies the structure, Claude adds the flavor later over MCP.
//
//   locations  loc_<i> (settlements), poi_<i> (points of interest from markers)
//              { id, name, description, connections, factionIds, npcIds, rules,
//                geo: { kind, x, y, links: { [locationId]: 'road'|'trail'|'sea' }, … } }
//   factions   fac_<i>  { id, name, description, disposition: 'neutral',
//                         politics: { form, formName, color, capitalLocationId, relations } }
//   regions    reg_<i>  { id, name, formName, factionId, capitalLocationId, color, locationIds }
//   characters {}  lore {}  rules {}  tagline ''  openingHook ''   — filled in over MCP
//
// Names: Azgaar's name generator repeats itself, and the Loom resolves "go to
// X" by name, so every location and faction name is unique. A name shared by
// several settlements is qualified by province — "Norton (Hertfield)" — and a
// shared point-of-interest name by its nearest settlement — "Pirates near
// Coliverlis". A number is added only if that still collides.
//
// Connectivity: every location ends up reachable from every other.
//   1. Route links: consecutive settlements along each Azgaar route.
//   2. No routes at all (older exports): each settlement links to its nearest
//      neighbours on its landmass, and each port to its nearest ports.
//   3. Settlements still without links attach to the nearest settlement on
//      their landmass, else (a landmass of their own) the nearest port by sea.
//   4. Points of interest link to the settlement on their cell, else attach the
//      same way (points on water go to the nearest port by sea).
//   5. Any remaining separate groups are bridged to the main one at their
//      closest points (ports preferred), by sea across water — a safety net.

const KIND_RANK = { road: 3, trail: 2, sea: 1 };
const NEIGHBOURS_WITHOUT_ROUTES = 3;
const PORTS_WITHOUT_ROUTES = 2;

const SIZE_WORDS = {
  capital: 'city',
  city: 'city',
  town: 'town',
  village: 'village',
  fort: 'fort',
};
const SETTING_WORDS = { River: 'riverside', Lake: 'lakeside', Hunting: 'hunting' };

const locId = (i) => `loc_${i}`;
const poiId = (i) => `poi_${i}`;
const facId = (i) => `fac_${i}`;
const regId = (i) => `reg_${i}`;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function createWarnings(initial = []) {
  const list = initial.map((w) => ({ ...w }));
  return {
    add(code, message, count = 1) {
      const existing = list.find((w) => w.code === code);
      if (existing) existing.count += count;
      else list.push({ code, message, count });
    },
    list: () => list,
  };
}

// One namespace for locations and factions: the Loom resolves "go to X" by
// name across entity kinds, so names must be unique across both. Callers
// qualify shared names meaningfully first; this only adds a number as a last
// resort.
function createNames() {
  const used = new Set();
  return (wanted, fallback) => {
    const base = (wanted || '').trim() || fallback;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
    used.add(name.toLowerCase());
    return name;
  };
}

// Names that occur more than once in `items` (case-insensitive).
function sharedNames(items) {
  const counts = new Map();
  for (const item of items) {
    const key = (item.name || '').trim().toLowerCase();
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Set([...counts].filter(([, c]) => c > 1).map(([k]) => k));
}

function roundPopulation(people) {
  if (people >= 1000) return Math.round(people / 100) * 100;
  return Math.max(10, Math.round(people / 10) * 10);
}

const formatNumber = (n) => n.toLocaleString('en-US');
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const article = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

function settlementDescription(s, { faction, biomeName }) {
  const size = SIZE_WORDS[s.group] || 'settlement';
  const setting = s.port ? 'port' : SETTING_WORDS[s.type];
  const noun = setting ? `${setting} ${size}` : size;
  const where = faction
    ? s.capital
      ? `, capital of the ${faction.fullName}`
      : ` in the ${faction.fullName}`
    : ' in unclaimed lands';
  const people = s.population > 0 ? ` of about ${formatNumber(roundPopulation(s.population))}` : '';
  const land = biomeName ? `; ${biomeName.toLowerCase()}` : '';
  return `${capitalize(noun)}${people}${where}${land}.`;
}

function factionDescription(state, settlementCount, capitalName) {
  const form = (state.form || 'realm').toLowerCase();
  const capital = capitalName ? ` with its capital at ${capitalName}` : '';
  const count = `${settlementCount} settlement${settlementCount === 1 ? '' : 's'}`;
  return `${capitalize(article(form))} ${form} of ${count}${capital}.`;
}

function mapToCanon(parsed, { name } = {}) {
  const warnings = createWarnings(parsed.warnings);
  const uniqueName = createNames();
  const provinceName = new Map(parsed.provinces.map((p) => [p.id, p.name]));

  const biomeName = new Map(parsed.biomes.map((b) => [b.id, b.name]));
  const featureType = new Map(parsed.features.map((f) => [f.id, f.type]));
  const statesById = new Map(parsed.states.map((s) => [s.id, s]));
  const settlements = [...parsed.settlements].sort(byId);
  const settlementByCell = new Map(settlements.map((s) => [s.cellId, s]));
  const settlementsPerState = new Map();
  for (const s of settlements) {
    settlementsPerState.set(s.stateId, (settlementsPerState.get(s.stateId) || 0) + 1);
  }

  // ── Factions ──────────────────────────────────────────────────────────
  const factions = {};
  const settlementName = new Map();
  // Settlement names are claimed first, in id order, so a faction never takes
  // a town's name from it. Shared names are qualified by province.
  const sharedSettlementNames = sharedNames(settlements);
  let qualified = 0;
  for (const s of settlements) {
    let wanted = s.name;
    if (sharedSettlementNames.has((s.name || '').trim().toLowerCase())) {
      // Provinces are often named after their capital; qualifying "Bramburgh"
      // by the province "Bramburgh" says nothing, so use the realm instead.
      const province = provinceName.get(s.provinceId);
      const realm = (statesById.get(s.stateId) || {}).name;
      const where =
        province && province.toLowerCase() !== s.name.trim().toLowerCase() ? province : realm;
      if (where) wanted = `${s.name} (${where})`;
      qualified += 1;
    }
    settlementName.set(s.id, uniqueName(wanted, `Settlement ${s.id}`));
  }
  for (const state of [...parsed.states].sort(byId)) {
    const capitalName =
      state.capitalSettlementId !== null ? settlementName.get(state.capitalSettlementId) : null;
    const relations = {};
    for (const [otherId, relation] of Object.entries(state.relations)) {
      if (statesById.has(Number(otherId))) relations[facId(otherId)] = relation;
    }
    factions[facId(state.id)] = {
      id: facId(state.id),
      name: uniqueName(state.fullName || state.name, `Realm ${state.id}`),
      description: factionDescription(state, settlementsPerState.get(state.id) || 0, capitalName),
      disposition: 'neutral',
      politics: {
        form: state.form,
        formName: state.formName,
        color: state.color,
        capitalLocationId:
          state.capitalSettlementId !== null ? locId(state.capitalSettlementId) : null,
        relations,
      },
    };
  }

  // ── Locations: settlements ─────────────────────────────────────────────
  const locations = {};
  const nodes = []; // every location, for the geometry below
  for (const s of settlements) {
    const faction = s.stateId ? statesById.get(s.stateId) : null;
    const id = locId(s.id);
    locations[id] = {
      id,
      name: settlementName.get(s.id),
      description: settlementDescription(s, { faction, biomeName: biomeName.get(s.biomeId) }),
      connections: [],
      factionIds: s.stateId ? [facId(s.stateId)] : [],
      npcIds: [],
      rules: {},
      geo: {
        kind: 'settlement',
        x: s.x,
        y: s.y,
        population: s.population,
        port: s.port,
        capital: s.capital,
        biome: biomeName.get(s.biomeId) || null,
        regionId: s.provinceId ? regId(s.provinceId) : null,
        links: {},
      },
    };
    nodes.push({ id, x: s.x, y: s.y, featureId: s.featureId, port: s.port, settlement: true });
  }

  // ── Locations: points of interest ──────────────────────────────────────
  // Shared marker names ("Random encounter", "Pirates") are qualified by the
  // settlement they sit in, or the nearest one.
  const markers = [...parsed.markers].sort(byId);
  const sharedMarkerNames = sharedNames(markers);
  const settlementPoints = settlements.map((s) => ({ id: s.id, x: s.x, y: s.y }));
  const closestSettlementId = (m) => {
    if (m.settlementId !== null) return m.settlementId;
    let best = null;
    for (const s of settlementPoints) {
      const d = (s.x - m.x) ** 2 + (s.y - m.y) ** 2;
      if (!best || d < best.d || (d === best.d && s.id < best.id)) best = { id: s.id, d };
    }
    return best ? best.id : null;
  };
  for (const m of markers) {
    const id = poiId(m.id);
    let wanted = m.name;
    if (sharedMarkerNames.has((m.name || '').trim().toLowerCase())) {
      const near = closestSettlementId(m);
      if (near !== null) wanted = `${m.name} near ${settlementName.get(near)}`;
      qualified += 1;
    }
    locations[id] = {
      id,
      name: uniqueName(wanted, capitalize(m.type.replace(/-/g, ' '))),
      description: m.note || '',
      connections: [],
      factionIds: [],
      npcIds: [],
      rules: {},
      geo: { kind: 'poi', x: m.x, y: m.y, markerType: m.type, icon: m.icon, links: {} },
    };
    nodes.push({
      id,
      x: m.x,
      y: m.y,
      featureId: m.featureId,
      port: false,
      settlement: false,
      marker: m,
    });
  }
  if (qualified) {
    warnings.add(
      'names_qualified',
      'Some names were shared by several places and were qualified by province or nearest settlement.',
      qualified
    );
  }

  // ── Links ──────────────────────────────────────────────────────────────
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const link = (a, b, kind) => {
    if (a === b) return false;
    const current = locations[a].geo.links[b];
    if (current && KIND_RANK[current] >= KIND_RANK[kind]) return false;
    locations[a].geo.links[b] = kind;
    locations[b].geo.links[a] = kind;
    return true;
  };
  const isLand = (featureId) => featureType.get(featureId) === 'island';
  const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  // Nearest candidates to `from`, closest first, ties broken by id.
  const nearest = (from, candidates, count = 1) =>
    candidates
      .filter((c) => c.id !== from.id)
      .map((c) => ({ c, d: distance2(from, c) }))
      .sort((a, b) => a.d - b.d || (a.c.id < b.c.id ? -1 : 1))
      .slice(0, count)
      .map((e) => e.c);
  const settlementNodes = nodes.filter((n) => n.settlement);
  const portNodes = settlementNodes.filter((n) => n.port);

  // Links a location with no usable route into the network: a neighbour on
  // its own landmass by trail, otherwise the nearest port (or settlement) by sea.
  const attach = (node) => {
    const sameLand = isLand(node.featureId)
      ? settlementNodes.filter((n) => n.featureId === node.featureId)
      : [];
    const [land] = nearest(node, sameLand);
    if (land) return link(node.id, land.id, 'trail');
    const [bySea] = nearest(node, portNodes.length ? portNodes : settlementNodes);
    return bySea ? link(node.id, bySea.id, 'sea') : false;
  };

  // 1. Routes: consecutive settlements along each route.
  for (const route of parsed.routes) {
    let previous = null;
    for (const cellId of route.cellIds) {
      const s = settlementByCell.get(cellId);
      if (!s) continue;
      if (previous && previous.id !== s.id) link(locId(previous.id), locId(s.id), route.kind);
      previous = s;
    }
  }

  // 2. No routes at all: infer a road network from proximity.
  if (parsed.routes.length === 0) {
    for (const node of settlementNodes) {
      const sameLand = settlementNodes.filter((n) => n.featureId === node.featureId);
      for (const n of nearest(node, sameLand, NEIGHBOURS_WITHOUT_ROUTES))
        link(node.id, n.id, 'trail');
      if (node.port) {
        for (const p of nearest(node, portNodes, PORTS_WITHOUT_ROUTES)) {
          link(node.id, p.id, p.featureId === node.featureId ? 'trail' : 'sea');
        }
      }
    }
  }

  // 3. Settlements still unlinked (before points of interest attach to them).
  let isolated = 0;
  for (const node of settlementNodes) {
    if (Object.keys(locations[node.id].geo.links).length === 0 && attach(node)) isolated += 1;
  }
  if (isolated) {
    warnings.add(
      'isolated_linked',
      'Some settlements had no routes and were linked to their nearest neighbour.',
      isolated
    );
  }

  // 4. Points of interest.
  for (const node of nodes.filter((n) => n.marker)) {
    const host = node.marker.settlementId;
    if (host !== null && locations[locId(host)]) link(node.id, locId(host), 'trail');
    else attach(node);
  }

  // 5. Bridge any remaining separate groups into the largest one.
  const components = () => {
    const seen = new Set();
    const groups = [];
    for (const n of nodes) {
      if (seen.has(n.id)) continue;
      const group = [];
      const stack = [n.id];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        group.push(nodeById.get(id));
        stack.push(...Object.keys(locations[id].geo.links));
      }
      groups.push(group);
    }
    return groups.sort((a, b) => b.length - a.length || (a[0].id < b[0].id ? -1 : 1));
  };
  let bridged = 0;
  // Each bridge merges two groups, so there can never be more bridges than
  // locations; the cap only guards against a future bug looping forever.
  for (let groups = components(); groups.length > 1; groups = components()) {
    if (bridged >= nodes.length) {
      warnings.add(
        'groups_unbridged',
        'Some areas of the map could not be connected.',
        groups.length - 1
      );
      break;
    }
    const [main, smallest] = [groups[0], groups[groups.length - 1]];
    const inMain = new Set(main.map((n) => n.id));
    let best = null;
    for (const from of smallest) {
      const pool = main.filter((n) => n.settlement);
      const ports = pool.filter((n) => n.port);
      for (const to of from.port && ports.length ? ports : pool) {
        const d = distance2(from, to);
        if (!best || d < best.d || (d === best.d && to.id < best.to.id)) best = { from, to, d };
      }
    }
    if (!best || !inMain.has(best.to.id)) break;
    const sameLand = best.from.featureId === best.to.featureId && isLand(best.from.featureId);
    link(best.from.id, best.to.id, sameLand ? 'trail' : 'sea');
    bridged += 1;
  }
  if (bridged) {
    warnings.add(
      'groups_bridged',
      'Some disconnected areas were linked to the rest of the map.',
      bridged
    );
  }

  // Connections mirror links, in a stable order.
  for (const location of Object.values(locations)) {
    location.connections = Object.keys(location.geo.links).sort();
  }

  // ── Regions ────────────────────────────────────────────────────────────
  const regions = {};
  for (const p of [...parsed.provinces].sort(byId)) {
    regions[regId(p.id)] = {
      id: regId(p.id),
      name: p.fullName || p.name,
      formName: p.formName,
      factionId: p.stateId && factions[facId(p.stateId)] ? facId(p.stateId) : null,
      capitalLocationId: p.capitalSettlementId !== null ? locId(p.capitalSettlementId) : null,
      color: p.color,
      locationIds: settlements.filter((s) => s.provinceId === p.id).map((s) => locId(s.id)),
    };
  }

  const linkCounts = { road: 0, trail: 0, sea: 0 };
  for (const location of Object.values(locations)) {
    for (const [other, kind] of Object.entries(location.geo.links)) {
      if (location.id < other) linkCounts[kind] += 1;
    }
  }

  return {
    canon: {
      name: (name || '').trim() || parsed.source.mapName,
      tagline: '',
      openingHook: '',
      map: { width: parsed.source.width, height: parsed.source.height, imagePath: null },
      locations,
      factions,
      regions,
      characters: {},
      lore: {},
      rules: {},
    },
    stats: {
      settlements: settlements.length,
      pointsOfInterest: markers.length,
      factions: Object.keys(factions).length,
      regions: Object.keys(regions).length,
      links: linkCounts,
    },
    warnings: warnings.list(),
  };
}

module.exports = { mapToCanon };
