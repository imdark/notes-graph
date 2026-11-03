// NotesGraph web app offline shell.
//
// The app's data layer is already offline-first (IndexedDB via
// @notesgraph/nbstore) — the gap this closes is the JS/CSS/font asset shell
// itself, which today has no offline fallback: a hard refresh (or first
// load) without network fails even though the data underneath is local.
//
// Strategy:
// - Install: fetch '/' itself and parse out its <script src> / <link
//   href=stylesheet> tags to build the precache list. NOTE: we deliberately
//   do NOT trust assets-manifest.json's own `js`/`css`/`publicPath` fields
//   for this — on the hosted SaaS those can point at a separate CDN origin
//   (prod.notesgraphassets.com) that this self-hosted deploy doesn't use,
//   while the actual rendered HTML loads everything root-relative from the
//   same origin. Parsing the live HTML precaches exactly what the page will
//   really request, whichever origin that turns out to be. We still read
//   assets-manifest.json for its `gitHash`, purely to version the cache name
//   so every deploy gets a fresh precache and old ones are swept on
//   activate.
// - Runtime: cache-first (falling back to network, and populating the
//   cache) for static-looking assets, same-origin or not — this also
//   opportunistically picks up lazy-loaded chunks (e.g. the AI bundle) the
//   precache list can't know about ahead of time.
// - Navigations: network-first so online users always get the current
//   server-rendered shell (mobile vs desktop variant, auth state, etc.);
//   offline falls back to the cached shell so deep links still load.
// - Backend API calls (/api/*, /graphql, /rpc, /info) are never cached —
//   those need live server state, and the app's own IndexedDB layer is what
//   makes local-doc editing work without them anyway. `/workspace/*` is NOT
//   in that denylist — see the note above NEVER_CACHE_PREFIXES.

const RUNTIME_CACHE = 'ng-app-runtime';

// NOTE: `/workspace/*` is deliberately NOT here — it looks like a backend API
// prefix (there's a DocRendererController mounted there) but it's actually
// the same URL space as the SPA's own doc routes (/workspace/<id>/<docId>),
// used to server-render per-doc <meta> tags for link previews/bots before
// falling through to the same app shell. Excluding it would silently drop
// offline-navigation-fallback handling for almost every real page in the app.
//
// `/market/` is the plugin market, a separate site on this origin: its files
// keep their names across deploys, so cache-first would keep serving the
// first version of them forever. It has its own HTTP caching.
const NEVER_CACHE_PREFIXES = ['/api/', '/graphql', '/rpc', '/info', '/market/'];

const STATIC_EXT_RE =
  /\.(js|css|woff2?|ttf|otf|wasm|png|jpe?g|svg|gif|webp|ico|json)$/i;

function isNeverCache(url) {
  return (
    url.origin === self.location.origin &&
    NEVER_CACHE_PREFIXES.some(prefix => url.pathname.startsWith(prefix))
  );
}

function isStaticAssetUrl(url) {
  if (isNeverCache(url)) return false;
  return STATIC_EXT_RE.test(url.pathname);
}

function extractAssetUrls(html, baseUrl) {
  const urls = new Set();
  const add = href => {
    try {
      urls.add(new URL(href, baseUrl).toString());
    } catch {
      // malformed/relative-scheme href — skip
    }
  };

  // `rel`/`href` attribute order in <link> tags isn't guaranteed (the actual
  // build output puts href first, rel second) — match link tags whole, then
  // check for rel="stylesheet" and pull href out of the same tag, instead of
  // requiring a fixed attribute order in one combined pattern.
  const scriptRe = /<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g;
  const linkRe = /<link\b[^>]*>/g;
  let m;
  while ((m = scriptRe.exec(html))) add(m[1]);
  while ((m = linkRe.exec(html))) {
    const tag = m[0];
    if (!/\brel="stylesheet"/.test(tag)) continue;
    const href = tag.match(/\bhref="([^"]+)"/);
    if (href) add(href[1]);
  }
  return [...urls];
}

// Re-fetched independently in both `install` and `activate` rather than
// cached in a module-level variable — the browser can (and does) terminate
// an idle service worker between lifecycle events and respawn it fresh for
// the next one, which would silently reset any in-memory state.
async function currentShellCacheName() {
  try {
    const res = await fetch('/assets-manifest.json', { cache: 'no-store' });
    if (res.ok) {
      const manifest = await res.json();
      if (manifest.gitHash) return `ng-app-shell-${manifest.gitHash}`;
    }
  } catch {
    // offline/unreachable — fall through to the unversioned name
  }
  return 'ng-app-shell-unversioned';
}

async function cacheUrl(cache, url, init) {
  try {
    const response = await fetch(url, init);
    // Cross-origin requests made with the default (cors) mode reject
    // outright if the target doesn't send CORS headers, so there's no
    // opaque-response case to special-case here — a failed cors fetch just
    // means that one asset doesn't get precached, not a broken install.
    if (response.ok) await cache.put(url, response);
  } catch {
    // best-effort — one missing asset shouldn't sink the whole precache
  }
}

async function precacheShell() {
  const shellCache = await currentShellCacheName();
  const cache = await caches.open(shellCache);

  const shellRes = await fetch('/', { cache: 'no-store' });
  const toCache = ['/manifest.json'];
  if (shellRes.ok) {
    const html = await shellRes.clone().text();
    toCache.push(...extractAssetUrls(html, shellRes.url));
    await cache.put('/', shellRes);
  }

  await Promise.all(toCache.map(url => cacheUrl(cache, url, { cache: 'no-store' })));
}

// A worker from before a prefix joined NEVER_CACHE_PREFIXES may have cached
// its files; this one would never read them, but drop them all the same.
async function dropNeverCacheEntries() {
  const cache = await caches.open(RUNTIME_CACHE);
  const requests = await cache.keys();
  await Promise.all(
    requests
      .filter(request => isNeverCache(new URL(request.url)))
      .map(request => cache.delete(request))
  );
}

self.addEventListener('install', event => {
  event.waitUntil(precacheShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    currentShellCacheName()
      .then(shellCache =>
        caches.keys().then(keys =>
          Promise.all(
            keys
              .filter(
                k =>
                  k !== RUNTIME_CACHE &&
                  k !== shellCache &&
                  k.startsWith('ng-app-shell-')
              )
              .map(k => caches.delete(k))
          )
        )
      )
      .then(dropNeverCacheEntries)
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    if (isNeverCache(url)) return; // let API/graphql calls hit the network untouched

    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request).catch(
          () =>
            caches.match(request).then(cached => cached || caches.match('/'))
          // ^ falls back to the versioned shell cache first (this exact SPA
          // route may have been cached from a prior online visit), then the
          // precached app-shell root.
        )
      );
      return;
    }
  }

  // Static-looking assets, same-origin or cross-origin (e.g. a CDN
  // publicPath on the hosted SaaS) — cache-first, populate on miss.
  if (isStaticAssetUrl(url)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
