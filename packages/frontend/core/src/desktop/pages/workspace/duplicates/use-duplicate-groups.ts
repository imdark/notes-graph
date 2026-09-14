import { DocsService } from '@notesgraph/core/modules/doc';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';
import { combineLatest, debounceTime, map, of, switchMap } from 'rxjs';

export interface DuplicateDoc {
  id: string;
  title: string;
  updatedAt?: number;
  createdAt?: number;
}

export interface DuplicateGroup {
  /** Normalized title shared by every doc in the group. */
  key: string;
  /** A human-facing title for the group (first non-empty original). */
  title: string;
  /** The duplicate docs, oldest first. */
  docs: DuplicateDoc[];
}

/** Same normalization the suggest-parent "combine" uses, so the two agree. */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Titles that shouldn't be treated as "duplicates" even when repeated — a
 * blank/placeholder title is not a meaningful match to combine on.
 */
function isIgnorable(key: string): boolean {
  return key.length < 2 || key === 'untitled';
}

function buildGroups(rows: DuplicateDoc[]): DuplicateGroup[] {
  const byKey = new Map<string, DuplicateGroup>();
  for (const row of rows) {
    const key = normalizeTitle(row.title);
    if (isIgnorable(key)) continue;
    let group = byKey.get(key);
    if (!group) {
      group = { key, title: row.title.trim() || 'Untitled', docs: [] };
      byKey.set(key, group);
    }
    group.docs.push(row);
  }

  const groups: DuplicateGroup[] = [];
  for (const group of byKey.values()) {
    if (group.docs.length < 2) continue;
    group.docs.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    groups.push(group);
  }
  // Biggest clusters first, then alphabetical for stability.
  groups.sort(
    (a, b) => b.docs.length - a.docs.length || a.key.localeCompare(b.key)
  );
  return groups;
}

/**
 * All sets of non-trashed docs that share a title, computed reactively so the
 * count "runs in the background" and shrinks as docs are combined/renamed. A
 * doc's title and trash flag are each their own LiveData, so we combine them
 * per-doc and rebuild the groups (debounced) on any change.
 */
export function useDuplicateGroups(): DuplicateGroup[] {
  const docsService = useService(DocsService);

  const groups$ = useMemo(
    () =>
      LiveData.from<DuplicateGroup[]>(
        docsService.list.docs$.pipe(
          switchMap(records => {
            if (records.length === 0) return of([] as DuplicateGroup[]);
            return combineLatest(
              records.map(record =>
                combineLatest([
                  record.title$,
                  record.trash$,
                  record.createdAt$,
                  record.updatedAt$,
                ]).pipe(
                  map(([title, trash, createdAt, updatedAt]) => ({
                    id: record.id,
                    title: title ?? '',
                    trash: !!trash,
                    createdAt,
                    updatedAt,
                  }))
                )
              )
            ).pipe(
              debounceTime(300),
              map(rows =>
                buildGroups(
                  rows
                    .filter(r => !r.trash)
                    .map(({ id, title, createdAt, updatedAt }) => ({
                      id,
                      title,
                      createdAt,
                      updatedAt,
                    }))
                )
              )
            );
          })
        ),
        []
      ),
    [docsService]
  );

  return useLiveData(groups$);
}

/** The number of duplicate clusters — what the sidebar badge shows. */
export function useDuplicateCount(): number {
  return useDuplicateGroups().length;
}
