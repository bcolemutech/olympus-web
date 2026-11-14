# Cloud Functions

Every function exported from `functions/index.js`, in full. [`CLAUDE.md`](../../CLAUDE.md) lists them in one line each.

## `setAdminRole`

**Who can call:** Admin only

Grant admin custom claim

## `removeAdminRole`

**Who can call:** Admin only

Revoke admin custom claim

## `listUsers`

**Who can call:** Admin only

List all Auth users

## `inviteUser`

**Who can call:** Admin only

Create new user account

## `manageAccess`

**Who can call:** Admin only

Add/remove app from user's claims

## `setUserDisabled`

**Who can call:** Admin only

Enable/disable a user

## `loomCreateSave` / `loomDeleteSave`

**Who can call:** `loom` claim (own saves)

Start or delete a game; a new game's character is made from the player's choices by the world's system's method (`creation`, checked by `functions/loom-canon/creation.js`), or is the world's premade one (`rules.startingSheet`); its token (L-933) is `token: { image, crop? }`, one of the world's player portraits (`world.tokens.player`) by its image id, kept at `character.token` (`functions/loom-canon/tokens.js` `pickToken`). Deleting a save deletes its uploaded token picture, if it has one

## `loomCreationRules`

**Who can call:** `loom` claim

How a new character is made in a world, for the new-game form: the method and its settings, each score's modifier, the skills and traits to choose; or that it's premade; and the portraits it offers players for their own token (`portraits`: `{ id, link, crop }`, L-933), which the Character panel reads too

## `loomUploadToken`

**Who can call:** `loom` claim (own saves)

A player's own picture for their character's token (L-933; `functions/loom-token-upload.js`): a PNG, JPEG or WebP of at most 5 MB, base64-encoded, with a crop (`{ x, y, zoom }`). It is checked by its bytes and by `sharp`, turned upright, squared at the crop, resized to 512 px and written as WebP with no metadata at `loom_tokens/{uid}/{saveId}.webp` in Storage, which only its owner reads (the page fetches it signed in, never by a link) and only the server writes; the save's `character.token` becomes `{ file, version, width, height, format }`. A non-image, a file over 5 MB and another's save are refused

## `loomRollCharacter`

**Who can call:** `loom` claim

Rolls a new character's scores with the server's dice, for a system that makes characters by rolling; kept in `loom_creation_rolls` for `loomCreateSave` to use once

## `loomPlayTurn`

**Who can call:** `loom` claim (own saves)

