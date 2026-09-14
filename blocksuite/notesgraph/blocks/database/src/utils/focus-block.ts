import { Bound } from '@blocksuite/global/gfx';
import {
  DocModeProvider,
  FocusScopeProvider,
} from '@blocksuite/notesgraph-shared/services';
import {
  asyncGetBlockComponent,
  findNoteBlockModel,
} from '@blocksuite/notesgraph-shared/utils';
import type { EditorHost } from '@blocksuite/std';
import { GfxControllerIdentifier } from '@blocksuite/std/gfx';
import type { BlockModel } from '@blocksuite/store';

/** Whether `blockId` is `scopeRootId` itself or one of its descendants. */
function isBlockInScope(
  host: EditorHost,
  scopeRootId: string,
  blockId: string
): boolean {
  let current = host.store.getBlock(blockId)?.model ?? null;
  while (current) {
    if (current.id === scopeRootId) return true;
    current = host.store.getParent(current);
  }
  return false;
}

/**
 * Brings a just-created block into view regardless of editor mode or an
 * active focus scope. A table/kanban conversion always lands the database
 * at note level, which can be far from a nested selection — or entirely
 * outside a narrowed view like the app's "zoom into this bullet" outline
 * focus, which renders only a block's own subtree. Without this it can
 * look exactly like the action did nothing: the new block isn't scrolled
 * to, or isn't even in the DOM to scroll to.
 */
export function focusCreatedBlock(host: EditorHost, blockId: string): void {
  const scope = host.std.getOptional(FocusScopeProvider);
  const focusedId = scope?.getFocusedBlockId();
  if (focusedId && !isBlockInScope(host, focusedId, blockId)) {
    scope!.exitFocus();
  }

  const mode = host.std.get(DocModeProvider).getEditorMode();

  if (mode === 'edgeless') {
    const model = host.store.getBlock(blockId)?.model as BlockModel | undefined;
    const note = model ? findNoteBlockModel(model) : null;
    if (!note) return;
    const gfx = host.std.get(GfxControllerIdentifier);
    gfx.viewport.setViewportByBound(
      Bound.deserialize(note.xywh),
      [0.12, 0.12, 0.12, 0.12],
      true
    );
    return;
  }

  // Page mode scrolls the document (native `scrollIntoView`); edgeless
  // notes live on a pannable/zoomable infinite canvas instead of a
  // scrolling document, so `scrollIntoView` has no effect there — handled
  // above by panning the containing note's bound into view, mirroring the
  // pattern `EdgelessRootBlockComponent` itself uses to restore a stored
  // viewport.
  asyncGetBlockComponent(host.std, blockId)
    .then(element => {
      element?.scrollIntoView({ block: 'center' });
    })
    .catch(console.error);
}
