import { IconButton } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { HomeDocService } from '@notesgraph/core/modules/home-doc';
import { JournalService } from '@notesgraph/core/modules/journal';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useI18n } from '@notesgraph/i18n';
import {
  LiveData,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { CollapsibleSection } from '../../layouts/collapsible-section';
import { NavigationPanelDocNode } from '../../nodes/doc';
import { HasChildrenContext } from '../../nodes/doc/has-children-context';
import { NavigationPanelProjectNode } from '../../nodes/project';
import { NavigationPanelTreeNode, NavigationPanelTreeRoot } from '../../tree';

const InboxNodeIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
  >
    <path
      d="M5 13.5 6.8 6h10.4L19 13.5V19H5v-5.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5 13.5h4l1 2h4l1-2h4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const JournalNodeIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
  >
    <rect
      x="4"
      y="5"
      width="16"
      height="15"
      rx="2"
      stroke="currentColor"
      strokeWidth="1.6"
    />
    <path
      d="M4 9h16M8 3v4M16 3v4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// Grayscale magnifier — deliberately neutral, not the brand accent.
const SearchIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    style={{ filter: 'grayscale(1)' }}
  >
    <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="1.6" />
    <path
      d="m20 20-3.6-3.6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/** Parentless notes ("no parent") collect here, under the Home root. */
const InboxNode = ({
  parentPath,
  orphanIds,
}: {
  parentPath: string[];
  orphanIds: string[];
}) => {
  const t = useI18n();
  const navigationPanelService = useService(NavigationPanelService);
  const path = useMemo(() => [...parentPath, 'inbox'], [parentPath]);
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => navigationPanelService.setCollapsed(path, value),
    [navigationPanelService, path]
  );

  return (
    <NavigationPanelTreeNode
      icon={InboxNodeIcon}
      name={t['com.notesgraph.rootAppSidebar.notes.inbox']()}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      data-testid="navigation-panel-notes-inbox"
    >
      {orphanIds.map(id => (
        <NavigationPanelDocNode
          key={id}
          docId={id}
          parentPath={path}
          reorderable={false}
          alwaysShowChildren
        />
      ))}
    </NavigationPanelTreeNode>
  );
};

/**
 * Journal (daily) pages collect here — a dedicated node hung off the Home root —
 * instead of scattering through the Inbox. A doc is a journal page when it has a
 * valid `journal` date, the same first-class marker the rest of the app uses via
 * `JournalService.journalDate$` (not a bespoke title/regex check here).
 */
const JournalNode = ({
  parentPath,
  journalIds,
}: {
  parentPath: string[];
  journalIds: string[];
}) => {
  const t = useI18n();
  const navigationPanelService = useService(NavigationPanelService);
  const path = useMemo(() => [...parentPath, 'journal'], [parentPath]);
  const collapsed = useLiveData(navigationPanelService.collapsed$(path));
  const setCollapsed = useCallback(
    (value: boolean) => navigationPanelService.setCollapsed(path, value),
    [navigationPanelService, path]
  );

  return (
    <NavigationPanelTreeNode
      icon={JournalNodeIcon}
      name={t['com.notesgraph.journal.app-sidebar-title']()}
      collapsed={collapsed}
      setCollapsed={setCollapsed}
      collapsible
      data-testid="navigation-panel-notes-journal"
    >
      {journalIds.map(id => (
        <NavigationPanelDocNode
          key={id}
          docId={id}
          parentPath={path}
          reorderable={false}
          alwaysShowChildren
        />
      ))}
    </NavigationPanelTreeNode>
  );
};

/**
 * The automatic note tree. The Home doc is the pinned root (drop a note onto it
 * to reparent it); parentless notes collect in its Inbox; notes with outgoing
 * links nest their children. The grayscale search in the header filters across
 * ALL notes (not just the roots), while keeping the active note in view.
 */
