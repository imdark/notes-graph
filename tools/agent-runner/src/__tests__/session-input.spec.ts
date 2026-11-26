import { afterEach, describe, expect, test, vi } from 'vitest';

import { SessionInput } from '../session-input';

const result = { type: 'result', subtype: 'success', result: 'ok' } as any;
const assistant = { type: 'assistant', parent_tool_use_id: null } as any;
const tasks = (...ids: string[]) =>
  ({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: ids.map(task_id => ({ task_id })),
  }) as any;

/** Reads the stream as the SDK does: the prompt, then until it ends. */
async function drain(input: SessionInput) {
  const seen: string[] = [];
  let finished = false;
  const reading = (async () => {
    for await (const turn of input.stream()) {
      seen.push(String(turn.message.content));
    }
    finished = true;
  })();
  await Promise.resolve();
  return { seen, isFinished: () => finished, reading };
}

afterEach(() => vi.useRealTimers());

describe('the run input stream', () => {
  test('gives the prompt, then ends at a result with no background work', async () => {
    const input = new SessionInput('do the task');
    const { seen, reading } = await drain(input);
    expect(seen).toEqual(['do the task']);

    input.feed(assistant);
    expect(input.done).toBe(false);
    input.feed(result);
    expect(input.done).toBe(true);
    await reading;
  });

  test('stays open across a result while a background task runs (CLOUD-148)', async () => {
    const input = new SessionInput('do the task');
    const { isFinished } = await drain(input);

    // The agent backgrounds an install, ends its turn and waits.
    input.feed(tasks('install'));
    input.feed(result);
    expect(input.done).toBe(false);

    // The install finishes; the CLI wakes the agent, which keeps working
    // and needs permissions, so the stream must still be open.
    input.feed(tasks());
    input.feed(assistant);
    expect(input.done).toBe(false);

    input.feed(result);
    expect(input.done).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(isFinished()).toBe(true);
  });

  test('ends after a quiet spell when the last task ends and nothing wakes the agent', () => {
    vi.useFakeTimers();
    const input = new SessionInput('do the task', 1000);
    input.feed(tasks('monitor'));
    input.feed(result);
    input.feed(tasks());
    vi.advanceTimersByTime(999);
    expect(input.done).toBe(false);
    vi.advanceTimersByTime(1);
    expect(input.done).toBe(true);
  });

  test('the agent waking up cancels the quiet end', () => {
    vi.useFakeTimers();
    const input = new SessionInput('do the task', 1000);
    input.feed(tasks('monitor'));
    input.feed(result);
    input.feed(tasks());
    input.feed(assistant);
    vi.advanceTimersByTime(5000);
    expect(input.done).toBe(false);
  });

  test("a subagent's result doesn't end the run", () => {
    const input = new SessionInput('do the task');
    input.feed({ ...result, parent_tool_use_id: 'tool-1' });
    expect(input.done).toBe(false);
  });

  test('end() closes it at once, as a stop does', async () => {
    const input = new SessionInput('do the task');
    const { reading } = await drain(input);
    input.feed(tasks('install'));
    input.end();
    expect(input.done).toBe(true);
    await reading;
  });
});
