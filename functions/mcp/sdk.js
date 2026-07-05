'use strict';

// The `@modelcontextprotocol/sdk` package is ESM-only, but these Cloud
// Functions run as CommonJS. Bridge the gap with dynamic import() and cache the
// resulting module namespace per subpath so the resolution cost is paid once
// per warm instance. This is the ESM/CJS friction the 1a transport spike exists
// to de-risk (design §7).
const cache = new Map();

function loadSdk(subpath) {
  if (!cache.has(subpath)) {
    cache.set(subpath, import(`@modelcontextprotocol/sdk/${subpath}`));
  }
  return cache.get(subpath);
}

module.exports = { loadSdk };
