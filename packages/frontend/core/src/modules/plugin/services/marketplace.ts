import { Service } from '@notesgraph/infra';

import { type DefaultServerService, FetchService } from '../../cloud';
import {
  getPluginMarketplaceBaseUrl,
  marketplaceDownloadUrl,
  type MarketplaceEntry,
} from '../marketplace';
import type { PluginService } from './plugin';

/** Talks to the marketplace sidecar: browse the registry and install plugins. */
export class PluginMarketplaceService extends Service {
  constructor(
    private readonly pluginService: PluginService,
    private readonly defaultServerService: DefaultServerService
  ) {
    super();
  }

  /**
   * FetchService rather than a bare `fetch`: it resolves the relative base
   * against the configured server, applies the app's timeout, and keeps the
   * version header on the request.
   *
   * Note what is deliberately NOT here: `credentials: 'include'`. Reading the
   * registry is public, and the sidecar answers with `Access-Control-Allow-
   * Origin: *`, which a browser refuses to pair with credentialed requests —
   * sending them would break the desktop and mobile apps, which talk to the
   * server cross-origin. On the web app this is same-origin anyway, so the
   * session cookie rides along regardless.
   */
  private get fetchService(): FetchService {
    return this.defaultServerService.server.scope.get(FetchService);
  }

  private get serverBaseUrl(): string {
    return this.defaultServerService.server.serverMetadata.baseUrl;
  }

  async listAvailable(query?: string): Promise<MarketplaceEntry[]> {
    const base = getPluginMarketplaceBaseUrl();
    const path = query
      ? `${base}/plugins?q=${encodeURIComponent(query)}`
      : `${base}/plugins`;
    const res = await this.fetchService.fetchRaw(path, { cache: 'no-store' });
    if (!res.ok) {
      // A 401 means this deployment has chosen to gate reads as well; the
      // default prod config does not, so it is worth naming rather than
      // folding into a bare status code.
      throw new Error(
        res.status === 401
          ? 'This server requires you to be signed in to browse plugins.'
          : `Marketplace request failed (${res.status}).`
      );
    }
    const data = (await res.json()) as { plugins: MarketplaceEntry[] };
    return data.plugins;
  }

  async install(entry: MarketplaceEntry): Promise<void> {
    await this.pluginService.install(
      marketplaceDownloadUrl(entry, this.serverBaseUrl)
    );
  }
}
