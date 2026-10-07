import { describe, expect, test } from 'vitest';

import type { AgentRun } from '../stores/agent-runs';
import { RUN_CHAT_OUTPUT_CHARS, runChatMessages } from './run-chat';

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
