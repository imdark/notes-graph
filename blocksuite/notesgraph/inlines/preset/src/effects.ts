import { NotesGraphText } from './nodes/notesgraph-text';
import { OrgStatusNode } from './nodes/org-status-node';
import { OrgTimestampNode } from './nodes/org-timestamp-node';

export function effects() {
  customElements.define('notesgraph-text', NotesGraphText);
  customElements.define('notesgraph-org-status', OrgStatusNode);
  customElements.define('notesgraph-org-timestamp', OrgTimestampNode);
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-text': NotesGraphText;
    'notesgraph-org-status': OrgStatusNode;
    'notesgraph-org-timestamp': OrgTimestampNode;
  }
}
