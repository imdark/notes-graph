import { DocsService } from '@notesgraph/core/modules/doc';
import { TagService } from '@notesgraph/core/modules/tag';
import {
  buildVocabulary,
  type VocabularyTerm,
} from '@notesgraph/core/modules/voice-tasks';
import { useLiveData, useService } from '@notesgraph/infra';
import { useMemo, useRef } from 'react';

/**
 * The words this workspace spells its own way, from tag names and note
 * titles, for cleanDictation. A ref, so dictation callbacks set up once read
 * the latest list.
 */
export function useDictationVocabulary() {
  const docs = useLiveData(useService(DocsService).list.docs$);
  const tags = useLiveData(useService(TagService).tagList.tagMetas$);

  const vocabulary = useMemo(
    () =>
      buildVocabulary([
        // Tags first: they are the user's own deliberate names.
        ...tags.map(tag => tag.name),
        ...docs.filter(doc => !doc.trash$.value).map(doc => doc.title$.value),
      ]),
    [docs, tags]
  );

  const ref = useRef<readonly VocabularyTerm[]>(vocabulary);
  ref.current = vocabulary;
  return ref;
}
