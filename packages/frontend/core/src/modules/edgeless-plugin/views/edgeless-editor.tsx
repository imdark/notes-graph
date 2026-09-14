import { usePatchSpecs } from '@notesgraph/core/blocksuite/block-suite-editor/lit-adaper';
import { notesgraphEdgelessDocViewport } from '@notesgraph/core/blocksuite/block-suite-editor/styles.css';
import {
  type EdgelessEditor,
  LitEdgelessEditor,
} from '@notesgraph/core/blocksuite/editors';
import type { DocModeEditorProps } from '@notesgraph/core/modules/doc-mode-registry';
import { forwardRef, useCallback, useEffect, useRef } from 'react';

/** The edgeless editor component, contributed as the edgeless mode's editor. */
export const BlocksuiteEdgelessEditor = forwardRef<
  EdgelessEditor,
  DocModeEditorProps
>(function BlocksuiteEdgelessEditor({ page }, ref) {
  const [specs, portals] = usePatchSpecs('edgeless');
  const editorRef = useRef<EdgelessEditor | null>(null);

  const onDocRef = useCallback(
    (el: EdgelessEditor) => {
      editorRef.current = el;
      if (ref) {
        if (typeof ref === 'function') {
          ref(el);
        } else {
          ref.current = el;
        }
      }
    },
    [ref]
  );

  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.updateComplete
        .then(() => {
          // make sure editor can get keyboard events on showing up
          editorRef.current
            ?.querySelector<HTMLElement>('notesgraph-edgeless-root')
            ?.click();
        })
        .catch(console.error);
    }
  }, []);

  return (
    <div className={notesgraphEdgelessDocViewport}>
      <LitEdgelessEditor ref={onDocRef} doc={page} specs={specs} />
      {portals}
    </div>
  );
});
