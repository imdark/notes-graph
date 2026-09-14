import { NewXxxEdgelessIcon, NewXxxPageIcon } from '@blocksuite/icons/rc';
import type { DocMode } from '@blocksuite/notesgraph/model';
import { Entity, LiveData } from '@notesgraph/infra';

import type { DocModeRegistryService } from '../../doc-mode-registry';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchGroup } from '../types/group';
import type { QuickSearchItem } from '../types/item';

const group = {
  id: 'creation',
  label: { i18nKey: 'com.notesgraph.quicksearch.group.creation' },
  // Rank the "Create new … as '<query>'" group just below the existing-doc
  // matches (the `docs` group, score 5) and the did-you-mean group (6), but
  // above the score-0 tail (journals, the "search locally" action). Before,
  // score 0 tied it with that tail and buried it at the very bottom, so making
  // a new note meant scrolling past everything. Keeping it *under* the doc
  // matches is deliberate: typing an existing note's title still ranks that
  // note first, so Enter opens it instead of accidentally creating a duplicate.
  score: 3,
} as QuickSearchGroup;

export class CreationQuickSearchSession
  extends Entity
  implements QuickSearchSession<'creation', { title: string; mode: DocMode }>
{
  constructor(private readonly docModeRegistry: DocModeRegistryService) {
    super();
  }

  query$ = new LiveData('');

  items$ = LiveData.computed(get => {
    const query = get(this.query$);

    if (!query.trim()) {
      return [];
    }

    const items: QuickSearchItem<
      'creation',
      { title: string; mode: DocMode }
    >[] = [
      {
        id: 'creation:create-page',
        source: 'creation',
        label: {
          i18nKey: 'com.notesgraph.cmdk.notesgraph.create-new-page-as',
          options: { keyWord: query },
        },
        group,
        icon: NewXxxPageIcon,
        payload: { mode: 'page', title: query },
      },
    ];

    // Only offer "create new edgeless" when the edgeless plugin is installed
    // and enabled (it registers the 'edgeless' mode in DocModeRegistryService).
    const edgelessAvailable = get(this.docModeRegistry.modes$).some(
      mode => mode.id === 'edgeless'
    );
    if (edgelessAvailable) {
      items.push({
        id: 'creation:create-edgeless',
        source: 'creation',
        label: {
          i18nKey: 'com.notesgraph.cmdk.notesgraph.create-new-edgeless-as',
          options: { keyWord: query },
        },
        group,
        icon: NewXxxEdgelessIcon,
        payload: { mode: 'edgeless', title: query },
      });
    }

    return items;
  });

  query(query: string) {
    this.query$.next(query);
  }
}
