import { MarkdownTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';

import { extractMarkdownFromDoc } from '../../../blocksuite/ai/utils/extract';
import { getStoreManager } from '../../../blocksuite/manager/store';
import type { DocsService } from '../../doc';
import type { WorkspaceService } from '../../workspace';

/**
 * Merges one note into another: the merged doc's content is appended to
 * the kept doc (divider + original title as a heading + body), and the
 * merged doc is moved to trash — recoverable from there. Returns the
 * kept doc id.
 */
export async function mergeDocs(
  workspaceService: WorkspaceService,
  docsService: DocsService,
  keepDocId: string,
  mergeDocId: string
): Promise<string> {
  const collection = workspaceService.workspace.docCollection;

  const mergeDoc = collection.getDoc(mergeDocId);
  if (!mergeDoc) throw new Error('Doc to merge not found');
  mergeDoc.load();
  const mergeStore = mergeDoc.getStore({ id: mergeDocId });
  let markdown = '';
  try {
    markdown = await extractMarkdownFromDoc(mergeStore);
  } catch {
    // empty docs throw (no snapshot) — merge just the title
  }
  const mergeTitle =
    docsService.list.docsMap$.value
      .get(mergeDocId)
      ?.meta$.value.title?.trim() || 'Untitled';

  const keepDoc = collection.getDoc(keepDocId);
  if (!keepDoc) throw new Error('Doc to keep not found');
  keepDoc.load();
  const keepStore = keepDoc.getStore({ id: keepDocId });
  const pageBlockId = keepStore.getBlocksByFlavour('notesgraph:page')[0]?.id;
  if (!pageBlockId) throw new Error('Doc to keep has no page block');

  keepStore.captureSync();
  const noteBlockId = keepStore.addBlock('notesgraph:note', {}, pageBlockId);
  await MarkdownTransformer.importMarkdownToBlock({
    doc: keepStore,
    blockId: noteBlockId,
    markdown: `---\n\n# ${mergeTitle}\n\n${markdown}`,
    extensions: getStoreManager().config.init().value.get('store'),
  });

  docsService.list.doc$(mergeDocId).value?.moveToTrash();
  return keepDocId;
}
