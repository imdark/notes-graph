/**
 * Extract the current page's archivable content from the LIVE DOM. Injected as a
 * plain content script (defines a global `extractClip`) so it needs no imports
 * and no page CSP exceptions. Running inside the user's own authenticated tab is
 * the whole point: LinkedIn/Facebook content a server crawler can't see is fully
 * visible here.
 *
 * The DOM-reading logic mirrors the server-side, unit-tested extractor in
 * packages/common/link-card/src/archive.ts.
 */
function extractClip() {
  const MAX_IMAGES = 24;
  const MAX_VIDEOS = 8;
  const base = location.href;

  function absUrl(href) {
    if (!href) return null;
    const v = String(href).trim();
    if (!v || v.indexOf('data:') === 0 || v.indexOf('blob:') === 0) return null;
    try {
      const u = new URL(v, base);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function largestFromSrcset(srcset) {
    let best = null;
    let bestScore = -1;
    String(srcset)
      .split(',')
      .forEach(function (part) {
        const bits = part.trim().split(/\s+/);
        const score = bits[1] ? parseFloat(bits[1]) || 0 : 0;
        const abs = absUrl(bits[0]);
        if (abs && score >= bestScore) {
          best = abs;
          bestScore = score;
        }
      });
    return best;
  }

  function meta(sel) {
    const el = document.querySelector(sel);
    return el ? el.getAttribute('content') : null;
  }

  // ---- images ----
  const images = [];
  const seenImg = {};
  function pushImg(url) {
    if (url && !seenImg[url] && images.length < MAX_IMAGES) {
      seenImg[url] = 1;
      images.push(url);
    }
  }
  pushImg(absUrl(meta('meta[property="og:image"]')));
  pushImg(absUrl(meta('meta[property="og:image:secure_url"]')));
  pushImg(absUrl(meta('meta[name="twitter:image"]')));
  Array.prototype.forEach.call(
    document.querySelectorAll('img'),
    function (img) {
      const w = Number(img.getAttribute('width'));
      const h = Number(img.getAttribute('height'));
      if ((w > 0 && w <= 2) || (h > 0 && h <= 2)) return; // tracking pixel
      const srcset = img.getAttribute('srcset');
      pushImg(
        absUrl(
          img.getAttribute('src') || img.dataset.src || img.dataset.delayedUrl
        ) || (srcset ? largestFromSrcset(srcset) : null)
      );
    }
  );

  // ---- videos (direct sources only; blob:/MSE streams need the capture hook) ----
  const videos = [];
  const seenVid = {};
  function pushVid(url) {
    if (url && !seenVid[url] && videos.length < MAX_VIDEOS) {
      seenVid[url] = 1;
      videos.push(url);
    }
  }
  pushVid(
    absUrl(
      meta('meta[property="og:video:secure_url"]') ||
        meta('meta[property="og:video:url"]') ||
        meta('meta[property="og:video"]')
    )
  );
  pushVid(absUrl(meta('meta[name="twitter:player:stream"]')));
  let poster = null;
  Array.prototype.forEach.call(
    document.querySelectorAll('video'),
    function (v) {
      pushVid(absUrl(v.getAttribute('src')));
      if (!poster) poster = absUrl(v.getAttribute('poster'));
      Array.prototype.forEach.call(v.querySelectorAll('source'), function (s) {
        pushVid(absUrl(s.getAttribute('src')));
      });
    }
  );

  // ---- text ----
  const titleEl = document.querySelector('title');
  const title = (
    meta('meta[property="og:title"]') ||
    (titleEl && titleEl.textContent) ||
    document.title ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();

  const container =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.body;
  // innerText respects visibility (skips hidden scaffolding); textContent is a
  // safe fallback where innerText isn't implemented.
  const text = (
    (container && (container.innerText || container.textContent)) ||
    ''
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    title: title,
    url: base,
    siteName:
      meta('meta[property="og:site_name"]') ||
      location.hostname.replace(/^www\./, ''),
    text: text,
    images: images,
    videos: videos,
    poster: poster,
  };
}

// Usable both as an injected content-script global and as a CJS module in tests.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { extractClip: extractClip };
}
