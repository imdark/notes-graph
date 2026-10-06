import test from 'ava';

import { EMBEDDING_DIMENSIONS } from '../../../../models';
import { OpenAICompatibleEmbeddingClient } from '../client';

/** An embeddings endpoint answering with vectors of `dims`, recording requests. */
function fakeEndpoint(dims = EMBEDDING_DIMENSIONS, status = 200) {
  const requests: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, body });
    if (status !== 200) return new Response('model not found', { status });
    return Response.json({
      data: (body.input as string[])
        .map((_, index) => ({ index, embedding: new Array(dims).fill(index / 10) }))
        .reverse(), // servers may answer out of order; index is what counts
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

test('embeds in batches against {url}/embeddings, in input order', async t => {
  const { fetchImpl, requests } = fakeEndpoint();
  const client = new OpenAICompatibleEmbeddingClient(
    'http://ollama:11434/v1/',
    'qwen3-embedding:0.6b',
    fetchImpl
  );
  const input = Array.from({ length: 20 }, (_, i) => `chunk ${i}`);
  const result = await client.getEmbeddings(input);

  t.is(requests.length, 5, '4 per request');
  t.is(requests[0].url, 'http://ollama:11434/v1/embeddings');
  t.deepEqual(requests[0].body.model, 'qwen3-embedding:0.6b');
  t.is(result.length, 20);
  t.is(result[19].content, 'chunk 19');
  t.is(result[0].embedding[0], 0);
  t.is(result[1].embedding[0], 0.1, 'ordered by index, not by arrival');
  t.true(await client.configured());
});

test('a model with the wrong vector size fails with what to change', async t => {
  const { fetchImpl } = fakeEndpoint(768);
  const client = new OpenAICompatibleEmbeddingClient('http://x/v1', 'm', fetchImpl);
  await t.throwsAsync(client.getEmbeddings(['a']), {
    message: /Expected 1024 dimensions, got 768/,
  });
});

test('an error from the endpoint carries its status and body', async t => {
  const { fetchImpl } = fakeEndpoint(EMBEDDING_DIMENSIONS, 404);
  const client = new OpenAICompatibleEmbeddingClient('http://x/v1', 'm', fetchImpl);
  await t.throwsAsync(client.getEmbeddings(['a']), {
    message: /HTTP 404: model not found/,
  });
});

test('sends one request at a time, however many jobs ask', async t => {
  let inFlight = 0;
  let peak = 0;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise(resolve => setTimeout(resolve, 10));
    inFlight -= 1;
    const body = JSON.parse(String(init.body));
    return Response.json({
      data: (body.input as string[]).map((_, index) => ({
        index,
        embedding: new Array(EMBEDDING_DIMENSIONS).fill(0),
      })),
    });
  }) as unknown as typeof fetch;
  const client = new OpenAICompatibleEmbeddingClient('http://x/v1', 'm', fetchImpl);
  // Ten embedding jobs at once, as the copilot queue runs them.
  await Promise.all(
    Array.from({ length: 10 }, () => client.getEmbeddings(['a', 'b', 'c']))
  );
  t.is(peak, 1);
});

test('an mxbai search query carries the prefix the model expects', async t => {
  const { fetchImpl, requests } = fakeEndpoint();
  const client = new OpenAICompatibleEmbeddingClient(
    'http://x/v1',
    'mixedbread-ai/mxbai-embed-large-v1',
    fetchImpl
  );
  await client.getEmbedding('rtx 5090 deals');
  await client.getEmbeddings(['a passage']);

  t.deepEqual(requests[0].body.input, [
    'Represent this sentence for searching relevant passages: rtx 5090 deals',
  ]);
  t.deepEqual(requests[1].body.input, ['a passage'], 'passages go as they are');
});

test('a failed try that a retry fixes still returns the embeddings', async t => {
  let calls = 0;
  const { fetchImpl: ok } = fakeEndpoint();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls += 1;
    if (calls === 1) throw new Error('timed out');
    return await ok(url, init);
  }) as unknown as typeof fetch;
  const client = new OpenAICompatibleEmbeddingClient('http://x/v1', 'm', fetchImpl);

  const result = await client.generateEmbeddings([{ index: 3, content: 'a' }]);

  t.is(calls, 2);
  t.is(result[0].index, 3);
});
