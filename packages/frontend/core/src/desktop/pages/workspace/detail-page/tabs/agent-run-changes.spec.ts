/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test, vi } from 'vitest';

// The real registration imports the whole AI element graph, slow enough to
// time out under CI's coverage; what matters is that loading the module
// registers the elements it renders.
const registered = vi.hoisted(() => vi.fn());
vi.mock('@notesgraph/core/blocksuite/ai/effects/shared', () => ({
  registerAISharedEffects: registered,
}));
vi.mock('@notesgraph/core/blocksuite/ai/components/text-renderer', () => ({
  LitTextRenderer: () => null,
}));

describe('agent run changes', () => {
  // Opening "Review changes" before any editor or the chat page had loaded
  // threw "Failed to construct 'HTMLElement': Illegal constructor", because
  // LitTextRenderer constructs a <text-renderer> nobody had defined yet.
  test('registers the AI elements (<text-renderer>) on load', async () => {
    await import('./agent-run-changes');
    expect(registered).toHaveBeenCalled();
  }, 180_000);
});
