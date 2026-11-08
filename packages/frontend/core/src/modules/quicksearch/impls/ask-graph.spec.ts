import { Framework } from '@notesgraph/infra';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { pendingAskAgent$ } from '../../../utils/ask-agent';
import { AskGraphQuickSearchSession } from './ask-graph';

function createSession({ copilot = true, flag = true } = {}) {
  const open = vi.fn();
  const framework = new Framework();
  framework.entity(
    AskGraphQuickSearchSession,
    () =>
      new AskGraphQuickSearchSession(
        {
          server: {
            config$: { value: { features: [] } },
            features$: { value: { copilot } },
          },
        } as any,
        {
          search$: vi.fn(() =>
            of([{ docId: 'doc-1', score: 1, blockContent: 'deploy notes' }])
          ),
        } as any,
        { list: { doc$: () => ({ value: {} }) } } as any,
        {
          getDocDisplayMeta: () => ({ title: 'Deploy', updatedDate: 0 }),
        } as any,
        { workspace: { id: 'ws-1' } } as any,
        { workbench: { open } } as any,
        {
          flags: {
            enable_ai: { value: true },
            enable_cmdk_ask_agent: { value: flag },
          },
        } as any
      )
  );
  const session = framework.provider().createEntity(AskGraphQuickSearchSession);
  return { session, open };
}

function ask(session: AskGraphQuickSearchSession, query: string) {
  session.query(query);
  vi.advanceTimersByTime(600);
  return session.items$.value;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  pendingAskAgent$.next(null);
});

describe('AskGraphQuickSearchSession agent row', () => {
  test('puts "Ask the agent" above the found notes', () => {
    const { session } = createSession();
    const items = ask(session, '? how do I deploy');
    expect(items[0].source).toBe('commands');
    expect(items[0].group?.id).toBe('ask-graph-agent');
    expect(items.slice(1).map(item => item.source)).toEqual(['docs']);
  });

  test('picking it opens AI chat with the question pending', () => {
    const { session, open } = createSession();
    const [agent] = ask(session, '? how do I deploy');
    agent.payload.run();
    expect(open).toHaveBeenCalledWith('/chat');
    expect(pendingAskAgent$.value).toEqual({
      workspaceId: 'ws-1',
      question: 'how do I deploy',
    });
  });

  test('is left out without copilot or with the flag off', () => {
    for (const options of [{ copilot: false }, { flag: false }]) {
      const { session } = createSession(options);
      const items = ask(session, '? how do I deploy');
      expect(items.map(item => item.source)).toEqual(['docs']);
    }
  });

  test('stays silent without the ? prefix', () => {
    const { session } = createSession();
    expect(ask(session, 'how do I deploy')).toEqual([]);
  });
});
