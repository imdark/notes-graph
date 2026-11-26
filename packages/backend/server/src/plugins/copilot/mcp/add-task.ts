import { nanoid } from 'nanoid';
import * as Y from 'yjs';

/**
 * File a task under a heading of a note (a project's section of a journal
 * day) as one surgical edit, so the rest of the note, its `todos:` databases
 * included, is never read back or rewritten.
 *
 * The task fills the first empty to-do under the heading, the one a new day
 * is scaffolded with. When there is none (an earlier task used it up), a new
 * to-do is added after the section's last list line. When the note has no
 * such heading, a `## <heading>` section is added for it, before Inbox when
 * the note has one. The to-do goes *under* the heading, as the app writes
 * them: a project's Task List claims tasks whose ancestor trail names it
 * (see scaffoldJournalSections in the frontend).
 */

export class AddTaskError extends Error {}

export interface AddTaskResult {
  update: Uint8Array;
  blockId: string;
  added: 'filled' | 'created';
  headingCreated: boolean;
}

type Block = Y.Map<unknown>;

/** As the app matches a journal section to its project. */
const nameKey = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');

/** The task line without a markdown list marker or empty checkbox. */
export function taskText(text: string): string {
  return text
    .trim()
    .replace(/^[-*+]\s+/, '')
    .replace(/^\[ \]\s*/, '')
    .trim();
}

export function addTaskUnderHeading(
  binary: Uint8Array,
  input: { heading: string; text: string; agent?: string; now?: Date }
): AddTaskResult {
  const heading = input.heading.replace(/[\r\n]+/g, ' ').trim();
  const text = taskText(input.text.replace(/[\r\n]+/g, ' '));
  if (!heading) throw new AddTaskError('The heading is empty.');
  if (!text) throw new AddTaskError('The task text is empty.');

  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  const before = Y.encodeStateVector(doc);
  const blocks = doc.getMap<Block>('blocks');

  let note: Block | undefined;
  blocks.forEach(block => {
    if (!note && block.get('sys:flavour') === 'notesgraph:note') note = block;
  });
  if (!note) throw new AddTaskError('The document has no note to add to.');
  const noteBlock = note;

  const childIds = (block: Block) =>
    (block.get('sys:children') as Y.Array<string> | undefined)?.toArray() ??
    [];
  const childArray = (block: Block) => {
    let children = block.get('sys:children') as Y.Array<string> | undefined;
    if (!children) {
      children = new Y.Array<string>();
      block.set('sys:children', children);
    }
    return children;
  };
  const isList = (id: string) =>
    blocks.get(id)?.get('sys:flavour') === 'notesgraph:list';
  const isHeading = (id: string) => {
    const block = blocks.get(id);
    return (
      block?.get('sys:flavour') === 'notesgraph:paragraph' &&
      /^h[1-6]$/.test(String(block.get('prop:type')))
    );
  };
  const blockText = (id: string) =>
    (blocks.get(id)?.get('prop:text') as Y.Text | undefined)?.toString() ?? '';
  const isEmptyTodo = (id: string) => {
    const block = blocks.get(id);
    return (
      !!block &&
      isList(id) &&
      block.get('prop:type') === 'todo' &&
      block.get('prop:checked') !== true &&
      !blockText(id).trim() &&
      !childIds(block).length
    );
  };
  const newBlock = (fill: (block: Block) => void, children: string[] = []) => {
    const id = nanoid(10);
    const block = new Y.Map<unknown>();
    const childList = new Y.Array<string>();
    childList.push(children);
    block.set('sys:id', id);
    block.set('sys:version', 1);
    block.set('sys:children', childList);
    fill(block);
    blocks.set(id, block);
    return id;
  };
  const plainText = (value: string) => {
    const t = new Y.Text();
    t.insert(0, value);
    return t;
  };
  const newTodo = () =>
    newBlock(block => {
      block.set('sys:flavour', 'notesgraph:list');
      block.set('prop:type', 'todo');
      block.set('prop:text', plainText(text));
      block.set('prop:checked', false);
      block.set('prop:collapsed', false);
      block.set('prop:order', null);
    });

  const name = input.agent?.trim() || 'AI agent';
  const stampPrefix = `Edited via MCP by ${name} — `;
  const isStamp = (id: string) =>
    blocks.get(id)?.get('prop:type') === 'quote' &&
    blockText(id).startsWith('Edited via MCP by ');

  const top = childIds(noteBlock);
  const headingId = top.find(
    id => isHeading(id) && nameKey(blockText(id)) === nameKey(heading)
  );

  const place = (): Omit<AddTaskResult, 'update'> => {
    if (headingId) {
      const headingBlock = blocks.get(headingId) as Block;
      const nested = childIds(headingBlock);
      // A page written as markdown (ensure_journal's) has its to-dos beside
      // the heading until the app nests them.
      const beside: string[] = [];
      for (const id of top.slice(top.indexOf(headingId) + 1)) {
        if (!isList(id)) break;
        beside.push(id);
      }
      const empty = [...nested, ...beside].find(isEmptyTodo);
      if (empty) {
        const block = blocks.get(empty) as Block;
        const t = block.get('prop:text') as Y.Text | undefined;
        if (t) {
          t.delete(0, t.length);
          t.insert(0, text);
        } else {
          block.set('prop:text', plainText(text));
        }
        return { blockId: empty, added: 'filled', headingCreated: false };
      }
      const todo = newTodo();
      const lastNested = nested.findLastIndex(isList);
      if (lastNested < 0 && beside.length) {
        const at = top.indexOf(beside[beside.length - 1]) + 1;
        childArray(noteBlock).insert(at, [todo]);
      } else {
        const at = lastNested < 0 ? nested.length : lastNested + 1;
        childArray(headingBlock).insert(at, [todo]);
      }
      return { blockId: todo, added: 'created', headingCreated: false };
    }

    const todo = newTodo();
    const section = newBlock(
      block => {
        block.set('sys:flavour', 'notesgraph:paragraph');
        block.set('prop:type', 'h2');
        block.set('prop:text', plainText(heading));
        block.set('prop:collapsed', false);
      },
      [todo]
    );
    const inbox = top.findIndex(
      id => isHeading(id) && nameKey(blockText(id)) === 'inbox'
    );
    let at = top.length;
    if (inbox >= 0 && nameKey(heading) !== 'inbox') at = inbox;
    else if (top.length && isStamp(top[top.length - 1])) at = top.length - 1;
    childArray(noteBlock).insert(at, [section]);
    return { blockId: todo, added: 'created', headingCreated: true };
  };

  // The "Edited via MCP" provenance stamp every MCP write leaves, refreshed
  // when this agent's stamp already ends the note.
  const stampAttribution = () => {
    const at = (input.now ?? new Date()).toISOString().slice(0, 16);
    const stamp = `${stampPrefix}${at.replace('T', ' ')}`;
    const last = childIds(noteBlock).at(-1);
    if (last && isStamp(last) && blockText(last).startsWith(stampPrefix)) {
      const t = blocks.get(last)?.get('prop:text') as Y.Text;
      t.delete(0, t.length);
      t.insert(0, stamp);
      return;
    }
    childArray(noteBlock).push([
      newBlock(block => {
        block.set('sys:flavour', 'notesgraph:paragraph');
        block.set('prop:type', 'quote');
        block.set('prop:text', plainText(stamp));
        block.set('prop:collapsed', false);
      }),
    ]);
  };

  const result = doc.transact(() => {
    const placed = place();
    stampAttribution();
    return placed;
  });
  return { ...result, update: Y.encodeStateAsUpdate(doc, before) };
}
