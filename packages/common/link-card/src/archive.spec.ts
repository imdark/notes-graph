import { describe, expect, test } from 'vitest';

import { extractArchive, isArchivableSocialUrl } from './archive';

describe('isArchivableSocialUrl', () => {
  test('matches LinkedIn + Facebook hosts (incl. shorteners/subdomains)', () => {
    for (const u of [
      'https://www.linkedin.com/posts/foo',
      'https://lnkd.in/abc',
      'https://facebook.com/x/videos/123',
      'https://m.facebook.com/x',
      'https://fb.watch/xyz',
    ]) {
      expect(isArchivableSocialUrl(u)).toBe(true);
    }
  });

  test('does not match unrelated hosts or a lookalike', () => {
    expect(isArchivableSocialUrl('https://example.com')).toBe(false);
    expect(isArchivableSocialUrl('https://notlinkedin.com')).toBe(false);
    expect(isArchivableSocialUrl('not a url')).toBe(false);
  });
});

describe('extractArchive', () => {
  const base = 'https://www.linkedin.com/posts/example';

  test('pulls og image + title first, then in-page images, deduped + absolute', () => {
    const html = `<html><head>
      <meta property="og:title" content="A great post">
      <meta property="og:image" content="/media/hero.jpg">
      <meta name="twitter:image" content="https://cdn.example.com/hero.jpg">
    </head><body>
      <img src="/media/hero.jpg"><!-- dup of og:image -->
      <img data-src="https://cdn.example.com/pic2.jpg">
      <img src="data:image/gif;base64,AAAA"><!-- data: ignored -->
      <img src="/px" width="1" height="1"><!-- tracking pixel ignored -->
      <p>${'word '.repeat(60)}</p>
    </body></html>`;
    const a = extractArchive(html, base);
    expect(a.title).toBe('A great post');
    expect(a.images).toEqual([
      'https://www.linkedin.com/media/hero.jpg',
      'https://cdn.example.com/hero.jpg',
      'https://cdn.example.com/pic2.jpg',
    ]);
    expect(a.text.length).toBeGreaterThan(200);
  });

  test('collects direct video + source urls and og:video, skips blob:', () => {
    const html = `<html><head>
      <meta property="og:video:url" content="https://cdn.example.com/clip.mp4">
    </head><body>
      <video src="blob:https://facebook.com/abc"></video>
      <video><source src="/v/segment.mp4"><source src="blob:xyz"></video>
    </body></html>`;
    const a = extractArchive(html, 'https://facebook.com/watch');
    expect(a.videos).toContain('https://cdn.example.com/clip.mp4');
    expect(a.videos).toContain('https://facebook.com/v/segment.mp4');
    expect(a.videos.some(v => v.startsWith('blob:'))).toBe(false);
  });

  test('picks the largest srcset candidate when no src', () => {
    const html = `<body><img srcset="/s.jpg 320w, /m.jpg 640w, /l.jpg 1200w"></body>`;
    const a = extractArchive(html, base);
    expect(a.images[0]).toBe('https://www.linkedin.com/l.jpg');
  });

  test('falls back to body text when there is no article', () => {
    const html = `<body><div>${'hello world '.repeat(30)}</div></body>`;
    const a = extractArchive(html, base);
    expect(a.text).toContain('hello world');
  });
});
