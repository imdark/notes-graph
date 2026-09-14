import { PageRootBlockComponent } from '@blocksuite/notesgraph/blocks/root';
import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';

import { OutlineZoomIdentifier } from './outline-zoom-service';

/**
 * Page root that, when an outline-zoom focus is set, renders only the focused
 * block's subtree (the focused block + its descendants) instead of the notes.
 * It renders the real blocks, so editing works normally — no sync needed.
 */
export class FocusablePageRootBlock extends PageRootBlockComponent {
  override renderBlock() {
    const zoom = this.std.getOptional(OutlineZoomIdentifier);
    const focusId = zoom?.focusedBlockId$.value ?? null;
    if (focusId) {
      const model = this.store.getBlock(focusId)?.model;
      const parent = model?.parent;
      if (model && parent) {
        const widgets = html`${repeat(
          Object.entries(this.widgets),
          ([id]) => id,
          ([_, widget]) => widget
        )}`;
        // Render just the focused block (which renders its own children nested).
        const children = this.renderChildren(
          parent,
          child => child.id === model.id
        );
        this.contentEditable = String(!this.store.readonly$.value);
        return html`
          <div class="notesgraph-page-root-block-container">
            ${children} ${widgets}
          </div>
        `;
      }
    }
    return super.renderBlock();
  }
}
