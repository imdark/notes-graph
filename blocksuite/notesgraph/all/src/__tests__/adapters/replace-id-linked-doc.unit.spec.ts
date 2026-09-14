import { replaceIdMiddleware } from '@blocksuite/notesgraph-shared/adapters';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph-shared/types';
import type {
  DeltaInsert,
  DocSnapshot,
  Store,
  Workspace,
} from '@blocksuite/store';
import { Schema, Text, Transformer } from '@blocksuite/store';
import { TestWorkspace } from '@blocksuite/store/test';
import { describe, expect, test } from 'vitest';

import { NotesGraphSchemas } from '../../schemas.js';
import { testStoreExtensions } from '../utils/store.js';

function createWorkspace() {
  const schema = new Schema().register(NotesGraphSchemas);
  const collection = new TestWorkspace();
  collection.storeExtensions = testStoreExtensions;
  collection.meta.initialize();
  return { schema, collection };
}

function makeTransformer(
  schema: Schema,
  collection: Workspace,
  middlewares: Transformer['middlewares'] = []
) {
  return new Transformer({
    schema,
    blobCRUD: collection.blobSync,
    docCRUD: {
      create: (id: string) => collection.createDoc(id).getStore({ id }),
      get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
      delete: (id: string) => collection.removeDoc(id),
    },
    middlewares,
  });
}

/** Builds a note; when `refPageId` is set, its paragraph is a LinkedPage ref. */
function buildDoc(
  collection: Workspace,
  docId: string,
  title: string,
  refPageId?: string
) {
  const doc = collection.createDoc(docId);
  doc.load();
  const store = doc.getStore({ id: docId });
  const rootId = store.addBlock('notesgraph:page', { title: new Text(title) });
  const noteId = store.addBlock('notesgraph:note', {}, rootId);
  const delta: DeltaInsert<NotesGraphTextAttributes>[] = refPageId
    ? [
        {
          insert: ' ',
          attributes: {
            reference: { type: 'LinkedPage', pageId: refPageId },
          },
        },
      ]
    : [{ insert: 'hello' }];
  store.addBlock('notesgraph:paragraph', { text: new Text(delta) }, noteId);
  return store;
}

function firstReferencePageId(store: Store): string | undefined {
  for (const model of store.getModelsByFlavour('notesgraph:paragraph')) {
    const text = (model.props as { text?: Text }).text;
    if (!text) continue;
    for (const d of text.toDelta() as DeltaInsert<NotesGraphTextAttributes>[]) {
      const pageId = d.attributes?.reference?.pageId;
      if (pageId) return pageId;
    }
  }
  return undefined;
}

/**
 * Round-trips two cross-linked notes (A -> B) through the snapshot
 * transformer, importing them in the given order with a single shared
 * `replaceIdMiddleware` (exactly how `ZipTransformer.importDocs` works).
 */
async function roundTrip(order: 'a-first' | 'b-first') {
  const src = createWorkspace();
  const storeB = buildDoc(src.collection, 'doc-b', 'Note B');
  const storeA = buildDoc(src.collection, 'doc-a', 'Note A', 'doc-b');

  // Export keeps original ids (import slots are dormant during export).
  const exportJob = makeTransformer(src.schema, src.collection);
  const snapA = exportJob.docToSnapshot(storeA) as DocSnapshot;
  const snapB = exportJob.docToSnapshot(storeB) as DocSnapshot;
  expect(snapA).toBeTruthy();
  expect(snapB).toBeTruthy();

  const dst = createWorkspace();
  const importJob = makeTransformer(dst.schema, dst.collection, [
    replaceIdMiddleware(dst.collection.idGenerator),
  ]);

  const [first, second] =
    order === 'a-first' ? [snapA, snapB] : [snapB, snapA];
  const firstDoc = await importJob.snapshotToDoc(first);
  const secondDoc = await importJob.snapshotToDoc(second);

  const newA = (order === 'a-first' ? firstDoc : secondDoc) as Store;
  const newB = (order === 'a-first' ? secondDoc : firstDoc) as Store;

  return {
    refId: firstReferencePageId(newA),
    newBId: newB.id,
    dst: dst.collection,
  };
}

describe('replaceIdMiddleware cross-doc LinkedPage references', () => {
  test('link survives when the referencing note is imported first', async () => {
    const { refId, newBId, dst } = await roundTrip('a-first');
    expect(refId).toBe(newBId);
    expect(dst.getDoc(newBId)).toBeTruthy();
  });

  test('link survives when the referenced note is imported first', async () => {
    const { refId, newBId, dst } = await roundTrip('b-first');
    expect(refId).toBe(newBId);
    expect(dst.getDoc(newBId)).toBeTruthy();
  });
});
