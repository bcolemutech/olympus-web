# Firestore collections

Every collection in full. [`CLAUDE.md`](../../CLAUDE.md) lists them in one line each; the design docs in `planning/` give the reasoning.

## `symposium_ingredients/{id}`

**Access:** `hasApp('symposium')`

Ingredient inventory

## `symposium_equipment/{id}`

**Access:** `hasApp('symposium')`

Equipment inventory

## `symposium_recipes/{id}`

**Access:** `hasApp('symposium')`

Recipes

## `symposium_shopping_list/{id}`

**Access:** `hasApp('symposium')`

Shopping list items

## `symposium_categories/{id}`

**Access:** `hasApp('symposium')`

Categories/subcategories

## `apps/{appId}`

**Access:** `hasApp(appId)` or admin

App registry

## `pool_handicap/{userId}`

**Access:** Self read/write only

Billiards handicap data

## `loom_worlds/{worldId}`

**Access:** `hasApp('cartographer')`; `hasApp('loom')` for published only

Cartographer worlds, imported from Azgaar or made from scratch over MCP (`create_world`, `add_locations`, `connect_locations` with `links`; `source.kind: 'scratch'`, a plain `map.backdrop` colour; L-391); a route's line and rules (L-715, `functions/loom-canon/routes.js`): `connect_locations` and `connect_places` take `waypoints` (points `[x, y]` the route bends through, in order from the first place, inside the map, at most 40) and `rules` (`requiresAbility`, `hostileToFactionId`), stored on each end of the link, the line turned round: a location's `geo.routes[otherId] = { waypoints: [{ x, y }…], rules }` beside `geo.links[otherId]` (the kind), a map place's link `{ placeId, kind, waypoints, rules }` (waypoints are stored as `{ x, y }`, since Firestore holds no array in an array, and read and sent as `[x, y]`); a route with waypoints is the length of its line × the map's scale, with no winding factor; a move or journey along a route needs its `requiresAbility`, as one into a place does (`hostileToFactionId` is stored, as a place's is, and changes nothing yet); a world's brief (L-711, `functions/loom-canon/brief.js`): `brief: { genre, tone, era, artDirection }`, each optional short text, set with `create_world` and `update_world` (`""` clears a field) or the page's New world and brief form, read in `get_world`; the GM is told it as a BRIEF line in the narrator's prompt every turn, and and, where regions or terrain are painted, a WHERE line beside TIME (L-716, `realms.whereLine`): the terrain, region and realm at the player's place on the lowest region map of their path (the first sentence of a region's and a realm's `description`), the place's own position inside a town or on a grid, none where nothing is painted there; `studio_generate` about a thing in a world with no style of its own (`studio.styleId`) uses its `artDirection` as the style text; realms, regions and terrain (L-712, `functions/loom-canon/realms.js`): terrain is a region map's ground (the topmost item at a point); a region (`regions/{id}`: `name`, `description`, `factionId`, its realm) is shaped by zones on region maps naming it (`zones[].region`, checked against the world's live regions by `set_zones`, only on a region map), its land its zones on any map; a realm (`factions/{id}`) holds the regions naming it, its land theirs, its colour `politics.color` (`colour` on `add_realms` and `update_faction`, else one picked from its id); a place's region and realm are worked out where the world is loaded (`resolvePlaces`): the topmost zone naming a live region at its position, and that region's realm, unless set by hand (a location's `geo.regionId`, `update_location`'s `regionId`, and `factionIds`), marked `geo.regionFrom: 'position'` and `geo.realmFrom: 'region'`; `add_realms` and `add_regions` add them in batches, `where` reads the terrain, region, realm and zones at a point or a place, `get_faction` and `get_region` give their `land`, and `view_image` of a region map takes `overlay: 'regions' | 'realms'`, each filled in its colour with a legend; entity subcollections (`locations`, `factions`, `regions`, `characters`, `lore`, `places`, `battleMaps`, and `statBlocks`, named stat blocks characters and figures name with overrides, their sheets worked out when the world loads; L-393, `functions/loom-canon/stat-blocks.js`; token pictures (L-931, `functions/loom-canon/tokens.js`): `token` on a character, a named stat block and a group of placed figures, a library image of kind `token` or `portrait` held as art is, with its `crop` (`{ x, y, zoom }`, the circle's centre 0–1 and how far in), a person showing their own (a group's or a character's), else their stat block's, else initials (`tokenOf`), set with `set_token` or `token` on `add_character`, `update_character`, `set_stat_block`, `set_sheets` and `place_figures`, the image's `usedIn` kept in the same edit (`functions/studio/token-use.js`; the studio assigner's `character`, `statBlock` and `figure` targets, a group's id `<mapId>/<groupId>`); and `maps`, maps inside maps to any depth, each a `region`, `area` or `grid` with its `parent` place on the map above and its `space`, from the world's `topMapId`, with places in the new shape in `places` (a `mapId`, where on it, `opens`, `links`, `exits`), loaded with the world's `tree`, places with no settlement (the migrated world map's places, grids' ways in and out) apart from today's town places as `mapPlaces`; L-901, `functions/loom-canon/levels.js`; written for today's worlds by the Migrate Map Levels workflow, L-902, `functions/cartographer/migrate-levels.js` (its plan in `functions/loom-canon/level-plan.js`), beside today's data; play reads it through frames (L-903, `functions/loom-canon/frames.js`): the world seen from the lowest region map on the save's path, its places as locations, the area maps under them as towns, grids as battle maps; every reader sees what's stored over the plan of today's shape (`level-plan.js` `modelOf`), so a world with no top map is planned in memory; built over MCP at any depth with `add_map`, `get_map`, `list_maps`, `add_places`, `add_exit`, `set_grid` and `set_area_ground` (L-905, `functions/mcp/apps/cartographer/level-tools.js`), today's tools kept as shortcuts, a grid's layers in its battle map of the same id; templates, maps with `template: true` that ordinary places use (`opens: { template }`, `assign_template`), each place playing its own instance of it, ids ending `__<placeId>`, filled from the place and by its seeded fill tables (L-906, `functions/loom-canon/templates.js`); a map's geometry (L-921, `functions/loom-canon/map-geometry.js`: ground, lines, walls, doors, windows, objects, zones, spawns, lights, notes and hidden things in map units, feet on a grid, materials from its built-in set) at `geometry` on a grid's battle map and on a region or area map's doc, lists of points stored as SVG path data, read with `frames.geometryOf`; a battle map's walls, doors and obstacles of before stored as its geometry, every id kept, and the layers deleted, by the Convert Map Layers workflow; play reads only the geometry, and the grid tools (`set_battle_map`, `set_map_layers`, `set_grid`) are shortcuts that take walls, doors and obstacles in squares and corners and store what they make, `get_battle_map` and `view_image` reading them back (L-928, `functions/loom-canon/layer-geometry.js`; the shapes' checks in `functions/loom-canon/layers.js`, server only)); materials and the object catalog (L-925, `functions/loom-canon/materials.js`: the fixed set of floor, line, wall, door and window materials and the common object kinds, each with art in `public/apps/loom/art/`, drawn as SVG by `node scripts/build-art.js`, which any file there can be replaced from by name; an object is drawn with its own `art`, else its world's art for its kind at the world's `objectKinds` (`{ [kind]: { art?, name?, size? } }`, a library image of kind `object`; the studio assigner's `objectKind` and `object` targets), else the catalog's, else a box with a question mark; `list_materials`, `list_object_kinds` and `set_object_art`, `functions/mcp/apps/cartographer/material-tools.js`; a world's own ground (L-713): `materials` on the world doc, `[{ id, name, like, art? }]`, each behaving as the built-in ground it is `like` (its water flag, so a `depth` is allowed) and drawn with its `art` (a library image of kind `other`, the studio assigner's `material` target, `usedIn` kept) else its `like`'s; the id is lower-case letters, digits and -, can't be a built-in ground's, and ground items (checked by `map-geometry.js` `check(geometry, bounds, own)`, and `geometry-patch.js`) may name it; set with `set_world_materials` (`set` by id, `remove` refused while any map's ground uses one) and listed by `list_materials` with a worldId; `loomGetMap` sends them as `materials` (art as links) on the map, town and battle map, and the painter takes them as its `materials` option; decor (L-945): fourteen catalog kinds in the `decor` group (rubble, bones, candles, cobwebs, sacks, a pile of crates, a tapestry, a banner, a plant, books, bottles, straw, a puddle, chains) and an object's own `decor: true`, which only dresses a room: no click menu, never noticed or searched, said in "What's here?" only when alone, blocking movement only when over 2.5 ft both ways (`map-geometry.js` `objectBlocksMove`, the one rule movement, `blockerAt` and sight read); `dress_room` fills a zone of a grid with it for a theme, a density and a seed, keeping clear of doors, entries, exits and walls and never closing the way through (`functions/loom-canon/dress.js`, `generator-tools.js`); objects are kept to scale with warnings, never refusals, from `set_objects`, `generate_map` and `place_figures` for one under half or over twice its kind's size, into a wall, or a figure too big for where it stands (`functions/loom-canon/scale.js`), and `view_image` takes `sizes: true` to draw each footprint and its size; art sets (L-944, `functions/loom-canon/art-sets.js`): a world's `art.set` (`update_world`, `list_art_sets`), the built-in `classic` unless it names one, one there isn't drawn as `classic` with a warning in `get_world`; a set is a folder of WebP pictures under `public/apps/loom/art/sets/<set>/` with its `manifest.json` (each material's picture, a ground's span and variants, a wall's face, each object's standing picture and foot, from a file or an atlas frame), within the size budget a test checks (`scripts/art/budget.cjs`); a map's shapes patched by id (L-929: `set_ground`, `set_lines`, `set_walls`, `set_doors`, `set_windows`, `set_objects`, `set_zones`, `set_spawns`, `set_lights`, `set_notes` and `set_hidden` take `{ mapId, set, remove }` on a grid, region or area map, and `set_features`, `set_entries` and `set_exits` a grid's spots; `get_geometry` reads a map back; a patch never makes saves forget what they have seen; a seeded first draft of a grid with `generate_map` (L-929: rooms and corridors, caves, a building's interior, a sailing or starship deck; the same seed the same map, written as an ordinary battle map, its rooms zones with no name, to edit with the patch tools; `functions/loom-canon/map-generators.js`, `functions/mcp/apps/cartographer/generator-tools.js`); `view_image` draws a grid, or a region or area map (`of: 'map'`), from its geometry, with `heights`, `hidden` and `from` (fog from a point in feet), `functions/mcp/apps/cartographer/geometry-image.js`; a grid is graded drawn when it has art or both floors and walls, `layer-geometry.js` `drawnOf`; `functions/loom-canon/geometry-patch.js`, `functions/mcp/apps/cartographer/patch-tools.js`); `public/apps/loom/art/swatches.html` shows them all, and with `?set=<name>` an art set's own pictures (L-946: `classic` is painted, every material, wall face, door and window front, catalog object and decor kind, 119 pictures made with the image studio; the pipeline's `board` step lays a batch out for approval and `set` builds a set from approved pictures, `scripts/art/steps.js`); an object you can use has settings in its geometry item (L-926, `functions/loom-canon/objects.js`: `description`, `cardArt`, `container` { contents?, search? }, `locked`, `unlocks` { key?, action? }, `difficulty`, `ap`, `long` and its own `actions`, an `unlocks.action` naming an object whose use unlocks it, a lever elsewhere); hidden things (L-927: the geometry's `hidden` list of `{ id, dc? }`, and a hazard's own `hidden`; `functions/loom-canon/hidden.js`) and spawns (`spawns`, filled by events from the host place's or location's `encounters` table, `{ what, count?, weight? }` rows, set with `update_place` and `update_location`; `functions/loom-modules/combat/spawns.js`)) readable by `cartographer` only; the portraits a world offers players for their own token (L-933): `tokens.player` on the world doc, library image references with their crops, set with `set_world_tokens` or one at a time with `studio_assign` (target `playerToken`, id the image's own), each image's `usedIn` kept, shown on the Cartographer page and in `get_world`; how its ground is crossed off the road (L-361, `functions/loom-canon/materials.js` `wildOf`): each ground material's built-in `wild` `{ speed, danger, impassable? }` (grassland 1, forest 0.5, mountains 0.3; ocean, lake, deep water and lava impassable; danger 1), a world's own material taking its `like`'s, changed per world by `wilds.materials` on the world doc (`{ [materialId]: { speed?, danger?, impassable? } }`, set with `set_wilds`, shown by `list_materials`), and a region's `danger` (0.5–2, 1 when unset; `add_regions`, `update_region`, `get_region`); `functions/loom-canon/wild-paths.js` plans the quickest way across a region map from them, its routes as lanes the traveller's rules allow (`functions/loom-canon/wild-plan.js`)

