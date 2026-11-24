'use strict';

/**
 * The Muse's plain-data helpers are the page's and the server's (M-106 /
 * #894): fields.js, links.js and model.js live in public/apps/muse/js/ and in
 * functions/muse/, where the connector does the page's own plans, with
 * identical bytes, since functions/ deploys on its own. Edit both.
 *
 * Run: cd tests && npx jest muse-shared --verbose
 */

const fs = require('fs');
const path = require('path');

const FILES = ['fields.js', 'links.js', 'model.js', 'versions.js', 'classes.js'];

describe("the page's and the server's copies", () => {
  test.each(FILES)('%s is identical, byte for byte', (file) => {
    const served = fs.readFileSync(path.join(__dirname, '../public/apps/muse/js', file), 'utf8');
    const server = fs.readFileSync(path.join(__dirname, '../functions/muse', file), 'utf8');
    expect(server).toBe(served);
  });

  test('the server’s model reads its own fields and links', () => {
    const model = require('../functions/muse/model');
    const checked = model.checkElement(
      'character',
      { name: 'Peter', bio: '[Sea](muse:el/el_sea)' },
      { defs: [] }
    );
    expect(checked.value.mentions).toEqual(['el_sea']);
  });
});
