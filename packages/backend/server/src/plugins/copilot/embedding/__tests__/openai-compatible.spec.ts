import test from 'ava';

import { EMBEDDING_DIMENSIONS } from '../../../../models';
import { OpenAICompatibleEmbeddingClient } from '../client';
import {
  applyRelevanceCutoff,
  dedupeChunks,
  RELEVANCE_DISTANCE_MARGIN,
  RELEVANCE_MAX_DISTANCE,
} from '../types';

/** An embeddings endpoint answering with vectors of `dims`, recording requests. */
function fakeEndpoint(dims = EMBEDDING_DIMENSIONS, status = 200) {
  const requests: { url: string; body: any }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    requests.push({ url, body });
    if (status !== 200) return new Response('model not found', { status });
    return Response.json({
      data: (body.input as string[])
        .map((_, index) => ({
          index,
          embedding: Array.from({ length: dims }, () => index / 10),
        }))
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
  const client = new OpenAICompatibleEmbeddingClient(
    'http://x/v1',
    'm',
    fetchImpl
  );
  await t.throwsAsync(client.getEmbeddings(['a']), {
    message: /Expected 1024 dimensions, got 768/,
  });
});

test('an error from the endpoint carries its status and body', async t => {
  const { fetchImpl } = fakeEndpoint(EMBEDDING_DIMENSIONS, 404);
  const client = new OpenAICompatibleEmbeddingClient(
    'http://x/v1',
    'm',
    fetchImpl
  );
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
        embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0),
      })),
    });
  }) as unknown as typeof fetch;
  const client = new OpenAICompatibleEmbeddingClient(
    'http://x/v1',
    'm',
    fetchImpl
  );
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

const chunk = (docId: string, index: number, distance: number | null) => ({
  docId,
  chunk: index,
  content: `${docId}#${index}`,
  distance,
});

test('relevance cutoff keeps hits near the best one and under the max', t => {
  const kept = applyRelevanceCutoff([
    chunk('a', 0, 0.3),
    chunk('a', 1, 0.44),
    chunk('b', 0, 0.46),
    chunk('c', 0, null),
  ]);
  t.deepEqual(
    kept.map(c => c.content),
    ['a#0', 'a#1'],
    `within ${RELEVANCE_DISTANCE_MARGIN} of the best`
  );

  t.deepEqual(
    applyRelevanceCutoff([chunk('a', 0, 0.7), chunk('b', 0, 0.8)]).map(
      c => c.content
    ),
    ['a#0'],
    `nothing past ${RELEVANCE_MAX_DISTANCE}`
  );
  t.is(applyRelevanceCutoff([chunk('a', 0, 0.9)]).length, 0);

  const noDistances = [chunk('a', 0, null)];
  t.is(applyRelevanceCutoff(noDistances), noDistances);
});

test('dedupeChunks keys by target and chunk index', t => {
  const deduped = dedupeChunks([
    chunk('a', 0, 0.3),
    chunk('a', 0, 0.3),
    chunk('a', 1, 0.3),
    { fileId: 'a', chunk: 0, content: 'file', distance: 0.3 },
  ]);
  t.is(deduped.length, 3, 'a doc and a file with one id are different');
});

test('reRank dedupes, sorts by distance, cuts off weak hits, then topK', async t => {
  const client = new OpenAICompatibleEmbeddingClient('http://x/v1', 'm');
  const ranked = await client.reRank(
    'q',
    [
      chunk('b', 0, 0.5),
      chunk('a', 0, 0.35),
      chunk('a', 0, 0.35),
      chunk('c', 0, 0.45),
      chunk('d', 0, 0.6),
    ],
    2
  );
  t.deepEqual(
    ranked.map(c => c.content),
    ['a#0', 'c#0']
  );
});

test('a failed try that a retry fixes still returns the embeddings', async t => {
  let calls = 0;
  const { fetchImpl: ok } = fakeEndpoint();
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls += 1;
    if (calls === 1) throw new Error('timed out');
    return await ok(url, init);
  }) as unknown as typeof fetch;
  const client = new OpenAICompatibleEmbeddingClient(
    'http://x/v1',
    'm',
    fetchImpl
  );

  const result = await client.generateEmbeddings([{ index: 3, content: 'a' }]);

  t.is(calls, 2);
  t.is(result[0].index, 3);
});
