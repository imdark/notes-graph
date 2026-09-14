// NotesGraph landing service worker — makes notesgraph.com (home + download)
// load offline. Strategy: cache-first for same-origin GETs, with a network
// fallback that refreshes the cache; navigations fall back to the cached
// index when offline. Bump CACHE to invalidate on a redesign.
//
// v3: never cache redirected responses. '/download' is a 308 to '/download/';
// caching the followed (redirected:true) response and replaying it for a
// navigation makes the browser reject the load — users saw a "not found"
// error page on notesgraph.com/download. The version bump purges caches
// poisoned by v1/v2.
const CACHE = 'ng-landing-v3';
const CORE = [
  '/',
  '/index.html',
  '/download/',
  '/download/index.html',
  '/manifest.json',
  '/icons/favicon-36.png',
  '/icons/favicon-48.png',
  '/icons/favicon-72.png',
  '/icons/favicon-96.png',
  '/icons/favicon-144.png',
  '/icons/favicon-192.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.ico',
];

// A `redirected` response is rejected by the browser when replayed for a
// navigation — rebuild it so the cache only ever holds direct responses.
function cleanCopy(response) {
  if (!response.redirected) return Promise.resolve(response);
  return response.blob().then(
    body =>
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
  );
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then(cache => cache.addAll(CORE).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(CACHE)
              .then(cache =>
                cleanCopy(copy).then(clean => cache.put(request, clean))
              )
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() => {
          // Offline: for page navigations, fall back to the cached landing.
          if (request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return cached;
        });
      // A redirected entry left over from an older worker would be rejected
      // by the browser — ignore it and let the network answer.
      if (cached && cached.redirected) {
        return network;
      }
      // Serve cache immediately when present; otherwise wait for the network.
      return cached || network;
    })
  );
});
