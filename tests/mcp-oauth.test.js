'use strict';

/**
 * Unit tests for the inbound MCP OAuth 2.1 authorization server
 * (functions/mcp/oauth). Drives the /authorize and /token handlers with the
 * in-memory store — no Firestore emulator required.
 *
 * Covers the phase-1c flow and the hardening from the PR #358 security review:
 * XSS-safe consent rendering, required audience, Host-header pinning,
 * refresh-token family revocation on reuse, and entitlement re-check on refresh.
 *
 * Run: cd tests && npx jest mcp-oauth --verbose
 */

// Signing secret must be resolvable before requiring the token modules.
process.env.MCP_JWT_SECRET = 'test-signing-secret-mcp-oauth';
// Ensure prod "pinned origin" mode (Host header ignored), not emulator mode.
delete process.env.FUNCTIONS_EMULATOR;
delete process.env.OLYMPUS_ORIGIN;

const crypto = require('crypto');
const { createInMemoryStore } = require('../functions/mcp/oauth/store');
const { createAuthorizeHandler } = require('../functions/mcp/oauth/authorize');
const { createTokenHandler } = require('../functions/mcp/oauth/token');
const { verifyAccessToken } = require('../functions/mcp/oauth/tokens');
const { base64UrlSha256 } = require('../functions/mcp/oauth/pkce');
const { renderConsentPage } = require('../functions/mcp/oauth/consent-page');

const CANONICAL = 'https://bcoletech.com';
const APP = 'scriptorium';
const AUD = `${CANONICAL}/mcp/${APP}`;
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';

const codeVerifier = crypto.randomBytes(40).toString('base64url');
const codeChallenge = base64UrlSha256(codeVerifier);

function mockRes() {
  const r = { statusCode: 200, headers: {}, body: undefined, html: undefined };
  r.set = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
  r.status = (c) => ((r.statusCode = c), r);
  r.json = (o) => ((r.body = o), r);
  r.send = (s) => ((r.html = s), r);
  r.redirect = (code, url) => ((r.statusCode = code), (r.redirectedTo = url), r);
  r.get = (k) => r.headers[k.toLowerCase()];
  return r;
}

const baseParams = () => ({
  response_type: 'code',
  client_id: 'client-123',
  redirect_uri: REDIRECT,
  scope: 'mcp:scriptorium',
  state: 'xyz-state',
  code_challenge: codeChallenge,
  code_challenge_method: 'S256',
});

const HEADERS = { host: 'olympus-dfa00.web.app', 'x-forwarded-proto': 'https' };

function setup() {
  const store = createInMemoryStore();
  store.putClient({ clientId: 'client-123', clientName: 'Claude', redirectUris: [REDIRECT] });

  // Mutable entitlements so the refresh re-check can be exercised.
  const entitlements = new Map([['uid-abc', ['scriptorium', 'symposium']]]);

  const verifyIdToken = async (idToken) => {
    if (idToken === 'user-with-app') return { uid: 'uid-abc', apps: entitlements.get('uid-abc') };
    if (idToken === 'user-without-app') return { uid: 'uid-none', apps: ['symposium'] };
    throw new Error('invalid token');
  };
  const getEntitlements = async (uid) => entitlements.get(uid) || [];

  let clock = Date.now();
  const now = () => clock;

  const authorize = createAuthorizeHandler({ store, verifyIdToken, now });
  const token = createTokenHandler({ store, getEntitlements, now });

  return {
    store,
    entitlements,
    authorize,
    token,
    advance: (ms) => (clock += ms),
  };
}

async function approve(authorize, overrides = {}, headers = HEADERS) {
  const res = mockRes();
  await authorize(
    { method: 'POST', headers, body: { ...baseParams(), idToken: 'user-with-app', ...overrides } },
    res
  );
  return res;
}

async function getCode(authorize, headers = HEADERS) {
  const res = await approve(authorize, {}, headers);
  return new URL(res.body.redirect).searchParams.get('code');
}

