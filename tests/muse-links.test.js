'use strict';

/**
 * How the Muse's elements point at each other, as plain data (planning/the-muse.md
 * §3 EL3, EL5, EL6; M-103 / #891): a relationship read from each side, @-link
 * parsing and `mentions` kept in step through edits, a name or alias found in a
 * text and made a link, and search over names and aliases.
 *
 * Run: cd tests && npx jest muse-links --verbose
 */

const links = require('../public/apps/muse/js/links.js');
const model = require('../public/apps/muse/js/model.js');

const LIVE = { el_marta: 'character', el_peter: 'character', el_sea: 'location' };
const elementType = (id) => LIVE[id] || null;

// ── Relationships (EL3) ───────────────────────────

describe('a relationship', () => {
  const made = (over = {}) =>
    links.checkRelationship(
      { a: 'el_marta', b: 'el_peter', aToB: 'mother of', bToA: 'son of', ...over },
      { elementType }
    );

  test('is checked and cleaned', () => {
    expect(
      made({ aToB: '  mother   of ', bToA: ' son of', description: '  Raised him alone.  ' })
    ).toEqual({
      value: {
        a: 'el_marta',
        b: 'el_peter',
        aToB: 'mother of',
        bToA: 'son of',
        description: 'Raised him alone.',
      },
    });
  });

  test('says the same from both sides when the second is left blank', () => {
    expect(made({ aToB: 'friend of', bToA: '' }).value).toMatchObject({
      aToB: 'friend of',
      bToA: 'friend of',
    });
    expect(made({ aToB: 'friend of', bToA: undefined }).value.bToA).toBe('friend of');
  });

  test.each([
    ['no words', { aToB: ' ' }, /what the first is/],
    ['words that are too long', { aToB: 'x'.repeat(101) }, /at most 100/],
    ['a description that is too long', { description: 'x'.repeat(1001) }, /at most 1000/],
    ['an element related to itself', { b: 'el_marta' }, /itself/],
    ['an element that isn’t here', { b: 'el_gone' }, /in this project/],
    ['no second element', { b: '' }, /Pick/],
  ])('is refused with %s', (_, over, message) => {
    const { error, value } = made(over);
    expect(value).toBeUndefined();
    expect(error).toMatch(message);
  });

  test('is read from each side', () => {
    const rel = { id: 'r1', ...made().value };
    expect(links.sideOf(rel, 'el_marta')).toEqual({
      id: 'r1',
      other: 'el_peter',
      kind: 'mother of',
      back: 'son of',
      description: '',
    });
    expect(links.sideOf(rel, 'el_peter')).toEqual({
      id: 'r1',
      other: 'el_marta',
      kind: 'son of',
      back: 'mother of',
      description: '',
    });
    expect(links.sideOf(rel, 'el_sea')).toBeNull();
  });

  test('is edited from either side, in that side’s words', () => {
    const rel = { id: 'r1', ...made().value };
    // From Peter's page: "son of" becomes "adopted son of"; Marta's words stay.
    expect(links.fromSide(rel, 'el_peter', 'adopted son of', 'mother of')).toEqual({
      aToB: 'mother of',
      bToA: 'adopted son of',
    });
    // From Marta's page the words go the other way round.
    expect(links.fromSide(rel, 'el_marta', 'guardian of', 'ward of')).toEqual({
      aToB: 'guardian of',
      bToA: 'ward of',
    });
  });

  test('is planned as one write each to make, change and remove', () => {
    const [create] = links.planRelate('p1', 'r1', made({ description: 'x' }).value);
    expect(create).toEqual({
      op: 'set',
      path: 'muse_projects/p1/relationships/r1',
      data: {
        a: 'el_marta',
        b: 'el_peter',
        aToB: 'mother of',
        bToA: 'son of',
        description: 'x',
        ends: ['el_marta', 'el_peter'],
        createdAt: model.NOW,
        updatedAt: model.NOW,
      },
    });
    const [update] = links.planRelationshipUpdate('p1', 'r1', {
      aToB: 'mother of',
      bToA: 'ward of',
      description: '',
    });
    expect(update).toEqual({
      op: 'update',
      path: 'muse_projects/p1/relationships/r1',
      data: { aToB: 'mother of', bToA: 'ward of', description: '', updatedAt: model.NOW },
    });
    expect(links.planUnrelate('p1', 'r1')).toEqual([
      { op: 'delete', path: 'muse_projects/p1/relationships/r1' },
    ]);
  });
});

// ── @-links (EL6) ─────────────────────────────────

