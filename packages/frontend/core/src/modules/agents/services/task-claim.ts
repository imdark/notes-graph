import {
  orgStatusLabel,
  parseOrgStatusPrefix,
} from '@blocksuite/notesgraph/shared/utils';
import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import { Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import { type AgentTarget, agentTargetBlockIds } from './target';

/** The org keyword a task carries while a run for it waits or starts. */
export const QUEUED_STATUS = 'QUEUED';

/** The org status a queued task moves to once an agent starts on it. */
const IN_PROGRESS_STATUS = '[-]';

/** How long a finished run waits before handing back a task it left queued. */
const RELEASE_SETTLE_MS = 5_000;

const settled = () =>
  new Promise(resolve => setTimeout(resolve, RELEASE_SETTLE_MS));

/**
 * A task's org status: the chip embed (one attributed character at the start
 * whose `orgStatus` holds the org text), a raw typed annotation like `[-] `,
 * or — for a checkbox item with neither — its native checked state.
 */
export const readTaskStatus = (
  model: BlockModel
): { text: string; length: number; embedded: boolean } | null => {
  const text = model.text;
  if (!text) return null;
  const first = text.toDelta()[0] as
    | { insert?: string; attributes?: { orgStatus?: string } }
    | undefined;
  const embedded = first?.attributes?.orgStatus;
  if (typeof embedded === 'string' && first?.insert) {
    return { text: embedded, length: first.insert.length, embedded: true };
  }
  const prefix = parseOrgStatusPrefix(text.toString());
  if (prefix) {
    return { text: prefix.statusText, length: prefix.length, embedded: false };
  }
  const props = model.props as { type?: string; checked?: boolean };
  if (props.type === 'todo') {
    return { text: props.checked ? '[X]' : '[ ]', length: 0, embedded: false };
  }
  return null;
};

/** How much of a task's text names it in a run list. */
const TITLE_CHARS = 120;

/** A block's text as a reader names it: without its status, on one line. */
export const taskTitle = (model: BlockModel): string => {
  const text = model.text?.toString() ?? '';
  const status = readTaskStatus(model);
  return text
    .slice(status?.length ?? 0)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITLE_CHARS);
};

/**
 * The title of the first block a run is on that has any text, so a run on a
 * task can be listed by the task rather than as "a block". Null for a whole
 * note, which is already named by its note.
 */
export const targetTitle = (
  store: Store,
  target: AgentTarget
): string | null => {
  for (const id of agentTargetBlockIds(target)) {
    const model = store.getBlock(id)?.model;
    const title = model ? taskTitle(model) : '';
    if (title) return title;
  }
  return null;
};

/**
 * Whether a block is a task still waiting for someone to take it: to-do, not
 * queued, in progress or done. Any agent that claims a task moves it off
 * to-do, so this is also "no agent is on it".
 */
export const isOpenTask = (model: BlockModel): boolean => {
  const status = readTaskStatus(model);
  return !!status && orgStatusLabel(status.text) === 'Todo';
};

/**
 * Whether a task still needs work: to do, queued or in progress. Done, and
 * any other keyword (COMMITTED, BLOCKED, …), is out of a run's hands.
 */
export const isUnfinishedTask = (model: BlockModel): boolean => {
  const status = readTaskStatus(model);
  if (!status) return false;
  if (status.text === QUEUED_STATUS) return true;
  const label = orgStatusLabel(status.text);
  return label === 'Todo' || label === 'In Progress';
};

/**
 * The tasks a run is on, in note order: each targeted block that is a task
 * and every task nested under one — a run on a list's parent is on its
 * items — or, for a whole note, every task in it.
 */
export function targetTaskIds(store: Store, target: AgentTarget): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const walk = (model: BlockModel) => {
    if (seen.has(model.id)) return;
    seen.add(model.id);
    if (readTaskStatus(model)) ids.push(model.id);
    for (const child of model.children) walk(child);
  };
  const roots =
    target.kind === 'doc'
      ? store.root
        ? [store.root]
        : []
      : agentTargetBlockIds(target)
          .map(id => store.getBlock(id)?.model)
          .filter((model): model is BlockModel => !!model);
  for (const root of roots) walk(root);
  return ids;
}

/** The tasks a run is on that still need work; see {@link isUnfinishedTask}. */
export function unfinishedTaskIds(store: Store, target: AgentTarget): string[] {
  return targetTaskIds(store, target).filter(id => {
    const model = store.getBlock(id)?.model;
    return !!model && isUnfinishedTask(model);
  });
}

/** Rewrite a task's status as a chip, the way the kanban board does. */
const writeStatus = (
  model: BlockModel,
  status: { length: number; embedded: boolean },
  statusText: string
) => {
  const text = model.text;
  if (!text) return;
  if (status.embedded) {
    text.format(0, status.length, { orgStatus: statusText });
  } else if (status.length > 0) {
    text.replace(0, status.length, ' ', { orgStatus: statusText });
  } else {
    text.insert(' ', 0);
    text.insert(' ', 0, { orgStatus: statusText });
  }
};

