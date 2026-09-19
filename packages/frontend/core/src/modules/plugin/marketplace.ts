/**
 * Where the marketplace sidecar lives.
 *
 * In production it is not a separate host: Caddy fronts it at `/market/*` on
 * the app's own origin. Reading the registry and downloading a plugin are
 * public; publishing, curation and the FaaS route are gated by `forward_auth`
 * to `/api/auth/check`, because the sidecar has no authentication of its own.
 *
 * Reads stay public on purpose. Plugin code is loaded with a dynamic
 * `import()`, which cannot carry an Authorization header and sends cookies
 * only same-origin — so an auth gate on the download path would lock out the
 * desktop and mobile apps, which talk to the server cross-origin with a JWT.
 *
 * In a dev build it is the local sidecar `yarn dev` starts on :8099.
 */
const DEV_MARKETPLACE_URL = 'http://localhost:8099';
const MARKETPLACE_PATH = '/market';
const OVERRIDE_KEY = 'notesgraph:pluginMarketplaceBaseUrl';

/**
 * Base URL of the marketplace, relative to the server origin unless a dev
 * build or an explicit override says otherwise. Relative is the useful default:
 * FetchService resolves it against the configured server, so a self-hosted
 * instance gets its own registry with no configuration.
 */
export function getPluginMarketplaceBaseUrl(): string {
  try {
    const override = globalThis.localStorage?.getItem(OVERRIDE_KEY);
    if (override) return override.replace(/\/+$/, '');
  } catch {
    // localStorage may be unavailable — fall through
  }
  return BUILD_CONFIG.debug ? DEV_MARKETPLACE_URL : MARKETPLACE_PATH;
}

/**
 * The same base, made absolute against `serverBaseUrl`.
 *
 * Plugin code is loaded with `import()`, which needs a fully-qualified URL —
 * a relative one would resolve against the page, not the configured server.
 */
export function absolutePluginMarketplaceBaseUrl(serverBaseUrl: string): string {
  const base = getPluginMarketplaceBaseUrl();
  return new URL(base, serverBaseUrl).toString().replace(/\/+$/, '');
}

export interface MarketplaceEntry {
  id: string;
  version: string;
  name: string;
  description?: string;
  author?: string;
  platforms: string[];
  permissions: string[];
  hasServer: boolean;
  /** Relative download base, e.g. `/download/:id/:version`. */
  downloadUrl: string;
}

/** Absolute base URL the client loads a marketplace plugin from. */
export function marketplaceDownloadUrl(
  entry: MarketplaceEntry,
  serverBaseUrl: string
): string {
  return `${absolutePluginMarketplaceBaseUrl(serverBaseUrl)}${entry.downloadUrl}`;
}
