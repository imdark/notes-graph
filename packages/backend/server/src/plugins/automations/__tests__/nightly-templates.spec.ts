import { webcrypto } from 'node:crypto';
import { runInNewContext } from 'node:vm';

import test from 'ava';

import {
  LEARN_FROM_RUNS_TEMPLATE,
  NIGHTLY_TEMPLATES,
  TITLE_UNTITLED_NOTES_TEMPLATE,
} from '../nightly-templates';

/** Path prefixes of the server routes the templates use (notes-api, registry). */
const REAL_ROUTES = [
  '/api/notes/workspaces/ws1/',
  '/api/registry/workspaces/ws1/',
];

/**
 * Runs a template the way the runner's sandbox does: as the body of an
 * async function with `notesgraph`, `console` and the few web globals the
 * sandbox provides. `routes` answers `notesgraph.fetch` by method and path.
 */
async function run(
  code: string,
  routes: (method: string, path: string, body: unknown) => unknown
) {
  const log: string[] = [];
  const calls: { method: string; path: string; body: unknown }[] = [];
  const context = {
    console: { log: (...a: unknown[]) => log.push(a.join(' ')) },
    notesgraph: {
      url: 'https://notes.test',
      workspaceId: 'ws1',
      fetch: async (
        path: string,
        init: { method?: string; body?: unknown } = {}
      ) => {
        const method = init.method ?? 'GET';
        // Only routes the server really has: these templates once called
        // /api/workspaces/:id/docs, which the server answers with the web
        // app's HTML, and the loose fake below didn't notice.
        if (!REAL_ROUTES.some(prefix => path.startsWith(prefix))) {
          throw new Error(`no such server route: ${method} ${path}`);
        }
        calls.push({ method, path, body: init.body });
        return routes(method, path, init.body);
      },
    },
    TextEncoder,
    crypto: webcrypto,
    encodeURIComponent,
    Date,
    Map,
    Set,
    String,
    RegExp,
    Uint8Array,
  };
  const fn = runInNewContext(`(async () => {\n${code}\n})`, context);
  const output = await fn();
  return { output, log, calls };
}

const stamp = '[2026-11-06T03:00:00.000Z] ';
const transcript = (lines: string[]) => lines.map(l => stamp + l).join('\n');
const failing = (n: number) =>
  Array.from({ length: n }, () => [
    '→ Bash  {"command":"yarn vitest run packages/x","description":"Run tests"}',
    '  ✗ <tool_use_error>Exit code 127 /bin/sh: vitest: command not found</tool_use_error>',
  ]).flat();

test('the templates are offered with a cron trigger and a long timeout', t => {
  t.deepEqual(
    NIGHTLY_TEMPLATES.map(x => [x.id, x.triggers[0], x.timeoutSeconds]),
    [
      ['title-untitled-notes', { type: 'cron', expr: '0 3 * * *' }, 600],
      ['learn-from-runs', { type: 'cron', expr: '0 4 * * *' }, 600],
    ]
  );
});

test('titling names untitled notes from their body and leaves empty ones', async t => {
  const bodies: Record<string, string> = {
    a: '# \nThe fastest drone simulator. Made for RL.\nmore',
    b: '',
    c: 'A very long first sentence that keeps going on and on well past the sixty character mark',
  };
  const { output, calls, log } = await run(
    TITLE_UNTITLED_NOTES_TEMPLATE,
    (method, path, body) => {
      if (path.startsWith('/api/notes/workspaces/ws1/docs?')) {
        return {
          docs: [
            { docId: 'ws1', title: '' },
            { docId: 'titled', title: 'Has one' },
            { docId: 'a', title: '' },
            { docId: 'b', title: ' ' },
            { docId: 'c', title: '' },
          ],
        };
      }
      const md = /\/docs\/([^/?]+)\/markdown$/.exec(path);
      if (md) return { markdown: bodies[md[1]] };
      if (method === 'PUT') return { ok: true, body };
      throw new Error(`unexpected ${method} ${path}`);
    }
  );
  const puts = calls.filter(c => c.method === 'PUT');
  t.deepEqual(
    puts.map(c => [
      c.path.split('/').pop(),
      (c.body as { title: string }).title,
    ]),
    [
      ['a', 'The fastest drone simulator'],
      ['c', 'A very long first sentence that keeps going on and on well…'],
    ]
  );
  t.deepEqual(output, {
    titled: [
      { docId: 'a', title: 'The fastest drone simulator' },
      {
        docId: 'c',
        title: 'A very long first sentence that keeps going on and on well…',
      },
    ],
    empty: ['b'],
  });
  t.true(log.some(line => line.includes('2 titled, 1 empty of 3 untitled')));
});

