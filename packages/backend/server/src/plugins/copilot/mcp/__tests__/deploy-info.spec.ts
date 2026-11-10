import test from 'ava';

import type { DeployInfo } from '../../../../core/config';
import { DEPLOY_INFO_PR_LIMIT, deployInfoAnswer } from '../deploy-info';

/** What the deploy_info tool answers from the running build's record. */

const record = (patch: Partial<DeployInfo> = {}): DeployInfo => ({
  repo: 'imdark/notes-graph',
  commit: '0c1a0ed5',
  branch: 'main',
  subject: 'Merge pull request #347',
  dirty: false,
  deployedAt: '2026-11-08T05:40:00Z',
  pullRequests: [347, 346, 345, 340],
  featureFlags: { enable_monitor_view: 'abc123' },
  ...patch,
});

test('a server deployed without a record says so', t => {
  const answer = deployInfoAnswer(null);
  t.is(answer.deployed, false);
  t.regex(String(answer.message), /no deploy record/);
});

test('the record, its pull requests newest first, and its flags', t => {
  const answer = deployInfoAnswer(record());
  t.like(answer, {
    deployed: true,
    repo: 'imdark/notes-graph',
    commit: '0c1a0ed5',
    pullRequestCount: 4,
    featureFlags: { enable_monitor_view: 'abc123' },
  });
  t.deepEqual(answer.pullRequests, [347, 346, 345, 340]);
});

test('only the latest pull requests are listed when none are asked about', t => {
  const many = Array.from({ length: 500 }, (_, i) => 1000 - i);
  const answer = deployInfoAnswer(record({ pullRequests: many }));
  t.is(answer.pullRequestCount, 500);
  t.deepEqual(answer.pullRequests, many.slice(0, DEPLOY_INFO_PR_LIMIT));
});

test('asked-about pull requests are live, not live, or older than the record', t => {
  const answer = deployInfoAnswer(record(), [347, 341, 12]);
  t.deepEqual(answer.checked, [
    { number: 347, live: true },
    // Newer than the oldest listed but not in it: not live.
    { number: 341, live: false },
    // Older than anything the record reaches back to: can't tell.
    { number: 12, live: null },
  ]);
  t.is(answer.pullRequests, undefined);
});

test('a record from before flags were stamped has none', t => {
  t.is(
    deployInfoAnswer(record({ featureFlags: undefined })).featureFlags,
    null
  );
});
