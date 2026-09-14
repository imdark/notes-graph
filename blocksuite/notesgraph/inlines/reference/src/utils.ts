import { REFERENCE_NODE } from '@blocksuite/notesgraph-shared/consts';
import type { NotesGraphInlineEditor } from '@blocksuite/notesgraph-shared/types';

export function insertLinkedNode({
  inlineEditor,
  docId,
}: {
  inlineEditor: NotesGraphInlineEditor;
  docId: string;
}) {
  if (!inlineEditor) return;
  const inlineRange = inlineEditor.getInlineRange();
  if (!inlineRange) return;
  inlineEditor.insertText(inlineRange, REFERENCE_NODE, {
    reference: { type: 'LinkedPage', pageId: docId },
  });
  inlineEditor.setInlineRange({
    index: inlineRange.index + 1,
    length: 0,
  });
}
