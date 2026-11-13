import type { DeployInfo } from '../../../core/config/deploy-info';
import type {
  GhCheckRun,
  GhCombinedStatus,
  GhCommit,
  GhJob,
  GhPull,
  GhRun,
} from './github';

/**
 * The release view of a repo, as the Deployments screen shows it, and the
 * pure rules that build it from what GitHub says. The shapes here are the
 * contract with the screen: renaming a field breaks it.
 */

export interface ReleaseSettings {
  repo: string;
  baseBranch: string;
  deployBranch: string;
  workflowFile: string;
}

export type ChecksState = 'pass' | 'fail' | 'pending' | 'none';

export type Readiness =
  | 'ready'
  | 'unknown'
  | 'conflicts'
  | 'failing'
  | 'pending'
  | 'draft';

export interface Pull {
  number: number;
  title: string;
  url: string;
  branch: string;
  author: string;
  draft: boolean;
  mergeableState: string;
  headSha: string;
  checks: ChecksState;
  readiness: Readiness;
  mergedAt: string | null;
}

export interface Run {
  id: number;
  url: string;
  sha: string;
  status: string;
  conclusion: string | null;
  startedAt: string;
  durationMs: number | null;
  /** The image a rollback run rolled prod back to; null for a deploy. */
  rollbackTo: string | null;
  /** Pull requests this run took live: those since the previous release. */
  prs: number[];
}

export type StepName = 'Build image' | 'Roll the box' | 'Verify';
export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export interface Step {
  name: StepName;
  status: StepStatus;
}

export type ProductionStatus =
  | 'live'
  | 'deploying'
  | 'failed'
  | 'rolled-back'
  | 'unknown';

export interface LinkedTask {
  docId: string;
  blockId: string;
  title: string;
  status: string;
}

export interface ReleaseState {
  settings: ReleaseSettings | null;
  token: { source: 'secret' | 'env' | null };
  production: {
    deployInfo: DeployInfo | null;
    run: Run | null;
    status: ProductionStatus;
    steps: Step[];
    mainSha: string | null;
    stageSha: string | null;
    /** The deploy branch has commits the base branch lacks (a hotfix). */
    diverged: boolean;
  };
  next: { sha: string | null; commits: number; prs: Pull[] };
  open: Pull[];
  history: Run[];
  tasks: Record<number, LinkedTask[]>;
  fetchedAt: string;
  error: string | null;
}

// ── merge commits ──────────────────────────────────────────────────────────

const MERGE_PR_RE = /^Merge pull request #(\d+)/;

/**
 * The pull requests merged into `head` within a compare's commits: the
 * "Merge pull request #N" merge commits on head's first-parent line, newest
 * first — the rule scripts/prod/deploy-info.mjs and scripts/release.sh use
 * (`git log --first-parent --merges`). A merge reached only through a
 * second parent (a branch's own history), a "Merge branch" commit and a
 * squash or rebase merge are not counted.
 */
export function firstParentMerges(commits: GhCommit[], head: string): number[] {
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  const numbers: number[] = [];
  const seen = new Set<string>();
  let sha: string | undefined = head;
  while (sha && bySha.has(sha) && !seen.has(sha)) {
    seen.add(sha);
    const commit: GhCommit = bySha.get(sha)!;
    if (commit.parents.length === 2) {
      const match = MERGE_PR_RE.exec(commit.commit.message);
      if (match) numbers.push(Number(match[1]));
    }
    sha = commit.parents[0]?.sha;
  }
  return numbers;
}

// ── pull requests ──────────────────────────────────────────────────────────

const FAILED_CHECKS = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'action_required',
  'startup_failure',
  'stale',
]);

/** What a commit's check runs and commit statuses add up to. */
export function checksState(
  runs: GhCheckRun[],
  status: GhCombinedStatus | null
): ChecksState {
  const statuses = status?.statuses ?? [];
  if (!runs.length && !statuses.length) return 'none';
  let pending = false;
  for (const run of runs) {
    if (run.status === 'completed') {
      if (run.conclusion && FAILED_CHECKS.has(run.conclusion)) return 'fail';
    } else {
      pending = true;
    }
  }
  for (const { state } of statuses) {
    if (state === 'failure' || state === 'error') return 'fail';
    if (state === 'pending') pending = true;
  }
  return pending ? 'pending' : 'pass';
}

