import test from 'ava';

import { NoCopilotProviderAvailable } from '../../../../base';
import { CopilotEmbeddingJob } from '../job';

/**
 * With pgvector available but no provider for the embedding model, every doc
 * fails the same way. The job should say so once and stop, not log an error
 * per doc for ever.
 */

function setup() {
  let calls = 0;
  const models: any = {
    doc: {
      exists: async () => {
        calls += 1;
        throw new NoCopilotProviderAvailable({
          modelId: 'gemini-embedding-001',
        } as any);
      },
    },
    copilotWorkspace: { checkDocNeedEmbedded: async () => true },
  };
  const event: any = { emit: () => {} };
  const job = new CopilotEmbeddingJob(
    {} as any,
    {} as any,
    event,
    models,
    {} as any,
    {} as any,
    {} as any
  );
  // As setup() leaves it when the database supports embeddings.
  (job as any).supportEmbedding = true;
  (job as any).client = {};
  return { job, calls: () => calls };
}

test('a missing embedding provider pauses embedding after the first doc', async t => {
  const { job, calls } = setup();
  await job.embedPendingDocs({ workspaceId: 'ws', docId: 'doc-1' } as any);
  await job.embedPendingDocs({ workspaceId: 'ws', docId: 'doc-2' } as any);
  await job.embedPendingDocs({ workspaceId: 'ws', docId: 'doc-3' } as any);
  t.is(calls(), 1, 'only the first doc tried; the rest were skipped');
  t.false((job as any).supportEmbedding);
});
