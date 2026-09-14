import { DisposableGroup } from '@blocksuite/notesgraph/global/disposable';
import { Bound } from '@blocksuite/notesgraph/global/gfx';
import { RefNodeSlotsProvider } from '@blocksuite/notesgraph/inlines/reference';
import { GfxControllerIdentifier } from '@blocksuite/notesgraph/std/gfx';
import { Scrollable } from '@notesgraph/component';
import { PageDetailLoading } from '@notesgraph/component/page-detail-skeleton';
// Type-only import is erased at build; the AIAppEvents *value* (which drags in
// the ~10MB blocksuite/ai bundle) is imported dynamically in the effect below.
import type { AIChatParams } from '@notesgraph/core/blocksuite/ai';
import type { NotesGraphEditorContainer } from '@notesgraph/core/blocksuite/block-suite-editor';
import { EditorOutlineViewer } from '@notesgraph/core/blocksuite/outline-viewer';
import { useGuard } from '@notesgraph/core/components/guard';
import { NotesGraphErrorBoundary } from '@notesgraph/core/components/notesgraph/notesgraph-error-boundary';
import { PageNotFound } from '@notesgraph/core/desktop/pages/404';
import { EditorService } from '@notesgraph/core/modules/editor';
import { DebugLogger } from '@notesgraph/debug';
import {
  FrameworkScope,
  useLiveData,
  useService,
  useServices,
} from '@notesgraph/infra';
import clsx from 'clsx';
import { lazy, Suspense, useCallback, useEffect } from 'react';
import type { Subscription } from 'rxjs';

import { WorkbenchService } from '../../../workbench/services/workbench';
import type { DocReferenceInfo } from '../../entities/peek-view';
import { PeekViewService } from '../../services/peek-view';
import { useEditor } from '../utils';
import * as styles from './doc-peek-view.css';

const logger = new DebugLogger('doc-peek-view');

// Lazy load BlockSuiteEditor to break circular dependency
const BlockSuiteEditor = lazy(() =>
  import('@notesgraph/core/blocksuite/block-suite-editor').then(module => ({
    default: module.BlockSuiteEditor,
  }))
);

function fitViewport(
  editor: NotesGraphEditorContainer,
  xywh?: `[${number},${number},${number},${number}]`
) {
  try {
    if (!editor.host) {
      throw new Error('editor host is not ready');
    }

    const gfx = editor.host.std.get(GfxControllerIdentifier);
    const viewport = gfx.viewport;
    viewport.onResize();

    if (xywh) {
      const newViewport = {
        xywh: xywh,
        padding: [60, 20, 20, 20] as [number, number, number, number],
      };
      viewport.setViewportByBound(
        Bound.deserialize(newViewport.xywh),
        newViewport.padding,
        false
      );
    } else {
      gfx.fitToScreen({
        smooth: false,
      });
    }
  } catch (e) {
    logger.warn('failed to fitViewPort', e);
  }
}

function DocPeekPreviewEditor({
  xywh,
}: {
  xywh?: `[${number},${number},${number},${number}]`;
}) {
  const { editorService } = useServices({
    EditorService,
  });
  const editor = editorService.editor;
  const doc = editor.doc;
  const workspace = editor.doc.workspace;
  const mode = useLiveData(editor.mode$);
  const defaultOpenProperty = useLiveData(editor.defaultOpenProperty$);
  const workbench = useService(WorkbenchService).workbench;
  const peekView = useService(PeekViewService).peekView;
  const editorElement = useLiveData(editor.editorContainer$);

  const isInTrash = useLiveData(doc.record.trash$);

  const handleOnEditorReady = useCallback(
    (editorContainer: NotesGraphEditorContainer) => {
      const disposableGroup = new DisposableGroup();
      const refNodeSlots =
        editorContainer.std.getOptional(RefNodeSlotsProvider);
      if (!refNodeSlots) return;
      // doc change event inside peek view should be handled by peek view
      disposableGroup.add(
        // todo(@pengx17): seems not working
        refNodeSlots.docLinkClicked.subscribe(options => {
          if (options.host !== editorContainer.host) {
            return;
          }
          peekView
            .open({
              docRef: { docId: options.pageId },
              ...options.params,
            })
            .catch(console.error);
        })
      );

      const unbind = editor.bindEditorContainer(editorContainer);

      if (mode === 'edgeless') {
        fitViewport(editorContainer, xywh);
      }

      return () => {
        unbind();
        disposableGroup.dispose();
      };
    },
    [editor, mode, peekView, xywh]
  );

  useEffect(() => {
    const disposables: Subscription[] = [];
    let cancelled = false;
    const openHandler = (params: AIChatParams | null) => {
      if (!params) {
        return;
      }
      if (doc) {
        workbench.openDoc(doc.id);
        peekView.close();
        // chat panel open is already handled in <DetailPageImpl />
      }
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
  }, [doc, peekView, workbench, workspace.id]);

  const openOutlinePanel = useCallback(() => {
    workbench.openDoc(doc.id);
    workbench.openSidebar();
    workbench.activeView$.value.activeSidebarTab('outline');
    peekView.close();
  }, [doc, peekView, workbench]);

  const canEdit = useGuard('Doc_Update', doc.id);

  const readonly = !canEdit || isInTrash;

  return (
    <NotesGraphErrorBoundary>
      <Scrollable.Root>
        <Scrollable.Viewport
          className={clsx(
            'notesgraph-page-viewport',
            styles.notesgraphDocViewport
          )}
        >
          <Suspense fallback={<PageDetailLoading />}>
            <BlockSuiteEditor
              className={styles.editor}
              mode={mode}
              page={doc.blockSuiteDoc}
              readonly={readonly}
              onEditorReady={handleOnEditorReady}
              defaultOpenProperty={defaultOpenProperty}
            />
          </Suspense>
        </Scrollable.Viewport>
        <Scrollable.Scrollbar />
      </Scrollable.Root>
      {!BUILD_CONFIG.isMobileEdition && !BUILD_CONFIG.isMobileWeb ? (
        <EditorOutlineViewer
          editor={editorElement?.host ?? null}
          show={mode === 'page'}
          openOutlinePanel={openOutlinePanel}
        />
      ) : null}
    </NotesGraphErrorBoundary>
  );
}

export function DocPeekPreview({
  docRef,
  animating,
}: {
  docRef: DocReferenceInfo;
  animating?: boolean;
}) {
  const {
    docId,
    blockIds,
    elementIds,
    mode,
    xywh,
    databaseId,
    databaseDocId,
    databaseRowId,
  } = docRef;
  const { doc, editor, loading } = useEditor(
    docId,
    mode,
    {
      blockIds,
      elementIds,
    },
    databaseId && databaseRowId && databaseDocId
      ? {
          docId: databaseDocId,
          databaseId,
          databaseRowId,
          type: 'database',
        }
      : undefined,
    !animating
  );

  const canAccess = useGuard('Doc_Read', docId);

  // if sync engine has been synced and the page is null, show 404 page.
  if (!doc || !editor || !canAccess) {
    return loading || canAccess === undefined ? (
      <PageDetailLoading key="current-page-is-null" />
    ) : (
      // Only a real permission denial shows the sign-in prompt; a doc that
      // simply doesn't exist (e.g. a dangling reference) shows "not found".
      <PageNotFound noPermission={!canAccess} />
    );
  }

  return (
    <FrameworkScope scope={doc.scope}>
      <FrameworkScope scope={editor.scope}>
        <DocPeekPreviewEditor xywh={xywh} />
      </FrameworkScope>
    </FrameworkScope>
  );
}