/**
 * Give a task a new org status (e.g. `MERGED`), whatever it had. False when
 * the block is not a task.
 */
export function setTaskStatus(model: BlockModel, statusText: string): boolean {
  const status = readTaskStatus(model);
  if (!status) return false;
  writeStatus(model, status, statusText);
  return true;
}

/**
 * Mark each to-do task among `blockIds` as queued. Tasks already in progress,
 * done or in some other state are left alone, as are blocks that aren't tasks.
 * Returns the blocks it marked.
 */
export function markTasksQueued(store: Store, blockIds: string[]): string[] {
  const marked: string[] = [];
  for (const id of blockIds) {
    const model = store.getBlock(id)?.model;
    if (!model) continue;
    const status = readTaskStatus(model);
    if (!status || orgStatusLabel(status.text) !== 'Todo') continue;
    writeStatus(model, status, QUEUED_STATUS);
    marked.push(id);
  }
  return marked;
}

/**
 * Move each task among `blockIds` still marked queued to in progress, once
 * the agent has picked its run up. One the agent already moved on keeps what
 * the agent wrote. Returns the blocks it moved.
 */
export function markTasksStarted(store: Store, blockIds: string[]): string[] {
  const started: string[] = [];
  for (const id of blockIds) {
    const model = store.getBlock(id)?.model;
    if (!model) continue;
    const status = readTaskStatus(model);
    if (status?.text !== QUEUED_STATUS) continue;
    writeStatus(model, status, IN_PROGRESS_STATUS);
    started.push(id);
  }
  return started;
}

/**
 * Put tasks still marked queued back to to-do, and so too those in `started`
 * — moved to in progress by {@link markTasksStarted}, not by the agent — that
 * are still in progress. One the agent moved on — to done, anything — keeps
 * what the agent wrote.
 */
export function releaseQueuedTasks(
  store: Store,
  blockIds: string[],
  started: string[] = []
): void {
  for (const id of blockIds) {
    const model = store.getBlock(id)?.model;
    if (!model) continue;
    const status = readTaskStatus(model);
    const ours =
      status?.text === QUEUED_STATUS ||
      (status?.text === IN_PROGRESS_STATUS && started.includes(id));
    if (!status || !ours) continue;
    writeStatus(model, status, '[ ]');
  }
}

/**
 * Claims the tasks a run is on the moment it is asked for, before any work
 * starts, so another agent working down the same list — here, on a device or
 * through MCP — sees them as taken rather than to-do and doesn't pick them up.
 */
export class AgentTaskClaimService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  async markQueued(target: AgentTarget): Promise<void> {
    await this.withStore(target, store =>
      markTasksQueued(store, targetTaskIds(store, target))
    );
  }

  /**
   * The tasks a run is on that still need work. With `settle`, first gives a
   * device's or MCP agent's status edits time to sync here, as after a run.
   */
  async unfinished(target: AgentTarget, settle = false): Promise<string[]> {
    if (settle) await settled();
    const { doc, release } = this.docsService.open(target.docId);
    try {
      await doc.waitForSyncReady();
      return unfinishedTaskIds(doc.blockSuiteDoc, target);
    } finally {
      release();
    }
  }

  /**
   * The agent has picked the run up: its tasks still marked queued go to in
   * progress. Returns the blocks moved, to hand back with {@link release}.
   */
  async markStarted(target: AgentTarget): Promise<string[]> {
    return (
      (await this.withStore(target, store =>
        markTasksStarted(store, targetTaskIds(store, target))
      )) ?? []
    );
  }

  /**
   * Hand back tasks still marked queued — or still in progress, among those
   * `started` moved there — unless `claimedAgain` says another run has been
   * asked for on them in the meantime.
   */
  async release(
    target: AgentTarget,
    claimedAgain: () => boolean = () => false,
    started: Promise<string[]> = Promise.resolve([])
  ): Promise<void> {
    // A device or MCP agent writes its own status on the server; give that
    // edit time to sync here, so a task it just finished isn't read as still
    // queued and reopened.
    await settled();
    if (claimedAgain()) return;
    await this.handBack(target, started);
  }

  /** {@link release} at once: the caller has already let edits sync. */
  async handBack(
    target: AgentTarget,
    started: Promise<string[]> = Promise.resolve([])
  ): Promise<void> {
    const startedIds = await started.catch(() => []);
    await this.withStore(target, store =>
      releaseQueuedTasks(store, targetTaskIds(store, target), startedIds)
    );
  }

  /** What the tasks a run is on are called; see {@link targetTitle}. */
  async titleOf(target: AgentTarget): Promise<string | null> {
    return (
      (await this.withStore(target, store => targetTitle(store, target))) ??
      null
    );
  }

  private async withStore<T>(
    target: AgentTarget,
    fn: (store: Store) => T
  ): Promise<T | undefined> {
    // A whole note isn't one task; there is nothing to claim.
    if (target.kind === 'doc') return;
    const { doc, release } = this.docsService.open(target.docId);
    try {
      await doc.waitForSyncReady();
      return fn(doc.blockSuiteDoc);
    } finally {
      release();
    }
  }
}
