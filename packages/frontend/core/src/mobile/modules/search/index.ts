import { WorkspaceScope } from '@notesgraph/core/modules/workspace';
import { type Framework } from '@notesgraph/infra';

import { MobileSearchService } from './service/search';

export { MobileSearchService };

export function configureMobileSearchModule(framework: Framework) {
  framework.scope(WorkspaceScope).service(MobileSearchService);
}
