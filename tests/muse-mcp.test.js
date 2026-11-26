'use strict';

/**
 * The Muse connector (planning/the-muse.md §3 MC1, MC2, EL5, MS5; M-106 /
 * #894), driven by a real MCP client through /mcp/muse against the Firestore
 * emulator: a character made with a relationship, an @-link and a photo, with
 * its index line and `mentions` right and a version kept before a change;
 * photos, retiring, custom fields and the outline; `search` finding a word in a
 * bio and `lookup` by an alias; the studio's tools without worlds, drawing an
 * element; and who is let in: a token without mcp:muse is refused, and one
 * user never sees another's project. The calendar (M-301 / #922): set over
 * the connector, a date field written as text and read back in the project's
 * form, a version kept before set_calendar, and dates that no longer fit. The page's search box goes through the
 * museSearch callable, run here too.
 *
 * Run: firebase emulators:exec --only firestore --project demo-olympus-rules-test \
 *        "cd tests && npx jest muse-mcp --verbose"
 */

const PROJECT = 'demo-muse-mcp';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = PROJECT;
process.env.MCP_JWT_SECRET = 'test-signing-secret-muse-mcp';
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

require('firebase-functions-test')({ projectId: PROJECT }, null);
const { museSearch } = require('../functions/index');
const path = require('path');
const express = require('express');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const functionsDir = path.resolve(__dirname, '../functions');
const { getFirestore, FieldValue } = require(
  require.resolve('firebase-admin/firestore', { paths: [functionsDir] })
);
const { createMuseStore, studioImages } = require('../functions/muse/store');
const { museApp } = require('../functions/mcp/apps/muse');
const { createRegistry } = require('../functions/mcp/registry');
const { handleAppRequest } = require('../functions/mcp/app-server');
const { signAccessToken } = require('../functions/mcp/oauth/tokens');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');

jest.setTimeout(30000);

const CANONICAL = 'https://bcoletech.com';
const AUD = `${CANONICAL}/mcp/muse`;
const IMG = 'img_0123456789abcdef';
const IMG2 = 'img_fedcba9876543210';

const db = getFirestore();

// The studio, faked: what the studio tools call, recorded.
const started = [];
const studio = {
  library: () => ({
    getImage: async (id) => ({ id, title: 'x', versions: [], current: 1 }),
    search: async () => ({ images: [], total: 0 }),
    labels: async () => [],
  }),
  costs: () => ({
    line: async () => ({ thisCall: 0, month: 0, warning: null }),
    totals: async () => ({ total: 0 }),
  }),
  jobs: () => ({
    start: async (uid, args, via) => {
      started.push({ uid, args, via });
      return { id: 'job_0123456789abcdef', state: 'queued', request: args, createdBy: uid, via };
    },
    list: async () => [],
  }),
  styles: () => ({ list: async () => [], get: async () => null, set: async () => null }),
  load: async () => Buffer.alloc(0),
};

const registry = createRegistry();
registry.registerApp(
  'muse',
  museApp({ store: createMuseStore({ db, FieldValue, images: studioImages(db) }), studio })
);

const oauthStore = createInMemoryStore();
function tokenFor(uid, { scope = 'mcp:muse', audience = AUD } = {}) {
  const grantId = `grant-${uid}-${scope}`;
  oauthStore._debug.grants.set(grantId, { grantId, uid, appId: 'muse', revoked: false });
  return signAccessToken({ uid, audience, scope, issuer: CANONICAL, grantId });
}

let server;
let base;
let ann;
let bob;

async function connect(uid) {
  const client = new Client({ name: 'muse-test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp/muse`), {
      requestInit: { headers: { Authorization: `Bearer ${tokenFor(uid)}` } },
    })
  );
  return client;
}

// A tool's result as data; a tool error throws with its message.
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = result.content.find((c) => c.type === 'text').text;
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.all('/mcp/:appId', (req, res) =>
    handleAppRequest(req, res, {
      registry,
      appId: req.params.appId,
      getGrant: (grantId) => oauthStore.getGrant(grantId),
    })
  );
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
  ann = await connect('ann');
  bob = await connect('bob');
});

