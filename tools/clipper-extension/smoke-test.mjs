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

// ---- video-source.js: the page's own video files ----
const { findVideoSources } = require('./video-source.js');

function withPage(url, html, fn) {
  const w = new Window({ url });
  w.document.documentElement.innerHTML = html;
  globalThis.document = w.document;
  globalThis.location = w.location;
  globalThis.window = w;
  return fn();
}

// LinkedIn: data-sources on the player, highest resolution first.
const li = withPage(
  'https://www.linkedin.com/posts/someone_activity-1',
  `<body><div data-sources='[{"src":"https://dms.licdn.com/playlist/vid/v2/A/mp4-360p-30fp-crf28/B/0?e=1&t=x","type":"video/mp4"},{"src":"https://dms.licdn.com/playlist/vid/v2/A/mp4-720p-30fp-crf28/B/0?e=1&t=y","type":"video/mp4"}]'><video src="blob:https://www.linkedin.com/abc"></video></div></body>`,
  findVideoSources
);
assert.strictEqual(li.length, 2, 'linkedin: both data-sources, no blob:');
assert.strictEqual(li[0].height, 720, 'linkedin: 720p first');
assert.ok(li[0].url.includes('t=y'));

// LinkedIn: JSON-escaped progressive link in a <code> data block.
const liCode = withPage(
  'https://www.linkedin.com/feed/update/urn:li:activity:1/',
  `<body><code>{"progressiveStreams":[{"streamingLocations":[{"url":"https:\\/\\/dms.licdn.com\\/playlist\\/vid\\/v2\\/C\\/mp4-640p-30fp-crf28\\/D\\/0?e=2\\u0026v=beta\\u0026t=z"}]}],"thumbnail":"https:\\/\\/dms.licdn.com\\/playlist\\/vid\\/v2\\/C\\/thumbnail-with-play-button-overlay-high\\/0?e=2"}</code></body>`,
  findVideoSources
);
assert.deepStrictEqual(
  liCode.map(s => s.url),
  [
    'https://dms.licdn.com/playlist/vid/v2/C/mp4-640p-30fp-crf28/D/0?e=2&v=beta&t=z',
  ],
  'linkedin: unescaped progressive link, thumbnail skipped'
);

// Facebook: the video in the address bar, not the suggestion; HD first.
const fb = withPage(
  'https://www.facebook.com/someone/videos/1234567890/',
  `<body><script type="application/json">{"suggested":{"id":"999999999","playable_url":"https:\\/\\/video.xx.fbcdn.net\\/other.mp4?x=1"}${' '.repeat(30000)}{"id":"1234567890","playable_url":"https:\\/\\/video.xx.fbcdn.net\\/sd.mp4?a=1\\u00262","playable_url_quality_hd":"https:\\/\\/video.xx.fbcdn.net\\/hd.mp4?a=1"}}</script></body>`,
  findVideoSources
);
assert.deepStrictEqual(
  fb.map(s => s.url),
  [
    'https://video.xx.fbcdn.net/hd.mp4?a=1',
    'https://video.xx.fbcdn.net/sd.mp4?a=1&2',
  ],
  'facebook: this video only, hd then sd'
);

// A stream-only page has nothing to download.
const none = withPage(
  'https://www.linkedin.com/posts/x',
  '<body><video src="blob:https://www.linkedin.com/1"></video><video src="https://x.test/a.m3u8"></video></body>',
  findVideoSources
);
assert.deepStrictEqual(none, [], 'no files: blob: and manifests skipped');

console.log('video-source smoke test: PASS', {
  linkedin: li.length,
  facebook: fb.length,
});
