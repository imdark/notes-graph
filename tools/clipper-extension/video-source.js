/**
 * Find the downloadable MP4 files behind the page's video, from what the page
 * itself gives the browser to play. Injected as a plain content script
 * (defines a global `findVideoSources`), like extract-clip.js.
 *
 * - LinkedIn: <video data-sources='[{"src": …mp4}]'> and the
 *   dms.licdn.com/playlist/vid/… progressive-stream links in the page's data.
 * - Facebook: the progressive "playable_url(_quality_hd)" /
 *   "browser_native_(hd|sd)_url" fields in the page's data, preferring the
 *   ones next to the video id in the address bar.
 * - Anywhere: a <video src> (or <source>) that is a plain http(s) file.
 *
 * These are whole files with audio. When a page has none (a stream-only
 * video), the clipper falls back to mse-hook.js's recording of the playback.
 *
 * Returns [{ url, height, site }] best first. `height` is 0 when unknown.
 */
function findVideoSources() {
  const MAX_SOURCES = 6;
  const out = [];
  const seen = {};

  function abs(url) {
    if (!url) return null;
    try {
      const u = new URL(String(url).trim(), location.href);
      return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
    } catch {
      return null;
    }
  }

  function push(url, height, site, rank) {
    const u = abs(url);
    if (!u || seen[u]) return;
    seen[u] = 1;
    out.push({ url: u, height: height || 0, site: site, rank: rank });
  }

  function heightFromUrl(url) {
    const m = /(\d{3,4})p\b/.exec(url);
    return m ? Number(m[1]) : 0;
  }

  // Playing first, then on screen, then the rest: a feed has many videos.
  function videoOrder(v) {
    if (!v.paused && !v.ended && v.currentTime > 0) return 0;
    const r = v.getBoundingClientRect ? v.getBoundingClientRect() : null;
    const vh = window.innerHeight || 0;
    if (r && r.bottom > 0 && r.top < vh && r.width > 0) return 1;
    return 2;
  }

  const host = location.hostname;
  const isLinkedIn = /(^|\.)linkedin\.com$/.test(host);
  const isFacebook = /(^|\.)(facebook\.com|fb\.watch)$/.test(host);

  // ---- <video> elements: data-sources (LinkedIn) and plain file src ----
  const videos = Array.prototype.slice.call(document.querySelectorAll('video'));
  videos
    .map(function (v) {
      return { v: v, order: videoOrder(v) };
    })
    .sort(function (a, b) {
      return a.order - b.order;
    })
    .forEach(function (entry) {
      const v = entry.v;
      // LinkedIn puts the sources on the video or a wrapper around it.
      let holder = v;
      for (let i = 0; holder && i < 4; i++) {
        if (holder.getAttribute && holder.getAttribute('data-sources')) break;
        holder = holder.parentElement;
      }
      const raw =
        holder && holder.getAttribute && holder.getAttribute('data-sources');
      if (raw) {
        try {
          const list = JSON.parse(raw);
          list
            .filter(function (s) {
              return s && s.src && (!s.type || /mp4/i.test(s.type));
            })
            .forEach(function (s) {
              push(s.src, heightFromUrl(s.src), 'linkedin', entry.order);
            });
        } catch {
          /* not JSON: ignore */
        }
      }
      const srcs = [v.getAttribute('src'), v.currentSrc];
      Array.prototype.forEach.call(v.querySelectorAll('source'), function (s) {
        srcs.push(s.getAttribute('src'));
      });
      srcs.forEach(function (s) {
        // blob: is a stream (MSE), not a file; .m3u8/.mpd are manifests.
        if (!s || /^blob:/.test(s) || /\.(m3u8|mpd)(\?|$)/i.test(s)) return;
        push(s, heightFromUrl(s), 'page', 10 + entry.order);
      });
    });

  // ---- the page's embedded data (scripts and LinkedIn's <code> blocks) ----
  let data = '';
  if (isLinkedIn || isFacebook) {
    Array.prototype.forEach.call(
      document.querySelectorAll('script, code'),
      function (el) {
        const t = el.textContent || '';
        if (t.length > 20) data += t + '\n';
      }
    );
  }

  if (isLinkedIn && data) {
    // Plain or JSON-escaped (https:\/\/dms.licdn.com\/…&…).
    const re = /https:(?:\\?\/){2}dms\.licdn\.com[^"'\s<>]+/g;
    let m;
    while ((m = re.exec(data))) {
      const url = m[0]
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/&amp;/g, '&');
      if (url.indexOf('/playlist/vid/') === -1) continue;
      // Skip thumbnails/captions that live under the same path.
      if (/thumbnail|captions|\.vtt|\.jpg|\.png/i.test(url)) continue;
      push(url, heightFromUrl(url), 'linkedin', 20);
    }
  }

  if (isFacebook && data) {
    // The video id in the address bar: /videos/<id>, /reel/<id>, ?v=<id>.
    const idMatch =
      /\/(?:videos|reel|watch\/live)\/(?:[^/]+\/)?(\d{6,})/.exec(
        location.pathname
      ) || /[?&]v=(\d{6,})/.exec(location.search);
    const id = idMatch ? idMatch[1] : null;
    const idPositions = [];
    if (id) {
      const needle = '"' + id + '"';
      let p = data.indexOf(needle);
      while (p !== -1 && idPositions.length < 200) {
        idPositions.push(p);
        p = data.indexOf(needle, p + 1);
      }
    }
    const distance = function (pos) {
      let best = Infinity;
      for (let i = 0; i < idPositions.length; i++) {
        const d = Math.abs(idPositions[i] - pos);
        if (d < best) best = d;
      }
      return best;
    };
    const re =
      /"(playable_url_quality_hd|browser_native_hd_url|playable_url|browser_native_sd_url)":"(https:[^"]+)"/g;
    const found = [];
    let m;
    while ((m = re.exec(data))) {
      let url;
      try {
        url = JSON.parse('"' + m[2] + '"');
      } catch {
        continue;
      }
      const hd = /hd/.test(m[1]);
      found.push({ url: url, hd: hd, near: distance(m.index) });
    }
    // Nearest to this video's id first (a page also carries suggestions),
    // HD before SD at the same place.
    found
      .filter(function (f) {
        return !id || f.near < 20000;
      })
      .sort(function (a, b) {
        const da = Math.floor(a.near / 2000);
        const db = Math.floor(b.near / 2000);
        if (da !== db) return da - db;
        return (b.hd ? 1 : 0) - (a.hd ? 1 : 0);
      })
      .forEach(function (f, i) {
        push(f.url, f.hd ? 720 : 360, 'facebook', 20 + i);
      });
  }

  // Lower rank first; within a rank, the higher resolution first (but no
  // more than 1080p, to keep the file within the clip's size cap).
  out.sort(function (a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const ha = a.height > 1080 ? 0 : a.height;
    const hb = b.height > 1080 ? 0 : b.height;
    return hb - ha;
  });
  return out.slice(0, MAX_SOURCES).map(function (s) {
    return { url: s.url, height: s.height, site: s.site };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { findVideoSources: findVideoSources };
}