afterAll(async () => {
  await ann.close();
  await bob.close();
  await new Promise((resolve) => server.close(resolve));
  await db.recursiveDelete(db.collection('muse_projects'));
  await db.recursiveDelete(db.collection('studio_images'));
});

beforeEach(async () => {
  started.length = 0;
  await db.recursiveDelete(db.collection('muse_projects'));
  await db.recursiveDelete(db.collection('studio_images'));
  for (const [id, title] of [
    [IMG, 'King Peter'],
    [IMG2, 'King Peter, older'],
  ]) {
    await db.doc(`studio_images/${id}`).set({
      id,
      title,
      kind: 'portrait',
      link: `https://example.com/${id}.png`,
    });
  }
});

// A court: a project with a location, a mother, and a king made with an
// @-link to the location, a field, a photo and a relationship.
async function court() {
  const project = await call(ann, 'create_project', { title: 'The Court', short: 'Tides' });
  const born = await call(ann, 'set_fields', {
    projectId: project.id,
    type: 'character',
    fields: [{ label: 'Born', kind: 'date' }],
  });
  const sea = await call(ann, 'create_element', {
    projectId: project.id,
    type: 'location',
    name: 'The Sunken City',
    aliases: ['Old Brass'],
    bio: 'A city of bells under the estuary.',
  });
  const marta = await call(ann, 'create_element', {
    projectId: project.id,
    type: 'character',
    name: 'Marta',
    aliases: ['The Widow'],
    bio: 'Keeps the court.',
  });
  const peter = await call(ann, 'create_element', {
    projectId: project.id,
    type: 'character',
    name: 'King Peter',
    aliases: ['The Drowned King'],
    bio: `Rules from [Old Brass](muse:el/${sea.id}).\n\nFeared by the sailors of the Éstuary.`,
    appearance: 'Grey-bearded, a crown of coral.',
    residence: 'Old Brass',
    fields: { Born: { year: 312 } },
    photos: [IMG],
  });
  const rel = await call(ann, 'set_relationship', {
    projectId: project.id,
    a: 'The Widow',
    b: peter.id,
    aToB: 'mother of',
    bToA: 'son of',
    description: 'Raised him alone.',
  });
  return { project, born, sea, marta, peter, rel: rel.relationship };
}

const doc = async (p) => (await db.doc(p).get()).data();
const indexOf = async (projectId) =>
  Object.assign(
    {},
    ...(await db.collection(`muse_projects/${projectId}/index`).get()).docs.map(
      (d) => d.data().entries
    )
  );
const versionsOf = async (projectId, of) =>
  (await db.collection(`muse_projects/${projectId}/versions`).where('of', '==', of).get()).docs.map(
    (d) => d.data()
  );

