# The Image Studio — Design Document v0.1

**Status:** Decided (2026-10-09). The gap sheet (§3) is answered; sub-issues are ready to file (§5).
**Project:** Olympus (`olympus-dfa00`)
**Epic:** L-700 (#523)
**Phase:** 6 — Studio and new worlds ([`roadmap.md`](./roadmap.md) §4). Built after Phase 3c and L-690 (grading), before the UI rewrite (L-720); see the roadmap's Build order.
**Related:** [`the-loom-layered-worlds.md`](./the-loom-layered-worlds.md) §8–9 (town and battle-map art, `view_image`), [`the-cartographer-design.md`](./the-cartographer-design.md) (the connector), L-710 (#524, worlds from map images), L-730 (#526, portraits)

---

## 1. Purpose

A separate app where Cartographer editors make and keep the art for worlds: world maps, town and battle-map art, cover images, and later portraits and item art, as well as images used in Olympus itself. It **generates and edits images with Gemini image models on Vertex**, keeps every image in **one library that isn't tied to a world**, and lets worlds **use library images by reference**. Everything it does can be done from Claude over MCP; the page stays simple.

Spending is the risk: there is no limit, so **every image's cost is recorded, and the month's total is shown plainly on the page and in every studio tool result**, with a warning past a set figure.

---

## 2. What there is today

- **Art is uploaded or drawn per world.** The Cartographer page uploads a world's map PNG at import, town art (`cartographerTownImage`) and battle-map art (`cartographerMapImage`), each up to 30 MB, under the world's folder in Cloud Storage. Claude draws SVG art with `set_art` (up to 1 MB).
- **Worlds hold paths:** `world.map.imagePath`, a town's `image.path`, a battle map's `image.path`.
- **`view_image`** renders a battle map, town or world map as a JPEG (at most 1568 px on the long side) with an overlay for checking placement (`functions/mcp/apps/cartographer/images.js`).
- **Gemini** is called through `@google/genai` on Vertex in `us-central1` (`functions/gemini.js`). Nothing generates images yet. L-500 (#318, scene images during play) stays a separate, later epic.

---

## 3. Gap sheet

Settled with the user through a questionnaire (2026-10-09), with two follow-ups (links, job cap). Items marked † took the recommendation without a question of their own.

### The app

| ID     | Question                       | Decision                                                                                                                                                                                                   |
| ------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** | Who can open the studio?       | **Anyone with the `cartographer` claim.** No new claim                                                                                                                                                     |
| **S2** | One library or one per editor? | **One shared library.** Each image records who made it                                                                                                                                                     |
| **S3** | What ships first?              | **The library first** (upload, labels, search, assign, today's art moved in), **then generation and editing** on top                                                                                       |
| **S4** | What is on the page?           | **The library grid with search and filters, an image's detail, a generate form, upload, and a cost panel.** Editing and assigning are done over MCP (and assigning also through the Cartographer page, A3) |
| **S5** | Can images be uploaded?        | **Yes.** Art from other tools is kept, searched and assigned the same way                                                                                                                                  |
| **S6** | Today's world art?             | **Moved into the library**, labelled with where it came from. Worlds then point at library images                                                                                                          |

### Models and generation

| ID     | Question                                | Decision                                                                                                                                                    |
| ------ | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | How is the model picked?                | **Named tiers, `draft` and `final`**, mapped to models in config. **Claude can also name a model** outright                                                 |
| **M2** | Big world maps?                         | **A trial** in the generation story: the models' largest sizes, an upscale step, and extending outward, compared on a real map. The result is recorded here |
| **M3** | Reference images?                       | **Yes: any library images**, given by id                                                                                                                    |
| **M4** | Named styles?                           | **Yes:** a style is saved prompt text plus reference images, made and changed over MCP. A world can name a default style                                    |
| **M5** | Images per request?                     | **One.** Several at once means several jobs (T1)                                                                                                            |
| **M6** | Images nobody chose?                    | **Kept.** Storage is cheap next to generation                                                                                                               |
| **M7** | Who writes the prompt?                  | **Both:** Claude's prompt as given, plus an optional `from` (a location, town, battle map or character) that adds that thing's data                         |
| **M8** | Battle-map and town art vs. the layout? | **Generate freely, then place to fit:** Claude sets walls, doors and places over the art, checking with `view_image`                                        |

### Editing

| ID     | Question                      | Decision                                                                                                                                     |
| ------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **E1** | Which edits?                  | **Edit by instruction** ("make it night", "add a ruined tower on the hill"). Masks, outpainting, upscaling and background removal come later |
| **E2** | Replace, or make a new image? | **A new version of the same image.** Worlds using it pick up the change. Earlier versions are kept, and any can be made current again        |
| **E3** | Masks over MCP?               | **None.** Instruction edits only                                                                                                             |

### The library

| ID     | Question             | Decision                                                                                                                                                                                                                                                                                       |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **L1** | A kind per image?    | **Yes, from a fixed list:** `worldMap`, `regionMap`, `town`, `battleMap`, `cover`, `portrait`, `token`, `item`, `scene`, `interface`, `other`. Assigning checks it                                                                                                                             |
| **L2** | Labels and keywords? | **Labels only, no automatic keywords.** The user's note: keywords were only to make search easier, so drop them if they add nothing. † Labels are free words, kept lower-case, and the studio lists labels in use with their counts, so Claude reuses them rather than coining near-duplicates |
| **L3** | Search?              | **Filters plus word search:** kind, labels, world used in, style, who made it, date, and words matched in the title, prompt and labels                                                                                                                                                         |
| **L4** | Collections?         | **No, labels do the job**                                                                                                                                                                                                                                                                      |
| **L5** | Deleting?            | **Delete for good, only when unused:** an image in use can't be deleted until it is unassigned. Its cost records are kept                                                                                                                                                                      |

### Using images

| ID     | Question                          | Decision                                                                                                                                                                              |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1** | What does a world hold?           | **A reference to the library image**, and so its current version (E2)                                                                                                                 |
| **A2** | What can images be assigned to?   | **A world's map, town art, battle-map art, and a world's cover image** (new: shown on the Loom's world list). Portraits wait for L-730, item art for L-770, using the same assignment |
| **A3** | Today's upload buttons?           | **They upload into the library and assign in one step.** One path for all art. `set_art` SVGs go into the library the same way                                                        |
| **A4** | Use outside the Loom?             | **Download the original, a stable link for embedding, and Claude can fetch the link** to embed images in other projects                                                               |
| **A5** | Do players see prompts or labels? | **No.** Players see only the image                                                                                                                                                    |
| **A6** | Which images get a public link?   | **Every image**, from the moment it is made. The link is unguessable and always serves the image's current version. Anyone holding a link can see that image                          |

### Cost

| ID     | Question                | Decision                                                                                                                                                                           |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** | How is cost worked out? | **From a price table in config**, by model and output size (or tokens), so it is known when the job finishes                                                                       |
| **C2** | Which totals?           | **By day and month, and by who asked** (which editor, and whether through the page or Claude)                                                                                      |
| **C3** | A warning?              | **Yes, and it must be explicit** (the user's note: runaway cost is the worry). Past the month's figure, the page shows a banner and **every studio tool result carries a warning** |
| **C4** | The figure?             | **$50 a month**, in config                                                                                                                                                         |
| **C5** | Cost before running?    | **No estimate tool.** Every result reports what the job cost and the month's total so far                                                                                          |

### Over MCP

| ID     | Question                       | Decision                                                                                                                                      |
| ------ | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | How do tools wait?             | **Jobs.** A generate or edit call starts a job and returns at once, so Claude can run several side by side; another call collects the results |
| **T2** | Results include the image?     | **Yes**, scaled for viewing, once a job is done                                                                                               |
| **T3** | Tool names?                    | **A `studio_` prefix:** `studio_generate`, `studio_find`, …                                                                                   |
| **T4** | Anything else Claude needs?    | **Choose the model, run several requests at a time, use library images as references** (all covered above)                                    |
| **T5** | A cap on jobs running at once? | **8 at once.** More wait in a queue. It guards against a runaway loop; it isn't a spending limit. In config                                   |
| **W1** | The exit criterion?            | **As in #523** (§6)                                                                                                                           |

---

## 4. Design

### 4.1 Where it lives

- **The page:** `public/apps/studio/`, registered in `apps.yaml`, shown in the Grand Hall to anyone with the `cartographer` claim (S1). Vanilla JS in the IIFE pattern like the other apps (`window.Studio`), until the UI rewrite (L-720) decides otherwise for the Loom.
- **The tools:** in the Cartographer connector (`functions/mcp/apps/cartographer/`), in a `studio-tools.js` of their own, all prefixed `studio_` (T3).
- **The server:** a `functions/studio/` folder for the library, jobs, costs and the Gemini image call, with callables for the page.

### 4.2 Data

- **`studio_images/{imageId}`:** `{ title, kind, labels[], prompt, model, tier, styleId, from, references[], parentId, current (version number), versions: [{ n, path, width, height, format, bytes, createdAt, createdBy, via, instruction, cost }], usedIn: [{ worldId, target, id }], link, createdBy, via ('page' | 'mcp' | 'upload' | 'backfill'), source, createdAt, updatedAt }`. Versions live on the document (an image has few); `usedIn` is kept up to date by assignment so "in use" (L5) and "worlds used in" (L3) are one read.
- **Files:** `studio/{imageId}/v{n}.{png|jpg|webp|svg}` in the default bucket. A version's file never changes; making a version current moves the link (4.6).
- **`studio_styles/{styleId}`:** `{ name, prompt, references[], createdBy, updatedAt }`. A world's default style is `world.studio.styleId`.
- **`studio_jobs/{jobId}`:** `{ kind: 'generate' | 'edit', request, state: 'queued' | 'running' | 'done' | 'failed', imageId, version, cost, error, createdBy, via, createdAt, finishedAt }`.
- **`studio_costs/{entryId}`** (one per finished job, and per failed job the provider charged for) and **`studio_costs_month/{yyyy-mm}`** (running totals by day, model and who, so the page and every tool result read one document).
- **Rules:** editors (`hasApp('cartographer')`) may read `studio_images`, `studio_styles`, `studio_jobs` and the month totals; all writes go through the Admin SDK, like the Loom and Cartographer data.

### 4.3 Jobs and generation

- **A Cloud Tasks queue** (`onTaskDispatched`, `maxConcurrentDispatches: 8`, T5) runs jobs. `studio_generate` and `studio_edit` write a job, enqueue it and return its id at once (T1). The page's generate form does the same.
- **A job** builds the request: the prompt; the style's text and references, if any (M4); the `from` thing's data, if any (M7); references (M3); then calls the model for its tier, or the model named (M1). It stores the image as a new image (generate) or a new version (edit, E2), records the cost (4.5) and marks the job done.
- **Models:** the tiers map to Gemini image models in config. Which models, at which sizes and prices, and whether they are served in `us-central1` or only from Vertex's `global` endpoint, is checked when L-707 is built; the M2 trial picks how big maps are made.
- **Failures** are recorded on the job with the provider's message. A failure the provider charged for still writes a cost entry.

### 4.4 Assignment

- **Worlds hold image ids**, not paths: `world.map.imageId`, a town's `imageId`, a battle map's `imageId`, and a new `world.cover.imageId` (A1, A2). The Loom and `view_image` resolve the id to the image's current version.
- **`studio_assign`** (and the Cartographer page's upload buttons, A3) checks the kind fits the target (L1), sets the id on the world, and adds the use to the image's `usedIn`; unassigning removes it. A battle map's grid-shape warnings from `set_art` apply the same way.
- **Changing an image changes it everywhere it is used** (E2). Before making a new version of an image in use, the result names the worlds and targets it will change, so Claude can check them with `view_image`.
- **`set_art`** stores its SVG as a library image (kind `town` or `battleMap`) and assigns it, rather than writing beside the world.
- **Players** see the image only (A5): the Loom's reads return the file's URL, never the record.

### 4.5 Cost

- **Price table** in config by model and output size or tokens (C1). Each finished job writes a cost entry and adds to the month's totals (C2).
- **Explicit everywhere** (C3): the page shows the month's total in its header at all times and a banner once past **$50** (C4); every studio tool result carries `cost: { job, month, warnAt, warning? }`, and the warning's text says plainly that the month has passed the figure. `studio_costs` gives the totals by day, month and who.

### 4.6 Links, downloads and fetching

- **Every image has a link** (A6) from the moment it is made: an unguessable URL that serves the current version and keeps working when versions change. Whether it is a Storage download token on a stable copy or a small Hosting route is settled in L-701; either way it must survive new versions and be cacheable.
- **Download** on the page gives the current version's original file. **`studio_get`** returns the record, the link, and the image scaled for viewing; Claude can hand the link to other projects (A4).

### 4.7 Tools

| Tool                                 | What it does                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `studio_find`                        | Search by words and filters (L3); records without images, with links                                          |
| `studio_get`                         | One image: record, versions, where it is used, link, and the image to look at                                 |
| `studio_update`                      | Title, kind, labels; make an earlier version current                                                          |
| `studio_labels`                      | The labels in use, with counts                                                                                |
| `studio_delete`                      | Delete an unused image for good (L5)                                                                          |
| `studio_assign` / `studio_unassign`  | Use an image for a world's map, a town, a battle map or a cover (4.4)                                         |
| `studio_generate`                    | Start a generation job: prompt, kind, tier or model, style, references, `from`, title and labels              |
| `studio_edit`                        | Start an edit job on an image: the instruction, tier or model, references                                     |
| `studio_jobs`                        | Jobs' states, by id or recent; finished ones with their images to look at. Can wait briefly for any to finish |
| `studio_styles` / `studio_set_style` | List, make and change styles; set a world's default style                                                     |
| `studio_costs`                       | Totals by day, month and who, against the warning figure                                                      |

Uploading stays on the page (S5): binary files don't travel well through a tool call.

---

## 5. Sub-issues

| ID           | Story                                                                                                                                                                                                                  | Depends on   | Model  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------ |
| L-701 (#537) | **The library:** `studio_images`, files and versions, upload callable, kinds, labels, search, links (and settling how, 4.6), delete-when-unused, rules                                                                 | —            | Opus   |
| L-702 (#538) | **The studio page:** app registration, the grid with search and filters, an image's detail, upload, download                                                                                                           | L-701        | Sonnet |
| L-703 (#539) | **Library tools:** `studio_find`, `studio_get`, `studio_update`, `studio_labels`, `studio_delete`                                                                                                                      | L-701        | Sonnet |
| L-704 (#540) | **Worlds use library images:** image ids on worlds, `studio_assign`, the Cartographer upload buttons and `set_art` through the library, the Loom and `view_image` resolving ids, cover images on the Loom's world list | L-701        | Opus   |
| L-705 (#541) | **Today's art into the library:** a local dry-run script moving world maps, town and battle-map art into the library and pointing worlds at them                                                                       | L-704        | Sonnet |
| L-706 (#542) | **Costs:** the price table, cost entries and month totals, `studio_costs`, the cost line in every studio result, the page's cost header, panel and banner                                                              | L-701        | Sonnet |
| L-707 (#543) | **Generation:** the job queue (8 at once), the Gemini image call, tiers and models, references, `from`, `studio_generate` and `studio_jobs`, the page's generate form, the big-map trial (M2)                          | L-703, L-706 | Opus   |
| L-708 (#544) | **Editing by instruction:** `studio_edit`, new versions, the in-use notice, making an earlier version current                                                                                                          | L-707        | Sonnet |
| L-709 (#545) | **Styles:** `studio_styles`, styles in requests, a world's default style                                                                                                                                               | L-707        | Sonnet |

**Order:** L-701 is the spine. L-702, L-703, L-704 and L-706 can run side by side after it; L-705 follows L-704. Generation (L-707) waits for cost tracking (L-706), so no image is ever made without its cost recorded. L-708 and L-709 follow L-707.

Each story is tested on its own: emulator tests (Firestore and Storage) for the library, assignment and costs, a real MCP client for the tools with the image model stubbed, and headless Chrome for the page.

---

## 6. Exit criterion

From Claude, generate a map image, label it, find it again by keyword, and assign it as a world's map. Its cost shows on the studio page.

---

## 7. Later

- **More edits:** masks (drawn on the page, then shapes over MCP), extending edges, upscaling, background removal for tokens and item icons (E1, E3).
- **A spending limit**, if the warning isn't enough (roadmap §5).
- **Portraits and tokens** (L-730), **item art** (L-770) and **scene images during play** (L-500) assign library images the same way.
- **Search by meaning** (embeddings), if word search falls short (L3).
