import type { DatabaseBlockModel } from '@blocksuite/notesgraph-model';
import {
  type BlockTaskFilter,
  type BlockTaskHit,
  BlockTaskIndexProvider,
  type ProjectInfo,
  ProjectsProvider,
} from '@blocksuite/notesgraph-shared/services';
import {
  findOrgTimestampIn,
  ORG_STATUS_CANONICAL,
  orgStatusMatches,
  parseOrgStatusPrefix,
} from '@blocksuite/notesgraph-shared/utils';
import type { EditorHost } from '@blocksuite/std';
import {
  type BlockModel,
  nanoid,
  type Store,
  Text,
} from '@blocksuite/store';
import {
  computed,
  effect,
  type ReadonlySignal,
  type Signal,
  signal,
} from '@preact/signals-core';

import { RefNodeSlotsProvider } from '@blocksuite/notesgraph-inline-reference';

import { EditorHostKey } from './context/host-context.js';
import {
  MIRROR_ROW_FLAVOUR,
  OrgTaskRowsDataSource,
} from './org-task-rows-data-source.js';
import { focusCreatedBlock } from './utils/focus-block.js';

/**
 * Minimum gap between intermediate repaints while a query board resolves its
 * rows. Long enough that a big result set doesn't visibly churn, short enough
 * that a slow one still shows it's making progress.
 */
const PUBLISH_THROTTLE_MS = 500;

/**
 * How many index hits a board will actually materialize into rows.
 *
 * Resolving a hit is not cheap: a doc this device hasn't opened has to be
 * loaded and its whole Store built, and every resolved row's store then gets
 * a Y.Doc update listener. A workspace-wide task query matches hundreds of
 * hits, but the list view shows 8 rows a page (100 at the largest page size),
 * so resolving all of them spent seconds of main thread and hundreds of doc
 * loads to render a screenful. Cap the working set well above the largest
 * page so paging stays instant, and stop there.
 */
const MAX_RESOLVED_HITS = 200;

/**
 * A database whose rows come from a workspace-wide index query instead of
 * one list: every task block matching the board's `queryTags`/`queryProps`
 * filter (inline `#tag` / `#key:value` tokens in the items' own text),
 * wherever it lives. Rows are the real block models resolved cross-doc, so
 * the title column and the org status/timestamp machinery (from
 * {@link OrgTaskRowsDataSource}) write straight back to the source items.
 *
 * Rows can't be added or reordered — a query has no insertion point — but
 * status changes, text edits and deletion write through. The hit list is
 * fed live from the app's block index via {@link BlockTaskIndexProvider};
 * without a registered provider the board renders empty.
 */
export class QueryListDataSource extends OrgTaskRowsDataSource {
  private readonly hits$ = signal<BlockTaskHit[]>([]);
  // Bumped on every hits$ change so a still-running batch resolution from a
  // superseded query can tell it's stale and stop writing.
  private _resolveGeneration = 0;

  constructor(
    model: ConstructorParameters<typeof OrgTaskRowsDataSource>[0],
    init?: ConstructorParameters<typeof OrgTaskRowsDataSource>[1]
  ) {
    super(model, init);
    effect(() => {
      this._resolveHits(this.hits$.value);
    });
    // Deferred for the same reason as the base's watcher: getOptional needs
    // the provider container which `init` may still be populating. The
    // effect resubscribes whenever the scope tokens change, so editing the
    // query through the scope bar re-runs the index query live.
    queueMicrotask(() => {
      const provider = this.serviceGet(BlockTaskIndexProvider);
      if (!provider) return;
      // A project scope resolves live to that project's docIds.
      const projectsProvider = this.serviceGet(ProjectsProvider);
      const projects$ = signal<ProjectInfo[]>([]);
      if (projectsProvider) {
        projectsProvider.projects$().subscribe(list => {
          projects$.value = list;
        });
      }
      effect(() => {
        const filter: BlockTaskFilter = {
          tags: this._model.props.queryTags$.value ?? [],
          props: this._model.props.queryProps$.value ?? [],
        };
        const projectId = this._model.props.queryProjectId$.value;
        // Inbox: exclude every project's docs (tasks with no parent project).
        let excludeDocIds: Set<string> | null = null;
        if (projectId) {
          const project = projects$.value.find(p => p.id === projectId);
          // Unknown project (not loaded yet / deleted) → match nothing.
          filter.docIds = project ? project.docIds : [];
        } else if (this._model.props.queryNoProject$.value) {
          excludeDocIds = new Set(
            projects$.value.flatMap(project => project.docIds)
          );
        }
        const subscription = provider
          .queryTaskBlocks$(filter)
          .subscribe(({ hits, complete }) => {
            this.hits$.value = excludeDocIds
              ? hits.filter(hit => !excludeDocIds.has(hit.docId))
              : hits;
            this.queryComplete$.value = complete;
          });
        // Data sources have no dispose lifecycle today (see
        // DatabaseBlockDataSource); the last subscription lives as long as
        // the board component's lazily-created data source does.
        return () => subscription.unsubscribe();
      });
    });
  }

