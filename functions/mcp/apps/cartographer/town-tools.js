'use strict';

const { z } = require('zod');
const { FieldValue } = require('firebase-admin/firestore');
const { ToolError } = require('../../registry');
const { normalizeName } = require('../../../loom-turn/interpret');
const town = require('../../../loom-canon/town');
const { SOURCES } = require('../../../cartographer/sources');
const { worldId, entityId } = require('./schemas');
const { helpers } = require('./write-tools');

// The Cartographer's MCP town tools (planning/the-loom-layered-worlds.md §8;
// L-343 / #397): Claude lays out and fixes the towns inside settlements. They
// run through the same validated, versioned edits as the world tools
// (writer.js), and keep the town's own rules:
//
//   - Place names are unique within their town, and never a world place,
//     realm or character's name, so players' words pick out one thing.
//   - Links are two-way and stay inside one town.
//   - A town with places keeps at least one way in and out (an entrance).
//   - Descriptions set here are stamped as written up (sources.description).
//
// Every result carries the town's layout report after the edit (town.js
// layoutReport): what still keeps the layout from working, if anything.
// Removing places is retire_entity (type 'place'), in write-tools.js.

const { existing, live, checkName, newId, describe, changedFields, requireSome, placeIn } = helpers;
const ROUTES = ['road', 'trail', 'sea'];
const MAX_LINKS = 12;
const TOWN_SPAN = 1000;

const kind = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z -]{1,29}$/, 'kind must be a word or two, e.g. harbour, gate, tavern')
  .describe('What it is: harbour, gate, market, temple, tavern, district, …');
const entranceFor = z
  .array(z.enum(ROUTES))
  .min(1)
  .max(3)
  .describe(
    'Makes it a way in and out of town, serving these world routes: a harbour ["sea"], a ' +
      'gate ["road", "trail"]. Travellers arrive at the way in that serves their route and ' +
      'can only leave from one that serves the route out.'
  );
const position = z
  .object({ x: z.number().min(0).max(TOWN_SPAN), y: z.number().min(0).max(TOWN_SPAN) })
  .describe(`Where it sits in the town, 0–${TOWN_SPAN} each way, for the town view.`);

function settlementFor(world, locationId) {
  const settlement = live(world, 'location', locationId);
  if ((settlement.geo || {}).kind !== 'settlement') {
    throw new ToolError(`${settlement.name} isn't a settlement, so it has no town.`);
  }
  return settlement;
}

// Unique in the town, and not a name the world already uses.
function checkPlaceName(world, settlement, wanted, selfId) {
  checkName(world, wanted);
  const key = normalizeName(wanted);
  for (const place of town.placesOf(world, settlement.id)) {
    if (place.id !== selfId && normalizeName(place.name) === key) {
      throw new ToolError(
        `${place.name} (${place.id}) in ${settlement.name} already has that name. Place names ` +
          'must be unique within a town.'
      );
    }
  }
  return wanted;
}

const entranceOf = (via) => ({ via: ROUTES.filter((r) => via.includes(r)) });

