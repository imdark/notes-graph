import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import { parseLogLines } from './log-lines';
import {
  askTranscript,
  continuationBrief,
  FOLLOW_UP_CHAT_CHARS,
  RUN_CHAT_OUTPUT_CHARS,
  runChatMessages,
  runDied,
} from './run-chat';

const run = (over: Partial<AgentRun> = {}): AgentRun => ({
  id: 'r1',
  agentId: 'a1',
  agentName: 'Coder',
  targetKind: 'block',
  docId: 'd1',
  blockId: 'b1',
  title: 'Fix the login bug',
  status: 'done',
  startedAt: Date.UTC(2026, 9, 6, 10),
  steps: 4,
  summary: 'Fixed it in auth.ts',
  ...over,
});

describe('runChatMessages', () => {
  test('gives the input, answer and transcript of a finished run', () => {
    const [system, user] = runChatMessages(run({ input: 'Fix login' }), {
      transcript: '→ read_file auth.ts',
      output: 'Fixed it in auth.ts by checking the token expiry.',
    });
    expect(system.role).toBe('system');
    expect(system.content).toContain('"Coder"');
    expect(user.content).toContain('Run: Fix the login bug');
    expect(user.content).toContain('It finished.');
    expect(user.content).toContain('<input>\nFix login\n</input>');
    expect(user.content).toContain('checking the token expiry');
    expect(user.content).toContain(
      '<transcript>\n→ read_file auth.ts\n</transcript>'
    );
  });

  test('a failed run says why, and falls back to the summary', () => {
    const [, user] = runChatMessages(
      run({ status: 'error', error: 'Device went offline' }),
      { transcript: '' }
    );
    expect(user.content).toContain('It failed: Device went offline');
    expect(user.content).toContain('<answer>\nFixed it in auth.ts\n</answer>');
    expect(user.content).toContain('no transcript');
  });

  test('a long answer is clipped', () => {
    const [, user] = runChatMessages(run(), {
      transcript: 'x',
      output: 'a'.repeat(RUN_CHAT_OUTPUT_CHARS + 50),
    });
    expect(user.content).toContain(`${'a'.repeat(RUN_CHAT_OUTPUT_CHARS - 1)}…`);
    expect(user.content).not.toContain('a'.repeat(RUN_CHAT_OUTPUT_CHARS));
  });
});

describe('runDied', () => {
  test('a failed or stopped run died; a finished or running one did not', () => {
    expect(runDied(run({ status: 'error' }))).toBe(true);
    expect(runDied(run({ status: 'cancelled' }))).toBe(true);
    expect(runDied(run({ status: 'done' }))).toBe(false);
    expect(runDied(run({ status: 'running' }))).toBe(false);
  });

  test('only a died run is told the reader can continue it', () => {
    const [died] = runChatMessages(run({ status: 'error' }), {
      transcript: '',
    });
    const [done] = runChatMessages(run(), { transcript: '' });
    expect(died.content).toContain('The reader can continue it');
    expect(done.content).not.toContain('The reader can continue it');
  });
});

describe('continuationBrief', () => {
  const task = {
    text: '- [ ] Fix the login bug #repo:app',
    label: 'the selected block',
    title: 'Fix the login bug',
    taskIds: ['b1'],
    scope: { projects: ['app'], tags: [] },
  };

  test('keeps the task and adds the earlier run, the chat and the ask', () => {
    const brief = continuationBrief(
      task,
      run({ status: 'error', error: 'Device went offline', deviceKey: 'mac' }),
      { transcript: '→ edit auth.ts', output: 'Half done' },
      'Finish it and open the PR',
      [
        { role: 'user', content: 'What is left?' },
        { role: 'assistant', content: 'The tests.' },
        { role: 'assistant', content: '' },
      ]
    );
    expect(brief.taskIds).toEqual(['b1']);
    expect(brief.title).toBe('Fix the login bug');
    expect(brief.scope).toEqual(task.scope);
    expect(brief.text.startsWith(task.text)).toBe(true);
    expect(brief.text).toContain('on mac');
    expect(brief.text).toContain('It failed: Device went offline');
    expect(brief.text).toContain(
      '<previous-transcript>\n→ edit auth.ts\n</previous-transcript>'
    );
    expect(brief.text).toContain(
      '<previous-answer>\nHalf done\n</previous-answer>'
    );
    expect(brief.text).toContain(
      '<chat>\nReader: What is left?\n\nAbout the run: The tests.\n</chat>'
    );
    expect(brief.text).toContain(
      'What the reader wants now:\nFinish it and open the PR'
    );
  });

  test('with nothing asked, it finishes the earlier run', () => {
    const brief = continuationBrief(
      task,
      run({ status: 'cancelled', summary: undefined }),
      { transcript: '' },
      '  '
    );
    expect(brief.text).toContain('It was stopped before it finished.');
    expect(brief.text).toContain('no transcript of the earlier run');
    expect(brief.text).not.toContain('<previous-answer>');
    expect(brief.text).not.toContain('<chat>');
    expect(brief.text).toContain('Finish what the earlier run set out to do.');
  });

  test('a long chat keeps its end', () => {
    const brief = continuationBrief(
      task,
      run({ status: 'error' }),
      {
        transcript: 'x',
      },
      'go',
      [
        { role: 'user', content: 'a'.repeat(FOLLOW_UP_CHAT_CHARS) },
        { role: 'user', content: 'the last word' },
      ]
    );
    expect(brief.text).toContain('the last word');
    expect(brief.text).not.toContain('a'.repeat(FOLLOW_UP_CHAT_CHARS));
  });
});

describe('askTranscript', () => {
  const at = Date.UTC(2026, 9, 21, 9);

  test('logs a question and its answer, stamped', () => {
    const log = askTranscript([
      { role: 'user', content: 'Why did it fail?', files: ['err.log'], at },
      {
        role: 'assistant',
        content: 'The token expired.\nIt retried once.',
        at,
      },
    ]);
    const lines = parseLogLines(log);
    expect(lines.map(line => line.text)).toEqual([
      '? Why did it fail? (attached: err.log)',
      'The token expired.',
      'It retried once.',
    ]);
    expect(lines.every(line => line.at === at)).toBe(true);
  });

  test('ends a turn that failed with its error', () => {
    const log = askTranscript(
      [{ role: 'user', content: 'And then?', at }],
      'The device is offline.',
      at
    );
    expect(parseLogLines(log).map(line => line.text)).toEqual([
      '? And then?',
      '✗ The device is offline.',
    ]);
  });
});