describe('elements', () => {
  test('a character made with a relationship, an @-link and a photo: index, mentions and page', async () => {
    const { project, born, sea, marta, peter } = await court();
    const key = born.fields[0].key;
    const stored = await doc(`muse_projects/${project.id}/elements/${peter.id}`);
    expect(stored).toMatchObject({
      type: 'character',
      name: 'King Peter',
      aliases: ['The Drowned King'],
      mentions: [sea.id],
      images: [IMG],
      primary: IMG,
      residence: sea.id,
      fields: { [key]: { year: 312 } },
      retired: false,
    });
    // Its index line agrees with it, as the rules would demand.
    expect((await indexOf(project.id))[peter.id]).toEqual({
      type: 'character',
      name: 'King Peter',
      aliases: ['The Drowned King'],
      primary: IMG,
      classes: [],
    });
    // Its page, as Claude reads it.
    expect(peter).toMatchObject({
      residence: { id: sea.id, name: 'The Sunken City' },
      photos: [{ id: IMG, title: 'King Peter', link: `https://example.com/${IMG}.png`, primary: true }],
      fields: [{ key, label: 'Born', kind: 'date', value: { year: 312 }, shown: '312 CE' }],
      mentions: [{ id: sea.id, name: 'The Sunken City' }],
      page: `${CANONICAL}/apps/muse/#/p/${project.id}/e/${peter.id}`,
    });
    const read = await call(ann, 'get_element', { projectId: project.id, elementId: peter.id });
    expect(read.relationships).toEqual([
      expect.objectContaining({
        kind: 'son of',
        other: { id: marta.id, name: 'Marta', type: 'character' },
        back: 'mother of',
        description: 'Raised him alone.',
      }),
    ]);
    const city = await call(ann, 'get_element', { projectId: project.id, elementId: sea.id });
    expect(city.mentionedIn).toEqual([{ id: peter.id, name: 'King Peter', type: 'character' }]);
    // A relationship is stored as the page stores it.
    const [rel] = (await db.collection(`muse_projects/${project.id}/relationships`).get()).docs;
    expect(rel.data()).toMatchObject({ a: marta.id, b: peter.id, ends: [marta.id, peter.id] });
  });

  test('a change keeps a version of what was stored first, by mcp, and mentions follow', async () => {
    const { project, sea, marta, peter } = await court();
    const done = await call(ann, 'update_element', {
      projectId: project.id,
      elementId: peter.id,
      bio: `Son of [Marta](muse:el/${marta.id}).`,
      aliases: ['The Drowned King', 'Peter'],
    });
    expect(done.version).toEqual({ id: expect.any(String), dropped: [] });
    const [version] = await versionsOf(
      project.id,
      `muse_projects/${project.id}/elements/${peter.id}`
    );
    expect(version).toMatchObject({ by: 'mcp', name: null });
    expect(version.snapshot.bio).toContain('Old Brass');
    expect(version.snapshot.mentions).toEqual([sea.id]);
    const stored = await doc(`muse_projects/${project.id}/elements/${peter.id}`);
    expect(stored.mentions).toEqual([marta.id]);
    expect((await indexOf(project.id))[peter.id].aliases).toEqual(['The Drowned King', 'Peter']);
    // Fields given change; the rest stay.
    expect(done.element.fields[0].value).toEqual({ year: 312 });
  });

  test('photos: added, made primary and removed, with the index line following', async () => {
    const { project, peter } = await court();
    const at = { projectId: project.id, elementId: peter.id };
    let done = await call(ann, 'add_photos', { ...at, imageIds: [IMG2], primary: true });
    expect(done.element.primary).toBe(IMG2);
    expect((await indexOf(project.id))[peter.id].primary).toBe(IMG2);
    done = await call(ann, 'set_primary', { ...at, imageId: IMG });
    expect(done.element.photos.map((p) => [p.id, p.primary])).toEqual([
      [IMG, true],
      [IMG2, false],
    ]);
    done = await call(ann, 'remove_photo', { ...at, imageId: IMG });
    expect(done.element.primary).toBe(IMG2);
    expect((await indexOf(project.id))[peter.id].primary).toBe(IMG2);
    await expect(call(ann, 'add_photos', { ...at, imageIds: ['img_nothere'] })).rejects.toThrow(
      'No image "img_nothere"'
    );
    await expect(call(ann, 'set_primary', { ...at, imageId: IMG })).rejects.toThrow('add it first');
    // Each change kept a version first.
    expect(
      await versionsOf(project.id, `muse_projects/${project.id}/elements/${peter.id}`)
    ).toHaveLength(3);
  });

  test('retiring takes an element out of the index and lists; restoring brings it back', async () => {
    const { project, marta } = await court();
    await call(ann, 'retire_element', { projectId: project.id, elementId: marta.id });
    expect((await indexOf(project.id))[marta.id]).toBeUndefined();
    const live = await call(ann, 'list_elements', { projectId: project.id, type: 'character' });
    expect(live.elements.map((e) => e.name)).toEqual(['King Peter']);
    const retired = await call(ann, 'list_elements', { projectId: project.id, retired: true });
    expect(retired.elements.map((e) => e.name)).toEqual(['Marta']);
    await call(ann, 'retire_element', { projectId: project.id, elementId: marta.id, restore: true });
    expect((await indexOf(project.id))[marta.id].name).toBe('Marta');
  });

  test('refusals come back as plain words', async () => {
    const { project, peter } = await court();
    await expect(
      call(ann, 'create_element', { projectId: project.id, type: 'faction', name: '  ' })
    ).rejects.toThrow('It needs a name.');
    await expect(
      call(ann, 'update_element', {
        projectId: project.id,
        elementId: peter.id,
        fields: { Height: 3 },
      })
    ).rejects.toThrow('No field "Height" here');
    await expect(
      call(ann, 'set_relationship', { projectId: project.id, a: peter.id, b: peter.id, aToB: 'x' })
    ).rejects.toThrow('related to itself');
  });

  test('custom fields keep their keys, and a project change keeps a version', async () => {
    const { project, born } = await court();
    const key = born.fields[0].key;
    const done = await call(ann, 'set_fields', {
      projectId: project.id,
      type: 'character',
      fields: [
        { key, label: 'Born in', kind: 'date' },
        { label: 'Temper', kind: 'choice', options: ['Calm', 'Fiery'] },
      ],
    });
    expect(done.fields).toEqual([
      { key, label: 'Born in', kind: 'date' },
      { key: expect.stringMatching(/^temper_/), label: 'Temper', kind: 'choice', options: ['Calm', 'Fiery'] },
    ]);
    await call(ann, 'update_project', { projectId: project.id, summary: 'A drowned court.' });
    const kept = await versionsOf(project.id, `muse_projects/${project.id}`);
    expect(kept).toHaveLength(3); // the first set_fields, this one, and the summary
    expect(kept.every((v) => v.by === 'mcp')).toBe(true);
    const read = await call(ann, 'get_project', { projectId: project.id });
    expect(read).toMatchObject({
      summary: 'A drowned court.',
      counts: { character: 2, location: 1, faction: 0, object: 0, concept: 0 },
    });
    const named = await call(ann, 'save_version', { projectId: project.id, name: 'Before' });
    expect(named.version.id).toEqual(expect.any(String));
  });
});

