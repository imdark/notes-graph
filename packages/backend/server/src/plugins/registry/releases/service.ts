import { Injectable, Logger } from '@nestjs/common';
import type { RegistryDeployRepo } from '@prisma/client';

import { BadRequest, Config, TooManyRequest } from '../../../base';
import { type DeployInfo, readDeployInfo } from '../../../core/config/deploy-info';
import { DocWriter } from '../../../core/doc';
import { PermissionAccess } from '../../../core/permission';
import { Models } from '../../../models';
import { IndexerService } from '../../indexer';
import { SearchTable } from '../../indexer/tables';
import { SearchQueryOccur, SearchQueryType } from '../../indexer/types';
import { parseBranchName, parseRepoName } from '../jobs';
import {
  type Fetch,
  GitHubClient,
  GitHubError,
  type GhPull,
  type GhRun,
} from './github';
import {
  checksState,
  firstParentMerges,
  isActive,
  labelRun,
  type LinkedTask,
  nextRelease,
  productionRun,
  productionStatus,
  type Pull,
  type ReleaseSettings,
  type ReleaseState,
  type Run,
  runRanges,
  runSteps,
  toPull,
  toRun,
} from './release-state';
import {
  deployTasks,
  mergeTasks,
  type PullKey,
  readTaskLinks,
  type TaskLink,
} from './task-links';

/** The workspace secret the releases read GitHub with. */
export const GITHUB_TOKEN_SECRET = 'GITHUB_TOKEN';
export const DEFAULT_WORKFLOW_FILE = 'deploy-prod.yml';

const HISTORY_RUNS = 15;
const CLOSED_PULLS = 50;
const CACHE_MS = 60_000;
const CACHE_DEPLOYING_MS = 15_000;
/** How long a release waits for GitHub to list the run it started. */
const RUN_WAIT_MS = 20_000;
const RUN_POLL_MS = 2_000;
/** Clock skew allowed between us and GitHub when matching a started run. */
const SKEW_MS = 10_000;

const WORKFLOW_FILE_RE = /^[\w.-]+\.ya?ml$/;
const SHA_RE = /^[0-9a-f]{40}$/;
/** What merge-all merges; the frontend's MERGE_ALL_READINESS matches it. */
const MERGE_ALL_READINESS = new Set(['ready', 'failing', 'unknown']);

/** The org statuses the index holds for tasks on their way out (kebab-cased). */
const SHIPPING_STATUSES = ['in-progress', 'committed', 'merged', 'deployed'];

/** A refusal the screen shows as is: 409. */
export function conflict(message: string): BadRequest {
  const error = new BadRequest(message);
  error.status = 409;
  return error;
}

/** A GitHub failure as the HTTP error the screen gets. */
export function httpError(err: unknown): unknown {
  if (!(err instanceof GitHubError)) return err;
  switch (err.code) {
    case 'rate-limited':
      return new TooManyRequest(err.message);
    case 'conflict':
    case 'not-fast-forward':
    case 'not-mergeable':
      return conflict(err.message);
    default:
      return new BadRequest(err.message);
  }
}

interface Token {
  value: string;
  source: 'secret' | 'env';
}

interface Cached {
  state: ReleaseState;
  at: number;
}

interface PullDetail {
  headSha: string;
  mergeableState: string;
  checks: Pull['checks'];
}