  /**
   * Open the source of a query row: its rows are real block models living in
   * other docs, so "opening" a row navigates to that block in its own doc
   * (via the reference-node slot), not the in-database row detail. Returns
   * false if the row's source can't be resolved so the caller can fall back.
   */
  openRowSource(rowId: string): boolean {
    const model = this.getModelById(rowId);
    if (!model) return false;
    const host = this.serviceGet(EditorHostKey);
    if (!host) return false;
    host.std.getOptional(RefNodeSlotsProvider)?.docLinkClicked.next({
      pageId: model.store.id,
      params: { blockIds: [model.id] },
      host,
    });
    return true;
  }

  /**
   * The task's current org status label source: chip embed attribute, raw
   * typed prefix, or the native checkbox state — same precedence as the
   * base class's cell reads, but usable during row filtering (where
   * `getModelById` would be circular).
   */
  private modelStatusText(model: BlockModel): string | null {
    const text = model.text;
    if (!text) return null;
    const first = text.toDelta()[0] as
      | { insert?: string; attributes?: { orgStatus?: string } }
      | undefined;
    const embedStatus = first?.attributes?.orgStatus;
    if (typeof embedStatus === 'string') return embedStatus;
    const prefix = parseOrgStatusPrefix(text.toString());
    if (prefix) return prefix.statusText;
    const props = model.props as { type?: string; checked?: boolean };
    if (props.type === 'todo') return props.checked ? '[X]' : '[ ]';
    return null;
  }

  private matchesCriteria(model: BlockModel): boolean {
    const statuses = this._model.props.queryStatus$.value;
    if (statuses && statuses.length > 0) {
      const statusText = this.modelStatusText(model);
      if (
        !statusText ||
        !statuses.some(label => orgStatusMatches(statusText, label))
      ) {
        return false;
      }
    }
    const dueInDays = this._model.props.queryDueInDays$.value;
    if (typeof dueInDays === 'number' && Number.isFinite(dueInDays)) {
      const text = model.text;
      if (!text) return false;
      const deadline = findOrgTimestampIn(text.yText, 'DEADLINE');
      if (!deadline) return false;
      const cutoff = Date.now() + dueInDays * 24 * 60 * 60 * 1000;
      if (deadline.epochMs > cutoff) return false;
    }
    return true;
  }

  private isDocReady(docId: string): boolean {
    if (docId === this._model.store.id) return true;
    return !!this._model.store.workspace.getDoc(docId)?.loaded;
  }

  private resolveStore(docId: string): Store | null {
    if (docId === this._model.store.id) return this._model.store;
    const doc = this._model.store.workspace.getDoc(docId);
    if (!doc) return null;
    if (!doc.loaded) {
      try {
        doc.load();
      } catch (e) {
        console.error(e);
        return null;
      }
    }
    // A stable id is essential: bare getStore() generates a random store id
    // per call, returning a fresh empty Store every evaluation — blocks
    // would never materialize for the reactive reads downstream.
    return doc.getStore({ id: docId });
  }

  private resolveHitModel(hit: BlockTaskHit): BlockModel | null {
    const store = this.resolveStore(hit.docId);
    const model = store?.getBlock$(hit.blockId)?.model;
    return model && model.flavour === MIRROR_ROW_FLAVOUR ? model : null;
  }

  private static hitKey(hit: BlockTaskHit): string {
    return `${hit.docId}:${hit.blockId}`;
  }

