import { createIdentifier } from '@blocksuite/global/di';
import type { Observable } from 'rxjs';

/**
 * A block-index hit identifying a task block by location. `text`/`trail`
 * are populated only when the query requests them (see {@link BlockTaskFilter}
 * consumers that render a task list rather than a board).
 */
export interface BlockTaskHit {
  docId: string;
  blockId: string;
  /** The task's own text (present when the query resolves list rows). */
  text?: string;
  /** Breadcrumb of ancestor block text, for display. */
  trail?: string;
}

/** Separator the indexer joins `todoTrail` segments with. */
const TRAIL_SEPARATOR = '\u203a';

/**
 * Split an indexer `todoTrail` into its section names.
 *
 * One definition shared by the two things that read a trail — matching a
 * section scope, and rendering a row's breadcrumb — so a task can never be
 * claimed by a project it doesn't visibly sit under, or vice versa.
 */
export function trailSections(trail: string | undefined): string[] {
  if (!trail) return [];
  return trail
    .split(TRAIL_SEPARATOR)
    .map(part => part.trim())
    .filter(Boolean);
}

/** One delta of a task's rich text, as far as emptiness is concerned. */
export interface TaskBodyDelta {
  insert?: string;
  attributes?: Record<string, unknown> | null;
}

/** Inline embeds that are content even though they insert little or nothing. */
const EMBED_ATTRIBUTES = ['reference', 'latex'];

/**
 * True when a task's rich text carries no body — only a status, or nothing.
 *
 * Collected task views drop these (together with the "has no children"
 * check the caller owns), because a checkbox with nothing in it renders as
 * an "Untitled" row with nothing to act on. Pulled out as a pure function
 * so the rule is testable and identical wherever a task list is built.
 *
 * The status is not body: it is either a delta carrying an `orgStatus`
 * attribute (the rendered chip) or a raw typed `TODO ` prefix. An inline
 * embed IS body even though a doc reference inserts only a space — a task
 * whose whole text is a link to another note is a real task.
 */
export function taskBodyIsEmpty(deltas: TaskBodyDelta[]): boolean {
  let body = '';

  for (const delta of deltas) {
    const attributes = delta.attributes;
    if (attributes) {
      if (EMBED_ATTRIBUTES.some(key => attributes[key] != null)) {
        return false;
      }
      if (attributes.orgStatus != null) continue;
    }
    if (typeof delta.insert === 'string') body += delta.insert;
  }

  return stripOrgStatusPrefix(body).trim().length === 0;
}

/**
 * Drop a leading `TODO`/`DONE`/... keyword.
 *
 * Deliberately a local, conservative regex rather than a dependency on the
 * org-status parser: this only needs to know whether anything survives the
 * keyword, and keeping it here leaves this module free of util imports.
 */
function stripOrgStatusPrefix(text: string): string {
  return text.replace(/^\s*(?:\[[ xX-]\]|[A-Z]{2,12})\s*/, '');
}

/** Case-insensitive test for "this task sits under a section called `name`". */
export function trailHasSection(
  trail: string | undefined,
  name: string
): boolean {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return false;
  return trailSections(trail).some(part => part.toLowerCase() === wanted);
}

/**
 * Filter for querying task blocks across the workspace. All tokens must
 * match (AND semantics). Tags and props are the lowercase-normalized
 * inline `#tag` / `#key:value` tokens the indexer extracts from block
 * text.
 */
export interface BlockTaskFilter {
  tags?: string[];
  props?: string[];
  /**
   * Restrict to tasks in these docs (e.g. a project's `docIds`). An empty
   * array matches nothing; omit the field to match any doc.
   */
  docIds?: string[];
  /**
   * Also match tasks that sit *under a section with this heading text*, even
   * when their doc isn't in `docIds`.
   *
   * This is what makes a journal work. A journal is scaffolded with one
   * section per project, so it belongs to every project and none: scoping it
   * by doc would pull every task in the day - including other projects' and
   * Inbox's - into whichever project owned the doc. Position is the real
   * signal, so a task nested under the "Ai" heading belongs to Ai wherever it
   * was written.
   *
   * Matched against the indexer's `todoTrail` (the ancestor-text breadcrumb),
   * which is stored unindexed - so a section scope cannot be pushed into the
   * index query and is applied to the returned hits instead.
   */
  sectionName?: string;
  /**
   * Exclude tasks under a section named by one of these (case-insensitive).
   *
   * The Inbox counterpart of `sectionName`: without it, a journal task
   * written under a project heading would show up both in that project *and*
   * in Inbox, since its doc belongs to no project.
   */
  excludeSectionNames?: string[];
  /**
   * How to scope by task status:
   * - `true`  → incomplete checkboxes only (`todoStatus === 'todo'`)
   * - `false` → any todo checkbox, checked or not (`todoStatus` exists)
   * - omitted → legacy behaviour: any block with an org status (query boards)
   */
  todoOnly?: boolean;
}

/**
 * Optional extension point giving editor code access to the app's block
 * index — the workspace-wide, live-updating search index over individual
 * blocks (tags, org status, planning timestamps). Powers query-based
 * boards whose rows are "every task matching this filter" instead of a
 * single list.
 *
 * No default implementation is registered; look it up via
 * `std.getOptional(BlockTaskIndexProvider)` — a missing provider means the
 * host app has no block index and query boards render empty.
 */
/**
 * One emission of a task-block query.
 *
 * `complete` exists because a provider may answer from several indexes that
 * reply at different times (on-device vs server). Emitting the first answer
 * straight away keeps rows appearing fast, but a consumer that treats it as
 * final renders "no results" for a scope whose tasks the *other* index is
 * still fetching. While `complete` is false, an empty `hits` means "not
 * finished looking", not "nothing matched".
 */
export interface BlockTaskQueryResult {
  hits: BlockTaskHit[];
  complete: boolean;
}

export interface BlockTaskIndexProvider {
  /**
   * Live query for task blocks (todo list items, i.e. blocks with an org
   * status) matching the filter. Re-emits as the index updates.
   */
  queryTaskBlocks$(filter: BlockTaskFilter): Observable<BlockTaskQueryResult>;
}

export const BlockTaskIndexProvider = createIdentifier<BlockTaskIndexProvider>(
  'NotesGraphBlockTaskIndexProvider'
);
