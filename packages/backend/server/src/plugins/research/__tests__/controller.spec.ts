import { NotFoundException } from '@nestjs/common';
import test from 'ava';

import { ResearchController } from '../controller';

/**
 * The research API's gates: off until OmniSeek is configured, workspace
 * read required, and only the allowlisted tools callable.
 */

const user: any = { id: 'user-1' };
const req: any = { socket: { on() {}, off() {} }, on() {}, off() {} };

function makeController(options: { configured?: boolean } = {}) {
  const calls: { name: string; args: unknown }[] = [];
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
  const omniseek: any = {
    configured: options.configured ?? true,
    listTools: async () => [{ name: 'omniseek_search', description: '', inputSchema: {} }],
    callTool: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return `ran ${name}`;
    },
  };
  return { controller: new ResearchController(ac, omniseek), calls, asserted };
}

test('research is off until OmniSeek is configured', async t => {
  const { controller } = makeController({ configured: false });
  await t.throwsAsync(controller.tools(user, 'ws-1', req), {
    instanceOf: NotFoundException,
    message: /not set up/,
  });
});

test('listing tools needs workspace read', async t => {
  const { controller, asserted } = makeController();
  const { tools } = await controller.tools(user, 'ws-1', req);
  t.deepEqual(asserted, ['ws-1:Workspace.Read']);
  t.is(tools[0].name, 'omniseek_search');
});

test('an allowlisted tool is called with its args', async t => {
  const { controller, calls } = makeController();
  const { text } = await controller.call(
    user,
    'ws-1',
    'omniseek_search',
    { args: { query: 'graph neural nets' } },
    req
  );
  t.is(text, 'ran omniseek_search');
  t.deepEqual(calls, [
    { name: 'omniseek_search', args: { query: 'graph neural nets' } },
  ]);
});

test('a tool that changes OmniSeek state is refused', async t => {
  const { controller, calls } = makeController();
  await t.throwsAsync(
    controller.call(user, 'ws-1', 'omniseek_curator_act', { args: {} }, req),
    { instanceOf: NotFoundException }
  );
  t.deepEqual(calls, []);
});

test('args that are not an object become empty', async t => {
  const { controller, calls } = makeController();
  await controller.call(user, 'ws-1', 'omniseek_read', { args: ['x'] as any }, req);
  t.deepEqual(calls[0].args, {});
});
