import { nanoid } from 'nanoid';
import * as Y from 'yjs';

/**
 * Filing a task in a day's journal straight on its CRDT (pure yjs, as
 * core/doc/blocksuite-headless.ts), the way the app's moveToProject puts a
 * task in a project (modules/agents/services/task-project.ts): a to-do under
 * the section's "## <project>" heading, above the section's empty to-do. A
 * section the page lacks is made as the app's scaffoldJournalSections makes
 * one: the heading with an empty to-do under it, then the project's "todos:"
 * Task List. Nothing else on the page is touched, which a markdown rewrite
 * (read_document, add a line, update_document) can't promise: a Task List
 * reads back as a heading and a table.
 */

/** The section of tasks that belong to no project. */
export const INBOX = 'Inbox';

/** Heading names match as the app's do: case, spaces, `-` and `_` aside. */
export const nameKey = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '');

export interface JournalSection {
  name: string;
  /** The project the section's Task List lists; none for Inbox. */
  projectId?: string;
}

export interface FiledTask {
  update: Uint8Array;
  blockId: string;
  /** The section was missing and is new. */
  createdSection: boolean;
}

/**
 * A line handed in as markdown keeps its words, not its list marker: `- [ ]
 * fix it` is filed as the to-do "fix it", `[x] done` as a checked one.
 */
export function taskLine(text: string): { text: string; checked: boolean } {
  const line = text.replace(/\s+/g, ' ').trim();
  const match = /^(?:[-*+]\s+)?\[( |x|X)\]\s*/.exec(line);
  if (match) {
    return { text: line.slice(match[0].length), checked: match[1] !== ' ' };
  }
  return { text: line.replace(/^[-*+]\s+/, ''), checked: false };
}

const childIds = (block: Y.Map<unknown>): string[] => {
  const children = block.get('sys:children');
  return children instanceof Y.Array ? (children.toArray() as string[]) : [];
};

const blockText = (block: Y.Map<unknown>): string => {
  const text = block.get('prop:text');
  return text instanceof Y.Text ? text.toString() : '';
};

const isH2 = (block: Y.Map<unknown> | undefined) =>
  block?.get('sys:flavour') === 'notesgraph:paragraph' &&
  block.get('prop:type') === 'h2';

const isEmptyTodo = (block: Y.Map<unknown> | undefined) =>
  block?.get('sys:flavour') === 'notesgraph:list' &&
  block.get('prop:type') === 'todo' &&
  !blockText(block).trim();

function newBlock(
  blocks: Y.Map<Y.Map<unknown>>,
  fill: (block: Y.Map<unknown>) => void
): string {
  const id = nanoid(10);
  const block = new Y.Map<unknown>();
  block.set('sys:id', id);
  block.set('sys:children', new Y.Array<string>());
  fill(block);
  blocks.set(id, block);
  return id;
}

const plainText = (value: string) => {
  const text = new Y.Text();
  text.insert(0, value);
  return text;
};

const todo =
  (text: string, checked = false) =>
  (block: Y.Map<unknown>) => {
    block.set('sys:flavour', 'notesgraph:list');
    block.set('sys:version', 1);
    block.set('prop:type', 'todo');
    block.set('prop:text', plainText(text));
    block.set('prop:checked', checked);
    block.set('prop:collapsed', false);
    block.set('prop:order', null);
  };

/** Plain data as blocksuite stores a prop: arrays and objects as Y types. */
function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array<unknown>();
    array.push(value.map(toY));
    return array;
  }
  if (value && typeof value === 'object') {
    const map = new Y.Map<unknown>();
    for (const [key, item] of Object.entries(value)) map.set(key, toY(item));
    return map;
  }
  return value;
}

// The app's addProjectTaskListBlock (blocks/database/src/query-data-source.ts):
// the seeded Status/Deadline/Scheduled columns and a list view that hides
// done tasks, with the Status column and its options under the fixed ids
// that view's filter names.
const STATUS_COLUMN_ID = 'task-status';
const STATUS_OPTIONS = [
  { id: 'task-status-todo', value: 'Todo', color: 'var(--notesgraph-tag-blue)' },
  {
    id: 'task-status-in-progress',
    value: 'In Progress',
    color: 'var(--notesgraph-tag-yellow)',
  },
  { id: 'task-status-done', value: 'Done', color: 'var(--notesgraph-tag-green)' },
];

