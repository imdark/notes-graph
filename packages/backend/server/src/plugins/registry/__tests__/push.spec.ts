import test from 'ava';

import { finishedPushData, pushesWhenFinished, runOutcome } from '../push';

test('a run that left a task committed waits on a review', t => {
  t.is(runOutcome('done', { a: 'COMMITTED', b: '[X]' }), 'review');
  t.is(runOutcome('done', { a: 'MERGED' }), 'review');
});

test('what needs the user outranks what shipped', t => {
  t.is(runOutcome('done', { a: 'DEPLOYED', b: 'BLOCKED' }), 'blocked');
  t.is(runOutcome('done', { a: 'DEPLOYED', b: 'COMMITTED' }), 'review');
  t.is(runOutcome('done', { a: 'DEPLOYED', b: '[X]' }), 'deployed');
});

test('a run with no tasks, or only finished ones, is done', t => {
  t.is(runOutcome('done', {}), 'done');
  t.is(runOutcome('done', { a: '[X]' }), 'done');
});

test('an errored run is failed whatever its tasks say', t => {
  t.is(runOutcome('error', { a: 'DEPLOYED' }), 'failed');
});

test('the push carries the summary, or the error for a failed run', t => {
  const job = {
    id: 'job-1',
    workspaceId: 'ws',
    agentName: 'Coder',
    docId: 'doc-1',
    title: 'Fix the calendar',
    result: '  Opened PR #147.  ',
    error: 'tool crashed',
  };
  const done = finishedPushData('https://ng.example', job, 'review');
  t.like(done, {
    type: 'agent-finished',
    server: 'https://ng.example',
    jobId: 'job-1',
    docId: 'doc-1',
    title: 'Fix the calendar',
    outcome: 'review',
    text: 'Opened PR #147.',
  });
  t.is(
    finishedPushData('https://ng.example', job, 'failed').text,
    'tool crashed'
  );
  t.is(
    finishedPushData(
      'https://ng.example',
      { ...job, docId: null, title: null },
      'done'
    ).docId,
    ''
  );
});

test('a health check that passed sends nothing; one that failed still does', t => {
  const job = { createdBy: 'u1', status: 'done', agentId: 'health:laptop' };
  t.false(pushesWhenFinished(job));
  t.true(pushesWhenFinished({ ...job, status: 'error' }));
  // Other runs push either way, unless cancelled or a monitor's.
  t.true(pushesWhenFinished({ ...job, agentId: 'agent-1' }));
  t.false(
    pushesWhenFinished({ ...job, agentId: 'agent-1', status: 'cancelled' })
  );
  t.false(pushesWhenFinished({ ...job, agentId: 'monitor:m1' }));
  t.false(
    pushesWhenFinished({ ...job, agentId: 'github:check', status: 'error' })
  );
  t.false(pushesWhenFinished({ ...job, createdBy: null }));
  // A side chat's turn: the chat shows the answer, failed or not.
  t.false(pushesWhenFinished({ ...job, agentId: 'chat:agent-1' }));
  t.false(pushesWhenFinished({ ...job, agentId: 'chat:agent-1', status: 'error' }));
});
