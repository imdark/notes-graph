import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph/shared/types';
import {
  type DeltaInsert,
  Text,
  type Workspace,
} from '@blocksuite/notesgraph/store';
import { useCallback } from 'react';

export function useReferenceLinkHelper(docCollection: Workspace) {
  const addReferenceLink = useCallback(
    (pageId: string, referenceId: string) => {
      const page = docCollection?.getDoc(pageId)?.getStore();
      if (!page) {
        return;
      }
      const text = new Text([
        {
          insert: ' ',
          attributes: {
            reference: {
              type: 'Subpage',
              pageId: referenceId,
            },
          },
        },
      ] as DeltaInsert<NotesGraphTextAttributes>[]);
      const [frame] = page.getModelsByFlavour('notesgraph:note');

      frame && page.addBlock('notesgraph:paragraph', { text }, frame.id);
    },
    [docCollection]
  );

  return {
    addReferenceLink,
  };
}
