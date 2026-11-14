/**
 * The GitHub REST calls the Deployments screen's releases make, on plain
 * `fetch` (as push.ts talks to FCM): no SDK, so the server image carries
 * nothing new. Every failure is a {@link GitHubError} whose `code` says what
 * the screen can do about it.
 */

const API = 'https://api.github.com';

export type GitHubErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'not-mergeable'
  | 'conflict'
  | 'not-fast-forward'
  | 'rate-limited'
  | 'invalid'
  | 'unavailable';

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    readonly code: GitHubErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

/** What a call is, where the same status means different things. */
export type GitHubOp = 'merge' | 'fast-forward' | 'other';

interface HeaderBag {
  get(name: string): string | null;
}

/** The error code for a failed response; see the table in the plan. */
export function gitHubErrorCode(
  status: number,
  headers: HeaderBag,
  op: GitHubOp = 'other'
): GitHubErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status === 403) {
    return headers.get('x-ratelimit-remaining') === '0'
      ? 'rate-limited'
      : 'forbidden';
  }
  if (status === 404) return 'not-found';
  if (status === 405 && op === 'merge') return 'not-mergeable';
  if (status === 409) return 'conflict';
  if (status === 422 && op === 'fast-forward') return 'not-fast-forward';
  if (status >= 500) return 'unavailable';
  return 'invalid';
}

function errorMessage(
  code: GitHubErrorCode,
  status: number,
  headers: HeaderBag,
  detail: string,
  what: string
): string {
  const said = detail ? `: ${detail}` : '';
  switch (code) {
    case 'unauthorized':
      return `GitHub refused the token (401); it is wrong or expired${said}`;
    case 'forbidden': {
      // GitHub names the permission a fine-grained token lacks.
      const needs = headers.get('x-accepted-github-permissions');
      return `The GitHub token may not ${what}${
        needs ? ` (it needs ${needs})` : ''
      }${said}`;
    }
    case 'not-found':
      return `GitHub has no ${what}, or the token can't see it (a fine-grained token needs access to the repo)${said}`;
    case 'rate-limited': {
      const reset = Number(headers.get('x-ratelimit-reset'));
      return `GitHub's rate limit is used up${
        reset ? `; it resets at ${new Date(reset * 1000).toISOString()}` : ''
      }`;
    }
    case 'not-mergeable':
      return `GitHub won't merge it${said}`;
    case 'conflict':
      return `GitHub reports a conflict${said}`;
    case 'not-fast-forward':
      return `It isn't a fast-forward${said}`;
    case 'unavailable':
      return `GitHub failed (${status})${said}`;
    default:
      return `GitHub refused to ${what} (${status})${said}`;
  }
}

// ── what GitHub returns (the fields read) ──────────────────────────────────

export interface GhUser {
  login: string;
}

export interface GhPull {
  number: number;
  title: string;
  html_url: string;
  state: 'open' | 'closed';
  draft?: boolean;
  user: GhUser | null;
  head: { ref: string; sha: string; repo?: { full_name: string } | null };
  base: { ref: string };
  merged_at: string | null;
  /** Only on a single pull's GET. */
  mergeable_state?: string;
  mergeable?: boolean | null;
  merge_commit_sha?: string | null;
}

export interface GhCommit {
  sha: string;
  commit: { message: string };
  parents: { sha: string }[];
}

export interface GhCompare {
  status: string;
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  commits: GhCommit[];
  /** The files changed (up to 300). */
  files?: { filename: string; previous_filename?: string }[];
}

export interface GhRelease {
  tag_name: string;
  /** The commit (or branch) the tag was made on. */
  target_commitish: string;
  draft: boolean;
  prerelease: boolean;
  created_at: string;
  published_at: string | null;
  html_url: string;
}

export interface GhCheckRun {
  status: string;
  conclusion: string | null;
}

export interface GhCombinedStatus {
  state: string;
  statuses: { state: string }[];
}

export interface GhRun {
  id: number;
  html_url: string;
  head_sha: string;
  head_branch: string | null;
  display_title?: string;
  status: string | null;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  run_attempt?: number;
}

export interface GhStep {
  name: string;
  status: string;
  conclusion: string | null;
  number: number;
}

export interface GhJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  steps?: GhStep[];
}

export type Fetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }
) => Promise<{
  ok: boolean;
  status: number;
  headers: HeaderBag;
  text(): Promise<string>;
}>;

const segment = (value: string) => encodeURIComponent(value);
/** A branch in a ref path keeps its slashes: refs/heads/release/2026. */
const branchPath = (branch: string) => branch.split('/').map(segment).join('/');

/** One repo's GitHub, as a token sees it. */
export class GitHubClient {
  private readonly base: string;

  constructor(
    private readonly token: string,
    readonly repo: string,
    private readonly fetcher: Fetch = (input, init) =>
      fetch(input, init) as never
  ) {
    const [owner, name] = repo.split('/');
    this.base = `${API}/repos/${segment(owner)}/${segment(name)}`;
  }

