import { AttachmentBlockComponent } from './attachment-block';
import { AttachmentEdgelessBlockComponent } from './attachment-edgeless-block';

export function effects() {
  customElements.define(
    'notesgraph-edgeless-attachment',
    AttachmentEdgelessBlockComponent
  );
  customElements.define('notesgraph-attachment', AttachmentBlockComponent);
}
