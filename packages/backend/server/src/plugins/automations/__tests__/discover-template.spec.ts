import { runInNewContext } from 'node:vm';

import test from 'ava';

import {
  DISCOVER_TEMPLATES,
  PRESEED_DISCOVER_TEMPLATE,
} from '../discover-template';
import { AUTOMATION_TEMPLATES } from '../hooks';

interface Story {
  title: string;
  link: string;
  source: string;
  publishedAt?: number;
  image?: string;
}

/**
 * Runs the template as the sandbox does, with a fake `notesgraph` (docs) and
 * a fake sidecar behind `fetch` (feeds by topic, images by title).
 */
async function run(opts: {
  feeds: Record<string, Story[] | number>;
  images?: Record<string, string | null>;
  topicsNote?: string;
  /** What the user picked on the Discover page; null when never saved. */
  picked?: string[] | null;
}) {
  const sidecar: string[] = [];
  const log: string[] = [];
  const reply = (status: number, body: unknown) => ({
    ok: status < 300,
    status,
    json: async () => body,
  });
  const context = {
    console: { log: (...a: unknown[]) => log.push(a.join(' ')) },
    notesgraph: {
      workspaceId: 'ws1',
      fetch: async (path: string) => {
        if (path === '/api/notes/discover/topics') {
          return { topics: opts.picked ?? null };
        }
        if (path.startsWith('/api/notes/workspaces/ws1/docs?q=')) {
          return {
            docs: opts.topicsNote
              ? [{ docId: 'topics1', title: 'Discover topics' }]
              : [{ docId: 'other', title: 'Discover topics old' }],
          };
        }
        if (path === '/api/notes/workspaces/ws1/docs/topics1/markdown') {
          return { markdown: opts.topicsNote };
        }
        throw new Error('no such server route: ' + path);
      },
    },
    fetch: async (url: string) => {
      const u = new URL(url);
      if (u.origin !== 'https://app.notesgraph.com') throw new Error(url);
      sidecar.push(u.pathname + u.search);
      if (u.pathname === '/clip/news-feed') {
        if (u.searchParams.get('refresh') !== '1') return reply(400, {});
        const feed = opts.feeds[u.searchParams.get('topic') ?? ''];
        if (typeof feed === 'number') return reply(feed, {});
        return reply(200, { items: feed ?? [] });
      }
      if (u.pathname === '/clip/news-image') {
        const image = opts.images?.[u.searchParams.get('title') ?? ''];
        return reply(200, { image: image ?? null });
      }
      return reply(404, {});
    },
    URL,
    Array,
    Promise,
    Set,
    String,
    Error,
    encodeURIComponent,
  };
  const fn = runInNewContext(
    `(async () => {\n${PRESEED_DISCOVER_TEMPLATE}\n})`,
    context
  );
  const output = await fn();
  return { output, sidecar, log };
}

const story = (title: string, publishedAt: number, image?: string): Story => ({
  title,
  link: 'https://news.google.com/rss/articles/' + title.replace(/\s/g, ''),
  source: 'Example',
  publishedAt,
  ...(image ? { image } : {}),
});

test('it is offered as a daily morning template', t => {
  t.deepEqual(DISCOVER_TEMPLATES[0].triggers, [
    { type: 'cron', expr: '0 5 * * *', tz: 'America/Los_Angeles' },
  ]);
  t.true(AUTOMATION_TEMPLATES.some(x => x.id === 'preseed-discover'));
  t.false(PRESEED_DISCOVER_TEMPLATE.includes('`'));
});

test('pulls each topic fresh and resolves the pictures it lacks', async t => {
  const { output, sidecar } = await run({
    feeds: {
      Technology: [story('Chips', 2), story('Phones', 1, 'https://img/p')],
      'Artificial intelligence': [story('Models', 3)],
      Science: [],
    },
    images: { Chips: 'https://img/c', Models: null },
  });
  t.deepEqual(
    sidecar.filter(p => p.startsWith('/clip/news-feed')),
    [
      '/clip/news-feed?refresh=1&topic=Technology',
      '/clip/news-feed?refresh=1&topic=Artificial%20intelligence',
      '/clip/news-feed?refresh=1&topic=Science',
    ]
  );
  const asked = sidecar
    .filter(p => p.startsWith('/clip/news-image'))
    .map(p => new URL('https://x' + p).searchParams.get('title'));
  // Phones already had its picture, so it is not asked for again
  t.deepEqual(asked.sort(), ['Chips', 'Models']);
  t.like(output.topics[0], { topic: 'Technology', stories: 2, images: 2 });
  t.like(output.topics[1], { stories: 1, images: 0 });
  t.is(output.summary, '3 of 3 topics preseeded, 2 pictures ready');
});

test('adds the topics listed in the "Discover topics" note', async t => {
  const { output } = await run({
    feeds: {},
    topicsNote: [
      '# Topics',
      'These are the things the feed should follow.',
      '- Climbing',
      '* [ ] Rust',
      '1. technology',
      '',
    ].join('\n'),
  });
  t.deepEqual(
    output.topics.map((r: { topic: string }) => r.topic),
    ['Technology', 'Artificial intelligence', 'Science', 'Climbing', 'Rust']
  );
});

test('the topics picked on the Discover page replace the defaults', async t => {
  const { output } = await run({
    feeds: {},
    picked: ['Climbing', 'Rust'],
    topicsNote: '- rust\n- Chess',
  });
  t.deepEqual(
    output.topics.map((r: { topic: string }) => r.topic),
    ['Climbing', 'Rust', 'Chess']
  );
});

test('an empty saved selection leaves only the note topics', async t => {
  const { output } = await run({
    feeds: {},
    picked: [],
    topicsNote: '- Chess',
  });
  t.deepEqual(
    output.topics.map((r: { topic: string }) => r.topic),
    ['Chess']
  );
});

test('a failing topic is reported and the rest go on', async t => {
  const { output } = await run({
    feeds: { Technology: 502, Science: [story('Stars', 1)] },
    images: { Stars: 'https://img/s' },
  });
  t.like(output.topics[0], { topic: 'Technology' });
  t.truthy(output.topics[0].error);
  t.is(output.summary, '2 of 3 topics preseeded, 1 pictures ready');
});

test('the run fails when no topic could be pulled', async t => {
  await t.throwsAsync(
    run({
      feeds: { Technology: 500, 'Artificial intelligence': 500, Science: 500 },
    }),
    { message: 'no topic could be pulled' }
  );
});

test('only the newest stories of a topic get a picture', async t => {
  const many = Array.from({ length: 40 }, (_, i) => story('S' + i, i));
  const { sidecar } = await run({ feeds: { Technology: many } });
  const asked = sidecar
    .filter(p => p.startsWith('/clip/news-image'))
    .map(p => new URL('https://x' + p).searchParams.get('title'));
  t.is(asked.length, 30);
  t.false(asked.includes('S0'));
  t.true(asked.includes('S39'));
});
