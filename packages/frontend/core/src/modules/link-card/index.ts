import { type Framework } from '@notesgraph/infra';

import { LinkCardService } from './services/link-card';

export { LinkCardService };
export type { ClipMode, LinkCardMode } from './types';
export {
  getLinkCardBaseUrl,
  linkCardEmbeddableEndpoint,
  linkCardFetchEndpoint,
  linkCardImageProxyEndpoint,
  linkCardImageUrl,
  linkCardNewsImageEndpoint,
  linkCardPreviewEndpoint,
} from './utils';

export function configureLinkCardModule(framework: Framework) {
  framework.service(LinkCardService);
}
