import {
  AiIcon,
  ChartPanelIcon,
  CommentIcon,
  ExportIcon,
  FrameIcon,
  LinkedPageIcon,
  PropertyIcon,
  TocIcon,
  TodayIcon,
  ToolIcon,
} from '@blocksuite/icons/rc';
import { DisposableGroup } from '@blocksuite/notesgraph/global/disposable';
import { RefNodeSlotsProvider } from '@blocksuite/notesgraph/inlines/reference';
import { focusBlockEnd } from '@blocksuite/notesgraph/shared/commands';
import { getLastNoteBlock } from '@blocksuite/notesgraph/shared/utils';
import { Scrollable } from '@notesgraph/component';
import { PageDetailLoading } from '@notesgraph/component/page-detail-skeleton';
// Type-only import is erased at build; the AIAppEvents *value* (which drags in
// the ~9MB blocksuite/ai bundle) is imported dynamically in the effect below.
import type { AIChatParams } from '@notesgraph/core/blocksuite/ai';
import type { NotesGraphEditorContainer } from '@notesgraph/core/blocksuite/block-suite-editor';
import { EditorOutlineViewer } from '@notesgraph/core/blocksuite/outline-viewer';
import { CommentSidebar } from '@notesgraph/core/components/comment/sidebar';
import { useGuard } from '@notesgraph/core/components/guard';
import { useAppSettingHelper } from '@notesgraph/core/components/hooks/notesgraph/use-app-setting-helper';
import { useRegisterBlocksuiteEditorCommands } from '@notesgraph/core/components/hooks/notesgraph/use-register-blocksuite-editor-commands';
import { useRegisterSelectionEditCommands } from '@notesgraph/core/components/hooks/notesgraph/use-register-selection-edit-commands';
import { useActiveBlocksuiteEditor } from '@notesgraph/core/components/hooks/use-block-suite-editor';
import { NotesGraphErrorBoundary } from '@notesgraph/core/components/notesgraph/notesgraph-error-boundary';
import { SuggestedParentBanner } from '@notesgraph/core/components/notesgraph/suggest-parent';
// import { PageAIOnboarding } from '@notesgraph/core/components/notesgraph/ai-onboarding';
import { GlobalPageHistoryModal } from '@notesgraph/core/components/notesgraph/page-history-modal';
import { PageDetailEditor } from '@notesgraph/core/components/page-detail-editor';
import { WorkspacePropertySidebar } from '@notesgraph/core/components/properties/sidebar';
import { TrashPageFooter } from '@notesgraph/core/components/pure/trash-page-footer';
import { TopTip } from '@notesgraph/core/components/top-tip';
import {
  AiBackendService,
  RelatedDocsPanel,
} from '@notesgraph/core/modules/ai-local';
import { ServerService } from '@notesgraph/core/modules/cloud';
import { DocService, DocsService } from '@notesgraph/core/modules/doc';
import { EditorService } from '@notesgraph/core/modules/editor';
import { FeatureFlagService } from '@notesgraph/core/modules/feature-flag';
import { GlobalContextService } from '@notesgraph/core/modules/global-context';
import { JournalService } from '@notesgraph/core/modules/journal';
import { PeekViewService } from '@notesgraph/core/modules/peek-view';
import { PluginSidebarTabs } from '@notesgraph/core/modules/plugin';
import { RecentDocsService } from '@notesgraph/core/modules/quicksearch';
import {
  useIsActiveView,
  ViewBody,
  ViewHeader,
  ViewService,
  ViewSidebarTab,
  WorkbenchService,
} from '@notesgraph/core/modules/workbench';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { isNewTabTrigger } from '@notesgraph/core/utils';
import { ServerFeature } from '@notesgraph/graphql';
import {
  FrameworkScope,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import track from '@notesgraph/track';
import clsx from 'clsx';
import { nanoid } from 'nanoid';
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useParams } from 'react-router-dom';
import type { Subscription } from 'rxjs';

