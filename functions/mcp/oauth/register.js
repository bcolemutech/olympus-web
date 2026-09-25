'use strict';

const { oauthError, rateLimited } = require('./respond');
const { generateClientId } = require('./tokens');
const { UNUSED_CLIENT_TTL_SECONDS } = require('./config');
const { noopAuditLog } = require('../audit');
const { unlimited, clientIp } = require('../rate-limit');

// Dynamic Client Registration (RFC 7591), phase 1d. This is what lets a
// connector be added on iOS / claude.ai by pasting a URL: the client registers
// itself here, gets a client_id, and proceeds straight to /authorize with no
// manual pre-configuration (design §6 step 3).
//
// Policy (design §10):
//   - Public clients only. PKCE S256 is mandatory at /authorize, so no client
//     secret is ever issued; token_endpoint_auth_method must be "none".
//   - redirect_uris must be https, or http on a loopback host for native/CLI
//     clients (RFC 8252 §7.3). Custom URI schemes are rejected for now — none of
//     the target clients need them, and they widen the redirect attack surface.
//   - /authorize matches redirect_uri exactly against what is registered here.
//   - Only the metadata below is stored; unrecognized fields are ignored
//     (RFC 7591 §2) so a registration cannot park arbitrary data in Firestore.
//   - client_name is self-asserted by the client, so the consent page also
//     shows the redirect host the user will be sent back to.

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2048;
const MAX_CLIENT_NAME_LENGTH = 100;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Every registered client may use both grants: /token always issues a refresh
// token alongside the access token. A client that asks for a subset is
// registered for both, and the response reports the values actually registered
// (RFC 7591 §3.2.1 allows the server to replace requested metadata).
const REGISTERED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
const REGISTERED_RESPONSE_TYPES = ['code'];

class RegistrationError extends Error {
  constructor(error, description) {
    super(description);
    this.error = error;
  }
}

function invalidMetadata(description) {
  return new RegistrationError('invalid_client_metadata', description);
}

// Returns an error message for a single redirect URI, or null if it is valid.
function redirectUriProblem(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) {
    return `must be a non-empty string of at most ${MAX_URI_LENGTH} characters`;
  }
  if (uri.includes('#')) return 'must not contain a fragment';
  let url;
  try {
    url = new URL(uri);
  } catch {
    return 'must be an absolute URL';
  }
  if (url.username || url.password) return 'must not contain credentials';
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return null;
  return 'must use https (http is allowed only for localhost / loopback addresses)';
}

function validateRedirectUris(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RegistrationError('invalid_redirect_uri', 'redirect_uris must be a non-empty array.');
  }
  if (value.length > MAX_REDIRECT_URIS) {
    throw new RegistrationError(
      'invalid_redirect_uri',
      `At most ${MAX_REDIRECT_URIS} redirect_uris may be registered.`
    );
  }
  for (const uri of value) {
    const problem = redirectUriProblem(uri);
    if (problem) {
      throw new RegistrationError('invalid_redirect_uri', `redirect_uri ${problem}.`);
    }
  }
  return [...new Set(value)];
}

function validateClientName(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidMetadata('client_name must be a string.');
  const name = value.trim();
  if (name === '') return undefined;
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    throw invalidMetadata(`client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters.`);
  }

  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw invalidMetadata('client_name must not contain control characters.');
  }
  return name;
}

function validateAuthMethod(value) {
  // RFC 7591's default is client_secret_basic, but this server only has public
  // clients, so an omitted value is registered as "none" and reported back.
  if (value === undefined || value === 'none') return 'none';
  throw invalidMetadata('Only public clients are supported (token_endpoint_auth_method "none").');
}

function validateGrantTypes(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw invalidMetadata('grant_types must be a non-empty array.');
  }
  const unsupported = value.filter((g) => !REGISTERED_GRANT_TYPES.includes(g));
  if (unsupported.length) {
    throw invalidMetadata(`Unsupported grant_types: ${unsupported.join(', ')}.`);
  }
  if (!value.includes('authorization_code')) {
    throw invalidMetadata('grant_types must include authorization_code.');
  }
}

function validateResponseTypes(value) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0 || value.some((t) => t !== 'code')) {
    throw invalidMetadata('Only the "code" response type is supported.');
  }
}

// Validates a registration request body and returns the metadata to register.
// Throws RegistrationError (with an RFC 7591 §3.2.2 error code) on bad input.
function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidMetadata('The registration request must be a JSON object.');
  }
  const redirectUris = validateRedirectUris(body.redirect_uris);
  const tokenEndpointAuthMethod = validateAuthMethod(body.token_endpoint_auth_method);
  validateGrantTypes(body.grant_types);
  validateResponseTypes(body.response_types);
  const clientName = validateClientName(body.client_name);

  return {
    redirectUris,
    tokenEndpointAuthMethod,
    grantTypes: [...REGISTERED_GRANT_TYPES],
    responseTypes: [...REGISTERED_RESPONSE_TYPES],
    ...(clientName ? { clientName } : {}),
  };
}

function createRegisterHandler(deps) {
  const { store, audit = noopAuditLog, rateLimiter = unlimited, now = () => Date.now() } = deps;

  return async function handleRegister(req, res) {
    if (req.method !== 'POST') {
      return oauthError(res, 'invalid_request', 'The registration endpoint requires POST.', 405);
    }

    // Per-IP budget, plus a global one that also binds a client spreading
    // its registrations across forged addresses.
    for (const [bucket, key] of [
      ['register_ip', clientIp(req)],
      ['register_global', 'all'],
    ]) {
      const limit = await rateLimiter.consume(bucket, key);
      if (!limit.allowed) {
        await audit.record('rate_limited', { bucket });
        return rateLimited(res, limit.retryAfterSec);
      }
    }

    let metadata;
    try {
      metadata = validateRegistration(req.body);
    } catch (err) {
      if (err instanceof RegistrationError) return oauthError(res, err.error, err.message);
      throw err;
    }

    const nowMs = now();
    const clientId = generateClientId();
    // Unused registrations expire (TTL); obtaining tokens extends the client.
    await store.putClient({
      clientId,
      ...metadata,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + UNUSED_CLIENT_TTL_SECONDS * 1000,
    });
    await audit.record('client_registered', { clientId });

    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    res.status(201).json({
      client_id: clientId,
      client_id_issued_at: Math.floor(nowMs / 1000),
      redirect_uris: metadata.redirectUris,
      token_endpoint_auth_method: metadata.tokenEndpointAuthMethod,
      grant_types: metadata.grantTypes,
      response_types: metadata.responseTypes,
      ...(metadata.clientName ? { client_name: metadata.clientName } : {}),
    });
  };
}

module.exports = { createRegisterHandler, validateRegistration, RegistrationError };
