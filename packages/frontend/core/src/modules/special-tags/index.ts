import { type Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { DocsSearchService } from '../docs-search';
import { FeatureFlagService } from '../feature-flag';
import { JournalService } from '../journal';
import { OrganizeService } from '../organize';
import { TagService } from '../tag';
import { WorkspaceScope } from '../workspace';
import { SpecialTagsService } from './services/special-tags';

export * from './constants';
export { SpecialTagsService } from './services/special-tags';

export function configureSpecialTagsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(SpecialTagsService, [
      FeatureFlagService,
      TagService,
      DocsService,
      DocsSearchService,
      JournalService,
      OrganizeService,
    ]);
}
export { SpecialTagsSync } from './views/special-tags-sync';
