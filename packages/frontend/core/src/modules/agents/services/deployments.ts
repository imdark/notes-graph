import type { BlockModel } from '@blocksuite/notesgraph/store';
import { LiveData, Service } from '@notesgraph/infra';
import type { Query, SearchOptions } from '@notesgraph/nbstore';
import {
  catchError,
  combineLatest,
  filter,
  map,
  of,
  startWith,
  timeout,
} from 'rxjs';

import type { DocsService } from '../../doc';
import type { DocsSearchService } from '../../docs-search';
import type { WorkspaceService } from '../../workspace';
import type { Agent } from '../stores/agents';
import type { AgentContext } from './context';
import {
  COMMAND_MODEL,
  isDeviceClaudeModel,
  type RemoteAgentRunnerService,
  type RemoteJob,
  RESEARCH_MODEL,
} from './remote-runner';
import type { AgentRunSessionService } from './run-session';
import type { AgentTarget } from './target';
import { readTaskStatus, setTaskStatus, taskTitle } from './task-claim';

/**
 * How long to wait for a wf command job (listing or merging pull requests):
 * the device's own limit on one is a minute, and it may first wait for a
 * free slot behind longer runs.
 */
const COMMAND_WAIT_MS = 3 * 60_000;

/**
 * Where a task that ships code is on its way out, by the org keyword it
 * carries (indexed kebab-cased): on a branch with a PR, landed on main, or
 * live and waiting to be checked. See update_task in the MCP tools.
 */
export type ShipStage = 'committed' | 'merged' | 'deployed';

export const SHIP_STAGES: ShipStage[] = ['committed', 'merged', 'deployed'];

export const isShipStage = (status: string | undefined): status is ShipStage =>
  !!status && (SHIP_STAGES as string[]).includes(status);

/** A task on its way to production, as the index knows it. */
export interface ShipTask {
  docId: string;
  blockId: string;
  stage: ShipStage;
  /** The task's text as indexed; {@link ShipTaskDetails.title} once read. */
  text: string;
}

/** What reading a task's note adds: what it is called and where its PR is. */
export interface ShipTaskDetails {
  title: string;
  docTitle: string;
  /** The first GitHub pull request named in the task or the notes under it. */
  pullRequest: string | null;
}

/** What a ship run is asked to do with the tasks it is given. */
export type ShipAction = 'merge' | 'deploy';

const PULL_REQUEST_RE = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/;

export const findPullRequest = (text: string): string | null =>
  PULL_REQUEST_RE.exec(text)?.[0] ?? null;

/** `owner/repo` of a GitHub pull request URL. */
export const repoOf = (url: string): string | null =>
  /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/\d+/.exec(url)?.[1] ?? null;

/** What GitHub's checks on a pull request add up to. */
export type ChecksState = 'pass' | 'fail' | 'pending' | 'none';

/** A pull request as GitHub has it, read through `gh` on the device. */
export interface PullRequest {
  repo: string;
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  state: 'open' | 'merged';
  draft: boolean;
  /** Whether it merges cleanly; UNKNOWN while GitHub works it out. */
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  checks: ChecksState;
  /** Epoch ms. */
  mergedAt: number | null;
}

/**
 * Where an open pull request stands on its way to main. Only conflicts stop
 * a plain `gh pr merge` (one that turns out not to merge fails safely); a
 * draft isn't meant to go yet. Failing checks are shown, not enforced: this
 * repo's CI fails on things a change didn't touch, and its pull requests are
 * merged regardless, so fixing them with Claude Code is offered, not forced.
 */
export type MergeReadiness =
  | 'ready'
  | 'unknown'
  | 'conflicts'
  | 'failing'
  | 'pending'
  | 'draft';

export const mergeReadiness = (pr: PullRequest): MergeReadiness =>
  pr.draft
    ? 'draft'
    : pr.mergeable === 'CONFLICTING'
      ? 'conflicts'
      : pr.checks === 'fail'
        ? 'failing'
        : pr.checks === 'pending'
          ? 'pending'
          : pr.mergeable === 'MERGEABLE'
            ? 'ready'
            : 'unknown';

