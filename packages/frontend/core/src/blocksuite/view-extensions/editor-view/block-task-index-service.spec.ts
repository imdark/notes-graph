/**
 * @vitest-environment happy-dom
 */
import { Container } from '@blocksuite/global/di';
import { BlockTaskIndexProvider } from '@blocksuite/notesgraph/shared/services';
import type { FrameworkProvider } from '@notesgraph/infra';
import { NEVER, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { patchBlockTaskIndexService } from './block-task-index-service';

type TaskNode = { fields: Record<string, string | string[]> };

const taskNode = (docId: string, blockId: string): TaskNode => ({
  fields: {
    docId,
    blockId,
    tags: '',
    props: '',
    content: 'task',
    todoTrail: '',
  },
});

/** The same, as the phone's SQLite index returns it: every field an array. */
const nativeTaskNode = (docId: string, blockId: string): TaskNode => ({
  fields: {
    docId: [docId],
    blockId: [blockId],
    tags: '',
    props: '',
    content: ['task'],
    todoTrail: ['Inbox'],
  },
});

/** A provider whose local index answers on demand and whose remote never does. */
const setup = () => {
  const local$ = new Subject<{ nodes: TaskNode[] }>();
  const indexer = {
    // eslint-disable-next-line rxjs/finnish -- stubs the indexer.search$ method
    search$: (_table: string, _query: unknown, options: { prefer?: string }) =>
      options.prefer === 'remote' ? NEVER : local$,
  };
  const framework = {
    get: () => ({ indexer }),
  } as unknown as FrameworkProvider;
  const container = new Container();
  patchBlockTaskIndexService(framework).setup?.(container);
  const provider = container.provider().get(BlockTaskIndexProvider);
  return { local$, provider };
};

describe('patchBlockTaskIndexService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('keeps a local answer that arrives after the silence timeout', () => {
    // The phone's local index can take longer than the timeout to answer; the
    // journal's task lists once stayed empty there because the late answer
    // was dropped along with the timed-out subscription.
    const { local$, provider } = setup();
    const results: { hits: unknown[]; complete: boolean }[] = [];
    const sub = provider.queryTaskBlocks$({}).subscribe(r => results.push(r));

    vi.advanceTimersByTime(15_000);
    expect(results.at(-1)).toEqual({ hits: [], complete: true });

    local$.next({ nodes: [taskNode('doc', 'block')] });
    expect(results.at(-1)?.hits).toHaveLength(1);
    sub.unsubscribe();
  });

  test('reads hits from the phone index, whose fields are arrays', () => {
    // The journal's task lists were empty on the phone: its index returns
    // docId/blockId as ["…"], and only plain strings were taken.
    const { local$, provider } = setup();
    const results: { hits: unknown[] }[] = [];
    const sub = provider.queryTaskBlocks$({}).subscribe(r => results.push(r));

    local$.next({ nodes: [nativeTaskNode('doc', 'block')] });
    expect(results.at(-1)?.hits).toEqual([
      { docId: 'doc', blockId: 'block', text: 'task', trail: 'Inbox' },
    ]);
    sub.unsubscribe();
  });

  test('a timer firing after a real answer does not blank it out', () => {
    const { local$, provider } = setup();
    const results: { hits: unknown[] }[] = [];
    const sub = provider.queryTaskBlocks$({}).subscribe(r => results.push(r));

    local$.next({ nodes: [taskNode('doc', 'block')] });
    vi.advanceTimersByTime(15_000);
    expect(results.at(-1)?.hits).toHaveLength(1);
    sub.unsubscribe();
  });
});
