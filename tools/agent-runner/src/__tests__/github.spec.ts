import { describe, expect, test } from 'vitest';

import type { Job } from '../api';
import {
  answerGitHubRequest,
  type Gh,
  isGitHubRequest,
  parseGitHubRequest,
  repoFromUrl,
} from '../github';
import { runJob } from '../run-job';

const job = (over: Partial<Job>): Job => ({
  id: 'job-1',
  agentId: 'github:check',
  agentName: 'Ship',
  instructions: '{}',
  context: '',
  model: 'command',
  status: 'running',
  title: null,
  profile: null,
  ...over,
});

/** A gh that answers from a table of `args joined by spaces` → stdout. */
const fakeGh =
  (answers: Record<string, string>, calls: string[][] = []): Gh =>
  async args => {
    calls.push(args);
    const key = args.join(' ');
    if (key in answers) return answers[key];
    throw new Error(`gh: not found (${key})`);
  };

describe('Deployments requests on the cloud runner', () => {
  test('are command jobs with a github: agent id', () => {
    expect(isGitHubRequest(job({}))).toBe(true);
    expect(isGitHubRequest(job({ agentId: 'agent-1' }))).toBe(false);
    expect(isGitHubRequest(job({ model: 'claude-code' }))).toBe(false);
  });

  test('take only well-formed requests', () => {
    const parse = (instructions: string) =>
      parseGitHubRequest(job({ instructions }));
    expect(parse('{"op":"merge","repo":"a/b","number":3}')).toEqual({
      op: 'merge',
      repo: 'a/b',
      number: 3,
    });
    expect(() => parse('gh pr list')).toThrow(/JSON/);
    expect(() => parse('{"op":"rm"}')).toThrow(/Unknown/);
    expect(() =>
      parse('{"op":"merge","repo":"a/b; rm -rf /","number":3}')
    ).toThrow(/repo/);
    expect(() =>
      parse('{"op":"check","prs":[{"repo":"a/b","number":-1}]}')
    ).toThrow(/number/);
  });

  test('read the runner repo from its URL', () => {
    expect(repoFromUrl('https://github.com/imdark/notes-graph')).toBe(
      'imdark/notes-graph'
    );
    expect(repoFromUrl('https://github.com/imdark/notes-graph.git')).toBe(
      'imdark/notes-graph'
    );
    expect(repoFromUrl(undefined)).toBeNull();
  });

  test('check prints a line per pull request, as the shell command does', async () => {
    const gh = fakeGh({
      'pr view 7 -R a/b --json state,headRefName':
        '{"state":"MERGED","headRefName":"fix/x"}',
      'api repos/a/b/branches/fix/x --silent': '',
      'pr view 8 -R a/b --json state,headRefName':
        '{"state":"OPEN","headRefName":"gone"}',
    });
    const out = await answerGitHubRequest(
      {
        op: 'check',
        prs: [
          { repo: 'a/b', number: 7 },
          { repo: 'a/b', number: 8 },
          { repo: 'a/b', number: 9 },
        ],
      },
      gh,
      null
    );
    expect(out.split('\n')).toEqual([
      '7\ta/b\tMERGED\tfix/x\ttrue',
      '8\ta/b\tOPEN\tgone\tfalse',
      '9\ta/b\tMISSING\t\tfalse',
    ]);
  });

  test('delete removes only a merged pull request’s own branch', async () => {
    const calls: string[][] = [];
    const gh = fakeGh(
      {
        'pr view 7 -R a/b --json state,headRefName':
          '{"state":"MERGED","headRefName":"fix/x"}',
        'api -X DELETE repos/a/b/git/refs/heads/fix/x --silent': '',
        'pr view 8 -R a/b --json state,headRefName':
          '{"state":"OPEN","headRefName":"wip"}',
        'pr view 9 -R a/b --json state,headRefName':
          '{"state":"MERGED","headRefName":"main"}',
        // A repo's base branch, as its setting names it.
        'pr view 10 -R a/b --json state,headRefName':
          '{"state":"MERGED","headRefName":"stage"}',
      },
      calls
    );
    const out = await answerGitHubRequest(
      {
        op: 'delete',
        prs: [
          { repo: 'a/b', number: 7 },
          { repo: 'a/b', number: 8 },
          { repo: 'a/b', number: 9 },
          { repo: 'a/b', number: 10 },
        ],
        keep: ['stage', 'main'],
      },
      gh,
      null
    );
    expect(out.split('\n')).toEqual([
      'ok a/b#7',
      'fail a/b#8',
      'fail a/b#9',
      'fail a/b#10',
    ]);
    expect(calls.filter(args => args.includes('DELETE'))).toHaveLength(1);
  });

  test('list falls back to the runner repo', async () => {
    const calls: string[][] = [];
    const gh: Gh = async args => {
      calls.push(args);
      return '{"number":1}';
    };
    await answerGitHubRequest(
      { op: 'list', repos: [] },
      gh,
      'imdark/notes-graph'
    );
    expect(calls.map(args => args.slice(0, 6).join(' '))).toEqual([
      'pr list -R imdark/notes-graph --state open',
      'pr list -R imdark/notes-graph --state merged',
    ]);
    await expect(
      answerGitHubRequest({ op: 'list', repos: [] }, gh, null)
    ).rejects.toThrow(/RUNNER_REPO/);
  });

  test('runJob answers one without Claude', async () => {
    const lines: string[] = [];
    const outcome = await runJob(
      job({
        agentId: 'github:merge',
        instructions: '{"op":"merge","repo":"a/b","number":3}',
      }),
      {
        api: {} as never,
        workspaceId: 'ws-1',
        settings: { workRoot: '/tmp' },
        query: (() => {
          throw new Error('Claude was called');
        }) as never,
        say: line => lines.push(line),
        signal: new AbortController().signal,
        gh: fakeGh({ 'pr merge 3 -R a/b --merge': 'Merged' }),
      }
    );
    expect(outcome).toEqual({ result: 'Merged', steps: 0 });
    expect(lines[0]).toMatch(/gh: merge/);
  });
});
