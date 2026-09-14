import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';

export function createEmptyDoc() {
  const collection = new TestWorkspace();
  collection.storeExtensions = getTestStoreManager().get('store');
  collection.meta.initialize();
  const doc = collection.createDoc();
  const store = doc.getStore();

  return {
    doc,
    init() {
      doc.load();
      const rootId = store.addBlock('notesgraph:page', {});
      store.addBlock('notesgraph:surface', {}, rootId);
      const noteId = store.addBlock('notesgraph:note', {}, rootId);
      store.addBlock('notesgraph:paragraph', {}, noteId);
      return store;
    },
  };
}