/** Whether {@link mergeReadiness} lets wf merge it without help. */
export const mergesDirectly = (readiness: MergeReadiness) =>
  readiness !== 'conflicts' && readiness !== 'draft';

/** Whether it can't merge until Claude Code (or someone) fixes it. */
export const needsHelpToMerge = (readiness: MergeReadiness) =>
  readiness === 'conflicts';

/** Whether to offer Claude Code to fix it: conflicts, or failing checks. */
export const canFixToMerge = (readiness: MergeReadiness) =>
  readiness === 'conflicts' || readiness === 'failing';

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

const OPEN_FIELDS =
  'number,title,url,headRefName,author,state,isDraft,mergeable,statusCheckRollup';
const MERGED_FIELDS = 'number,title,url,headRefName,author,state,mergedAt';
/** How many recently merged pull requests to list per repo. */
const MERGED_LIMIT = 15;

/**
 * The shell command a device runs to list pull requests: each repo's open
 * ones and its latest merged, one JSON object a line (`--jq '.[]'`). With no
 * repo known, `cwd` — the device's folder — tells `gh` which repo it is.
 */
export function pullRequestsCommand(repos: string[], cwd?: string): string {
  const lists = (repo?: string) => {
    const flag = repo ? ` -R ${shellQuote(repo)}` : '';
    return [
      // A pull request can carry dozens of checks; their distinct outcomes
      // are all that's read.
      `gh pr list${flag} --state open --limit 50 --json ${OPEN_FIELDS} --jq '.[] | .statusCheckRollup |= (map({status, conclusion, state}) | unique) | .author |= {login}'`,
      `gh pr list${flag} --state merged --limit ${MERGED_LIMIT} --json ${MERGED_FIELDS} --jq '.[] | .author |= {login}'`,
    ];
  };
  const commands = repos.length > 0 ? repos.flatMap(lists) : lists();
  const run = commands.join(' && ');
  return repos.length === 0 && cwd ? `cd ${shellQuote(cwd)} && ${run}` : run;
}

/** The command that merges one pull request, with a merge commit as this repo does. */
export const mergeCommand = (pr: Pick<PullRequest, 'repo' | 'number'>) =>
  `gh pr merge ${pr.number} -R ${shellQuote(pr.repo)} --merge`;

type CheckRollup = {
  status?: string;
  conclusion?: string;
  state?: string;
}[];

const FAILED = new Set([
  'FAILURE',
  'ERROR',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
]);

/** A check run has a status and conclusion; a commit status only a state. */
export function checksState(rollup: CheckRollup | undefined): ChecksState {
  if (!rollup?.length) return 'none';
  let pending = false;
  for (const check of rollup) {
    const outcome = check.conclusion || check.state || '';
    if (FAILED.has(outcome)) return 'fail';
    if (
      (check.status && check.status !== 'COMPLETED') ||
      outcome === 'PENDING' ||
      outcome === 'EXPECTED'
    ) {
      pending = true;
    }
  }
  return pending ? 'pending' : 'pass';
}

/** {@link pullRequestsCommand}'s output, one pull request per JSON line. */
export function parsePullRequests(output: string): PullRequest[] {
  const byUrl = new Map<string, PullRequest>();
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const url = typeof raw.url === 'string' ? raw.url : '';
    const repo = repoOf(url);
    if (!repo || typeof raw.number !== 'number') continue;
    const merged = raw.state === 'MERGED';
    const mergedAt =
      typeof raw.mergedAt === 'string' ? Date.parse(raw.mergedAt) : NaN;
    byUrl.set(url, {
      repo,
      number: raw.number,
      title: String(raw.title ?? ''),
      url,
      branch: String(raw.headRefName ?? ''),
      author: String((raw.author as { login?: string } | null)?.login ?? ''),
      state: merged ? 'merged' : 'open',
      draft: raw.isDraft === true,
      mergeable:
        raw.mergeable === 'MERGEABLE' || raw.mergeable === 'CONFLICTING'
          ? raw.mergeable
          : 'UNKNOWN',
      checks: merged
        ? 'none'
        : checksState(raw.statusCheckRollup as CheckRollup | undefined),
      mergedAt: Number.isFinite(mergedAt) ? mergedAt : null,
    });
  }
  return [...byUrl.values()];
}

