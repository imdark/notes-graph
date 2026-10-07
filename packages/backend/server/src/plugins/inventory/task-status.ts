import * as Y from 'yjs';

/**
 * The org status of task blocks, read and rewritten straight on a doc's
 * CRDT, the way the app's task claim does it in the editor
 * (modules/agents/services/task-claim.ts): the status is a chip, one
 * character at the start of the text whose `orgStatus` attribute holds the
 * org text, or a typed annotation like `[-] `, or — for a checkbox item with
 * neither — its checked state. Pure yjs, like blocksuite-headless.ts, so it
 * runs in the server image.
 */

/** The org keyword a task carries while a run for it waits to start. */
export const QUEUED_STATUS = 'QUEUED';
/** What a queued task moves to once a runner picks its job up. */
export const IN_PROGRESS_STATUS = '[-]';
const TODO_STATUS = '[ ]';

// blocksuite/notesgraph/shared/src/utils/org-status.ts
const ORG_STATUS_PREFIX_RE = /^(\[(?: |x|X|-)\]|[A-Z][A-Z_-]{1,24})(?=\s)/;
const TODO_TEXTS = new Set(['[ ]', 'TODO']);

interface TaskStatus {
  text: string;
  length: number;
  embedded: boolean;
}

function readStatus(block: Y.Map<unknown>): TaskStatus | null {
  const text = block.get('prop:text');
  if (!(text instanceof Y.Text)) return null;
  const first = text.toDelta()[0] as
    | { insert?: unknown; attributes?: { orgStatus?: unknown } }
    | undefined;
  const embedded = first?.attributes?.orgStatus;
  if (typeof embedded === 'string' && typeof first?.insert === 'string') {
    return { text: embedded, length: first.insert.length, embedded: true };
  }
  const match = ORG_STATUS_PREFIX_RE.exec(text.toString());
  if (match) {
    return { text: match[1], length: match[1].length, embedded: false };
  }
  if (block.get('prop:type') === 'todo') {
    return {
      text: block.get('prop:checked') ? '[X]' : TODO_STATUS,
      length: 0,
      embedded: false,
    };
  }
  return null;
}

function writeStatus(block: Y.Map<unknown>, status: TaskStatus, next: string) {
  const text = block.get('prop:text') as Y.Text;
  if (status.embedded) {
    text.format(0, status.length, { orgStatus: next });
  } else if (status.length > 0) {
    text.delete(0, status.length);
    text.insert(0, ' ', { orgStatus: next });
  } else {
    text.insert(0, ' ');
    text.insert(0, ' ', { orgStatus: next });
  }
}

export interface StatusEdit {
  /** The update to push, or null when nothing changed. */
  update: Uint8Array | null;
  /** The blocks whose status was rewritten. */
  changed: string[];
}

/**
 * Rewrite the status of each of `blockIds` that `next` gives a new status
 * for, as one update against `binary`.
 */
function editStatuses(
  binary: Uint8Array,
  blockIds: string[],
  next: (id: string, status: string) => string | null
): StatusEdit {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, binary);
  const before = Y.encodeStateVector(doc);
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const changed: string[] = [];
  doc.transact(() => {
    for (const id of new Set(blockIds)) {
      const block = blocks.get(id);
      if (!(block instanceof Y.Map)) continue;
      const status = readStatus(block);
      if (!status) continue;
      const to = next(id, status.text);
      if (to === null || to === status.text) continue;
      writeStatus(block, status, to);
      changed.push(id);
    }
  });
  return {
    update: changed.length ? Y.encodeStateAsUpdate(doc, before) : null,
    changed,
  };
}

/** To-do tasks become queued; anything else is left as it is. */
export const queueTasks = (binary: Uint8Array, blockIds: string[]) =>
  editStatuses(binary, blockIds, (_, status) =>
    TODO_TEXTS.has(status) ? QUEUED_STATUS : null
  );

/** Tasks still queued go to in progress: a runner has picked the job up. */
export const startTasks = (binary: Uint8Array, blockIds: string[]) =>
  editStatuses(binary, blockIds, (_, status) =>
    status === QUEUED_STATUS ? IN_PROGRESS_STATUS : null
  );

/**
 * Hand tasks back to to-do: those still queued, and those in `started` —
 * moved to in progress by {@link startTasks}, not by the agent — still in
 * progress. One the agent moved on keeps what the agent wrote.
 */
export const releaseTasks = (
  binary: Uint8Array,
  blockIds: string[],
  started: string[]
) =>
  editStatuses(binary, blockIds, (id, status) =>
    status === QUEUED_STATUS ||
    (status === IN_PROGRESS_STATUS && started.includes(id))
      ? TODO_STATUS
      : null
  );
