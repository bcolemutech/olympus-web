'use strict';

const { z } = require('zod');
const { PRIMARY_ORIGIN } = require('../../config');
const { studioTools, relay } = require('../cartographer/studio-tools');
const { createMuseStore, studioImages, MuseError } = require('../../../muse/store');
const { plainText } = require('../../../muse/search');
const fields = require('../../../muse/fields');
const model = require('../../../muse/model');
const links = require('../../../muse/links');

// The Muse's MCP connector (planning/the-muse.md §3 MC1, MC2, EL5, MS5, §5
// M-100; M-106 / #894). Mounted at /mcp/muse and gated by the `muse` claim
// (scope mcp:muse), it does what the Muse's page does — projects, custom
// fields, elements, photos, relationships, versions, classifications and
// classes (M-201 / #914) — plus an outline, full
// text search and lookups across a bible, with the image studio's tools
// (functions/mcp/apps/cartographer/studio-tools.js, without worlds) so Claude
// can fill a project and illustrate it.
//
// Every tool acts on the caller's own projects only. The work is the Muse's
// store (functions/muse/store.js): the page's own plans, done through the
// Admin SDK, with the index and `mentions` kept in step and a version kept
// before every change to a project or an element.

const APP_ID = 'muse';
const TYPES = fields.TYPES;
const ID = /^[A-Za-z0-9_-]{1,128}$/;

const projectId = z
  .string()
  .regex(ID, 'a project id, from list_projects')
  .describe('The project, from list_projects.');
const elementId = z
  .string()
  .regex(ID, 'an element id, from list_elements or find_elements')
  .describe('The element, from list_elements, find_elements or lookup.');
const CLASS = z
  .string()
  .min(1)
  .max(600)
  .describe(
    'A class: its id, or its path ("Weapons › Sword › Longsword", or the end of it, ' +
      '"Sword › Longsword", with › > or / between), or a name only one class has.'
  );
const CLASSIFICATION = z
  .string()
  .min(1)
  .max(200)
  .describe('A classification: its id (list_classifications), or a name only one has.');
const imageId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,200}$/, 'a studio image id, like img_0123456789abcdef')
  .describe('A studio image, from studio_find, studio_jobs or studio_import.');
const TYPE = z
  .enum(TYPES)
  .describe('character, faction, location, object or concept (magic, religions, laws…).');
const NAME = z.string().min(1).max(model.LIMITS.name);
const ALIASES = z
  .array(z.string().max(model.LIMITS.alias))
  .max(model.LIMITS.aliases)
  .describe('Other names it goes by. Searched as its name is.');
const MARKDOWN_NOTE =
  'Markdown. Link another element as [Its Name](muse:el/<its id>), or a class as ' +
  '[Its Name](muse:cl/<its id>): it then lists this one under “mentioned in”.';
const VALUE = z.union([
  z.string().max(fields.LIMITS.text),
  z.number(),
  z.object({
    year: z.number().int(),
    month: z.number().int().min(1).optional(),
    day: z.number().int().min(1).optional(),
  }),
  z.null(),
]);
const FIELD_VALUES = z
  .record(z.string(), VALUE)
  .describe(
    'Custom field values, by key or label (get_project lists them): text, a number, a date ' +
      '{ year, month?, day? }, a choice (one of its options) or an element (its id or a name ' +
      'only it has). null clears one.'
  );
const readOnly = { readOnlyHint: true, openWorldHint: false };
const writes = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

// What an element's photo is called in the studio (as the page names it; M-104).
const KIND_OF_TYPE = {
  character: 'portrait',
  location: 'scene',
  object: 'item',
  faction: 'other',
  concept: 'other',
};

// A project's title as a studio label (public/apps/muse/js/photos.js labelOf).
function labelOf(title) {
  const label = String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N} '-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .slice(0, 40)
    .trim();
  return label || 'muse';
}

const pageOf = (pid, eid, kind = 'e') =>
  `${PRIMARY_ORIGIN}/apps/muse/#/p/${encodeURIComponent(pid)}` +
  (eid ? `/${kind}/${encodeURIComponent(eid)}` : '');

