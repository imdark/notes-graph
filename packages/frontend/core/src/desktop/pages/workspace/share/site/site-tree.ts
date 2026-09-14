import type { SiteManifestPage } from '@notesgraph/core/modules/share-doc';

export interface SiteTreeNode extends SiteManifestPage {
  children: SiteTreeNode[];
}

/**
 * Turn the flat, parent-linked manifest page list into a nested tree, sorted by
 * `order` at every level. A page whose `parentId` isn't in the set (or is null)
 * becomes a top-level node, so an orphaned page is never dropped from the menu.
 */
export function buildSiteTree(pages: SiteManifestPage[]): SiteTreeNode[] {
  const nodes = new Map<string, SiteTreeNode>(
    pages.map(p => [p.docId, { ...p, children: [] }])
  );
  const roots: SiteTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (list: SiteTreeNode[]) => {
    list.sort((a, b) => a.order - b.order);
    list.forEach(n => sort(n.children));
  };
  sort(roots);
  return roots;
}
