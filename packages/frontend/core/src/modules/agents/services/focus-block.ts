import { parseLogLines } from './log-lines';

/** A block an agent run is working on, for jumping to it in the editor. */
export interface AgentBlockRef {
  docId: string;
  blockId: string;
}

/**
 * A tool call in a transcript: `→ <tool>  <args as JSON>`. Both on-device
 * runs (executor.ts) and device runs (`wf agent serve`) write calls this way;
 * a device's subagent calls are indented under a `↳`. The args may be clipped
 * mid-JSON, so fields are picked out rather than parsed.
 */
const CALL = /^\s*(?:↳ )?→ \S+\s+(.*)$/;

const field = (args: string, key: string): string | null =>
  new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]+)"`).exec(args)?.[1] ?? null;

/**
 * The block the latest tool call in `log` named, i.e. the one the agent is
 * on now when it works down a list. A call that names a block but not its
 * note is taken to be in `fallbackDocId` (the run's own note).
 */
export function lastBlockTouched(
  log: string,
  fallbackDocId?: string
): AgentBlockRef | null {
  const lines = parseLogLines(log);
  for (let i = lines.length - 1; i >= 0; i--) {
    const args = CALL.exec(lines[i].text)?.[1];
    if (!args) continue;
    const blockId = field(args, 'blockId');
    if (!blockId) continue;
    const docId = field(args, 'docId') ?? fallbackDocId;
    if (docId) return { docId, blockId };
  }
  return null;
}