/** What the screen knows about pull requests, as wf on the device last said. */
export interface PullRequestsState {
  pulls: PullRequest[];
  loading: boolean;
  error: string | null;
  /** Epoch ms of the last answer. */
  at: number | null;
}

/** The text of a block and everything nested under it, one block a line. */
const subtreeText = (model: BlockModel): string =>
  [model.text?.toString() ?? '', ...model.children.map(subtreeText)].join('\n');

/**
 * The agents a ship run can go to: Claude Code on a device, which has the
 * repo, git and the deploy scripts. Research runs read rather than edit, and
 * an in-tab or cloud agent can reach none of that. Plain Claude Code comes
 * before Workflow, which would open a ticket and worktree for the run.
 */
export const shipAgents = (agents: Agent[]): Agent[] =>
  agents
    .filter(
      agent =>
        agent.enabled &&
        agent.harness === 'remote' &&
        !!agent.deviceKey &&
        isDeviceClaudeModel(agent.model) &&
        agent.model !== RESEARCH_MODEL
    )
    .sort(
      (a, b) =>
        Number(b.model === 'claude-code') - Number(a.model === 'claude-code')
    );

/**
 * The tasks a ship run acts on: for a merge, those with a PR still open; for
 * a deploy, those merged and those still to merge, which it merges first.
 * Deployed tasks are already out.
 */
export const shipTargets = <T extends { stage: ShipStage }>(
  tasks: T[],
  action: ShipAction
): T[] =>
  tasks.filter(task =>
    action === 'merge'
      ? task.stage === 'committed'
      : task.stage === 'committed' || task.stage === 'merged'
  );

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

const READINESS_TEXT: Record<MergeReadiness, string> = {
  ready: 'merges cleanly, checks pass',
  unknown: 'GitHub has not said whether it merges cleanly',
  conflicts: 'conflicts with main',
  failing: 'checks failing',
  pending: 'checks still running',
  draft: 'draft',
};

/** What GitHub says of a pull request, for a brief. */
const githubLine = (pr: PullRequest | undefined) =>
  pr
    ? `   - on GitHub: ${pr.state === 'merged' ? 'already merged' : READINESS_TEXT[mergeReadiness(pr)]} (branch ${pr.branch})`
    : null;

/** What to do about a pull request that conflicts or fails its checks. */
const FIX_STEP =
  'For one that conflicts with main: check out its branch, merge main into it, resolve the conflicts keeping both sides’ intent, typecheck and run the tests it touches, push, then merge. For failing checks, fix those the change caused; checks that fail on main too don’t hold a merge up.';

/**
 * What the agent of a ship run reads: the tasks, and what to do with them.
 * `github` adds what GitHub says of their pull requests, and `untracked`
 * open pull requests no task names, for a merge to take on too.
 */
