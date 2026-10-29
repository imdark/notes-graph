import { startTransition, useEffect, useState } from 'react';

export const ROWS_PER_BATCH = 20;

/**
 * How many of `total` rows to render, growing by a batch per task until all
 * are shown. Mounting a few hundred doc rows at once blocked the phone for
 * ~1.7s on every visit to Home (each row mounts dozens of subscriptions and a
 * collapsible that measures its own layout); in batches the page shows at once
 * and fills in while staying responsive. Paused while `active` is false.
 */
export const useProgressiveCount = (total: number, active: boolean) => {
  const [count, setCount] = useState(ROWS_PER_BATCH);
  useEffect(() => {
    if (!active || count >= total) {
      return;
    }
    const timer = setTimeout(() => {
      startTransition(() => setCount(c => c + ROWS_PER_BATCH));
    }, 0);
    return () => clearTimeout(timer);
  }, [active, count, total]);
  return count;
};
