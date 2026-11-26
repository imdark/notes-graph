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
  return appendToNote(existingBinary, docId, [
    {
      fill: block => {
        const text = new Y.Text();
        text.insert(0, ' ', {
          reference: { type: 'LinkedPage', pageId: targetDocId },
        });
        block.set('sys:flavour', 'notesgraph:paragraph');
        block.set('sys:version', 1);
        block.set('prop:type', 'text');
        block.set('prop:text', text);
        block.set('prop:collapsed', false);
      },
    },
  ]);
}

/**
 * Appends an HTML embed block (a sandboxed, script-enabled iframe in the
 * editor) to the end of the doc's note, as the editor's "HTML" embed would.
 * The props past html/caption are the embed schema's defaults
 * (`createEmbedBlockSchema`), written out so the block is complete as stored.
 */
export function appendEmbedHtmlBlock(
  existingBinary: Uint8Array,
  docId: string,
  html: string,
  caption: string | null
): Uint8Array {
  return appendToNote(existingBinary, docId, [
    {
      fill: block => {
        block.set('sys:flavour', 'notesgraph:embed-html');
        block.set('sys:version', 1);
        block.set('prop:style', 'html');
        block.set('prop:html', html);
        block.set('prop:caption', caption);
        block.set('prop:index', 'a0');
        block.set('prop:xywh', '[0,0,0,0]');
        block.set('prop:lockedBySelf', false);
        block.set('prop:rotate', 0);
      },
    },
  ]);
}

export interface Flashcard {
  question: string;
  answer: string;
}

/**
 * Appends flashcards to the end of the doc's note. Each card is a collapsed
 * bulleted list item holding the question, with the answer as its child
 * paragraph, so the answer stays hidden until the item is expanded. (The
 * list schema's `toggle` type is deprecated; any list item with children
 * collapses.)
 */
export function appendFlashcards(
  existingBinary: Uint8Array,
  docId: string,
  cards: Flashcard[]
): Uint8Array {
  return appendToNote(
    existingBinary,
    docId,
    cards.map(card => ({
      fill: block => {
        block.set('sys:flavour', 'notesgraph:list');
        block.set('sys:version', 1);
        block.set('prop:type', 'bulleted');
        block.set('prop:text', plainText(card.question));
        block.set('prop:checked', false);
        block.set('prop:collapsed', true);
        block.set('prop:order', null);
      },
      children: [
        {
          fill: block => {
            block.set('sys:flavour', 'notesgraph:paragraph');
            block.set('sys:version', 1);
            block.set('prop:type', 'text');
            block.set('prop:text', plainText(card.answer));
            block.set('prop:collapsed', false);
          },
        },
      ],
    }))
  );
}

function plainText(value: string): Y.Text {
  const text = new Y.Text();
  text.insert(0, value);
  return text;
}

const MARKDOWN_LINK = /\[([^\]]+)\]\((\S+?)\)/g;

/**
 * `value` as a text delta, its `[label](url)` links as linked labels. Apply
 * it once the text is in the doc: formatting given to a Y.Text before that
 * is dropped.
 */
function linkDelta(value: string) {
  const ops: { insert: string; attributes?: { link: string } }[] = [];
  let last = 0;
  for (const match of value.matchAll(MARKDOWN_LINK)) {
    const before = value.slice(last, match.index);
    if (before) ops.push({ insert: before });
    ops.push({ insert: match[1], attributes: { link: match[2] } });
    last = (match.index ?? 0) + match[0].length;
  }
  const rest = value.slice(last);
  if (rest) ops.push({ insert: rest });
  return ops;
}

const HEADING_TYPES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

function isHeading(block: Y.Map<unknown> | undefined): boolean {
  return (
    block?.get('sys:flavour') === 'notesgraph:paragraph' &&
    HEADING_TYPES.has(String(block.get('prop:type')))
  );
}

function blockText(block: Y.Map<unknown> | undefined): string {
  const text = block?.get('prop:text');
  return text instanceof Y.Text ? text.toString() : '';
}

/** A heading name compared ignoring case, spaces and punctuation. */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isEmptyTodo(block: Y.Map<unknown> | undefined): boolean {
  return (
    block?.get('sys:flavour') === 'notesgraph:list' &&
    block.get('prop:type') === 'todo' &&
    !block.get('prop:checked') &&
    blockText(block).trim() === ''
  );
}

/** A to-do item whose text is filled in by `later` once it is in the doc. */
function todoSpec(line: string, later: (() => void)[]): BlockSpec {
  return {
    fill: block => {
      const text = new Y.Text();
      block.set('sys:flavour', 'notesgraph:list');
      block.set('sys:version', 1);
      block.set('prop:type', 'todo');
      block.set('prop:text', text);
      block.set('prop:checked', false);
      block.set('prop:collapsed', false);
      block.set('prop:order', null);
      later.push(() => text.applyDelta(linkDelta(line)));
    },
  };
}

