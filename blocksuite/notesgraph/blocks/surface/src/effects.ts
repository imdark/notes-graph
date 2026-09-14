import { SurfaceBlockComponent } from './surface-block.js';
import { SurfaceBlockVoidComponent } from './surface-block-void.js';

export function effects() {
  customElements.define('notesgraph-surface-void', SurfaceBlockVoidComponent);
  customElements.define('notesgraph-surface', SurfaceBlockComponent);
}
