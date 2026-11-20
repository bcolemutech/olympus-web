# The Muse — Design Document v0.1

**Status:** Decided 2026-11-20. Epics M-100 (#888), M-200 (#895), M-300 (#896), M-400 (#897) and M-500 (#898) filed; M-100's sub-issues M-101 to M-106 filed as #889–#894 (§7), M-101 and M-102 built; the later epics are filed with their stories planned here, and their sub-issues filed when each is next.
**Project:** Olympus (`olympus-dfa00`)
**Phase:** The Muse, its own app and phase (milestone #27), prefix **M-**, label `muse`. From idea #873.
**Depends on:** the Image Studio (L-700, [`the-image-studio.md`](./the-image-studio.md)), the MCP host (MCP Initiative 1, [`initiative-1-mcp-foundation.md`](./initiative-1-mcp-foundation.md)).
**Related:** [`studio-uploader.md`](./studio-uploader.md) (L-970: local images into the studio)

---

## 1. Purpose

The Muse is a place to build game and story worlds: a world bible and a manuscript, in the spirit of [Campfire](https://campfirewriting.com/write). A project holds:

- characters, factions, locations, objects and concepts, each with its own page;
- classifications, schematics and relationships between them;
- a timeline on the world's own calendar;
- manuscripts.

Its worlds feed the Loom, Craft and other platforms. **It has no AI built in.** Claude, or any other client, works on it over MCP: filling in details, making and attaching images, and reading the bible back.

---

## 2. What there is today

- **Olympus apps** are static pages under `public/apps/`. Each is opened by a claim in `apps.yaml`, uses Firestore under security rules, and uses Cloud Functions for what needs privileges.
- **The Image Studio** (L-700) keeps every image once (`studio_images`), with versions, labels, views and costs. It is opened by the `cartographer` claim, and its tools are in the Cartographer connector.
- **The MCP host** runs two connectors, Scriptorium and the Cartographer, each with its own OAuth scope, audit log and rate limits.
- **The Cartographer's worlds** have characters, factions, locations and lore, shaped for play. Nothing in Olympus has a manuscript, a calendar beyond the Loom's game time, classifications or schematics.

---

## 3. Gap sheet

Answered 2026-11-20.

### Decisions

**Where it fits**

- **MU1** — Its own app, `public/apps/muse/`, opened by a `muse` claim from the Grand Hall, with its own collections (`muse_*`).
- **MU2** — No link to Loom worlds is built. A project and a world stay apart; Claude reads a project over MCP when building a world from it. _(Departed from the recommended bridge: "An export to the Loom does not need to be scoped. Pulling data over MCP should suffice.")_
- **MU3** — A Markdown export, zipped: a page per element, the timeline and each chapter, with their images and the links between them kept. Craft and most tools import it.
- **MU4** — A project is its owner's only; sharing is designed later.
- **MU5** — Desktop and iPad first; on a phone, reading and small edits work.

**Elements**

- **EL1** — Concepts are like Factions: name, aliases, a bio, relationships, classifications and images. For magic systems, religions, languages, laws, technologies.
- **EL2** — Each project can add its own fields per element type: text, number, date, a link to an element, or a choice from a list. MCP can fill them.
- **EL3** — A relationship has a kind seen from each side ("mother of" / "daughter of"), a description, and optionally a time on the timeline. It is shown on both elements.
- **EL4** — A list of relationships on each element now; a graph later.
- **EL5** — Names and aliases are searched instantly on the page; full text (bios, chapters) through MCP and a server search box.
- **EL6** — Typing @ links an element. Its name and aliases elsewhere in the text show as links too, and each element lists where it is mentioned.

**Images, classifications and schematics**

- **IM1** — Photo libraries hold Image Studio images. A photo added in the Muse goes into the studio. The Muse keeps which images are an element's, in what order, and which is primary. The `muse` claim opens the studio too.
- **CL1** — A classification belongs to one element type (Weapons for Objects).
- **CL2** — A class can be assigned at any level: just "Sword" until it's decided it's a Longsword.
- **SC1** — Schematics mark points first: a name, a description and an optional link to a location or object, placed by fraction of the picture. Areas come later.
- **SC2** — A schematic stays a picture with points; making a Loom map from one is left for later.

**The timeline**

- **TL1** — Each project has its own calendar: months and their lengths, days of the week, seasons, hours in a day, and named eras. A date can be just a year, a month or a day.
- **TL2** — Significance runs from 1 to 5. Zoomed far out, only 4–5 show; more appear as you zoom in.
- **TL3** — Events and epochs can sit in lanes (a kingdom, a character, a war).

**Manuscripts**

- **MS1** — CodeMirror 6, loaded from a CDN as ES modules: Markdown styled as you type, fast on long chapters, with exact lines for bookmarks. A reading view shows the text rendered.
- **MS2** — Text wraps at a comfortable reading width, about 70 characters and adjustable, however wide the window.
- **MS3** — Where you left off is kept on each device. Named bookmarks are kept with the manuscript, so they follow you. Both are by chapter and line.
- **MS4** — Word counts per chapter, act and manuscript, plus words written each day and an optional goal.
- **MS5** — MCP can read chapters (by range of lines) and write them. Every MCP write first keeps a version, marked as made by a client.

**Versions and export**

- **VR1** — Versions are kept when you save one by hand, and before every MCP write (MS5). _(Departed from the recommended automatic versions.)_
- **VR2** — The last 50 versions of each thing are kept. _(Departed from the recommended thinning with age.)_
- **EX1** — PDFs come from the browser: a print layout per page, saved from the print dialog. A manuscript gets a book layout.
- **EX2** — PDF and Markdown now; EPUB and Word later if wanted.

**MCP**

- **MC1** — Its own connector, `/mcp/muse`, with the studio's image tools in it too.
- **MC2** — The connector does everything the page can, plus reading a project as an outline, searching text, and lookups across the bible.

**The plan**

- **PL1** — The order: elements; classifications and schematics; the timeline; versions and export; then manuscripts, **last**. _(The notes say "The manuscript is lowest on priority", which overrides the option ticked, "manuscripts second". No bridge epic, per MU2.)_
- **PL2** — Versions are part of M-100's storage from the start; M-400 adds the page to browse and revert them.
- **PL3** — Built alongside the Loom's work; it shares only the studio and the MCP host.
- **PL4** — M-100's exit criterion as proposed (§6).

### Decided in design (not asked)

- **D1 — The page writes to Firestore itself,** under owner-only rules that check each document's shape, as the Symposium does.
  - A writing app saves too often to send every edit through a Cloud Function, and nothing in a project needs privileges.
  - MCP writes go through the Admin SDK, as the Cartographer's do.
  - This differs from the Loom and Cartographer, whose data only the server writes.
- **D2 — One `elements` collection** with a `type`, not one collection per type. The common features (images, classifications, relationships, versions, search) are written once, and a project's index covers every type.

---

## 4. Data

All under `muse_projects/{projectId}`. Owner only: rules check `resource.data.owner == request.auth.uid` and `hasApp('muse')`.

- **The project:** `owner`, `title`, `short` (the line on the home page), `summary` (Markdown), `cover` (a studio image id), `fields` (EL2: per element type, a list of `{ key, label, kind, options }`), `lanes` and `calendar` (M-300), `createdAt`, `updatedAt`.
- **`index/{n}`:** every element's id, type, name, aliases and primary image, in one or a few documents. The page loads it once for lists, search (EL5) and @-links (EL6). It is kept in step on every write, by the page in the same batch, and by MCP the same way.
- **`elements/{id}`:**
  - `type`: character, faction, location, object or concept;
  - `name`, `aliases`, `bio` (Markdown), `fields` (EL2);
  - `images` (an ordered list of studio image ids) and `primary`;
  - `mentions`: the ids its text links to, so "mentioned in" is a query (EL6);
  - for a character, `appearance` (Markdown) and `residence` (a location's id);
  - `classes` (M-200).
- **`relationships/{id}`:** `a`, `b`, `aToB` ("mother of"), `bToA` ("daughter of"), `description`, `when` (M-300), and `ends`, the two ids, for queries.
- **`versions/{id}`:** `of` (the path of the thing), `snapshot`, `name`, `by` (`page` or `mcp`), `at`.
  - The last 50 per thing are kept (VR2); the oldest is deleted when a 51st is saved.
  - Versions cover elements, classes, events, chapters and the project itself.
- **Later epics add:**
  - `classifications/{id}` and `classes/{id}`, and `schematics/{id}` (M-200);
  - `events/{id}` (M-300);
  - `manuscripts/{id}`, `chapters/{id}`, `bookmarks/{id}` and `days/{yyyy-mm-dd}` (M-500).

**Text in Markdown.** A link to an element is written `[King Peter](muse:el/<id>)`. The page shows it as a link, and its name and aliases found elsewhere in the text are shown as links too, on the page only (EL6).

---

## 5. Epics

### M-100 Projects and elements

**What it builds:**

- **The app:** `public/apps/muse/`, an `apps.yaml` entry (claim `muse`), the rules, and the Grand Hall's tile.
- **The home page:** projects with cover and short description. **A project's home:** title, short description, summary, cover, and its sections.
- **The five element types**, with their fields, custom fields per type (EL2), and Markdown bios with a reading view.
- **Lists by type, and search** by name and alias on the page (EL5), from the index.
- **Relationships** both ways (EL3), listed on each element. **@-links and mentions** (EL6).
- **Photo libraries** from the studio (IM1), with a primary image.
  - The studio opens for `muse` as well as `cartographer`: its callables, rules and `apps.yaml` entry take either claim.
  - Adding a photo uploads it to the studio, or picks one from it.
- **Versions in storage** (PL2): a "Save version" action on every element and the project, and a version before each MCP write.
- **The Muse connector** (MC1, MC2) for all of the above:
  - projects (list, get, create, update), elements (list, get, find, create, update, retire), custom fields, relationships;
  - `outline` (a project's elements by type, with their first lines);
  - `search` (names, aliases and full text, server-side, EL5);
  - `lookup` ("what does the bible say about X": the element, its relationships and where it's mentioned);
  - the studio's image tools.

**Grading:** none. The Muse isn't the game, and the grading rubric covers Loom worlds.

### M-200 Classifications and schematics

- **Classifications per element type** (CL1), each marked single or multiple:
  - a tree of classes, each with a page (name, description, images);
  - assigned at any level (CL2), showing the full path ("Sword › Double Edge › Longsword");
  - lists filtered by class.
- **Schematics** on locations and objects:
  - pages of studio art with points placed by fraction (SC1);
  - each point has a name, a description and an optional link;
  - a click on a point opens its card or the linked element.
- **The connector** gains their tools.

### M-300 The timeline

- **The project's calendar** (TL1), with dates at any precision and a date format.
- **Events and epochs**, each with an element-like page:
  - name, aliases, bio, relationships, images;
  - a date or a range;
  - significance 1–5 (TL2), and a lane (TL3).
- **The timeline view:** zoom and pan from eras to days, showing what's significant at each zoom, with epochs as bars in their lanes.
- **Relationships get their time** (EL3). Custom date fields use the calendar.
- **The connector** gains the calendar, events and epochs.

### M-400 Versions and export

- **Browsing and reverting:** each thing's versions, listed and compared with now. Reverting first saves the present as a version.
- **PDF (EX1):** print layouts for an element, a class, the timeline and the project.
- **The Markdown export (MU3):** the project zipped, with images and links between pages kept.
- **The connector** gains versions (list, get, revert) and the export.

### M-500 Manuscripts

- **Manuscripts:** a title and a sneak peek on the project's home, with acts and chapters optional. The view shows the lowest level, with next and previous.
- **The editor** (MS1): CodeMirror 6 with Markdown styling, a reading width (MS2), @-links, and studio images in the text.
- **Bookmarks** (MS3), **word counts, words a day and a goal** (MS4).
- **A book layout for PDF,** and chapters in the Markdown export.
- **The connector:** read chapters by line range, write them (MS5), and count words.

---

## 6. Exit criteria

- **M-100:** on a desktop and an iPad:
  - you make a project with a cover, and add characters, factions, locations, objects and concepts with bios, aliases, custom fields, relationships and studio images;
  - finding one by an alias is instant;
  - Claude, over the Muse connector, adds a character with a generated portrait that appears on its page.
- **M-200:** a weapon classification three levels deep assigned to objects, and a location's floor plan with points linking to rooms, each made on the page and over MCP.
- **M-300:** a project's own calendar, with a war as an epoch and its battles as events in two lanes. Zooming out shows only the major events.
- **M-400:** an element reverted to a version saved before an MCP write, a PDF of a character, and the project's Markdown export opened in another tool with its links working.
- **M-500:** a chapter written on the iPad and continued on the desktop at its bookmark, the day's words counted, and Claude reading and editing a chapter over MCP, with the edit revertable.

---

## 7. Sub-issues

### M-100 (filed 2026-11-20)

| ID    | Story                           | Issue | Depends on  | Model  |
| ----- | ------------------------------- | ----- | ----------- | ------ |
| M-101 | The app and projects            | #889  | —           | Opus   |
| M-102 | Elements and custom fields      | #890  | M-101       | Opus   |
| M-103 | Relationships, links and search | #891  | M-102       | Sonnet |
| M-104 | Photo libraries from the studio | #892  | M-102       | Sonnet |
| M-105 | Versions in storage             | #893  | M-102       | Sonnet |
| M-106 | The Muse connector              | #894  | M-103–M-105 | Opus   |

### Later epics (planned; filed when next)

- **M-200:** M-201 classifications, M-202 schematics.
- **M-300:** M-301 the calendar, M-302 events and epochs, M-303 the timeline view.
- **M-400:** M-401 browsing and reverting, M-402 PDF layouts, M-403 the Markdown export.
- **M-500:** M-501 manuscripts and chapters, M-502 the editor, M-503 bookmarks and stats, M-504 the book layout and connector.
