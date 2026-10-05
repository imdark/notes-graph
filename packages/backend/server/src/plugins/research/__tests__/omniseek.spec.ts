import test from 'ava';

import { MAX_RESULT_CHARS, resultText, rpcReply } from '../omniseek';

/**
 * The wire handling of the OmniSeek client: what comes back from its MCP
 * endpoint and what the model gets to read. The allowlist and the 404 when
 * research is off are in the controller, against a stub client.
 */

test('a plain JSON reply is read as is', t => {
  const reply = rpcReply('{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}', 'application/json');
  t.deepEqual(reply.result, { tools: [] });
});

test('an SSE reply is read from its data lines', t => {
  const body = [
    'event: message',
    'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
    '',
    'event: message',
    'data: {"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"hit"}]}}',
    '',
  ].join('\n');
  const reply = rpcReply(body, 'text/event-stream; charset=utf-8');
  t.is(reply.id, 3);
  t.is(resultText(reply.result), 'hit');
});

test('an SSE stream with no reply is an error', t => {
  t.throws(() => rpcReply('event: ping\n\n', 'text/event-stream'), {
    message: /no reply/,
  });
});

test('a tool result is its text parts, joined', t => {
  t.is(
    resultText({
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    }),
    'first\nsecond'
  );
});

test('a failed tool says so', t => {
  t.is(
    resultText({ isError: true, content: [{ type: 'text', text: 'rate limited' }] }),
    'Error: rate limited'
  );
});

test('a long result is capped for the model', t => {
  const text = resultText({
    content: [{ type: 'text', text: 'x'.repeat(MAX_RESULT_CHARS * 2) }],
  });
  t.is(text.length, MAX_RESULT_CHARS);
  t.true(text.endsWith('…'));
});
