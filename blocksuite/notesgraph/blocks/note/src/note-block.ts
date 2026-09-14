import type { NoteBlockModel } from '@blocksuite/notesgraph-model';
import { BlockComponent } from '@blocksuite/std';
import { css, html } from 'lit';

export class NoteBlockComponent extends BlockComponent<NoteBlockModel> {
  static override styles = css`
    .notesgraph-note-block-container {
      display: flow-root;
    }
    .notesgraph-note-block-container.selected {
      background-color: var(--notesgraph-hover-color);
    }
  `;

  override connectedCallback() {
    super.connectedCallback();
  }

  override renderBlock() {
    return html`
      <div class="notesgraph-note-block-container">
        <div class="notesgraph-block-children-container">
          ${this.renderChildren(this.model)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-note': NoteBlockComponent;
  }
}