describe('the calendar (M-301)', () => {
  const HARPTOS = {
    start: 'blank',
    months: [
      { name: 'Hammer', short: 'Ham', days: 30 },
      { name: 'Midwinter', days: 1, outsideWeek: true },
      { name: 'Alturiak', days: 30 },
    ],
    weekdays: ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'],
    eras: [
      { name: 'Before the Founding', short: 'B.F.', start: -1000, backward: true },
      { name: 'Third Age', short: 'T.A.', start: 1 },
    ],
    format: '{d} {M} {y} {E}',
  };

  test('a project uses the Gregorian until it has a calendar', async () => {
    const { project } = await court();
    const read = await call(ann, 'get_calendar', { projectId: project.id });
    expect(read).toMatchObject({ own: false, daysInYear: 365, example: '3 March 1492 CE' });
    expect((await call(ann, 'get_project', { projectId: project.id })).calendar).toMatchObject({
      own: false,
      example: '3 March 1492 CE',
    });
  });

  test('set, with a date field written as text and read back in the project’s form', async () => {
    const { project, peter } = await court();
    const set = await call(ann, 'set_calendar', { projectId: project.id, ...HARPTOS });
    expect(set).toMatchObject({ own: true, daysInYear: 61, example: '3 Alturiak 1492 T.A.' });
    expect(set.calendar.eras.map((e) => e.short)).toEqual(['B.F.', 'T.A.']);
    // A version of the project, by mcp, was kept before it was set.
    const kept = await versionsOf(project.id, `muse_projects/${project.id}`);
    expect(kept.filter((v) => v.by === 'mcp').length).toBeGreaterThanOrEqual(2);
    const before = kept.sort((a, b) => b.at.toMillis() - a.at.toMillis())[0];
    expect(before.snapshot.calendar).toBeUndefined();

    const done = await call(ann, 'update_element', {
      projectId: project.id,
      elementId: peter.id,
      fields: { Born: 'c. the 3rd of Hammer, 200 B.F., 06:30' },
    });
    expect(done.element.fields[0]).toMatchObject({
      value: { year: -199, month: 1, day: 3, hour: 6, minute: 30, circa: true },
      shown: 'c. 3 Hammer 200 B.F., 06:30',
    });
    const stored = await doc(`muse_projects/${project.id}/elements/${peter.id}`);
    expect(Object.values(stored.fields)[0]).toEqual({
      year: -199,
      month: 1,
      day: 3,
      hour: 6,
      minute: 30,
      circa: true,
    });
    // Numbers in an era do as well; a date that doesn't fit is refused.
    const byEra = await call(ann, 'update_element', {
      projectId: project.id,
      elementId: peter.id,
      fields: { Born: { era: 'T.A.', year: 12, month: 2, day: 1 } },
    });
    expect(byEra.element.fields[0].shown).toBe('1 Midwinter 12 T.A.');
    await expect(
      call(ann, 'update_element', {
        projectId: project.id,
        elementId: peter.id,
        fields: { Born: '2 Midwinter 12 T.A.' },
      })
    ).rejects.toThrow('Midwinter has 1 day, not 2.');
    await expect(
      call(ann, 'update_element', { projectId: project.id, elementId: peter.id, fields: { Born: '3 Hamer 5' } })
    ).rejects.toThrow('not a month or an era');
  });

  test('a change keeps every date’s numbers, and lists those that no longer fit (CA9)', async () => {
    const { project, peter } = await court();
    await call(ann, 'set_calendar', { projectId: project.id, ...HARPTOS });
    await call(ann, 'update_element', {
      projectId: project.id,
      elementId: peter.id,
      fields: { Born: '30 Alturiak 1492 T.A.' },
    });
    const months = HARPTOS.months.map((m) => (m.name === 'Alturiak' ? { ...m, days: 28 } : m));
    const set = await call(ann, 'set_calendar', { projectId: project.id, months });
    expect(set.calendar.eras).toHaveLength(2); // the other parts kept
    expect(set.misfits).toEqual([
      {
        element: { id: peter.id, name: 'King Peter', type: 'character' },
        field: 'Born',
        value: { year: 1492, month: 3, day: 30 },
        shown: '30 Alturiak 1492 T.A.',
        why: 'Alturiak has 28 days, not 30.',
      },
    ]);
    const read = await call(ann, 'get_element', { projectId: project.id, elementId: peter.id });
    expect(read.fields[0]).toMatchObject({
      value: { year: 1492, month: 3, day: 30 },
      misfit: 'Alturiak has 28 days, not 30.',
    });
    // Saving it unchanged keeps it; refused: a calendar of the wrong shape.
    await call(ann, 'update_element', { projectId: project.id, elementId: peter.id, bio: 'Old.' });
    await expect(
      call(ann, 'set_calendar', { projectId: project.id, eras: [{ name: 'Night', start: 1, backward: true }] })
    ).rejects.toThrow('must follow');
    await expect(call(ann, 'set_calendar', { projectId: project.id })).rejects.toThrow('Say what');
  });
});

