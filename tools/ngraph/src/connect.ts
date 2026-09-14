import * as Y from 'yjs';

import { loadDoc } from './notes';
import type { Transport } from './transport';

const NANOID_ALPHABET =
  'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';

/** BlockSuite block ids are nanoid(21); generate a compatible one. */
function blockId(): string {
  let id = '';
  const bytes = new Uint8Array(21);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) id += NANOID_ALPHABET[b & 63];
  return id;
}

function flavourOf(block: unknown): string {
  return block instanceof Y.Map ? String(block.get('sys:flavour') ?? '') : '';
}

/**
 * Append a paragraph containing an inline reference (a graph edge) from the
 * loaded doc to `targetId`, and return the diff update relative to `since`.
 * Matches the doc's existing flavour namespace so it stays consistent whether
 * the fork uses `notesgraph:` or `affine:` prefixes.
 */
function addReferenceBlock(
  doc: Y.Doc,
  targetId: string,
  label: string
): Uint8Array {
  const blocks = doc.getMap('blocks');
  let note: Y.Map<unknown> | undefined;
  let paragraphVersion = 1;
  let prefix = 'affine';
  for (const value of blocks.values()) {
    const flavour = flavourOf(value);
    if (!flavour) continue;
    const [ns] = flavour.split(':');
    if (flavour.endsWith(':note') && value instanceof Y.Map) {
      note ??= value;
      prefix = ns;
    } else if (flavour.endsWith(':paragraph') && value instanceof Y.Map) {
      paragraphVersion = Number(value.get('sys:version')) || paragraphVersion;
      prefix = ns;
    } else if (flavour.endsWith(':page')) {
      prefix = ns;
    }
  }
  if (!note) {
    throw new Error('No note container found in this doc; cannot add a link.');
  }

  const sv = Y.encodeStateVector(doc);
  doc.transact(() => {
    const id = blockId();
    const block = new Y.Map();
    block.set('sys:id', id);
    block.set('sys:flavour', `${prefix}:paragraph`);
    block.set('sys:version', paragraphVersion);
    block.set('sys:children', new Y.Array());
    block.set('prop:type', 'text');
    const text = new Y.Text();
    text.applyDelta([
      ...(label ? [{ insert: `${label} ` }] : []),
      {
        insert: ' ',
        attributes: { reference: { type: 'LinkedPage', pageId: targetId } },
      },
    ]);
    block.set('prop:text', text);
    blocks.set(id, block);
    const children = note.get('sys:children');
    if (children instanceof Y.Array) {
      children.push([id]);
    }
  });
  return Y.encodeStateAsUpdate(doc, sv);
}

/**
 * Link note `fromId` to note `toId` by inserting an inline reference and
 * pushing the resulting Yjs update. Works on any transport (offline or live).
 */
export async function connectNotes(
  t: Transport,
  fromId: string,
  toId: string,
  label = 'Related:'
): Promise<void> {
  const doc = await loadDoc(t, fromId);
  if (!doc) throw new Error(`Note not found: ${fromId}`);
  // Ensure the target exists so we don't create a dangling edge silently.
  const target = await t.getDocBin(toId);
  if (!target) throw new Error(`Target note not found: ${toId}`);
  const update = addReferenceBlock(doc, toId, label);
  await t.pushUpdate(fromId, update);
}