  /**
   * Every hit resolved to a model, before the status/due criteria. Resolving
   * a hit whose doc hasn't been opened on this device yet loads and
   * materializes that doc's whole Store — for a query board that matches
   * many not-yet-opened docs (common right after widening a query, e.g. a
   * fresh journal's cross-project Task List), doing that for every hit in
   * one synchronous pass visibly freezes the page. Docs that are already
   * loaded (the common case on repeat renders) resolve synchronously as
   * before; only the cold ones are deferred, resolved a few at a time with a
   * yield back to the browser between batches.
   *
   * The live index query re-emits hits$ repeatedly while results are still
   * streaming in (e.g. right after a workspace-wide query starts matching
   * docs this device hadn't synced yet) — each emission used to restart
   * resolution from scratch, wiping hitModels$ back to empty before a single
   * batch could finish, so a query board that never stopped getting new hits
   * never finished populating either. resolvedByHit persists resolved models
   * by hit identity across restarts so a superseded run's completed work
   * isn't thrown away — a later run only has to resolve what's genuinely new.
   */
  private readonly hitModels$: Signal<BlockModel[]> = signal<BlockModel[]>([]);
  private readonly resolvedByHit = new Map<string, BlockModel>();

  // How many hits are still waiting on a cold doc to load. Drives
  // rowsLoading$ so the view shows a loading state rather than "No results."
  // while cross-doc hits are still being resolved a batch at a time.
  private readonly pendingCount$: Signal<number> = signal<number>(0);
  // Whether every index behind the query has answered (see
  // BlockTaskQueryResult.complete). Set from the subscription, NOT from
  // _resolveHits: hits$ starts empty and the constructor effect resolves that
  // empty value immediately, so keying off resolution would call it settled
  // before a single query had come back — and the view would flash
  // "No results." at anyone whose tasks are still being fetched.
  private readonly queryComplete$: Signal<boolean> = signal<boolean>(false);

  override rowsLoading$: ReadonlySignal<boolean> = computed(
    () => !this.queryComplete$.value || this.pendingCount$.value > 0
  );

  // When the in-progress list was last repainted, so intermediate publishes
  // can be rate-limited (see resolveHitsInBatches).
  private lastPublishAt = 0;

  private publishHitModels(hits: BlockTaskHit[]): void {
    const models: BlockModel[] = [];
    for (const hit of hits) {
      const model = this.resolvedByHit.get(QueryListDataSource.hitKey(hit));
      if (model) models.push(model);
    }
    this.hitModels$.value = models;
  }

  /**
   * Resolve `pending` (hits whose doc wasn't loaded yet), a batch at a time.
   *
   * `resolveStore` only *starts* the doc loading — `Doc.load()` returns void
   * and flips `loaded` synchronously while the content arrives asynchronously
   * from storage/sync. So a cold hit's block is usually still absent the
   * instant after we ask for it. This used to drop such a hit on the floor:
   * it resolved to null, was never recorded, and nothing retried it, because
   * the only trigger for another attempt was the index re-emitting. That is
   * why tasks in not-yet-opened docs went missing, and later (once other
   * fixes kept the query alive) why rows trickled in "in chunks" long after
   * loading looked finished — each chunk was a fresh index emission
   * re-attempting what the previous pass had discarded.
   *
   * Now a pass keeps its own unresolved set and retries it on a backoff
   * until the docs materialize, so one pass resolves everything it was
   * given. `pendingCount$` stays non-zero throughout, which keeps
   * `rowsLoading$` true — the view shows a spinner rather than settling and
   * then mutating under the reader.
   */
  private resolveHitsInBatches(
    generation: number,
    hits: BlockTaskHit[],
    pending: BlockTaskHit[]
  ): void {
    const BATCH_SIZE = 10;
    // Backoff for docs still streaming in. Bounded: a hit whose doc never
    // arrives (deleted, or no longer readable) must not spin forever — it
    // stays unresolved until the next index emission.
    const RETRY_DELAYS_MS = [120, 300, 700, 1500, 3000, 5000];

    const publish = (force: boolean) => {
      const now = Date.now();
      // Publishing after every batch repainted the list constantly while
      // resolution ran — and because the list view paginates (8 rows a page
      // by default), each publish changed which rows were on the *visible*
      // page, so it read as the list refreshing rather than filling in.
      if (force || now - this.lastPublishAt >= PUBLISH_THROTTLE_MS) {
        this.lastPublishAt = now;
        this.publishHitModels(hits);
      }
    };

    const attempt = (queue: BlockTaskHit[], retry: number): void => {
      const unresolved: BlockTaskHit[] = [];

      const runBatch = (start: number) => {
        if (generation !== this._resolveGeneration) return; // superseded
        const end = Math.min(start + BATCH_SIZE, queue.length);
        for (const hit of queue.slice(start, end)) {
          const key = QueryListDataSource.hitKey(hit);
          if (this.resolvedByHit.has(key)) continue;
          const model = this.resolveHitModel(hit);
          if (model) this.resolvedByHit.set(key, model);
          else unresolved.push(hit);
        }

        if (end < queue.length) {
          this.pendingCount$.value = queue.length - end + unresolved.length;
          publish(false);
          requestIdleCallback(() => runBatch(end), { timeout: 200 });
          return;
        }

        // Whole queue attempted once.
        if (unresolved.length === 0) {
          this.pendingCount$.value = 0;
          publish(true);
          return;
        }
        if (retry >= RETRY_DELAYS_MS.length) {
          // Give up on this pass; let the spinner clear so the board isn't
          // stuck loading over content it can already show.
          this.pendingCount$.value = 0;
          publish(true);
          return;
        }
        // Still waiting on docs: keep loading state up and try again.
        this.pendingCount$.value = unresolved.length;
        publish(false);
        setTimeout(
          () => {
            if (generation !== this._resolveGeneration) return;
            attempt(unresolved, retry + 1);
          },
          RETRY_DELAYS_MS[retry]
        );
      };

      runBatch(0);
    };

    attempt(pending, 0);
  }

