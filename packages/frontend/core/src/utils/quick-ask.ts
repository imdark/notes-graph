// The desktop quick-ask window loads `/workspace/<id>/chat?quick=1&prompt=…`.
// Read the params once at startup: the desktop router never rewrites the
// browser URL, but in-window navigation changes the workbench location.
const params =
  BUILD_CONFIG.isElectron && typeof location !== 'undefined'
    ? new URLSearchParams(location.search)
    : null;

const quickAsk = params?.get('quick') === '1';
const prompt = params?.get('prompt') || null;
let prefill: Promise<void> | null = null;

export function isQuickAskWindow() {
  return quickAsk;
}

export function hasPendingQuickAskPrompt() {
  return !!prompt && !prefill;
}

/**
 * Hands the clipboard text the window was opened with to `apply`, once per
 * page load, so re-mounting the chat page does not clobber what the user typed.
 */
export function prefillQuickAskPrompt(
  apply: (prompt: string) => Promise<void>
) {
  prefill ??= prompt ? apply(prompt) : Promise.resolve();
  return prefill;
}