describe('@-links', () => {
  test('are written as a Markdown link to the element', () => {
    expect(links.linkMarkdown('King Peter', 'el_peter')).toBe('[King Peter](muse:el/el_peter)');
    // Brackets in a name would end its label early.
    expect(links.linkMarkdown('Peter [the Drowned]', 'el_peter')).toBe(
      '[Peter the Drowned](muse:el/el_peter)'
    );
  });

  test('are found once each, in order, across texts', () => {
    expect(
      links.mentionsOf(
        'See [Peter](muse:el/el_peter) and [the sea](muse:el/el_sea).\n\nAgain [Peter](muse:el/el_peter).',
        'Her son is [Peter](muse:el/el_peter); her house [Marta’s](muse:el/el_marta).'
      )
    ).toEqual(['el_peter', 'el_sea', 'el_marta']);
  });

  test('are not found in code, in web links or when badly formed', () => {
    const text = [
      'Inline `[no](muse:el/el_code)` code.',
      '',
      '```',
      '[fenced](muse:el/el_fenced)',
      '```',
      '',
      'A [web link](https://example.com/muse:el/el_web), a [bad](muse:el/) one,',
      'one with no label [](muse:el/el_empty), and [odd id](muse:el/a b).',
      '',
      'But [this one](muse:el/el_real) counts.',
    ].join('\n');
    expect(links.mentionsOf(text)).toEqual(['el_real']);
    expect(links.mentionsOf('', null, undefined)).toEqual([]);
  });

  test('are kept as `mentions` through create, edit and edit again', () => {
    // A character's bio and appearance both link.
    const made = model.checkElement(
      'character',
      {
        name: 'Peter',
        bio: 'Son of [Marta](muse:el/el_marta).',
        appearance: 'Wears [the crown](muse:el/el_crown).',
      },
      {}
    ).value;
    expect(made.mentions).toEqual(['el_marta', 'el_crown']);
    const [create] = model.planCreate('p1', 'el_peter', 'character', made, model.readIndex([]));
    expect(create.data.mentions).toEqual(['el_marta', 'el_crown']);

    // Edited: the bio drops one link and gains another; the appearance stays.
    const stored = { id: 'el_peter', ...create.data };
    const edit1 = model.checkElement(
      'character',
      { bio: 'Rules [the sea](muse:el/el_sea).' },
      { current: stored }
    ).value;
    expect(edit1.mentions).toEqual(['el_sea', 'el_crown']);
    const [update] = model.planUpdate('p1', stored, edit1);
    expect(update.data.mentions).toEqual(['el_sea', 'el_crown']);

    // Edited again with nothing linking: none are kept.
    const edit2 = model.checkElement(
      'character',
      { bio: 'Alone.', appearance: '' },
      { current: { ...stored, ...edit1 } }
    ).value;
    expect(edit2.mentions).toEqual([]);

    // Other types have a bio only.
    expect(
      model.checkElement('faction', { name: 'Guild', bio: '[Peter](muse:el/el_peter)' }, {}).value
        .mentions
    ).toEqual(['el_peter']);
  });

  test('are unchanged when only the name changes', () => {
    const stored = {
      id: 'el_peter',
      type: 'character',
      name: 'Peter',
      aliases: [],
      bio: '[Marta](muse:el/el_marta)',
      appearance: '',
      residence: null,
      fields: {},
      mentions: ['el_marta'],
      shard: '0',
    };
    const value = model.checkElement('character', { name: 'King Peter' }, { current: stored }).value;
    expect(value.mentions).toEqual(['el_marta']);
  });
});

// ── Names found in a text (EL6) ───────────────────

