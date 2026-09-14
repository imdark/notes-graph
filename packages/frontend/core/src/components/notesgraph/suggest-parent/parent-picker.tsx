import { MenuItem } from '@notesgraph/component/ui/menu';
import { SearchInput } from '@notesgraph/core/mobile/components/search-input';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useMemo, useState } from 'react';
import { catchError, map, of } from 'rxjs';
import * as styles from './styles.css';
import type { ParentCandidate } from './use-suggest-parent';

/**
 * Search-any-note picker for choosing a parent. Rendered inside a bottom-sheet
 * (the more-menu sub or the banner's "Add" menu). Excludes the doc itself and
 * any ids in `excludeIds` (typically its current parents) so it only offers new
 * links.
 */
export const ParentPickerContent = ({
  docId,
  excludeIds,
  onSelect,
}: {
  docId: string;
  excludeIds?: string[];
  onSelect: (parentId: string, title: string) => void;
}) => {
  const [query, setQuery] = useState('');
  const docsSearch = useService(DocsSearchService);
  const docsService = useService(DocsService);

  const exclude = useMemo(
    () => new Set<string>([docId, ...(excludeIds ?? [])]),
    [docId, excludeIds]
  );

  const results$ = useMemo(() => {
    const q = query.trim();
    if (q.length < 1) return new LiveData<ParentCandidate[]>([]);
    return LiveData.from(
      docsSearch.searchTitle$(q).pipe(
        map(ids =>
          ids
            .filter(id => !exclude.has(id))
            .slice(0, 20)
            .map(id => ({
              docId: id,
              title: docsService.list.doc$(id).value?.title$.value || 'Untitled',
            }))
        ),
        // errored source poisons the LiveData and useLiveData re-throws in
        // render — degrade to "no results" instead of crashing the menu
        catchError(err => {
          console.error('[NG-DIAG suggest-parent] picker search failed:', err);
          return of([] as ParentCandidate[]);
        })
      ),
      []
    );
  }, [docsSearch, docsService, query, exclude]);
  const results = useLiveData(results$);

  const trimmed = query.trim();
  // Offer to create the parent when there's no note that exactly matches what
  // was typed — creating an (empty) parent note and linking this note under it.
  const hasExactMatch = useMemo(
    () =>
      results.some(
        r => r.title.trim().toLowerCase() === trimmed.toLowerCase()
      ),
    [results, trimmed]
  );

  return (
    <div className={styles.pickerRoot}>
      <SearchInput
        className={styles.pickerInput}
        value={query}
        onInput={setQuery}
        placeholder="Search notes…"
        autoFocus
        debounce={200}
      />
      <div className={styles.pickerList}>
        {results.map(r => (
          <MenuItem
            key={r.docId}
            onSelect={() => onSelect(r.docId, r.title)}
          >
            {r.title}
          </MenuItem>
        ))}
        {trimmed && !hasExactMatch ? (
          <MenuItem
            key="__create-parent__"
            onSelect={() => {
              const record = docsService.createDoc({ title: trimmed });
              onSelect(record.id, trimmed);
            }}
          >
            {`Create “${trimmed}”`}
          </MenuItem>
        ) : null}
      </div>
    </div>
  );
};
