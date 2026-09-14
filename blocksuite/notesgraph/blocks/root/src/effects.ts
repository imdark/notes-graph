import {
  EdgelessRootBlockComponent,
  EdgelessRootPreviewBlockComponent,
  PageRootBlockComponent,
  PreviewRootBlockComponent,
} from './index.js';

export function effects() {
  // Register components by category
  registerRootComponents();
}

function registerRootComponents() {
  customElements.define('notesgraph-page-root', PageRootBlockComponent);
  customElements.define('notesgraph-preview-root', PreviewRootBlockComponent);
  customElements.define('notesgraph-edgeless-root', EdgelessRootBlockComponent);
  customElements.define(
    'notesgraph-edgeless-root-preview',
    EdgelessRootPreviewBlockComponent
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-edgeless-root': EdgelessRootBlockComponent;
    'notesgraph-page-root': PageRootBlockComponent;
  }
}
