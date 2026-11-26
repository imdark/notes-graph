import { Text } from '@blocksuite/notesgraph/store';
import { Service } from '@notesgraph/infra';
import { filter, firstValueFrom, map, race, timer } from 'rxjs';

import type { DocsService } from '../../doc';
import type { Agent } from '../stores/agents';
import type { AgentTemplate } from './agent-templates';
import type { AgentsService } from './agents';
import { CLAUDE_CODE_MODEL, CLOUD_DEVICE_KEY } from './remote-runner';
import type { AgentRunSessionService } from './run-session';

/**
 * "Review recent runs" on the Agents page: a retro over the last few days of
 * agent runs. A to-do goes into the workspace's Run reviews note and a Claude
 * Code agent on the server's runner works it: did each run's work ship and
 * go live, which runs failed or stopped early and why, what work was left
 * unpushed, and which runs repeat each other. It writes what it found under
 * the to-do, each follow-up a to-do of its own, and asks before acting.
 */

export const RUN_REVIEWS_DOC_TITLE = 'Run reviews';
export const RUN_REVIEW_AGENT_NAME = 'Run review';
/** How far back a review looks. */
export const RUN_REVIEW_DAYS = 3;

export const RUN_REVIEW_INSTRUCTIONS = [
  'You are started on a to-do asking for a review of recent agent runs. The',
  'question is whether the work the runs were started for actually shipped',
  'and works, and what went wrong where it did not.',
  '',
  'How to work:',
  '1. List the runs with the list_agent_runs tool (the days the to-do names).',
  '   Group them by task: a task key (CLOUD-125, PERSONAL-308) or the same',
  '   title. Several runs on one task are retries or duplicates.',
  '2. For each task, find its pull request with gh (gh pr list --state all',
  '   --search <key or branch>). Note whether it is open, merged into the',
  '   base branch, or closed, and whether two pull requests do the same work.',
  '3. Check what is live with the deploy_info tool: pass the merged pull',
  '   request numbers. Merged but not live means it waits for a release.',
  '4. Find work that never reached GitHub. A run with git commits but no',
  '   pull request may have ended before it pushed. Check with git ls-remote',
  '   origin <branch>. On the server runner, also look in its shared clones',
  '   (git rev-parse --git-common-dir from your checkout, and the checkout',
  '   folder beside it): list branches with commits that no origin branch',
  '   has (git rev-list --count <branch> --not --remotes=origin).',
  '5. For failed, blocked, cancelled and stopped-early runs, say why from',
  '   the error, the result and the end of the log. Count the causes:',
  '   permission requests that failed, setup steps, usage limits, timeouts.',
  '   A cause that hit several runs is a harness bug worth its own fix.',
  '6. Look for features that merged but need one more step to work: an',
  '   automation template nobody created, a flag left off, a migration or',
  '   secret, an APK build.',
  '',
  'Write the review under the to-do: a few lines of summary, then one to-do',
  'per follow-up, each naming the run, task or pull request and what to do.',
  'Mark what you checked as working, and what you could not check and why.',
  'Then tick the review to-do.',
  '',
  'This is a review. Do not merge, close, deploy, re-run or delete anything,',
  'and do not edit code. The one exception: a branch with unpushed commits',
  'may be pushed to origin under its own name, so the work is not lost; say',
  'so in the review. Ask with mcp__run__ask_user before anything else.',
].join('\n');

export const RUN_REVIEW_TEMPLATE: AgentTemplate = {
  id: 'run-review',
  label: 'Review recent agent runs',
  draft: {
    name: RUN_REVIEW_AGENT_NAME,
    instructions: RUN_REVIEW_INSTRUCTIONS,
    kind: 'worker',
    // Claude Code on the server's runner: it has gh, git and the runner's
    // own clones, where unpushed work is found.
    harness: 'remote',
    model: CLAUDE_CODE_MODEL,
    deviceKey: CLOUD_DEVICE_KEY,
    tools: [],
    targets: ['block'],
    output: 'panel',
    maxSteps: 80,
    enabled: true,
  },
};

/** The review to-do's line, naming its window and day. */
export const runReviewTitle = (days: number, now: Date = new Date()) =>
  `Review agent runs from the last ${days} days (${now
    .toISOString()
    .slice(0, 10)})`;

/** A started review: where its to-do is and the run working it. */
export interface StartedReview {
  docId: string;
  blockId: string;
  /** The run record, for its window; null when it didn't show in time. */
  runId: string | null;
}

/** How long to wait for a started run to get its record. */
const RUN_RECORD_WAIT_MS = 15_000;

/** The Run review agent, found by name or, renamed, by its instructions. */
export function findRunReviewAgent(agents: Agent[]): Agent | undefined {
  return (
    agents.find(agent => agent.name === RUN_REVIEW_AGENT_NAME) ??
    agents.find(agent => agent.instructions === RUN_REVIEW_INSTRUCTIONS)
  );
}

export class RunReviewService extends Service {
  constructor(
    private readonly docsService: DocsService,
    private readonly agentsService: AgentsService,
    private readonly sessions: AgentRunSessionService
  ) {
    super();
  }

  private reviewsDoc(): string {
    const existing = this.docsService.list.docs$.value.find(
      record =>
        !record.trash$.value && record.title$.value === RUN_REVIEWS_DOC_TITLE
    );
    return (
      existing?.id ??
      this.docsService.createDoc({ title: RUN_REVIEWS_DOC_TITLE }).id
    );
  }

  private agent(): Agent {
    return (
      findRunReviewAgent(this.agentsService.agents$.value) ??
      this.agentsService.create('personal', RUN_REVIEW_TEMPLATE.draft)
    );
  }

  /**
   * Write the review to-do and start the agent on it. Resolves once the run
   * has its record, so its window can open, not when it ends.
   */
  async review(days: number = RUN_REVIEW_DAYS): Promise<StartedReview> {
    const docId = this.reviewsDoc();
    const { doc, release } = this.docsService.open(docId);
    let blockId: string;
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const [note] = store.getBlocksByFlavour('notesgraph:note');
      if (!note) throw new Error("Couldn't write to the Run reviews note.");
      blockId = store.addBlock(
        'notesgraph:list' as never,
        { type: 'todo', checked: false, text: new Text(runReviewTitle(days)) },
        note.id
      );
    } finally {
      release();
    }

    const agent = this.agent();
    const running = this.sessions.start(agent, {
      kind: 'block',
      docId,
      blockId,
    });
    const runId = await this.runRecord(agent.id, blockId, running);
    return { docId, blockId, runId };
  }

  /**
   * The record of the session started for this agent on this block. A start
   * that fails before it has one rejects; one that ends first, or is slow,
   * gives null.
   */
  private async runRecord(
    agentId: string,
    blockId: string,
    running: Promise<void>
  ): Promise<string | null> {
    const recorded$ = this.sessions.sessions$.pipe(
      map(
        sessions =>
          sessions.find(
            session =>
              session.agentId === agentId &&
              session.target.kind === 'block' &&
              session.target.blockId === blockId &&
              session.runId
          )?.runId ?? null
      ),
      filter((runId): runId is string => !!runId)
    );
    return firstValueFrom(
      race(
        recorded$,
        timer(RUN_RECORD_WAIT_MS).pipe(map(() => null)),
        running.then(() => null)
      )
    );
  }
}
