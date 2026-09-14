import type { LinkedMenuGroup } from '@blocksuite/notesgraph/widgets/linked-doc';
import type {
  SearchCollectionMenuAction,
  SearchDocMenuAction,
  SearchTagMenuAction,
} from '@notesgraph/core/modules/search-menu/services';

export interface SearchMenuConfig {
  getDocMenuGroup: (
    query: string,
    action: SearchDocMenuAction,
    abortSignal: AbortSignal
  ) => LinkedMenuGroup;
  getTagMenuGroup: (
    query: string,
    action: SearchTagMenuAction,
    abortSignal: AbortSignal
  ) => LinkedMenuGroup;
  getCollectionMenuGroup: (
    query: string,
    action: SearchCollectionMenuAction,
    abortSignal: AbortSignal
  ) => LinkedMenuGroup;
}
