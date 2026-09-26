# The Cartographer — Design Document v0.1

**Status:** Draft for review
**Project:** Olympus (`olympus-dfa00`)
**Part of:** The Loom, Phase 3 "Rapid worlds" (L-300 / #314)
**Related:** [`the-loom-design.md`](./the-loom-design.md), [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)

---

## 1. Purpose

The Cartographer turns an [Azgaar Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) map into the **starting point of a Loom world**. It does three things:

1. **Intake:** an admin uploads an Azgaar export in the Loom app.
2. **Initial processing:** the export is validated and mapped into the Loom's canon shape.
3. **Loading:** the result is stored as a new **draft** world.

A draft world has **geography, politics, and a map image**, and nothing else. It isn't playable yet. Turning it into a playable world (lore, characters, rules, an opening hook) happens afterwards, **with Claude through Loom authoring tools on MCP** (MCP program Initiative 2). The Cartographer's job ends when the draft is loaded.

The Cartographer is deterministic: **no LLM** runs anywhere in it. That follows the Loom's "LLM for flavor, not structure" principle. Azgaar supplies the structure, and Claude supplies the flavor later.

---

## 2. Scope

**In scope**

- Input: Azgaar's **"Save as JSON"** full export (required), plus a rendered **PNG** export for display (optional, recommended).
- An admin-only **"New world from map"** flow in the Loom app.
- **Geography:** settlements become locations, routes become connections, and terrain, biome, and coordinates are kept per location.
- **Politics:** states become factions (with Azgaar's diplomacy as faction relations), and provinces become regions.
- **Map image:** stored with the world, in the same coordinate space as the locations.
- Output: a **draft** world in Firestore, exposed through the existing canon seam (`functions/loom-canon`).

**Out of scope**

- Lore, cultures, religions, name bases, characters, and opening hooks. These are fleshed out with Claude via MCP (Initiative 2).
- LLM enrichment of any kind.
- Editing a world after loading, and publishing it. Both belong to the MCP authoring tools.
- Other map formats (Azgaar's `.map` file, GeoJSON exports, other generators).
- Rendering the map server-side from the JSON.
- Merging a re-import into an existing world. A re-import always creates a new draft.

---

## 3. Pipeline

```
 Loom app (admin)               Cloud Storage                  loomCartographerImport            Firestore
 "New world from map"  ──────▶  cartographer/{uid}/{upload}/ ─▶  1 validate  2 parse   ───────▶  loom_worlds/{worldId}
  map.json (+ map.png)           map.json, map.png               3 map       4 load               status: draft
                                                                 (deterministic, no LLM)          + locations, factions, regions
```

### 3.1 Intake

- **Who:** admins only (`hasAdmin()`). A new world is a canon change, and canon changes only through authoring (Loom design §10).
- **Where:** a "New world from map" view in the Loom app. The admin picks the JSON (required) and a PNG (optional), and can set a world name, which defaults to Azgaar's map name.
- **Upload:** the browser writes both files to Cloud Storage under `cartographer/{uid}/{uploadId}/`, then calls `loomCartographerImport({ uploadId, name? })`. Uploading to Storage avoids callable request-size limits, since Azgaar exports run from a few MB to tens of MB.
- **New infrastructure:** Olympus doesn't use Cloud Storage yet. This adds a `storage` block to `firebase.json` and `storage.rules`: admin-only writes under `cartographer/`, size and content-type limits, and no client reads except the published map image. The merge deploy also has to cover `storage`.

### 3.2 Processing

**Validation** rejects anything that isn't an Azgaar full JSON export before any processing. It checks for `info` with dimensions, `pack.cells`, `pack.burgs`, and `pack.states`, requires at least one settlement, and enforces size limits. It records Azgaar's `info.version`, and collects **warnings** rather than failing where a sensible fallback exists (§3.2.2).

#### 3.2.1 Mapping

| Azgaar (`pack.*`)                       | Loom canon                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `burgs[i]` (i > 0; `burgs[0]` is empty) | **Location** `loc_<i>`: `name`; `factionIds: [fac_<state>]` (empty for the Neutrals state 0); `connections` (below); `geo { x, y, population, port, capital, biome, provinceId }`. `description` is a short factual line built from the data, e.g. "Port town of about 2,400 in the Kingdom of Vasa; temperate deciduous forest." |
| `routes` (roads, trails, sea routes)    | **Connections:** consecutive settlements along each route are linked in both directions. The route kind is kept as `geo.links { loc_j: 'road' \| 'trail' \| 'sea' }`, and `connections` stays the plain id list the rules engine already uses.                                                                                    |
| `states[i]` (i > 0; 0 is "Neutrals")    | **Faction** `fac_<i>`: `name` (full name); a factual `description` (form, size, capital); `disposition: 'neutral'`; `politics { form, color, capitalLocationId, relations { fac_j: 'ally' \| 'friendly' \| 'neutral' \| 'suspicion' \| 'enemy' \| 'rival' \| 'vassal' \| 'suzerain' } }` taken from the state's diplomacy row.    |
| `provinces[i]` (i > 0)                  | **Region** `reg_<i>` (new, optional canon block): `name`, `factionId`, `capitalLocationId`, `locationIds`.                                                                                                                                                                                                                        |
| `info` + uploaded PNG                   | World **`map`** block: `{ width, height, imagePath }`. Location `geo.x/y` use Azgaar's pixel space, so markers line up with the image; if the PNG was exported at a different resolution, it's scaled by the width ratio.                                                                                                         |
| —                                       | `characters: {}`, `lore: {}`, `tagline: ''`, `openingHook: ''`, left for MCP authoring.                                                                                                                                                                                                                                           |

#### 3.2.2 Fallbacks (warnings, not failures)

- **No `pack.routes`** (older Azgaar versions): each settlement is connected to its 3 nearest neighbours on the same landmass, and ports are linked to their nearest ports.
- **Isolated settlements** (no route touches them) get the same nearest-neighbour link, so every location stays reachable.
- **Empty or duplicate names** get a suffix (for example "Vasa (2)") so names stay unique within the world.

### 3.3 Loading

- **World document:** `loom_worlds/{worldId}` holds `{ id, name, status, tagline, openingHook, map, counts, source { format: 'azgaar-json', version, seed, mapName, uploadedBy, uploadedAtMs } }`.
- **Entities** live in subcollections (`locations`, `factions`, `regions`), one document each, which keeps every document well under Firestore's 1 MB limit.
- **Status:** `importing` while batches are written, then `draft`. A failed import is marked `failed` with its errors, and its partial entities are deleted.
- **Re-importing** always creates a new world, and never overwrites.
- **Draft worlds aren't playable:** they're hidden from the Play UI's world list, and `loomCreateSave` refuses them. Firestore rules let players read only `published` worlds, and admins read drafts. Publishing is part of the MCP authoring flow (Initiative 2).
- **Canon seam:** `loom-canon` gains Firestore-backed worlds behind `getWorld` / `getEntity` / `getEntitySnippet`, returning the same `CanonWorld` shape extended with the optional `geo`, `politics`, `regions`, and `map` fields. The turn pipeline ignores these until it uses them. Firestore reads are async, so these accessors become async, with per-instance caching. That's a mechanical change to their callers in `functions/loom-turn/`.

---

## 4. After loading: fleshing out with Claude

The Cartographer's contract with what comes next is the **draft world shape in §3.3**. The Loom authoring tools on MCP (Initiative 2, `/mcp/loom`) read a draft world's geography and politics, and add lore, characters, location rules, and an opening hook with Claude, then publish. This doc doesn't design those tools; it only guarantees they start from a consistent, fully connected skeleton.

---

## 5. Olympus Integration

| Concern   | Implementation                                                                                                                                       |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| App       | "New world from map" view in the Loom app (`/apps/loom/`), shown only to admins                                                                      |
| Storage   | **New:** Cloud Storage bucket + `storage.rules`; uploads under `cartographer/{uid}/{uploadId}/`                                                      |
| Functions | `loomCartographerImport` (callable, admin-only; about 1–2 GiB memory and a 5-minute timeout for large maps)                                          |
| Firestore | `loom_worlds/{worldId}` + `locations`, `factions`, `regions` subcollections; rules: players read `published` only, admins read all, no client writes |
| Canon     | `functions/loom-canon` Firestore seam (async accessors, cached); static worlds (Shattered Coast) keep working unchanged                              |
| Deploy    | Existing merge workflow, plus `storage` in the deploy targets                                                                                        |
| Tests     | A small committed Azgaar fixture (a tiny generated map) drives parser, mapper, and loader tests; Storage and Firestore via emulators                 |

---

## 6. Open Questions

- **Settlement detail.** Large maps have thousands of settlements. **Recommendation:** import all of them and decide on filtering (for example, skipping hamlets below a population threshold) after trying play with a large map.
- **Map image format.** PNG only, or also SVG? **Recommendation:** PNG only for now. It's simpler to display and to size-limit.
- **Who can import.** Admins only (recommended) or anyone with the `loom` claim.
- **Async canon accessors.** Should they be refactored now, as part of this phase, or wrapped in a preloaded per-world cache so the turn pipeline stays synchronous? This needs a look at the turn code before deciding.

---

## 7. Roadmap (within Loom Phase 3)

Proposed sub-issues for L-300 (#314):

| ID  | Scope                                                                                            |
| --- | ------------------------------------------------------------------------------------------------ |
| C-1 | Storage infrastructure: bucket config, `storage.rules`, deploy target, emulator                  |
| C-2 | Parser and validator for Azgaar full JSON (pure, unit-tested against a committed fixture)        |
| C-3 | Mapper: geography, politics, regions, factual descriptions, fallbacks and warnings               |
| C-4 | Loader: draft world docs and subcollections, import status, Firestore canon seam in `loom-canon` |
| C-5 | Loom app: admin "New world from map" upload flow + `loomCartographerImport` callable             |

**Exit criterion:** an admin uploads an Azgaar export in the Loom app and gets a **draft** Loom world whose locations, connections, factions, relations, regions, and map image match the source map, with no hand-editing.
