import { createIdentifier } from '@blocksuite/global/di';
import type { ReferenceParams } from '@blocksuite/notesgraph-model';
import type { ExtensionType } from '@blocksuite/store';

export interface QuickSearchService {
  openQuickSearch: () => Promise<QuickSearchResult>;
}

export type QuickSearchResult =
  | {
      docId: string;
      params?: ReferenceParams;
    }
  | {
      externalUrl: string;
    }
  | null;

export const QuickSearchProvider = createIdentifier<QuickSearchService>(
  'NotesGraphQuickSearchService'
);

export function QuickSearchExtension(
  quickSearchService: QuickSearchService
): ExtensionType {
  return {
    setup: di => {
      di.addImpl(QuickSearchProvider, quickSearchService);
    },
  };
}