  private async request<T>(
    method: string,
    path: string,
    what: string,
    options: { body?: unknown; op?: GitHubOp } = {}
  ): Promise<T> {
    let response: Awaited<ReturnType<Fetch>>;
    try {
      response = await this.fetcher(`${this.base}${path}`, {
        method,
        headers: {
          accept: 'application/vnd.github+json',
          authorization: `Bearer ${this.token}`,
          'x-github-api-version': '2022-11-28',
          'user-agent': 'notesgraph-releases',
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (err) {
      throw new GitHubError(
        0,
        'unavailable',
        `GitHub can't be reached: ${(err as Error).message}`
      );
    }
    const text = await response.text();
    if (!response.ok) {
      const code = gitHubErrorCode(
        response.status,
        response.headers,
        options.op
      );
      let detail = '';
      try {
        detail = String(JSON.parse(text)?.message ?? '');
      } catch {
        detail = text.slice(0, 200);
      }
      throw new GitHubError(
        response.status,
        code,
        errorMessage(code, response.status, response.headers, detail, what)
      );
    }
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return undefined as T;
    }
  }

  /** The repo itself: what a token test reads. */
  repository() {
    return this.request<{ full_name: string; default_branch: string }>(
      'GET',
      '',
      `repo ${this.repo}`
    );
  }

  /** The commit a branch is at. */
  async branchSha(branch: string): Promise<string> {
    const ref = await this.request<{ object: { sha: string } }>(
      'GET',
      `/git/ref/heads/${branchPath(branch)}`,
      `branch ${branch}`
    );
    return ref.object.sha;
  }

  /** `base...head`: up to 250 commits, oldest first. */
  compare(base: string, head: string) {
    return this.request<GhCompare>(
      'GET',
      `/compare/${segment(base)}...${segment(head)}?per_page=250`,
      `comparison ${base}...${head}`
    );
  }

  /** Pull requests into `base`, most recently updated first. */
  listPulls(base: string, state: 'open' | 'closed', perPage = 50) {
    return this.request<GhPull[]>(
      'GET',
      `/pulls?base=${segment(base)}&state=${state}&sort=updated&direction=desc&per_page=${perPage}`,
      `pull requests into ${base}`
    );
  }

  pull(number: number) {
    return this.request<GhPull>(
      'GET',
      `/pulls/${number}`,
      `pull request #${number}`
    );
  }

  async checkRuns(ref: string): Promise<GhCheckRun[]> {
    const result = await this.request<{ check_runs: GhCheckRun[] }>(
      'GET',
      `/commits/${segment(ref)}/check-runs?per_page=100`,
      `checks of ${ref}`
    );
    return result?.check_runs ?? [];
  }

  combinedStatus(ref: string) {
    return this.request<GhCombinedStatus>(
      'GET',
      `/commits/${segment(ref)}/status`,
      `status of ${ref}`
    );
  }

  /** Merge with a merge commit, only if the head is still `sha`. */
  merge(number: number, sha: string) {
    return this.request<{ sha: string; merged: boolean; message?: string }>(
      'PUT',
      `/pulls/${number}/merge`,
      `merge pull request #${number}`,
      { body: { merge_method: 'merge', sha }, op: 'merge' }
    );
  }

  async deleteBranch(branch: string): Promise<void> {
    try {
      await this.request<void>(
        'DELETE',
        `/git/refs/heads/${branchPath(branch)}`,
        `delete branch ${branch}`
      );
    } catch (err) {
      // Already gone (GitHub's own auto-delete, or someone else): fine.
      if (
        err instanceof GitHubError &&
        (err.status === 422 || err.status === 404)
      ) {
        return;
      }
      throw err;
    }
  }

  /** Move `branch` to `sha`, refusing anything but a fast-forward. */
  async fastForward(branch: string, sha: string): Promise<void> {
    await this.request<void>(
      'PATCH',
      `/git/refs/heads/${branchPath(branch)}`,
      `move ${branch} to ${sha.slice(0, 7)}`,
      { body: { sha, force: false }, op: 'fast-forward' }
    );
  }

  /** Start a workflow on `ref`; GitHub answers 204 and no run id. */
  async dispatch(
    file: string,
    ref: string,
    inputs?: Record<string, string>
  ): Promise<void> {
    await this.request<void>(
      'POST',
      `/actions/workflows/${segment(file)}/dispatches`,
      `start ${file}`,
      { body: inputs ? { ref, inputs } : { ref } }
    );
  }

  /** The workflow's runs, newest first. */
  async runs(file: string, perPage = 15): Promise<GhRun[]> {
    const result = await this.request<{ workflow_runs: GhRun[] }>(
      'GET',
      `/actions/workflows/${segment(file)}/runs?per_page=${perPage}`,
      `runs of ${file}`
    );
    return result?.workflow_runs ?? [];
  }

  async jobs(runId: number): Promise<GhJob[]> {
    const result = await this.request<{ jobs: GhJob[] }>(
      'GET',
      `/actions/runs/${runId}/jobs`,
      `jobs of run ${runId}`
    );
    return result?.jobs ?? [];
  }

  /** The repo's releases, newest first. */
  async releases(perPage = 30): Promise<GhRelease[]> {
    const result = await this.request<GhRelease[]>(
      'GET',
      `/releases?per_page=${perPage}`,
      'releases'
    );
    return result ?? [];
  }

  async rerunFailed(runId: number): Promise<void> {
    await this.request<void>(
      'POST',
      `/actions/runs/${runId}/rerun-failed-jobs`,
      `re-run run ${runId}`
    );
  }
}
