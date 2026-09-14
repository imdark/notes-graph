import { NotesGraphSchemas } from '@blocksuite/notesgraph/schemas';
import { Schema, Text, type Workspace } from '@blocksuite/notesgraph/store';
import { ZipTransformer } from '@blocksuite/notesgraph/widgets/linked-doc';
export async function notesgraphSnapshot(collection: Workspace, id: string) {
  const doc = collection.createDoc(id);
  doc.load();
  const store = doc.getStore();
  // Add root block and surface block at root level
  const rootId = store.addBlock('notesgraph:page', {
    title: new Text('NotesGraph Snapshot Test'),
  });
  store.addBlock('notesgraph:surface', {}, rootId);

  const path = '/apps/starter/data/snapshots/notesgraph-default.zip';
  const response = await fetch(path);
  const file = await response.blob();
  const schema = new Schema();
  schema.register(NotesGraphSchemas);
  await ZipTransformer.importDocs(collection, schema, file);
}

notesgraphSnapshot.id = 'notesgraph-snapshot';
notesgraphSnapshot.displayName = 'NotesGraph Snapshot Test';
notesgraphSnapshot.description = 'NotesGraph Snapshot Test';
