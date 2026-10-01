import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import test from 'ava';

import { extractImportMap } from '../import-map';

test('lifts the import map out of the web template', t => {
  // The real template, so a change to its import map is picked up here too.
  const template = readFileSync(
    join(env.projectRoot, '../../../tools/cli/src/rspack-shared/template.html'),
    'utf-8'
  );

  const map = extractImportMap(template);

  t.true(map.startsWith('<script type="importmap">'));
  t.true(map.endsWith('</script>'));
  const json = JSON.parse(
    map.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')
  );
  t.is(json.imports.react, '/plugin-runtime/react.js');
});

test('takes only the import map, not the scripts after it', t => {
  const html = `<head><script type="importmap">{"imports":{}}</script>
    <script src="/js/index.js"></script></head>`;

  t.is(
    extractImportMap(html),
    '<script type="importmap">{"imports":{}}</script>'
  );
});

test('is empty for HTML with no import map', t => {
  t.is(extractImportMap('<html><head></head></html>'), '');
});
