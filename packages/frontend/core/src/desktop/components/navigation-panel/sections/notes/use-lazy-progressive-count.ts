import {
  type RefObject,
  startTransition,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ROWS_PER_BATCH } from './use-progressive-count';

/** How far below the viewport the next batch is mounted ahead of scrolling. */
const PREFETCH_MARGIN = '600px 0px';

/**
 * Like `useProgressiveCount`, but the list only grows when the viewer is
 * near its end. Render the returned `sentinelRef` on an element placed right
 * after the last mounted row (only while `shown < total`): each time it comes
 * within a screen of the viewport another batch mounts. A long Inbox that sits
 * below the fold therefore costs nothing on a cold start until it is scrolled
 * to; `useProgressiveCount` mounted all of it in the background.
 *
 * `minCount` forces at least that many rows regardless of scrolling, so a
 * caller can make sure a row it wants to reveal (the active note) exists.
 * Without IntersectionObserver the hook falls back to timer-driven growth.
 */
export const useLazyProgressiveCount = (
  total: number,
  active: boolean,
  minCount = 0
): { shown: number; sentinelRef: RefObject<HTMLDivElement | null> } => {
  const [count, setCount] = useState(ROWS_PER_BATCH);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const shown = Math.min(total, Math.max(count, minCount));

  useEffect(() => {
    if (!active || shown >= total) {
      return;
    }
    const grow = () =>
      startTransition(() => {
        setCount(c => Math.max(c, shown) + ROWS_PER_BATCH);
      });
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') {
      const timer = setTimeout(grow, 0);
      return () => clearTimeout(timer);
    }
    // A fresh observer per batch: observing reports the current intersection
    // immediately, so a sentinel that is still on screen after a batch mounts
    // keeps the list growing until it scrolls out of reach.
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer.disconnect();
          grow();
        }
      },
      { rootMargin: PREFETCH_MARGIN }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [active, shown, total]);

  return { shown, sentinelRef };
};