  private _resolveHits(allHits: BlockTaskHit[]): void {
    // Only the working set is materialized (see MAX_RESOLVED_HITS). Slicing
    // here rather than in the query keeps the index result intact, so the
    // scope/count the board was asked for is unchanged — this only bounds
    // how much of it becomes live rows.
    const hits = allHits.slice(0, MAX_RESOLVED_HITS);
    const generation = ++this._resolveGeneration;
    const currentKeys = new Set(hits.map(QueryListDataSource.hitKey));
    for (const key of this.resolvedByHit.keys()) {
      if (!currentKeys.has(key)) this.resolvedByHit.delete(key);
    }

    const pending: BlockTaskHit[] = [];
    for (const hit of hits) {
      const key = QueryListDataSource.hitKey(hit);
      if (this.resolvedByHit.has(key)) continue; // already resolved
      if (this.isDocReady(hit.docId)) {
        const model = this.resolveHitModel(hit);
        if (model) this.resolvedByHit.set(key, model);
        // `isDocReady` only means load() was called — Doc.load() flips
        // `loaded` synchronously while content is still arriving, so a doc a
        // previous pass warmed up reports ready while its blocks are absent.
        // Such a hit has to be retried, not dropped.
        else pending.push(hit);
      } else {
        pending.push(hit);
      }
    }
    // The already-loaded hits go out straight away; the throttle below is
    // measured from here so the next repaint is an interval later, not
    // immediately after this one.
    this.lastPublishAt = Date.now();
    this.publishHitModels(hits);
    this.pendingCount$.value = pending.length;
    if (pending.length > 0) {
      this.resolveHitsInBatches(generation, hits, pending);
    }
  }

  protected override sourceRowModels$: ReadonlySignal<BlockModel[]> = computed(
    () => {
      // Status/deadline live in the items' text — re-filter on text edits.
      this.sourceTextVersion$.value;
      return this.hitModels$.value.filter(model =>
        this.matchesCriteria(model)
      );
    }
  );

  // Watch every hit's store, not just the visible rows' — a criteria-
  // filtered task must reappear when its text edits back into scope.
  protected override watchedStores$: ReadonlySignal<Store[]> = computed(() => {
    const stores = new Set<Store>();
    for (const model of this.hitModels$.value) {
      stores.add(model.store);
    }
    return [...stores];
  });
}

/**
 * Inserts a query board/table after the given block, filtering the
 * workspace's task blocks by the given inline tokens (`personal` tags,
 * `key:value` props — without the leading `#`).
 */
export type QueryScopeFilter = {
  tags?: string[];
  props?: string[];
  status?: string[];
  dueInDays?: number;
};

/**
 * Parses whitespace/comma separated `#tag` / `#key:value` tokens (leading
 * '#' optional, lowercased) into the tag/prop scope lists.
 */