Run one turn of the Loom pipeline (typed text, a move made on the map, continuing a plan, or ending the turn); steps on a battle map, and walks in a town with ground (with "Walk there"), are worked out without the model; a move on a battle map (to a square, or `{ verb: 'move', point }` in feet) is planned in feet since L-922 (`functions/loom-canon/map-paths.js`, shared with the page, which previews it with the same `moveTo` on the map as far as the save has seen it, `functions/loom-turn/known-map.js`): through any gap as wide as the character (`sheet.size`: tiny, small, medium 2.5 ft, large, huge, gargantuan), at any angle, its length at 1 AP per 5 ft rounded up once for the move (difficult ground at its price, a closed door opened from within 5 ft of it at its own), a stop out of AP inside the square it was going to counting as arriving; a battle map is read from its geometry alone (L-928): its doors through `functions/loom-canon/doors.js` (by id, a save's state over the map's, its key, the squares either side), what covers a square through `maps.blockerAt`; objects you can use through `objects.js` (L-926: `{ verb: 'object', object, act }` from the click menu, or typed, open, search, unlock or one of their own actions at `object:<id>`, in reach, at their AP, a locked container opened by its key and refused without, picked or forced as a rolled and maybe long action, a lever's use unlocking the doors and objects that name it; their state in the save's `objects`; `{ verb: 'look', object }` describes one, never what a closed one holds); hidden things (L-927): after any action that leaves the save on a battle map, and after a step the rules walk alone, each hidden thing newly in sight is rolled for once by the system's `checks.notice` against its `dc` (a hit found and told, a miss remembered and silent; `functions/loom-turn/noticing.js`), and Search (`{ verb: 'search' }`, or typed with no target) rolls every one in sight not yet found for a standard action, saying the same and costing the same when nothing is found; a trap unfound still springs when walked into, which finds it; a rest broken somewhere dangerous fills the map's spawns before the fight starts; every grid turn runs on action points (L-832): steps priced by the cost table as the character pays it (difficult ground double, a door its cost), every action its cost (a few words 2, an object or a lock 5, Dodge 8, an attack 10 or its own, anything else typed by the tier INTERPRET names, minor 3, standard 10 or major 20, the system's `ap.tiers`, L-835), one the AP left won't pay for refused with its cost, a long action (`long: { ap }` on a feature or door) put in over several turns until done, walked off or hurt; off a grid, actions cost nothing; with the world's system's AP off (`ap: false`, L-838) steps on a grid are free, each turn takes one action anywhere (`turn.acted`), and a fight runs on the combat module's `turn` rule (actions a turn, reactions a round); a move to a world place from anywhere in a town walks to the way out serving the route first (on the streets turn after turn, through its places in one go) and sets out (#669), leaving only by a way out the save knows (L-381: in a town with ground, those it arrived by, stood in or sighted), and arrives by the way in facing where it came from (a way in may serve its routes only to and from certain places, `entrance.to`, and is then the one used for them; L-395): on the way in's battle map the first time, on the town map at the way in once visited (L-382); a move to a settlement visited before that isn't a neighbour is a journey there (L-384; `functions/loom-canon/journeys.js`): the quickest path through settlements visited, set out on by the first leg's way out, its time the legs' plus each crossed town's walk from way in to way out, the ways used in each town crossed found there, and with no such path "No way you know leads there."; "What's here?" (`{ verb: 'look', cell | door }`, or a typed look at something on the map) has NARRATE describe that spot from the facts the save knows of it, an empty one plainly with no model, spending and recording nothing (#672; `functions/loom-turn/looking.js`); out of a fight, talking with or handling someone or something needs the player beside it: a typed action out of reach, and any of the GM's suggestions (`{ text, verb, target }`, chosen as `{ verb: 'suggested', text, act }`), answers with a `confirm`card (the walk, the action, any roll, its cost) kept as the save's`pending`, and `{ verb: 'confirm' }`walks over and then acts; looking and talking roll nothing unless resisted (#673;`functions/loom-turn/reach.js`); a rolled action returns its `roll`for the panel's roll card (its dice, its line with each term named, the degree in the system's words), and NARRATE is told the degree and the world's game system; walking into a hazard on a battle map stops there and triggers it (its save, the condition;`functions/loom-canon/hazards.js`), and End turn ticks the character's conditions; coming into sight of a hostile on a battle map, or attacking someone there, starts a fight (a wary figure, L-392, challenges instead: it turns hostile when attacked, when the check its `challenge`names fails against it, or by a trigger, a door opened or forced, a feature touched, an ally attacked or an area entered, which can also calm a hostile; NARRATE is told its challenge; the combat module's`wary`setting, on by default) (initiative and surprise by the server's dice), in which each End turn is a round and the model narrates only its start and end (L-821); an attack (typed, or`{ verb: 'attack', target, attack?, subdue? }` with no model to read it) is rolled by the combat module, its damage by degree and type taken from the foe in the save, and in a fight is the rules' lines and roll card (L-822); in a fight, End turn plays everyone else's turns by their tactics (role and posture), each planned within their AP (L-836: a brute strikes again while it lasts, a skirmisher strikes and steps away, a guard strikes once and keeps the rest to react, an archer readies a shot with what's left, a caster's area only when it can pay), morale breaks foes into flight or surrender, figures placed on the battle map (`place_figures`) fight like characters, (L-824); the player at 0 falls by the system's down kind (dying with saves, wounds, out at once), can then only end their turn (a dying save each), and when the fight ends comes round, dies (the save ends with an epilogue and takes no more turns) or, with the world's death off, comes round where NARRATE's chosen fate puts them; short and long rests (`{ verb: 'rest', rest }`or typed) restore by the system's rests, a long one once a day, and somewhere dangerous can be broken, hostiles there starting a fight (L-827); attacks count long range, cover, flanking where the system has it, Dodge and the target's defending reaction (a trait's); reach and ranges (in squares of 5 ft) are measured in feet between people, edge to edge, each at their point and width, and areas are true shapes in feet catching people by where they stand (L-922;`map-paths.js` `bandOf`, `areas.catches`), flanking and line of effect still by squares; foes plan their moves on the same planner, opening no doors and never walking off a drop; sight on a battle map is worked out on its geometry from each viewer's eyes (L-923; `functions/loom-canon/sight.js`: walls, doors not open or see-through, windows and tall objects hide only where their top reaches the eyes, the floor under the viewer plus their size's eye height, so a gate or glass shows what's beyond and a ledge sees over low walls; `maps.viewerOf`), cover from lines across the target (four of five stopped heavy, any stopped or crossing a low wall, a table or glass partial), and an attack from 5 ft or more above the target adds the system's `highGround`; a rise of more than 2.5 ft can't be walked up, and a drop of 10 ft or more walked off stops the walk there and is a fall: the system's `falls` damage, then Prone (`functions/loom-modules/combat/falls.js`), told to NARRATE, as are the heights in sight; a turn's `moved` is feet walked, for End turn's line; in a fight, what a fighter doesn't spend on their turn is kept (`kept`on their entry in the fight; capped by the system's`ap.keepLimit`) and pays their reactions until their next turn, as many as it covers (L-833): stepping out of a foe's reach draws its attack, at the attack's cost, unless the player withdrew (checked along the walk in feet, a walk struck down stopping where it was struck, L-922); a defending reaction costs `defend`; a readied attack goes off at the first foe to come into it, paid from the AP Ready set aside (`turn.reserved`, lost if it never fires); and Dodge, Withdraw, Stand (`{ verb: 'stand' }`, ending Prone, L-834), Ready (`{ verb, attack?, target? }`) and Use (`{ verb: 'use', feature }`, narrated) each cost their AP (L-823; Dash retired with AP, L-832); an End turn or a fight starting answers with everyone else's `turns`to play out on the map, each walk and attack card (L-828), and an End turn in a fight with`held`(the AP kept for reactions and what was left of it, for the turn bar; L-837); a named (canon) character's turn in a fight is chosen by one Flash call from the whole turns the rules list (on AP only those that fit, each with its cost), with their`combatNotes` (`set_tactics`), falling back to their role's tactics, and a round they act in is narrated once (L-825; `functions/loom-turn/named-turns.js`); experience is paid by the system's advancement as the turn is committed (L-842; `functions/loom-modules/advancement/earn.js`): each foe overcome by any means (down, fled, surrendered, talked down) its worth for its level against the player's, and a story moment NARRATE names (`moment: { id, size }`, one a turn, its id normalised) its size's amount, each once per save (`save.earned`), nothing with the world's advancement off, every award in the answer's `awards`for the journal; NARRATE is told the player's level against each foe's; a long rest with a level ready (not in a fight) answers with a`levelUp`offer (L-843;`functions/loom-modules/advancement/level-up.js`): the next level's grants (attribute points, skill ranks, traits or attacks from a list) and their limits, with the GM's suggestion from one Flash call (`functions/loom-turn/level-up.js`), checked like the player's own and replaced by the rules' when it fails; `{ verb: 'levelUp', choices: { attributes?, skills?, traits?, attacks? } }`takes it (checked like creation's,`level`raised, resources raised by what their maxima rose), a second ready level offered straight after; the offer is kept as the save's`levelOffer`until any other turn; with the system's`use`, a skill check that succeeds with stakes (INTERPRET's `params.stakes`, or in a fight) counts toward its skill, and an attack that hits in a fight toward that attack (`sheet.uses`), and at a long rest each at its threshold rises one rank up to its top, its count reset, every rise in the answer's `rises`(L-844;`functions/loom-modules/advancement/use.js`); a typed action is judged for plausibility by INTERPRET: an improbable one is rolled at the ladder's top rung, an extraordinary one refused, and a complicated one answered with a question (`asked`), the player's next typed text read as how; refusals and questions spend no AP or time (L-826); at any depth (L-903; `functions/loom-turn/depth.js`): arriving at a place that opens a region map goes in by its way in (a place on it with `entrance`) facing where the traveller came from, a place's `exits` lead to a place on any map in their own time, and a move to a place outside the frame climbs out of each region map by a way out, crosses the lowest map holding both and descends, each stage in its own map's time (`timeRules(world, map)`: route kinds and speeds from the region map, then `world.rules.time`, then the defaults), only to places discovered; every answer carries the save's `time`; the player's token chosen in play (`{ verb: 'token', token: { image, crop? } | { crop } | null }`, L-933; `functions/loom-turn/player-token.js`): one of the world's player portraits, the circle moved on the token they have, or none, costing no AP and no time, recording no turn and dropping nothing waiting; an upload given up deletes its file; across country (L-363, `functions/loom-turn/wild-journeys.js`): `{ verb: 'travel', to: <place id> | { mapId?, point: { x, y } }, offRoad: true }` (or typed, "cut through the forest to Carrow") sets out from where the save stands on its region map (at a place, a town's way out, or in the wilds) for a place it knows on that map or a point on it, along the planner's path (`wild-plan.js`), and walks the first day leg; `{ verb: 'travel', go: 'on' }` walks the next and `{ verb: 'travel', go: 'stop' }` ends the journey where it is; a move to a place made in the wilds sets out for it; each leg is the wilds module's `dayHours` of travel, then a night camped in the wilds (the camp's WHERE line told to the GM), so the whole takes the plan's hours and a night between each day; a leg off the road rolls the module's navigation check against the danger along it (a roll card), a failure losing its share of the day, drifting the camp off the path and planning the rest again from there; places within `discover` of a leg's path are discovered; a closed place reached by road, by an exit, between parents or across country leaves the save outside it, in the wilds at its edge, and entering it is refused (the old turn-back is gone); after each leg an event may happen at the camp or arrival (L-364, `functions/loom-modules/wilds/events.js`): a roll from 0 to 1, seeded by the save's id, the leg and the hour it began (so the same turn rolls the same), is under the chance `eventChance` × the ground's danger (its material's × its region's), at most 0.95, and a fifth of that (the module's `routeChance`) on a route, by the share of the leg's hours on one; the path walked (`wild`, or the route kind with most of the leg's hours) shapes the event, which is a weighted pick of the rows that fit the camp's ground (`terrain`) and the path (`path`) from the first of its region's `encounters`, its map's, the world's and the built-ins (narrated; some for any path, some for the wilds, a road or trail, or the sea) with a row that fits; the turn records `event: { roll, chance, happened, danger, material, path, event?: { kind, text, source, what?, count?, narrated } }`, the text is told with the leg, and the GM is given it as an ON THE WAY section; a row with figures (`what`) is a creature to meet and told until a map plays it (L-366); with off-road travel off (`modules.wilds: false`, `rules.wilds: false`) setting out is refused with its reason

## `loomWorldRatings`

**Who can call:** `loom` claim

Each published world's band (Playable, Rich, Vivid or Legendary) for the Loom's world list; the band's name only

## `loomGetMap`

**Who can call:** `loom` claim (own saves)

The world map a save may see: its discovered places, links, and which are open; in a town, its places for the town view; each route out of here with how long the trip takes (`travel`), and each link with its `waypoints` when it bends (L-715), which the world view draws it along, one a neighbour, with no way in to choose (L-383: arrival is by the way in facing here); on each settlement visited before that isn't a neighbour, its journey from here (`journey`: its time, the towns passed and the kinds of route; `false` with no known way; L-384), for the world map's Journey to; the save's time (`time`, for the map's clock: "Day 1, evening"); the save's turn (its AP left of the pool, any long action, the plan, and what a step costs the character, `prices`, for the path preview; L-832; with each action's and feature's cost, `prices.actions` and `prices.features`, for the click menu, L-837); the world's game system for the rules reference (`rules`, with its AP pool, costs and tiers at `rules.ap`, L-837, and how characters grow at `rules.advancement`, L-845); a level offered at the last long rest and not yet taken (`levelUp`, with the rules' suggestion, for the level-up form after a reload; L-845); the character's sheet as the player reads it, for the Character panel and the strip (`character`, with `experience`: the total earned, this level's and the next's, and the levels ready; left out with advancement off, L-845); the fight it is in, if any (`fight`); and on a battle map the player's attacks, each with its AP cost, and whether Subdue applies (`combat`), with each person in sight's cover from the player (L-828), and its areas as far as they've been seen, with the one the player stands in (#670; `functions/loom-canon/map-areas.js`); the world's art set (`artSet`, on the map, the town and the battle map; L-944); on a battle map where the save stands in feet (`herePoint`), the character's size (`size`) and the map's geometry as far as seen (`geometry`, L-922; with its lines and lights, objects' art as links only, L-924), the world's own object kinds' art (`objectKinds`, links), each person in sight's token picture (`people[].token: { link, crop }`, L-931; links only, also on each turn played out; drawn standing by `draw.js`, and by `view_image` as round tokens with their pictures, L-932) and the outline of what's in sight now (`fog.view`, in feet, for the fog's edge; L-924); the objects there is something to do with that it has seen (`objects`: each with its state, description, what it holds once open, and its actions at this character's AP cost; L-926; the grid view opens the click menu on one with its card across the top, `battle.js` and `engine.js` `openMenu`'s `card`); a region map's own geometry and space (`map.geometry`, `map.space`) and a town's area map's (`town.geometry`, `town.space`), whole, hidden things left out, for drawing (L-924), a town with ground drawn from it under its own (L-928: cobbled streets, roofs, water, bridges and fords, stone walls; `functions/loom-canon/ground.js` `geometryOf`, worked out as it's sent); on a region map with no image, who holds the land (`map.realms`, L-714: each realm's `id`, `name` and `colour`, its land's edge as `outlines`, runs of points `[x0, y0, x1, y1, …]` in the map's units that leave out the border between a realm's own regions, its zones as `land` to fill, `{ outer, holes }`, and `centre` for its name, always inside its land; `functions/loom-canon/realm-borders.js`; left out with an image or no realm); the region map it stands on (`mapId`, its places as `places`) and the trail (`trail`: each map from the top down to the one it is on, `{ mapId, name, kind, placeId? }`, the place on it the save's path goes through; L-903); with `peek` (a region map on the trail above it), that map as seen from that place, `peek: true` (L-904; the Loom's trail); the player's own token (`token`, and on a battle map `battleMap.you.token`; L-933): a portrait's `{ link, crop }`, or their upload's `{ file, version, crop }`, read as its owner; in the wilds (L-363), `here` null and `wild` the point the save stands at, and on a journey across country `journey` (`{ mapId, to, path, leg, hoursLeft, label }`, the path still ahead from where it stands)

## `cartographerImport`

**Who can call:** `cartographer` claim

Uploaded Azgaar map → draft world

## `cartographerCreateWorld`

**Who can call:** `cartographer` claim

New world (L-711), from the Cartographer page: a draft world from scratch, made as the connector's `create_world` makes it (`functions/cartographer/scratch.js`): a name, an optional studio image of kind `worldMap` (`imageId`, else a plain backdrop), the scale (`milesPerUnit`, default 3) and a brief (`brief`: `genre`, `tone`, `era`, `artDirection`; `functions/loom-canon/brief.js`). A map image that can't be set leaves the world made, with a warning

## `cartographerSetBrief`

**Who can call:** `cartographer` claim

A world's brief, from its card on the page (L-711): `{ worldId, brief }`, each field given set and one given as `""` cleared; on a draft or a published world, reaching games on their next turn. A field over its length (genre 80, tone 160, era 120, art direction 600 characters) is refused with its reason

## `cartographerPublish`

**Who can call:** `cartographer` claim

Publish a draft world to the Loom

## `cartographerCompletion`

**Who can call:** `cartographer` claim

How built each world is, for the Cartographer page: open places, its score and band, counts by band per kind, its biggest gaps, and its maps as a tree, each graded by its kind with what it lacks (`maps`; L-905, `grading.js` `gradeMaps`; a region map also lacks terrain and shaped regions, L-718); and its tokens (`tokens`; L-934, `loom-canon/tokens.js` `previewsOf`): for characters and for stat blocks, how many there are and which have a picture (link, crop and, for a character, side, as the Loom draws it) or none, at most 24 of each, shown on the page as a Tokens section

## `cartographerTownImage`

**Who can call:** `cartographer` claim

Attach, replace or remove a town's art (an uploaded PNG or SVG drawn behind the town view), through the image studio's library

## `cartographerMapImage`

**Who can call:** `cartographer` claim

Attach, replace or remove a battle map's art (an uploaded PNG or SVG drawn under its grid), through the image studio's library; `fit` (crop, pad or stretch) fits it to the grid's shape as a new version, the original kept (L-396; `functions/studio/fit.js`), as `studio_assign` and `cartographerTownImage` do

## `studioUpload`

**Who can call:** `cartographer` claim

Add an uploaded image (PNG, JPEG, WebP or SVG) to the image studio's library, with its title, kind and labels

## `studioCosts`

**Who can call:** `cartographer` claim

The image studio's spending for a month, for its page: the total against the $50 warning figure, by day, model and who, and the latest charges

## `studioGenerate`

**Who can call:** `cartographer` claim

Start making an image from the studio page's form (prompt, kind, tier, shape, references, title, labels); returns the job at once. A `token` or `portrait` is asked for as a head-and-shoulders face, centred, on a plain background, with nothing important near the edge (it is cropped to a circle; L-934), and `from` may be a stat block (drawn as a square token from its name, traits, size and who stands for it) as well as a place, town, battle map or character

## `studioRunJob`

**Who can call:** Cloud Tasks queue only

Runs one studio job, at most 8 at once: a new image, or an edit that becomes an image's next version, made with a Gemini image model on Vertex, its cost recorded; a busy model's 429 queues it again after a wait (L-396)

## `mcpListConnections` / `mcpRevokeConnection`

**Who can call:** Signed-in user (own connections)

Grand Hall "Manage connections"

## `mcpServer`

**Who can call:** OAuth bearer token per connector

MCP connectors (Scriptorium, Cartographer) and the OAuth server
