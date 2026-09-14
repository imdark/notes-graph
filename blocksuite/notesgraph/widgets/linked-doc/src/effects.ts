import { NOTESGRAPH_LINKED_DOC_WIDGET } from './config.js';
import { ImportDoc } from './import-doc/import-doc.js';
import { Loader } from './import-doc/loader.js';
import { NotesGraphLinkedDocWidget } from './index.js';
import { LinkedDocPopover } from './linked-doc-popover.js';
import { NotesGraphMobileLinkedDocMenu } from './mobile-linked-doc-menu.js';

export function effects() {
  customElements.define('notesgraph-linked-doc-popover', LinkedDocPopover);
  customElements.define(
    NOTESGRAPH_LINKED_DOC_WIDGET,
    NotesGraphLinkedDocWidget
  );
  customElements.define('import-doc', ImportDoc);
  customElements.define(
    'notesgraph-mobile-linked-doc-menu',
    NotesGraphMobileLinkedDocMenu
  );
  customElements.define('loader-element', Loader);
}