function townTools({ writer }) {
  const edit = (ctx, args, change) => writer.edit(args.worldId, ctx.uid, change);
  const additive = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  const replacing = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
  const removing = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
  const editNote =
    'Works on drafts and published worlds; a change to a published world reaches games on ' +
    'their next turn. The result includes the town’s layout report.';
  const summary = (place, entrance = place.entrance) => ({
    id: place.id,
    name: place.name,
    entranceFor: entrance ? entrance.via : null,
  });

  return [
    {
      name: 'add_place',
      title: 'Add place in town',
      description:
        'Add a place inside a settlement’s town: a harbour, gate, market, temple, tavern, ' +
        'district and so on. Give ways in and out entranceFor (the world routes they serve), ' +
        'and link it to places already there with connectTo (links are two-way). The name ' +
        'must be unique in the town. Returns the new id. ' +
        editNote,
      inputSchema: {
        worldId,
        locationId: entityId('location', 'find_locations').describe('The settlement.'),
        name: helpers.name.describe('The place’s name, e.g. "The Harbour".'),
        kind,
        description: helpers
          .text(helpers.MAX_DESCRIPTION, 'description')
          .describe('What a visitor finds here.'),
        entranceFor: entranceFor.optional(),
        connectTo: z
          .array(entityId('place', 'get_town'))
          .max(MAX_LINKS)
          .optional()
          .describe('Places in the same town to link it to.'),
        position: position.optional(),
      },
      annotations: additive,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const settlement = settlementFor(world, args.locationId);
          checkPlaceName(world, settlement, args.name);
          const links = [...new Set(args.connectTo || [])].map((id) =>
            placeIn(world, settlement, id)
          );
          const id = newId(world, 'place', `plc_${settlement.id.replace(/^loc_/, '')}`, args.name);
          const doc = {
            id,
            locationId: settlement.id,
            name: args.name,
            kind: args.kind,
            description: args.description,
            sources: { description: SOURCES.MCP },
            connections: links.map((p) => p.id),
            entrance: args.entranceFor ? entranceOf(args.entranceFor) : null,
            npcIds: [],
            rules: {},
            ...(args.position ? { position: args.position } : {}),
          };
          e.create(e.ref('places', id), doc);
          const set = { [id]: doc };
          for (const other of links) {
            e.update(e.ref('places', other.id), 'connections', FieldValue.arrayUnion(id));
            set[other.id] = { ...other, connections: [...(other.connections || []), id] };
          }
          return {
            place: { ...summary(doc), connections: links.map((p) => ({ id: p.id, name: p.name })) },
            layout: helpers.layoutAfter(world, settlement, { set }),
          };
        }),
    },
    {
      name: 'update_place',
      title: 'Update place in town',
      description:
        'Change a place in town: its name, kind, description, whether it is a way in and out ' +
        '(entranceFor; null makes it an ordinary place), its rules (requiresAbility, null ' +
        'removes it), or its position. Setting a description, even the current text, marks it ' +
        'written up. A town keeps at least one way in and out. ' +
        editNote,
      inputSchema: {
        worldId,
        placeId: entityId('place', 'get_town'),
        name: helpers.name.optional().describe('New name.'),
        kind: kind.optional(),
        description: helpers
          .text(helpers.MAX_DESCRIPTION, 'description')
          .optional()
          .describe('New description.'),
        entranceFor: entranceFor.nullable().optional(),
        rules: z
          .strictObject({
            requiresAbility: z
              .string()
              .trim()
              .min(1)
              .max(60)
              .nullable()
              .optional()
              .describe('An ability needed to get in, e.g. "guild-token".'),
          })
          .optional(),
        position: position.nullable().optional(),
      },
      annotations: replacing,
      handler: (ctx, args) => {
        requireSome(args, ['name', 'kind', 'description', 'entranceFor', 'rules', 'position']);
        return edit(ctx, args, (e) => {
          const { world } = e;
          const place = existing(world, 'place', args.placeId);
          const settlement = world.locations[place.locationId];
          const fields = {};
          if (args.name !== undefined && args.name !== place.name) {
            fields.name = checkPlaceName(world, settlement, args.name, place.id);
          }
          if (args.kind !== undefined && args.kind !== place.kind) fields.kind = args.kind;
          Object.assign(fields, describe(place, args.description));
          let entrance = place.entrance || null;
          if (args.entranceFor === null && place.entrance) {
            helpers.keepsAWayIn(world, place, { entranceAfter: false });
            fields.entrance = entrance = null;
          } else if (args.entranceFor) {
            const next = entranceOf(args.entranceFor);
            if (JSON.stringify(next) !== JSON.stringify(place.entrance || null)) {
              fields.entrance = entrance = next;
            }
          }
          const rules = place.rules || {};
          const ability = (args.rules || {}).requiresAbility;
          if (ability === null && rules.requiresAbility !== undefined) {
            fields['rules.requiresAbility'] = FieldValue.delete();
          } else if (ability && ability !== rules.requiresAbility) {
            fields['rules.requiresAbility'] = ability;
          }
          if (args.position === null && place.position) fields.position = FieldValue.delete();
          else if (args.position) fields.position = args.position;
          if (Object.keys(fields).length) e.update(e.ref('places', place.id), fields);
          // The place as it will be, for the layout report: a new description
          // is what opens a way in.
          const after = {
            ...place,
            ...(fields.name ? { name: fields.name } : {}),
            ...(fields.description !== undefined ? { description: fields.description } : {}),
            ...(fields['sources.description']
              ? { sources: { ...(place.sources || {}), description: SOURCES.MCP } }
              : {}),
            entrance,
          };
          return {
            place: summary(after, entrance),
            updated: changedFields(fields).map((f) => f.replace('rules.', '')),
            layout: helpers.layoutAfter(world, settlement, { set: { [place.id]: after } }),
          };
        });
      },
    },
    {
      name: 'connect_places',
      title: 'Connect places in town',
      description:
        'Link two places in the same town so a visitor can walk directly between them. Links ' +
        'are two-way. ' +
        editNote,
      inputSchema: {
        worldId,
        fromId: entityId('place', 'get_town'),
        toId: entityId('place', 'get_town'),
      },
      annotations: replacing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          if (args.fromId === args.toId) throw new ToolError('A place can’t link to itself.');
          const a = live(world, 'place', args.fromId);
          const settlement = world.locations[a.locationId];
          const b = placeIn(world, settlement, args.toId);
          const linked = (x, y) => (x.connections || []).includes(y.id);
          const set = {};
          if (!(linked(a, b) && linked(b, a))) {
            for (const [x, y] of [
              [a, b],
              [b, a],
            ]) {
              e.update(e.ref('places', x.id), 'connections', FieldValue.arrayUnion(y.id));
              set[x.id] = { ...x, connections: [...new Set([...(x.connections || []), y.id])] };
            }
          }
          return {
            connection: { from: { id: a.id, name: a.name }, to: { id: b.id, name: b.name } },
            layout: helpers.layoutAfter(world, settlement, { set }),
          };
        }),
    },
    {
      name: 'disconnect_places',
      title: 'Disconnect places in town',
      description:
        'Remove the direct link between two places in a town, both ways. The layout report ' +
        'says if that leaves any place unreachable. ' +
        editNote,
      inputSchema: {
        worldId,
        fromId: entityId('place', 'get_town'),
        toId: entityId('place', 'get_town'),
      },
      annotations: removing,
      handler: (ctx, args) =>
        edit(ctx, args, (e) => {
          const { world } = e;
          const a = existing(world, 'place', args.fromId);
          const b = existing(world, 'place', args.toId);
          if (a.locationId !== b.locationId) {
            throw new ToolError(`${a.name} and ${b.name} are in different towns.`);
          }
          const settlement = world.locations[a.locationId];
          const connected =
            (a.connections || []).includes(b.id) || (b.connections || []).includes(a.id);
          if (!connected && !a.retired && !b.retired) {
            return {
              note: `${a.name} and ${b.name} are not linked.`,
              layout: town.layoutReport(world, settlement),
            };
          }
          const set = {};
          for (const [x, y] of [
            [a, b],
            [b, a],
          ]) {
            e.update(e.ref('places', x.id), 'connections', FieldValue.arrayRemove(y.id));
            set[x.id] = { ...x, connections: (x.connections || []).filter((id) => id !== y.id) };
          }
          return {
            disconnected: { from: { id: a.id, name: a.name }, to: { id: b.id, name: b.name } },
            layout: helpers.layoutAfter(world, settlement, { set }),
          };
        }),
    },
  ];
}

module.exports = { townTools };
