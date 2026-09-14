import {
  type DropTargetDropEvent,
  type DropTargetOptions,
  Loading,
  toast,
  Tooltip,
} from '@notesgraph/component';
import { Guard } from '@notesgraph/core/components/guard';
import { useAppSettingHelper } from '@notesgraph/core/components/hooks/notesgraph/use-app-setting-helper';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { WorkspaceDialogService } from '@notesgraph/core/modules/dialogs';
import { DocsService } from '@notesgraph/core/modules/doc';
import { DocDisplayMetaService } from '@notesgraph/core/modules/doc-display-meta';
import { DocsSearchService } from '@notesgraph/core/modules/docs-search';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { HomeDocService } from '@notesgraph/core/modules/home-doc';
import { NavigationPanelService } from '@notesgraph/core/modules/navigation-panel';
import { GuardService } from '@notesgraph/core/modules/permissions';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import type { NotesGraphDNDData } from '@notesgraph/core/types/dnd';
import { useI18n } from '@notesgraph/i18n';
import {
  LiveData,
  MANUALLY_STOP,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import { track } from '@notesgraph/track';
import {
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

import { HasChildrenContext } from './has-children-context';
import { NEVER } from 'rxjs';

import {
  NavigationPanelTreeNode,
  type NavigationPanelTreeNodeDropEffect,
} from '../../tree';
import type { GenericNavigationPanelNode } from '../types';
import { Empty } from './empty';
import { useNavigationPanelDocNodeOperations } from './operations';
import * as styles from './styles.css';

export const NavigationPanelDocNode = ({
  docId,
  onDrop,
  location,
  reorderable,
  isLinked,
  alwaysShowChildren,
  leadingChildren,
  trailingChildren,
  defaultCollapsed,
  canDrop,
  operations: additionalOperations,
  dropEffect,
  parentPath,
}: {
  docId: string;
  isLinked?: boolean;
  /**
   * Render a doc's outgoing linked docs as nested children regardless of the
   * `showLinkedDocInSidebar` app setting. Used by the auto note-tree so any note
   * with children behaves like a folder.
   */
  alwaysShowChildren?: boolean;
  /**
   * Extra nodes rendered above the doc's linked-doc children — used to inject
   * the Inbox under the Home node.
   */
  leadingChildren?: ReactNode;
  /**
   * Extra nodes rendered below the doc's linked-doc children — used to pin the
   * Inbox to the bottom of the Home node's list.
   */
  trailingChildren?: ReactNode;
  /** Collapsed state to use when nothing is stored yet (defaults to collapsed). */
  defaultCollapsed?: boolean;
  forwardKey?: string;
} & GenericNavigationPanelNode) => {
  const t = useI18n();
  const {
    docsSearchService,
    workspaceService,
    docsService,
    globalContextService,
    docDisplayMetaService,
    featureFlagService,
    guardService,
  } = useServices({
    WorkspaceService,
    DocsSearchService,
    DocsService,
    GlobalContextService,
    DocDisplayMetaService,
    FeatureFlagService,
    GuardService,
  });
  const navigationPanelService = useService(NavigationPanelService);
  // The Home doc is pinned as the root of the note tree, so never let it appear
  // nested as a linked child of another note.
  const homeDocId = useLiveData(useService(HomeDocService).homeDocId$);
  const { appSettings } = useAppSettingHelper();

  const active =
    useLiveData(globalContextService.globalContext.docId.$) === docId;
  const path = useMemo(
    () => [...(parentPath ?? []), `doc-${docId}`],
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
  const showChildren =
    alwaysShowChildren || !!appSettings.showLinkedDocInSidebar;
  const isCollapsed = showChildren ? collapsed : true;

  const docRecord = useLiveData(docsService.list.doc$(docId));
  // Notes that contain other notes show a folder icon (see HasChildrenContext).
  const hasChildren = useContext(HasChildrenContext).has(docId);
  // Whether this row has anything to expand. hasChildren only covers doc→doc
  // links, but a caller can also inject rows of its own — the Notes section
  // hangs the Journal and Inbox nodes off Home as trailingChildren, which are
  // real children the tree renders even when Home links to no docs at all.
  // Those have to count here, or the row renders children it can never
  // collapse (the chevron is the only affordance: doc rows pass both onClick
  // and `to`, so NavigationPanelTreeNode's click-for-collapse path is off).
  const expandable =
    hasChildren || Boolean(leadingChildren) || Boolean(trailingChildren);
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
    ({ className }: { className?: string }) => {
      return <DocIcon className={className} />;
    },
    [DocIcon]
  );

  const children = useLiveData(
    useMemo(
      () =>
        LiveData.from(
          !isCollapsed ? docsSearchService.watchRefsFrom(docId) : NEVER,
          null
        ),
      [docsSearchService, docId, isCollapsed]
    )
  );
  const searching = children === null;

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

  const dndData = useMemo(() => {
    return {
      draggable: {
        entity: {
          type: 'doc',
          id: docId,
        },
        from: location,
      },
      dropTarget: {
        at: 'navigation-panel:doc',
      },
    } satisfies NotesGraphDNDData;
  }, [docId, location]);

  const handleRename = useAsyncCallback(
    async (newName: string) => {
      await docsService.changeDocTitle(docId, newName);
      track.$.navigationPanel.organize.renameOrganizeItem({ type: 'doc' });
    },
    [docId, docsService]
  );

  const handleDropOnDoc = useAsyncCallback(
    async (data: DropTargetDropEvent<NotesGraphDNDData>) => {
      if (data.treeInstruction?.type === 'make-child') {
        if (data.source.data.entity?.type === 'doc') {
          const canEdit = await guardService.can('Doc_Update', docId);
          if (!canEdit) {
            toast(t['com.notesgraph.no-permission']());
            return;
          }
          await docsService.addLinkedDoc(docId, data.source.data.entity.id);
          // Move (cut), not copy: if the note was dragged from another parent
          // in the tree, disconnect it from that previous parent.
          const from = data.source.data.from;
          if (
            from?.at === 'navigation-panel:doc:linked-docs' &&
            from.docId !== docId
          ) {
            await docsService.removeLinkedDoc(
              from.docId,
              data.source.data.entity.id
            );
          }
          track.$.navigationPanel.docs.linkDoc({
            control: 'drag',
          });
          track.$.navigationPanel.docs.drop({
            type: data.source.data.entity.type,
          });
        } else {
          toast(t['com.notesgraph.rootAppSidebar.doc.link-doc-only']());
        }
      } else {
        onDrop?.(data);
      }
    },
    [docId, docsService, guardService, onDrop, t]
  );

  const handleDropEffectOnDoc = useCallback<NavigationPanelTreeNodeDropEffect>(
    data => {
      if (data.treeInstruction?.type === 'make-child') {
        if (data.source.data.entity?.type === 'doc') {
          return 'link';
        }
      } else {
        return dropEffect?.(data);
      }
      return;
    },
    [dropEffect]
  );

  const handleDropOnPlaceholder = useAsyncCallback(
    async (data: DropTargetDropEvent<NotesGraphDNDData>) => {
      if (data.source.data.entity?.type === 'doc') {
        const canEdit = await guardService.can('Doc_Update', docId);
        if (!canEdit) {
          toast(t['com.notesgraph.no-permission']());
          return;
        }
        // TODO(eyhn): timeout&error handling
        await docsService.addLinkedDoc(docId, data.source.data.entity.id);
        // Move (cut), not copy: disconnect from the previous parent.
        const from = data.source.data.from;
        if (
          from?.at === 'navigation-panel:doc:linked-docs' &&
          from.docId !== docId
        ) {
          await docsService.removeLinkedDoc(
            from.docId,
            data.source.data.entity.id
          );
        }
        track.$.navigationPanel.docs.linkDoc({
          control: 'drag',
        });
        track.$.navigationPanel.docs.drop({
          type: data.source.data.entity.type,
        });
      } else {
        toast(t['com.notesgraph.rootAppSidebar.doc.link-doc-only']());
      }
    },
    [docId, docsService, guardService, t]
  );

  const handleCanDrop = useMemo<
    DropTargetOptions<NotesGraphDNDData>['canDrop']
  >(
    () => args => {
      const entityType = args.source.data.entity?.type;
      return args.treeInstruction?.type !== 'make-child'
        ? ((typeof canDrop === 'function' ? canDrop(args) : canDrop) ?? true)
        : entityType === 'doc';
    },
    [canDrop]
  );

  const workspaceDialogService = useService(WorkspaceDialogService);
  const operations = useNavigationPanelDocNodeOperations(
    docId,
    useMemo(
      () => ({
        openInfoModal: () => workspaceDialogService.open('doc-info', { docId }),
        openNodeCollapsed: () => setCollapsed(false),
      }),
      [docId, setCollapsed, workspaceDialogService]
    )
  );

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
      dndData={dndData}
      onDrop={handleDropOnDoc}
      renameable
      extractEmojiAsIcon={enableEmojiIcon}
      collapsed={isCollapsed}
      setCollapsed={setCollapsed}
      // expandable's hasChildren half (HasChildrenContext) is computed
      // eagerly workspace-wide (watchAllRefs), unlike `children` below which
      // only loads once expanded — safe to gate the toggle on without the
      // chicken-and-egg problem of reading a list that expansion populates.
      collapsible={showChildren && expandable}
      canDrop={handleCanDrop}
      to={`/${docId}`}
      onClick={() => {
        track.$.navigationPanel.docs.openDoc();
        // Opening a note from the sidebar also expands it to reveal its
        // children — but only if it actually has any (expandable, unlike
        // `children` below, is known without waiting for expansion).
        if (showChildren && expandable) {
          setCollapsed(false);
        }
      }}
      active={active}
      postfix={
        referencesLoading &&
        !isCollapsed && (
          <Tooltip
            content={t[
              'com.notesgraph.rootAppSidebar.docs.references-loading'
            ]()}
          >
            <div className={styles.loadingIcon}>
              <Loading />
            </div>
          </Tooltip>
        )
      }
      reorderable={reorderable}
      renameableGuard={{
        docId,
        action: 'Doc_Update',
      }}
      onRename={handleRename}
      childrenPlaceholder={
        leadingChildren || trailingChildren || searching ? null : (
          <Empty
            onDrop={handleDropOnPlaceholder}
            noAccessible={!!children && children.length > 0}
          />
        )
      }
      operations={finalOperations}
      dropEffect={handleDropEffectOnDoc}
      data-testid={`navigation-panel-doc-${docId}`}
      explorerIconConfig={{
        where: 'doc',
        id: docId,
      }}
    >
      {leadingChildren}
      {showChildren ? (
        <Guard docId={docId} permission="Doc_Read">
          {canRead =>
            canRead
              ? children
                  ?.filter(child => child.docId !== homeDocId)
                  .map((child, index) => (
                    <NavigationPanelDocNode
                      key={`${child.docId}-${index}`}
                      docId={child.docId}
                      reorderable={false}
                      location={{
                        at: 'navigation-panel:doc:linked-docs',
                        docId,
                      }}
                      parentPath={path}
                      isLinked
                      alwaysShowChildren={alwaysShowChildren}
                    />
                  ))
              : null
          }
        </Guard>
      ) : null}
      {trailingChildren}
    </NavigationPanelTreeNode>
  );
};