test('learn finds a stuck run and writes the proposals note under ai / proposals', async t => {
  const jobs = [
    { id: 'run-a', title: 'Run A', status: 'done' },
    { id: 'run-b', title: 'Run B', status: 'done' },
    { id: 'run-c', title: 'Still going', status: 'running' },
  ];
  const logs: Record<string, string> = {
    'run-a': transcript(failing(3)),
    'run-b': transcript([
      '? asking you: Which workspace should the note go in?  (answer in NotesGraph)',
      '→ WebFetch  {"url":"https://example.com"}',
      '  ← page text',
    ]),
  };
  const { output, calls, log } = await run(
    LEARN_FROM_RUNS_TEMPLATE,
    (method, path) => {
      if (path.startsWith('/api/registry/workspaces/ws1/jobs?')) {
        t.regex(path, /kind=agent&since=\d{4}-\d{2}-\d{2}T.*&limit=200$/);
        return { jobs };
      }
      const one = /\/jobs\/([^/?]+)\?logFrom=0$/.exec(path);
      if (one) {
        return {
          job: {
            ...jobs.find(j => j.id === one[1]),
            log: logs[one[1]] ?? '',
            questions:
              one[1] === 'run-a'
                ? [
                    {
                      kind: 'question',
                      text: 'which workspace should the note go in',
                    },
                  ]
                : [],
          },
        };
      }
      if (path.startsWith('/api/notes/workspaces/ws1/docs?q='))
        return { docs: [] };
      if (method === 'POST' && path === '/api/notes/workspaces/ws1/docs') {
        return { docId: 'note-1', folderId: 'f' };
      }
      throw new Error(`unexpected ${method} ${path}`);
    }
  );
  // The running job was skipped: only finished runs are read.
  t.deepEqual(
    calls
      .filter(c => /\/jobs\/[^/?]+\?logFrom=0$/.test(c.path))
      .map(c => c.path.split('/').pop()),
    ['run-a?logFrom=0', 'run-b?logFrom=0']
  );
  const post = calls.find(c => c.method === 'POST')!;
  const created = post.body as {
    title: string;
    markdown: string;
    folder: string[];
  };
  t.is(created.title, 'Proposed harness changes');
  t.deepEqual(created.folder, ['ai', 'proposals']);
  t.regex(created.markdown, /2 runs scanned/);
  t.regex(
    created.markdown,
    /- \[ \] `F-[0-9a-f]{6}` \*\*stuck\*\*: Bash failed 3\+ times \(up to 3\) in one run/
  );
  t.regex(
    created.markdown,
    /- \[ \] `F-[0-9a-f]{6}` \*\*repeated question\*\*: Asked the user in 2 runs/
  );
  // Run B read web content, and the question finding spans it.
  t.regex(created.markdown, /repeated question[\s\S]*review closely/);
  t.regex(created.markdown, /e\.g\. `yarn vitest run packages\/x`/);
  t.is((output as { docId: string }).docId, 'note-1');
  t.true(
    log.some(line =>
      /2 findings; "Proposed harness changes" is up to date/.test(line)
    )
  );
});

