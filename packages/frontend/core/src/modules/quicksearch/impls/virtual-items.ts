import { PlayIcon } from '@blocksuite/icons/rc';
import { Entity, LiveData } from '@notesgraph/infra';

import type { VirtualViewsService } from '../../virtual-views';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';

type VirtualItemPayload = {
  url: string;
};

/**
 * Surfaces crawled virtual-view items (e.g. YouTube videos) in Ctrl-K. Matches
 * on the item title against the local store — no external index needed.
 */
export class VirtualItemsQuickSearchSession
  extends Entity
  implements QuickSearchSession<'virtual-item', VirtualItemPayload>
{
  constructor(private readonly virtualViewsService: VirtualViewsService) {
    super();
  }

  query$ = new LiveData('');

  private readonly allItems$ = LiveData.from(
    this.virtualViewsService.watchAllItems(),
    []
  );

  items$ = LiveData.computed(get => {
    const query = get(this.query$).trim().toLowerCase();
    if (!query) return [];

    return get(this.allItems$)
      .filter(item => item.title.toLowerCase().includes(query))
      .slice(0, 20)
      .map(
        item =>
          ({
            id: 'virtual-item:' + item.id,
            source: 'virtual-item',
            icon: PlayIcon,
            label: {
              title: item.title,
              subTitle: item.snippet ?? undefined,
            },
            payload: { url: item.url },
            timestamp: item.publishedAt ?? undefined,
          }) as QuickSearchItem<'virtual-item', VirtualItemPayload>
      );
  });

  query(query: string) {
    this.query$.next(query);
  }
}
