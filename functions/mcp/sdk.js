'use strict';

// Loads @modelcontextprotocol/sdk subpath modules. The SDK publishes a CommonJS
// build under its "require" export condition, so these CommonJS functions load
// it with require() — which also works under Jest, where the dynamic import()
// used by the 1a spike needs --experimental-vm-modules. Kept async so callers
// are unaffected if a future SDK drops the CommonJS build and this has to go
// back to import().
function loadSdk(subpath) {
  return Promise.resolve(require(`@modelcontextprotocol/sdk/${subpath}`));
}

module.exports = { loadSdk };
