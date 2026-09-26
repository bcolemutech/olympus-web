# The Cartographer — Design Document v0.2

**Status:** Draft for review
**Project:** Olympus (`olympus-dfa00`)
**Program:** MCP program **Initiative 2** ([`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)); fulfils Loom Phase 3 "Rapid worlds" (L-300 / #314)
**Related:** [`the-loom-design.md`](./the-loom-design.md)

---

## 1. Purpose

The Cartographer is Olympus's **world-building app**. It produces the worlds the Loom plays, in two steps:

1. **Programmatic load.** Upload an [Azgaar Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/) map, and the Cartographer validates it, maps it into the Loom's canon shape, and loads it as a new **draft** world with **geography, politics, and a map image**. This step is deterministic, with no AI involved.
2. **Building with Claude over MCP.** Through the Cartographer's MCP connector (`/mcp/cartographer`), you and Claude add to the world: lore, characters, location rules, an opening hook. Then you **publish** it. The same connector is the long-term channel for **fixing and changing** a world's data, including worlds already being played.

The two apps split cleanly:

| App              | Job                       | AI                                                   |
| ---------------- | ------------------------- | ---------------------------------------------------- |
| **Cartographer** | Build and maintain worlds | Claude, external, via MCP. Olympus runs no LLM here. |
| **The Loom**     | Play worlds               | Gemini, in the turn pipeline (Loom design §6)        |

MCP is the authoring and maintenance channel, never the gameplay channel.

---

## 2. Scope

**In scope**

- A **Cartographer app**: a `cartographer` claim, a Grand Hall tile, and a small web page to upload a map, list worlds (draft and published), and publish.
- **Programmatic intake** of Azgaar's **"Save as JSON"** full export (required), plus a rendered **PNG** (optional, recommended).
- **Geography:** settlements become locations, routes become connections, and terrain, biome, and coordinates are kept.
- **Politics:** states become factions (diplomacy becomes faction relations), and provinces become regions.
- **Points of interest:** Azgaar's map markers (inns, ruins, portals, battlefields, and so on) become locations of kind `poi`, connected to their nearest settlement.
- **Map image:** stored with the world, in the same coordinate space as its locations.
- **MCP connector** `/mcp/cartographer`: tools to read and edit world canon, for **both draft and published worlds**, and to publish.
- The **Loom** side of the contract: it plays only published worlds and picks up canon edits on each game's next turn.

**Out of scope**

- Importing cultures, religions, or name bases as lore seeds.
- Azgaar's generated war history (`states[0].diplomacy`) and economy data (`deals`, `goods`, `markets`). Relations already record who's allied or rival, and Claude can write the history over MCP.
- Any LLM running inside Olympus for the Cartographer. Claude is the user's own client, over MCP.
- In-game narration, which stays Gemini in the Loom.
- Other map formats (Azgaar `.map`, GeoJSON exports, other generators) and server-side map rendering.
- Merging a re-import into an existing world. A re-import creates a new draft.
- Editing World State or players' saves. Long term, MCP may also fix those; that's a separate decision.

---

## 3. Programmatic load

```
 Cartographer page             Cloud Storage                  cartographerImport              Firestore
 "Upload a map"      ───────▶  cartographer/{uid}/{upload}/ ─▶  1 validate  2 parse  ───────▶  loom_worlds/{worldId}
  map.json (+ map.png)          map.json, map.png               3 map       4 load              status: draft
                                                                (deterministic, no LLM)          + locations, factions, regions
```

### 3.1 Intake

- **Who:** anyone holding the `cartographer` claim (`hasApp('cartographer')`), granted in The Pantheon like any other app.
- **Where:** the Cartographer page (`/apps/cartographer/`). You choose the JSON (required) and a PNG (optional), and can set a world name, which defaults to Azgaar's map name.
- **Upload:** the browser writes both files to Cloud Storage under `cartographer/{uid}/{uploadId}/`, then calls `cartographerImport({ uploadId, name? })`. Going through Storage avoids callable request-size limits, since Azgaar exports run from a few MB to tens of MB.
- **New infrastructure:** Olympus doesn't use Cloud Storage yet. This adds a `storage` block to `firebase.json` and `storage.rules`: writes under `cartographer/` only for the `cartographer` claim, size and content-type limits, and reads of published map images by the `loom` claim. The merge deploy also has to cover `storage`.

### 3.2 Processing

**Validation** rejects anything that isn't an Azgaar full JSON export before any processing. It checks for `info` with dimensions, `pack.cells`, `pack.burgs`, and `pack.states`, requires at least one settlement, and enforces size limits. It records Azgaar's `info.version`, and collects **warnings** where a fallback exists instead of failing. Biomes are read from `pack.biomes` (Azgaar 1.15x), falling back to a top-level `biomesData` for older exports.

| Azgaar (`pack.*`)                       | Loom canon                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `burgs[i]` (i > 0; `burgs[0]` is empty) | **Location** `loc_<i>`: `name`; `factionIds: [fac_<state>]` (empty for the Neutrals state 0); `connections` (below); `geo { kind: 'settlement', x, y, population, port, capital, biome, provinceId }`. The population is `population × settings.populationRate × settings.urbanization` (Azgaar stores thousands: 28.473 → about 28,500). The biome comes from `pack.cells[cell].biome` → `pack.biomes`, and the province from `pack.cells[cell].province`. `description` is a short factual line built from the data, e.g. "Port town of about 28,500 in the Kingdom of Pendonia; temperate deciduous forest." |
| `routes` (roads, trails, sea routes)    | **Connections:** consecutive settlements along each route are linked in both directions. The route kind is kept as `geo.links { loc_j: 'road' \| 'trail' \| 'sea' }`, and `connections` stays the plain id list the rules engine already uses.                                                                                                                                                                                                                                                                                                                                                                  |
| `states[i]` (i > 0; 0 is "Neutrals")    | **Faction** `fac_<i>`: `name` (full name); a factual `description` (form, size, capital); `disposition: 'neutral'`; `politics { form, color, capitalLocationId, relations { fac_j: 'ally' \| 'friendly' \| 'neutral' \| 'suspicion' \| 'enemy' \| 'rival' \| 'vassal' \| 'suzerain' \| 'unknown' } }` taken from the state's diplomacy row (`x`, meaning self, is skipped).                                                                                                                                                                                                                                     |
| `provinces[i]` (i > 0)                  | **Region** `reg_<i>` (new, optional canon block): `name`, `factionId`, `capitalLocationId`, `locationIds`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `info` + uploaded PNG                   | World **`map`** block: `{ width, height, imagePath }`. Location `geo.x/y` use Azgaar's pixel space, so markers line up with the image; a PNG exported at another resolution is scaled by the width ratio.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `markers[i]`                            | **Point of interest** `poi_<i>`: `name`; `description` = the marker's own `note`; `geo { kind: 'poi', x, y, markerType, icon }`; connected to the settlement on its cell, or else to the nearest settlement.                                                                                                                                                                                                                                                                                                                                                                                                    |
| —                                       | `characters: {}`, `lore: {}`, `tagline: ''`, `openingHook: ''`, filled in over MCP.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

**Fallbacks (warnings, not failures)**

- **Checked against a real export.** Nisia (Azgaar 1.153.1: 663 settlements, 23 states, 145 provinces, 530 routes, 56 markers) produces 837 route links (628 trails, 155 roads, 62 sea), with 662 of 663 settlements in one connected network. Its PNG is exactly 3× the coordinate space (5154×3810 for a 1718×1270 map).
- **No `pack.routes`** (older Azgaar versions): each settlement is connected to its 3 nearest neighbours on the same landmass, and ports to their nearest ports.
- **Isolated settlements** (one in Nisia) get the same nearest-neighbour link, so every location stays reachable.
- **Empty or duplicate names** get a suffix (for example "Vasa (2)") so names stay unique within the world.

### 3.3 Loading

- **World document:** `loom_worlds/{worldId}` holds `{ id, name, status, tagline, openingHook, map, counts, canonVersion, source { format: 'azgaar-json', version, seed, mapName, uploadedBy, uploadedAtMs } }`.
- **Entities** live in subcollections (`locations`, `factions`, `regions`, and later `characters` and `lore`), one document each, which keeps every document well under Firestore's 1 MB limit.
- **Status:** `importing` while batches are written, then `draft`. A failed import is marked `failed` with its errors, and its partial entities are deleted.
- **Re-importing** always creates a new world, and never overwrites.

### 3.4 Publishing

- **Where:** a publish action on the Cartographer page and a `publish_world` MCP tool.
- **Checks:** it refuses to publish until the world is playable: an opening hook, at least one starting location, and every connection pointing at an existing location.
- **Effect:** status goes from `draft` to `published`. From then on the Loom lists the world and `loomCreateSave` accepts it. The Loom refuses drafts, and Firestore rules let `loom` players read only published worlds.

---

## 4. Building with Claude over MCP

The Cartographer registers an app module through the MCP registry seam (Initiative 1 §8), mounted at **`/mcp/cartographer`** and gated by the `cartographer` claim. It uses the same OAuth, audience binding, grants, rate limits, and audit log as every connector, with no new plumbing.

### 4.1 Tools (initial proposal)

| Group     | Tools                                                                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read      | `list_worlds` (status, counts); `get_world` (overview, regions, factions); `find_locations` (by name, region, faction, or near a location); `get_location`, `get_faction`, `get_region`, `get_character`     |
| Write     | `update_world` (name, tagline, opening hook); `update_location` (description, rules, factions present); `connect_locations` / `disconnect_locations`; `update_faction` (description, disposition, relations) |
| Add       | `add_character`, `update_character`; `add_lore`, `update_lore` (with entity references)                                                                                                                      |
| Retire    | `retire_entity`: a soft removal (below)                                                                                                                                                                      |
| Lifecycle | `publish_world`                                                                                                                                                                                              |

Every write validates its input: ids must exist, connections stay symmetric, and names stay unique within the world. Writes to one world are serialized in a transaction, and each call is audited as a `tool_call` in `mcp_audit`.

### 4.2 Editing published worlds

The MCP tools can change a world while it's being played, so canon changes have to reach games safely:

- **Next-turn visibility.** Every write bumps the world's `canonVersion`. The Loom caches canon per instance and re-reads a world whenever its `canonVersion` has changed, so an edit shows up on each game's next turn. That costs one small version read per turn.
- **No hard deletes in published worlds.** Locations, characters, factions, and lore are **retired** instead: kept, and marked with `retired: true`. A save standing in a retired location still resolves. The Loom's rules engine stops offering retired locations as destinations and narration treats retired characters as absent, but nothing a save references ever vanishes. Draft worlds may hard-delete.
- **Play never writes canon.** The Loom's canon-authority rule stands (Loom design §10): the play pipeline, the model, and players never write canon. Only authoring does: the import, the Cartographer's MCP tools, and static-config commits.

---

## 5. Olympus Integration

| Concern   | Implementation                                                                                                                                                                                                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App       | `cartographer` in `apps.yaml` (embedded page `/apps/cartographer/`: upload, world list, publish, and the connector URL to copy); `cartographer` claim granted in The Pantheon                                                                                                                                                              |
| MCP       | App module under `functions/mcp/apps/cartographer/`, registered in `functions/mcp/apps/index.js`; connector `https://bcoletech.com/mcp/cartographer`                                                                                                                                                                                       |
| Storage   | **New:** Cloud Storage + `storage.rules`; uploads under `cartographer/{uid}/{uploadId}/`                                                                                                                                                                                                                                                   |
| Functions | `cartographerImport` and `cartographerPublish` callables (`cartographer` claim; the import gets about 1–2 GiB memory and a 5-minute timeout for large maps)                                                                                                                                                                                |
| Firestore | `loom_worlds/{worldId}` + entity subcollections; rules: `cartographer` users read all, `loom` players read published only, no client writes                                                                                                                                                                                                |
| Loom      | Plays published worlds only; Firestore canon seam in `functions/loom-canon` with `canonVersion` cache invalidation and retired-entity handling; the static Shattered Coast keeps working unchanged                                                                                                                                         |
| Deploy    | Existing merge workflow, plus `storage` in the deploy targets                                                                                                                                                                                                                                                                              |
| Tests     | Slim fixture `tests/fixtures/azgaar/nisia.json` (Azgaar 1.153.1, about 380 KB), generated by `tests/fixtures/azgaar/slim-export.js` from a full export kept in the gitignored `maps/` folder, drives parser, mapper, and loader tests; MCP tools tested like Scriptorium (a real client over express); Storage and Firestore via emulators |

---

## 6. Open Questions

- **Settlement detail.** Large maps have thousands of settlements (Nisia has 663, plus 56 points of interest). **Recommendation:** import all of them and decide on filtering (for example, skipping hamlets under a population threshold) after trying play with a large map.
- **Map image format.** PNG only, or also SVG? **Recommendation:** PNG only for now.
- **Async canon accessors.** Should the Firestore seam make `getWorld` and friends async across the turn pipeline, or load a whole world into a per-instance cache (checked against `canonVersion` each turn) so the turn code stays synchronous? **Recommendation:** decide after reading the turn code. The cache is likely simpler.
- **Consent for writes to published worlds.** Intra-app scopes (Initiative 1 §12) could separate "read and edit drafts" from "change published worlds". **Recommendation:** one `mcp:cartographer` scope for now, and revisit if you want Claude's access to live worlds to be narrower.
- **Fixing World State and saves over MCP.** This is the long-term "fix things" use (for example, a stuck save). **Recommendation:** leave it out of this phase. It needs its own rules for editing live player data.

---

## 7. Roadmap

Proposed sub-issues for L-300 (#314):

| ID  | Scope                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-1 | Storage infrastructure: bucket config, `storage.rules`, deploy target, emulator                                                                              |
| C-2 | Parser and validator for Azgaar full JSON (pure, unit-tested against a committed fixture)                                                                    |
| C-3 | Mapper: geography, politics, regions, factual descriptions, fallbacks and warnings                                                                           |
| C-4 | Loader and Loom seam: draft world docs and subcollections, import status, Firestore canon seam with `canonVersion`, and the Loom plays published worlds only |
| C-5 | Cartographer app: claim, `apps.yaml`, page (upload, world list, publish), `cartographerImport` and `cartographerPublish`                                     |
| C-6 | MCP connector, read tools: `/mcp/cartographer` module, `list_worlds`, `get_*`, `find_locations`                                                              |
| C-7 | MCP connector, write tools: edits, add, retire, `publish_world`; validation, per-world transactions, `canonVersion` bumps                                    |

**Exit criterion:**

1. Upload an Azgaar map in the Cartographer, and get a draft world whose places, routes, factions, relations, regions, and map match the source.
2. With Claude over MCP, add lore, characters, and an opening hook, then publish.
3. Play it in the Loom.
4. A later fix made through MCP shows up on the game's next turn.
