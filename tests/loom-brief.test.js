'use strict';

/**
 * A world's brief (L-711; planning/worlds-without-azgaar.md §4.1): its checks,
 * the BRIEF line the GM is told and the art direction the studio uses as a
 * style. Pure; no emulator.
 */

const brief = require('../functions/loom-canon/brief');

describe('checkBrief', () => {
  test('keeps the fields given, trimmed, and nothing else', () => {
    const { fields, errors } = brief.checkBrief({ genre: '  space opera ', tone: '' });
    expect(errors).toEqual([]);
    expect(fields).toEqual({ genre: 'space opera', tone: '' });
  });

  test('refuses a field over its length, naming it and its limit', () => {
    for (const key of brief.FIELDS) {
      const { errors } = brief.checkBrief({ [key]: 'x'.repeat(brief.LIMITS[key] + 1) });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(`at most ${brief.LIMITS[key]}`);
      expect(brief.checkBrief({ [key]: 'x'.repeat(brief.LIMITS[key]) }).errors).toEqual([]);
    }
  });

  test('refuses an unknown field, a non-text one and a brief that is not an object', () => {
    expect(brief.checkBrief({ mood: 'sad' }).errors[0]).toMatch(/no "mood"/);
    expect(brief.checkBrief({ era: 1900 }).errors[0]).toMatch(/era must be text/);
    expect(brief.checkBrief('grim').errors[0]).toMatch(/is an object/);
    expect(brief.checkBrief(null).errors[0]).toMatch(/is an object/);
    expect(brief.checkBrief([]).errors[0]).toMatch(/is an object/);
  });
});

describe('briefFrom and briefChanges', () => {
  test('a new brief has the fields with text, or is null', () => {
    expect(brief.briefFrom({ genre: 'noir', tone: '', era: undefined })).toEqual({ genre: 'noir' });
    expect(brief.briefFrom({ genre: '', tone: '' })).toBeNull();
    expect(brief.briefFrom(null)).toBeNull();
  });

  test('a change writes the fields that differ; "" clears only a field it has', () => {
    const CLEAR = Symbol('delete');
    const had = { genre: 'noir', tone: 'bleak' };
    expect(
      brief.briefChanges(had, { genre: 'noir', tone: 'wry', era: '', artDirection: 'ink' }, CLEAR)
    ).toEqual({ 'brief.tone': 'wry', 'brief.artDirection': 'ink' });
    expect(brief.briefChanges(had, { genre: '' }, CLEAR)).toEqual({ 'brief.genre': CLEAR });
    expect(brief.briefChanges(null, { era: 'now' }, CLEAR)).toEqual({ 'brief.era': 'now' });
  });
});

describe('the BRIEF line and the art style', () => {
  const world = {
    brief: { genre: 'dark fantasy', tone: 'grim', era: 'an age of plague', artDirection: 'ink' },
  };

  test('lists the fields set, in order, on one line', () => {
    expect(brief.briefLine(world)).toBe(
      'BRIEF: genre: dark fantasy. tone: grim. era: an age of plague. art direction: ink.'
    );
    expect(brief.briefLine({ brief: { tone: 'wry\nand  light' } })).toBe(
      'BRIEF: tone: wry and light.'
    );
  });

  test('there is none for a world without one', () => {
    expect(brief.briefLine({})).toBe('');
    expect(brief.briefLine({ brief: null })).toBe('');
    expect(brief.briefLine({ brief: {} })).toBe('');
    expect(brief.briefLine(null)).toBe('');
  });

  test('the art direction is the studio’s style, when it has one', () => {
    expect(brief.artStyleOf(world)).toBe('ink');
    expect(brief.artStyleOf({ brief: { genre: 'noir' } })).toBe('');
    expect(brief.artStyleOf({})).toBe('');
  });
});
