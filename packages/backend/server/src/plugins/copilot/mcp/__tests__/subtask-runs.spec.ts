import test from 'ava';

import type { JobDto } from '../../../registry/jobs';
import { runStatusAnswer, subtaskJobBody } from '../subtask-runs';

/** What start_agent_run queues and what agent_run_status reports. */

test('a subtask run is a wf task on the block, saying who started it', t => {
  const body = subtaskJobBody({
    kind: 'workflow',
    docId: 'journal-26',
    blockId: 'todo-1',
    task: '  CLOUD-150 Lift   the sheet #repo:notes-graph ',
    noteTitle: '2026-11-26',
    parentJobId: 'job-parent',
    startedBy: 'Claude Code',
  });
  t.like(body, {
    model: 'workflow',
    agentId: 'subtask-workflow',
    targetKind: 'block',
    docId: 'journal-26',
    blockId: 'todo-1',
    title: 'CLOUD-150 Lift the sheet #repo:notes-graph',
  });
  t.deepEqual(body.taskIds, ['todo-1']);
  const context = String(body.context);
  t.true(
    context.startsWith(
      'Note: 2026-11-26\nTask: docId journal-26, blockId todo-1.'
    )
  );
  t.regex(context, /Started by the agent "Claude Code" \(run job-parent\)/);
  t.true(context.endsWith('CLOUD-150 Lift the sheet #repo:notes-graph'));
  t.regex(String(body.instructions), /pull request/);
});

test('without the task text, the run is told where to read it', t => {
  const body = subtaskJobBody({
    kind: 'research',
    docId: 'd',
    blockId: 'b',
    task: null,
    noteTitle: null,
    instructions: 'Compare the three vendors.',
  });
  t.is(body.model, 'research');
  t.is(body.instructions, 'Compare the three vendors.');
  t.regex(
    String(body.context),
    /Read the task with read_document \(docId d\) and find block b\./
  );
  t.regex(String(body.context), /Started by another agent,/);
});

const job = (patch: Partial<JobDto> = {}): JobDto =>
  ({
    id: 'job-1',
    title: 'CLOUD-150 Lift the sheet',
    deviceKey: 'cloud',
    status: 'running',
    runAfter: null,
    createdAt: Date.UTC(2026, 10, 26, 22, 0) / 1000,
    finishedAt: null,
    result: null,
    error: null,
    questions: [],
    log: '',
    ...patch,
  }) as JobDto;

test('a running run says to check again, and what it waits for', t => {
  const answer = runStatusAnswer(
    job({
      questions: [
        { id: 'q1', kind: 'permission', text: 'Allow Bash?', answeredAt: null },
        { id: 'q0', kind: 'question', text: 'Which repo?', answeredAt: 1 },
      ] as never,
      log: 'x'.repeat(4000),
    })
  );
  t.false(answer.ended);
  t.deepEqual(answer.waitingFor, [
    { id: 'q1', kind: 'permission', text: 'Allow Bash?' },
  ]);
  t.regex(answer.next, /waits for a person/);
  t.true(answer.logTail.length <= 1501);
  t.is(answer.createdAt, '2026-11-26T22:00:00.000Z');
});

test('an ended run gives its result', t => {
  const answer = runStatusAnswer(
    job({
      status: 'done',
      finishedAt: Date.UTC(2026, 10, 26, 22, 30) / 1000,
      result: 'Opened #451.',
    })
  );
  t.true(answer.ended);
  t.is(answer.result, 'Opened #451.');
  t.is(answer.finishedAt, '2026-11-26T22:30:00.000Z');
  t.regex(answer.next, /ended/);
});
