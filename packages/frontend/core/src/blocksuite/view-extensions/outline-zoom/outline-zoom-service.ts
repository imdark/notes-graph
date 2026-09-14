/* eslint-disable rxjs/finnish -- `$` is BlockSuite's signal convention, not rxjs */
import { createIdentifier } from '@blocksuite/global/di';
import { FocusScopeProvider } from '@blocksuite/notesgraph/shared/services';
import type { ExtensionType } from '@blocksuite/notesgraph/store';
import { type Signal, signal } from '@preact/signals-core';

/**
 * Per-editor "outline zoom" state: which block the editor is currently focused
 * (zoomed) into. Provided into the editor's std DI so both the page-root view
 * (which scopes rendering to the focused subtree) and the React breadcrumb read
 * the same reactive signal.
 */
export interface OutlineZoom {
  readonly focusedBlockId$: Signal<string | null>;
  setFocus(blockId: string | null): void;
}

export const OutlineZoomIdentifier = createIdentifier<OutlineZoom>(
  'NotesGraphOutlineZoom'
);

// Implements the generic blocksuite-side FocusScopeProvider too, so code in
// the blocksuite packages (which can't depend on this frontend feature
// directly) can still ask "is a block outside the current zoom?" and exit
// it — see FocusScopeProvider's doc comment.
class OutlineZoomService implements OutlineZoom, FocusScopeProvider {
  readonly focusedBlockId$ = signal<string | null>(null);

  setFocus(blockId: string | null) {
    this.focusedBlockId$.value = blockId;
  }

  getFocusedBlockId() {
    return this.focusedBlockId$.value;
  }

  exitFocus() {
    this.setFocus(null);
  }
}

export const OutlineZoomStoreExtension: ExtensionType = {
  setup: di => {
    const service = new OutlineZoomService();
    di.addImpl(OutlineZoomIdentifier, () => service);
    di.addImpl(FocusScopeProvider, () => service);
  },
};
