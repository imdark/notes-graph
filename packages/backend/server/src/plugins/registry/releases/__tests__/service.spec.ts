import test from 'ava';
import * as Y from 'yjs';

import type { Fetch, GhPull, GhRun } from '../github';
import { ReleaseService } from '../service';

/**
 * The release sync against stub Models, DocWriter, permissions, index and
 * GitHub (a fetch that answers by path): watermarks, rollbacks, no token.
 */

const WS = 'ws-1';
const REPO = 'imdark/notes-graph';
const sha = (c: string) => c.repeat(40);

/** A note with task list blocks, each optionally holding a child line. */
function makeDoc(
  tasks: Record<string, { chip: string; text: string; note?: string }>
) {
  const doc = new Y.Doc();
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  for (const [id, spec] of Object.entries(tasks)) {
    const block = new Y.Map<unknown>();
    const text = new Y.Text();
    const children = new Y.Array<string>();
    block.set('sys:id', id);
    block.set('sys:flavour', 'notesgraph:list');
    block.set('sys:children', children);
    block.set('prop:type', 'bulleted');
    block.set('prop:text', text);
    blocks.set(id, block);
    text.insert(0, ` ${spec.text}`);
    text.insert(0, ' ', { orgStatus: spec.chip });
    if (spec.note) {
      const child = new Y.Map<unknown>();
      const childText = new Y.Text();
      child.set('sys:id', `${id}-note`);
      child.set('sys:flavour', 'notesgraph:paragraph');
      child.set('sys:children', new Y.Array<string>());
      child.set('prop:text', childText);
      blocks.set(`${id}-note`, child);
      childText.insert(0, spec.note);
      children.push([`${id}-note`]);
    }
  }
  return doc;
}

function status(doc: Y.Doc, id: string): string {
  const text = doc
    .getMap<Y.Map<unknown>>('blocks')
    .get(id)!
    .get('prop:text') as Y.Text;
  return (text.toDelta()[0] as { attributes?: { orgStatus?: string } })
    .attributes!.orgStatus!;
}

const run = (
  id: number,
  head: string,
  options: { title?: string; status?: string; conclusion?: string } = {}
): GhRun => ({
  id,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  head_sha: head,
  head_branch: 'main',
  display_title: options.title ?? `Deploy ${head}`,
  status: options.status ?? 'completed',
  conclusion: options.conclusion ?? 'success',
  created_at: '2026-11-12T00:00:00Z',
  updated_at: '2026-11-12T00:20:00Z',
});

const pull = (number: number, mergedAt: string | null): GhPull => ({
  number,
  title: `PR ${number}`,
  html_url: `https://github.com/${REPO}/pull/${number}`,
  state: 'closed',
  user: { login: 'mk' },
  head: { ref: `personal-${number}-thing`, sha: sha('f') },
  base: { ref: 'stage' },
  merged_at: mergedAt,
});

