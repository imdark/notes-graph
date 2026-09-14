/**
 * What an agent run is pointed at. Every entry point — the format bar, the
 * slash menu, the drag-handle menu, the doc header, the side panel — resolves
 * to one of these, so the executor never learns where it was invoked from.
 *
 * See docs/reference/agents-on-blocks.md.
 */
export type AgentTarget =
  | { kind: 'block'; docId: string; blockId: string }
  | { kind: 'selection'; docId: string; blockIds: string[] }
  | { kind: 'doc'; docId: string };

/** Identity of a target, for "one run per target at a time". */
export function agentTargetKey(target: AgentTarget): string {
  switch (target.kind) {
    case 'block':
      return `${target.docId}:${target.blockId}`;
    case 'selection':
      return `${target.docId}:${target.blockIds.join(',')}`;
    case 'doc':
      return target.docId;
  }
}
