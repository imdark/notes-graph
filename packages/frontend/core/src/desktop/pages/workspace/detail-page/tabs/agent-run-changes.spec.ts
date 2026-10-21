/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

describe('agent run changes', () => {
  // Opening "Review changes" before any editor or the chat page had loaded
  // threw "Failed to construct 'HTMLElement': Illegal constructor", because
  // LitTextRenderer constructs a <text-renderer> nobody had defined yet.
  test('defines <text-renderer> on load', async () => {
    await import('./agent-run-changes');
    const { TextRenderer } =
      await import('@notesgraph/core/blocksuite/ai/components/text-renderer');

    // scripts/setup/lit.ts stubs customElements with mocks.
    expect(customElements.define).toHaveBeenCalledWith(
      'text-renderer',
      TextRenderer
    );
    // The import pulls in the whole AI element graph.
  }, 60_000);
});
