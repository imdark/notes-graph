/** Languages the runner can execute, by the code block's language id. */
export const RUNNABLE_LANGUAGES = new Set(['javascript', 'js']);

export function isRunnableLanguage(language: string | null | undefined) {
  return !!language && RUNNABLE_LANGUAGES.has(language.toLowerCase());
}

/** Caption that marks a code block as the results of the block above it. */
export const RESULTS_CAPTION = 'Results';

export type RunOutcome =
  | { ok: true; logs: string[]; value?: string }
  | { ok: false; logs: string[]; error: string };

/**
 * The text written into the Results block. Like org's `:results output`
 * combined with `:results value`: everything the code logged, then the value
 * it returned (if any), or the error it threw.
 */
export function formatOutcome(outcome: RunOutcome): string {
  const lines = [...outcome.logs];
  if (outcome.ok) {
    if (outcome.value !== undefined) lines.push(outcome.value);
  } else {
    lines.push(outcome.error);
  }
  return lines.length ? lines.join('\n') : '(no output)';
}
