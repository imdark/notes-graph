import { Service } from '@notesgraph/infra';

import type { ClipMode } from '../types';
import {
  getLinkCardBaseUrl,
  linkCardImageProxyEndpoint,
  linkCardImageUrl,
  linkCardPreviewEndpoint,
} from '../utils';

/**
 * Resolves where the link-card renderer lives. On the web that's a local
 * sidecar (`@notesgraph/link-card-server`, default :8088, overridable via
 * `localStorage['notesgraph:linkCardBaseUrl']`). On desktop the Electron main
 * process renders in-process.
 */
export class LinkCardService extends Service {
  get baseUrl(): string {
    return getLinkCardBaseUrl();
  }

  get previewEndpoint(): string {
    return linkCardPreviewEndpoint();
  }

  get imageProxyEndpoint(): string {
    return linkCardImageProxyEndpoint();
  }

  imageUrl(url: string, mode: ClipMode): string {
    return linkCardImageUrl(url, mode);
  }
}
