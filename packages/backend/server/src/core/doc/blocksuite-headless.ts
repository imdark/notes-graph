import { nanoid } from 'nanoid';
import * as Y from 'yjs';

export class DocNotFoundInBinaryError extends Error {}
export class NoteBlockNotFoundError extends Error {}

// Block CRDT shape reverse-engineered from a real `Store.addBlock(...)` call
// (via `@blocksuite/store`, verified once, then hand-replicated here) rather
// than depending on `@blocksuite/store` itself at runtime: that package is a
// Yarn workspace-local package whose real source lives outside
// `packages/backend/server` (in the top-level `blocksuite/` directory), and
// the production Docker image only copies `packages/backend/server` into the
// build context (see `.github/deployment/node/Dockerfile`) — so the
// workspace symlink resolves locally but is dangling inside the container,
// breaking at runtime with `Cannot find package '@blocksuite/store'`. Pure
// `yjs` (a real, already-vendored npm dependency — see
// `core/doc/merge-updates.ts`/`storage/doc.ts`) has no such problem.
//
// A paragraph block is a Y.Map under the doc's top-level 'blocks' Y.Map,
// keyed by block id, with these keys (verified against real output):
//   sys:id        string
//   sys:flavour   string
//   sys:version   number
//   sys:children  Y.Array<string>
//   prop:type     string ('text')
//   prop:text     Y.Text
//   prop:collapsed boolean
// (Undefined-valued props — textAlign, comments — are simply absent as keys,
// not stored as explicit undefined.)

/**
 * Loads `existingBinary`, appends a paragraph block containing a
 * `LinkedPage` reference to `targetDocId` under the doc's note, and returns
 * the minimal Y.js update delta for just that change — the same
 * "encode only what changed since the pre-op state" shape `DocWriter`'s
 * native markdown-diff functions already produce, so it can be pushed via
 * `PgWorkspaceDocStorageAdapter.pushDocUpdates` the same way.
 *
 * Mirrors the frontend's `DocsService.addLinkedDoc` (which does this against
 * a live in-browser doc via BlockSuite's `Store.addBlock`) — this is the
 * server-side equivalent, since the markdown write pipeline
 * (create_document/update_document) has no way to author a real doc-to-doc
 * reference: it only ever produces plain-text hyperlinks, never the
 * `reference` inline attribute a backlink requires.
 */
export function appendLinkedDocReference(
  existingBinary: Uint8Array,
  docId: string,
  targetDocId: string
): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, existingBinary);
  const beforeState = Y.encodeStateVector(doc);

  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  if (blocks.size === 0) {
    throw new DocNotFoundInBinaryError(
      `Binary for doc ${docId} did not decode into any blocks.`
    );
  }

  let noteBlock: Y.Map<unknown> | undefined;
  blocks.forEach(block => {
    if (block.get('sys:flavour') === 'notesgraph:note') {
      noteBlock = block;
    }
  });
  if (!noteBlock) {
    throw new NoteBlockNotFoundError(
      `Doc ${docId} has no notesgraph:note block to link under.`
    );
  }

  doc.transact(() => {
    const newId = nanoid(10);
    const text = new Y.Text();
    text.insert(0, ' ', { reference: { type: 'LinkedPage', pageId: targetDocId } });

    const block = new Y.Map<unknown>();
    block.set('sys:id', newId);
    block.set('sys:flavour', 'notesgraph:paragraph');
    block.set('sys:version', 1);
    block.set('sys:children', new Y.Array<string>());
    block.set('prop:type', 'text');
    block.set('prop:text', text);
    block.set('prop:collapsed', false);

    blocks.set(newId, block);
    (noteBlock!.get('sys:children') as Y.Array<string>).push([newId]);
  });

  return Y.encodeStateAsUpdate(doc, beforeState);
}
