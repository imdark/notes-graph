import type { HookCallback, HookInput } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, test } from 'vitest';

import { fetchGuardHooks, site } from '../fetch-guard';

const base = {
  session_id: 's',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/tmp',
};

function guard() {
  const hooks = fetchGuardHooks()!;
  const call = (cb: HookCallback, input: HookInput) =>
    cb(input, undefined, { signal: new AbortController().signal });
  const fail = (url: string, tool = 'WebFetch') =>
    call(hooks.PostToolUseFailure![0].hooks[0], {
      ...base,
      hook_event_name: 'PostToolUseFailure',
      tool_name: tool,
      tool_input: { url },
      tool_use_id: 'x',
      error: 'timeout of 60000ms exceeded',
    });
  const before = (url: string) =>
    call(hooks.PreToolUse![0].hooks[0], {
      ...base,
      hook_event_name: 'PreToolUse',
      tool_name: 'WebFetch',
      tool_input: { url, prompt: 'Price?' },
      tool_use_id: 'y',
    });
  return { hooks, fail, before };
}

const denied = (out: unknown) =>
  (out as { hookSpecificOutput?: { permissionDecision?: string } })
    .hookSpecificOutput?.permissionDecision === 'deny';

describe('fetch guard', () => {
  test('site drops www and case', () => {
    expect(site('https://WWW.HP.com/us-en/shop/pdp/x')).toBe('hp.com');
    expect(site('not a url')).toBe('');
  });

  test('only matches WebFetch', () => {
    const { hooks } = guard();
    expect(hooks.PreToolUse![0].matcher).toBe('WebFetch');
    expect(hooks.PostToolUseFailure![0].matcher).toBe('WebFetch');
  });

  test('a site that failed twice is refused; one failure is not enough', async () => {
    const { fail, before } = guard();
    await fail('https://www.hp.com/1');
    expect(denied(await before('https://www.hp.com/2'))).toBe(false);
    await fail('https://hp.com/2');
    const out = await before('https://www.hp.com/3');
    expect(denied(out)).toBe(true);
    expect(JSON.stringify(out)).toContain('hp.com');
    expect(denied(await before('https://www.bestbuy.com/x'))).toBe(false);
  });

  test('each run counts on its own', async () => {
    const first = guard();
    await first.fail('https://hp.com/1');
    await first.fail('https://hp.com/2');
    expect(denied(await guard().before('https://hp.com/3'))).toBe(false);
  });
});
