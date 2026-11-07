/**
 * Stop a run from fetching more pages from a site that keeps failing.
 *
 * A run looking for a price fetched one hp.com product page after another,
 * and each timed out: a site that is slow or refusing automated fetches
 * fails the same way on every page. Once WebFetch to a site has failed
 * MAX_FAILURES times in a run, further fetches to it are refused with a
 * reason that points the model at another source. The local twin is wf's
 * workflow/deploy/fetch_guard.py.
 */
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';

export const MAX_FAILURES = 2;

/** The host a URL points at, without `www.`; '' if there is none. */
export function site(url: unknown): string {
  try {
    const host = new URL(String(url)).hostname.toLowerCase();
    return host.startsWith('www.') ? host.slice(4) : host;
  } catch {
    return '';
  }
}

const urlOf = (input: unknown) =>
  site((input as { url?: unknown } | null)?.url ?? '');

/** Hooks that count WebFetch failures per site and refuse a failing site. */
export function fetchGuardHooks(): Options['hooks'] {
  const failures = new Map<string, number>();

  const onFailure: HookCallback = async input => {
    if (input.hook_event_name !== 'PostToolUseFailure') return {};
    if (input.tool_name !== 'WebFetch' || input.is_interrupt) return {};
    const host = urlOf(input.tool_input);
    if (host) failures.set(host, (failures.get(host) ?? 0) + 1);
    return {};
  };

  const beforeFetch: HookCallback = async input => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const host = urlOf(input.tool_input);
    const failed = failures.get(host) ?? 0;
    if (!host || failed < MAX_FAILURES) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `WebFetch to ${host} already failed ${failed} times in this run, so ` +
          `other pages on ${host} will most likely fail too. Don't fetch from ` +
          `${host} again. Use what WebSearch results already say, or a different site.`,
      },
    };
  };

  return {
    PreToolUse: [{ matcher: 'WebFetch', hooks: [beforeFetch] }],
    PostToolUseFailure: [{ matcher: 'WebFetch', hooks: [onFailure] }],
  };
}
