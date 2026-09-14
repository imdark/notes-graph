import { Service } from '@notesgraph/infra';

import {
  getPluginMarketplaceBaseUrl,
  marketplaceDownloadUrl,
  type MarketplaceEntry,
} from '../marketplace';
import type { PluginService } from './plugin';

/** Talks to the marketplace sidecar: browse the registry and install plugins. */
export class PluginMarketplaceService extends Service {
  constructor(private readonly pluginService: PluginService) {
    super();
  }

  async listAvailable(query?: string): Promise<MarketplaceEntry[]> {
    const url = new URL(`${getPluginMarketplaceBaseUrl()}/plugins`);
    if (query) url.searchParams.set('q', query);
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`marketplace request failed (${res.status})`);
    }
    const data = (await res.json()) as { plugins: MarketplaceEntry[] };
    return data.plugins;
  }

  async install(entry: MarketplaceEntry): Promise<void> {
    await this.pluginService.install(marketplaceDownloadUrl(entry));
  }
}