// What a photo tool acts on: an element, or a class (`classId`), not both.
function photoTarget(args) {
  if (!args.elementId === !args.classId) {
    throw new MuseError('invalid-argument', 'Give an elementId or a classId, one of them.');
  }
  return args.classId ? { classId: args.classId } : args.elementId;
}

// The studio's tools, without worlds, and studio_generate able to draw an element.
function museStudioTools({ studio, store }) {
  return studioTools({ studio, worlds: false }).map((tool) => {
    if (tool.name !== 'studio_generate') return tool;
    return {
      ...tool,
      description:
        tool.description +
        ' Give `element` to draw one of your elements: its name, appearance (or bio) are ' +
        'added to the prompt, and the title, kind and the project’s label are filled in. ' +
        'When the job is done, put the image on it with add_photos.',
      inputSchema: {
        ...tool.inputSchema,
        element: z
          .object({ projectId, elementId })
          .optional()
          .describe('An element of yours to draw (a character’s portrait, a place, a thing).'),
      },
      handler: (ctx, args) =>
        relay(async () => {
          const { element, ...rest } = args;
          if (!element) return tool.handler(ctx, rest);
          const project = await store.getProject(ctx.uid, element.projectId);
          const el = await store.getElement(ctx.uid, element.projectId, element.elementId);
          const about = plainText(el.appearance || el.bio).slice(0, 1500);
          const result = await tool.handler(ctx, {
            ...rest,
            prompt: `${rest.prompt}\n\n${el.name}${about ? `: ${about}` : ''}`.slice(0, 4000),
            kind: rest.kind || KIND_OF_TYPE[el.type],
            title: rest.title || el.name,
            labels: (rest.labels || []).concat([labelOf(project.title)]),
          });
          return {
            ...result,
            next:
              `Collect it with studio_jobs (ids: ["${result.job.id}"], wait: 45), then put it ` +
              `on ${el.name} with add_photos (projectId "${project.id}", elementId "${el.id}").`,
          };
        }),
    };
  });
}

