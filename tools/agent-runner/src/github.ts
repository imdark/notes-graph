/**
 * The cloud runner's answer to the Deployments screen. A Mac runs the
 * screen's `gh` shell commands as they come; the cloud runner runs no shell
 * from a job, so the screen sends it a request instead (list, merge, check,
 * delete) and it runs `gh` itself, with arguments it builds, printing what
 * the shell commands would have printed (see services/deployments.ts).
 */
import { execFile } from 'node:child_process';

import type { Job } from './api';

/** Deployments requests carry this agent id, then the op. */
const GITHUB_AGENT_PREFIX = 'github:';

export const isGitHubRequest = (job: Job) =>
  job.model === 'command' && !!job.agentId?.startsWith(GITHUB_AGENT_PREFIX);

export interface PullRef {
  repo: string;
  number: number;
}

export type GitHubRequest =
  | { op: 'list'; repos: string[] }
  | { op: 'merge'; repo: string; number: number }
  | { op: 'check'; prs: PullRef[] }
  | { op: 'delete'; prs: PullRef[] }
  | { op: 'runs'; repo: string };

/** Runs `gh` with these arguments and returns its stdout; throws with stderr. */
export type Gh = (args: string[]) => Promise<string>;

export const ghCli =
  (token?: string): Gh =>
  args =>
    new Promise((resolve, reject) => {
      execFile(
        'gh',
        args,
        {
          env: { ...process.env, ...(token ? { GH_TOKEN: token } : {}) },
          maxBuffer: 16 * 1024 * 1024,
          timeout: 60_000,
        },
        (err, stdout, stderr) => {
          if (err) reject(new Error(String(stderr).trim() || err.message));
          else resolve(String(stdout));
        }
      );
    });

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const MAX_PULLS = 100;

const repoName = (value: unknown): string => {
  const repo = String(value ?? '');
  if (!REPO_RE.test(repo)) throw new Error(`Not a GitHub repo: ${repo}`);
  return repo;
};

const pullNumber = (value: unknown): number => {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`Not a pull request number: ${value}`);
  return n;
};

const pullRefs = (value: unknown): PullRef[] => {
  if (!Array.isArray(value) || value.length > MAX_PULLS) {
    throw new Error(`Expected up to ${MAX_PULLS} pull requests`);
  }
  return value.map(pr => ({
    repo: repoName(pr?.repo),
    number: pullNumber(pr?.number),
  }));
};

/** `owner/repo` of a repo URL such as RUNNER_REPO. */
export const repoFromUrl = (url?: string): string | null =>
  /github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1] ??
  null;

/** The job's instructions as a request; throws on anything else. */
export function parseGitHubRequest(job: Job): GitHubRequest {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(job.instructions);
  } catch {
    throw new Error("A Deployments request is JSON; this one isn't.");
  }
  switch (raw?.op) {
    case 'list':
      return {
        op: 'list',
        repos: Array.isArray(raw.repos)
          ? raw.repos.slice(0, MAX_PULLS).map(repoName)
          : [],
      };
    case 'merge':
      return {
        op: 'merge',
        repo: repoName(raw.repo),
        number: pullNumber(raw.number),
      };
    case 'check':
    case 'delete':
      return { op: raw.op, prs: pullRefs(raw.prs) };
    case 'runs':
      return { op: 'runs', repo: repoName(raw.repo) };
    default:
      throw new Error(`Unknown Deployments request: ${String(raw?.op)}`);
  }
}

// The same fields and jq as pullRequestsCommand.
const OPEN_FIELDS =
  'number,title,url,headRefName,author,state,isDraft,mergeable,statusCheckRollup';
const MERGED_FIELDS = 'number,title,url,headRefName,author,state,mergedAt';
const MERGED_LIMIT = '15';

/** Branches never deleted, merged or not (as KEPT_BRANCHES in the app). */
const KEPT_BRANCHES = new Set([
  'main',
  'master',
  'canary',
  'develop',
  'stable',
]);

interface PullState {
  state: string;
  branch: string;
}