async function exchange(token, code, overrides = {}) {
  const res = mockRes();
  await token(
    {
      method: 'POST',
      headers: HEADERS,
      body: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT,
        client_id: 'client-123',
        code_verifier: codeVerifier,
        ...overrides,
      },
    },
    res
  );
  return res;
}

async function refresh(token, refreshToken) {
  const res = mockRes();
  await token(
    {
      method: 'POST',
      headers: HEADERS,
      body: { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: 'client-123' },
    },
    res
  );
  return res;
}

describe('authorize consent', () => {
  test('renders consent naming the app, without leaking a code', async () => {
    const { authorize } = setup();
    const res = mockRes();
    await authorize({ method: 'GET', headers: HEADERS, query: baseParams() }, res);
    expect(res.statusCode).toBe(200);
    expect(res.html).toMatch(/Scriptorium/);
    expect(res.html).not.toMatch(/code=/);
  });

  test('sets anti-clickjacking headers', async () => {
    const { authorize } = setup();
    const res = mockRes();
    await authorize({ method: 'GET', headers: HEADERS, query: baseParams() }, res);
    expect(res.get('X-Frame-Options')).toBe('DENY');
    expect(res.get('Content-Security-Policy')).toMatch(/frame-ancestors 'none'/);
  });

  test('unknown client → 400 page, no redirect', async () => {
    const { authorize } = setup();
    const res = mockRes();
    await authorize(
      { method: 'GET', headers: HEADERS, query: { ...baseParams(), client_id: 'nope' } },
      res
    );
    expect(res.statusCode).toBe(400);
    expect(res.redirectedTo).toBeUndefined();
  });

  test('plain PKCE → redirect invalid_request', async () => {
    const { authorize } = setup();
    const res = mockRes();
    await authorize(
      {
        method: 'GET',
        headers: HEADERS,
        query: { ...baseParams(), code_challenge_method: 'plain' },
      },
      res
    );
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toMatch(/error=invalid_request/);
  });

  test('POST without app entitlement → 403 access_denied', async () => {
    const { authorize } = setup();
    const res = await approve(authorize, { idToken: 'user-without-app' });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('access_denied');
  });

  test('POST with bad idToken → 401', async () => {
    const { authorize } = setup();
    const res = await approve(authorize, { idToken: 'bad' });
    expect(res.statusCode).toBe(401);
  });

  test('POST redirect_uri mismatch → invalid_request', async () => {
    const { authorize } = setup();
    const res = await approve(authorize, { redirect_uri: 'https://evil.example/cb' });
    expect(res.body.error).toBe('invalid_request');
  });

  test('approve returns a redirect with code and preserved state', async () => {
    const { authorize } = setup();
    const res = await approve(authorize);
    const url = new URL(res.body.redirect);
    expect(url.searchParams.get('code')).toBeTruthy();
    expect(url.searchParams.get('state')).toBe('xyz-state');
  });
});

describe('consent page is XSS-safe', () => {
  test('malicious state/resource cannot break out of the params block', () => {
    const malicious = "');alert(document.domain)//";
    const html = renderConsentPage({
      appId: APP,
      appName: 'Scriptorium',
      clientName: 'Claude',
      oauthParams: { redirect_uri: REDIRECT, state: malicious, resource: '</script><img>' },
    });
    // Params are embedded in a JSON script block, not an executable JS literal.
    expect(html).toMatch(/<script type="application\/json" id="oauth-params">/);
    const block = html.match(
      /<script type="application\/json" id="oauth-params">([\s\S]*?)<\/script>/
    )[1];
    // The only breakout risk in a <script type="application/json"> block is the
    // literal markup chars that could close the element or start a new one — all
    // '<'/'>' are escaped, so no raw angle brackets survive (quotes are harmless
    // data in this context, not a breakout vector).
    expect(block).not.toContain('<');
    expect(block).not.toContain('>');
    // And the data still round-trips intact (< etc. are valid JSON escapes).
    const parsed = JSON.parse(block);
    expect(parsed.state).toBe(malicious);
    expect(parsed.resource).toBe('</script><img>');
  });
});

