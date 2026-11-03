'use strict';

/**
 * What library images can be assigned to, and what a world holds for one
 * (planning/the-image-studio.md §4.4; L-704 / #540). No dependencies, so the
 * scripts (with their own firebase-admin) can load it too (L-705).
 *
 *   map        the world map           world.map.image      kind worldMap
 *   cover      its cover image         world.cover          kind cover
 *   town       a settlement's town     location.town.image  kind town
 *   battleMap  a battle map's art      battleMap.image      kind battleMap
 *   objectKind a kind's art in a world world.objectKinds[id].art   kind object
 *   object     one object's art         its entry in the map's geometry (L-925);
 *                                       id is "<mapId>/<objectId>"  kind object
 */

const TARGETS = Object.freeze({
  map: { kind: 'worldMap', label: 'world map' },
  cover: { kind: 'cover', label: 'cover image' },
  town: { kind: 'town', label: 'town art' },
  battleMap: { kind: 'battleMap', label: 'battle-map art' },
  objectKind: { kind: 'object', label: 'object art' },
  object: { kind: 'object', label: 'object art' },
});

/** What a world holds for a library image: its link, and its current size. */
function refOf(record) {
  const version = record.versions.find((v) => v.n === record.current);
  return {
    imageId: record.id,
    link: record.link,
    width: version.width,
    height: version.height,
    format: version.format,
  };
}

module.exports = { TARGETS, refOf };
