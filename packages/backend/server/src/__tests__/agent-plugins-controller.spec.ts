import { NotFoundException } from '@nestjs/common';
import test from 'ava';

import { AgentPluginsController } from '../core/agent-plugins/controller';

const manifest = {
  id: 'agent.hello',
  name: 'Hello',
  version: '1.0.1',
  entry: { client: 'index.js?v=1.0.1' },
};

function controller(canRead = true) {
  const models = {
    agentPlugin: {
      getByToken: async (token: string) =>
        token === 'tok' ? { manifest, code: 'export default {}' } : null,
      list: async () => [
        {
          pluginId: 'agent.hello',
          version: '1.0.1',
          manifest,
          agent: 'bot',
          updatedAt: new Date(0),
          token: 'tok',
        },
      ],
    },
  };
  const ac = {
    user: () => ({
      workspace: () => ({
        assert: async () => {
          if (!canRead) throw new Error('denied');
        },
      }),
    }),
  };
  return new AgentPluginsController(models as any, ac as any);
}

function response() {
  const sent: { headers: Record<string, string>; type?: string; body?: string } =
    { headers: {} };
  const res = {
    setHeader: (k: string, v: string) => {
      sent.headers[k] = v;
    },
    type(t: string) {
      sent.type = t;
      return this;
    },
    send: (body: string) => {
      sent.body = body;
    },
  };
  return { res: res as any, sent };
}

test('serves the manifest and the code by token, with CORS', async t => {
  const c = controller();
  const m = response();
  await c.file('tok', 'manifest.json', m.res);
  t.is(m.sent.type, 'application/json');
  t.deepEqual(JSON.parse(m.sent.body!), manifest);
  t.is(m.sent.headers['Access-Control-Allow-Origin'], '*');

  const js = response();
  await c.file('tok', 'index.js', js.res);
  t.is(js.sent.type, 'text/javascript');
  t.is(js.sent.body, 'export default {}');
});

test('404s an unknown token or any other file', async t => {
  const c = controller();
  await t.throwsAsync(c.file('nope', 'index.js', response().res), {
    instanceOf: NotFoundException,
  });
  await t.throwsAsync(c.file('tok', 'server.js', response().res), {
    instanceOf: NotFoundException,
  });
});

test('lists with a server-relative base url, only for readers', async t => {
  const { plugins } = await controller().list({ id: 'u' } as any, 'ws');
  t.is(plugins[0].baseUrl, '/api/agent-plugins/tok');
  t.is(plugins[0].id, 'agent.hello');
  await t.throwsAsync(controller(false).list({ id: 'u' } as any, 'ws'));
});
