import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  askAgent,
  buildAskAgentPrompt,
  pendingAskAgent$,
  sendAskAgent,
  takeAskAgent,
} from './ask-agent';

afterEach(() => pendingAskAgent$.next(null));

describe('ask agent hand-off', () => {
  test('a question is taken once, by its own workspace', () => {
    askAgent('ws-1', 'how do I deploy');
    expect(takeAskAgent('ws-2')).toBeNull();
    expect(takeAskAgent('ws-1')).toBe('how do I deploy');
    expect(takeAskAgent('ws-1')).toBeNull();
  });

  test('the prompt keeps the question and asks for a learnings search', () => {
    const prompt = buildAskAgentPrompt('how do I deploy');
    expect(prompt.startsWith('how do I deploy\n')).toBe(true);
    expect(prompt).toContain('#learning');
    expect(prompt).toContain('Agent lessons');
  });

  test('sends in a new session with the given tools config', async () => {
    const dispatch = vi.fn(async () => {});
    await sendAskAgent({ dispatch }, 'how do I deploy', {
      toolsConfig: { searchWorkspace: true },
      modelId: 'model-1',
    });
    expect(dispatch.mock.calls.map(call => (call as any[])[0])).toEqual([
      { type: 'createNewSession' },
      {
        type: 'send',
        input: buildAskAgentPrompt('how do I deploy'),
        toolsConfig: { searchWorkspace: true },
        modelId: 'model-1',
      },
    ]);
  });
});
