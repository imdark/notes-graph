import { ImageBlockFallbackCard } from './components/image-block-fallback.js';
import { ImageBlockPageComponent } from './components/page-image-block.js';
import { ImageBlockComponent } from './image-block.js';
import { ImageEdgelessBlockComponent } from './image-edgeless-block.js';
import { ImageEdgelessPlaceholderBlockComponent } from './preview-image/edgeless.js';
import { ImagePlaceholderBlockComponent } from './preview-image/page.js';

export function effects() {
  customElements.define('notesgraph-image', ImageBlockComponent);
  customElements.define(
    'notesgraph-edgeless-image',
    ImageEdgelessBlockComponent
  );
  customElements.define('notesgraph-page-image', ImageBlockPageComponent);
  customElements.define(
    'notesgraph-image-fallback-card',
    ImageBlockFallbackCard
  );
  customElements.define(
    'notesgraph-placeholder-preview-image',
    ImagePlaceholderBlockComponent
  );
  customElements.define(
    'notesgraph-edgeless-placeholder-preview-image',
    ImageEdgelessPlaceholderBlockComponent
  );
}
