import type { BlockModel, Store } from '@blocksuite/notesgraph/store';

import type { AgentRun } from '../stores/agent-runs';

/** Whether a run was pointed at this block, alone or as part of a selection. */
export const runTargetsBlock = (run: AgentRun, blockId: string): boolean =>
  run.blockId === blockId || !!run.blockIds?.includes(blockId);

/**
 * An inline `@agent` claim on a line: `@` at a word boundary followed by a
 * name, the same token the server decorates with `orgMention`.
 */
const CLAIM = /(^|\s)@[\w\-:/.]+/;

/** Whether a line carries an `@agent` claim, as an attribute or plain text. */
export const hasAgentClaim = (
  delta: { insert?: unknown; attributes?: { orgMention?: unknown } }[]
): boolean =>
  delta.some(op => typeof op.attributes?.orgMention === 'string') ||
  CLAIM.test(
    delta.map(op => (typeof op.insert === 'string' ? op.insert : '')).join('')
  );

/**
 * The runs that worked on a block, newest first as `runs` comes.
 *
 * A run pointed straight at the block always counts. A run pointed at a block
 * it sits under counts only when the block is claimed — an agent asked to work
 * down a list claims each task it picks up, and those are the ones it worked
 * on; the rest of the list it merely read.
 */
export function runsForBlock(
  runs: AgentRun[],
  blockId: string,
  ancestorIds: string[],
  claimed: boolean
): AgentRun[] {
  return runs.filter(
    run =>
      runTargetsBlock(run, blockId) ||
      (claimed && ancestorIds.some(id => runTargetsBlock(run, id)))
  );
}

/** The runs that worked on a block in the editor: its own and its claimed parents'. */
export function runsForModel(
  runs: AgentRun[],
  store: Store,
  model: BlockModel
): AgentRun[] {
  if (runs.length === 0) return [];
  const ancestorIds: string[] = [];
  let parent: BlockModel | null = store.getParent(model);
  while (parent) {
    ancestorIds.push(parent.id);
    parent = store.getParent(parent);
  }
  // Read through the signal so a claim typed or synced in re-renders the caller.
  const delta = model.text?.deltas$.value ?? [];
  return runsForBlock(runs, model.id, ancestorIds, hasAgentClaim(delta));
}
