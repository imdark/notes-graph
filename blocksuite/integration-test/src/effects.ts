import '@blocksuite/notesgraph/effects';

import { TestNotesGraphEditorContainer } from './editors/index.js';

export function effects() {
  customElements.define(
    'notesgraph-editor-container',
    TestNotesGraphEditorContainer
  );
}
