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
    const { id: contextId } = (await local.createContext('ws', 's')) as {
      id: string;
    };
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
    const { id: contextId } = (await local.createContext('ws', 's')) as {
      id: string;
    };
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
    await expect(local.getSession('ws', 's1')).resolves.toBeUndefined();
  });
});