describe('token — authorization_code grant', () => {
  test('wrong PKCE verifier → invalid_grant', async () => {
    const { authorize, token } = setup();
    const code = await getCode(authorize);
    const res = await exchange(token, code, { code_verifier: 'wrong' });
    expect(res.body.error).toBe('invalid_grant');
  });

  test('single-use: replay of consumed code → invalid_grant', async () => {
    const { authorize, token } = setup();
    const code = await getCode(authorize);
    await exchange(token, code); // first use
    const res = await exchange(token, code); // replay
    expect(res.body.error).toBe('invalid_grant');
  });

  test('expired code → invalid_grant', async () => {
    const { authorize, token, advance } = setup();
    const code = await getCode(authorize);
    advance(10 * 60 * 1000);
    const res = await exchange(token, code);
    expect(res.body.error).toBe('invalid_grant');
  });

  test('valid exchange returns access + refresh with canonical audience', async () => {
    const { authorize, token } = setup();
    const res = await exchange(token, await getCode(authorize));
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.get('Cache-Control')).toBe('no-store');
    const payload = verifyAccessToken(res.body.access_token, { audience: AUD });
    expect(payload.sub).toBe('uid-abc');
    expect([].concat(payload.aud)[0]).toBe(AUD);
    expect(payload.scope).toBe('mcp:scriptorium');
  });
});

describe('audience binding (RFC 8707)', () => {
  test('token is rejected for a different app audience', async () => {
    const { authorize, token } = setup();
    const res = await exchange(token, await getCode(authorize));
    expect(() =>
      verifyAccessToken(res.body.access_token, { audience: `${CANONICAL}/mcp/symposium` })
    ).toThrow();
  });

  test('verifyAccessToken throws when audience is omitted', async () => {
    const { authorize, token } = setup();
    const res = await exchange(token, await getCode(authorize));
    expect(() => verifyAccessToken(res.body.access_token)).toThrow(/audience/);
  });
});

describe('Host header cannot influence issued audience (#3)', () => {
  test('attacker Host does not change the token audience', async () => {
    const { authorize, token } = setup();
    const code = await getCode(authorize, {
      host: 'attacker.example',
      'x-forwarded-proto': 'https',
    });
    const res = await exchange(token, code);
    // Audience stays pinned to the canonical origin, not attacker.example.
    const payload = verifyAccessToken(res.body.access_token, { audience: AUD });
    expect([].concat(payload.aud)[0]).toBe(AUD);
  });
});

describe('token — refresh_token grant', () => {
  test('rotates the refresh token', async () => {
    const { authorize, token } = setup();
    const first = await exchange(token, await getCode(authorize));
    const res = await refresh(token, first.body.refresh_token);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.refresh_token).not.toBe(first.body.refresh_token);
  });

  test('reuse of a rotated token revokes the whole family (#4)', async () => {
    const { authorize, token } = setup();
    const first = await exchange(token, await getCode(authorize));
    const rt1 = first.body.refresh_token;
    const second = await refresh(token, rt1); // rotate → rt2 (live)
    const rt2 = second.body.refresh_token;

    const reuse = await refresh(token, rt1); // reuse rt1 → detected
    expect(reuse.body.error).toBe('invalid_grant');

    // The live successor rt2 must now also be dead.
    const afterReuse = await refresh(token, rt2);
    expect(afterReuse.body.error).toBe('invalid_grant');
  });

  test('re-checks entitlement and rejects after the app claim is revoked (#5)', async () => {
    const { authorize, token, entitlements } = setup();
    const first = await exchange(token, await getCode(authorize));

    // Admin removes the app from the user's claims.
    entitlements.set('uid-abc', ['symposium']);

    const res = await refresh(token, first.body.refresh_token);
    expect(res.body.error).toBe('invalid_grant');
  });
});

describe('token — misc', () => {
  test('unsupported grant_type rejected', async () => {
    const { token } = setup();
    const res = mockRes();
    await token({ method: 'POST', headers: HEADERS, body: { grant_type: 'password' } }, res);
    expect(res.body.error).toBe('unsupported_grant_type');
  });
});
