import { Loading } from '@notesgraph/component';
import { Guard } from '@notesgraph/core/components/guard';
import type { NodeOperation } from '@notesgraph/core/desktop/components/navigation-panel';
import { HasChildrenContext } from '@notesgraph/core/desktop/components/navigation-panel/nodes/doc/has-children-context';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocDisplayMetaService } from '@notesgraph/core/modules/doc-display-meta';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import {
  LiveData,
  MANUALLY_STOP,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import {
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { NEVER } from 'rxjs';

import { AddItemPlaceholder } from '../../layouts/add-item-placeholder';
import { NavigationPanelTreeNode } from '../../tree/node';
import {
  useNavigationPanelDocNodeOperations,
  useNavigationPanelDocNodeOperationsMenu,
} from './operations';
import * as styles from './styles.css';

const NavigationPanelDocNodeImpl = ({
  docId,
  isLinked,
  operations: additionalOperations,
  parentPath,
  defaultCollapsed,
  trailingChildren,
}: {
  docId: string;
  isLinked?: boolean;
  operations?: NodeOperation[];
  parentPath: string[];
  /** Collapsed state to use when nothing is stored yet (defaults to collapsed). */
  defaultCollapsed?: boolean;
  /** Extra nodes rendered below the doc's linked-doc children. */
  trailingChildren?: ReactNode;
  /** Accepted for parity with the desktop row; mobile has no drag and drop. */
  reorderable?: boolean;
  /** Accepted for parity with the desktop row; mobile always nests children. */
  alwaysShowChildren?: boolean;
}) => {
  const {
    docsSearchService,
    docsService,
    globalContextService,
    docDisplayMetaService,
    featureFlagService,
    workspaceService,
  } = useServices({
    DocsSearchService,
    WorkspaceService,
    DocsService,
    GlobalContextService,
    DocDisplayMetaService,
    FeatureFlagService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  const active =
    useLiveData(globalContextService.globalContext.docId.$) === docId;
  const path = useMemo(
    () => [...parentPath, `doc-${docId}`],
    [parentPath, docId]
  );
  const collapsed = useLiveData(
    navigationPanelService.collapsed$(path, defaultCollapsed)
  );
  const setCollapsed = useCallback(
    (value: boolean) => {
      navigationPanelService.setCollapsed(path, value);
    },
    [navigationPanelService, path]
  );

  const docRecord = useLiveData(docsService.list.doc$(docId));
  // Known workspace-wide from the notes tree's single ref-graph query, so a
  // collapsed row can show a folder icon and a chevron without its own
  // indexer subscription.
  const hasChildren = useContext(HasChildrenContext).has(docId);
  const DocIcon = useLiveData(
    docDisplayMetaService.icon$(docId, {
      reference: isLinked,
      hasChildren,
    })
  );

  const docTitle = useLiveData(docDisplayMetaService.title$(docId));
  const isInTrash = useLiveData(docRecord?.trash$);
  const enableEmojiIcon = useLiveData(
    featureFlagService.flags.enable_emoji_doc_icon.$
  );

  const Icon = useCallback(
    ({ className }: { className?: string }) => (
      <DocIcon className={className} />
    ),
    [DocIcon]
  );

  // Only an expanded row queries the indexer for its children. With a few
  // hundred rows on the Home screen, a query per collapsed row was most of
  // the tree's cost.
  const children = useLiveData(
    useMemo(
      () =>
        LiveData.from(
          collapsed ? NEVER : docsSearchService.watchRefsFrom(docId),
          null
        ),
      [docsSearchService, docId, collapsed]
    )
  );

  const [referencesLoading, setReferencesLoading] = useState(true);
  useLayoutEffect(() => {
    if (collapsed) {
      return;
    }
    const abortController = new AbortController();
    const undoSync = workspaceService.workspace.engine.doc.addPriority(
      docId,
      10
    );
    const undoIndexer = docsSearchService.indexer.addPriority(docId, 10);
    docsSearchService.indexer
      .waitForDocCompleted(docId, abortController.signal)
      .then(() => {
        setReferencesLoading(false);
      })
      .catch(err => {
        if (err !== MANUALLY_STOP) {
          console.error(err);
        }
      });
    return () => {
      undoSync();
      undoIndexer();
      abortController.abort(MANUALLY_STOP);
    };
  }, [docId, docsSearchService, workspaceService, collapsed]);

  const workspaceDialogService = useService(WorkspaceDialogService);
  const option = useMemo(
    () => ({
      openInfoModal: () => workspaceDialogService.open('doc-info', { docId }),
      openNodeCollapsed: () => setCollapsed(false),
    }),
    [docId, setCollapsed, workspaceDialogService]
  );
  const operations = useNavigationPanelDocNodeOperationsMenu(docId, option);

  const finalOperations = useMemo(() => {
    if (additionalOperations) {
      return [...operations, ...additionalOperations];
    }
    return operations;
  }, [additionalOperations, operations]);

  if (isInTrash || !docRecord) {
    return null;
  }

  return (
    <NavigationPanelTreeNode
      icon={Icon}
      name={docTitle}
      extractEmojiAsIcon={enableEmojiIcon}
      collapsed={collapsed}
      collapsible={
        hasChildren ||
        Boolean(trailingChildren) ||
        (!!children && children.length > 0)
      }
      setCollapsed={setCollapsed}
      to={`/${docId}`}
      active={active}
      postfix={
        referencesLoading &&
        !collapsed && (
          <div className={styles.loadingIcon}>
            <Loading />
          </div>
        )
      }
      operations={finalOperations}
      data-testid={`navigation-panel-doc-${docId}`}
    >
      <Guard docId={docId} permission="Doc_Read">
        {canRead =>
          canRead
            ? children?.map((child, index) => (
                <NavigationPanelDocNode
                  key={`${child.docId}-${index}`}
                  docId={child.docId}
                  isLinked
                  parentPath={path}
                />
              ))
            : null
        }
      </Guard>
      {trailingChildren}
      <Guard docId={docId} permission="Doc_Update">
        {canEdit =>
          canEdit ? (
            <AddLinkedDocPlaceholder docId={docId} options={option} />
          ) : null
        }
      </Guard>
    </NavigationPanelTreeNode>
  );
};

// Its own component so the operations hook only runs for expanded rows (the
// tree node renders children only when expanded).
const AddLinkedDocPlaceholder = ({
  docId,
  options,
}: {
  docId: string;
  options: { openNodeCollapsed: () => void };
}) => {
  const t = useI18n();
  const { handleAddLinkedPage } = useNavigationPanelDocNodeOperations(
    docId,
    options
  );
  return (
    <AddItemPlaceholder
      label={t['com.notesgraph.rootAppSidebar.explorer.doc-add-tooltip']()}
      onClick={handleAddLinkedPage}
    />
  );
};

// Memoized for the same reason as the desktop node: a parent list re-render
// must not re-render every row.
export const NavigationPanelDocNode = memo(NavigationPanelDocNodeImpl);
NavigationPanelDocNode.displayName = 'NavigationPanelDocNode';
