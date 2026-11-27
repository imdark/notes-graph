import { Text } from '@blocksuite/notesgraph/store';
import { LiveData, Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { AgentRun } from '../stores/agent-runs';
import type { Agent } from '../stores/agents';
import type { AgentTemplate } from './agent-templates';
import type { AgentsService } from './agents';
import {
  CLAUDE_CODE_MODEL,
  CLOUD_DEVICE_KEY,
  type ReleaseTask,
} from './remote-runner';
import { awaitRunRecord } from './run-record';
import type { AgentRunSessionService } from './run-session';

/**
 * "Verify" on an agent run (its log) or on a branch or pull request (the
 * Deployments page): a to-do in the workspace's Verifications note saying
 * what to check, and a Claude Code agent on the server's runner working it.
 * The agent checks that the work exists where it should, builds, passes its
 * tests and does what its task asked, and that a run's recorded outcome is
 * true, then writes a verdict under the to-do. It changes nothing.
 */

export const VERIFICATIONS_DOC_TITLE = 'Verifications';
export const VERIFY_AGENT_NAME = 'Verify';

export const VERIFY_INSTRUCTIONS = [
  'You are started on a to-do asking you to verify one piece of agent or',
  'developer work: an agent run, or a branch or pull request. The lines',
  'under the to-do say which, with what is known about it. Find out whether',
  'it was really done and really works. Evidence over claims: a run saying it',
  'finished, a pull request saying it fixes something, or a task ticked done',
  'proves nothing until you have checked.',
  '',
  'For an agent run:',
  '1. Look it up with list_agent_runs (it names the job) and read its result',
  '   and the end of its log. Note what it says it did.',
  '2. Check each claim. Its branch on origin (git ls-remote origin <branch>),',
  "   its pull request (gh pr list --state all --head <branch>), the task's",
  '   status in its note. A run recorded as failed may in fact have finished',
  '   on its device: say so when it did.',
  '3. Then verify its code as for a branch, below.',
  '',
  'For a branch or pull request:',
  '1. Read what it was for: the pull request body and its linked tasks.',
  '2. In your checkout, fetch it and merge it with the base branch on a',
  '   scratch branch, so you test what merging would give. Never push it.',
  '3. Typecheck the packages it changes (the typecheck tool, or',
  '   scripts/typecheck.sh --changed <dir>) and run the tests that cover the',
  '   change (the run_tests tool). A test it adds should fail without the',
  '   change and pass with it, so check that where it is cheap.',
  '4. Compare the change with the task: does it do what was asked, all of',
  '   it, without breaking something nearby? Read the diff.',
  '5. If it is merged and live (deploy_info lists the pull request), check it',
  '   on the running server where you can: an API call, a tool, the data it',
  '   produces. Use only your own throwaway data, and remove it afterwards.',
  '',
  'Write the result under the to-do. The first line is the verdict: Works,',
  'Partly works, Does not work, or Could not verify, and why in a few words.',
  'Then the evidence: what you ran and what came back. Then one to-do per',
  'follow-up. Tick the verification to-do when done.',
  '',
  'Change nothing: do not push, merge, close, comment on pull requests,',
  'deploy, re-run or edit code or notes beyond this to-do. Ask with',
  'mcp__run__ask_user before anything else.',
].join('\n');

export const VERIFY_TEMPLATE: AgentTemplate = {
  id: 'verify',
  label: 'Verify a run, branch or pull request',
  draft: {
    name: VERIFY_AGENT_NAME,
    instructions: VERIFY_INSTRUCTIONS,
    kind: 'worker',
    // Claude Code on the server's runner, where it has gh, git, the repo and
    // the typecheck and test tools.
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

/** What can be verified. */
export type VerifyTarget =
  | {
      kind: 'run';
      run: AgentRun;
      /** Its answer, when it gave one. */
      summary?: string | null;
    }
  | {
      kind: 'pull';
      repo: string;
      number: number;
      url: string;
      title: string;
      branch: string;
      /** Merged into the base branch already (it waits for a release). */
      merged: boolean;
      base: string;
      tasks?: ReleaseTask[];
    }
  | { kind: 'branch'; repo: string; branch: string; base: string };

/** The to-do for a verification: its line and the lines under it. */
export interface VerifyBrief {
  title: string;
  details: string[];
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

export function verifyBrief(target: VerifyTarget): VerifyBrief {
  if (target.kind === 'run') {
    const { run } = target;
    const name = oneLine(run.title || run.agentName);
    const summary = target.summary ?? run.summary;
    return {
      title: `Verify run: ${clip(name, 120)}`,
      details: [
        `Run ${run.id} of the agent "${run.agentName}", recorded as ${run.status}, started ${new Date(run.startedAt).toISOString()}.`,
        run.remoteJobId
          ? `Job ${run.remoteJobId} on ${run.deviceKey ?? 'its device'}.`
          : 'No job id was recorded; find the job with list_agent_runs by its title and start time.',
        ...(run.error
          ? [`Recorded error: ${clip(oneLine(run.error), 400)}`]
          : []),
        ...(summary ? [`Its answer: ${clip(oneLine(summary), 600)}`] : []),
      ],
    };
  }
  if (target.kind === 'pull') {
    return {
      title: `Verify pull request #${target.number}: ${clip(oneLine(target.title), 120)}`,
      details: [
        `${target.url} in ${target.repo}, branch ${target.branch}, ${
          target.merged
            ? `merged into ${target.base}`
            : `open against ${target.base}`
        }.`,
        ...(target.tasks ?? []).map(
          task =>
            `Task: ${clip(oneLine(task.title), 200)}${task.status ? ` (${task.status})` : ''}`
        ),
      ],
    };
  }
  return {
    title: `Verify branch ${target.branch}`,
    details: [
      `Branch ${target.branch} in ${target.repo}, to merge into ${target.base}. It may have no pull request yet.`,
    ],
  };
}

/** Which verification a target is: the same target again is the same one. */
export const verifyKey = (target: VerifyTarget) =>
  target.kind === 'run'
    ? `run:${target.run.id}`
    : target.kind === 'pull'
      ? `pull:${target.repo}#${target.number}`
      : `branch:${target.repo}:${target.branch}`;

/** A started verification: where its to-do is and the run working it. */
export interface StartedVerification {
  docId: string;
  blockId: string;
  /** The run record, for its window; null when it didn't show in time. */
  runId: string | null;
}

/** The Verify agent, found by name or, renamed, by its instructions. */
export function findVerifyAgent(agents: Agent[]): Agent | undefined {
  return (
    agents.find(agent => agent.name === VERIFY_AGENT_NAME) ??
    agents.find(agent => agent.instructions === VERIFY_INSTRUCTIONS)
  );
}

export class VerifyService extends Service {
  constructor(
    private readonly docsService: DocsService,
    private readonly agentsService: AgentsService,
    private readonly sessions: AgentRunSessionService
  ) {
    super();
  }

  /** Verifications started from this tab, by {@link verifyKey}. */
  readonly started$ = new LiveData<Record<string, StartedVerification>>({});

  watch(key: string): LiveData<StartedVerification | null> {
    return this.started$.map(
      (started): StartedVerification | null => started[key] ?? null
    );
  }

  private verificationsDoc(): string {
    const existing = this.docsService.list.docs$.value.find(
      record =>
        !record.trash$.value && record.title$.value === VERIFICATIONS_DOC_TITLE
    );
    return (
      existing?.id ??
      this.docsService.createDoc({ title: VERIFICATIONS_DOC_TITLE }).id
    );
  }

  private agent(): Agent {
    return (
      findVerifyAgent(this.agentsService.agents$.value) ??
      this.agentsService.create('personal', VERIFY_TEMPLATE.draft)
    );
  }

  /**
   * Write the verification to-do and start the agent on it. Resolves once
   * the run has its record, so its window can open, not when it ends.
   */
  async verify(target: VerifyTarget): Promise<StartedVerification> {
    const brief = verifyBrief(target);
    const docId = this.verificationsDoc();
    const { doc, release } = this.docsService.open(docId);
    let blockId: string;
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const [note] = store.getBlocksByFlavour('notesgraph:note');
      if (!note) throw new Error("Couldn't write to the Verifications note.");
      blockId = store.addBlock(
        'notesgraph:list' as never,
        { type: 'todo', checked: false, text: new Text(brief.title) },
        note.id
      );
      for (const line of brief.details) {
        store.addBlock(
          'notesgraph:paragraph' as never,
          { text: new Text(line) },
          blockId
        );
      }
    } finally {
      release();
    }

    const agent = this.agent();
    const running = this.sessions.start(agent, {
      kind: 'block',
      docId,
      blockId,
    });
    const runId = await awaitRunRecord(
      this.sessions,
      agent.id,
      blockId,
      running
    );
    const started = { docId, blockId, runId };
    this.started$.setValue({
      ...this.started$.value,
      [verifyKey(target)]: started,
    });
    return started;
  }
}
