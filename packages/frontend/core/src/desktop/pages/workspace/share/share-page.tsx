import { DisposableGroup } from '@blocksuite/notesgraph/global/disposable';
import { RefNodeSlotsProvider } from '@blocksuite/notesgraph/inlines/reference';
import { type DocMode, DocModes } from '@blocksuite/notesgraph/model';
import { Scrollable, uniReactRoot } from '@notesgraph/component';
import { NotesGraphLogoIcon } from '@notesgraph/component/brand';
import type { NotesGraphEditorContainer } from '@notesgraph/core/blocksuite/block-suite-editor';
import { EditorOutlineViewer } from '@notesgraph/core/blocksuite/outline-viewer';
import { useActiveBlocksuiteEditor } from '@notesgraph/core/components/hooks/use-block-suite-editor';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { PageDetailEditor } from '@notesgraph/core/components/page-detail-editor';
import { AppContainer } from '@notesgraph/core/desktop/components/app-container';
import { AuthService, ServerService } from '@notesgraph/core/modules/cloud';
import { type Doc, DocsService } from '@notesgraph/core/modules/doc';
import {
  type Editor,
  type EditorSelector,
  EditorService,
  EditorsService,
} from '@notesgraph/core/modules/editor';
import { PeekViewManagerModal } from '@notesgraph/core/modules/peek-view';
import {
  ViewIcon,
  ViewTitle,
  WorkbenchService,
} from '@notesgraph/core/modules/workbench';
import {
  readSiteManifest,
  type SiteManifest,
} from '@notesgraph/core/modules/share-doc';
import {
  type Workspace,
  WorkspacesService,
} from '@notesgraph/core/modules/workspace';
import { useI18n } from '@notesgraph/i18n';
import { FrameworkScope, useLiveData, useService } from '@notesgraph/infra';
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { filter, firstValueFrom, timeout } from 'rxjs';

import { PageNotFound } from '../../404';
import { ShareFooter } from './share-footer';
import { ShareHeader } from './share-header';
import { SiteShell } from './site/site-shell';
import * as styles from './share-page.css';
import {
  fetchSharedPublishMode,
  getResolvedPublishMode,
  isSharePagePermissionError,
  isSharePageTimeoutError,
} from './share-page.utils';
import { useSharedModeQuerySync } from './use-shared-mode-query-sync';

const waitForSharedDocRecord = async (
  docsService: DocsService,
  docId: string
): Promise<void> => {
  if (docsService.list.doc$(docId).value) {
    return;
  }

  await firstValueFrom(
    docsService.list.doc$(docId).pipe(filter(Boolean), timeout(3000))
  );
};

const useUpdateBasename = (workspace: Workspace | null) => {
  const location = useLocation();
  const basename = location.pathname.match(/\/workspace\/[^/]+/g)?.[0] ?? '/';
  useEffect(() => {
    if (workspace) {
      const workbench = workspace.scope.get(WorkbenchService).workbench;
      workbench.updateBasename(basename);
    }
  }, [basename, workspace]);
};

export const SharePage = ({
  workspaceId,
  docId,
}: {
  workspaceId: string;
  docId: string;
}) => {
  const location = useLocation();

  const { mode, selector, isTemplate, templateName, templateSnapshotUrl } =
    useMemo(() => {
      const searchParams = new URLSearchParams(location.search);
      const queryStringMode = searchParams.get('mode') as DocMode | null;
      const blockIds = searchParams
        .get('blockIds')
        ?.split(',')
        .filter(v => v.length);
      const elementIds = searchParams
        .get('elementIds')
        ?.split(',')
        .filter(v => v.length);

      return {
        mode:
          queryStringMode && DocModes.includes(queryStringMode)
            ? queryStringMode
            : null,
        selector: {
          blockIds,
          elementIds,
          refreshKey: searchParams.get('refreshKey') || undefined,
        },
        isTemplate: searchParams.has('isTemplate'),
        templateName: searchParams.get('templateName') || '',
        templateSnapshotUrl: searchParams.get('snapshotUrl') || '',
      };
    }, [location.search]);

  return (
    <AppContainer>
      <SharePageInner
        workspaceId={workspaceId}
        docId={docId}
        key={workspaceId + ':' + docId}
        publishMode={mode ?? undefined}
        selector={selector}
        isTemplate={isTemplate}
        templateName={templateName}
        templateSnapshotUrl={templateSnapshotUrl}
      />
    </AppContainer>
  );
};

