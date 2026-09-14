import type { RootBlockModel } from '@blocksuite/notesgraph/model';
import { BlockComponent } from '@blocksuite/notesgraph/std';
import { html } from 'lit';

export class MindmapRootBlock extends BlockComponent<RootBlockModel> {
  override render() {
    return html`
      <style>
        .notesgraph-mini-mindmap-root {
          display: block;
          width: 100%;
          height: 100%;

          background-size: 20px 20px;
          background-color: var(--notesgraph-background-primary-color);
          background-image: radial-gradient(
            var(--notesgraph-edgeless-grid-color) 1px,
            var(--notesgraph-background-primary-color) 1px
          );
        }
      </style>
      <div class="notesgraph-mini-mindmap-root">
        ${this.host.renderChildren(this.model)}
      </div>
    `;
  }
}
