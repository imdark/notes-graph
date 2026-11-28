import { type Doc, DocsService } from '@notesgraph/core/modules/doc';
import type { Editor } from '@notesgraph/core/modules/editor';
import { EditorsService } from '@notesgraph/core/modules/editor';
import { ViewService } from '@notesgraph/core/modules/workbench/services/view';
import { WorkspaceService } from '@notesgraph/core/modules/workspace';
import { FrameworkScope, useLiveData, useService } from '@notesgraph/infra';
import { recordLoadEvent } from '@notesgraph/nbstore';
import {
  type PropsWithChildren,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

/** A note that takes this long to show its content goes in the load log. */
const SLOW_NOTE_LOAD_MS = 3000;
/** Past this the load is recorded as still waiting, with what it waits on. */
const STUCK_NOTE_LOAD_MS = 20_000;

/**
 * Records a note that was slow to open, with how long each stage took: the
 * workspace's list of notes, the note being opened, and its content arriving
 * (its root block). Connection stalls land in the same log (see
 * recordLoadEvent), so the two can be read side by side.
 */
const useSlowLoadLog = (
  pageId: string,
  docListReady: boolean,
  doc: Doc | null
) => {
  const timing = useRef({
    pageId: '',
    start: 0,
    list: 0,
    opened: 0,
    waitingLogged: false,
  });
  if (timing.current.pageId !== pageId) {
    timing.current = {
      pageId,
      start: Date.now(),
      list: 0,
      opened: 0,
      waitingLogged: false,
    };
  }
  const t = timing.current;
  if (docListReady && !t.list) t.list = Date.now();
  if (doc && !t.opened) t.opened = Date.now();

  useEffect(() => {
    const t = timing.current;
    const stages = () => ({
      docId: pageId,
      docListReadyMs: t.list ? t.list - t.start : null,
      docOpenedMs: t.opened ? t.opened - t.start : null,
      hidden: document.visibilityState === 'hidden',
      sincePageStartMs: Math.round(performance.now()),
    });
    let done = false;
    // Counted from when the note was asked for, and said once, though this
    // effect starts over when the note is opened.
    const stuck = setTimeout(
      () => {
        if (done || t.waitingLogged) return;
        t.waitingLogged = true;
        recordLoadEvent('note-load-waiting', stages());
      },
      Math.max(0, STUCK_NOTE_LOAD_MS - (Date.now() - t.start))
    );
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(stuck);
      const ms = Date.now() - t.start;
      if (ms >= SLOW_NOTE_LOAD_MS) {
        recordLoadEvent('slow-note-load', { ms, ...stages() });
      }
    };
    if (!doc) return () => clearTimeout(stuck);
    const store = doc.blockSuiteDoc;
    if (store.root) {
      finish();
      return () => clearTimeout(stuck);
    }
    const sub = store.slots.rootAdded.subscribe(finish);
    return () => {
      sub.unsubscribe();
      clearTimeout(stuck);
    };
  }, [doc, pageId]);
};

const useLoadDoc = (pageId: string) => {
  const currentWorkspace = useService(WorkspaceService).workspace;
  const docsService = useService(DocsService);
  const docRecordList = docsService.list;
  const docListReady = useLiveData(docRecordList.isReady$);
  const docRecord = useLiveData(docRecordList.doc$(pageId));
  const viewService = useService(ViewService);

  const [doc, setDoc] = useState<Doc | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  useLayoutEffect(() => {
    if (!docRecord) {
      return;
    }
    const { doc, release } = docsService.open(pageId);
    setDoc(doc);
    const editor = doc.scope.get(EditorsService).createEditor();
    const unbind = editor.bindWorkbenchView(viewService.view);
    setEditor(editor);
    return () => {
      unbind();
      editor.dispose();
      release();
    };
  }, [docRecord, docsService, pageId, viewService.view]);

  // set sync engine priority target
  useEffect(() => {
    return currentWorkspace.engine.doc.addPriority(pageId, 10);
  }, [currentWorkspace, pageId]);

  useSlowLoadLog(pageId, docListReady, doc);

  const isInTrash = useLiveData(doc?.meta$.map(meta => meta.trash));

  useEffect(() => {
    if (doc && isInTrash) {
      doc.blockSuiteDoc.readonly = true;
    }
  }, [doc, isInTrash]);

  return {
    doc,
    editor,
    docListReady,
  };
};

/**
 * A common wrapper for detail page for both mobile and desktop page.
 * It only contains the logic for page loading, context setup, but not the page content.
 */
export const DetailPageWrapper = ({
  pageId,
  children,
  skeleton,
  notFound,
  noPermission,
  canAccess,
}: PropsWithChildren<{
  pageId: string;
  skeleton: ReactNode;
  notFound: ReactNode;
  /**
   * Shown when the doc exists but the user lacks read permission. Falls back to
   * `notFound` — a doc that doesn't exist must not surface a sign-in prompt.
   */
  noPermission?: ReactNode;
  canAccess?: boolean;
}>) => {
  const { doc, editor, docListReady } = useLoadDoc(pageId);
  // if sync engine has been synced and the page is null, show 404 page.
  if (docListReady && !doc) {
    return notFound;
  }

  if (canAccess === undefined || !doc || !editor) {
    return skeleton;
  } else if (!canAccess) {
    return noPermission ?? notFound;
  }

  return (
    <FrameworkScope scope={doc.scope}>
      <FrameworkScope scope={editor.scope}>{children}</FrameworkScope>
    </FrameworkScope>
  );
};
