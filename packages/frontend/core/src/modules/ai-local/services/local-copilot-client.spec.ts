/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { LocalCopilotClient } from './local-copilot-client';
import type { LocalLLMService } from './local-llm';

const client = () => new LocalCopilotClient({} as LocalLLMService);

describe('LocalCopilotClient context', () => {
  test('a note added as context is listed back as finished', async () => {
    // The chat composer keeps a context chip loading, and the chat waiting,
    // until the context lists the item with a final status.
    const local = client();
    const contextId = await local.createContext();
    await local.addContextDoc({ contextId, docId: 'doc-1' });

    const context = (await local.getContextDocsAndFiles(
      'ws',
      's',
      contextId
    )) as { docs: { id: string; status: string }[] };
    expect(context.docs).toEqual([
      expect.objectContaining({ id: 'doc-1', status: 'finished' }),
    ]);

    await local.removeContextDoc({ contextId, docId: 'doc-1' });
    const after = (await local.getContextDocsAndFiles(
      'ws',
      's',
      contextId
    )) as { docs: unknown[] };
    expect(after.docs).toEqual([]);
  });

  test('a file added as context is finished at once', async () => {
    const local = client();
    const contextId = await local.createContext();
    const file = (await local.addContextFile(new File(['x'], 'a.txt'), {
      contextId,
    })) as { id: string; name: string; status: string };
    expect(file).toEqual(
      expect.objectContaining({ name: 'a.txt', status: 'finished' })
    );
  });

  test('binding a session to a doc does not go to GraphQL', async () => {
    const local = client();
    await expect(
      local.updateSession({ sessionId: 's1', docId: 'doc-1' } as Parameters<
        LocalCopilotClient['updateSession']
      >[0])
    ).resolves.toBe('s1');
    await expect(local.getSession()).resolves.toBeUndefined();
  });
});

describe('LocalCopilotClient chat beside a note', () => {
  /** A model that records what it was sent and answers "ok". */
  const recordingLlm = () => {
    const sent: { role: string; content: string }[][] = [];
    const llm = {
      async *chatStream(messages: { role: string; content: string }[]) {
        sent.push(messages.map(m => ({ ...m })));
        yield 'ok';
      },
    } as unknown as LocalLLMService;
    return { llm, sent };
  };

  const finished = (source: EventSource) =>
    new Promise<void>(resolve =>
      source.addEventListener('error', () => resolve())
    );

  test('the open note is the context, not its id', async () => {
    const { llm, sent } = recordingLlm();
    const embedder = {
      store: {
        stats: async () => {
          throw new Error('beside a note, other notes are not searched');
        },
      },
    };
    const local = new LocalCopilotClient(
      llm,
      embedder as never,
      undefined,
      async docId =>
        docId === 'doc-1'
          ? {
              title: 'RTX 5090 desktop deal research',
              markdown: 'A prebuilt is the way under $6,000.',
            }
          : null
    );
    const sessionId = await local.createSession({
      promptName: 'Chat With NotesGraph AI',
    } as never);
    await local.createMessage({
      sessionId,
      content: 'summarise this page',
      params: { currentDocId: 'doc-1' },
    } as never);
    await finished(local.chatTextStream({ sessionId } as never));

    const turn = sent[0].at(-1)!;
    expect(turn.role).toBe('user');
    expect(turn.content).toContain('"RTX 5090 desktop deal research"');
    expect(turn.content).toContain('A prebuilt is the way under $6,000.');
    expect(turn.content).toMatch(/summarise this page$/);
    expect(turn.content).not.toContain('currentDocId');
    expect(turn.content).not.toContain('doc-1');
    // The note rides along for the turn; the history keeps what was asked.
    const second = await local.createMessage({
      sessionId,
      content: 'and the cheapest?',
      params: { currentDocId: 'doc-1' },
    } as never);
    expect(second).toBeTruthy();
    await finished(local.chatTextStream({ sessionId } as never));
    const history = sent[1].filter(m => m.role === 'user');
    expect(history[0].content).toBe('summarise this page');
  });
});
