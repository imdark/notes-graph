/**
 * @vitest-environment happy-dom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { useLazyProgressiveCount } from './use-lazy-progressive-count';
import { ROWS_PER_BATCH } from './use-progressive-count';

/** A hand-driven IntersectionObserver: tests decide when the sentinel shows. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly targets = new Set<Element>();
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) {
    this.targets.add(el);
  }
  unobserve(el: Element) {
    this.targets.delete(el);
  }
  disconnect() {
    this.targets.clear();
  }
  takeRecords() {
    return [];
  }
  /** Simulate the browser reporting the sentinel on screen. */
  intersect() {
    this.callback(
      [...this.targets].map(
        target =>
          ({ target, isIntersecting: true }) as IntersectionObserverEntry
      ),
      this as unknown as IntersectionObserver
    );
  }
}

const useHook = (total: number, active = true, minCount = 0) => {
  const result = useLazyProgressiveCount(total, active, minCount);
  // Give the hook a sentinel element as the component would.
  if (!result.sentinelRef.current) {
    result.sentinelRef.current = document.createElement('div');
  }
  return result;
};

describe('useLazyProgressiveCount', () => {
  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('mounts one batch and waits for the sentinel before growing', () => {
    const total = ROWS_PER_BATCH * 5;
    const hook = renderHook(() => useHook(total));
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH);
    // Nothing scrolled: still one batch, one observer waiting.
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH);

    act(() => FakeIntersectionObserver.instances.at(-1)?.intersect());
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH * 2);

    act(() => FakeIntersectionObserver.instances.at(-1)?.intersect());
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH * 3);
  });

  test('stops observing once the whole list is mounted', () => {
    const total = ROWS_PER_BATCH + 3;
    const hook = renderHook(() => useHook(total));
    act(() => FakeIntersectionObserver.instances.at(-1)?.intersect());
    expect(hook.result.current.shown).toBe(total);
    // The last observer was disconnected and no new one was created.
    expect(FakeIntersectionObserver.instances.at(-1)?.targets.size).toBe(0);
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  test('minCount reveals a deep row without scrolling', () => {
    const total = 200;
    const hook = renderHook(({ minCount }) => useHook(total, true, minCount), {
      initialProps: { minCount: 0 },
    });
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH);
    hook.rerender({ minCount: 150 });
    expect(hook.result.current.shown).toBe(150);
    // Growth continues from there, not from the first batch.
    act(() => FakeIntersectionObserver.instances.at(-1)?.intersect());
    expect(hook.result.current.shown).toBe(150 + ROWS_PER_BATCH);
  });

  test('does not grow while inactive', () => {
    const hook = renderHook(({ active }) => useHook(100, active), {
      initialProps: { active: false },
    });
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
    expect(hook.result.current.shown).toBe(ROWS_PER_BATCH);
    hook.rerender({ active: true });
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
  });

  test('falls back to timers without IntersectionObserver', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.useFakeTimers();
    const total = ROWS_PER_BATCH * 2 + 1;
    const hook = renderHook(() => useHook(total));
    for (let i = 0; i < 5; i++) {
      await act(() => vi.runOnlyPendingTimersAsync());
    }
    expect(hook.result.current.shown).toBe(total);
  });
});