export function shipBrief(
  tasks: (ShipTask & ShipTaskDetails)[],
  action: ShipAction,
  github: { pulls?: PullRequest[]; untracked?: PullRequest[] } = {}
): AgentContext {
  const pullsByUrl = new Map((github.pulls ?? []).map(pr => [pr.url, pr]));
  const untracked = github.untracked ?? [];
  const toMerge = tasks.filter(task => task.stage === 'committed');
  const mergeCount = toMerge.length + untracked.length;
  const title =
    action === 'merge'
      ? `Merge ${plural(mergeCount, 'pull request')}`
      : toMerge.length > 0
        ? `Merge and deploy ${plural(tasks.length, 'feature')}`
        : `Deploy ${plural(tasks.length, 'feature')}`;
  const lines = tasks.map((task, i) =>
    [
      `${i + 1}. ${task.title || task.text}`,
      `   - status: ${task.stage.toUpperCase()}`,
      `   - pull request: ${task.pullRequest ?? 'none named; find it from the task’s notes or the branch'}`,
      githubLine(
        task.pullRequest ? pullsByUrl.get(task.pullRequest) : undefined
      ),
      `   - task: block ${task.blockId} in note "${task.docTitle}" (doc ${task.docId})`,
    ]
      .filter(line => line !== null)
      .join('\n')
  );
  const untrackedLines = untracked.map((pr, i) =>
    [
      `${i + 1}. ${pr.title}`,
      `   - pull request: ${pr.url}`,
      githubLine(pr),
    ].join('\n')
  );
  const steps =
    action === 'merge'
      ? [
          'Merge each pull request above into main (`gh pr merge --merge`), oldest first. Fetch main again between merges.',
          FIX_STEP,
          'If you cannot make one merge safely, leave it, say why in a note on its task, and go on with the rest.',
          "Move each task you merged to `merged` with update_task, with a note naming the merge commit. Don't deploy.",
        ]
      : [
          ...(toMerge.length > 0
            ? [
                'First merge the pull request of each COMMITTED task into main (`gh pr merge --merge`), oldest first.',
                FIX_STEP,
                'If you cannot make one merge safely, leave it out of this deploy and say why in a note on its task.',
                'Move each task you merged to `merged` with update_task, with a note naming the merge commit.',
              ]
            : []),
          'Update to the latest main, then deploy it to production the way this repo does (the deploy-prod skill). Never stop a deploy midway.',
          "Once the deploy has finished, move each task that went out to `deployed` with a note naming the deployed commit. Don't mark any done: that waits for someone to check it live.",
          'If the deploy fails, leave the tasks as they are and put what failed in a note on each.',
        ];
  return {
    title,
    label:
      action === 'merge'
        ? plural(mergeCount, 'pull request')
        : plural(tasks.length, 'feature'),
    text: [
      `# ${title}`,
      '',
      `Asked for from the Deployments screen in NotesGraph. ${
        action === 'merge'
          ? 'Merge these pull requests; the screen merged the ones that merged cleanly already.'
          : 'Ship these features to production.'
      }`,
      '',
      ...(lines.length > 0 ? ['## Features', '', ...lines, ''] : []),
      ...(untrackedLines.length > 0
        ? ['## Pull requests no task names', '', ...untrackedLines, '']
        : []),
      '## What to do',
      '',
      ...steps.map(step => `- ${step}`),
      '- Ask before anything else that cannot be undone. Finish with what shipped and what did not.',
    ].join('\n'),
  };
}

/** The status, task and note fields read off each indexed block. */
const SEARCH_OPTIONS = {
  fields: ['docId', 'blockId', 'content', 'orgStatus'],
  pagination: { limit: 500 },
} satisfies SearchOptions<'block'>;

const SHIP_QUERY = {
  type: 'boolean',
  occur: 'should',
  queries: SHIP_STAGES.map(
    stage => ({ type: 'match', field: 'orgStatus', match: stage }) as const
  ),
} satisfies Query<'block'>;

const firstString = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Features ready to go out, and the run that takes them there.
 *
 * Ready means a task carrying COMMITTED (its PR is open) or MERGED (on main,
 * not yet live), the keywords agents move a task through as its code ships;
 * DEPLOYED ones are listed too, as live but not yet checked. Shipping hands
 * the chosen tasks to a Claude Code agent on a device — the machine with the
 * repo and the deploy scripts — so it can be asked for from a phone.
 */
