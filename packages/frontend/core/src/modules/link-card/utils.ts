import type { ClipMode } from './types';

const DEFAULT_BASE_URL = 'http://localhost:8088';
const OVERRIDE_KEY = 'notesgraph:linkCardBaseUrl';

/**
 * Base URL of the link-card renderer.
 * Resolution order:
 *   1. `localStorage['notesgraph:linkCardBaseUrl']` override (any host);
 *   2. hosted web build → same origin, where the sidecar is reverse-proxied
 *      at `/clip/*` (so app.notesgraph.com talks to its own deployed sidecar);
 *   3. otherwise the local sidecar default (:8088) — used by local web dev and
 *      by desktop, which runs the renderer in-process.
 */
export function getLinkCardBaseUrl(): string {
  try {
    const override = globalThis.localStorage?.getItem(OVERRIDE_KEY);
    if (override) return override.replace(/\/+$/, '');
  } catch {
    // localStorage may be unavailable (e.g. workers) — fall through
  }
  try {
    // NOTE: never guard with `typeof BUILD_CONFIG !== 'undefined'` — the
    // bundler substitutes only member accesses like BUILD_CONFIG.isWeb, so
    // the bare `typeof BUILD_CONFIG` stays a RUNTIME check that is always
    // "undefined" in the browser and silently disables this whole branch
    // (that broke link cards on hosted web). The try/catch handles contexts
    // where the constant truly doesn't exist.
    const host = globalThis.location?.hostname;
    if (
      BUILD_CONFIG.isWeb &&
      host &&
      !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/.test(host)
    ) {
      return globalThis.location.origin;
    }
    // native mobile serves the app from https://localhost inside the WebView —
    // there is no local sidecar there, so use the deployed one
    if (BUILD_CONFIG.isAndroid || BUILD_CONFIG.isIOS) {
      return 'https://app.notesgraph.com';
    }
  } catch {
    // location/BUILD_CONFIG unavailable — fall through
  }
  return DEFAULT_BASE_URL;
}

export function linkCardPreviewEndpoint(): string {
  return `${getLinkCardBaseUrl()}/clip/preview`;
}

export function linkCardImageProxyEndpoint(): string {
  return `${getLinkCardBaseUrl()}/clip/image-proxy`;
}

export function linkCardImageUrl(url: string, mode: ClipMode): string {
  return `${getLinkCardBaseUrl()}/clip/image?url=${encodeURIComponent(url)}&mode=${mode}`;
}

export function linkCardEmbeddableEndpoint(url: string): string {
  return `${getLinkCardBaseUrl()}/clip/embeddable?url=${encodeURIComponent(url)}`;
}

/**
 * Raw-text fetch proxied through the sidecar (server-side, no CORS). Used by
 * crawlers to read cross-origin feeds (RSS/Atom/JSON) that send no CORS
 * headers, e.g. a YouTube channel's RSS.
 */
export function linkCardFetchEndpoint(url: string): string {
  return `${getLinkCardBaseUrl()}/clip/fetch?url=${encodeURIComponent(url)}`;
}

/**
 * Resolve a news article's preview image on the sidecar: it searches for the
 * headline + source, reads the resulting article's og:image, and caches the
 * result server-side (shared across clients). Used by the Discover feed, where
 * the aggregator (Google News) hides the real article URL.
 */
export function linkCardNewsImageEndpoint(
  title: string,
  source: string
): string {
  return `${getLinkCardBaseUrl()}/clip/news-image?title=${encodeURIComponent(
    title
  )}&source=${encodeURIComponent(source)}`;
}