export const NavigationPanelNotes = () => {
  const {
    docsService,
    docsSearchService,
    homeDocService,
    globalContextService,
    navigationPanelService,
    journalService,
    projectsService,
  } = useServices({
    DocsService,
    DocsSearchService,
    HomeDocService,
    GlobalContextService,
    NavigationPanelService,
    JournalService,
    ProjectsService,
  });
  const t = useI18n();
  const path = useMemo(() => ['notes'], []);
  const searchPath = useMemo(() => [...path, 'search'], [path]);

  useEffect(() => {
    homeDocService.ensureHomeDoc();
  }, [homeDocService]);
  const homeDocId = useLiveData(homeDocService.homeDocId$);
  const activeDocId = useLiveData(globalContextService.globalContext.docId.$);

  const edges = useLiveData(
    useMemo(
      () => LiveData.from(docsSearchService.watchAllRefs(), []),
      [docsSearchService]
    )
  );
  const optimisticLinks = useLiveData(navigationPanelService.optimisticLinks$);
  // Overlay optimistic links on top of the real (indexer-backed) edges so a
  // just-created linked doc is placed correctly before the indexer catches
  // up. Real edges win once they land — this only fills a gap, never
  // overrides indexed data.
  const mergedEdges = useMemo(() => {
    if (optimisticLinks.size === 0) {
      return edges;
    }
    const existing = new Set(edges.map(edge => `${edge.source} ${edge.target}`));
    const extra: { source: string; target: string }[] = [];
    for (const [child, parent] of optimisticLinks) {
      const key = `${parent} ${child}`;
      if (!existing.has(key)) {
        extra.push({ source: parent, target: child });
      }
    }
    return extra.length > 0 ? [...edges, ...extra] : edges;
  }, [edges, optimisticLinks]);
  // Drop an optimistic link once `edges` (the exact value this component
  // renders from) already contains the real one. Doing this here, against
  // the same `edges` snapshot used above, is what makes it race-free — a
  // caller clearing it based on its own separate indexer query can't
  // guarantee that query settles in lockstep with this component's `edges`
  // subscription, even against the same nominal data (two independent
  // queries against the indexer aren't linearizable with each other), which
  // reopens the exact gap this whole mechanism exists to close.
  useEffect(() => {
    if (optimisticLinks.size === 0) {
      return;
    }
    const real = new Set(edges.map(edge => `${edge.source} ${edge.target}`));
    for (const [child, parent] of optimisticLinks) {
      if (real.has(`${parent} ${child}`)) {
        navigationPanelService.clearOptimisticLink(child);
      }
    }
  }, [edges, optimisticLinks, navigationPanelService]);
  const nonTrashIds = useLiveData(docsService.list.nonTrashDocsIds$);
  const docsMap = useLiveData(docsService.list.docsMap$);
  const journalDocIds = useLiveData(journalService.allJournalDocIds$);
  const projects = useLiveData(projectsService.projects.projects$);

  // Docs that belong to a project render nested under their project node at the
  // tree root, so they must not also surface as loose Inbox roots.
  const projectDocIds = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects ?? []) {
      for (const docId of project.docIds) set.add(docId);
    }
    return set;
  }, [projects]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const trimmedQuery = query.trim().toLowerCase();
  // Defer the query the filter actually runs on. The `<input>` stays bound to
  // `query` so typing is always instant, while the O(all-notes) title scan +
  // locale sort below re-runs at a lower priority against `deferredQuery` —
  // keystrokes no longer block on filtering a large workspace.
  const deferredQuery = useDeferredValue(trimmedQuery);
  const filtering = searchOpen && deferredQuery.length > 0;

  const titleOf = useCallback(
    (id: string) => docsMap.get(id)?.title$.value || t['Untitled'](),
    [docsMap, t]
  );

  // The Inbox is what's left over after traversing every child node under the
  // user-profile (Home) root. For each leftover component we surface a single
  // entry: its disconnected root(s) — notes nobody links to — or, for a pure
  // reference loop (e.g. A↔B) that has no such root, the loop's first node by
  // id. Disconnected roots are taken before loops so a child that merely has a
  // lower id can't be mistaken for the root.
  // `parentOf` records, for every doc reachable in the tree, the first parent
  // that discovered it — enough to walk a path of ancestors back to a root
  // (Home or an Inbox root) for the "reveal active note" effect below.
  const { orphanIds, journalIds, parentOf } = useMemo(() => {
    const referenced = new Set(mergedEdges.map(edge => edge.target));
    const nonTrashSet = new Set(nonTrashIds);
    const childrenOf = new Map<string, string[]>();
    for (const edge of mergedEdges) {
      const arr = childrenOf.get(edge.source);
      if (arr) arr.push(edge.target);
      else childrenOf.set(edge.source, [edge.target]);
    }

    const reachable = new Set<string>();
    const parentOf = new Map<string, string>();
    const queue: string[] = [];
    let head = 0;
    const visit = (id: string, parent?: string) => {
      if (nonTrashSet.has(id) && !reachable.has(id)) {
        reachable.add(id);
        if (parent !== undefined) parentOf.set(id, parent);
        queue.push(id);
      }
    };
    const drain = () => {
      while (head < queue.length) {
        const cur = queue[head++];
        const kids = childrenOf.get(cur);
        if (kids) for (const kid of kids) visit(kid, cur);
      }
    };

    // 1) traverse all child nodes under Home
    if (homeDocId) visit(homeDocId);
    drain();

    // 2) surface a root for each leftover (not-reachable-from-Home) component.
    // Journal pages are diverted to their own list so they collect under the
    // dedicated Journal node instead of scattering through the Inbox. They're
    // still visited/drained so their referenced children stay reachable (and
    // render nested under the journal day, not as new inbox roots).
    const inboxRoots: string[] = [];
    const journalRoots: string[] = [];
    const addRoot = (id: string) => {
      // Project docs live under their project node at the root, not the Inbox.
      if (id === homeDocId || reachable.has(id) || projectDocIds.has(id)) return;
      if (journalDocIds.has(id)) journalRoots.push(id);
      else inboxRoots.push(id);
      visit(id);
      drain();
    };
    // disconnected roots: notes nobody links to
    for (const id of nonTrashIds) {
      if (!referenced.has(id)) addRoot(id);
    }
    // remaining leftovers are loops: take the first node by id
    for (const id of [...nonTrashIds].sort()) {
      addRoot(id);
    }

    return {
      orphanIds: inboxRoots.sort((a, b) =>
        titleOf(a).localeCompare(titleOf(b))
      ),
      // Most-recent day first — journal titles are `YYYY-MM-DD`, so a reverse
      // lexical sort is chronological.
      journalIds: journalRoots.sort((a, b) =>
        titleOf(b).localeCompare(titleOf(a))
      ),
      parentOf,
    };
  }, [mergedEdges, nonTrashIds, homeDocId, journalDocIds, projectDocIds, titleOf]);

  // Doc ids that have at least one non-trashed child in the note tree — the
  // doc nodes read this (via HasChildrenContext) to show a folder icon.
  const hasChildrenIds = useMemo(() => {
    const nonTrash = new Set(nonTrashIds);
    const set = new Set<string>();
    for (const edge of mergedEdges) {
      if (nonTrash.has(edge.target)) set.add(edge.source);
    }
    return set;
  }, [mergedEdges, nonTrashIds]);

  // Search runs across ALL notes (by title), not just the roots. The currently
  // selected note is always kept in the results so it stays in view.
  const searchResults = useMemo(() => {
    if (!filtering) {
      return [];
    }
    const ids = new Set(
      nonTrashIds.filter(id =>
        (docsMap.get(id)?.title$.value || '')
          .toLowerCase()
          .includes(deferredQuery)
      )
    );
    if (activeDocId && nonTrashIds.includes(activeDocId)) {
      ids.add(activeDocId);
    }
    return Array.from(ids).sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  }, [filtering, nonTrashIds, docsMap, deferredQuery, activeDocId, titleOf]);

  // Keep the selected note scrolled into view as the list filters.
  useEffect(() => {
    if (!filtering || !activeDocId) {
      return;
    }
    document
      .querySelector(`[data-testid="navigation-panel-doc-${activeDocId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [filtering, activeDocId, searchResults]);

  // Reveal the active note in the normal (non-filtering) tree: expand every
  // collapsed ancestor along its path from Home/Inbox, then scroll it into
  // view once its row actually mounts.
  useEffect(() => {
    if (filtering || !activeDocId || !nonTrashIds.includes(activeDocId)) {
      return;
    }

    const chain = [activeDocId];
    let cur = activeDocId;
    while (parentOf.has(cur)) {
      cur = parentOf.get(cur) as string;
      chain.push(cur);
    }
    chain.reverse();

    navigationPanelService.setCollapsed(path, false);
    let ancestorPath = path;
    if (chain[0] !== homeDocId) {
      // Leftover roots hang off either the Journal node (journal days) or the
      // Inbox node (everything else) — expand the right one.
      ancestorPath = [...path, journalDocIds.has(chain[0]) ? 'journal' : 'inbox'];
      navigationPanelService.setCollapsed(ancestorPath, false);
    }
    for (const id of chain) {
      ancestorPath = [...ancestorPath, `doc-${id}`];
      if (id !== activeDocId) {
        navigationPanelService.setCollapsed(ancestorPath, false);
      }
    }

    let cancelled = false;
    let raf = 0;
    let attempts = 0;
    const selector = `[data-testid="navigation-panel-doc-${activeDocId}"]`;
    const tryScroll = () => {
      if (cancelled) return;
      const el = document.querySelector(selector);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (attempts++ < 60) {
        raf = requestAnimationFrame(tryScroll);
      }
    };
    raf = requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [
    filtering,
    activeDocId,
    nonTrashIds,
    parentOf,
    homeDocId,
    journalDocIds,
    path,
    navigationPanelService,
  ]);

  const toggleSearch = useCallback(() => {
    setSearchOpen(open => {
      if (open) {
        setQuery('');
      } else {
        // Make sure the section is expanded so the input + results are visible.
        navigationPanelService.setCollapsed(path, false);
      }
      return !open;
    });
  }, [navigationPanelService, path]);

  return (
    <CollapsibleSection
      path={path}
      title={t['com.notesgraph.rootAppSidebar.notes']()}
      alwaysShowActions
      actions={
        <IconButton
          size="16"
          onClick={toggleSearch}
          tooltip={t['com.notesgraph.rootAppSidebar.notes.search']()}
          data-testid="navigation-panel-notes-search-button"
          style={{ color: cssVarV2('icon/secondary') }}
        >
          <SearchIcon />
        </IconButton>
      }
    >
      {searchOpen ? (
        <div style={{ padding: '2px 8px 6px' }}>
          <input
            autoFocus
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                toggleSearch();
              }
            }}
            placeholder={t['com.notesgraph.rootAppSidebar.notes.search']()}
            data-testid="navigation-panel-notes-search-input"
            style={{
              width: '100%',
              boxSizing: 'border-box',
              height: 28,
              padding: '0 8px',
              borderRadius: 4,
              border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
              background: cssVarV2('layer/background/secondary'),
              color: cssVarV2('text/primary'),
              fontSize: 12,
              outline: 'none',
              filter: 'grayscale(1)',
            }}
          />
        </div>
      ) : null}

      <HasChildrenContext.Provider value={hasChildrenIds}>
        <NavigationPanelTreeRoot>
          {filtering ? (
            searchResults.map(id => (
              <NavigationPanelDocNode
                key={id}
                docId={id}
                parentPath={searchPath}
                reorderable={false}
                alwaysShowChildren
              />
            ))
          ) : (
            <>
              {/* Projects are first-class roots in the note tree: each renders
                  as a top-level folder with its docs nested. */}
              {(projects ?? []).map(project => (
                <NavigationPanelProjectNode
                  key={project.id}
                  projectId={project.id}
                  reorderable={false}
                  parentPath={path}
                />
              ))}
              {homeDocId ? (
                <NavigationPanelDocNode
                  docId={homeDocId}
                  parentPath={path}
                  reorderable={false}
                  alwaysShowChildren
                  defaultCollapsed={false}
                  trailingChildren={
                    <>
                      {journalIds.length > 0 ? (
                        <JournalNode parentPath={path} journalIds={journalIds} />
                      ) : null}
                      <InboxNode parentPath={path} orphanIds={orphanIds} />
                    </>
                  }
                />
              ) : null}
            </>
          )}
        </NavigationPanelTreeRoot>
      </HasChildrenContext.Provider>
    </CollapsibleSection>
  );
};
