'use strict';

/**
 * Drift tests for Void Odyssey constants that exist in two places:
 *
 *   • Frontend source of truth: public/apps/void-odyssey/journeys.js
 *       (attached to window.VoidOdyssey.JOURNEYS via an IIFE)
 *   • Backend source of truth: functions/index.js
 *       (VOID_ODYSSEY_SHIPS_COMPANY_ROLE_IDS and VOID_ODYSSEY_JOURNEY_SHIPS)
 *
 * The frontend is a zero-build-step static bundle (no shared module system
 * with the Cloud Functions backend), so we load the frontend file in a VM
 * sandbox with a fake `window` global, then compare the resulting data
 * structures against the backend constants. This catches drift before it
 * reaches production as a confusing "invalid-argument" error for a selection
 * the UI legitimately allowed.
 *
 * Run: cd tests && npx jest void-odyssey-constants --verbose
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.resolve(__dirname, '..');
const JOURNEYS_FILE = path.join(REPO_ROOT, 'public', 'apps', 'void-odyssey', 'journeys.js');
const FUNCTIONS_FILE = path.join(REPO_ROOT, 'functions', 'index.js');

// ── Load frontend VO.JOURNEYS by executing journeys.js in a VM sandbox ─────

function loadFrontendJourneys() {
  const source = fs.readFileSync(JOURNEYS_FILE, 'utf8');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'journeys.js' });
  const journeys = sandbox.window.VoidOdyssey && sandbox.window.VoidOdyssey.JOURNEYS;
  if (!journeys) {
    throw new Error('Failed to load VO.JOURNEYS from journeys.js');
  }
  return journeys;
}

// ── Extract a named JS constant from functions/index.js by textual parse ──
//
// We deliberately avoid `require('../functions')` because functions/index.js
// pulls in firebase-admin, vertexai, etc. at load time. A lightweight regex
// extract of the constant declaration lets us assert drift without that cost.

function extractConstant(source, name) {
  // Match `const NAME = { ... };` or `const NAME = [ ... ];` at top level.
  // We rely on the convention that these constants live at column 0 and are
  // closed by a line that is exactly `};` or `];`.
  const startRe = new RegExp('^const ' + name + '\\s*=\\s*([\\[\\{])', 'm');
  const startMatch = startRe.exec(source);
  if (!startMatch) {
    throw new Error('Could not locate constant ' + name + ' in ' + FUNCTIONS_FILE);
  }
  const openChar = startMatch[1];
  const closeChar = openChar === '[' ? ']' : '}';
  const startIdx = startMatch.index + startMatch[0].length - 1;
  let depth = 0;
  let i = startIdx;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error('Unbalanced braces for constant ' + name);
  }
  const literal = source.slice(startIdx, i + 1);
  // Evaluate the literal in a sandbox — it's pure JSON-ish data with string
  // keys and array/object values, no code execution.
  return vm.runInNewContext('(' + literal + ')');
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('Void Odyssey frontend/backend constant drift', () => {
  let frontendJourneys;
  let functionsSource;

  beforeAll(() => {
    frontendJourneys = loadFrontendJourneys();
    functionsSource = fs.readFileSync(FUNCTIONS_FILE, 'utf8');
  });

  test("VOID_ODYSSEY_SHIPS_COMPANY_ROLE_IDS matches journey ships_company roleOptions", () => {
    const backendRoleIds = extractConstant(
      functionsSource,
      'VOID_ODYSSEY_SHIPS_COMPANY_ROLE_IDS'
    );
    const frontendRoleIds = (frontendJourneys.ships_company.roleOptions || []).map((r) => r.id);

    expect(Array.isArray(backendRoleIds)).toBe(true);
    expect([...backendRoleIds].sort()).toEqual([...frontendRoleIds].sort());
  });

  test('VOID_ODYSSEY_JOURNEY_SHIPS matches every journey.availableShips in journeys.js', () => {
    const backendJourneyShips = extractConstant(functionsSource, 'VOID_ODYSSEY_JOURNEY_SHIPS');

    // Every restricted journey in the backend must match the frontend list exactly.
    Object.keys(backendJourneyShips).forEach((journeyId) => {
      const frontendJourney = frontendJourneys[journeyId];
      expect(frontendJourney).toBeDefined();
      expect([...backendJourneyShips[journeyId]].sort()).toEqual(
        [...(frontendJourney.availableShips || [])].sort()
      );
    });

    // Every frontend journey (except `custom`, which is intentionally excluded
    // from the backend allowlist because it is not selectable in Step 1) must
    // have a corresponding backend entry.
    Object.keys(frontendJourneys).forEach((journeyId) => {
      if (journeyId === 'custom') return;
      expect(backendJourneyShips[journeyId]).toBeDefined();
    });
  });
});
