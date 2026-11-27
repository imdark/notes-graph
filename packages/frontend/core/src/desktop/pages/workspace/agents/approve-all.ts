import type { AgentRun, RemoteQuestion } from '@notesgraph/core/modules/agents';

/**
 * "Approve all" under Needs you: every permission request the waiting runs
 * have open, approved in one go. Only permission requests: a question needs
 * an answer a person writes. And only the ones open now: a run's later
 * requests still ask, unlike its own "Allow all".
 */
export interface PendingApproval {
  runId: string;
  jobId: string;
  questionId: string;
  /** The tool it asks for ("Bash"), from "Allow Bash?". */
  tool: string;
}

const toolOf = (question: RemoteQuestion) =>
  /^Allow (.+?)\??$/.exec(question.text.trim())?.[1] ?? question.text.trim();

export function pendingApprovals(
  runs: AgentRun[],
  questionsOf: (run: AgentRun) => RemoteQuestion[] | undefined
): PendingApproval[] {
  return runs.flatMap(run =>
    run.remoteJobId
      ? (questionsOf(run) ?? [])
          .filter(question => question.kind === 'permission')
          .map(question => ({
            runId: run.id,
            jobId: run.remoteJobId as string,
            questionId: question.id,
            tool: toolOf(question),
          }))
      : []
  );
}

/** "5 requests from 3 runs: Bash ×3, Edit ×2", for the confirm dialog. */
export function approvalSummary(pending: PendingApproval[]): string {
  const runs = new Set(pending.map(p => p.runId)).size;
  const tools = new Map<string, number>();
  for (const p of pending) tools.set(p.tool, (tools.get(p.tool) ?? 0) + 1);
  const list = [...tools]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tool, n]) => (n > 1 ? `${tool} ×${n}` : tool))
    .join(', ');
  const requests = `${pending.length} request${pending.length === 1 ? '' : 's'}`;
  return `${requests} from ${runs} run${runs === 1 ? '' : 's'}: ${list}`;
}
