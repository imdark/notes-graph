import type { Store } from '@blocksuite/notesgraph/store';
import type { PageEditor } from '@notesgraph/core/blocksuite/editors';
import { OutlineZoomIdentifier } from '@notesgraph/core/blocksuite/view-extensions/outline-zoom';
import { useCallback, useEffect, useMemo, useState } from 'react';

function getZoom(editor: PageEditor | null) {
  return editor?.std?.getOptional(OutlineZoomIdentifier) ?? null;
}

/**
 * Wires outline-zoom for a page editor: clicking a list item's marker (• or
 * number) focuses (zooms) the editor into that item's subtree, and exposes the
 * focus state + an exit handler for the breadcrumb.
 */
export function useOutlineZoom(editor: PageEditor | null, page: Store) {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  // Mirror the editor's focus signal into React (std may not be ready on the
  // first render, so retry briefly).
  useEffect(() => {
    if (!editor) return;
    let disposed = false;
    let unsub: (() => void) | undefined;
    const bind = () => {
      if (disposed) return;
      const zoom = getZoom(editor);
      if (!zoom) {
        setTimeout(bind, 100);
        return;
      }
      setFocusedId(zoom.focusedBlockId$.value);
      unsub = zoom.focusedBlockId$.subscribe(v => setFocusedId(v));
    };
    bind();
    return () => {
      disposed = true;
      unsub?.();
    };
  }, [editor]);

  // Clicking a bulleted/numbered list marker zooms into it; todo items
  // zoom via their dedicated hover bullet (the checkbox itself must keep
  // toggling checked state).
  useEffect(() => {
    if (!editor) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const zoomHandle = target?.closest('.notesgraph-list-block__zoom-handle');
      if (!zoomHandle && !target?.closest('.notesgraph-list-block__prefix')) {
        return;
      }
      const blockId =
        target?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
      if (!blockId) return;
      const model = page.getBlock(blockId)?.model;
      const props = model?.props as { type?: string } | undefined;
      if (model?.flavour !== 'notesgraph:list') return;
      if (
        !zoomHandle &&
        props?.type !== 'bulleted' &&
        props?.type !== 'numbered'
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      getZoom(editor)?.setFocus(blockId);
    };
    editor.addEventListener('click', onClick, true);
    return () => editor.removeEventListener('click', onClick, true);
  }, [editor, page]);

  const exit = useCallback(() => {
    getZoom(editor)?.setFocus(null);
  }, [editor]);

  const focusTitle = useMemo(() => {
    if (!focusedId) return '';
    const model = page.getBlock(focusedId)?.model;
    const text = (model?.props as { text?: { toString(): string } } | undefined)
      ?.text;
    return text?.toString() || 'Untitled';
  }, [focusedId, page]);

  return { focusedId, focusTitle, exit };
}

export function OutlineZoomBreadcrumb({
  focusTitle,
  onExit,
}: {
  focusTitle: string;
  onExit: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        margin: '0 0 8px',
        fontSize: 13,
      }}
    >
      <button
        type="button"
        onClick={onExit}
        style={{
          cursor: 'pointer',
          border: 'none',
          background: 'transparent',
          color: 'var(--notesgraph-text-secondary-color)',
          padding: 0,
        }}
      >
        ← All blocks
      </button>
      <span style={{ color: 'var(--notesgraph-text-secondary-color)' }}>/</span>
      <span style={{ fontWeight: 600 }}>{focusTitle}</span>
    </div>
  );
}