export class DeploymentsService extends Service {
  constructor(
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly runSessions: AgentRunSessionService,
    private readonly remote: RemoteAgentRunnerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  /**
   * Pull requests as GitHub has them, read by wf on the ship agent's device
   * (`gh` there is signed in; nothing here is). Empty until the screen asks.
   */
  readonly pullRequests$ = new LiveData<PullRequestsState>({
    pulls: [],
    loading: false,
    error: null,
    at: null,
  });

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  /**
   * Run `command` on the agent's device as a wf command job and return its
   * output. A job not finished in time is cancelled, so a device that is off
   * doesn't run a stale merge whenever it comes back.
   */
  private async runCommand(
    agent: Agent,
    command: string,
    title: string
  ): Promise<string> {
    if (!agent.deviceKey) throw new Error(`${agent.name} has no device`);
    const workspaceId = this.workspaceId;
    const job = await this.remote.enqueue(workspaceId, {
      deviceKey: agent.deviceKey,
      agentId: agent.id,
      agentName: agent.name,
      instructions: command,
      context: '',
      model: COMMAND_MODEL,
      title,
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), COMMAND_WAIT_MS);
    let last: RemoteJob = job;
    try {
      for await (const { job: update } of this.remote.watch(
        workspaceId,
        job.id,
        controller.signal
      )) {
        last = update;
      }
    } finally {
      clearTimeout(timer);
    }
    if (last.status === 'done') return last.result ?? '';
    if (controller.signal.aborted) {
      throw new Error(
        `${agent.deviceKey} didn't pick it up in time. Is wf agent serve running there?`
      );
    }
    throw new Error(
      last.error || `It ended ${last.status} on ${agent.deviceKey}`
    );
  }

  /**
   * Ask wf on the agent's device for the open and recently merged pull
   * requests of `repos` (those the tasks name), or, with none, of the repo
   * the device works in.
   */
  async refreshPullRequests(agent: Agent, repos: string[]): Promise<void> {
    const prev = this.pullRequests$.value;
    this.pullRequests$.setValue({ ...prev, loading: true });
    try {
      let cwd: string | undefined;
      if (repos.length === 0) {
        const devices = await this.remote.agentTargets(this.workspaceId);
        cwd =
          devices.find(device => device.key === agent.deviceKey)?.path ??
          undefined;
        if (!cwd) {
          throw new Error(
            'No task names a pull request yet, and the device has no folder to read its repo from.'
          );
        }
      }
      const output = await this.runCommand(
        agent,
        pullRequestsCommand(repos, cwd),
        'List pull requests'
      );
      this.pullRequests$.setValue({
        pulls: parsePullRequests(output),
        loading: false,
        error: null,
        at: Date.now(),
      });
    } catch (err) {
      this.pullRequests$.setValue({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Merge a pull request through wf on the agent's device, with no AI: for
   * those GitHub says merge cleanly. Throws with what `gh` said when it
   * doesn't, which is the cue to hand it to Claude Code. The task it ships,
   * if any, goes to MERGED.
   */
  async merge(
    agent: Agent,
    pr: Pick<PullRequest, 'repo' | 'number' | 'url'>,
    task?: Pick<ShipTask, 'docId' | 'blockId'>
  ): Promise<void> {
    await this.runCommand(
      agent,
      mergeCommand(pr),
      `Merge ${pr.repo}#${pr.number}`
    );
    this.pullRequests$.setValue({
      ...this.pullRequests$.value,
      pulls: this.pullRequests$.value.pulls.map(p =>
        p.url === pr.url
          ? { ...p, state: 'merged', checks: 'none', mergedAt: Date.now() }
          : p
      ),
    });
    if (task) await this.markMerged(task).catch(() => {});
  }

  /** Move a task to MERGED, as an agent that merged it would. */
  private async markMerged(task: Pick<ShipTask, 'docId' | 'blockId'>) {
    const { doc, release } = this.docsService.open(task.docId);
    try {
      await doc.waitForSyncReady();
      const model = doc.blockSuiteDoc.getBlock(task.blockId)?.model;
      if (model && readStage(model) === 'committed') {
        setTaskStatus(model, 'MERGED');
      }
    } finally {
      release();
    }
  }

  /**
   * Every task in a ship stage, from the union of this device's index and the
   * server's: the local one only knows notes opened here, the server's only
   * what it has indexed (see block-task-index-service.ts). Null until either
   * has answered.
   */
  readonly tasks$ = LiveData.from<ShipTask[] | null>(
    combineLatest(
      [undefined, 'remote' as const].map(prefer =>
        this.docsSearchService.indexer
          .search$(
            'block',
            SHIP_QUERY,
            prefer ? { ...SEARCH_OPTIONS, prefer } : SEARCH_OPTIONS
          )
          .pipe(
            map(result =>
              result.nodes.flatMap(node => {
                const stage = firstString(node.fields.orgStatus);
                const docId = firstString(node.fields.docId);
                const blockId = firstString(node.fields.blockId);
                // The index may match tokens loosely; keep exact stages only.
                if (!isShipStage(stage) || !docId || !blockId) return [];
                return [
                  {
                    docId,
                    blockId,
                    stage,
                    text: firstString(node.fields.content),
                  },
                ];
              })
            ),
            timeout({ first: 15_000, with: () => of<ShipTask[]>([]) }),
            catchError(() => of<ShipTask[]>([])),
            startWith<ShipTask[] | null>(null)
          )
      )
    ).pipe(
      filter(results => results.some(tasks => tasks !== null)),
      map(results => {
        const byKey = new Map<string, ShipTask>();
        for (const task of results.flatMap(tasks => tasks ?? [])) {
          byKey.set(`${task.docId}:${task.blockId}`, task);
        }
        return [...byKey.values()];
      })
    ),
    null
  );

  /**
   * Read the tasks' notes for what the index doesn't hold: each task's title
   * without its status, its note's title, and its PR, which agents write in
   * a note under the task. A task whose note now says another status (the
   * index lags edits) is left out.
   */
  async details(
    tasks: ShipTask[]
  ): Promise<Map<string, ShipTaskDetails & { stage: ShipStage }>> {
    const out = new Map<string, ShipTaskDetails & { stage: ShipStage }>();
    const byDoc = new Map<string, ShipTask[]>();
    for (const task of tasks) {
      byDoc.set(task.docId, [...(byDoc.get(task.docId) ?? []), task]);
    }
    await Promise.all(
      [...byDoc].map(async ([docId, docTasks]) => {
        const { doc, release } = this.docsService.open(docId);
        try {
          await doc.waitForSyncReady();
          const docTitle = doc.title$.value || 'Untitled';
          for (const task of docTasks) {
            const model = doc.blockSuiteDoc.getBlock(task.blockId)?.model;
            if (!model) continue;
            const status = readStage(model);
            if (!status) continue;
            out.set(`${task.docId}:${task.blockId}`, {
              stage: status,
              title: taskTitle(model),
              docTitle,
              pullRequest: findPullRequest(subtreeText(model)),
            });
          }
        } catch {
          // A note that can't be opened leaves its tasks as the index has them.
        } finally {
          release();
        }
      })
    );
    return out;
  }

  /**
   * Send the tasks to `agent` to merge, or merge and deploy. The run's record
   * sits on the first task's note, on the tasks in that note, so its Show
   * link lands on one of them; the agent reads the brief, which names all.
   * With only `github.untracked` pull requests to merge, the record goes on
   * `placeAt`, any task on the screen: a run needs a note to be filed under,
   * and a task in a ship stage is not one a run claims.
   */
  async ship(
    agent: Agent,
    tasks: (ShipTask & ShipTaskDetails)[],
    action: ShipAction,
    github: { pulls?: PullRequest[]; untracked?: PullRequest[] } = {},
    placeAt?: Pick<ShipTask, 'docId' | 'blockId'>
  ): Promise<AgentTarget | null> {
    const chosen = shipTargets(tasks, action);
    const untracked = action === 'merge' ? (github.untracked ?? []) : [];
    const first = chosen[0] ?? (untracked.length > 0 ? placeAt : undefined);
    if (!first) return null;
    const target: AgentTarget = {
      kind: 'selection',
      docId: first.docId,
      blockIds: chosen.length
        ? chosen
            .filter(task => task.docId === first.docId)
            .map(task => task.blockId)
        : [first.blockId],
    };
    // Resolves when the run ends; the caller only needs it under way.
    this.runSessions
      .start(
        agent,
        target,
        shipBrief(chosen, action, { pulls: github.pulls, untracked })
      )
      .catch(() => {
        // The run's own record carries any failure.
      });
    return target;
  }
}

/** A block's ship stage from the note itself, if it is in one. */
const readStage = (model: BlockModel): ShipStage | null => {
  const stage = readTaskStatus(model)?.text.trim().toLowerCase();
  return isShipStage(stage) ? stage : null;
};
