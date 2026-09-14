import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { ProjectsService } from '@notesgraph/core/modules/projects';
import { useServices } from '@notesgraph/infra';
import { useEffect } from 'react';

/**
 * Watches `docId`'s outbound links (mentions, `[[...]]`, embedded docs) for
 * newly-added references. If a new link crosses a Project boundary — one
 * side is in a Project the other isn't, or they're in different Projects —
 * opens a confirmation dialog so the user can decide whether that visibility
 * change was intentional, rather than it happening silently.
 *
 * Only reacts to links added *after* mount (the doc's pre-existing links are
 * seeded silently on the first emission), and only while `enabled`.
 */
export function useDocProjectLinkGuard(docId: string, enabled: boolean) {
  const { docsSearchService, projectsService, workspaceDialogService } =
    useServices({
      DocsSearchService,
      ProjectsService,
      WorkspaceDialogService,
    });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let seen: Set<string> | null = null;
    const subscription = docsSearchService
      .watchRefsFrom(docId)
      .subscribe(links => {
        const linkIds = links.map(link => link.docId);

        if (seen === null) {
          seen = new Set(linkIds);
          return;
        }

        for (const targetDocId of linkIds) {
          if (seen.has(targetDocId)) {
            continue;
          }
          seen.add(targetDocId);

          const sourceProject = projectsService.getProjectForDoc(docId);
          const targetProject =
            projectsService.getProjectForDoc(targetDocId);
          const crossesProjectBoundary =
            (sourceProject || targetProject) &&
            sourceProject?.id !== targetProject?.id;

          if (crossesProjectBoundary) {
            workspaceDialogService.open('link-visibility-confirm', {
              sourceDocId: docId,
              targetDocId,
            });
          }
        }

        for (const id of Array.from(seen)) {
          if (!linkIds.includes(id)) {
            seen.delete(id);
          }
        }
      });

    return () => subscription.unsubscribe();
  }, [docId, enabled, docsSearchService, projectsService, workspaceDialogService]);
}
