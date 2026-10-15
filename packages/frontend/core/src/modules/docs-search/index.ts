export {
  type DocSearchResult,
  DocsSearchService,
} from './services/docs-search';
export {
  hasSearchFilters,
  parseSearchQuery,
  type SearchQueryFilters,
} from './utils/search-query';

import { type Framework } from '@notesgraph/infra';

import { DocsService } from '../doc';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { DocsSearchService } from './services/docs-search';

export function configureDocsSearchModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(DocsSearchService, [WorkspaceService, DocsService]);
}
