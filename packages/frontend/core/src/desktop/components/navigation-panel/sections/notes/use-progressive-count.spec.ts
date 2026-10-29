/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { ROWS_PER_BATCH, useProgressiveCount } from './use-progressive-count';

describe('useProgressiveCount', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('starts with one batch and grows until it covers the list', async () => {
    vi.useFakeTimers();
    const total = ROWS_PER_BATCH * 3 + 5;
    const hook = renderHook(() => useProgressiveCount(total, true));
    expect(hook.result.current).toBe(ROWS_PER_BATCH);

    for (let i = 0; i < 10; i++) {
      await act(() => vi.runOnlyPendingTimersAsync());
    }
    expect(hook.result.current).toBeGreaterThanOrEqual(total);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('does not grow while inactive', async () => {
    vi.useFakeTimers();
    const hook = renderHook(({ active }) => useProgressiveCount(100, active), {
      initialProps: { active: false },
    });
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(hook.result.current).toBe(ROWS_PER_BATCH);

    hook.rerender({ active: true });
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(hook.result.current).toBe(ROWS_PER_BATCH * 2);
  });
});
