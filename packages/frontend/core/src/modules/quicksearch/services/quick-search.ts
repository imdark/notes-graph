import { Service } from '@notesgraph/infra';

import { QuickSearch } from '../entities/quick-search';

export class QuickSearchService extends Service {
  public readonly quickSearch = this.framework.createEntity(QuickSearch);
}