describe('lookups', () => {
  test('search finds a word in a bio, with its snippet; accents set aside', async () => {
    const { project, peter } = await court();
    const found = await call(ann, 'search', { projectId: project.id, query: 'estuary sailors' });
    expect(found.results).toEqual([
      expect.objectContaining({
        id: peter.id,
        where: ['bio'],
        snippet: expect.objectContaining({ in: 'bio' }),
      }),
    ]);
    const { text, marks } = found.results[0].snippet;
    expect(marks.map(([s, e]) => text.slice(s, e))).toEqual(['sailors', 'Éstuary']);
    // "bells" is in the city's bio only; a phrase must be found whole.
    expect(
      (await call(ann, 'search', { projectId: project.id, query: 'bells' })).results.map((r) => r.name)
    ).toEqual(['The Sunken City']);
    expect(
      (await call(ann, 'search', { projectId: project.id, query: '"bells estuary"' })).results
    ).toEqual([]);
  });

  test('lookup by an alias gives the element in full, with where it is mentioned', async () => {
    const { project, sea, peter } = await court();
    const found = await call(ann, 'lookup', { projectId: project.id, name: 'old brass' });
    expect(found.matched).toBe('Old Brass');
    expect(found.element).toMatchObject({
      id: sea.id,
      name: 'The Sunken City',
      mentionedIn: [{ id: peter.id, name: 'King Peter', type: 'character' }],
    });
    await expect(call(ann, 'lookup', { projectId: project.id, name: 'Zed' })).rejects.toThrow(
      'Nothing is called "Zed".'
    );
  });

  test('the outline lists each type with its first lines', async () => {
    const { project } = await court();
    const outline = await call(ann, 'outline', { projectId: project.id });
    expect(outline.project).toMatchObject({ title: 'The Court', short: 'Tides' });
    expect(outline.types.character.map((e) => [e.name, e.line])).toEqual([
      ['King Peter', 'Rules from Old Brass.'],
      ['Marta', 'Keeps the court.'],
    ]);
    expect(outline.types.location[0].line).toBe('A city of bells under the estuary.');
  });

  test('find_elements matches names and aliases as the page does', async () => {
    const { project } = await court();
    const found = await call(ann, 'find_elements', { projectId: project.id, query: 'widow' });
    expect(found.elements).toEqual([expect.objectContaining({ name: 'Marta', matched: 'The Widow' })]);
  });

  test('the page’s search box gets the same answers from museSearch', async () => {
    const { project, peter } = await court();
    const found = await museSearch.run({
      data: { projectId: project.id, query: 'estuary' },
      auth: { uid: 'ann', token: { apps: ['muse'] } },
    });
    expect(found.results.map((r) => r.id)).toContain(peter.id);
    await expect(
      museSearch.run({
        data: { projectId: project.id, query: 'estuary' },
        auth: { uid: 'bob', token: { apps: ['muse'] } },
      })
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      museSearch.run({
        data: { projectId: project.id, query: 'estuary' },
        auth: { uid: 'ann', token: { apps: ['cartographer'] } },
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

describe('the studio’s tools', () => {
  test('are here without worlds, and draw an element with its look', async () => {
    const { tools } = await ann.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'studio_generate',
        'studio_edit',
        'studio_find',
        'studio_get',
        'studio_import',
        'studio_jobs',
        'studio_styles',
      ])
    );
    expect(names).not.toEqual(expect.arrayContaining(['studio_assign']));
    expect(names).not.toContain('studio_delete');
    const generate = tools.find((t) => t.name === 'studio_generate');
    expect(Object.keys(generate.inputSchema.properties)).not.toContain('from');
    expect(Object.keys(generate.inputSchema.properties)).toContain('element');
    expect(Object.keys(tools.find((t) => t.name === 'studio_find').inputSchema.properties)).not.toContain(
      'worldId'
    );

    const { project, peter } = await court();
    const done = await call(ann, 'studio_generate', {
      prompt: 'A painted portrait',
      element: { projectId: project.id, elementId: peter.id },
    });
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      uid: 'ann',
      via: 'mcp',
      args: { kind: 'portrait', title: 'King Peter', labels: ['the court'] },
    });
    expect(started[0].args.prompt).toContain('King Peter: Grey-bearded, a crown of coral.');
    expect(done.next).toContain('add_photos');
    // Drawing someone else's element is refused before anything is charged.
    await expect(
      call(bob, 'studio_generate', {
        prompt: 'x',
        element: { projectId: project.id, elementId: peter.id },
      })
    ).rejects.toThrow('Project not found.');
    expect(started).toHaveLength(1);
  });
});

describe('access', () => {
  test('a token without mcp:muse is refused', async () => {
    const res = await fetch(`${base}/mcp/muse`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenFor('ann', { scope: 'mcp:cartographer' })}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } },
      }),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get('www-authenticate')).toMatch(/insufficient_scope.*scope="mcp:muse"/);
  });

  test('one user never sees another’s project', async () => {
    const { project, peter } = await court();
    expect((await call(bob, 'list_projects')).projects).toEqual([]);
    for (const [name, args] of [
      ['get_project', { projectId: project.id }],
      ['get_element', { projectId: project.id, elementId: peter.id }],
      ['update_element', { projectId: project.id, elementId: peter.id, bio: 'Mine now.' }],
      ['search', { projectId: project.id, query: 'estuary' }],
    ]) {
      await expect(call(bob, name, args)).rejects.toThrow('Project not found.');
    }
    expect((await doc(`muse_projects/${project.id}/elements/${peter.id}`)).bio).toContain('Old Brass');
  });
});