function museApp({ store, studio }) {
  const run = (fn) => (ctx, args) => relay(() => fn(ctx, args));
  const withPage = (pid, element) => ({ ...element, page: pageOf(pid, element.id) });
  const classPage = (pid, cls) => ({ ...cls, page: pageOf(pid, cls.id, 'c') });
  // A photo tool's result: the element or the class it changed.
  const photoResult = (pid, done) =>
    done.class
      ? { class: classPage(pid, done.class), version: done.version }
      : { element: withPage(pid, done.element), version: done.version };

  return {
    tools: [
      // ── Projects ──
      {
        name: 'list_projects',
        title: 'List projects',
        description:
          'Your Muse projects (world bibles), last changed first: each one’s id, title, short ' +
          'description and cover. get_project reads one; outline lists what is in it.',
        inputSchema: {},
        annotations: readOnly,
        handler: run(async (ctx) => ({ projects: await store.listProjects(ctx.uid) })),
      },
      {
        name: 'get_project',
        title: 'Get a project',
        description:
          'One project: its title, short description, summary (Markdown), cover, how many ' +
          'elements of each type it has, and its custom fields per type (key, label, kind, ' +
          'options), which create_element and update_element fill.',
        inputSchema: { projectId },
        annotations: readOnly,
        handler: run(async (ctx, args) => {
          const project = await store.getProject(ctx.uid, args.projectId);
          return { ...project, page: pageOf(project.id) };
        }),
      },
      {
        name: 'create_project',
        title: 'Make a project',
        description:
          'Make a new project: a title, and optionally a short description (the line on the ' +
          'home page), a summary (Markdown) and a cover (a studio image).',
        inputSchema: {
          title: z.string().min(1).max(200).describe('Its title.'),
          short: z.string().max(300).optional().describe('A line about it.'),
          summary: z.string().max(200000).optional().describe('What it is, in Markdown.'),
          cover: imageId.optional().describe('A studio image for its cover.'),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, args) => {
          const project = await store.createProject(ctx.uid, args);
          return { ...project, page: pageOf(project.id) };
        }),
      },
      {
        name: 'update_project',
        title: 'Change a project',
        description:
          'Change a project’s title, short description, summary or cover. A version of it is ' +
          'kept first, so the change can be undone from its versions.',
        inputSchema: {
          projectId,
          title: z.string().min(1).max(200).optional(),
          short: z.string().max(300).optional(),
          summary: z.string().max(200000).optional().describe('Markdown, replacing it whole.'),
          cover: imageId.nullable().optional().describe('A studio image, or null for none.'),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, { projectId: pid, ...changes }) =>
          store.updateProject(ctx.uid, pid, changes)
        ),
      },
      {
        name: 'set_fields',
        title: 'Set a type’s custom fields',
        description:
          'Set the custom fields every element of one type has (e.g. Born and Allegiance for ' +
          'characters): the whole list, in order. Keep a field by giving its key (from ' +
          'get_project); one without a key is new; one left out is removed. Kinds: text, ' +
          'number, date, element (a link; options may name the types it can link to) and ' +
          'choice (options: the choices). A kind can’t change. A version of the project is ' +
          'kept first.',
        inputSchema: {
          projectId,
          type: TYPE,
          fields: z
            .array(
              z.object({
                key: z.string().max(40).optional().describe('An existing field’s key.'),
                label: z.string().min(1).max(fields.LIMITS.label),
                kind: z.enum(fields.KINDS.map((k) => k.id)),
                options: z.array(z.string().max(fields.LIMITS.option)).max(50).optional(),
              })
            )
            .max(fields.LIMITS.perType),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, args) =>
          store.setFields(ctx.uid, args.projectId, args.type, args.fields)
        ),
      },

      // ── Elements ──
      {
        name: 'list_elements',
        title: 'List elements',
        description:
          'A project’s elements by name: each one’s id, type, name, aliases, primary image ' +
          'and classes (as paths). Narrow by type, or by a class (with everything beneath it: ' +
          '"Sword" lists the Longswords); retired: true lists the retired ones instead.',
        inputSchema: {
          projectId,
          type: TYPE.optional(),
          class: CLASS.optional().describe(
            'Only elements in this class or beneath it (its id or path).'
          ),
          retired: z.boolean().optional().describe('List retired elements instead.'),
        },
        annotations: readOnly,
        handler: run(async (ctx, args) => {
          const elements = await store.listElements(ctx.uid, args.projectId, args);
          return { elements, count: elements.length };
        }),
      },
      {
        name: 'find_elements',
        title: 'Find elements by name',
        description:
          'Elements whose name or an alias matches, best first (an exact name, then one that ' +
          'starts with it, then a word that does, then any that holds it), as the page’s ' +
          'search box finds them. `matched` is the alias that matched. With `class`, only ' +
          'elements in that class or beneath it ("Sword" finds a Longsword), and the query ' +
          'may be left out. For words in bios, use search.',
        inputSchema: {
          projectId,
          query: z.string().max(200).optional().describe('A name or alias, or part of one.'),
          class: CLASS.optional().describe('Only elements in this class or beneath it.'),
          types: z.array(z.enum(TYPES)).max(5).optional().describe('Only these types.'),
          limit: z.number().int().min(1).max(50).optional().describe('At most this many (10).'),
        },
        annotations: readOnly,
        handler: run(async (ctx, args) => {
          if (!args.query && !args.class) {
            throw new MuseError('invalid-argument', 'Give a query, or a class to list.');
          }
          return {
            elements: await store.findElements(ctx.uid, args.projectId, args.query, args),
          };
        }),
      },
      {
        name: 'get_element',
        title: 'Get an element',
        description:
          'One element in full: name, aliases, bio (Markdown), custom fields by label, a ' +
          'character’s appearance and residence, its classes (as paths), its photos (studio ' +
          'images, with the primary), ' +
          'its relationships as it sees them ("mother of Anne"), the elements it links to and ' +
          'those that link to it (mentioned in), and its page’s link.',
        inputSchema: { projectId, elementId },
        annotations: readOnly,
        handler: run(async (ctx, args) =>
          withPage(args.projectId, await store.getElement(ctx.uid, args.projectId, args.elementId))
        ),
      },
      {
        name: 'create_element',
        title: 'Make an element',
        description:
          'Make a character, faction, location, object or concept: its name, and optionally ' +
          'aliases, a bio, custom field values, photos (studio images; the first is primary ' +
          'unless primary says) and, for a character, an appearance and a residence (a ' +
          'location), and classes (by id or path; see list_classifications). ' +
          MARKDOWN_NOTE +
          ' Relate it to others with set_relationship.',
        inputSchema: {
          projectId,
          type: TYPE,
          name: NAME.describe('Its name.'),
          aliases: ALIASES.optional(),
          bio: z.string().max(model.LIMITS.bio).optional().describe(`Its bio. ${MARKDOWN_NOTE}`),
          fields: FIELD_VALUES.optional(),
          appearance: z
            .string()
            .max(model.LIMITS.appearance)
            .optional()
            .describe('A character’s look, in Markdown.'),
          residence: z
            .string()
            .max(200)
            .optional()
            .describe('A character’s home: a location’s id, or a name only it has.'),
          photos: z.array(imageId).max(model.LIMITS.images).optional().describe('Studio images.'),
          primary: imageId.optional().describe('Which of the photos is primary (the first).'),
          classes: z
            .array(CLASS)
            .max(50)
            .optional()
            .describe('Its classes, at any level, by id or path.'),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, { projectId: pid, ...input }) =>
          withPage(pid, await store.createElement(ctx.uid, pid, input))
        ),
      },
      {
        name: 'update_element',
        title: 'Change an element',
        description:
          'Change an element’s name, aliases, bio, custom fields, or a character’s appearance ' +
          'or residence. Texts are replaced whole; fields given change and the rest stay ' +
          '(null clears one). ' +
          MARKDOWN_NOTE +
          ' A version of it is kept first, so the change can be undone.',
        inputSchema: {
          projectId,
          elementId,
          name: NAME.optional(),
          aliases: ALIASES.optional(),
          bio: z.string().max(model.LIMITS.bio).optional(),
          fields: FIELD_VALUES.optional(),
          appearance: z.string().max(model.LIMITS.appearance).optional(),
          residence: z
            .string()
            .max(200)
            .nullable()
            .optional()
            .describe('A location’s id or name, or null for none.'),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, { projectId: pid, elementId: eid, ...input }) => {
          const done = await store.updateElement(ctx.uid, pid, eid, input);
          return { element: withPage(pid, done.element), version: done.version };
        }),
      },
      {
        name: 'retire_element',
        title: 'Retire an element',
        description:
          'Retire an element: it leaves lists, search and links, but keeps its page and all it ' +
          'holds, and can be brought back (restore: true). A version is kept first.',
        inputSchema: {
          projectId,
          elementId,
          restore: z.boolean().optional().describe('Bring a retired element back.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
        handler: run(async (ctx, args) => {
          const done = await store.retireElement(ctx.uid, args.projectId, args.elementId, args);
          return { element: withPage(args.projectId, done.element), version: done.version };
        }),
      },
      {
        name: 'add_photos',
        title: 'Add photos to an element or a class',
        description:
          'Add studio images to an element’s photos (or a class’s, with classId), after those ' +
          'it has. The first photo it gets is its primary, shown in lists; primary: true makes ' +
          'the first added the primary. Make or find images with the studio tools ' +
          '(studio_generate, studio_find, studio_import). A version is kept first.',
        inputSchema: {
          projectId,
          elementId: elementId.optional(),
          classId: CLASS.optional().describe('A class instead of an element.'),
          imageIds: z.array(imageId).min(1).max(50),
          primary: z.boolean().optional().describe('Make the first image added the primary.'),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, args) =>
          photoResult(
            args.projectId,
            await store.addPhotos(ctx.uid, args.projectId, photoTarget(args), args.imageIds, args)
          )
        ),
      },
      {
        name: 'remove_photo',
        title: 'Take a photo off an element or a class',
        description:
          'Take an image off an element’s photos (or a class’s, with classId); it stays in ' +
          'the studio. If it was the primary, the next takes its place. A version is kept first.',
        inputSchema: {
          projectId,
          elementId: elementId.optional(),
          classId: CLASS.optional().describe('A class instead of an element.'),
          imageId,
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        handler: run(async (ctx, args) =>
          photoResult(
            args.projectId,
            await store.removePhoto(ctx.uid, args.projectId, photoTarget(args), args.imageId)
          )
        ),
      },
      {
        name: 'set_primary',
        title: 'Choose a primary photo',
        description:
          'Make one of an element’s photos (or a class’s, with classId) its primary, the one ' +
          'shown in lists and links. A version is kept first.',
        inputSchema: {
          projectId,
          elementId: elementId.optional(),
          classId: CLASS.optional().describe('A class instead of an element.'),
          imageId,
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, args) =>
          photoResult(
            args.projectId,
            await store.setPrimary(ctx.uid, args.projectId, photoTarget(args), args.imageId)
          )
        ),
      },

      // ── Classifications and classes (M-201) ──
      {
        name: 'list_classifications',
        title: 'List classifications',
        description:
          'A project’s classifications, by element type: trees of classes such as Weapons › ' +
          'Sword › Double Edge › Longsword for objects. Each is single (an element holds one ' +
          'of its classes) or multiple. Each class has its id, name, how many live elements ' +
          'are in it (`in`) and in it or beneath it (`all`), and its subclasses.',
        inputSchema: { projectId, type: TYPE.optional().describe('Only this type.') },
        annotations: readOnly,
        handler: run(async (ctx, args) => store.listClassifications(ctx.uid, args.projectId, args)),
      },
      {
        name: 'get_class',
        title: 'Get a class',
        description:
          'One class in full: its path, classification, description (Markdown), photos, ' +
          'subclasses, the live elements in it and those beneath it, and what links to it.',
        inputSchema: { projectId, classId: CLASS },
        annotations: readOnly,
        handler: run(async (ctx, args) =>
          classPage(args.projectId, await store.getClass(ctx.uid, args.projectId, args.classId))
        ),
      },
      {
        name: 'create_classification',
        title: 'Make a classification',
        description:
          'Make a classification for one element type (Weapons, Materials or Rarity for ' +
          'objects): a tree of classes to sort its elements by. multiple: true lets an ' +
          'element hold several of its classes; otherwise one, and a second replaces it. ' +
          'Then add classes with create_class.',
        inputSchema: {
          projectId,
          type: TYPE,
          name: z.string().min(1).max(100).describe('Its name, unique among the type’s.'),
          multiple: z.boolean().optional().describe('An element may hold several (false).'),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, { projectId: pid, ...input }) => ({
          classification: await store.createClassification(ctx.uid, pid, input),
        })),
      },
      {
        name: 'update_classification',
        title: 'Change a classification',
        description:
          'Rename a classification, or make it single or multiple. It can’t be made single ' +
          'while an element holds two of its classes. Its type never changes.',
        inputSchema: {
          projectId,
          classificationId: CLASSIFICATION,
          name: z.string().min(1).max(100).optional(),
          multiple: z.boolean().optional(),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, { projectId: pid, classificationId, ...input }) => ({
          classification: await store.updateClassification(ctx.uid, pid, classificationId, input),
        })),
      },
      {
        name: 'delete_classification',
        title: 'Delete a classification',
        description: 'Delete a classification. Refused while it has classes: delete those first.',
        inputSchema: { projectId, classificationId: CLASSIFICATION },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        handler: run(async (ctx, args) =>
          store.deleteClassification(ctx.uid, args.projectId, args.classificationId)
        ),
      },
      {
        name: 'create_class',
        title: 'Make a class',
        description:
          'Make a class: at the top of a classification (give classificationId), or beneath ' +
          'another class (give parent, by id or path), at most 6 levels deep. Its name is ' +
          'unique among its siblings. A class stays where it is made: to restructure, make the ' +
          'new class, move the elements (classify), and delete the empty one. ' +
          MARKDOWN_NOTE.replace('Markdown.', 'Its description is Markdown.'),
        inputSchema: {
          projectId,
          classificationId: CLASSIFICATION.optional(),
          parent: CLASS.optional().describe('The class to put it beneath.'),
          name: z.string().min(1).max(100),
          description: z.string().max(200000).optional(),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, { projectId: pid, classificationId, ...input }) =>
          classPage(
            pid,
            await store.createClass(ctx.uid, pid, { ...input, classification: classificationId })
          )
        ),
      },
      {
        name: 'update_class',
        title: 'Change a class',
        description:
          'Rename a class or replace its description (Markdown). It is never moved. A version ' +
          'of it is kept first.',
        inputSchema: {
          projectId,
          classId: CLASS,
          name: z.string().min(1).max(100).optional(),
          description: z.string().max(200000).optional(),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, { projectId: pid, classId, ...input }) => {
          const done = await store.updateClass(ctx.uid, pid, classId, input);
          return { class: classPage(pid, done.class), version: done.version };
        }),
      },
      {
        name: 'delete_class',
        title: 'Delete a class',
        description:
          'Delete a class. Refused while anything is in it: a subclass, or an element (live ' +
          'or retired).',
        inputSchema: { projectId, classId: CLASS },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        handler: run(async (ctx, args) => store.deleteClass(ctx.uid, args.projectId, args.classId)),
      },
      {
        name: 'classify',
        title: 'Classify an element',
        description:
          'Put an element in classes, or take it out, naming them by id or path. A class can ' +
          'be at any level: "Sword" until it is decided it is a Longsword. A class added ' +
          'replaces one in its own line (Sword, when Longsword is added), and in a single ' +
          'classification the one it held. A version of the element is kept first.',
        inputSchema: {
          projectId,
          elementId,
          add: z.array(CLASS).max(50).optional().describe('Classes to put it in.'),
          remove: z.array(CLASS).max(50).optional().describe('Classes to take it out of.'),
        },
        annotations: { ...writes, idempotentHint: true },
        handler: run(async (ctx, { projectId: pid, elementId: eid, ...input }) => {
          const done = await store.classify(ctx.uid, pid, eid, input);
          return { element: withPage(pid, done.element), version: done.version };
        }),
      },

      // ── Relationships ──
      {
        name: 'list_relationships',
        title: 'List relationships',
        description:
          'An element’s relationships as it sees them (what it is to each other element, and ' +
          'what each is to it), or with no element every relationship in the project.',
        inputSchema: { projectId, elementId: elementId.optional() },
        annotations: readOnly,
        handler: run(async (ctx, args) => ({
          relationships: await store.listRelationships(ctx.uid, args.projectId, args.elementId),
        })),
      },
      {
        name: 'set_relationship',
        title: 'Relate two elements',
        description:
          'Relate two elements: what a is to b ("mother of") and what b is to a ("daughter ' +
          'of"; left out, the same both ways, as "friend of"), with an optional description. ' +
          'Each element can be named by its id or by a name only it has. It shows on both ' +
          'pages. Give relationshipId to change one’s words or description; its two elements ' +
          'are fixed.',
        inputSchema: {
          projectId,
          relationshipId: z.string().regex(ID).optional().describe('A relationship to change.'),
          a: z.string().max(200).optional().describe('The first element (id or name).'),
          b: z.string().max(200).optional().describe('The second element (id or name).'),
          aToB: z.string().max(links.LIMITS.kind).optional().describe('What a is to b.'),
          bToA: z.string().max(links.LIMITS.kind).optional().describe('What b is to a.'),
          description: z.string().max(links.LIMITS.description).optional(),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, { projectId: pid, ...input }) => ({
          relationship: await store.setRelationship(ctx.uid, pid, input),
        })),
      },
      {
        name: 'remove_relationship',
        title: 'Remove a relationship',
        description: 'Remove a relationship from both its elements.',
        inputSchema: { projectId, relationshipId: z.string().regex(ID) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        handler: run(async (ctx, args) =>
          store.removeRelationship(ctx.uid, args.projectId, args.relationshipId)
        ),
      },

      // ── Reading the bible ──
      {
        name: 'outline',
        title: 'A project’s outline',
        description:
          'A project at a glance: its title and summary’s first line, and its elements by ' +
          'type, each with its aliases and the first line of its bio. Read one in full with ' +
          'get_element.',
        inputSchema: { projectId, type: TYPE.optional().describe('Only this type.') },
        annotations: readOnly,
        handler: run(async (ctx, args) => store.outline(ctx.uid, args.projectId, args)),
      },
      {
        name: 'search',
        title: 'Search a project’s text',
        description:
          'Search the names, aliases, bios, appearances and text fields of a project’s ' +
          'elements, and its classes’ names and descriptions (type "class", unless types is ' +
          'given). Every word must be found in an element; "words in quotes" are a phrase; ' +
          'case and accents don’t matter. Each result says where it was found, with a snippet ' +
          '(marks are the matches, by character).',
        inputSchema: {
          projectId,
          query: z.string().min(1).max(200),
          types: z.array(z.enum(TYPES)).max(5).optional().describe('Only these types.'),
          limit: z.number().int().min(1).max(50).optional().describe('At most this many (20).'),
        },
        annotations: readOnly,
        handler: run(async (ctx, args) => store.search(ctx.uid, args.projectId, args.query, args)),
      },
      {
        name: 'lookup',
        title: 'What the bible says',
        description:
          'What the bible says about a name: the element (or class) it best names, by name or ' +
          'alias, in full, with its relationships (or its elements) and where it is mentioned, ' +
          'and the others the name might mean.',
        inputSchema: { projectId, name: z.string().min(1).max(200) },
        annotations: readOnly,
        handler: run(async (ctx, args) => {
          const found = await store.lookup(ctx.uid, args.projectId, args.name);
          return found.class
            ? { ...found, class: classPage(args.projectId, found.class) }
            : { ...found, element: withPage(args.projectId, found.element) };
        }),
      },
      {
        name: 'save_version',
        title: 'Keep a version',
        description:
          'Keep a named version of an element, a class (classId) or, with neither, the ' +
          'project, as it is ' +
          'now. Changes made here keep one by themselves; this is for a point worth naming ' +
          '("before the rewrite"). The last 50 of each are kept.',
        inputSchema: {
          projectId,
          elementId: elementId.optional(),
          classId: CLASS.optional().describe('A class instead of an element.'),
          name: z.string().max(100).optional().describe('What to call it.'),
        },
        annotations: { ...writes, idempotentHint: false },
        handler: run(async (ctx, args) => ({
          version: await store.saveVersion(
            ctx.uid,
            args.projectId,
            args.classId ? { classId: args.classId } : args.elementId,
            args.name
          ),
        })),
      },

      // ── The image studio ──
      ...(studio ? museStudioTools({ studio, store }) : []),
    ],
    resources: [
      {
        name: 'projects',
        uri: 'muse://projects',
        title: 'Your projects',
        description: 'Your Muse projects, last changed first (read-only snapshot).',
        mimeType: 'application/json',
        read: async (ctx) => ({ projects: await store.listProjects(ctx.uid) }),
      },
    ],
  };
}

// Registers the Muse on the production registry, backed by Firestore.
function register(registry) {
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  let built;
  const store = new Proxy(
    {},
    {
      get: (_, key) => {
        if (!built) {
          const db = getFirestore();
          built = createMuseStore({ db, FieldValue, images: studioImages(db) });
        }
        return built[key];
      },
    }
  );
  const studio = () => require('../../../studio').studio();
  registry.registerApp(
    APP_ID,
    museApp({
      store,
      studio: {
        library: () => studio().library,
        costs: () => studio().costs,
        jobs: () => studio().jobs,
        styles: () => studio().styles,
        load: async (path) => (await getStorage().bucket().file(path).download())[0],
      },
    })
  );
}

module.exports = { register, museApp, labelOf, APP_ID };