test('learn keeps a ticked finding ticked on the next night and updates in place', async t => {
  let previous = '';
  const route = (method: string, path: string, body: unknown) => {
    if (path.startsWith('/api/registry/workspaces/ws1/jobs?')) {
      return { jobs: [{ id: 'run-a', title: 'Run A', status: 'done' }] };
    }
    if (/\/jobs\/run-a\?logFrom=0$/.test(path)) {
      return {
        job: {
          id: 'run-a',
          title: 'Run A',
          status: 'done',
          log: transcript(failing(3)),
          questions: [],
        },
      };
    }
    if (path.startsWith('/api/notes/workspaces/ws1/docs?q=')) {
      return {
        docs: previous
          ? [{ docId: 'note-1', title: 'Proposed harness changes' }]
          : [],
      };
    }
    if (path.endsWith('/docs/note-1/markdown')) return { markdown: previous };
    if (method === 'POST') {
      previous = (body as { markdown: string }).markdown;
      return { docId: 'note-1' };
    }
    if (method === 'PUT') {
      previous = (body as { markdown: string }).markdown;
      return { ok: true };
    }
    throw new Error(`unexpected ${method} ${path}`);
  };
  await run(LEARN_FROM_RUNS_TEMPLATE, route);
  const id = /`(F-[0-9a-f]{6})`/.exec(previous)![1];
  // The person ticks it off in the note.
  previous = previous.replace(`- [ ] \`${id}\``, `- [x] \`${id}\``);
  const { calls } = await run(LEARN_FROM_RUNS_TEMPLATE, route);
  const put = calls.find(c => c.method === 'PUT')!;
  t.truthy(put, 'the existing note is updated, not recreated');
  t.regex(
    (put.body as { markdown: string }).markdown,
    new RegExp(`- \\[x\\] \`${id}\``)
  );
});

test('learn counts the same read three times as a reread, but not a file read in parts', async t => {
  // As the runner logs a call: JSON, cut at 160 characters.
  const read = (input: object) => {
    const json = JSON.stringify(input);
    return '→ Read  ' + (json.length <= 160 ? json : json.slice(0, 159) + '…');
  };
  const long =
    '/work/cache/checkout-cloud-91-Mobile-clicking-on-the-last-block-in-a-no/blocksuite/notesgraph/widgets/slash-menu/src/widget.ts';
  const lines = [
    ...[0, 200, 400].map(offset =>
      read({ file_path: '/src/a.ts', offset, limit: 200 })
    ),
    ...[0, 200, 400].map(offset =>
      read({ file_path: long, offset, limit: 200 })
    ),
    ...[1, 2, 3].map(() => read({ file_path: '/src/same.ts' })),
  ];
  let markdown = '';
  await run(LEARN_FROM_RUNS_TEMPLATE, (method, path, body) => {
    if (path.startsWith('/api/registry/workspaces/ws1/jobs?')) {
      return { jobs: [{ id: 'run-a', title: 'Run A', status: 'done' }] };
    }
    if (path.endsWith('/jobs/run-a?logFrom=0')) {
      return {
        job: {
          id: 'run-a',
          title: 'Run A',
          status: 'done',
          log: transcript(lines),
          questions: [],
        },
      };
    }
    if (path.startsWith('/api/notes/workspaces/ws1/docs?q='))
      return { docs: [] };
    if (method === 'POST') {
      markdown = (body as { markdown: string }).markdown;
      return { docId: 'note-1' };
    }
    throw new Error(`unexpected ${method} ${path}`);
  });
  const rereads = markdown.match(/\*\*reread\*\*: [^\n]*/g) ?? [];
  t.deepEqual(rereads, [
    '**reread**: /src/same.ts read 3 times in one run (Read), no write in between',
  ]);
});

test('learn with no runs and no note writes nothing', async t => {
  const { output, calls } = await run(LEARN_FROM_RUNS_TEMPLATE, (_m, path) => {
    if (path.startsWith('/api/registry/workspaces/ws1/jobs?'))
      return { jobs: [] };
    if (path.startsWith('/api/notes/workspaces/ws1/docs?q='))
      return { docs: [] };
    throw new Error(`unexpected ${path}`);
  });
  t.deepEqual(output, { runs: 0, findings: [] });
  t.false(calls.some(c => c.method !== 'GET'));
});
