# The Muse — Design Document v0.1

**Status:** Decided 2026-11-20. Epics M-100 (#888), M-200 (#895), M-300 (#896), M-400 (#897) and M-500 (#898) filed. **M-100 shipped 2026-11-23** (M-101 to M-107, #889–#894 and #906). **M-200 shipped 2026-11-25** (M-201 to M-203, #914–#916). **M-300's details decided 2026-11-25** (§3, "M-300 details"), its sub-issues M-301 to M-304 filed as #922–#925 (§7); M-301 built 2026-11-26. The later epics' sub-issues are filed when each is next.
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

### M-200 details (answered 2026-11-24)

Every question as recommended except CL7 and CL8, where the answers keep a tree's shape fixed.

- **CL3** — A type can have several classifications, each its own tree (Objects: Weapons, Materials, Rarity).
- **CL4** — A tree is at most 6 levels deep.
- **CL5** — Filtering a list by a class includes everything beneath it: "Sword" shows Longswords, and each row shows its own class.
- **CL6** — A class has a page: a name, a Markdown description and photos; its path, its subclasses and the elements in it. It can be @-linked, is found by the instant search, and can have versions saved. No relationships or custom fields.
- **CL7** — Deleting a class is refused while anything is in it: an element (live or retired) or a subclass. _(Departed from the recommended "move them up to its parent".)_
- **CL8** — A class can be renamed, and not moved: it stays under the parent it was made under. Siblings are listed by name. _(Departed from the recommended "move and order with buttons".)_ To restructure, make the new class, move the elements to it, and delete the empty one.
- **CL9** — Classifications are made and kept in a "Classifications" section on the project's home, grouped by type. Each type's list has a class filter. An element's page shows its classes as a row of paths, and its edit form picks them.
- **CL10** — No starting trees are built in; Claude builds one over MCP when asked.
- **SC3** — Locations and objects have schematics, as designed.
- **SC4** — Several per element, in order, each one picture with its own points ("Ground floor", "Upper floor", "Cellars").
- **SC5** — A point can link to any element: a room, a chest, the character who sleeps there.
- **SC6** — Numbered pins, with the list of points beside the picture (below it on a phone); picking either lights up the other. _(Changed 2026-11-25 in M-203's testing: the list is below the picture on every screen, and beside it in full screen; see "Changed in testing M-203".)_
- **SC7** — "Add point", then tap the picture; drag a pin to move it, by finger or mouse.
- **SC8** — The picture zooms and pans: pinch, wheel, or + and − buttons.
- **SC9** — A linked element's page says where it is marked ("On The Keep's Ground floor"), a link that opens the plan at its pin.
- **PL5** — Three stories: M-201 classifications (Opus), M-202 schematics (Sonnet), each with its connector tools; M-203 testing the epic by hand, as M-107 was.
- **PL6** — The exit criterion as proposed (§6).

### M-300 details (answered 2026-11-25)

Every question as recommended except CA2 (no leap years) and TV5 (zoom and pan only), with a note on TV4.

- **CA1** — One running count of years underneath, which every date stores, so any two dates compare. Each era starts at a running year and counts its own years from 1, forward, or backward like BC: "3019 T.A.", "200 B.F.".
- **CA2** — No leap years: every year is the same length. _(Departed from the recommended leap rule.)_ So the ready-made Gregorian calendar has 365 days and no 29 February; a world that needs one can add a festival day (CA3).
- **CA3** — A "month" can be a festival day or a few days, and can stand outside the week (Midwinter, Shieldmeet).
- **CA4** — Weekdays run on without a break across months and years. A calendar may have no week.
- **CA5** — No moons now; they come later if wanted.
- **CA6** — A date can carry an hour and minute, from the calendar's hours in a day and minutes in an hour.
- **CA7** — A new calendar starts as the Gregorian one (without leap days, CA2) or blank; Claude builds any other over MCP.
- **CA8** — Dates are written by a pattern chosen from a few ("3 Hammer 1492 T.A.", "the 3rd of Hammer, 1492", "1492-03-03") or made of tokens, everywhere a date shows. They are entered by picking the era, year, month and day.
- **CA9** — Changing the calendar keeps every date's numbers. A date that no longer fits (the 31st of a month now 30 long) is flagged where it shows, and listed on the calendar's page to fix.
- **EV1** — Events and epochs are two new element types, Event and Epoch, in the elements collection, so photos, classifications, relationships, @-links, mentions, search, custom fields, versions and the connector's tools work on them unchanged. _(Replaces the `events/{id}` first planned in §4.)_
- **EV2** — An event is a date or a short range (a siege of six days); an epoch is a range, and may be open at its end ("ongoing"). Events draw as points, or bars when zoomed in on a range; epochs as bars.
- **EV3** — An event or an epoch can name the epoch it is part of. The epoch's page lists its parts in order, and the timeline draws them under it.
- **EV4** — Lanes are rows the project names and orders (a kingdom, a character, the war), each optionally linked to an element. An event or epoch sits in one lane or in none.
- **EV5** — A custom date field can be marked "on the timeline" with a significance (Born, Died, Founded), and a field can be marked as ending another, so a Born and Died pair shows a life as a bar.
- **EV6** — A relationship has a time: a date or a range ("married in 1201", "allies 1190–1210"), shown with it on both elements, and not drawn on the timeline.
- **EV7** — Any date can be marked approximate: shown "c. 1200", and drawn softer.
- **TV1** — The project has a Timeline page, and each element's page lists its events in date order (those related to it, or in a lane linked to it), each opening the timeline there.
- **TV2** — On a desktop and an iPad, time runs across and lanes are rows. On a phone the timeline is a list by date, with the era and year as headings.
- **TV3** — Lanes can be shown and hidden, and the timeline filtered by class ("Battles" only) and to what concerns one element.
- **TV4** — With "Edit" on, tapping an empty place in a lane adds an event there, at that date. Dates are changed in the form, never by dragging. _(The note: "Adding and moving events should first require clicking or tapping an edit button", as schematics and photos open for reading since M-203.)_
- **TV5** — Zoom and pan only: no jumping to a date and no remembered place. _(Departed from the recommended jump and memory.)_
- **PL8** — Four stories: M-301 the calendar (Opus), M-302 events and epochs, with relationships' times and marked date fields (Sonnet), M-303 the timeline view (Opus), each with its connector tools; M-304 testing the epic by hand.
- **PL9** — The exit criterion as proposed (§6).

### Decided in design (not asked)

- **D1 — The page writes to Firestore itself,** under owner-only rules that check each document's shape, as the Symposium does.
  - A writing app saves too often to send every edit through a Cloud Function, and nothing in a project needs privileges.
  - MCP writes go through the Admin SDK, as the Cartographer's do.
  - This differs from the Loom and Cartographer, whose data only the server writes.
- **D2 — One `elements` collection** with a `type`, not one collection per type. The common features (images, classifications, relationships, versions, search) are written once, and a project's index covers every type.
- **D3 — An element's classes are on its index line** (M-201), so a list filtered by a class is instant, from the index alone. The rules' `museEntry` gains `classes`; an index line written before M-201 is rewritten on the element's next save, as every save writes its line.
- **D4 — The page loads a project's classifications and classes once,** as it loads the index: they are few (at most 2,000 classes a project). A class's path, its subclasses and the instant search come from them, so no class needs its ancestors stored.
- **D5 — A class has an id from the same space as elements,** so an element's `mentions` can hold both, and a class's "mentioned in" is the same query as an element's. A link to a class is written `[Longsword](muse:cl/<id>)`.
- **D6 — The single-or-multiple mark is kept by the page and the connector,** not the rules: a single classification's second class replaces the first. A classification can't be made single while an element holds two of its classes.
- **D7 — A schematic's points are in its own document,** an ordered list (the pin's number is its place), so a plan is one read and its version is one snapshot. Its `links` list the elements its points link to, for SC9's query.
- **D8 — Schematic pictures are a studio kind of their own,** `schematic`, so the studio can find plans apart from scenes.
- **D9 — Classes and schematics are versioned things** (§4), each with "Save version", and a version before each MCP write, as elements are.
- **D10 — Claude places points by eye:** the connector's `get_schematic` returns the picture with its numbered pins and a light grid of tenths drawn on it, so Claude can place a point and check it.
- **D11 — The calendar's arithmetic is one plan, `calendar.js`,** the same file on the page and in `functions/muse/` (a test fails if they differ): days in a year and month, a date's day count from the start of year 1, its weekday and season, its era and era year, writing it by the pattern and reading it back from text, comparing, and whether it fits (CA9). The connector takes dates as text in the project's own form ("3 Hammer 1492 T.A.") or as numbers, and writes them in that form.
- **D12 — A date is the existing date field's shape, grown:** `{ year, month?, day?, hour?, minute?, circa? }`, `year` the running year (CA1). A date field written before M-301 is already in it, the running count starting at year 1. A range is `{ from, to }`, `to` a date, or null for an epoch still going.
- **D13 — Each element carries its `timeline`** (an event's or epoch's date, significance, lane and part-of, and the dates of its fields marked on the timeline), worked out by the plans and copied onto its index line, as its classes are (D3). The timeline is then drawn from the index alone, as lists are, and the rules check the line agrees with the element.
- **D14 — Significance by zoom:** the wider the view, the higher the significance shown: 5 only beyond about 500 years across the screen, 4 and up beyond about 50 years, 3 and up beyond about 5, 2 and up beyond about six months, and everything closer in. Epochs always show as bars in their lanes, thinner when below the zoom's significance. The figures are tuned in M-303.
- **D15 — The timeline opens for reading,** as schematics and photos do since M-203: "Edit" shows tap-to-add and each item's edit. It must pan and zoom smoothly on an iPad with 2,000 items.

---

## 4. Data

All under `muse_projects/{projectId}`. Owner only: rules check `resource.data.owner == request.auth.uid` and `hasApp('muse')`.

- **The project:** `owner`, `title`, `short` (the line on the home page), `summary` (Markdown), `cover` (a studio image id), `fields` (EL2: per element type, a list of `{ key, label, kind, options }`; a date field may add `timeline: { significance, ends }`, EV5), `lanes` and `calendar` (M-300), `createdAt`, `updatedAt`.
  - **`calendar`** (M-301): `months` (each `{ name, short, days, outsideWeek }`, CA3), `weekdays` (names; may be empty), `firstWeekday` (the weekday of year 1's first day), `seasons` (each `{ name, month, day }`, where it starts), `hoursPerDay`, `minutesPerHour`, `eras` (each `{ name, short, start, backward }`, `start` a running year), `format` (the pattern, CA8).
  - **`lanes`** (M-302): an ordered list of `{ id, name, element }`, `element` an id or null (EV4).
- **`index/{n}`:** every element's id, type, name, aliases and primary image, in one or a few documents. The page loads it once for lists, search (EL5) and @-links (EL6). It is kept in step on every write, by the page in the same batch, and by MCP the same way.
- **`elements/{id}`:**
  - `type`: character, faction, location, object or concept; event or epoch from M-302 (EV1);
  - `name`, `aliases`, `bio` (Markdown), `fields` (EL2);
  - `images` (an ordered list of studio image ids) and `primary`;
  - `mentions`: the ids its text links to, so "mentioned in" is a query (EL6);
  - for a character, `appearance` (Markdown) and `residence` (a location's id);
  - `classes` (M-200): the ids of its classes, at most 50;
  - for an event or an epoch (M-302): `when` (a date or a range, D12), `significance` (1–5), `lane` (a lane's id or null) and `partOf` (an epoch's id or null);
  - `timeline` (M-302, D13): what it puts on the timeline, copied to its index line.
- **`classifications/{id}`** (M-201): `type` (the element type it belongs to), `name`, `multiple` (true: an element may hold several of its classes), `createdAt`, `updatedAt`.
- **`classes/{id}`** (M-201):
  - `classification`, `parent` (a class id, or null at the top), `depth` (1 to 6);
  - `name`, `description` (Markdown), `images` and `primary` (as an element's), `mentions`;
  - `createdAt`, `updatedAt`.
  - `classification`, `parent` and `depth` never change (CL8).
- **`schematics/{id}`** (M-202):
  - `element` (a location or object), `name`, `order`, `image` (a studio image id);
  - `points`: an ordered list, at most 200, of `{ id, name, description, x, y, link }`, with `x` and `y` fractions of the picture from its top left and `link` an element's id or null;
  - `links`: the linked ids, for "marked on" (SC9);
  - `createdAt`, `updatedAt`.
- **`relationships/{id}`:** `a`, `b`, `aToB` ("mother of"), `bToA` ("daughter of"), `description`, `when` (a date or a range, M-302), and `ends`, the two ids, for queries.
- **`versions/{id}`:** `of` (the path of the thing), `snapshot`, `name`, `by` (`page` or `mcp`), `at`.
  - The last 50 per thing are kept (VR2); the oldest is deleted when a 51st is saved.
  - Versions cover elements, classes, events, chapters and the project itself.
- **Later epics add:**
  - `manuscripts/{id}`, `chapters/{id}`, `bookmarks/{id}` and `days/{yyyy-mm-dd}` (M-500).

**Text in Markdown.** A link to an element is written `[King Peter](muse:el/<id>)`, and to a class `[Longsword](muse:cl/<id>)` (M-201). The page shows it as a link, and its name and aliases found elsewhere in the text are shown as links too, on the page only (EL6).

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

- **Classifications per element type** (CL1, CL3), each marked single or multiple (D6), made in a "Classifications" section on the project's home (CL9):
  - a tree of classes at most 6 deep (CL4), each with a page (CL6): its path, description, photos, subclasses, the elements in it and "mentioned in";
  - a class is renamed, never moved (CL8), and deleted only when empty (CL7);
  - assigned at any level (CL2) in an element's edit form, shown on its page as full paths ("Sword › Double Edge › Longsword");
  - each type's list filtered by class, including everything beneath it (CL5, D3);
  - classes found by the instant search and linked with @ (CL6, D5).
- **Schematics** on locations and objects (SC3), several per element in order (SC4):
  - a studio picture (kind `schematic`, D8) with numbered pins and their list beside it (SC6), zoomed and panned (SC8);
  - "Add point" and a tap places one; dragging moves it (SC7);
  - each point has a name, a description and an optional link to any element (SC5); picking it opens its card, and from there the element;
  - a linked element's page lists where it is marked, opening the plan at its pin (SC9).
- **The connector** gains their tools:
  - classifications and classes: list (as trees), get, create, update, delete, and `classify` an element; `find_elements` filters by class; the photo tools take a class as well as an element; `outline` and `lookup` show classes;
  - schematics: list, get (the picture with its pins and a grid, D10), add, update, remove; and points: set (add or change) and remove.

### M-300 The timeline

- **The project's calendar** (TL1, CA1–CA9; M-301):
  - a calendar page: months and festival days, weekdays, seasons, hours and minutes, eras, the date pattern; a ready-made Gregorian start (without leap days) or a blank one;
  - dates at any precision, with a time of day and "circa", written by the pattern everywhere and picked by era, year, month and day;
  - dates that no longer fit flagged and listed (CA9);
  - the arithmetic in one shared plan (D11); the connector reads and sets the calendar and takes dates as text.
- **Events and epochs** (EV1–EV5, EV7; M-302): two new element types, with everything an element has, plus a date or range (an epoch's may be open), significance 1–5, a lane and the epoch they are part of.
  - The project's lanes, named and ordered, each optionally linked to an element.
  - An epoch's page lists its parts in order; each element's page lists its events (TV1).
  - Date fields marked "on the timeline", and a field ending another to make a bar (EV5).
  - Relationships get their time (EV6).
  - Each element's `timeline` on its index line (D13); the connector's element tools take the new fields, and `timeline` lists what falls in a range at a significance.
- **The timeline view** (TV1–TV5; M-303): time across and lanes as rows, zoomed and panned from eras to days, showing what's significant at each zoom (D14), epochs as bars with their parts under them; lanes shown or hidden, filtered by class or by an element; opened for reading, with "Edit" for tap-to-add (D15); a list by date on a phone.

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
- **M-200:** a weapon classification three levels deep assigned to objects, and a location's floor plan with points linking to rooms, each made on the page and over MCP. Filtering Objects by "Sword" finds a Longsword.
- **M-300:** a project's own calendar, with a war as an epoch and its battles as events in two lanes. Zooming out shows only the major events. A character's birth, from a date field marked on the timeline, shows beside them; the same is built by Claude over MCP.
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
| M-107 | Testing the epic by hand        | #906  | M-101–M-106 | Sonnet |

**Decided while building M-104 (2026-11-20):**

- **The studio's claims.** `claim` in `apps.yaml` may be a list (the Image Studio's is `[cartographer, muse]`). The studio's callables, `studio_*` rules and Storage rules take either claim; a `muse` user's uploads are limited to the `studio.*` files in their own upload folder, not the Cartographer's map files.
- **What a photo is called in the studio.** The element's name is the title (`Name: file` when several are uploaded at once), the project's title as a studio label (lower-cased, cleaned to a label's characters), and the kind from the element's type: `portrait` for a character, `scene` for a location, `item` for an object, `other` for a faction or concept, `cover` for a project's cover.
- **A primary is always one of the photos.** The first photo added is the primary; removing the primary hands it to the next; a primary not among `images` is refused by the rules. Order and primary are changed with buttons (earlier, later, make primary), not dragging, so they work on an iPad.
- **A cover is picked in the project's details form** and saved with it, so cancelling leaves the cover as it was (an image uploaded meanwhile stays in the studio).

**Decided while building M-105 (2026-11-21):**

- **The helper is a plan, not a store.** `versions.js` (the same file in `public/apps/muse/js/` and `functions/muse/`) builds the writes to keep a version and delete the oldest past 50, as `model.js` builds an element's; the page does them as a batch and `functions/muse/version-store.js` does them through the Admin SDK. M-106 calls the store's `save`, or `prepare` to put a version in the batch of the write it goes before.
- **A version's `of` is a full path** (`muse_projects/{p}/elements/{id}`), so the rules can check it is of this project, and a thing's versions are one equality query, sorted in memory.
- **The page keeps what is stored,** not what a form shows: it reads the document just before, so unsaved edits are not in a version.
- **The page may create only `by: 'page'` versions.** The rules refuse `mcp` from a client, so the mark means what it says; the Admin SDK writes the connector's.
- **The 51st deletes the oldest in its own batch,** so a thing never has more than 50 except where two tabs save at once, and the next save brings it back to 50.

**Decided while building M-106 (2026-11-21):**

- **The page's plans run on the server.** `fields.js`, `links.js` and `model.js` are copied to `functions/muse/` byte for byte, as `versions.js` was (a test fails if they differ), and `functions/muse/store.js` does their plans through the Admin SDK. So the connector writes exactly what the page would, and the rules' checks (an element and its index line agree) hold for what it writes.
- **A version goes in the same batch as the change it is before** (`prepare`), for every change to a project (its details or its fields) or an element (its texts, fields, photos, retiring). Making something new keeps none, and relationships keep none: they aren't versioned things (§4).
- **Elements can be named by a name.** Where a tool takes another element (a relationship's ends, a residence, an element field), a name or alias that only one element has does as well as its id; fields are named by key or by label.
- **The studio's tools come from the Cartographer's code without worlds** (`studioTools({ worlds: false })`): find, get, import, labels, costs, generate, edit, jobs and styles, with no world in a search, a generation or a style's default. Assigning, and changing or deleting an image a world may use, stay the Cartographer's. `studio_generate` takes `element` instead of `from`: the element's appearance (or bio) is added to the prompt, and the title, kind and project label are those the page gives a photo; Claude then adds the finished image with `add_photos`.
- **Full-text search reads the project's live elements** (up to 5,000) and scans them on the server: every word must be found, "a phrase" in quotes, accents and case set aside, Markdown read as shown. The page reaches it from the header box's last row, "Search all text", through the `museSearch` callable, which runs the same code.

### M-200 (filed 2026-11-24)

| ID    | Story                    | Issue | Depends on  | Model  |
| ----- | ------------------------ | ----- | ----------- | ------ |
| M-201 | Classifications          | #914  | M-100       | Opus   |
| M-202 | Schematics               | #915  | M-100       | Sonnet |
| M-203 | Testing the epic by hand | #916  | M-201–M-202 | Sonnet |

**Decided while building M-201 (2026-11-24):**

- **The plans are `classes.js`,** the same file in `public/apps/muse/js/` and `functions/muse/` (a test fails if they differ), as `model.js` is. It builds the tree (D4), its paths and what lies beneath a class, and the writes for classifications, classes and an element's classes; `model.js` checks an element's `classes` with it.
- **Every save of a live element writes its index line** (D3), changed or not. The rules compare the line's `classes`, so a line from before M-201 is brought up to date by the element's next save, and until then it reads as none.
- **The classification's name is the first step of a path:** "Weapons › Sword › Double Edge › Longsword". Lists and pickers, already inside a classification, show the path from its top class ("Sword › Double Edge › Longsword").
- **Names are unique where they'd be confused:** a classification's among its type's, a class's among its siblings, whatever the case. A class can then be named by its path, or the end of it, as well as by its id (the connector's tools; "Sword › Longsword", with › > or / between), or by a name only one class has.
- **A class added takes the place of one in its line:** classifying a Sword as a Longsword replaces Sword (and a Longsword made a Sword again replaces Longsword), even in a multiple classification, so an element never holds a class and its own ancestor. In a single classification it replaces the other class too (D6).
- **The element's form picks classes,** per classification, from a list indented by depth, with each picked one shown as a chip to take off: no dragging, so it works on an iPad. The list on each type's page filters by one class at a time, kept while you come back to it.
- **Making a classification single reads its type's retired elements** as well as the index, so one brought back never holds two classes of it. Deleting a class asks whether any element, live or retired, holds it (one query).
- **Classes are found by full-text search** (name and description, `type: 'class'`) unless only element types are asked for, and `lookup` reads a class in full when a name best names one.

**Decided while building M-202 (2026-11-24):**

- **The plans are `schematics.js`,** the same file in `public/apps/muse/js/` and `functions/muse/` (a test fails if they differ). It checks a schematic, its points and their links, and builds the writes to make, change, order and delete them and to add, change and remove a point; `markedOn` answers SC9 from the schematics a query reads.
- **The rules check little of a point.** Firestore stops evaluating a request at 1,000 expressions and the rules can't walk a list, so they check the list's size (at most 200), that the element is a location or an object, and that each of the first 16 points lies on the picture (0 to 1 each way, at about 40 expressions a point: a 22-point plan fits, a 25-point one doesn't). The plans check every point's fields, so the page and the connector are what keep the rest (D6 and CL7 are kept the same way).
- **A point's id is `p` and a number,** the next one above any in the list, so it is never reused while a higher one stands; its number on the pin is its place in the list, and taking one off renumbers those after it. A point can be named by its id, its number or a name only it has.
- **A point needs a name,** so a point placed by a tap starts as "Point 3" with its card open to rename it.
- **A link must be to a live element when it is made or changed,** and a point whose element is retired later keeps it (the page and `get_schematic` say it is retired). Descriptions are Markdown with @-links but record no `mentions`: they don't show in an element's "mentioned in".
- **A schematic's order is its place among its element's,** from 0, and a move renumbers the others it has to, so ties and gaps mend themselves. At most 30 to an element.
- **"Marked on" is on every element's page,** not only locations and objects: any element can be linked. It opens the element that owns the plan at `#/p/<id>/e/<element>/m/<schematic>/<point>`, with that pin picked and the picture zoomed in on it.
- **`get_schematic` draws the pins and the grid on a copy of the studio picture** (at most 1568 px, as a JPEG) with sharp. The numbers are drawn as strokes, so no font is needed; the grid's lines are marked 1 to 9 along the top (x) and down the left (y).
- **A schematic can be named by its name** in the connector's tools when `elementId` says whose it is; `list_schematics` and `add_schematic` take an element by id or by a name only it has.
- **The studio gains the kind `schematic`** (D8): in the library's kinds, the studio page's filter and upload, and `studio_generate`'s `kind`.

**Changed in testing M-203 (2026-11-25):** on an iPad the picture was too small and the controls around it crowded it out.

- **A schematic opens for reading.** "Edit schematics" in the section's bar shows what changes them: rename and order, change the picture, remove, add a schematic, versions, "Add point", and a point's Edit and Remove. "Done" hides them again. A pin can be dragged only while editing, so panning can't move one by mistake. An element with no schematics shows "Add a schematic" without asking, and a new one opens for editing.
- **The picture is the card's full width** (no taller than 70% of the screen), with the picked point's card and then the points below it, in as many columns as fit.
- **"⤢" puts it over the whole screen:** a bar with Close, its name, Points and Edit (and "Add point" while editing), the picture fitted whole and centred, the points in a panel beside it (over it on a phone, closed at first), and a point's card by its pin. Escape, Close or going to another page leaves it.
- **Photos open for looking at too** (an element's and a class's): the primary large, and with more than one a row of small pictures, each shown large when tapped (the primary stays). "Edit photos" shows uploading and picking, and each photo's Make primary, ← → and Remove; with none yet, adding shows unasked, and photos just added open for editing.

### M-300 (filed 2026-11-25)

| ID    | Story                    | Issue | Depends on  | Model  |
| ----- | ------------------------ | ----- | ----------- | ------ |
| M-301 | The calendar             | #922  | M-200       | Opus   |
| M-302 | Events and epochs        | #923  | M-301       | Sonnet |
| M-303 | The timeline view        | #924  | M-302       | Opus   |
| M-304 | Testing the epic by hand | #925  | M-301–M-303 | Sonnet |

**Decided while building M-301 (2026-11-26):**

- **A project without a calendar uses the Gregorian** (365 days, no leap days), so a date written before M-301 reads as before by its numbers and the picker has months from the start; "Start again from" on the Calendar page puts the Gregorian or a blank one in its draft. Its first weekday is set so 2026's weekdays are the real ones; with no leap days they drift a day every four years from there.
- **An era runs from its `start` to the next era's,** and the first reaches back before its start too. A forward era counts its start as year 1; a backward one counts its last year (the one before the next era) as 1, so it can't be the last era. The Gregorian's are BCE (backward) and CE from year 1, so the running year 0 is 1 BCE.
- **The pattern's tokens:** `{d}` `{dd}` `{do}` (3rd) `{W}` (weekday) `{M}` `{Ms}` `{m}` `{mm}` `{y}` (the year of its era) `{Y}` (the running year) `{E}` `{EE}`. A date without a day or a month leaves those tokens out with the text that joins them ("Hammer, 1492 T.A." from "the {do} of {M}, {y} {E}"), as do era tokens in a calendar without eras and the weekday on a day outside the week. The time is not a token: it follows the date after a comma ("…, 14:05", or "…, 14h" for an hour alone), and "c. " goes before.
- **Reading text** finds the era, the month and any weekday by name or short name (the longest match, case and accents aside), "c."/"circa" at the start and a time at the end, then takes the numbers in the order the pattern puts them, dropping the day and then the month when there are fewer. A year without an era named is in the last era, unless the pattern writes the running year. A word that is no month or era is refused, so a misspelling isn't read as something else. Names must hold a letter and be unique across months, weekdays and eras.
- **A new date must fit the calendar; a stored one is kept as it is** (CA9): saving an element unchanged keeps a date that no longer fits, flagged "Doesn’t fit the calendar" where it shows and in the picker, and listed on the Calendar page (which reads the live elements of the types with date fields), and `get_calendar` lists them as `misfits`.
- **The rules bound the calendar,** as they do `fields`: its keys, its lists' sizes, the hours, minutes and first weekday as whole numbers in range, and the pattern's length; the plans check each part.
- **The Calendar page** is `#/p/<id>/calendar`, opened from the project's Settings, where a line says how dates are written. Months, weekdays, seasons and eras are rows with ↑ ↓ and Remove (no dragging); the example under "How dates are written" follows the draft as it is typed.

### Later epics (planned; filed when next)

- **M-400:** M-401 browsing and reverting, M-402 PDF layouts, M-403 the Markdown export.
- **M-500:** M-501 manuscripts and chapters, M-502 the editor, M-503 bookmarks and stats, M-504 the book layout and connector.