import { PageNotFound } from '../../404';
import { DayScheduleSection } from './day-schedule-section';
import * as styles from './detail-page.css';
import { DetailPageHeader } from './detail-page-header';
import { DetailPageWrapper } from './detail-page-wrapper';
import { EditorAdapterPanel } from './tabs/adapter';
import { EditorAnalyticsPanel } from './tabs/analytics';
import { EditorFramePanel } from './tabs/frame';
import { EditorJournalPanel } from './tabs/journal';
import { EditorOutlinePanel } from './tabs/outline';

// The chat sidebar tab mounts the AI chat UI (~9MB blocksuite/ai). Load it only
// when the tab is actually rendered, not with the doc detail page itself.
const EditorChatPanel = lazy(() =>
  import('./tabs/chat').then(m => ({ default: m.EditorChatPanel }))
);

// The agents panel resolves the executor, which pulls in the on-device model
// plumbing; keep it off the doc page's critical path like the chat panel.
const EditorAgentsPanel = lazy(() =>
  import('./tabs/agents').then(m => ({ default: m.EditorAgentsPanel }))
);

const DetailPageImpl = memo(function DetailPageImpl() {
  const {
    workbenchService,
    viewService,
    editorService,
    docService,
    workspaceService,
    globalContextService,
  } = useServices({
    WorkbenchService,
    ViewService,
    EditorService,
    DocService,
    WorkspaceService,
    GlobalContextService,
  });
  const workbench = workbenchService.workbench;
  const editor = editorService.editor;
  const view = viewService.view;
  const workspace = workspaceService.workspace;
  const globalContext = globalContextService.globalContext;
  const doc = docService.doc;

  const mode = useLiveData(editor.mode$);
  const activeSidebarTab = useLiveData(view.activeSidebarTab$);

  const isInTrash = useLiveData(doc.meta$.map(meta => meta.trash));
  const editorContainer = useLiveData(editor.editorContainer$);

  const isSideBarOpen = useLiveData(workbench.sidebarOpen$);
  const { appSettings } = useAppSettingHelper();

  const peekView = useService(PeekViewService).peekView;

  const isActiveView = useIsActiveView();
  // TODO(@eyhn): remove jotai here
  const [_, setActiveBlockSuiteEditor] = useActiveBlocksuiteEditor();

  // Latches once the chat side panel has been opened, so its ~9MB bundle is
  // fetched on first use rather than on every doc page load. See the chat
  // ViewSidebarTab below.
  const [chatTabOpened, setChatTabOpened] = useState(false);
  const [agentsTabOpened, setAgentsTabOpened] = useState(false);
  const isLocalAi =
    useLiveData(useService(AiBackendService).backend$) === 'local';
  const docsService = useService(DocsService);
  const openRelatedDoc = useCallback(
    (id: string) => workbench.openDoc(id, { at: 'active' }),
    [workbench]
  );
  const getRelatedDocTitle = useCallback(
    (id: string) =>
      docsService.list.docsMap$.value.get(id)?.meta$.value.title?.trim() ||
      'Untitled',
    [docsService]
  );

  const featureFlagService = useService(FeatureFlagService);
  const enableAdapterPanel = useLiveData(
    featureFlagService.flags.enable_adapter_panel.$
  );
  const enableViewAnalyticsPanel = useLiveData(
    featureFlagService.flags.enable_view_analytics_panel.$
  );

  const serverService = useService(ServerService);
  const serverConfig = useLiveData(serverService.server.config$);

  // Comments: cloud needs the server's Comment feature; local workspaces use
  // the local DB-backed comment store.
  const enableComment =
    workspace.flavour === 'local' ||
    serverConfig.features.includes(ServerFeature.Comment);

  useEffect(() => {
    if (isActiveView) {
      setActiveBlockSuiteEditor(editorContainer);
    }
  }, [editorContainer, isActiveView, setActiveBlockSuiteEditor]);

  useEffect(() => {
    const disposables: Subscription[] = [];
    let cancelled = false;
    const openHandler = (params: AIChatParams | null) => {
      if (!params) {
        return;
      }
      workbench.openSidebar();
      view.activeSidebarTab('chat');
    };
    void import('@notesgraph/core/blocksuite/ai').then(({ AIAppEvents }) => {
      if (cancelled) return;
      disposables.push(AIAppEvents.requestOpenWithChat.subscribe(openHandler));
      disposables.push(AIAppEvents.requestSendWithChat.subscribe(openHandler));
    });
    return () => {
      cancelled = true;
      disposables.forEach(d => d.unsubscribe());
    };
  }, [activeSidebarTab, view, workbench]);

  useEffect(() => {
    if (activeSidebarTab?.id === 'chat') {
      setChatTabOpened(true);
    }
    if (activeSidebarTab?.id === 'agents') {
      setAgentsTabOpened(true);
    }
  }, [activeSidebarTab]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.docId.set(doc.id);
      globalContext.isDoc.set(true);

      return () => {
        globalContext.docId.set(null);
        globalContext.isDoc.set(false);
      };
    }
    return;
  }, [doc, globalContext, isActiveView]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.docMode.set(mode);

      return () => {
        globalContext.docMode.set(null);
      };
    }
    return;
  }, [doc, globalContext, isActiveView, mode]);

  useEffect(() => {
    if (isActiveView) {
      globalContext.isTrashDoc.set(!!isInTrash);

      return () => {
        globalContext.isTrashDoc.set(null);
      };
    }
    return;
  }, [globalContext, isActiveView, isInTrash]);

  useRegisterBlocksuiteEditorCommands(editor, isActiveView);
  useRegisterSelectionEditCommands(editor, isActiveView);

  const journalService = useService(JournalService);
  const journalDate = useLiveData(journalService.journalDate$(doc.id));
  const isJournal = !!journalDate;

  const onLoad = useCallback(
    (editorContainer: NotesGraphEditorContainer) => {
      const std = editorContainer.std;
      const disposable = new DisposableGroup();

      // Check if journal and handle accordingly to set focus on input block.
      if (isJournal) {
        const rafId = requestAnimationFrame(() => {
          try {
            if (!editorContainer.isConnected) return;
            const page = editorContainer.page;
            const note = getLastNoteBlock(page);
            const std = editorContainer.std;
            if (note) {
              const lastBlock = note.lastChild();
              if (lastBlock) {
                const focusBlock = std.view.getBlock(lastBlock.id) ?? undefined;
                std.command.exec(focusBlockEnd, { focusBlock, force: true });
                return;
              }
            }
            std.command.exec(focusBlockEnd, { force: true });
          } catch (error) {
            console.error('Failed to focus journal body', error);
          }
        });
        disposable.add(() => cancelAnimationFrame(rafId));
      }
      if (std) {
        const refNodeSlots = std.getOptional(RefNodeSlotsProvider);
        if (refNodeSlots) {
          disposable.add(
            // the event should not be emitted by NotesGraphReference
            refNodeSlots.docLinkClicked.subscribe(
              ({ pageId, params, openMode, event, host }) => {
                if (host !== editorContainer.host) {
                  return;
                }
                openMode ??=
                  event && isNewTabTrigger(event)
                    ? 'open-in-new-tab'
                    : 'open-in-active-view';

                if (openMode === 'open-in-new-view') {
                  track.doc.editor.toolbar.openInSplitView();
                } else if (openMode === 'open-in-center-peek') {
                  track.doc.editor.toolbar.openInPeekView();
                } else if (openMode === 'open-in-new-tab') {
                  track.doc.editor.toolbar.openInNewTab();
                }

                if (openMode !== 'open-in-center-peek') {
                  const at = (() => {
                    if (openMode === 'open-in-active-view') {
                      return 'active';
                    }
                    // split view is only supported on electron
                    if (openMode === 'open-in-new-view') {
                      return BUILD_CONFIG.isElectron ? 'tail' : 'new-tab';
                    }
                    if (openMode === 'open-in-new-tab') {
                      return 'new-tab';
                    }
                    return 'active';
                  })();
                  workbench.openDoc(
                    {
                      docId: pageId,
                      mode: params?.mode,
                      blockIds: params?.blockIds,
                      elementIds: params?.elementIds,
                      refreshKey: nanoid(),
                    },
                    {
                      at: at,
                      show: true,
                    }
                  );
                } else {
                  peekView
                    .open({
                      docRef: {
                        docId: pageId,
                      },
                      ...params,
                    })
                    .catch(console.error);
                }
              }
            )
          );
        }
      }

      const unbind = editor.bindEditorContainer(
        editorContainer,
        (editorContainer as any).docTitle, // set from proxy
        scrollViewportRef.current
      );

      return () => {
        unbind();
        disposable.dispose();
      };
    },
    [editor, workbench, peekView, isJournal]
  );

  const [hasScrollTop, setHasScrollTop] = useState(false);

  const openOutlinePanel = useCallback(() => {
    workbench.openSidebar();
    view.activeSidebarTab('outline');
  }, [workbench, view]);

  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;

    const hasScrollTop = scrollTop > 0;
    setHasScrollTop(hasScrollTop);
  }, []);

  const [dragging, setDragging] = useState(false);

  const canEdit = useGuard('Doc_Update', doc.id);

  const readonly = !canEdit || isInTrash;

  return (
    <FrameworkScope scope={editor.scope}>
      <ViewHeader>
        <DetailPageHeader
          page={doc.blockSuiteDoc}
          workspace={workspace}
          onDragging={setDragging}
        />
      </ViewHeader>
      <ViewBody>
        <div
          className={styles.mainContainer}
          data-dynamic-top-border={BUILD_CONFIG.isElectron}
          data-has-scroll-top={hasScrollTop}
        >
          {/* Add a key to force rerender when page changed, to avoid error boundary persisting. */}
          <NotesGraphErrorBoundary key={doc.id}>
            <TopTip pageId={doc.id} workspace={workspace} />
            <Scrollable.Root>
              <Scrollable.Viewport
                onScroll={handleScroll}
                ref={scrollViewportRef}
                data-dragging={dragging}
                className={clsx(
                  'notesgraph-page-viewport',
                  styles.notesgraphDocViewport,
                  styles.editorContainer,
                  { [styles.pageModeViewportContentBox]: mode === 'page' }
                )}
              >
                {/* Parent suggestions float at the top-right of the banner
                    area. The anchor is a zero-height, position:relative element
                    in the scroll flow, so the absolutely-positioned card scrolls
                    up and away with the content instead of staying fixed. */}
                {/* Journal entries are dated pages that stand on their own —
                    they shouldn't be nudged to adopt a suggested parent. */}
                {!readonly && !isJournal ? (
                  <div className={styles.suggestedParentAnchor}>
                    {/* A plain overflow:auto div scrolls here with no visible
                        bar at all - global.css turns native scrollbars off
                        app-wide - so a long list just looked like it ended.
                        Scrollable (type="auto") shows one only when the list
                        actually overflows. */}
                    <div
                      className={styles.suggestedParentFloat}
                      data-testid="suggested-parent-float"
                    >
                      {/* Scrollable sits inside the floating card, never on
                          it: Radix puts `position: relative` inline on its
                          root, which would override the card's absolute
                          positioning and drop it out of its anchor. */}
                      <Scrollable.Root type="auto">
                        <Scrollable.Viewport
                          className={styles.suggestedParentScroller}
                        >
                          <SuggestedParentBanner docId={doc.id} />
                        </Scrollable.Viewport>
                        <Scrollable.Scrollbar />
                      </Scrollable.Root>
                    </div>
                  </div>
                ) : null}
                {journalDate ? <DayScheduleSection date={journalDate} /> : null}
                <PageDetailEditor onLoad={onLoad} readonly={readonly} />
              </Scrollable.Viewport>
              <Scrollable.Scrollbar
                className={clsx({
                  [styles.scrollbar]: !appSettings.clientBorder,
                })}
              />
            </Scrollable.Root>
            <EditorOutlineViewer
              editor={editorContainer?.host ?? null}
              show={mode === 'page' && !isSideBarOpen}
              openOutlinePanel={openOutlinePanel}
            />
          </NotesGraphErrorBoundary>
          {isInTrash ? <TrashPageFooter /> : null}
        </div>
      </ViewBody>

      {/*
        The chat tab is registered unconditionally, not behind `enableAI`
        (= the `enable_ai` flag AND the server advertising Copilot). Gating it
        on that made the tab — and so the AI island's preferred "chat in the
        right side panel" path — unreachable on any server that doesn't
        advertise Copilot, leaving the island to fall back to opening the
        /chat page in a split pane. The panel itself handles either backend
        (tabs/chat.tsx picks the local request service when the AI backend is
        local), so the server feature isn't what decides whether it can run.

        The body stays unrendered until the tab is first opened: it pulls in
        ~9MB of blocksuite/ai, and `unmountOnInactive={false}` renders children
        eagerly, so registering the tab for everyone would otherwise load that
        chunk on every doc page. Once opened it stays mounted, which is why
        unmountOnInactive is false — chat state survives switching tabs.
      */}
      <ViewSidebarTab tabId="chat" icon={<AiIcon />} unmountOnInactive={false}>
        {chatTabOpened ? (
          <Suspense fallback={null}>
            <EditorChatPanel editor={editorContainer} doc={doc.blockSuiteDoc} />
          </Suspense>
        ) : null}
      </ViewSidebarTab>

      <ViewSidebarTab
        tabId="agents"
        icon={<ToolIcon />}
        unmountOnInactive={false}
      >
        {agentsTabOpened ? (
          <Suspense fallback={null}>
            <EditorAgentsPanel />
          </Suspense>
        ) : null}
      </ViewSidebarTab>

      {isLocalAi && (
        <ViewSidebarTab tabId="related" icon={<LinkedPageIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <RelatedDocsPanel
                docId={doc.id}
                getDocTitle={getRelatedDocTitle}
                onOpenDoc={openRelatedDoc}
              />
            </Scrollable.Viewport>
            <Scrollable.Scrollbar />
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      <ViewSidebarTab tabId="properties" icon={<PropertyIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <WorkspacePropertySidebar />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="journal" icon={<TodayIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorJournalPanel />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="outline" icon={<TocIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorOutlinePanel editor={editorContainer?.host ?? null} />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      <ViewSidebarTab tabId="frame" icon={<FrameIcon />}>
        <Scrollable.Root className={styles.sidebarScrollArea}>
          <Scrollable.Viewport>
            <EditorFramePanel editor={editorContainer?.host ?? null} />
          </Scrollable.Viewport>
          <Scrollable.Scrollbar />
        </Scrollable.Root>
      </ViewSidebarTab>

      {enableAdapterPanel && (
        <ViewSidebarTab tabId="adapter" icon={<ExportIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <EditorAdapterPanel host={editorContainer?.host ?? null} />
            </Scrollable.Viewport>
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      {enableComment && (
        <ViewSidebarTab tabId="comment" icon={<CommentIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <CommentSidebar />
            </Scrollable.Viewport>
            <Scrollable.Scrollbar />
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      {workspace.flavour === 'notesgraph-cloud' && enableViewAnalyticsPanel && (
        <ViewSidebarTab tabId="analytics" icon={<ChartPanelIcon />}>
          <Scrollable.Root className={styles.sidebarScrollArea}>
            <Scrollable.Viewport>
              <EditorAnalyticsPanel workspaceId={workspace.id} docId={doc.id} />
            </Scrollable.Viewport>
            <Scrollable.Scrollbar />
          </Scrollable.Root>
        </ViewSidebarTab>
      )}

      <PluginSidebarTabs />

      <GlobalPageHistoryModal />
      {/* FIXME: wait for better ai, <PageAIOnboarding /> */}
    </FrameworkScope>
  );
});

export const Component = () => {
  const params = useParams();
  const recentPages = useService(RecentDocsService);

  useEffect(() => {
    if (params.pageId) {
      const pageId = params.pageId;
      localStorage.setItem('last_page_id', pageId);

      recentPages.addRecentDoc(pageId);
    }
  }, [params, recentPages]);

  const pageId = params.pageId;
  const canAccess = useGuard('Doc_Read', pageId ?? '');

  return pageId ? (
    <DetailPageWrapper
      pageId={pageId}
      canAccess={canAccess}
      skeleton={<PageDetailLoading />}
      notFound={<PageNotFound />}
      noPermission={<PageNotFound noPermission />}
    >
      <DetailPageImpl />
    </DetailPageWrapper>
  ) : null;
};
