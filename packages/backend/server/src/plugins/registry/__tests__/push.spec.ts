import test from 'ava';

import { finishedPushData, runOutcome } from '../push';

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