const MERGEABLE_STATES = new Set(['clean', 'unstable', 'has_hooks', 'behind']);

/**
 * Whether a pull request can merge now: the screen's readiness badge (a port
 * of the client's mergeReadiness, on GitHub's REST `mergeable_state`).
 */
export function pullReadiness(
  pull: { draft?: boolean; mergeable_state?: string },
  checks: ChecksState
): Readiness {
  if (pull.draft) return 'draft';
  if (pull.mergeable_state === 'dirty') return 'conflicts';
  if (checks === 'fail') return 'failing';
  if (checks === 'pending') return 'pending';
  if (pull.mergeable_state && MERGEABLE_STATES.has(pull.mergeable_state)) {
    return 'ready';
  }
  return 'unknown';
}

export function toPull(
  pull: GhPull,
  checks: ChecksState = 'none',
  detail?: Pick<GhPull, 'mergeable_state'>
): Pull {
  const mergeableState =
    detail?.mergeable_state ?? pull.mergeable_state ?? 'unknown';
  return {
    number: pull.number,
    title: pull.title,
    url: pull.html_url,
    branch: pull.head.ref,
    author: pull.user?.login ?? '',
    draft: !!pull.draft,
    mergeableState,
    headSha: pull.head.sha,
    checks,
    readiness: pullReadiness(
      { draft: pull.draft, mergeable_state: mergeableState },
      checks
    ),
    mergedAt: pull.merged_at,
  };
}

/**
 * The next release: what the base branch has that the deploy branch lacks
 * (`compare deploy...base`), its pull requests from the merge commits on
 * base's first-parent line, newest first. `pulls` hydrates them (the closed
 * pull requests into base); one not there is left out.
 */
export function nextRelease(
  compare: { ahead_by: number; commits: GhCommit[] },
  baseSha: string,
  pulls: Map<number, GhPull>
): ReleaseState['next'] {
  if (compare.ahead_by <= 0) return { sha: null, commits: 0, prs: [] };
  const prs = firstParentMerges(compare.commits, baseSha).flatMap(number => {
    const pull = pulls.get(number);
    return pull ? [toPull(pull)] : [];
  });
  return { sha: baseSha, commits: compare.ahead_by, prs };
}

// ── runs ───────────────────────────────────────────────────────────────────

const ROLLBACK_RE = /^Roll back to ([0-9a-f]{40})/;

/** The image a run rolled back to, from its title (deploy-prod.yml run-name). */
export function labelRun(run: Pick<GhRun, 'display_title'>): {
  rollbackTo: string | null;
} {
  return { rollbackTo: ROLLBACK_RE.exec(run.display_title ?? '')?.[1] ?? null };
}

export const isActive = (run: Pick<GhRun, 'status'>) =>
  run.status !== 'completed';

const isSuccess = (run: Pick<GhRun, 'status' | 'conclusion'>) =>
  run.status === 'completed' && run.conclusion === 'success';

const FAILED_RUN = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'startup_failure',
  'action_required',
]);

export function toRun(run: GhRun, prs: number[] = []): Run {
  const startedAt = run.run_started_at ?? run.created_at;
  const durationMs =
    run.status === 'completed'
      ? Math.max(0, Date.parse(run.updated_at) - Date.parse(startedAt))
      : null;
  return {
    id: run.id,
    url: run.html_url,
    sha: run.head_sha,
    status: run.status ?? 'unknown',
    conclusion: run.conclusion,
    startedAt,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    rollbackTo: labelRun(run).rollbackTo,
    prs,
  };
}

/**
 * The release a run is measured against: the newest successful deploy (not
 * a rollback) older than it, in `runs` (newest first). Null for the oldest.
 */