export const settingsOf = (row: RegistryDeployRepo): ReleaseSettings => ({
  repo: row.repo,
  baseBranch: row.baseBranch,
  deployBranch: row.deployBranch,
  workflowFile: row.workflowFile,
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * The Deployments screen's releases: what is live, what the next release
 * holds, the open pull requests and the deploy history, read from GitHub on
 * the server with the workspace's token; and the actions on them (merge,
 * release, redeploy, roll back, retry). Also keeps the tasks that name a pull
 * request in step with it: MERGED when it merges, DEPLOYED when a deploy takes
 * it live (see {@link syncRepo}, run every minute by the cron).
 */
@Injectable()
export class ReleaseService {
  private readonly logger = new Logger(ReleaseService.name);
  private readonly cache = new Map<string, Cached>();
  private readonly loading = new Map<string, Promise<ReleaseState>>();
  /** Settled pull request details, by `number:headSha`. */
  private readonly pullDetails = new Map<string, PullDetail>();
  /** Each run's pull requests, by `base...head` (a range never changes). */
  private readonly ranges = new Map<string, number[]>();
  /** Merged pull requests, by repo#number (they never change). */
  private readonly mergedPulls = new Map<string, GhPull>();

  /** How GitHub is reached; a test swaps it. */
  fetcher: Fetch = (input, init) => fetch(input, init) as never;
  /** The running build's deploy record; a test swaps it. */
  deployInfo: () => Promise<DeployInfo | null> = readDeployInfo;
  /** Waits between polls for a started run; a test swaps it. */
  wait: (ms: number) => Promise<unknown> = sleep;

  constructor(
    private readonly config: Config,
    private readonly models: Models,
    private readonly writer: DocWriter,
    private readonly ac: PermissionAccess,
    private readonly indexer: IndexerService
  ) {}

  // ── settings and token ───────────────────────────────────────────────────

  /** The workspace's release repo: its most recently set one. */
  async settingsRow(workspaceId: string): Promise<RegistryDeployRepo | null> {
    const rows = await this.models.registryJob.listDeployRepos(workspaceId);
    return newest(rows);
  }

  async settings(workspaceId: string): Promise<ReleaseSettings | null> {
    const row = await this.settingsRow(workspaceId);
    return row ? settingsOf(row) : null;
  }

  async setSettings(
    workspaceId: string,
    userId: string,
    body: Record<string, unknown>
  ): Promise<ReleaseSettings> {
    const repo = parseRepoName(body.repo);
    if (!repo) throw new BadRequest('repo must be owner/name');
    const baseBranch = parseBranchName(body.baseBranch);
    const deployBranch = parseBranchName(body.deployBranch);
    if (!baseBranch || !deployBranch) {
      throw new BadRequest(
        'baseBranch and deployBranch must both be branch names'
      );
    }
    const workflowFile =
      body.workflowFile === undefined || body.workflowFile === ''
        ? DEFAULT_WORKFLOW_FILE
        : typeof body.workflowFile === 'string'
          ? body.workflowFile.trim()
          : '';
    if (!WORKFLOW_FILE_RE.test(workflowFile)) {
      throw new BadRequest(
        'workflowFile must be a workflow file name, e.g. deploy-prod.yml'
      );
    }
    await this.models.registryJob.setDeployRepo(
      workspaceId,
      repo,
      { baseBranch, deployBranch, workflowFile },
      userId
    );
    this.invalidate(workspaceId);
    return { repo, baseBranch, deployBranch, workflowFile };
  }

  /** The workspace's GITHUB_TOKEN secret, else the server's, else none. */
  async token(workspaceId: string): Promise<Token | null> {
    const secret = await this.models.workspaceSecret
      .reveal(workspaceId, GITHUB_TOKEN_SECRET)
      .catch(() => null);
    if (secret?.trim()) return { value: secret.trim(), source: 'secret' };
    const env = this.config.registry.githubToken?.trim();
    if (env) return { value: env, source: 'env' };
    return null;
  }

  client(token: Token, settings: ReleaseSettings): GitHubClient {
    return new GitHubClient(token.value, settings.repo, this.fetcher);
  }

  /** Whether the token reaches the repo, its branches and its workflow. */
  async testToken(
    workspaceId: string
  ): Promise<{ ok: boolean; error: string | null }> {
    const [settings, token] = await Promise.all([
      this.settings(workspaceId),
      this.token(workspaceId),
    ]);
    if (!settings) return { ok: false, error: 'Set the repo first.' };
    if (!token) return { ok: false, error: noTokenMessage() };
    const github = this.client(token, settings);
    try {
      await github.repository();
      await github.branchSha(settings.baseBranch);
      await github.branchSha(settings.deployBranch);
      await github.runs(settings.workflowFile, 1);
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  // ── state ────────────────────────────────────────────────────────────────

  invalidate(workspaceId: string) {
    this.cache.delete(workspaceId);
  }

  /**
   * The release state, from the cache while it is fresh: a minute, or 15
   * seconds while a deploy runs. `fresh` reads GitHub regardless.
   */
  async state(
    workspaceId: string,
    options: { fresh?: boolean } = {}
  ): Promise<ReleaseState> {
    const cached = this.cache.get(workspaceId);
    if (!options.fresh && cached) {
      const ttl =
        cached.state.production.status === 'deploying'
          ? CACHE_DEPLOYING_MS
          : CACHE_MS;
      if (Date.now() - cached.at < ttl) return cached.state;
    }
    const pending = this.loading.get(workspaceId);
    if (pending) return pending;
    const load = this.load(workspaceId).finally(() =>
      this.loading.delete(workspaceId)
    );
    this.loading.set(workspaceId, load);
    return load;
  }

  private async load(workspaceId: string): Promise<ReleaseState> {
    const [row, token, deployInfo] = await Promise.all([
      this.settingsRow(workspaceId),
      this.token(workspaceId),
      this.deployInfo().catch(() => null),
    ]);
    const settings = row ? settingsOf(row) : null;
    const state = emptyState(settings, token, deployInfo);
    if (!settings) return this.keep(workspaceId, state);
    if (!token) {
      state.error = noTokenMessage();
      return this.keep(workspaceId, state);
    }
    try {
      const closed = await this.read(
        this.client(token, settings),
        settings,
        state
      );
      state.tasks = await this.taskMap(workspaceId, settings, [
        ...state.open,
        ...closed,
      ]);
    } catch (err) {
      if (!(err instanceof GitHubError)) throw err;
      state.error = err.message;
    }
    state.fetchedAt = new Date().toISOString();
    return this.keep(workspaceId, state);
  }

  private keep(workspaceId: string, state: ReleaseState) {
    this.cache.set(workspaceId, { state, at: Date.now() });
    return state;
  }

  /**
   * Fill `state` from GitHub. Returns the merged pull requests read, for
   * their tasks.
   */
  private async read(
    github: GitHubClient,
    settings: ReleaseSettings,
    state: ReleaseState
  ): Promise<PullKey[]> {
    const [mainSha, stageSha, runs, open, closed] = await Promise.all([
      github.branchSha(settings.deployBranch),
      github.branchSha(settings.baseBranch),
      github.runs(settings.workflowFile, HISTORY_RUNS),
      github.listPulls(settings.baseBranch, 'open'),
      github.listPulls(settings.baseBranch, 'closed', CLOSED_PULLS),
    ]);
    const production = state.production;
    production.mainSha = mainSha;
    production.stageSha = stageSha;

    const merged = new Map<number, GhPull>();
    for (const pull of closed) {
      if (pull.merged_at) {
        merged.set(pull.number, pull);
        this.mergedPulls.set(`${settings.repo}#${pull.number}`, pull);
      }
    }

    const [compare, openPulls, ranges] = await Promise.all([
      mainSha === stageSha
        ? Promise.resolve({ ahead_by: 0, behind_by: 0, commits: [] })
        : github.compare(mainSha, stageSha),
      Promise.all(open.map(pull => this.openPull(github, pull))),
      runRanges(
        runs,
        async (base, head) =>
          firstParentMerges((await github.compare(base, head)).commits, head),
        this.ranges
      ),
    ]);
    production.diverged = compare.behind_by > 0;
    await this.hydrate(
      github,
      settings,
      firstParentMerges(compare.commits, stageSha),
      merged
    );
    state.next = nextRelease(compare, stageSha, merged);
    state.open = openPulls;
    state.history = runs.map(run => toRun(run, ranges.get(run.id) ?? []));

    const current = productionRun(runs);
    production.status = productionStatus(runs);
    production.run = current
      ? (state.history.find(run => run.id === current.id) ?? null)
      : null;
    if (current) {
      production.steps = runSteps(await github.jobs(current.id));
    }
    return [...merged.values()].map(pull => ({
      number: pull.number,
      branch: pull.head.ref,
    }));
  }

  /** Merged pull requests a range names that the closed list didn't hold. */
  private async hydrate(
    github: GitHubClient,
    settings: ReleaseSettings,
    numbers: number[],
    merged: Map<number, GhPull>
  ) {
    await Promise.all(
      numbers
        .filter(number => !merged.has(number))
        .map(async number => {
          const key = `${settings.repo}#${number}`;
          let pull = this.mergedPulls.get(key);
          if (!pull) {
            pull = await github.pull(number).catch(() => undefined);
            if (pull?.merged_at) this.mergedPulls.set(key, pull);
          }
          if (pull) merged.set(number, pull);
        })
    );
  }

  /**
   * An open pull request with its merge state and checks, read again only
   * when its head moved or GitHub hadn't settled them.
   */
  private async openPull(
    github: GitHubClient,
    pull: GhPull,
    fresh = false
  ): Promise<Pull> {
    const key = `${github.repo}#${pull.number}:${pull.head.sha}`;
    let detail = fresh ? undefined : this.pullDetails.get(key);
    if (!detail) {
      const [full, runs, status] = await Promise.all([
        github.pull(pull.number),
        github.checkRuns(pull.head.sha),
        github.combinedStatus(pull.head.sha).catch(() => null),
      ]);
      detail = {
        headSha: full.head.sha,
        mergeableState: full.mergeable_state ?? 'unknown',
        checks: checksState(runs, status),
      };
      if (detail.mergeableState !== 'unknown' && detail.checks !== 'pending') {
        this.pullDetails.set(key, detail);
      }
    }
    return toPull(
      { ...pull, head: { ...pull.head, sha: detail.headSha } },
      detail.checks,
      { mergeable_state: detail.mergeableState }
    );
  }

  // ── linked tasks ─────────────────────────────────────────────────────────

  /**
   * The tasks on their way out (in progress, COMMITTED, MERGED, DEPLOYED) in
   * the workspace's index, read from their notes for the pull requests they
   * name. Each note is read once.
   */
  async linkedTasks(
    workspaceId: string,
    settings: ReleaseSettings,
    pulls: PullKey[]
  ): Promise<{ docId: string; links: TaskLink[] }[]> {
    const result = await this.indexer.search({
      table: SearchTable.block,
      query: {
        type: SearchQueryType.boolean,
        occur: SearchQueryOccur.must,
        queries: [
          {
            type: SearchQueryType.match,
            field: 'workspaceId',
            match: workspaceId,
          },
          {
            type: SearchQueryType.boolean,
            occur: SearchQueryOccur.should,
            queries: SHIPPING_STATUSES.map(status => ({
              type: SearchQueryType.match,
              field: 'orgStatus',
              match: status,
            })),
          },
        ],
      },
      options: {
        fields: ['docId', 'blockId', 'content', 'orgStatus'],
        pagination: { limit: 500 },
      },
    });
    const byDoc = new Map<string, string[]>();
    for (const node of result.nodes) {
      const docId = first(node.fields.docId);
      const blockId = first(node.fields.blockId);
      if (!docId || !blockId) continue;
      byDoc.set(docId, [...(byDoc.get(docId) ?? []), blockId]);
    }
    const docs = await Promise.all(
      [...byDoc].map(async ([docId, blockIds]) => {
        try {
          const binary = await this.writer.readDocBinary(workspaceId, docId);
          if (!binary) return null;
          const links = readTaskLinks(binary, blockIds, settings.repo, pulls);
          return links.length ? { docId, links } : null;
        } catch (err) {
          this.logger.warn(
            `releases: couldn't read tasks in ${docId}: ${(err as Error).message}`
          );
          return null;
        }
      })
    );
    return docs.filter(doc => !!doc);
  }

  private async taskMap(
    workspaceId: string,
    settings: ReleaseSettings,
    pulls: PullKey[]
  ): Promise<Record<number, LinkedTask[]>> {
    const docs = await this.linkedTasks(workspaceId, settings, pulls);
    const tasks: Record<number, LinkedTask[]> = {};
    for (const { docId, links } of docs) {
      for (const link of links) {
        for (const number of link.prs) {
          (tasks[number] ??= []).push({
            docId,
            blockId: link.blockId,
            title: link.title,
            status: link.status,
          });
        }
      }
    }
    return tasks;
  }

  /**
   * Move the tasks naming any of `numbers` on, as `row.updatedBy` (who set
   * the repo up) where they may write the note. Returns the blocks moved.
   */
  private async moveLinkedTasks(
    row: RegistryDeployRepo,
    numbers: number[],
    pulls: PullKey[],
    edit: (binary: Uint8Array, blockIds: string[]) => {
      update: Uint8Array | null;
      changed: string[];
    }
  ): Promise<string[]> {
    if (!numbers.length) return [];
    const editor = row.updatedBy;
    if (!editor) {
      this.logger.warn(
        `releases: ${row.repo} in ${row.workspaceId} has no owner to write tasks as`
      );
      return [];
    }
    const wanted = new Set(numbers);
    const docs = await this.linkedTasks(
      row.workspaceId,
      settingsOf(row),
      pulls
    );
    const moved: string[] = [];
    for (const { docId, links } of docs) {
      const ids = links
        .filter(link => link.prs.some(number => wanted.has(number)))
        .map(link => link.blockId);
      if (!ids.length) continue;
      try {
        const allowed = await this.ac
          .user(editor)
          .workspace(row.workspaceId)
          .doc(docId)
          .can('Doc.Update');
        if (!allowed) continue;
        const { changed } = await this.writer.editDoc(
          row.workspaceId,
          docId,
          binary => edit(binary, ids),
          editor
        );
        moved.push(...changed);
      } catch (err) {
        this.logger.warn(
          `releases: couldn't move tasks in ${docId}: ${(err as Error).message}`
        );
      }
    }
    return moved;
  }

  // ── sync (the cron) ──────────────────────────────────────────────────────

  /**
   * One minute's sync of a workspace's release repo: refresh the cached
   * state while a deploy runs (the screen's poll then never reaches GitHub);
   * move the tasks of pull requests a finished deploy took live to DEPLOYED;
   * move those of pull requests merged since the last sync to MERGED. The
   * watermarks (`syncedRunId`, `syncedMergedAt`) start at the first sync,
   * so tasks of what shipped before releases were set up are left alone.
   */
  async syncRepo(row: RegistryDeployRepo): Promise<void> {
    const token = await this.token(row.workspaceId);
    if (!token) return;
    const settings = settingsOf(row);
    const github = this.client(token, settings);
    const runs = await github.runs(settings.workflowFile, 10);
    if (runs.some(isActive)) {
      await this.state(row.workspaceId, { fresh: true });
    }
    await this.syncDeploys(row, github, runs);
    await this.syncMerges(row, github);
  }

  private async syncDeploys(
    row: RegistryDeployRepo,
    github: GitHubClient,
    runs: GhRun[]
  ) {
    // The watermark only passes runs that ended with none older still going.
    const oldestActive = Math.min(
      ...runs.filter(isActive).map(run => run.id),
      Number.POSITIVE_INFINITY
    );
    const ended = runs.filter(
      run => !isActive(run) && run.id < oldestActive
    );
    if (!ended.length) return;
    const newest = Math.max(...ended.map(run => run.id));
    if (row.syncedRunId === null) {
      await this.models.registryJob.setDeploySynced(row.workspaceId, row.repo, {
        syncedRunId: BigInt(newest),
      });
      return;
    }
    const since = Number(row.syncedRunId);
    const toSync = ended
      .filter(
        run =>
          run.id > since &&
          run.conclusion === 'success' &&
          !labelRun(run).rollbackTo
      )
      .sort((a, b) => a.id - b.id);
    if (toSync.length) {
      const ranges = await runRanges(
        runs,
        async (base, head) =>
          firstParentMerges((await github.compare(base, head)).commits, head),
        this.ranges
      );
      const pulls = await github
        .listPulls(row.baseBranch, 'closed', CLOSED_PULLS)
        .catch(() => [] as GhPull[]);
      const keys = pulls.map(pull => ({
        number: pull.number,
        branch: pull.head.ref,
      }));
      for (const run of toSync) {
        const moved = await this.moveLinkedTasks(
          row,
          ranges.get(run.id) ?? [],
          keys,
          (binary, ids) =>
            deployTasks(
              binary,
              ids,
              run.head_sha,
              new Date(run.updated_at || Date.now())
            )
        );
        if (moved.length) {
          this.logger.log(
            `releases: run ${run.id} deployed ${moved.length} task(s) in ${row.workspaceId}`
          );
        }
      }
    }
    if (newest > since) {
      await this.models.registryJob.setDeploySynced(row.workspaceId, row.repo, {
        syncedRunId: BigInt(newest),
      });
      this.invalidate(row.workspaceId);
    }
  }

  private async syncMerges(row: RegistryDeployRepo, github: GitHubClient) {
    if (row.syncedMergedAt === null) {
      await this.models.registryJob.setDeploySynced(row.workspaceId, row.repo, {
        syncedMergedAt: new Date(),
      });
      return;
    }
    const since = row.syncedMergedAt.getTime();
    const pulls = await github.listPulls(
      row.baseBranch,
      'closed',
      CLOSED_PULLS
    );
    const merged = pulls.filter(
      pull => pull.merged_at && Date.parse(pull.merged_at) > since
    );
    if (!merged.length) return;
    const moved = await this.moveLinkedTasks(
      row,
      merged.map(pull => pull.number),
      pulls.map(pull => ({ number: pull.number, branch: pull.head.ref })),
      mergeTasks
    );
    if (moved.length) {
      this.logger.log(
        `releases: ${moved.length} task(s) merged in ${row.workspaceId}`
      );
    }
    const newest = Math.max(...merged.map(pull => Date.parse(pull.merged_at!)));
    await this.models.registryJob.setDeploySynced(row.workspaceId, row.repo, {
      syncedMergedAt: new Date(newest),
    });
    this.invalidate(row.workspaceId);
  }

  // ── actions ──────────────────────────────────────────────────────────────

  private async ready(workspaceId: string) {
    const row = await this.settingsRow(workspaceId);
    if (!row) throw new BadRequest('Set the repo up for releases first.');
    const token = await this.token(workspaceId);
    if (!token) throw new BadRequest(noTokenMessage());
    const settings = settingsOf(row);
    return { row, settings, github: this.client(token, settings) };
  }

  /** Run a GitHub action, mapping its failure to the screen's HTTP error. */
  private async act<T>(workspaceId: string, run: () => Promise<T>) {
    try {
      return await run();
    } catch (err) {
      throw httpError(err);
    } finally {
      this.invalidate(workspaceId);
    }
  }

  /**
   * Merge an open pull request into the base branch with a merge commit,
   * only if its head is still `headSha`, then delete its branch (never the
   * base or deploy branch, nor a fork's).
   */
  async merge(workspaceId: string, body: Record<string, unknown>) {
    const number = Number(body.number);
    const headSha = typeof body.headSha === 'string' ? body.headSha : '';
    if (!Number.isInteger(number) || number <= 0 || !headSha) {
      throw new BadRequest('number and headSha are required');
    }
    const { row, settings, github } = await this.ready(workspaceId);
    const result = await this.act(workspaceId, async () => {
      const pull = await github.pull(number);
      if (pull.state !== 'open') {
        throw conflict(`#${number} is not open any more`);
      }
      if (pull.base.ref !== settings.baseBranch) {
        throw new BadRequest(
          `#${number} goes into ${pull.base.ref}, not ${settings.baseBranch}`
        );
      }
      if (pull.head.sha !== headSha) {
        throw conflict(
          `#${number} has new commits since the screen read it; look again`
        );
      }
      return this.mergeOne(row, settings, github, pull);
    });
    return { ...result, state: await this.state(workspaceId, { fresh: true }) };
  }

  private async mergeOne(
    row: RegistryDeployRepo,
    settings: ReleaseSettings,
    github: GitHubClient,
    pull: GhPull
  ): Promise<{ merged: boolean; sha: string | null }> {
    const result = await github.merge(pull.number, pull.head.sha);
    const ownBranch =
      !pull.head.repo || pull.head.repo.full_name === settings.repo;
    if (
      ownBranch &&
      pull.head.ref !== settings.baseBranch &&
      pull.head.ref !== settings.deployBranch
    ) {
      await github.deleteBranch(pull.head.ref).catch(err => {
        this.logger.warn(
          `releases: merged #${pull.number}, couldn't delete ${pull.head.ref}: ${(err as Error).message}`
        );
      });
    }
    // Its tasks move now rather than at the next sync.
    await this.syncMerges(
      (await this.settingsRow(row.workspaceId)) ?? row,
      github
    ).catch(err =>
      this.logger.warn(`releases: merge sync: ${(err as Error).message}`)
    );
    return { merged: !!result?.merged, sha: result?.sha ?? null };
  }

  /**
   * Merge each of `numbers` that is ready, oldest first, reading each again
   * first; the others are skipped, with why.
   */
  async mergeAll(workspaceId: string, body: Record<string, unknown>) {
    const numbers = Array.isArray(body.numbers)
      ? [...new Set(body.numbers.map(Number))].filter(
          n => Number.isInteger(n) && n > 0
        )
      : [];
    if (!numbers.length) throw new BadRequest('numbers is required');
    const { row, settings, github } = await this.ready(workspaceId);
    const merged: number[] = [];
    const skipped: { number: number; why: string }[] = [];
    await this.act(workspaceId, async () => {
      for (const number of numbers.sort((a, b) => a - b)) {
        try {
          const pull = await github.pull(number);
          if (pull.state !== 'open') {
            skipped.push({ number, why: 'not open' });
            continue;
          }
          if (pull.base.ref !== settings.baseBranch) {
            skipped.push({ number, why: `goes into ${pull.base.ref}` });
            continue;
          }
          const ready = await this.openPull(github, pull, true);
          // Failing checks don't hold a merge up: this repo's CI fails on
          // things a change didn't touch. Drafts, conflicts and checks
          // still running do.
          if (!MERGE_ALL_READINESS.has(ready.readiness)) {
            skipped.push({ number, why: ready.readiness });
            continue;
          }
          const result = await this.mergeOne(row, settings, github, pull);
          if (result.merged) merged.push(number);
          else skipped.push({ number, why: 'GitHub did not merge it' });
        } catch (err) {
          if (err instanceof GitHubError && err.code === 'rate-limited') {
            throw err;
          }
          skipped.push({ number, why: (err as Error).message });
        }
      }
    });
    return {
      merged,
      skipped,
      state: await this.state(workspaceId, { fresh: true }),
    };
  }

  /**
   * Release the base branch: fast-forward the deploy branch to `sha` (what
   * the screen showed as stage) and start the deploy workflow on it.
   * Refused when stage moved since, when the deploy branch has commits stage
   * lacks, or while a deploy runs.
   */
  async release(workspaceId: string, body: Record<string, unknown>) {
    const sha = typeof body.sha === 'string' ? body.sha.trim() : '';
    if (!SHA_RE.test(sha)) throw new BadRequest('sha must be a full commit sha');
    const { settings, github } = await this.ready(workspaceId);
    const run = await this.act(workspaceId, async () => {
      const [stageSha, mainSha, runs] = await Promise.all([
        github.branchSha(settings.baseBranch),
        github.branchSha(settings.deployBranch),
        github.runs(settings.workflowFile, 5),
      ]);
      if (stageSha !== sha) {
        throw conflict(
          `${settings.baseBranch} moved to ${stageSha.slice(0, 7)} since the screen read it; look again`
        );
      }
      if (runs.some(isActive)) {
        throw conflict('A deploy is running; wait for it to end');
      }
      if (mainSha !== sha) {
        const compare = await github.compare(mainSha, sha);
        if (compare.behind_by > 0) {
          throw conflict(
            `${settings.deployBranch} has ${compare.behind_by} commit(s) ${settings.baseBranch} lacks; merge ${settings.deployBranch} into ${settings.baseBranch} first`
          );
        }
        await github.fastForward(settings.deployBranch, sha);
      }
      return this.dispatchAndFind(github, settings, run => run.head_sha === sha);
    });
    return { run, state: await this.state(workspaceId, { fresh: true }) };
  }

  /** Deploy the deploy branch again as it is (a rebuild of what's live). */
  async redeploy(workspaceId: string) {
    const { settings, github } = await this.ready(workspaceId);
    const run = await this.act(workspaceId, async () => {
      const [mainSha, runs] = await Promise.all([
        github.branchSha(settings.deployBranch),
        github.runs(settings.workflowFile, 5),
      ]);
      if (runs.some(isActive)) {
        throw conflict('A deploy is running; wait for it to end');
      }
      return this.dispatchAndFind(
        github,
        settings,
        run => run.head_sha === mainSha && !labelRun(run).rollbackTo
      );
    });
    return { run, state: await this.state(workspaceId, { fresh: true }) };
  }

  /**
   * Roll prod back to the image of an earlier release, without a rebuild:
   * `imageSha` must be what a successful run in the history deployed.
   */
  async rollback(workspaceId: string, body: Record<string, unknown>) {
    const imageSha =
      typeof body.imageSha === 'string' ? body.imageSha.trim() : '';
    if (!SHA_RE.test(imageSha)) {
      throw new BadRequest('imageSha must be a full commit sha');
    }
    const { settings, github } = await this.ready(workspaceId);
    const run = await this.act(workspaceId, async () => {
      const runs = await github.runs(settings.workflowFile, HISTORY_RUNS);
      if (runs.some(isActive)) {
        throw conflict('A deploy is running; wait for it to end');
      }
      const known = runs.some(
        run =>
          run.status === 'completed' &&
          run.conclusion === 'success' &&
          (labelRun(run).rollbackTo ?? run.head_sha) === imageSha
      );
      if (!known) {
        throw new BadRequest(
          `No successful deploy of ${imageSha.slice(0, 7)} in the history to roll back to`
        );
      }
      return this.dispatchAndFind(
        github,
        settings,
        run => labelRun(run).rollbackTo === imageSha,
        { image_sha: imageSha }
      );
    });
    return { run, state: await this.state(workspaceId, { fresh: true }) };
  }

  /** Re-run the failed jobs of a run in the history. */
  async retry(workspaceId: string, body: Record<string, unknown>) {
    const runId = Number(body.runId);
    if (!Number.isSafeInteger(runId) || runId <= 0) {
      throw new BadRequest('runId is required');
    }
    const { settings, github } = await this.ready(workspaceId);
    await this.act(workspaceId, async () => {
      const runs = await github.runs(settings.workflowFile, HISTORY_RUNS);
      const run = runs.find(candidate => candidate.id === runId);
      if (!run) throw new BadRequest(`Run ${runId} is not in the history`);
      if (isActive(run) || run.conclusion === 'success') {
        throw conflict(`Run ${runId} has nothing to retry`);
      }
      if (runs.some(isActive)) {
        throw conflict('A deploy is running; wait for it to end');
      }
      await github.rerunFailed(runId);
    });
    return { state: await this.state(workspaceId, { fresh: true }) };
  }

  /**
   * Start the workflow on the deploy branch and find the run it made:
   * GitHub's dispatch returns none, so the newest run created since that
   * `matches` is it, looked for up to 20 seconds. Null if it hasn't shown.
   */
  private async dispatchAndFind(
    github: GitHubClient,
    settings: ReleaseSettings,
    matches: (run: GhRun) => boolean,
    inputs?: Record<string, string>
  ): Promise<Run | null> {
    const started = Date.now();
    await github.dispatch(settings.workflowFile, settings.deployBranch, inputs);
    while (Date.now() - started < RUN_WAIT_MS) {
      await this.wait(RUN_POLL_MS);
      const runs = await github.runs(settings.workflowFile, 5);
      const run = runs.find(
        candidate =>
          Date.parse(candidate.created_at) >= started - SKEW_MS &&
          matches(candidate)
      );
      if (run) return toRun(run);
    }
    return null;
  }
}

function newest(rows: RegistryDeployRepo[]): RegistryDeployRepo | null {
  let best: RegistryDeployRepo | null = null;
  for (const row of rows) {
    if (!best || row.updatedAt.getTime() > best.updatedAt.getTime()) {
      best = row;
    }
  }
  return best;
}

const first = (value: unknown): string =>
  Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');

export const noTokenMessage = () =>
  "GitHub can't be reached. Add a GITHUB_TOKEN secret (Contents, Actions, Pull requests: read and write) on the Secrets page.";

function emptyState(
  settings: ReleaseSettings | null,
  token: Token | null,
  deployInfo: DeployInfo | null
): ReleaseState {
  return {
    settings,
    token: { source: token?.source ?? null },
    production: {
      deployInfo,
      run: null,
      status: 'unknown',
      steps: [],
      mainSha: null,
      stageSha: null,
      diverged: false,
    },
    next: { sha: null, commits: 0, prs: [] },
    open: [],
    history: [],
    tasks: {},
    fetchedAt: new Date().toISOString(),
    error: null,
  };
}