function setup(
  options: {
    token?: string | null;
    syncedRunId?: bigint | null;
    syncedMergedAt?: Date | null;
    runs?: GhRun[];
    closed?: GhPull[];
    compare?: Record<string, { sha: string; message: string; parents: string[] }[]>;
  } = {}
) {
  const row = {
    workspaceId: WS,
    repo: REPO,
    baseBranch: 'stage',
    deployBranch: 'main',
    workflowFile: 'deploy-prod.yml',
    syncedRunId:
      options.syncedRunId === undefined ? 10n : options.syncedRunId,
    syncedMergedAt:
      options.syncedMergedAt === undefined
        ? new Date('2026-11-11T00:00:00Z')
        : options.syncedMergedAt,
    updatedBy: 'user-1',
    updatedAt: new Date(0),
  };
  const synced: Record<string, unknown>[] = [];
  const models: any = {
    registryJob: {
      listDeployRepos: async () => [row],
      setDeploySynced: async (_ws: string, _repo: string, data: any) => {
        synced.push(data);
        Object.assign(row, data);
      },
    },
    workspaceSecret: {
      reveal: async () =>
        options.token === undefined ? 'ghp_secret' : options.token,
    },
  };
  const doc = makeDoc({
    shipped: {
      chip: 'MERGED',
      text: 'Scoped rules',
      note: `https://github.com/${REPO}/pull/5`,
    },
    merging: { chip: '[-]', text: 'PERSONAL-6 back button' },
    todo: {
      chip: '[ ]',
      text: 'not started',
      note: `https://github.com/${REPO}/pull/5`,
    },
  });
  const edits: string[] = [];
  const writer: any = {
    readDocBinary: async () => Buffer.from(Y.encodeStateAsUpdate(doc)),
    editDoc: async (
      _ws: string,
      docId: string,
      edit: (binary: Uint8Array) => { update: Uint8Array | null },
      editor: string
    ) => {
      edits.push(`${docId} as ${editor}`);
      const result = edit(Y.encodeStateAsUpdate(doc));
      if (result.update) Y.applyUpdate(doc, result.update);
      return result;
    },
  };
  const ac: any = {
    user: () => ({
      workspace: () => ({ doc: () => ({ can: async () => true }) }),
    }),
  };
  const indexer: any = {
    search: async () => ({
      nodes: ['shipped', 'merging', 'todo'].map(blockId => ({
        fields: { docId: ['doc-1'], blockId: [blockId] },
      })),
    }),
  };
  const config: any = { registry: { githubToken: '' } };

  const asked: string[] = [];
  const fetcher: Fetch = async url => {
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    asked.push(path);
    let body: unknown = {};
    if (path.startsWith('/actions/workflows/deploy-prod.yml/runs')) {
      body = { workflow_runs: options.runs ?? [] };
    } else if (path.startsWith('/git/ref/heads/')) {
      body = { object: { sha: sha('c') } };
    } else if (path.startsWith('/pulls?')) {
      body = path.includes('state=closed') ? (options.closed ?? []) : [];
    } else if (path.startsWith('/compare/')) {
      const range = path.slice('/compare/'.length).split('?')[0];
      body = {
        ahead_by: 1,
        behind_by: 0,
        status: 'ahead',
        total_commits: 1,
        commits: (options.compare?.[range] ?? []).map(c => ({
          sha: c.sha,
          commit: { message: c.message },
          parents: c.parents.map(p => ({ sha: p })),
        })),
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    };
  };

  const service = new ReleaseService(config, models, writer, ac, indexer);
  service.fetcher = fetcher;
  service.deployInfo = async () => null;
  return { service, row, synced, asked, edits, doc };
}

test('no token: no GitHub call, and the state says so', async t => {
  const { service, row, asked } = setup({ token: null });
  const state = await service.state(WS);
  t.is(state.token.source, null);
  t.regex(state.error!, /GITHUB_TOKEN/);
  t.deepEqual(state.settings, {
    repo: REPO,
    baseBranch: 'stage',
    deployBranch: 'main',
    workflowFile: 'deploy-prod.yml',
  });
  await service.syncRepo(row as any);
  t.deepEqual(asked, []);
});

test('the env token stands in for a missing secret', async t => {
  const { service } = setup({ token: null });
  (service as any).config.registry.githubToken = 'ghp_env';
  t.deepEqual(await service.token(WS), { value: 'ghp_env', source: 'env' });
});

test('a new deploy moves its tasks to DEPLOYED, a merge to MERGED, and the watermarks advance', async t => {
  const { service, row, synced, edits, doc } = setup({
    runs: [run(12, sha('c')), run(10, sha('a'))],
    compare: {
      [`${sha('a')}...${sha('c')}`]: [
        {
          sha: sha('c'),
          message: 'Merge pull request #5 from imdark/personal-5-thing',
          parents: [sha('a'), sha('9')],
        },
      ],
    },
    closed: [
      pull(6, '2026-11-12T08:00:00Z'),
      pull(5, '2026-11-10T08:00:00Z'),
    ],
  });
  await service.syncRepo(row as any);

  t.is(status(doc, 'shipped'), 'DEPLOYED');
  t.is(status(doc, 'merging'), 'MERGED');
  t.is(status(doc, 'todo'), '[ ]');
  t.true(edits.every(edit => edit === 'doc-1 as user-1'));
  t.deepEqual(synced, [
    { syncedRunId: 12n },
    { syncedMergedAt: new Date('2026-11-12T08:00:00Z') },
  ]);

  // Synced again: nothing new, nothing written.
  edits.length = 0;
  synced.length = 0;
  await service.syncRepo(row as any);
  t.deepEqual(edits, []);
  t.deepEqual(synced, []);
});

test('a rollback run syncs no tasks but still moves the watermark', async t => {
  const { service, row, synced, edits, doc } = setup({
    runs: [
      run(11, sha('a'), { title: `Roll back to ${sha('0')}` }),
      run(10, sha('a')),
    ],
  });
  await service.syncRepo(row as any);
  t.deepEqual(edits, []);
  t.is(status(doc, 'shipped'), 'MERGED');
  t.deepEqual(synced, [{ syncedRunId: 11n }]);
});

test('the first sync only sets the watermarks', async t => {
  const { service, row, synced, edits } = setup({
    syncedRunId: null,
    syncedMergedAt: null,
    runs: [run(12, sha('c')), run(10, sha('a'))],
    closed: [pull(6, '2026-11-12T08:00:00Z')],
  });
  await service.syncRepo(row as any);
  t.deepEqual(edits, []);
  t.is(synced.length, 2);
  t.deepEqual(synced[0], { syncedRunId: 12n });
  t.true(synced[1].syncedMergedAt instanceof Date);
});

test('a run still going holds the run watermark back and refreshes the state', async t => {
  const { service, row, synced, asked } = setup({
    runs: [
      run(13, sha('d'), { status: 'in_progress', conclusion: null as any }),
      run(10, sha('a')),
    ],
  });
  await service.syncRepo(row as any);
  t.deepEqual(synced, []);
  // the state was read fresh: branches were asked for
  t.true(asked.some(path => path.startsWith('/git/ref/heads/')));
});
