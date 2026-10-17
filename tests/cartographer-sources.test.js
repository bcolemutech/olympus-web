'use strict';

/**
 * Where descriptions came from (planning/the-loom-layered-worlds.md §4.3;
 * L-321 / #390): the stamp the Cartographer loader gives what it imports.
 * Grading reads it (loom-grading tests); the MCP write tools stamp 'mcp'
 * (cartographer-mcp-write tests).
 *
 * Run: cd tests && npx jest cartographer-sources --verbose
 */

const { SOURCES, importStamp } = require('../functions/cartographer/sources');

test('the loader stamps only entities that have a description', () => {
  expect(importStamp({ description: 'x' })).toEqual({ description: SOURCES.IMPORT });
  expect(importStamp({ description: '' })).toEqual({ description: 'import' });
  expect(importStamp({ name: 'Region' })).toBeNull();
});
