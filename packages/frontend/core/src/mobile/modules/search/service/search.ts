import {
  CollectionsQuickSearchSession,
  DocsQuickSearchSession,
  RecentDocsQuickSearchSession,
  TagsQuickSearchSession,
} from '@notesgraph/core/modules/quicksearch';
import { Service } from '@notesgraph/infra';

export class MobileSearchService extends Service {
  readonly recentDocs = this.framework.createEntity(
    RecentDocsQuickSearchSession
  );
  readonly collections = this.framework.createEntity(
    CollectionsQuickSearchSession
  );
  readonly docs = this.framework.createEntity(DocsQuickSearchSession);
  readonly tags = this.framework.createEntity(TagsQuickSearchSession);
}
