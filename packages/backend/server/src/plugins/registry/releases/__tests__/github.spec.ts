import test from 'ava';

import {
  type Fetch,
  GitHubClient,
  GitHubError,
  gitHubErrorCode,
} from '../github';

const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

/** A fetch that answers each call in turn and records what was asked. */
function stubFetch(
  answers: { status: number; body?: unknown; headers?: Record<string, string> }[]
) {
  const calls: { url: string; method: string; body: unknown; auth: string }[] =
    [];
  const fetcher: Fetch = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body) : undefined,
      auth: init?.headers?.authorization ?? '',
    });
    const answer = answers.shift() ?? { status: 200, body: {} };
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      headers: headers(answer.headers),
      text: async () =>
        answer.body === undefined ? '' : JSON.stringify(answer.body),
    };
  };
  return { calls, fetcher };
}

test('statuses and headers map to error codes', t => {
  t.is(gitHubErrorCode(401, headers()), 'unauthorized');
  t.is(
    gitHubErrorCode(403, headers({ 'x-ratelimit-remaining': '0' })),
    'rate-limited'
  );
  t.is(gitHubErrorCode(429, headers()), 'rate-limited');
  t.is(
    gitHubErrorCode(403, headers({ 'x-ratelimit-remaining': '12' })),
    'forbidden'
  );
  t.is(gitHubErrorCode(404, headers()), 'not-found');
  t.is(gitHubErrorCode(405, headers(), 'merge'), 'not-mergeable');
  t.is(gitHubErrorCode(409, headers()), 'conflict');
  t.is(gitHubErrorCode(422, headers(), 'fast-forward'), 'not-fast-forward');
  t.is(gitHubErrorCode(422, headers()), 'invalid');
  t.is(gitHubErrorCode(502, headers()), 'unavailable');
});

test('a forbidden call names the permission GitHub wants', async t => {
  const { fetcher } = stubFetch([
    {
      status: 403,
      body: { message: 'Resource not accessible by personal access token' },
      headers: { 'x-accepted-github-permissions': 'actions=write' },
    },
  ]);
  const github = new GitHubClient('tok', 'imdark/notes-graph', fetcher);
  const err = await t.throwsAsync(github.dispatch('deploy-prod.yml', 'main'), {
    instanceOf: GitHubError,
  });
  t.is(err?.code, 'forbidden');
  t.is(err?.status, 403);
  t.regex(err!.message, /actions=write/);
});

test('merge sends a merge commit pinned to the head sha', async t => {
  const { calls, fetcher } = stubFetch([
    { status: 200, body: { sha: 'm1', merged: true } },
  ]);
  const github = new GitHubClient('tok', 'imdark/notes-graph', fetcher);
  const result = await github.merge(371, 'abc');
  t.deepEqual(result, { sha: 'm1', merged: true });
  t.is(
    calls[0].url,
    'https://api.github.com/repos/imdark/notes-graph/pulls/371/merge'
  );
  t.is(calls[0].method, 'PUT');
  t.deepEqual(calls[0].body, { merge_method: 'merge', sha: 'abc' });
  t.is(calls[0].auth, 'Bearer tok');
});

test('a merge GitHub refuses is not-mergeable', async t => {
  const { fetcher } = stubFetch([
    { status: 405, body: { message: 'Pull Request is not mergeable' } },
  ]);
  const github = new GitHubClient('tok', 'o/r', fetcher);
  const err = await t.throwsAsync(github.merge(1, 'abc'));
  t.is((err as GitHubError).code, 'not-mergeable');
});

test('fast-forward patches the ref without force, and a 422 is not-fast-forward', async t => {
  const { calls, fetcher } = stubFetch([
    { status: 200, body: {} },
    { status: 422, body: { message: 'Update is not a fast forward' } },
  ]);
  const github = new GitHubClient('tok', 'o/r', fetcher);
  await github.fastForward('release/2026', 'f'.repeat(40));
  t.is(
    calls[0].url,
    'https://api.github.com/repos/o/r/git/refs/heads/release/2026'
  );
  t.is(calls[0].method, 'PATCH');
  t.deepEqual(calls[0].body, { sha: 'f'.repeat(40), force: false });
  const err = await t.throwsAsync(github.fastForward('main', 'a'.repeat(40)));
  t.is((err as GitHubError).code, 'not-fast-forward');
});

test('dispatch posts the ref and only the inputs given', async t => {
  const { calls, fetcher } = stubFetch([{ status: 204 }, { status: 204 }]);
  const github = new GitHubClient('tok', 'o/r', fetcher);
  await github.dispatch('deploy-prod.yml', 'main');
  await github.dispatch('deploy-prod.yml', 'main', {
    image_sha: 'a'.repeat(40),
  });
  t.is(
    calls[0].url,
    'https://api.github.com/repos/o/r/actions/workflows/deploy-prod.yml/dispatches'
  );
  t.is(calls[0].method, 'POST');
  t.deepEqual(calls[0].body, { ref: 'main' });
  t.deepEqual(calls[1].body, {
    ref: 'main',
    inputs: { image_sha: 'a'.repeat(40) },
  });
});

test('deleting a branch that is already gone is fine', async t => {
  const { calls, fetcher } = stubFetch([
    { status: 422, body: { message: 'Reference does not exist' } },
  ]);
  const github = new GitHubClient('tok', 'o/r', fetcher);
  await t.notThrowsAsync(github.deleteBranch('personal-1-x'));
  t.is(calls[0].method, 'DELETE');
  t.is(
    calls[0].url,
    'https://api.github.com/repos/o/r/git/refs/heads/personal-1-x'
  );
});

test('a network failure is unavailable', async t => {
  const github = new GitHubClient('tok', 'o/r', async () => {
    throw new Error('ECONNRESET');
  });
  const err = await t.throwsAsync(github.runs('deploy-prod.yml'));
  t.is((err as GitHubError).code, 'unavailable');
});