const taskList = (section: JournalSection) => (block: Y.Map<unknown>) => {
  block.set('sys:flavour', 'notesgraph:database');
  block.set('sys:version', 3);
  block.set('prop:title', plainText('todos:'));
  block.set('prop:cells', new Y.Map());
  block.set(
    'prop:columns',
    toY([
      {
        id: STATUS_COLUMN_ID,
        type: 'select',
        name: 'Status',
        data: { options: STATUS_OPTIONS },
      },
      { id: nanoid(), type: 'date', name: 'Deadline', data: {} },
      { id: nanoid(), type: 'date', name: 'Scheduled', data: {} },
    ])
  );
  block.set(
    'prop:views',
    toY([
      {
        id: nanoid(),
        name: 'Tasks',
        mode: 'list',
        filter: {
          type: 'group',
          op: 'and',
          conditions: [
            {
              type: 'filter',
              left: { type: 'ref', name: STATUS_COLUMN_ID },
              function: 'isNotOneOf',
              args: [{ type: 'literal', value: ['task-status-done'] }],
            },
          ],
        },
        header: {},
      },
    ])
  );
  block.set('prop:queryTags', new Y.Array());
  block.set('prop:queryProps', new Y.Array());
  block.set('prop:queryProjectId', section.projectId ?? '');
  block.set('prop:queryNoProject', !section.projectId);
};

/**
 * Add `text` as a to-do in `section` of the journal in `binary`, making the
 * section first when the page has no heading for it; a new section goes in
 * above Inbox, which stays last. Returns only that change as an update.
 */
export function fileTaskInJournal(
  binary: Uint8Array,
  docId: string,
  section: JournalSection,
  text: string
): FiledTask {
  const line = taskLine(text);
  if (!line.text) throw new Error('The task has no text.');

  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  const before = Y.encodeStateVector(doc);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');

  let note: Y.Map<unknown> | undefined;
  blocks.forEach(block => {
    if (!note && block.get('sys:flavour') === 'notesgraph:note') note = block;
  });
  if (!note) throw new Error(`Doc ${docId} has no page body to file into.`);
  const noteChildren = note.get('sys:children') as Y.Array<string>;

  const headingId = (name: string) =>
    childIds(note as Y.Map<unknown>).find(id => {
      const block = blocks.get(id);
      return isH2(block) && nameKey(blockText(block!)) === nameKey(name);
    });

  let blockId = '';
  let heading = headingId(section.name);
  const createdSection = !heading;
  doc.transact(() => {
    if (!heading) {
      const ids = childIds(note as Y.Map<unknown>);
      const inbox = nameKey(section.name) === nameKey(INBOX) ? undefined : headingId(INBOX);
      const at = inbox ? ids.indexOf(inbox) : ids.length;
      heading = newBlock(blocks, block => {
        block.set('sys:flavour', 'notesgraph:paragraph');
        block.set('sys:version', 1);
        block.set('prop:type', 'h2');
        block.set('prop:text', plainText(section.name));
        block.set('prop:collapsed', false);
      });
      const empty = newBlock(blocks, todo(''));
      (blocks.get(heading)!.get('sys:children') as Y.Array<string>).push([
        empty,
      ]);
      noteChildren.insert(at, [heading, newBlock(blocks, taskList(section))]);
    }

    const parent = blocks.get(heading)!;
    let children = parent.get('sys:children');
    if (!(children instanceof Y.Array)) {
      children = new Y.Array<string>();
      parent.set('sys:children', children);
    }
    const under = children as Y.Array<string>;
    const last = under.length ? under.get(under.length - 1) : undefined;
    blockId = newBlock(blocks, todo(line.text, line.checked));
    under.insert(
      last && isEmptyTodo(blocks.get(last)) ? under.length - 1 : under.length,
      [blockId]
    );
  });

  return {
    update: Y.encodeStateAsUpdate(doc, before),
    blockId,
    createdSection,
  };
}