const SharePageInner = ({
  workspaceId,
  docId,
  publishMode,
  selector,
  isTemplate,
  templateName,
  templateSnapshotUrl,
}: {
  workspaceId: string;
  docId: string;
  publishMode?: DocMode;
  selector?: EditorSelector;
  isTemplate?: boolean;
  templateName?: string;
  templateSnapshotUrl?: string;
}) => {
  const serverService = useService(ServerService);
  const workspacesService = useService(WorkspacesService);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [page, setPage] = useState<Doc | null>(null);
  const [siteManifest, setSiteManifest] = useState<SiteManifest | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [noPermission, setNoPermission] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [linkCommentable, setLinkCommentable] = useState(false);
  const [fetchedPublishMode, setFetchedPublishMode] = useState<
    DocMode | null | undefined
  >(() => (publishMode === undefined ? undefined : null));
  const [editorContainer, setActiveBlocksuiteEditor] =
    useActiveBlocksuiteEditor();
  const resolvedPublishMode =
    publishMode !== undefined
      ? publishMode
      : fetchedPublishMode === undefined
        ? null
        : getResolvedPublishMode(null, fetchedPublishMode);
  const currentPublishMode = useSharedModeQuerySync({
    editor,
    resolvedPublishMode,
  });

  useEffect(() => {
    const abortController = new AbortController();
    if (publishMode !== undefined) {
      // mode already known — still fetch to learn the link's comment role
      setFetchedPublishMode(null);
    } else {
      setFetchedPublishMode(undefined);
    }

    void fetchSharedPublishMode({
      serverBaseUrl: serverService.server.baseUrl,
      workspaceId,
      docId,
      signal: abortController.signal,
    })
      .then(({ mode, commentable }) => {
        if (!abortController.signal.aborted) {
          if (publishMode === undefined) {
            setFetchedPublishMode(mode);
          }
          setLinkCommentable(commentable);
        }
      })
      .catch(err => {
        if (!abortController.signal.aborted) {
          console.error(err);
          setFetchedPublishMode(null);
        }
      });

    return () => {
      abortController.abort();
    };
  }, [docId, publishMode, serverService.server.baseUrl, workspaceId]);

  useEffect(() => {
    if (resolvedPublishMode === null) return;
    if (editor || workspace || page) return;

    // create a workspace for share page
    const { workspace: sharedWorkspace } = workspacesService.open(
      {
        metadata: {
          id: workspaceId,
          flavour: 'notesgraph-cloud',
        },
        isSharedMode: true,
      },
      {
        local: {
          doc: {
            name: 'StaticCloudDocStorage',
            opts: {
              id: workspaceId,
              publicRootDocId: docId,
              serverBaseUrl: serverService.server.baseUrl,
            },
          },
          blob: {
            name: 'CloudBlobStorage',
            opts: {
              id: workspaceId,
              serverBaseUrl: serverService.server.baseUrl,
            },
          },
        },
        remotes: {},
      }
    );

    setWorkspace(sharedWorkspace);

    sharedWorkspace.engine.doc
      .waitForDocLoaded(sharedWorkspace.id)
      .then(async () => {
        const docsService = sharedWorkspace.scope.get(DocsService);
        await waitForSharedDocRecord(docsService, docId);

        const { doc } = docsService.open(docId);
        doc.blockSuiteDoc.load();
        doc.blockSuiteDoc.readonly = true;

        await sharedWorkspace.engine.doc.waitForDocLoaded(docId);

        if (!doc.blockSuiteDoc.root) {
          throw new Error('Doc is empty');
        }

        setPage(doc);
        // If this doc is part of a published site, its own binary carries the
        // full manifest (written to every page) — render the site shell.
        setSiteManifest(readSiteManifest(doc.yDoc));

        const editor = doc.scope.get(EditorsService).createEditor();
        editor.setMode(resolvedPublishMode);

        if (selector) {
          editor.setSelector(selector);
        }

        setEditor(editor);
      })
      .catch(err => {
        console.error(err);
        if (isSharePagePermissionError(err)) {
          setNoPermission(true);
          return;
        }

        if (isSharePageTimeoutError(err)) {
          setLoadFailed(true);
          return;
        }

        setLoadFailed(true);
      });
  }, [
    docId,
    editor,
    page,
    resolvedPublishMode,
    selector,
    workspaceId,
    workspace,
    workspacesService,
    serverService.server.baseUrl,
  ]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setSelector(selector);
  }, [editor, selector]);

  const t = useI18n();
  const pageTitle = useLiveData(page?.title$);
  const { jumpToPageBlock, openPage } = useNavigateHelper();
  useUpdateBasename(workspace);

  const onEditorLoad = useCallback(
    (editorContainer: NotesGraphEditorContainer) => {
      setActiveBlocksuiteEditor(editorContainer);
      if (!editor) {
        return;
      }
      const unbind = editor.bindEditorContainer(editorContainer);

      const disposable = new DisposableGroup();
      const refNodeSlots =
        editorContainer.host?.std.getOptional(RefNodeSlotsProvider);
      if (refNodeSlots) {
        disposable.add(
          refNodeSlots.docLinkClicked.subscribe(({ pageId, params }) => {
            if (params) {
              const { mode, blockIds, elementIds } = params;
              jumpToPageBlock(workspaceId, pageId, mode, blockIds, elementIds);
              return;
            }

            if (editor.doc.id === pageId) {
              return;
            }

            return openPage(workspaceId, pageId);
          })
        );
      }

      return () => {
        unbind();
      };
    },
    [editor, setActiveBlocksuiteEditor, jumpToPageBlock, openPage, workspaceId]
  );

  if (noPermission) {
    return <PageNotFound noPermission />;
  }

  if (loadFailed) {
    return <PageNotFound />;
  }

  if (!workspace || !page || !editor || !currentPublishMode) {
    return null;
  }

  return (
    <FrameworkScope scope={workspace.scope}>
      <FrameworkScope scope={page.scope}>
        <FrameworkScope scope={editor.scope}>
          <ViewIcon icon={currentPublishMode === 'page' ? 'doc' : 'edgeless'} />
          <ViewTitle title={pageTitle ?? t['unnamed']()} />
          <div className={styles.root}>
            <MaybeSiteShell
              manifest={siteManifest}
              activeDocId={page.id}
              workspaceId={workspaceId}
            >
              <div className={styles.mainContainer}>
                <ShareHeader
                  pageId={page.id}
                  publishMode={currentPublishMode}
                  isTemplate={isTemplate}
                  templateName={templateName}
                  snapshotUrl={templateSnapshotUrl}
                />
                <Scrollable.Root>
                  <Scrollable.Viewport
                    className={clsx(
                      'notesgraph-page-viewport',
                      styles.editorContainer
                    )}
                  >
                    <PageDetailEditor
                      onLoad={onEditorLoad}
                      readonly
                      sharedCommentable={linkCommentable}
                    />
                    {currentPublishMode === 'page' &&
                    !BUILD_CONFIG.isElectron ? (
                      <ShareFooter />
                    ) : null}
                  </Scrollable.Viewport>
                  <Scrollable.Scrollbar />
                </Scrollable.Root>
                <EditorOutlineViewer
                  editor={editorContainer?.host ?? null}
                  show={currentPublishMode === 'page'}
                />
                {!BUILD_CONFIG.isElectron && <SharePageFooter />}
              </div>
            </MaybeSiteShell>
          </div>
          <PeekViewManagerModal />
          <uniReactRoot.Root />
        </FrameworkScope>
      </FrameworkScope>
    </FrameworkScope>
  );
};

/** Wraps the page in the multi-page site chrome when it belongs to a site. */
const MaybeSiteShell = ({
  manifest,
  activeDocId,
  workspaceId,
  children,
}: {
  manifest: SiteManifest | null;
  activeDocId: string;
  workspaceId: string;
  children: ReactNode;
}) => {
  if (!manifest) return <>{children}</>;
  return (
    <SiteShell
      manifest={manifest}
      activeDocId={activeDocId}
      workspaceId={workspaceId}
    >
      {children}
    </SiteShell>
  );
};

const SharePageFooter = () => {
  const t = useI18n();
  const editorService = useService(EditorService);
  const isPresent = useLiveData(editorService.editor.isPresenting$);
  const authService = useService(AuthService);
  const loginStatus = useLiveData(authService.session.status$);

  if (isPresent || loginStatus === 'authenticated') {
    return null;
  }
  return (
    <a
      href="https://notesgraph.com"
      target="_blank"
      className={styles.link}
      rel="noreferrer"
    >
      <span className={styles.linkText}>
        {t['com.notesgraph.share-page.footer.built-with']()}
      </span>
      <NotesGraphLogoIcon fontSize={20} />
    </a>
  );
};