## `loom_saves/{saveId}` (+ `loom_turns`)

**Access:** Owner with `hasApp('loom')`, read only

Game saves and turn history; each save keeps its own clock, `time` in seconds from Day 1 (rules in `functions/loom-canon/clock.js`); its character's sheet, shaped by the world's game system, at `character.sheet` (attributes, skills, resources, level, traits, conditions, its pool of action points `ap`, its experience `xp` and the levels ready from it `levelsReady` (worked out), successes counted toward rising `uses`, and each attack's rank `attackRanks`, read as `rank` in its formulas (L-841); `functions/loom-canon/sheets.js`); the foes and moments paid for, at `earned` (L-841); where it stands in the levels model, at `at` (a path of `{ mapId, placeId | point | cell }` steps from the top map down, on a grid a `point` in feet (L-922) or, from before, a `cell` read as its centre, checked against canon by `levels.validateAt`; L-901; where it stands since L-903, the frame's `location`, `placeId`, `townPoint`, `mapId` and `cell` kept beside it, and on a battle map where in its square, in feet, at `gridPoint` (L-922: only while it lies in `cell`, else `cell`'s centre, so a square set on its own reads as its centre); `discovered`, `visited` and `waysKnown` stay flat lists by place); what it has found of hidden things, at `secrets` (`{ mapId: { id: 'found' | 'missed' } }`, a trap's id with `hazard:` before it; L-927, `functions/loom-canon/secrets.js`), the figures its events have spawned, at `spawned` (`{ mapId: [group] }`, as `place_figures`' groups; L-927); a level offered at the last long rest and not yet taken, at `levelOffer` (L-843); its turn at `turn` (`{ n, ap, kept, plan, reserved?, moved?, long? }`: the AP left, the AP set aside for a readied attack (L-833), a long action under way; `functions/loom-models.js`, L-832; one from before AP reads with its movement left as its AP); its conditions are effects put on and ticked by `functions/loom-canon/effects.js` (L-815); the fight it is in, if any, at `fight` (round, turn order, whose turn; `functions/loom-modules/combat/`, L-821); sides turned in it (a wary figure turned hostile, a hostile calmed), at `sides` (L-392; `functions/loom-modules/combat/wary.js`); the others it has fought, at `figures` (each one's sheet as this save has it, whether they are down, dead or knocked out (L-822), where they have moved and whether they fled (L-824), on a battle map at a point in feet beside the square, `point`, by the same rule as `gridPoint` (L-922)); the player down, at `down` (dying, stable or out), the story's end at `ended` (died), and the last long rest at `rested` (L-827); a question asked of a complicated action, awaiting the player's answer, at `asked` (L-826); an action awaiting the player's Do it, at `pending` (#673); the settlements it has arrived in, at `visited`, and by settlement the ways in and out it knows there (arrived by, stood in or crossed by; `'all'` where it knew the town before), at `waysKnown` (L-381; `functions/loom-turn/visits.js`; derived on the next turn of a save from before); the character's token picture (L-933), at `character.token`: one of the world's player portraits (`{ imageId, link, width, height, format, crop }`) or the player's own upload (`{ file, version, width, height, format }`, the file at `loom_tokens/{uid}/{saveId}.webp` in Storage, deleted with the save); a save from before has none and is drawn with initials; in the wilds (L-363, `functions/loom-turn/wild-journeys.js`), its `at` ends at a `point` on a region map, read in the frame as `wild: { x, y }` with no `location`: camped on a journey across country, stopped on one, or standing outside a closed place (reached by road, an exit or across country, and never entered); the journey under way at `journey` (`{ mapId, to: { point, placeId?, name? }, path: [{ x, y }], times, routes: [{ from, to }], hours, done, leg, by: 'wild', distance }`: the planner's path and the hours from the start at each point, the stretches on a route in hours, the hours walked and the legs, each leg the wilds module's `dayHours` with a night camped after it)

## `loom_world_state/{worldId}`

**Access:** `hasApp('loom')`, read only

Shared world state

## `loom_creation_rolls/{rollId}`

**Access:** Deny (server only)

Scores rolled for a new character (L-812): the player, the world and the values, used once by `loomCreateSave`

## `loom_systems/{systemId}`

**Access:** Deny (server only)

Game systems as data (L-801; `functions/loom-canon/systems.js`): the sheet (its AP pool, `sheet.ap`), checks and ladder, creation, action points (`ap`: costs, tiers, keep limit, with attacks', map features', doors', traits' and conditions' own; `functions/loom-canon/ap.js`, L-831; or `ap: false` to switch AP off, L-838; conditions change the pool (`modifiers.ap`), set it (`ap: 0`, Stunned) or prices (`costs`, a multiple or `'never'`: Prone doubles moving, Restrained can't move), and `standUp` ends one by standing up, L-834, the flags `noAction` and `noMove` from before AP converted with warnings; systems written with speed or combat economy converted, with warnings), advancement (`{ experience?, use? }`, how characters grow: a curve, a foe's worth, story sizes, quests and grants per level; improving by use's threshold by rank; checked by `functions/loom-modules/advancement/`, L-841; a world turns it off with `rules.advancement: false`), modules (combat's settings checked by `functions/loom-modules/combat/settings.js`; the wilds module's, `modules.wilds`, by `functions/loom-modules/wilds/settings.js`, L-362: off-road travel's `pace`, `dayHours`, `eventChance`, `discover` and `navigation: { check, dc, harder, lost }`, the check each day leg off the road that loses a share of the day by degree, `functions/loom-modules/wilds/navigate.js`; both built-ins set it, Survival against Moderate, a rung harder per 0.5 of danger above 1, so `pool-scifi` gains a Survival skill by Mind; `false` turns off-road travel off, and a world changes any setting with `rules.wilds`, or turns it off with `rules.wilds: false`, set by `update_world` and shown by `get_world`), words; written over MCP (`set_system`, `copy_system`), named by `world.systemId` (the built-in `d20-fantasy` when none; `pool-scifi` is the other built-in, both in `built-in-systems.js`)

## `loom_softcanon/{entityId}`

**Access:** `hasApp('loom')`, read only

Play-invented entities

## `studio_images/{imageId}`

**Access:** `hasApp('cartographer')`, read only

The image studio's library: one record per image, with its kind, labels, versions and link; a version bigger than a screen also has a copy at most 2048 px long, served by its screen link (files in Storage at `studio/{imageId}/`); `via` says how it came (`page`, `mcp`, `upload`, `backfill`, `fit`, or `import` by `studio_import`, its link without the query at `source.url`)

## `studio_jobs/{jobId}`

**Access:** `hasApp('cartographer')`, read only

The image studio's jobs, making an image or editing one: the request, its state (queued, running, done, failed), the image (and version) made, its cost or error; one the model turned away as busy (429) is queued again with backoff, `tries` and `retryAt`, up to 5 tries (L-396)

## `studio_styles/{styleId}`

**Access:** `hasApp('cartographer')`, read only

The image studio's named styles: a name, prompt text and up to 3 reference images, named in a generation or edit; a world's default is `world.studio.styleId`

## `studio_costs/{entryId}`, `studio_costs_month/{yyyy-mm}`

**Access:** Deny (server only)

The image studio's costs: one entry per charged job, and each month's totals by day, model and who (read through `studioCosts`)

## `scriptorium_notes/{id}`

**Access:** Deny (server only)

Scriptorium notes, via MCP (`list_notes` pages titles and dates without bodies by a cursor; `get_note` reads one; L-397)

## `mcp_*` (`oauth_clients`, `oauth_codes`, `oauth_tokens`, `oauth_grants`, `audit`, `rate_limits`)

**Access:** Deny (server only)

MCP OAuth state, audit log, rate limits
