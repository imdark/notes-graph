import { LinkPreview } from './link';

export * from './link';

export function effects() {
  customElements.define('notesgraph-link-preview', LinkPreview);
}
