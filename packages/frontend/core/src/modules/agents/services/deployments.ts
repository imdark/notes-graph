import { applyOrgStatusTimestamps } from '@blocksuite/notesgraph/shared/utils';
import { type BlockModel, Text } from '@blocksuite/notesgraph/store';
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
import type { AgentRun } from '../stores/agent-runs';
import type { Agent } from '../stores/agents';
import type {
  Automation,
  AutomationRun,
  AutomationsService,
} from './automations';
import { runTargetsBlock } from './block-runs';
import type { AgentContext } from './context';
import {
  CLOUD_DEVICE_KEY,
  COMMAND_MODEL,
  type DeployInfo,
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

/** The number in a pull request's URL. */
export const pullRequestNumber = (url: string): number | null => {
  const n = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
};

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
 * Where a pull request is on its way to production: still open, merged but
 * not in the build prod runs, or in it.
 */
export type PullRequestStage = 'open' | 'merged' | 'deployed';

/**
 * Checked against what prod says it runs. Null when that can't be told: the
 * server has no deploy record, or the pull request is in another repo than
 * the one deployed.
 */
export function pullRequestStage(
  pr: Pick<PullRequest, 'state' | 'number' | 'url'>,
  deploy: DeployInfo | null
): PullRequestStage | null {
  if (pr.state === 'open') return 'open';
  if (!deploy || repoOf(pr.url) !== deploy.repo) return null;
  return deploy.pullRequests.includes(pr.number) ? 'deployed' : 'merged';
}

/**
 * Whether prod's build has a feature flag, told by the commit that added it
 * (see scripts/stamp-feature-flags.mjs): `deployed` when prod lists the flag
 * with that commit, `not-deployed` when it doesn't. Null when that can't be
 * told: no deploy record, a record from before flags were stamped, or a flag
 * with no commit.
 */
export type FlagStage = 'deployed' | 'not-deployed';

export function flagStage(
  key: string,
  commit: string,
  deploy: DeployInfo | null | undefined
): FlagStage | null {
  if (!commit || !deploy?.featureFlags) return null;
  return deploy.featureFlags[key] === commit ? 'deployed' : 'not-deployed';
}

/**
 * Where a task shows on the Deployments page: the stage noted on it, moved
 * on when its pull request is further along. Merged on GitHub (`merged`,
 * from the pull request list or a branch check) puts a COMMITTED task with
 * the ones to deploy; in the build prod runs puts any task with the live
 * ones, since nobody may have re-marked it after the deploy.
 */
export function shownStage(
  noted: ShipStage,
  pullRequest: string | null,
  merged: boolean,
  deploy: DeployInfo | null
): ShipStage {
  if (!pullRequest) return noted;
  const number = pullRequestNumber(pullRequest);
  if (
    number !== null &&
    pullRequestStage({ state: 'merged', number, url: pullRequest }, deploy) ===
      'deployed'
  ) {
    return 'deployed';
  }
  return noted === 'committed' && merged ? 'merged' : noted;
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

/**
 * The automations the screen merges and deploys with: wf actions YAML (see
 * plugins/automations on the server) that wf on the ship agent's device
 * runs, no model involved. The screen creates each the first time it needs
 * it, keeps its code to what is here, and runs it by hand; their runs and
 * logs are on the Automations page like any other's.
 */
export type ShipAutomationKind = 'merge' | 'deploy';

export interface ShipAutomationSpec {
  name: string;
  code: string;
  timeoutSeconds: number;
}

export const SHIP_AUTOMATIONS: Record<ShipAutomationKind, ShipAutomationSpec> =
  {
    merge: {
      name: 'Deployments: merge a pull request',
      timeoutSeconds: 5 * 60,
      code: `# Merge one pull request on GitHub with a merge commit, as this repo does.
# Run from the Deployments screen with input {repo: "owner/name", number}.
actions:
  - id: merge
    type: custom_command
    command: gh pr merge {input.number} -R {input.repo} --merge
  - id: commit
    type: custom_command
    command: gh pr view {input.number} -R {input.repo} --json mergeCommit --jq .mergeCommit.oid
`,
    },
    deploy: {
      name: 'Deployments: deploy to production',
      timeoutSeconds: 60 * 60,
      code: `# Deploy the merged code to production: the cloud deploy wf has set up for
# the project (wf deploy cloud-config) brings its checkout to the deploy
# branch, runs the deploy command, then asks the verify URL.
actions:
  - id: deploy
    type: cloud_deploy
`,
    },
  };

/** What {@link DeploymentsService.mergeAndDeploy} did. */
export interface ShipReport {
  /** The tasks that went into the deploy: merged before, or just now. */
  merged: (ShipTask & ShipTaskDetails)[];
  /** COMMITTED tasks whose pull request didn't merge, and why. */
  leftOut: { task: ShipTask & ShipTaskDetails; why: string }[];
  /** The deploy, or null when nothing was merged to deploy. */
  deployed: { commit: string; verify: string | null } | null;
}

/** What a {@link ShipReport} comes to, to tell the person who asked. */
export function shipReportText(report: ShipReport): {
  ok: boolean;
  title: string;
  message: string;
} {
  const leftOut = report.leftOut.map(
    ({ task, why }) =>
      `"${task.title || task.text}" wasn't merged (${why.split('\n')[0]})`
  );
  const fix =
    leftOut.length > 0
      ? `${leftOut.join('; ')}. Fix & merge with Claude from the Deployments page.`
      : '';
  if (!report.deployed) {
    return {
      ok: false,
      title: 'Nothing deployed',
      message: fix || 'Nothing was merged to deploy.',
    };
  }
  const { commit, verify } = report.deployed;
  return {
    ok: leftOut.length === 0,
    title: `Deployed ${commit.slice(0, 7) || 'main'}`,
    message: [
      `${plural(report.merged.length, 'task')} now DEPLOYED, waiting to be checked live.`,
      verify,
      fix,
    ]
      .filter(Boolean)
      .join(' '),
  };
}

/** Whether the ship automations can run on the agent's device (wf, not the cloud runner). */
export const shipsWithAutomations = (agent: Pick<Agent, 'deviceKey'>) =>
  !!agent.deviceKey && agent.deviceKey !== CLOUD_DEVICE_KEY;

/** What a ship automation's output says one of its steps printed or found. */
export const stepResult = (
  output: Record<string, unknown>,
  step: string
): Record<string, unknown> => {
  const result = output[step];
  return result && typeof result === 'object'
    ? (result as Record<string, unknown>)
    : {};
};

/** How long a merge may wait for the device before it is called off. */
const MERGE_WAIT_MS = COMMAND_WAIT_MS;
/** A deploy's own limit, and some for the device to pick it up. */
const DEPLOY_WAIT_MS =
  (SHIP_AUTOMATIONS.deploy.timeoutSeconds + 10 * 60) * 1000;

/** The last line a run logged, to say what it is doing. */
export const lastLogLine = (logs: string | undefined): string =>
  (logs ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .pop() ?? '';

/** The note a deploy leaves under each task it took out. */
export const deployedNote = (commit: string, at: Date): string =>
  `Deployed ${commit.slice(0, 7)} on ${at.toLocaleDateString()}.`;

/**
 * What the screen asks of GitHub. A Mac runs it as the `gh` shell command
 * below; the cloud runner runs no shell from a job, so it gets the request
 * itself (agent id `github:<op>`, the request as JSON) and runs `gh` with
 * arguments it builds, printing the same output (tools/agent-runner
 * github.ts).
 */
export type GitHubRequest =
  | { op: 'list'; repos: string[] }
  | { op: 'merge'; repo: string; number: number }
  | { op: 'check'; prs: Pick<PullRequest, 'repo' | 'number'>[] }
  | { op: 'delete'; prs: Pick<PullRequest, 'repo' | 'number'>[] };

/** Agent ids of {@link GitHubRequest} jobs start with this. */
export const GITHUB_AGENT_PREFIX = 'github:';

/** A ready-to-merge pull request as GitHub has it now, and whether its branch is still there. */
export interface BranchCheck {
  repo: string;
  number: number;
  url: string;
  /** `missing`: GitHub has no such pull request (deleted, or no access). */
  state: 'open' | 'merged' | 'closed' | 'missing';
  branch: string | null;
  branchExists: boolean;
}

/** Branches never deleted, merged or not. */
const KEPT_BRANCHES = new Set([
  'main',
  'master',
  'canary',
  'develop',
  'stable',
]);

/**
 * The shell command that checks each pull request: its state, its branch,
 * and whether the branch still exists. One tab-separated line each:
 * number, repo, state, branch, branch exists. A pull request `gh` can't
 * read comes back as `missing`.
 */
export function branchCheckCommand(
  prs: Pick<PullRequest, 'repo' | 'number'>[]
): string {
  return prs
    .map(pr => {
      const repo = shellQuote(pr.repo);
      const n = Math.floor(pr.number);
      return (
        `s=$(gh pr view ${n} -R ${repo} --json state,headRefName --jq '"\\(.state)\\t\\(.headRefName)"' 2>/dev/null) || s='MISSING\t'; ` +
        `b=$(printf '%s' "$s" | cut -f2); e=false; ` +
        `[ -n "$b" ] && gh api "repos/${pr.repo}/branches/$b" --silent >/dev/null 2>&1 && e=true; ` +
        `printf '%s\t%s\t%s\t%s\n' ${n} ${repo} "$s" "$e"`
      );
    })
    .join('; ');
}

/** Read {@link branchCheckCommand}'s lines back, against the pull requests asked about. */
export function parseBranchChecks(
  output: string,
  prs: Pick<PullRequest, 'repo' | 'number' | 'url'>[]
): BranchCheck[] {
  const checks: BranchCheck[] = [];
  for (const line of output.split('\n')) {
    const [number, repo, state, branch, exists] = line.trim().split('\t');
    const pr = prs.find(p => String(p.number) === number && p.repo === repo);
    if (!pr) continue;
    const known = state?.toLowerCase();
    checks.push({
      repo: pr.repo,
      number: pr.number,
      url: pr.url,
      state:
        known === 'open' || known === 'merged' || known === 'closed'
          ? known
          : 'missing',
      branch: branch || null,
      branchExists: exists === 'true',
    });
  }
  return checks;
}

/**
 * Why a COMMITTED task has nothing to merge, or null when it may: no pull
 * request named, or "Check ready branches" found it closed, gone from
 * GitHub, or open on a branch that was deleted. Unchecked, a named pull
 * request is taken as mergeable.
 */
export function stuckReason(
  task: { stage: ShipStage; pullRequest: string | null },
  check: Pick<BranchCheck, 'state' | 'branchExists'> | undefined
): string | null {
  if (task.stage !== 'committed') return null;
  if (!task.pullRequest) return 'No pull request';
  if (!check) return null;
  if (check.state === 'closed') return 'Closed without merging';
  if (check.state === 'missing') return 'Not on GitHub';
  if (check.state === 'open' && !check.branchExists) return 'Branch deleted';
  return null;
}

/** Whether a checked branch is merged, still there and safe to delete. */
export const deletesBranch = (check: BranchCheck) =>
  check.state === 'merged' &&
  check.branchExists &&
  !!check.branch &&
  !KEPT_BRANCHES.has(check.branch);

/** The command that deletes a merged pull request's branch on GitHub. */
export const deleteBranchCommand = (
  check: Pick<BranchCheck, 'repo' | 'branch'>
) =>
  `gh api -X DELETE ${shellQuote(`repos/${check.repo}/git/refs/heads/${check.branch}`)}`;

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
 * Where the Android app's own code lives: the Capacitor app and its native
 * plugins. A deploy that changed any of it also rebuilds the APK.
 */
const ANDROID_PATHS = [
  'packages/frontend/apps/android',
  'packages/frontend/mobile-native',
];

/**
 * The APK is published by hand from a device, after the prod deploy: an
 * rsync during a build dies on the APK assets being rewritten.
 */
const ANDROID_STEP = `Then the Android app: list what this deploy changed there, \`git diff --name-only <commit prod ran before>..<commit it runs now> -- ${ANDROID_PATHS.join(' ')}\`. If anything changed, build and publish the APK the way this repo does (the deploy-android-apk skill), only once the prod deploy has finished. If nothing changed, don't build it, and say the APK was left as it was.`;

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
          ANDROID_STEP,
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

/** A ship run's brief opens with its title; a deploy's is one of these. */
const DEPLOY_BRIEF = /^# (?:Merge and deploy|Deploy) \d+ features?\b/;

/**
 * The deploy runs sent for what `run` worked on, newest first as `runs`
 * comes: runs whose brief is a deploy and that were pointed at one of its
 * blocks. Told by the brief, since the agent may retitle its run.
 */
export const deployRunsFor = (runs: AgentRun[], run: AgentRun): AgentRun[] => {
  const blockIds = run.blockIds ?? (run.blockId ? [run.blockId] : []);
  return runs.filter(
    other =>
      other.id !== run.id &&
      other.docId === run.docId &&
      DEPLOY_BRIEF.test(other.input ?? '') &&
      blockIds.some(id => runTargetsBlock(other, id))
  );
};

/**
 * A block a run worked on, read from its note: what it is called, the status
 * it carries (null for a plain block), and the pull request named in it.
 * `stage` is set when that status is a ship stage.
 */
export interface RunTask extends ShipTaskDetails {
  docId: string;
  blockId: string;
  status: string | null;
  stage: ShipStage | null;
}

/** The tasks of a run a deploy takes: committed or merged, not yet live. */
export const deployableTasks = (
  tasks: RunTask[]
): (ShipTask & ShipTaskDetails)[] =>
  tasks.flatMap(task =>
    task.stage === 'committed' || task.stage === 'merged'
      ? [{ ...task, stage: task.stage, text: task.title }]
      : []
  );

/**
 * What checking a live task found: it works, or it doesn't and `problem`
 * says how (may be empty).
 */
export type LiveCheck = { works: true } | { works: false; problem: string };

/** The note a live check leaves under its task. */
export const liveCheckNote = (check: LiveCheck, at: Date): string => {
  const when = `Checked live ${at.toLocaleDateString()}`;
  if (check.works) return `${when}: works.`;
  const problem = check.problem.trim();
  return `${when}: doesn't work.${problem ? ` ${problem}` : ''}`;
};

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
    private readonly workspaceService: WorkspaceService,
    private readonly automations: AutomationsService
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

  /**
   * What prod runs, to tell merged pull requests that are live from those
   * waiting on a deploy. Undefined until read; null where the server keeps no
   * deploy record.
   */
  readonly deployInfo$ = new LiveData<DeployInfo | null | undefined>(undefined);

  /**
   * What "Check ready branches" last found, by pull request URL: kept, since
   * the pull request list only holds open and recently merged ones, so an
   * older merged, closed or deleted one is known only from here.
   */
  readonly branchChecks$ = new LiveData<ReadonlyMap<string, BranchCheck>>(
    new Map()
  );

  async refreshDeployInfo(): Promise<void> {
    try {
      this.deployInfo$.setValue(await this.remote.deployInfo());
    } catch {
      // An older server has no endpoint: same as no record.
      this.deployInfo$.setValue(null);
    }
  }

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  /**
   * Ask GitHub through the agent's device and return what it printed: on a
   * Mac, `command` as a wf command job; on the cloud runner, the request
   * itself (see {@link GitHubRequest}). A job not finished in time is
   * cancelled, so a device that is off doesn't run a stale merge whenever it
   * comes back.
   */
  private async runCommand(
    agent: Agent,
    request: GitHubRequest,
    command: string,
    title: string
  ): Promise<string> {
    if (!agent.deviceKey) throw new Error(`${agent.name} has no device`);
    const workspaceId = this.workspaceId;
    const cloud = agent.deviceKey === CLOUD_DEVICE_KEY;
    const job = await this.remote.enqueue(workspaceId, {
      deviceKey: agent.deviceKey,
      agentId: cloud ? GITHUB_AGENT_PREFIX + request.op : agent.id,
      agentName: agent.name,
      instructions: cloud ? JSON.stringify(request) : command,
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
    // Checked alongside, so a refresh also catches a deploy since.
    this.refreshDeployInfo().catch(() => {});
    try {
      let cwd: string | undefined;
      // The cloud runner lists its own repo.
      if (repos.length === 0 && agent.deviceKey !== CLOUD_DEVICE_KEY) {
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
        { op: 'list', repos },
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
   * The automation of `kind` on `deviceKey`, as {@link SHIP_AUTOMATIONS}
   * has it: created the first time, its code and settings brought up to
   * date, and its latest version deployed to the device.
   */
  private async shipAutomation(
    kind: ShipAutomationKind,
    deviceKey: string
  ): Promise<Automation> {
    const spec = SHIP_AUTOMATIONS[kind];
    const draft = {
      name: spec.name,
      runtime: 'actions' as const,
      triggers: [{ type: 'manual' as const }],
      secrets: [],
      timeoutSeconds: spec.timeoutSeconds,
      maxRetries: 0,
      enabled: true,
    };
    let automation = (await this.automations.revalidate()).find(
      a => a.name === spec.name
    );
    if (!automation) {
      automation = (await this.automations.create(draft, spec.code)).automation;
    } else if (
      automation.runtime !== 'actions' ||
      automation.timeoutSeconds !== spec.timeoutSeconds ||
      !automation.enabled
    ) {
      automation = (await this.automations.update(automation.id, draft))
        .automation;
    }
    // The same code as the latest version keeps it; new code is a new one.
    const version = await this.automations.saveCode(automation.id, spec.code);
    const deployed = automation.deployments.find(d => d.target === deviceKey);
    if (deployed?.versionId !== version.id) {
      await this.automations.deploy(automation.id, deviceKey);
    }
    return automation;
  }

  /**
   * Run the ship automation of `kind` on the agent's device and wait for it
   * to end, calling `onUpdate` with each read of the run. Resolves with what
   * it returned; throws with its error and last log lines when it fails. A
   * run not over within `waitMs` is cancelled, so a device that is off
   * doesn't merge or deploy whenever it comes back.
   */
  private async runShipAutomation(
    kind: ShipAutomationKind,
    agent: Agent,
    input: unknown,
    waitMs: number,
    onUpdate?: (run: AutomationRun) => void
  ): Promise<Record<string, unknown>> {
    const deviceKey = agent.deviceKey;
    if (!deviceKey || !shipsWithAutomations(agent)) {
      throw new Error(
        `${agent.name} isn't on a device with wf, which ${kind === 'merge' ? 'merges' : 'deploys'} from here`
      );
    }
    const automation = await this.shipAutomation(kind, deviceKey);
    let run = await this.automations.runNow(automation.id, input, deviceKey);
    onUpdate?.(run);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      run = await this.automations.waitForRun(automation.id, run.id, {
        signal: controller.signal,
        onUpdate,
      });
    } catch (err) {
      if (!controller.signal.aborted) throw err;
      if (run.jobId) {
        await this.remote.cancel(this.workspaceId, run.jobId).catch(() => {});
      }
      throw new Error(
        run.status === 'queued'
          ? `${deviceKey} didn't pick it up in time. Is wf agent serve running there?`
          : `It was still running on ${deviceKey} after ${Math.round(waitMs / 60_000)} minutes, so it was stopped`
      );
    } finally {
      clearTimeout(timer);
    }
    if (run.status !== 'succeeded') {
      const tail = (run.logs ?? '').trimEnd().split('\n').slice(-5).join('\n');
      throw new Error(
        `${run.error || `It ended ${run.status.replace('_', ' ')}`}${tail ? `\n${tail}` : ''}`
      );
    }
    const output = run.output;
    return output && typeof output === 'object'
      ? (output as Record<string, unknown>)
      : {};
  }

  /**
   * Merge a pull request with the merge automation on the agent's device
   * (on the cloud runner, through its GitHub request), with no AI: for
   * those GitHub says merge cleanly. Throws with what `gh` said when it
   * doesn't, which is the cue to hand it to Claude Code. The task it ships,
   * if any, goes to MERGED.
   */
  async merge(
    agent: Agent,
    pr: Pick<PullRequest, 'repo' | 'number' | 'url'>,
    task?: Pick<ShipTask, 'docId' | 'blockId'>
  ): Promise<void> {
    if (agent.deviceKey === CLOUD_DEVICE_KEY) {
      await this.runCommand(
        agent,
        { op: 'merge', repo: pr.repo, number: pr.number },
        mergeCommand(pr),
        `Merge ${pr.repo}#${pr.number}`
      );
    } else {
      await this.runShipAutomation(
        'merge',
        agent,
        { repo: pr.repo, number: pr.number },
        MERGE_WAIT_MS
      );
    }
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

  /**
   * Check the ready-to-merge pull requests against GitHub, through wf on the
   * agent's device: whether each still exists, is merged, and still has its
   * branch. A merged one's branch is deleted (never main and the like) and
   * its task moves to MERGED, so it leaves the list. The rest are reported
   * and left as they are.
   */
  async checkReadyBranches(
    agent: Agent,
    items: {
      pr: Pick<PullRequest, 'repo' | 'number' | 'url'>;
      task?: Pick<ShipTask, 'docId' | 'blockId'>;
    }[]
  ): Promise<{
    checks: BranchCheck[];
    deleted: BranchCheck[];
    failed: string[];
  }> {
    if (items.length === 0) return { checks: [], deleted: [], failed: [] };
    const prs = items.map(item => item.pr);
    const refs = (list: Pick<PullRequest, 'repo' | 'number'>[]) =>
      list.map(({ repo, number }) => ({ repo, number }));
    const checks = parseBranchChecks(
      await this.runCommand(
        agent,
        { op: 'check', prs: refs(prs) },
        branchCheckCommand(prs),
        `Check ${prs.length} ready branch${prs.length === 1 ? '' : 'es'}`
      ),
      prs
    );
    const known = new Map(this.branchChecks$.value);
    for (const check of checks) known.set(check.url, check);
    this.branchChecks$.setValue(known);
    const toDelete = checks.filter(deletesBranch);
    const deleted: BranchCheck[] = [];
    const failed: string[] = [];
    if (toDelete.length > 0) {
      // One job for all of them; each line says whether its delete went.
      const output = await this.runCommand(
        agent,
        { op: 'delete', prs: refs(toDelete) },
        toDelete
          .map(
            check =>
              `${deleteBranchCommand(check)} >/dev/null 2>&1 && echo "ok ${check.repo}#${check.number}" || echo "fail ${check.repo}#${check.number}"`
          )
          .join('; '),
        `Delete ${toDelete.length} merged branch${toDelete.length === 1 ? '' : 'es'}`
      );
      const done = new Set(output.split('\n').map(line => line.trim()));
      for (const check of toDelete) {
        if (done.has(`ok ${check.repo}#${check.number}`)) deleted.push(check);
        else failed.push(`${check.repo}#${check.number}`);
      }
    }
    for (const check of checks) {
      if (check.state !== 'merged') continue;
      for (const item of items) {
        if (item.pr.url === check.url && item.task) {
          await this.markMerged(item.task).catch(() => false);
        }
      }
    }
    return { checks, deleted, failed };
  }

  /** Move a task to MERGED, as an agent that merged it would. */
  private markMerged(task: Pick<ShipTask, 'docId' | 'blockId'>) {
    return this.moveOn(task, 'MERGED');
  }

  /**
   * Deploy what is on main to production with the deploy automation on the
   * agent's device, calling `onUpdate` with each read of the run. When it
   * succeeds, each of `tasks` still COMMITTED or MERGED in its note goes to
   * DEPLOYED, with a note naming the commit; none is marked done, which
   * waits for someone to check it live. A failed deploy changes no task.
   * Resolves with the deployed commit.
   */
  async deploy(
    agent: Agent,
    tasks: Pick<ShipTask, 'docId' | 'blockId'>[],
    onUpdate?: (run: AutomationRun) => void
  ): Promise<{ commit: string; verify: string | null }> {
    const output = await this.runShipAutomation(
      'deploy',
      agent,
      {},
      DEPLOY_WAIT_MS,
      onUpdate
    );
    const result = stepResult(output, 'deploy');
    const commit = String(result.commit ?? '');
    const at = new Date();
    for (const task of tasks) {
      await this.markDeployed(task, commit, at).catch(() => false);
    }
    this.refreshDeployInfo().catch(() => {});
    return {
      commit,
      verify: typeof result.verify === 'string' ? result.verify : null,
    };
  }

  /**
   * Merge and deploy `tasks` with the ship automations on the agent's
   * device, no model involved: each COMMITTED task's pull request is merged
   * first (one that won't merge cleanly, or has none named, is left out and
   * reported, for Claude Code to fix), then main is deployed with what is
   * merged. `onProgress` gets a line saying what is happening as it goes.
   */
  async mergeAndDeploy(
    agent: Agent,
    tasks: (ShipTask & ShipTaskDetails)[],
    onProgress?: (line: string) => void
  ): Promise<ShipReport> {
    const merged: (ShipTask & ShipTaskDetails)[] = [];
    const leftOut: { task: ShipTask & ShipTaskDetails; why: string }[] = [];
    for (const task of shipTargets(tasks, 'deploy')) {
      if (task.stage === 'merged') {
        merged.push(task);
        continue;
      }
      const repo = task.pullRequest ? repoOf(task.pullRequest) : null;
      const number = task.pullRequest
        ? pullRequestNumber(task.pullRequest)
        : null;
      if (!task.pullRequest || !repo || !number) {
        leftOut.push({ task, why: 'no pull request named' });
        continue;
      }
      onProgress?.(`Merging ${repo}#${number}…`);
      try {
        await this.merge(agent, { repo, number, url: task.pullRequest }, task);
        merged.push({ ...task, stage: 'merged' });
      } catch (err) {
        leftOut.push({
          task,
          why: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (merged.length === 0) return { merged, leftOut, deployed: null };
    onProgress?.('Deploying…');
    const deployed = await this.deploy(agent, merged, run => {
      const line = lastLogLine(run.logs);
      if (line) onProgress?.(line);
    });
    return { merged, leftOut, deployed };
  }

  /** Move a task that went out in a deploy to DEPLOYED, noting the commit. */
  private async markDeployed(
    task: Pick<ShipTask, 'docId' | 'blockId'>,
    commit: string,
    at: Date
  ): Promise<boolean> {
    const { doc, release } = this.docsService.open(task.docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const model = store.getBlock(task.blockId)?.model;
      const stage = model ? readStage(model) : null;
      if (!model || (stage !== 'committed' && stage !== 'merged')) return false;
      if (!setTaskStatus(model, 'DEPLOYED')) return false;
      if (commit) {
        store.addBlock(
          'notesgraph:paragraph' as never,
          { text: new Text(deployedNote(commit, at)) },
          model.id
        );
      }
      return true;
    } finally {
      release();
    }
  }

  /**
   * Move a COMMITTED task on by hand, from the screen: to MERGED when its
   * work is on main already (merged another way), or DONE when there is
   * nothing left to ship. Resolves to whether its note said COMMITTED.
   */
  async moveOn(
    task: Pick<ShipTask, 'docId' | 'blockId'>,
    status: 'MERGED' | 'DONE'
  ): Promise<boolean> {
    const { doc, release } = this.docsService.open(task.docId);
    try {
      await doc.waitForSyncReady();
      const model = doc.blockSuiteDoc.getBlock(task.blockId)?.model;
      if (!model || readStage(model) !== 'committed') return false;
      return setTaskStatus(model, status);
    } finally {
      release();
    }
  }

  /**
   * Record what checking a live task found, from the screen. Works: it is
   * done, stamped CLOSED, as update_task's `done` does. Doesn't work: it goes
   * back to to-do, so the board and agents pick it up again. Either way the
   * finding is noted under it. Resolves to whether its note still had it in a
   * ship stage.
   */
  async recordCheck(
    task: Pick<ShipTask, 'docId' | 'blockId'>,
    check: LiveCheck
  ): Promise<boolean> {
    const { doc, release } = this.docsService.open(task.docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const model = store.getBlock(task.blockId)?.model;
      if (!model?.text || !readStage(model)) return false;
      if (!setTaskStatus(model, check.works ? '[X]' : '[ ]')) return false;
      applyOrgStatusTimestamps(
        model.text.yText,
        check.works ? 'Done' : 'Todo',
        Date.now()
      );
      // A checkbox item shows its own tick too.
      if ((model.props as { type?: string }).type === 'todo') {
        store.updateBlock(model, { checked: check.works } as never);
      }
      store.addBlock(
        'notesgraph:paragraph' as never,
        { text: new Text(liveCheckNote(check, new Date())) },
        model.id
      );
      return true;
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
   * The blocks `run` was pointed at, as their note has them now. A run on a
   * task leaves it COMMITTED with its PR noted under it once its branch is
   * pushed, and that is what a deploy of the run's result goes out with. A
   * PR the run named only in its answer (`summary`) stands in for one the
   * task doesn't name.
   */
  async runTasks(
    run: Pick<AgentRun, 'docId' | 'blockId' | 'blockIds'>,
    summary?: string | null
  ): Promise<RunTask[]> {
    const blockIds = run.blockIds ?? (run.blockId ? [run.blockId] : []);
    if (blockIds.length === 0) return [];
    const { doc, release } = this.docsService.open(run.docId);
    try {
      await doc.waitForSyncReady();
      const docTitle = doc.title$.value || 'Untitled';
      const fromSummary = summary ? findPullRequest(summary) : null;
      return blockIds.flatMap(blockId => {
        const model = doc.blockSuiteDoc.getBlock(blockId)?.model;
        if (!model) return [];
        return [
          {
            docId: run.docId,
            blockId,
            title: taskTitle(model),
            docTitle,
            status: readTaskStatus(model)?.text.trim() ?? null,
            stage: readStage(model),
            pullRequest: findPullRequest(subtreeText(model)) ?? fromSummary,
          },
        ];
      });
    } finally {
      release();
    }
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