async function pullState(gh: Gh, pr: PullRef): Promise<PullState | null> {
  try {
    const raw = JSON.parse(
      await gh([
        'pr',
        'view',
        String(pr.number),
        '-R',
        pr.repo,
        '--json',
        'state,headRefName',
      ])
    );
    return {
      state: String(raw.state ?? ''),
      branch: String(raw.headRefName ?? ''),
    };
  } catch {
    return null;
  }
}

/** A branch name as a URL path, its slashes kept. */
const branchPath = (branch: string) =>
  branch.split('/').map(encodeURIComponent).join('/');

const branchExists = (gh: Gh, repo: string, branch: string) =>
  gh(['api', `repos/${repo}/branches/${branchPath(branch)}`, '--silent']).then(
    () => true,
    () => false
  );

/**
 * Answer one request. `defaultRepo` is the repo listed when the request
 * names none: the runner's own.
 */
export async function answerGitHubRequest(
  request: GitHubRequest,
  gh: Gh,
  defaultRepo: string | null
): Promise<string> {
  switch (request.op) {
    case 'list': {
      const repos =
        request.repos.length > 0
          ? request.repos
          : defaultRepo
            ? [defaultRepo]
            : [];
      if (repos.length === 0) {
        throw new Error(
          'No task names a pull request yet, and the cloud runner has no repo (RUNNER_REPO).'
        );
      }
      const out: string[] = [];
      for (const repo of repos) {
        out.push(
          await gh([
            'pr',
            'list',
            '-R',
            repo,
            '--state',
            'open',
            '--limit',
            '50',
            '--json',
            OPEN_FIELDS,
            '--jq',
            '.[] | .statusCheckRollup |= (map({status, conclusion, state}) | unique) | .author |= {login}',
          ]),
          await gh([
            'pr',
            'list',
            '-R',
            repo,
            '--state',
            'merged',
            '--limit',
            MERGED_LIMIT,
            '--json',
            MERGED_FIELDS,
            '--jq',
            '.[] | .author |= {login}',
          ])
        );
      }
      return out.join('\n');
    }
    case 'merge':
      return gh([
        'pr',
        'merge',
        String(request.number),
        '-R',
        request.repo,
        '--merge',
      ]);
    case 'runs': {
      // Queued and running deploys, as deployRunsCommand prints them.
      const out: string[] = [];
      for (const status of ['in_progress', 'queued']) {
        out.push(
          await gh([
            'run',
            'list',
            '-R',
            request.repo,
            '--workflow',
            'deploy-prod.yml',
            '--status',
            status,
            '--limit',
            '5',
            '--json',
            'url,status,createdAt',
            '--jq',
            '.[]',
          ])
        );
      }
      return out.join('\n');
    }
    case 'check': {
      // One tab-separated line each, as branchCheckCommand prints.
      const lines: string[] = [];
      for (const pr of request.prs) {
        const found = await pullState(gh, pr);
        const exists =
          !!found?.branch && (await branchExists(gh, pr.repo, found.branch));
        lines.push(
          [
            pr.number,
            pr.repo,
            found?.state ?? 'MISSING',
            found?.branch ?? '',
            exists,
          ].join('\t')
        );
      }
      return lines.join('\n');
    }
    case 'delete': {
      // Checked again here: only a merged pull request's own branch goes.
      const lines: string[] = [];
      for (const pr of request.prs) {
        const found = await pullState(gh, pr);
        let ok = false;
        if (
          found?.state === 'MERGED' &&
          found.branch &&
          !KEPT_BRANCHES.has(found.branch)
        ) {
          ok = await gh([
            'api',
            '-X',
            'DELETE',
            `repos/${pr.repo}/git/refs/heads/${branchPath(found.branch)}`,
            '--silent',
          ]).then(
            () => true,
            () => false
          );
        }
        lines.push(`${ok ? 'ok' : 'fail'} ${pr.repo}#${pr.number}`);
      }
      return lines.join('\n');
    }
  }
}
