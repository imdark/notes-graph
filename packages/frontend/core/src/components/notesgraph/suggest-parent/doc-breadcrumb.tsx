import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useService } from '@notesgraph/infra';

import * as styles from './doc-breadcrumb.css';
import { useParentChain } from './use-suggest-parent';

/**
 * A simple breadcrumb of the doc's ancestors (top → immediate parent), shown
 * above the title. Click a crumb to open that parent. Renders nothing when the
 * doc has no parents.
 */
export const DocBreadcrumb = ({ docId }: { docId: string }) => {
  const chain = useParentChain(docId);
  const workspaceId = useService(WorkspaceService).workspace.id;
  const { openPage } = useNavigateHelper();

  if (chain.length === 0) return null;

  return (
    <nav
      className={styles.breadcrumb}
      aria-label="Parent notes"
      data-testid="doc-breadcrumb"
    >
      {chain.map(crumb => (
        <span key={crumb.docId} className={styles.item}>
          <button
            type="button"
            className={styles.crumb}
            title={crumb.title || 'Untitled'}
            data-testid="doc-breadcrumb-crumb"
            onClick={() => openPage(workspaceId, crumb.docId)}
          >
            {crumb.title || 'Untitled'}
          </button>
          <span className={styles.sep} aria-hidden>
            ›
          </span>
        </span>
      ))}
    </nav>
  );
};