export const parseQueryTokens = (
  input: string
): { tags: string[]; props: string[] } => {
  const tokens = input
    .split(/[\s,]+/)
    .map(token => token.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  return {
    tags: tokens.filter(token => !token.includes(':')),
    props: tokens.filter(token => token.includes(':')),
  };
};

/** The inverse of {@link parseQueryTokens} — for prefilled editors. */
export const queryTokensString = (filter: {
  tags?: string[];
  props?: string[];
}): string =>
  [...(filter.tags ?? []), ...(filter.props ?? [])]
    .map(token => `#${token}`)
    .join(' ');

/** The note-level parent + index right after `target`'s top-level ancestor. */
const noteInsertPoint = (
  host: EditorHost,
  target: BlockModel
): { parent: BlockModel; index: number } | null => {
  let insertParent = host.store.getParent(target);
  let topAncestor: BlockModel = target;
  while (insertParent && insertParent.flavour !== 'notesgraph:note') {
    topAncestor = insertParent;
    insertParent = host.store.getParent(insertParent);
  }
  if (!insertParent) return null;
  const index = insertParent.children.findIndex(v => v.id === topAncestor.id);
  return { parent: insertParent, index: index + 1 };
};

const TASK_STATUS_COLORS: Record<string, string> = {
  Todo: 'var(--notesgraph-tag-blue)',
  'In Progress': 'var(--notesgraph-tag-yellow)',
  Done: 'var(--notesgraph-tag-green)',
};

/**
 * Seed the task columns the org data source recognises by name, so a Task
 * List's filter/sort bar has real fields to work with: a "Status" select
 * (its options are the canonical org statuses, matched against each task's
 * own org annotation) and "Deadline"/"Scheduled" date columns (backed by org
 * planning timestamps). Without these a fresh query database exposes only the
 * title column, leaving nothing meaningful to filter or sort on.
 */
const seedTaskColumns = (datasource: QueryListDataSource) => {
  const statusId = datasource.propertyAdd('end', {
    type: 'select',
    name: 'Status',
  });
  if (statusId) {
    datasource.propertyDataSet(statusId, {
      options: ORG_STATUS_CANONICAL.map(status => ({
        id: nanoid(),
        value: status.label,
        color: TASK_STATUS_COLORS[status.label] ?? 'var(--notesgraph-tag-blue)',
      })),
    });
  }
  datasource.propertyAdd('end', { type: 'date', name: 'Deadline' });
  datasource.propertyAdd('end', { type: 'date', name: 'Scheduled' });
};

const addQueryDatabaseAt = (
  host: EditorHost,
  viewType: string,
  parent: BlockModel,
  index: number,
  filter: QueryScopeFilter
): string | null => {
  const id = host.store.addBlock(
    'notesgraph:database',
    {
      queryTags: filter.tags ?? [],
      queryProps: filter.props ?? [],
      queryStatus: filter.status,
      queryDueInDays: filter.dueInDays,
    },
    parent,
    index
  );
  const databaseModel = host.store.getBlock(id)?.model as
    | DatabaseBlockModel
    | undefined;
  if (!databaseModel) return null;
  const datasource = new QueryListDataSource(databaseModel);
  // The list view (Task List) is the one built around the generic filter/sort
  // bar, so give it the task columns to operate on.
  if (viewType === 'list') {
    seedTaskColumns(datasource);
  }
  datasource.viewManager.viewAdd(viewType);
  return id;
};

export const insertQueryDatabase = (
  host: EditorHost,
  viewType: string,
  target: BlockModel,
  filter: QueryScopeFilter
) => {
  const point = noteInsertPoint(host, target);
  if (!point) return;

  host.store.captureSync();
  const id = addQueryDatabaseAt(
    host,
    viewType,
    point.parent,
    point.index,
    filter
  );
  if (!id) return;

  host.selection.clear();
  focusCreatedBlock(host, id);
};

// Fixed ids so the list view's "hide done" filter can reference the Status
// column + its Done option. Ids are scoped to their own database block, so
// reusing them across Task Lists is fine.
const STATUS_COLUMN_ID = 'task-status';
const STATUS_OPTION_ID: Record<string, string> = {
  Todo: 'task-status-todo',
  'In Progress': 'task-status-in-progress',
  Done: 'task-status-done',
};

/** The seeded task columns as declarative column data (no data source needed). */
const declarativeTaskColumns = () => [
  {
    id: STATUS_COLUMN_ID,
    type: 'select',
    name: 'Status',
    data: {
      options: ORG_STATUS_CANONICAL.map(status => ({
        id: STATUS_OPTION_ID[status.label] ?? nanoid(),
        value: status.label,
        color: TASK_STATUS_COLORS[status.label] ?? 'var(--notesgraph-tag-blue)',
      })),
    },
  },
  { id: nanoid(), type: 'date', name: 'Deadline', data: {} },
  { id: nanoid(), type: 'date', name: 'Scheduled', data: {} },
];

/**
 * A list-view filter that hides done tasks (Status is not "Done"). Applied at
 * the VIEW level, not as a database-wide queryStatus, so other views (a kanban
 * added to the same database) still show every status — otherwise dragging a
 * card to Done would filter it out of the whole database and "nothing changes".
 */
const hideDoneFilter = () => ({
  type: 'group' as const,
  op: 'and' as const,
  conditions: [
    {
      type: 'filter' as const,
      left: { type: 'ref' as const, name: STATUS_COLUMN_ID },
      function: 'isNotOneOf',
      args: [{ type: 'literal' as const, value: [STATUS_OPTION_ID.Done] }],
    },
  ],
});

/**
 * Insert a Task List — a query database rendered as the list view — as a child
 * of `parentId`. Scoped to one project's open tasks (`projectId`), or, with
 * `noProject`, to the "inbox": open tasks in docs that belong to no project.
 * Built declaratively (seeded columns + a list view in the block props), so it
 * needs only the store, not an editor host: the journal scaffolds these at
 * doc-creation time.
 */
export const addProjectTaskListBlock = (
  store: Store,
  parentId: string,
  opts: { projectId?: string; noProject?: boolean; name?: string } = {}
): string | null => {
  const view = {
    id: nanoid(),
    name: 'Tasks',
    mode: 'list',
    // Hide done at the view level (not queryStatus), so a kanban added to this
    // same database can still show and move cards into a Done lane.
    filter: hideDoneFilter(),
    header: {},
  } as DatabaseBlockModel['props']['views'][number];
  const id = store.addBlock(
    'notesgraph:database',
    {
      title: new Text(opts.name ?? ''),
      queryTags: [],
      queryProps: [],
      queryProjectId: opts.projectId ?? '',
      queryNoProject: opts.noProject ?? false,
      columns:
        declarativeTaskColumns() as DatabaseBlockModel['props']['columns'],
      views: [view],
    },
    parentId
  );
  return id ?? null;
};

/**
 * Inserts a Jira-like task report: headed sections, each backed by its own
 * live query board/table sharing the given tag/prop scope but sliced by
 * status ("In Progress" board, "Todo" and "Done" tables) plus a "Due soon"
 * table of everything with a DEADLINE in the next 7 days.
 */
export const insertTaskReport = (
  host: EditorHost,
  target: BlockModel,
  filter: QueryScopeFilter,
  viewPresetTypes: { table: string; kanban: string }
) => {
  const point = noteInsertPoint(host, target);
  if (!point) return;

  const sections: {
    heading: string;
    viewType: string;
    filter: QueryScopeFilter;
  }[] = [
    {
      heading: 'In progress',
      viewType: viewPresetTypes.kanban,
      filter: { ...filter, status: ['In Progress'] },
    },
    {
      heading: 'Due soon',
      viewType: viewPresetTypes.table,
      filter: { ...filter, dueInDays: 7 },
    },
    {
      heading: 'Todo',
      viewType: viewPresetTypes.table,
      filter: { ...filter, status: ['Todo'] },
    },
    {
      heading: 'Done',
      viewType: viewPresetTypes.table,
      filter: { ...filter, status: ['Done'] },
    },
  ];

  host.store.captureSync();
  let index = point.index;
  let firstId: string | null = null;
  for (const section of sections) {
    host.store.addBlock(
      'notesgraph:paragraph',
      {
        type: 'h3',
        text: new Text(section.heading),
      },
      point.parent,
      index++
    );
    const id = addQueryDatabaseAt(
      host,
      section.viewType,
      point.parent,
      index++,
      section.filter
    );
    if (id && !firstId) firstId = id;
  }

  if (!firstId) return;
  host.selection.clear();
  focusCreatedBlock(host, firstId);
};
