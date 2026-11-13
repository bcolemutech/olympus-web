'use strict';

/**
 * Fetching an image by its link for studio_import (functions/studio/fetch.js):
 * only https links to the public internet, redirects checked as they come,
 * and a size limit. Pure: requests are faked, and lookups refused before any
 * connection is made.
 *
 * Run: cd tests && npx jest studio-fetch --verbose
 */

const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  fetchImage,
  checkUrl,
  isPublicAddress,
  safeLookup,
  sourceOf,
  MAX_REDIRECTS,
} = require('../functions/studio/fetch');
const { MAX_BYTES } = require('../functions/studio/formats');

describe('isPublicAddress', () => {
  test.each([
    ['8.8.8.8', true],
    ['151.101.1.69', true],
    ['2606:4700::6810:84e5', true],
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.20.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['224.0.0.1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:8.8.8.8', true],
    ['not an address', false],
  ])('%s → %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe('checkUrl', () => {
  test('takes an https link', () => {
    expect(checkUrl('https://res.craft.do/user/full/a.png').hostname).toBe('res.craft.do');
  });
  test.each([
    ['http://example.com/a.png', /https/],
    ['ftp://example.com/a.png', /https/],
    ['file:///etc/passwd', /https/],
    ['https://user:pw@example.com/a.png', /name or password/],
    ['https://example.com:8443/a.png', /port/],
    ['https://127.0.0.1/a.png', /private/],
    ['https://169.254.169.254/latest/meta-data', /private/],
    ['https://[::1]/a.png', /private/],
    ['https://10.0.0.5/a.png', /private/],
    ['not a link', /isn’t a link/],
    ['', /up to/],
  ])('refuses %s', (link, why) => {
    expect(() => checkUrl(link)).toThrow(why);
  });
});

test('safeLookup refuses a name that resolves to this machine', (done) => {
  safeLookup('localhost', {}, (err) => {
    expect(err && err.message).toMatch(/private address/);
    done();
  });
});

test('sourceOf keeps the link without its query or fragment', () => {
  expect(sourceOf('https://res.craft.do/a/b.png?token=x#y')).toBe('https://res.craft.do/a/b.png');
});

// A fake https.request: answers each link from `answers` (status, headers,
// body), and records the lookup it was given.
function fakeRequest(answers, seen = []) {
  return (url, options, onResponse) => {
    seen.push({ url: String(url), lookup: options.lookup });
    const req = new EventEmitter();
    req.end = () => {
      const answer = answers[String(url)] || { status: 404 };
      const res = new PassThrough();
      res.statusCode = answer.status || 200;
      res.headers = answer.headers || {};
      setImmediate(() => {
        onResponse(res);
        res.end(answer.body || Buffer.alloc(0));
      });
    };
    req.destroy = (err) => err && req.emit('error', err);
    return req;
  };
}

describe('fetchImage', () => {
  const A = 'https://example.com/a.png';
  const B = 'https://cdn.example.com/b.png';

  test('returns the bytes, made with the safe lookup', async () => {
    const seen = [];
    const bytes = await fetchImage(A, {
      request: fakeRequest({ [A]: { body: Buffer.from('png bytes') } }, seen),
    });
    expect(bytes.toString()).toBe('png bytes');
    expect(seen[0].lookup).toBe(safeLookup);
  });

  test('follows a redirect, and checks where it leads', async () => {
    const request = fakeRequest({
      [A]: { status: 302, headers: { location: B } },
      [B]: { body: Buffer.from('moved') },
    });
    expect((await fetchImage(A, { request })).toString()).toBe('moved');
    const toPrivate = fakeRequest({
      [A]: { status: 301, headers: { location: 'https://169.254.169.254/x' } },
    });
    await expect(fetchImage(A, { request: toPrivate })).rejects.toThrow(/private/);
    const toHttp = fakeRequest({ [A]: { status: 302, headers: { location: 'http://b.com/x' } } });
    await expect(fetchImage(A, { request: toHttp })).rejects.toThrow(/https/);
  });

  test('stops after too many redirects', async () => {
    const answers = {};
    for (let i = 0; i <= MAX_REDIRECTS + 1; i++) {
      answers[`https://example.com/${i}`] = {
        status: 302,
        headers: { location: `https://example.com/${i + 1}` },
      };
    }
    await expect(
      fetchImage('https://example.com/0', { request: fakeRequest(answers) })
    ).rejects.toThrow(/too many/);
  });

  test('refuses an error status and an image too big', async () => {
    await expect(fetchImage(A, { request: fakeRequest({}) })).rejects.toThrow(/answered 404/);
    const big = fakeRequest({
      [A]: { headers: { 'content-length': String(MAX_BYTES + 1) }, body: Buffer.alloc(10) },
    });
    await expect(fetchImage(A, { request: big })).rejects.toThrow(/over 30 MB/);
    const sneaky = fakeRequest({ [A]: { body: Buffer.alloc(MAX_BYTES + 1) } });
    await expect(fetchImage(A, { request: sneaky })).rejects.toThrow(/over 30 MB/);
  });

  test('refuses a link it can’t fetch before asking', async () => {
    const seen = [];
    await expect(
      fetchImage('https://192.168.0.10/a.png', { request: fakeRequest({}, seen) })
    ).rejects.toThrow(/private/);
    expect(seen).toHaveLength(0);
  });
});
