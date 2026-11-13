'use strict';

/**
 * Fetching an image by its link, for studio_import: images a builder already
 * has elsewhere (a Craft document, a web page) brought into the library
 * without making them again or uploading them by hand.
 *
 * The server fetches a link Claude gives it, so the link is held to what an
 * image on the public web can be:
 * - https only, on the default port, with no name and password in it;
 * - every address the host name resolves to must be public: never this
 *   machine, the private network, link-local (the metadata server) or a
 *   reserved range. It is checked when the connection is made (the request's
 *   own lookup), so a name can't resolve to a public address when checked and
 *   a private one when used. A host written as an address is checked as one;
 * - redirects followed at most MAX_REDIRECTS times, each checked the same way;
 * - at most MAX_BYTES (the library's own limit), read within TIMEOUT_MS.
 * What comes back is judged by its bytes (formats.js readImage), never by its
 * content type.
 */

const https = require('https');
const dns = require('dns');
const net = require('net');
const { MAX_BYTES } = require('./formats');

const TIMEOUT_MS = 20000;
const MAX_REDIRECTS = 3;
const MAX_URL = 2000;

class FetchError extends Error {
  constructor(message) {
    super(message);
    this.code = 'invalid-argument';
  }
}

// Addresses that aren't the public internet.
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv6'));

/** Whether an IP address is on the public internet. */
function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family !== 6) return false;
  // An IPv4 address written as IPv6 (::ffff:a.b.c.d) is judged as IPv4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, 'ipv6');
}

/** The link as a URL, or a FetchError saying why it can't be fetched. */
function checkUrl(link) {
  if (typeof link !== 'string' || !link || link.length > MAX_URL) {
    throw new FetchError(`A link is text, up to ${MAX_URL} characters.`);
  }
  let url;
  try {
    url = new URL(link);
  } catch {
    throw new FetchError('That isn’t a link.');
  }
  if (url.protocol !== 'https:') throw new FetchError('Only https links can be fetched.');
  if (url.username || url.password) {
    throw new FetchError('A link with a name or password in it can’t be fetched.');
  }
  if (url.port && url.port !== '443') throw new FetchError('Only the default https port.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) {
    throw new FetchError('That link points at a private address.');
  }
  return url;
}

// The request's own lookup: every address the name resolves to must be public.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, family: options && options.family }, (err, addresses) => {
    if (err) return callback(new FetchError(`Can’t find ${hostname}.`));
    if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new FetchError(`${hostname} points at a private address.`));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function getOnce(url, { request = https.request } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { 'user-agent': 'OlympusStudio/1.0 (image import)', accept: 'image/*' },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(new FetchError(`The link answered ${status}.`));
        }
        const length = Number(res.headers['content-length']);
        if (Number.isFinite(length) && length > MAX_BYTES) {
          res.destroy();
          return reject(new FetchError(tooBig()));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            res.destroy();
            reject(new FetchError(tooBig()));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ bytes: Buffer.concat(chunks) }));
        res.on('error', (err) => reject(new FetchError(`The download failed: ${err.message}.`)));
      }
    );
    req.on('timeout', () => req.destroy(new FetchError('The link took too long to answer.')));
    req.on('error', (err) =>
      reject(err instanceof FetchError ? err : new FetchError(`Can’t fetch it: ${err.message}.`))
    );
    req.end();
  });
}

const tooBig = () => `The image is over ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`;

/**
 * The bytes at a link, following redirects. `request` stands in for
 * https.request in tests.
 */
async function fetchImage(link, { request } = {}) {
  let url = checkUrl(link);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const got = await getOnce(url, { request });
    if (got.bytes) return got.bytes;
    url = checkUrl(new URL(got.redirect, url).toString());
  }
  throw new FetchError('The link redirects too many times.');
}

/** A link as it's kept on the image: no query or fragment, which may hold a key. */
function sourceOf(link) {
  const url = new URL(link);
  return `${url.origin}${url.pathname}`;
}

module.exports = {
  fetchImage,
  checkUrl,
  isPublicAddress,
  safeLookup,
  sourceOf,
  FetchError,
  MAX_REDIRECTS,
};
