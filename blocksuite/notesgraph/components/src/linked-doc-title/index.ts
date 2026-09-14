import { DocTitle } from './doc-title';

export * from './doc-title';

export function effects() {
  customElements.define('notesgraph-linked-doc-title', DocTitle);
}
