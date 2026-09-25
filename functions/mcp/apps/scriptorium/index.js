'use strict';

const { z } = require('zod');
const { ToolError } = require('../../registry');
const { createFirestoreNotesStore } = require('./store');

// Scriptorium — the Initiative 1 proof-of-concept app (design §9, phase 1f).
// Deliberately dumb: an owner-scoped list of notes whose only job is to prove
// the MCP plumbing end to end — OAuth, audience binding, the hasApp gate, and
// ctx-scoped reads and writes from an external Claude client. No UI, no LLM.
//
// Every tool acts only on the caller's own notes (ctx.uid). Inputs are
// validated by the zod schemas before a handler runs; handlers never pass raw
// arguments through to Firestore.

const APP_ID = 'scriptorium';
const MAX_TITLE = 200;
const MAX_BODY = 10000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;

const noteId = z
  .string()
  .regex(/^[A-Za-z0-9]{1,64}$/, 'id must be a note id returned by list_notes or create_note');
const title = z.string().trim().min(1, 'title must not be empty').max(MAX_TITLE);
const body = z.string().max(MAX_BODY);

function scriptoriumApp({ store, now = () => Date.now() }) {
  const notFound = () => new ToolError('Note not found.');

  return {
    tools: [
      {
        name: 'list_notes',
        title: 'List notes',
        description: 'List your Scriptorium notes, most recently updated first.',
        inputSchema: {
          limit: z
            .number()
            .int()
            .min(1)
            .max(MAX_LIST_LIMIT)
            .optional()
            .describe(`Maximum notes to return (default ${DEFAULT_LIST_LIMIT}).`),
        },
        annotations: { readOnlyHint: true },
        handler: async (ctx, { limit = DEFAULT_LIST_LIMIT }) => {
          const notes = await store.list(ctx.uid, { limit });
          return { notes, count: notes.length };
        },
      },
      {
        name: 'create_note',
        title: 'Create note',
        description: 'Create a new note with a title and optional body text.',
        inputSchema: {
          title: title.describe(`Note title (1–${MAX_TITLE} characters).`),
          body: body.optional().describe(`Note text (up to ${MAX_BODY} characters).`),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
        handler: async (ctx, args) => {
          const note = await store.create(
            ctx.uid,
            { title: args.title, body: args.body || '' },
            now()
          );
          return { note };
        },
      },
      {
        name: 'update_note',
        title: 'Update note',
        description: "Change a note's title and/or body. Fields you omit are left unchanged.",
        inputSchema: {
          id: noteId.describe('The note id.'),
          title: title.optional().describe('New title.'),
          body: body.optional().describe('New body text.'),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
        handler: async (ctx, args) => {
          const patch = {};
          if (args.title !== undefined) patch.title = args.title;
          if (args.body !== undefined) patch.body = args.body;
          if (Object.keys(patch).length === 0) {
            throw new ToolError('Provide a new title and/or body to update.');
          }
          const note = await store.update(ctx.uid, args.id, patch, now());
          if (!note) throw notFound();
          return { note };
        },
      },
      {
        name: 'delete_note',
        title: 'Delete note',
        description: 'Permanently delete one of your notes.',
        inputSchema: { id: noteId.describe('The note id.') },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
        handler: async (ctx, { id }) => {
          if (!(await store.remove(ctx.uid, id))) throw notFound();
          return { deleted: true, id };
        },
      },
    ],
    resources: [
      {
        name: 'notes',
        uri: 'scriptorium://notes',
        title: 'Your notes',
        description: 'All of your Scriptorium notes (read-only snapshot).',
        mimeType: 'application/json',
        read: async (ctx) => ({ notes: await store.list(ctx.uid, { limit: MAX_LIST_LIMIT }) }),
      },
    ],
  };
}

// Registers Scriptorium on the production registry, backed by Firestore.
function register(registry) {
  const { getFirestore } = require('firebase-admin/firestore');
  registry.registerApp(APP_ID, scriptoriumApp({ store: createFirestoreNotesStore(getFirestore) }));
}

module.exports = { register, scriptoriumApp, APP_ID };
