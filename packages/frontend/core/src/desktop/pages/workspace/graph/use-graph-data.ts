import { IconType } from '@notesgraph/component';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { ExplorerIconService } from '@notesgraph/core/modules/explorer-icon/services/explorer-icon';
import { LiveData, useLiveData, useService } from '@notesgraph/infra';
import { useMemo } from 'react';

import { extractEmojiIcon } from '../../../../utils/extract-emoji-icon';

/**
 * Hard cap on the number of nodes rendered. Beyond this, the highest-degree
 * docs are kept and the rest are dropped (with a notice in the UI). Keeps the
 * force simulation responsive on large workspaces.
 */
export const MAX_GRAPH_NODES = 1500;

export interface GraphNodeData {
  id: string;
  title: string;
  /** number of links incident to this node (used for sizing) */
  degree: number;
  /** doc creation timestamp — children are laid out newest-first */
  createdAt: number;
  /** the doc's emoji icon (custom or leading title emoji), drawn in the node */
  icon?: string;
}

export interface GraphLinkData {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNodeData[];
  links: GraphLinkData[];
  /** total number of non-trash docs, before truncation */
  totalDocCount: number;
  /** true when totalDocCount exceeded MAX_GRAPH_NODES and nodes were capped */
  truncated: boolean;
}

/**
 * Builds the workspace-wide document graph: one node per (non-trash) doc, one
 * link per doc→doc reference. Reuses {@link DocsService} for the node set and
 * {@link DocsSearchService.watchAllRefs} for the edges; both update live.
 */
export function useGraphData(): GraphData {
  const docsService = useService(DocsService);
  const docsSearchService = useService(DocsSearchService);
  const explorerIconService = useService(ExplorerIconService);
  const docIcons = useLiveData(explorerIconService.docIcons$);

  const refs$ = useMemo(
    () => LiveData.from<GraphLinkData[]>(docsSearchService.watchAllRefs(), []),
    [docsSearchService]
  );
  const allLinks = useLiveData(refs$);
  const docsMap = useLiveData(docsService.list.docsMap$);
  // Reactive set of non-trash doc ids — updates when a doc is trashed/restored,
  // so the graph refreshes. (Reading `doc.trash$.value` inside the memo below
  // wouldn't, since the memo only re-runs when these inputs change.)
  const nonTrashIds = useLiveData(docsService.list.nonTrashDocsIds$);

  return useMemo(() => {
    // id -> title / createDate / icon for every non-trash doc.
    const titleById = new Map<string, string>();
    const createdById = new Map<string, number>();
    const iconById = new Map<string, string>();
    for (const id of nonTrashIds) {
      const doc = docsMap.get(id);
      if (doc) {
        const rawTitle = doc.title$.value || 'Untitled';
        const customIcon = docIcons.get(id);
        if (customIcon?.type === IconType.Emoji) {
          iconById.set(id, customIcon.unicode);
          titleById.set(id, rawTitle);
        } else {
          // Fall back to a leading emoji in the title (matches the sidebar),
          // stripping it from the label so it isn't shown twice.
          const { emoji, rest } = extractEmojiIcon(rawTitle);
          if (emoji) {
            iconById.set(id, emoji);
            titleById.set(id, rest.trim() || rawTitle);
          } else {
            titleById.set(id, rawTitle);
          }
        }
        createdById.set(id, doc.meta$.value.createDate ?? 0);
      }
    }

    const totalDocCount = titleById.size;

    // Keep only links whose endpoints are both real, non-trash docs, and
    // accumulate degree for sizing / truncation ranking.
    const degree = new Map<string, number>();
    const validLinks: GraphLinkData[] = [];
    for (const link of allLinks) {
      if (!titleById.has(link.source) || !titleById.has(link.target)) {
        continue;
      }
      validLinks.push(link);
      degree.set(link.source, (degree.get(link.source) ?? 0) + 1);
      degree.set(link.target, (degree.get(link.target) ?? 0) + 1);
    }

    let nodeIds = Array.from(titleById.keys());
    let truncated = false;
    if (nodeIds.length > MAX_GRAPH_NODES) {
      truncated = true;
      nodeIds = nodeIds
        .sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))
        .slice(0, MAX_GRAPH_NODES);
    }
    const kept = new Set(nodeIds);

    const nodes: GraphNodeData[] = nodeIds.map(id => ({
      id,
      title: titleById.get(id) as string,
      degree: degree.get(id) ?? 0,
      createdAt: createdById.get(id) ?? 0,
      icon: iconById.get(id),
    }));

    const links = truncated
      ? validLinks.filter(l => kept.has(l.source) && kept.has(l.target))
      : validLinks;

    return { nodes, links, totalDocCount, truncated };
  }, [docsMap, nonTrashIds, allLinks, docIcons]);
}