export function previousRelease(runs: GhRun[], index: number): GhRun | null {
  for (let i = index + 1; i < runs.length; i++) {
    const run = runs[i];
    if (isSuccess(run) && !labelRun(run).rollbackTo) return run;
  }
  return null;
}

/**
 * Each run's pull requests (`runs` newest first): those merged between the
 * previous release's commit and the run's, by the merge-commit rule. A
 * rollback ships nothing new, and the oldest run, with nothing before it in
 * the list, has no range to read: both get none. `between` reads a range;
 * `memo` keeps them by sha pair, as a range never changes.
 */
export async function runRanges(
  runs: GhRun[],
  between: (base: string, head: string) => Promise<number[]>,
  memo: Map<string, number[]> = new Map()
): Promise<Map<number, number[]>> {
  const ranges = new Map<number, number[]>();
  await Promise.all(
    runs.map(async (run, index) => {
      const previous = previousRelease(runs, index);
      if (labelRun(run).rollbackTo || !previous) {
        ranges.set(run.id, []);
        return;
      }
      if (previous.head_sha === run.head_sha) {
        ranges.set(run.id, []);
        return;
      }
      const key = `${previous.head_sha}...${run.head_sha}`;
      let prs = memo.get(key);
      if (!prs) {
        prs = await between(previous.head_sha, run.head_sha);
        memo.set(key, prs);
      }
      ranges.set(run.id, prs);
    })
  );
  return ranges;
}

/**
 * The run production is about: the active one when a run is going, else
 * the newest that finished.
 */
export function productionRun(runs: GhRun[]): GhRun | null {
  return runs.find(isActive) ?? runs[0] ?? null;
}

/**
 * Where prod stands, from the runs (newest first): a run going is a
 * deploy; else the newest that ended decides — failed, rolled back, or live.
 */
export function productionStatus(runs: GhRun[]): ProductionStatus {
  if (runs.some(isActive)) return 'deploying';
  for (const run of runs) {
    if (run.conclusion === 'success') {
      return labelRun(run).rollbackTo ? 'rolled-back' : 'live';
    }
    if (run.conclusion && FAILED_RUN.has(run.conclusion)) return 'failed';
    // skipped / neutral: look further back
  }
  return 'unknown';
}

// ── steps ──────────────────────────────────────────────────────────────────

/** The workflow steps behind each step the screen shows, first match wins. */
const STEP_SOURCES: Record<StepName, string[]> = {
  'Build image': ['Build and push image', 'Check image'],
  'Roll the box': ['Roll the box'],
  Verify: ['Verify'],
};

function stepStatus(step: {
  status: string;
  conclusion: string | null;
}): StepStatus {
  if (step.status === 'completed') {
    if (step.conclusion === 'success') return 'done';
    if (step.conclusion === 'skipped') return 'skipped';
    return 'failed';
  }
  if (step.status === 'in_progress') return 'running';
  return 'pending';
}

/**
 * The run's progress as Build image → Roll the box → Verify, from its job's
 * steps. A rollback's Build image is its Check image step. When the job
 * failed in a step before these (credentials, say), the first one not done
 * shows the failure, rather than every step reading as skipped.
 */
export function runSteps(jobs: GhJob[]): Step[] {
  const steps = jobs.flatMap(job => job.steps ?? []);
  const result = (Object.keys(STEP_SOURCES) as StepName[]).map(name => {
    const sources = STEP_SOURCES[name]
      .map(source => steps.find(step => step.name === source))
      .filter(step => !!step);
    // Prefer the source that ran: a rollback skips the build, a deploy the check.
    const ran =
      sources.find(step => stepStatus(step) !== 'skipped') ?? sources[0];
    return { name, status: ran ? stepStatus(ran) : ('pending' as StepStatus) };
  });
  const failedJob = jobs.some(
    job =>
      job.status === 'completed' &&
      !!job.conclusion &&
      FAILED_RUN.has(job.conclusion)
  );
  if (failedJob && !result.some(step => step.status === 'failed')) {
    const first = result.find(step => step.status !== 'done');
    if (first) first.status = 'failed';
  }
  return result;
}
