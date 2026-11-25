import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { queueAhead, queuedPulls, ReleaseActionQueue } from './release-queue';

/** A job's run that ends when the test says so. */
const deferred = () => {
  let resolve!: () => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject, run: vi.fn(() => promise) };
};

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('ReleaseActionQueue', () => {
  let deploying: boolean;
  let refresh: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let queue: ReleaseActionQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    deploying = false;
    refresh = vi.fn(() => Promise.resolve());
    queue = new ReleaseActionQueue({
      deployRunning: () => deploying,
      refresh,
      waitMs: 1000,
    });
  });

  afterEach(() => {
    queue.dispose();
    vi.useRealTimers();
  });

  const statuses = () =>
    queue.jobs$.value.map(job => `${job.label}:${job.status}`);

  test('runs one job at a time, in the order asked', async () => {
    const a = deferred();
    const b = deferred();
    queue.add({ kind: 'merge', label: 'a', run: a.run });
    queue.add({ kind: 'merge', label: 'b', run: b.run });
    await flush();
    expect(a.run).toHaveBeenCalledTimes(1);
    expect(b.run).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['a:running', 'b:queued']);

    a.resolve();
    await flush();
    expect(b.run).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(['b:running']);

    b.resolve();
    await flush();
    expect(queue.jobs$.value).toEqual([]);
  });

  test('a failed job is dropped and the next one runs', async () => {
    const a = deferred();
    const b = deferred();
    queue.add({ kind: 'merge', label: 'a', run: a.run });
    queue.add({ kind: 'close', label: 'b', run: b.run });
    a.reject(new Error('conflict'));
    await flush();
    expect(b.run).toHaveBeenCalledTimes(1);
    expect(statuses()).toEqual(['b:running']);
  });

  test('a key is queued once', async () => {
    const a = deferred();
    expect(
      queue.add({ kind: 'redeploy', key: 'r', label: 'a', run: a.run })
    ).toBe(true);
    expect(
      queue.add({ kind: 'redeploy', key: 'r', label: 'b', run: vi.fn() })
    ).toBe(false);
    expect(queue.has('r')).toBe(true);
    a.resolve();
    await flush();
    expect(queue.has('r')).toBe(false);
  });

  test('a job not yet started can be removed; the running one cannot', async () => {
    const a = deferred();
    const b = vi.fn(() => Promise.resolve());
    queue.add({ kind: 'merge', label: 'a', run: a.run });
    queue.add({ kind: 'merge', label: 'b', run: b });
    const [first, second] = queue.jobs$.value;
    queue.cancel(first.id);
    queue.cancel(second.id);
    expect(statuses()).toEqual(['a:running']);
    a.resolve();
    await flush();
    expect(b).not.toHaveBeenCalled();
  });

  test('a release waits for the deploy while merges behind it go on', async () => {
    deploying = true;
    const release = vi.fn(() => Promise.resolve());
    const merge = vi.fn(() => Promise.resolve());
    queue.add({
      kind: 'release',
      label: 'release',
      afterDeploy: true,
      run: release,
    });
    await flush();
    expect(statuses()).toEqual(['release:waiting']);

    queue.add({ kind: 'merge', label: 'merge', run: merge });
    await flush();
    expect(merge).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();

    // Still deploying at the next look.
    await vi.advanceTimersByTimeAsync(1000);
    expect(release).not.toHaveBeenCalled();
    expect(statuses()).toEqual(['release:waiting']);

    deploying = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(release).toHaveBeenCalledTimes(1);
    expect(queue.jobs$.value).toEqual([]);
    // Each look read the state again, and so did the release before it ran.
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  test('a release queued behind another waits for the deploy the first starts', async () => {
    const second = vi.fn(() => Promise.resolve());
    queue.add({
      kind: 'release',
      label: 'first',
      afterDeploy: true,
      run: async () => {
        deploying = true;
      },
    });
    queue.add({
      kind: 'release',
      label: 'second',
      afterDeploy: true,
      run: second,
    });
    await flush();
    expect(statuses()).toEqual(['second:waiting']);
    expect(second).not.toHaveBeenCalled();

    deploying = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('says what is ahead and which pull requests are queued', () => {
    queue.add({
      kind: 'merge',
      label: 'merge',
      prs: [3, 4],
      run: () => new Promise(() => {}),
    });
    queue.add({ kind: 'close', label: 'close', prs: [5], run: vi.fn() });
    queue.add({ kind: 'apk', label: 'apk', run: vi.fn() });
    const jobs = queue.jobs$.value;
    expect(queueAhead(jobs)).toEqual({ jobs: 3, merges: 1 });
    const pulls = queuedPulls(jobs);
    expect([...pulls.keys()]).toEqual([3, 4, 5]);
    expect(pulls.get(5)?.kind).toBe('close');
  });
});
