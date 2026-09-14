/**
 * Registers the offline app-shell service worker (see
 * `packages/frontend/core/public/sw.js`). Only meaningful for the actual
 * browser-hosted web app (desktop + mobile web) — Electron and the native
 * iOS/Android shells load the app from local files and have their own
 * offline story, so this is called explicitly from those two entry points
 * rather than from the shared `bootstrap/browser` side-effect chain that
 * native/admin builds also pull in.
 */
export function registerServiceWorker(): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }
  // Never against the dev server: the shell cache serves stale bundles
  // cache-first while live-reload keeps detecting a mismatch and
  // reloading — an endless refresh loop. Also proactively unregister any
  // worker left over from a previous production-build visit on this origin.
  if (BUILD_CONFIG.debug) {
    navigator.serviceWorker
      .getRegistrations()
      .then(registrations => registrations.forEach(r => void r.unregister()))
      .catch(() => {});
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('[sw] registration failed:', err);
    });
  });
}
