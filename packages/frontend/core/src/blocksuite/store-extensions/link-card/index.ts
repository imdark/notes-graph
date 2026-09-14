import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/notesgraph/ext-loader';
import { EmbedIframeConfigExtension } from '@blocksuite/notesgraph/shared/services';

// NotesGraph's own domains should never be generically embedded.
const NOTESGRAPH_DOMAINS = [
  'app.notesgraph.pro',
  'insider.notesgraph.com',
  'canary.notesgraph.com',
  'toeverything.app',
  'apple.notesgraph.com',
];

function isHttpEmbeddable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:') return false;
    const hostname = u.hostname.toLowerCase();
    return !NOTESGRAPH_DOMAINS.some(
      domain => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

/**
 * blocksuite ships a generic embed-iframe config but it only allows `https:`
 * (in production NotesGraph is served over https and browsers block http iframes as
 * mixed content). This adds an `http:`-only generic config so plain-http URLs
 * (e.g. local/dev services) can also be embedded. Registered in the store scope
 * so `EmbedIframeService` (which reads `store.provider.getAll`) actually sees it.
 */
const httpGenericEmbedConfig = EmbedIframeConfigExtension({
  name: 'notesgraph-generic-http-iframe',
  match: (url: string) => isHttpEmbeddable(url),
  buildOEmbedUrl: (url: string) => (isHttpEmbeddable(url) ? url : undefined),
  useOEmbedUrlDirectly: true,
  validateIframeUrl: (iframeUrl: string) => isHttpEmbeddable(iframeUrl),
  options: {
    widthInSurface: 800,
    heightInSurface: 600,
    widthPercent: 100,
    heightInNote: 400,
    allowFullscreen: true,
    style: 'border: none; border-radius: 8px;',
    referrerpolicy: 'no-referrer-when-downgrade',
    sandbox: 'allow-scripts',
  },
});

export class LinkCardStoreExtension extends StoreExtensionProvider {
  override name = 'link-card-store-extension';

  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(httpGenericEmbedConfig);
  }
}
