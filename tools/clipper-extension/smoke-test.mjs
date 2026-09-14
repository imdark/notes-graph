/**
 * DOM smoke test for extract-clip.js (run: `node tools/clipper-extension/smoke-test.mjs`).
 * Confirms the extractor pulls the title + absolute, deduped images and skips
 * data:/tracking-pixel images, against a happy-dom document.
 */
import assert from 'node:assert';
import { createRequire } from 'node:module';

import { Window } from 'happy-dom';

const require = createRequire(import.meta.url);
const { extractClip } = require('./extract-clip.js');

const window = new Window({ url: 'https://www.linkedin.com/posts/example' });
const { document } = window;
document.documentElement.innerHTML = `<head>
    <title>fallback title</title>
    <meta property="og:title" content="A great LinkedIn post" />
    <meta property="og:image" content="/media/hero.jpg" />
  </head>
  <body><article>
    <img src="https://cdn.example.com/pic1.jpg" />
    <img src="/media/hero.jpg" />
    <img src="data:image/gif;base64,AAAA" />
    <img src="/px" width="1" height="1" />
    <p>${'word '.repeat(60)}</p>
  </article></body>`;

globalThis.document = document;
globalThis.location = window.location;

const clip = extractClip();

assert.strictEqual(clip.title, 'A great LinkedIn post', 'title from og:title');
assert.deepStrictEqual(
  clip.images,
  [
    'https://www.linkedin.com/media/hero.jpg', // og:image, absolutized
    'https://cdn.example.com/pic1.jpg',
  ],
  'images: og first, absolute, deduped, no data:/tracking-pixel'
);
assert.ok(clip.text.includes('word'), 'text extracted');
assert.strictEqual(clip.siteName, 'linkedin.com');

console.log('extract-clip smoke test: PASS', {
  title: clip.title,
  images: clip.images.length,
  textLen: clip.text.length,
});