describe('names and aliases found in a text', () => {
  const ENTRIES = {
    el_sea: { name: 'The Sunken City', aliases: ['Old Brass'] },
    el_peter: { name: 'King Peter', aliases: ['Peter', 'The Drowned King'] },
    el_marta: { name: 'Marta', aliases: [] },
  };
  // A stand-in for the Markdown renderer's hold: the html in braces.
  const link = (matcher, text, except) =>
    matcher.link(text, (html) => '{' + html.replace(/<a[^>]*data-el="([^"]+)"[^>]*>/, '$1:') + '}', except)
      .replace(/<\/a>/g, '');

  test('an alias becomes a link in a text that does not @-link it', () => {
    const matcher = links.buildMatcher(ENTRIES);
    expect(link(matcher, 'They sailed to Old Brass at dawn.')).toBe(
      'They sailed to {el_sea:Old Brass} at dawn.'
    );
    // The real anchor, as the page shows it.
    expect(
      matcher.link('Old Brass', (html) => html)
    ).toBe('<a class="muse-el-link muse-auto" href="#" data-el="el_sea">Old Brass</a>');
  });

  test('the longest name wins, and any case matches', () => {
    const matcher = links.buildMatcher(ENTRIES);
    expect(link(matcher, 'King Peter met marta; the drowned king left. Peter stayed.')).toBe(
      '{el_peter:King Peter} met {el_marta:marta}; {el_peter:the drowned king} left. {el_peter:Peter} stayed.'
    );
  });

  test('only whole words match', () => {
    const matcher = links.buildMatcher(ENTRIES);
    expect(link(matcher, 'Peters, Martas and Petersen. Marta’s hall; (Marta) “Marta”.')).toBe(
      'Peters, Martas and Petersen. {el_marta:Marta}’s hall; ({el_marta:Marta}) “{el_marta:Marta}”.'
    );
  });

  test('an element’s own page leaves its own name alone', () => {
    const matcher = links.buildMatcher(ENTRIES);
    expect(link(matcher, 'Peter loves Marta.', 'el_peter')).toBe('Peter loves {el_marta:Marta}.');
  });

  test('a name two elements share links to neither', () => {
    const matcher = links.buildMatcher({
      ...ENTRIES,
      el_other: { name: 'Peter', aliases: [] },
    });
    // “Peter” is King Peter’s alias and another's name; “King Peter” is still his.
    expect(link(matcher, 'Peter and King Peter')).toBe('Peter and {el_peter:King Peter}');
  });

  test('a name is at least two characters with a letter in it', () => {
    const matcher = links.buildMatcher({
      el_a: { name: 'A', aliases: ['42', '--', 'Oz'] },
    });
    expect(link(matcher, 'A 42 -- Oz')).toBe('A 42 -- {el_a:Oz}');
    expect(links.buildMatcher({}).size).toBe(0);
    expect(links.buildMatcher({}).link('Nothing here', () => '?')).toBe('Nothing here');
  });

  test('works on escaped text, and never inside an HTML entity', () => {
    const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const escape = (t) => String(t).replace(/[&<>"']/g, (c) => ESC[c]);
    const matcher = links.buildMatcher(
      {
        el_o: { name: 'O’Brien & Sons', aliases: ["The O'Briens"] },
        el_amp: { name: 'amp', aliases: [] },
        el_tag: { name: 'quot', aliases: [] },
      },
      { escape }
    );
    expect(link(matcher, escape("Tea with The O'Briens & friends; “amp” is a word"))).toBe(
      'Tea with {el_o:The O&#39;Briens} &amp; friends; “{el_amp:amp}” is a word'
    );
    // `&amp;` and `&quot;` hold the words amp and quot, but are not them.
    expect(link(matcher, escape('Fish & chips "quoted"'))).toBe(
      'Fish &amp; chips &quot;quoted&quot;'
    );
    // Typed on its own, a word is still found between the quotes.
    expect(link(matcher, escape('"quot"'))).toBe('&quot;{el_tag:quot}&quot;');
  });
});

// ── Search (EL5) ──────────────────────────────────

describe('searching names and aliases', () => {
  const ENTRIES = {
    el_peter: { type: 'character', name: 'King Peter', aliases: ['The Drowned King'], primary: null },
    el_sea: { type: 'location', name: 'The Sunken City', aliases: ['Old Brass', 'Brasshold'] },
    el_brass: { type: 'object', name: 'Brass Key', aliases: [] },
    el_marta: { type: 'character', name: 'Márta', aliases: ['The Widow'] },
    el_guild: { type: 'faction', name: 'Bell-ringers’ Guild', aliases: [] },
  };
  const names = (query, options) => links.search(ENTRIES, query, options).map((r) => r.id);

  test('finds an element by one of its aliases, and says which', () => {
    const [found] = links.search(ENTRIES, 'old br');
    expect(found).toMatchObject({
      id: 'el_sea',
      type: 'location',
      name: 'The Sunken City',
      matched: 'Old Brass',
    });
    // Found by its name, no alias is named.
    expect(links.search(ENTRIES, 'sunken')[0].matched).toBeNull();
  });

  test('ranks exact, then starts-with, then a word’s start, then anywhere', () => {
    // "brass": a name that starts with it, an alias that is it exactly... and a word.
    expect(names('brass')).toEqual(['el_brass', 'el_sea']);
    // Exact beats the rest.
    expect(names('brasshold')).toEqual(['el_sea']);
    // A word inside a name (after a space or hyphen) beats a match mid-word.
    expect(names('ringers')).toEqual(['el_guild']);
    expect(names('ell')).toEqual(['el_guild']);
    expect(names('widow')).toEqual(['el_marta']);
  });

  test('ignores case and accents', () => {
    expect(names('MARTA')).toEqual(['el_marta']);
    expect(names('márta')).toEqual(['el_marta']);
    expect(names('  drowned  ')).toEqual(['el_peter']);
  });

  test('lists the first by name when nothing is typed, and respects the limits', () => {
    expect(names('')).toEqual(['el_guild', 'el_brass', 'el_peter', 'el_marta', 'el_sea']);
    expect(names('', { limit: 2 })).toEqual(['el_guild', 'el_brass']);
    expect(names('', { types: ['character'] })).toEqual(['el_peter', 'el_marta']);
    expect(names('', { except: 'el_peter', types: ['character'] })).toEqual(['el_marta']);
    expect(names('zzz')).toEqual([]);
    expect(links.search(null, 'x')).toEqual([]);
  });
});
