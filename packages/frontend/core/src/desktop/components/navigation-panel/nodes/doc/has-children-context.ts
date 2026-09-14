import { createContext } from 'react';

/**
 * The set of doc ids that have child notes (are a `source` in the note-tree
 * ref graph). The notes tree already loads that graph once
 * (`docsSearchService.watchAllRefs()`), so it provides this set and each doc
 * node reads it in O(1) — avoiding a per-node ref subscription (those are
 * deliberately gated to expanded nodes for perf). Consumers outside the notes
 * tree get the empty default (no folder icon), which is fine.
 */
export const HasChildrenContext = createContext<ReadonlySet<string>>(new Set());
