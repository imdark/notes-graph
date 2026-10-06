import { NotFoundException } from '@nestjs/common';
import test from 'ava';

import { cleanMessages, sseDelta } from '../deepseek';
import { DeepSeekController } from '../deepseek-controller';

/**
 * DeepSeek as an agent's model: reading its stream, and the gates on the
 * endpoint (off until a key is set, workspace read, known models only).
 */

test('a content delta is the answer text', t => {
  t.is(
    sseDelta('data: {"choices":[{"delta":{"content":"Hello"}}]}'),
    'Hello'
  );
});

test('keep-alives, the done marker and reasoning are not answer text', t => {
  t.is(sseDelta(': keep-alive'), null);
  t.is(sseDelta(''), null);
  t.is(sseDelta('data: [DONE]'), null);
  t.is(
    sseDelta('data: {"choices":[{"delta":{"reasoning_content":"hmm"}}]}'),
    null
  );
});

test('an error in the stream is thrown', t => {
  t.throws(() => sseDelta('data: {"error":{"message":"quota"}}'), {
    message: /quota/,
  });
});

test('messages keep only the roles and text DeepSeek takes', t => {
  t.deepEqual(
    cleanMessages([
      { role: 'system', content: 'be brief', extra: 1 },
      { role: 'tool', content: 'x' },
      { role: 'user', content: 42 },
      null,
      { role: 'user', content: 'find papers' },
    ]),
    [
      { role: 'system', content: 'be brief' },
      { role: 'user', content: 'find papers' },
    ]
  );
  t.deepEqual(cleanMessages('nope'), []);
});

const user: any = { id: 'user-1' };

function makeController(configured = true) {
  const asserted: string[] = [];
  const ac: any = {
    user: () => ({
      workspace: (workspaceId: string) => ({
        assert: async (action: string) => {
          asserted.push(`${workspaceId}:${action}`);
        },
      }),
    }),
  };
  const deepseek: any = { configured };
  return { controller: new DeepSeekController(ac, deepseek), asserted };
}

test('DeepSeek is off until a key is set', async t => {
  const { controller } = makeController(false);
  await t.throwsAsync(controller.models(user, 'ws-1'), {
    instanceOf: NotFoundException,
    message: /not set up/,
  });
});

test('listing models needs workspace read', async t => {
  const { controller, asserted } = makeController();
  const { models } = await controller.models(user, 'ws-1');
  t.deepEqual(asserted, ['ws-1:Workspace.Read']);
  t.true(models.includes('deepseek-chat'));
});

test('an unknown model is refused', async t => {
  const { controller } = makeController();
  await t.throwsAsync(
    controller.chat(
      user,
      'ws-1',
      { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] },
      {} as any,
      {} as any
    ),
    { instanceOf: NotFoundException }
  );
});