/**
 * Adds `lines` as unchecked to-do items under the heading named like
 * `heading` (ignoring case, spaces and punctuation), and returns only that
 * change as an update: every other block stays exactly as it was, which a
 * markdown rewrite of the doc can't promise (databases, images, embeds).
 *
 * The first line fills the section's empty to-do when it has one (a daily
 * note's template leaves one under each heading); the rest go after the
 * section's last block before its first subheading. A missing heading is
 * added, as an h2, before the "Inbox" heading or at the end.
 */
export function insertUnderHeading(
  existingBinary: Uint8Array,
  docId: string,
  heading: string,
  lines: string[]
): Uint8Array {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, existingBinary);
  const beforeState = Y.encodeStateVector(doc);
  if (lines.length === 0) return Y.encodeStateAsUpdate(doc, beforeState);

  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  if (blocks.size === 0) {
    throw new DocNotFoundInBinaryError(
      `Binary for doc ${docId} did not decode into any blocks.`
    );
  }
  let note: Y.Map<unknown> | undefined;
  blocks.forEach(block => {
    if (block.get('sys:flavour') === 'notesgraph:note') note = block;
  });
  if (!note) {
    throw new NoteBlockNotFoundError(
      `Doc ${docId} has no notesgraph:note block to add to.`
    );
  }
  const children = note.get('sys:children') as Y.Array<string>;
  const ids = children.toArray();
  const at = (i: number) => blocks.get(ids[i]);

  const addBlock = (spec: BlockSpec): string => {
    const newId = nanoid(10);
    const kids = new Y.Array<string>();
    kids.push((spec.children ?? []).map(addBlock));
    const block = new Y.Map<unknown>();
    block.set('sys:id', newId);
    block.set('sys:children', kids);
    spec.fill(block);
    blocks.set(newId, block);
    return newId;
  };

  const key = nameKey(heading);
  const start = ids.findIndex(
    (_, i) => isHeading(at(i)) && nameKey(blockText(at(i))) === key
  );

  // Texts to fill once their blocks are in the doc.
  const later: (() => void)[] = [];
  const todo = (line: string) => todoSpec(line, later);

  doc.transact(() => {
    insert();
    for (const fill of later) fill();
  });

  return Y.encodeStateAsUpdate(doc, beforeState);

  function insert() {
    if (start === -1) {
      const inbox = ids.findIndex(
        (_, i) => isHeading(at(i)) && nameKey(blockText(at(i))) === 'inbox'
      );
      const headingSpec: BlockSpec = {
        fill: block => {
          block.set('sys:flavour', 'notesgraph:paragraph');
          block.set('sys:version', 1);
          block.set('prop:type', 'h2');
          block.set('prop:text', plainText(heading));
          block.set('prop:collapsed', false);
        },
      };
      const added = [headingSpec, ...lines.map(todo)].map(addBlock);
      children.insert(inbox === -1 ? ids.length : inbox, added);
      return;
    }

    let end = ids.length;
    for (let i = start + 1; i < ids.length; i++) {
      if (isHeading(at(i))) {
        end = i;
        break;
      }
    }
    let rest = lines;
    const empty = ids.findIndex(
      (_, i) => i > start && i < end && isEmptyTodo(at(i))
    );
    let insertAt: number;
    const emptyBlock = empty === -1 ? undefined : at(empty);
    if (emptyBlock) {
      let text = emptyBlock.get('prop:text');
      if (text instanceof Y.Text) {
        text.delete(0, text.length);
      } else {
        // An empty item may have no text at all yet.
        text = new Y.Text();
        emptyBlock.set('prop:text', text);
      }
      (text as Y.Text).applyDelta(linkDelta(rest[0]));
      rest = rest.slice(1);
      insertAt = empty + 1;
    } else {
      // After the section's last block with text, so trailing blank
      // paragraphs stay between it and the next heading.
      insertAt = start + 1;
      for (let i = end - 1; i > start; i--) {
        const block = at(i);
        if (
          blockText(block).trim() ||
          block?.get('sys:flavour') !== 'notesgraph:paragraph'
        ) {
          insertAt = i + 1;
          break;
        }
      }
    }
    if (rest.length) {
      children.insert(insertAt, rest.map(todo).map(addBlock));
    }
  }
}

interface BlockSpec {
  fill: (block: Y.Map<unknown>) => void;
  children?: BlockSpec[];
}

/**
 * Loads the doc, adds the given blocks (and their children) as the last
 * children of its note, and returns only that change as an update.
 */
function appendToNote(
  existingBinary: Uint8Array,
  docId: string,
  specs: BlockSpec[]
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
      `Doc ${docId} has no notesgraph:note block to add to.`
    );
  }

  const note = noteBlock;
  const addBlock = (spec: BlockSpec): string => {
    const childIds = (spec.children ?? []).map(addBlock);
    const newId = nanoid(10);
    const children = new Y.Array<string>();
    children.push(childIds);
    const block = new Y.Map<unknown>();
    block.set('sys:id', newId);
    block.set('sys:children', children);
    spec.fill(block);
    blocks.set(newId, block);
    return newId;
  };

  doc.transact(() => {
    (note.get('sys:children') as Y.Array<string>).push(specs.map(addBlock));
  });

  return Y.encodeStateAsUpdate(doc, beforeState);
}
