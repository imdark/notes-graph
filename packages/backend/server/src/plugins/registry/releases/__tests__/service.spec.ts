import test from 'ava';
import * as Y from 'yjs';

import { APK_MANIFEST_URL } from '../android';
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
    compare?: Record<
      string,
      { sha: string; message: string; parents: string[] }[]
    >;
    /** build-apk.yml's runs; a function sees the dispatches so far. */
    apkRuns?: GhRun[] | ((dispatched: number) => GhRun[]);
    apkJobs?: { name: string; status: string; conclusion: string | null }[];
    /** What the download manifest URL answers; null is a 404. */
    manifest?: string | null;
    compareFiles?: { filename: string; previous_filename?: string }[];
  } = {}
) {
  const row = {
    workspaceId: WS,
    repo: REPO,
    baseBranch: 'stage',
    deployBranch: 'main',
    workflowFile: 'deploy-prod.yml',
    syncedRunId: options.syncedRunId === undefined ? 10n : options.syncedRunId,
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
  const dispatches: { path: string; body: unknown }[] = [];
  const fetcher: Fetch = async (url, init) => {
    if (url === APK_MANIFEST_URL) {
      const found = options.manifest !== undefined && options.manifest !== null;
      return {
        ok: found,
        status: found ? 200 : 404,
        headers: { get: () => null },
        text: async () => (found ? options.manifest! : '<html>404</html>'),
      };
    }
    const path = url.replace(`https://api.github.com/repos/${REPO}`, '');
    asked.push(path);
    let body: unknown = {};
    if (init?.method === 'POST' && path.endsWith('/dispatches')) {
      dispatches.push({ path, body: JSON.parse(init.body ?? '{}') });
      return {
        ok: true,
        status: 204,
        headers: { get: () => null },
        text: async () => '',
      };
    }
    if (path.startsWith('/actions/workflows/build-apk.yml/runs')) {
      const runs =
        typeof options.apkRuns === 'function'
          ? options.apkRuns(dispatches.length)
          : (options.apkRuns ?? []);
      body = { workflow_runs: runs };
    } else if (path.startsWith('/releases?')) {
      body = [];
    } else if (/^\/actions\/runs\/\d+\/jobs/.test(path)) {
      body = { jobs: options.apkJobs ?? [] };
    } else if (path.startsWith('/actions/workflows/deploy-prod.yml/runs')) {
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
        files: options.compareFiles ?? [],
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
  service.wait = async () => {};
  return { service, row, synced, asked, edits, doc, dispatches };
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
    closed: [pull(6, '2026-11-12T08:00:00Z'), pull(5, '2026-11-10T08:00:00Z')],
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

// ── the Android APK ────────────────────────────────────────────────────────

const apkRun = (
  id: number,
  title: string,
  options: {
    status?: string;
    conclusion?: string | null;
    created?: string;
  } = {}
): GhRun => ({
  id,
  html_url: `https://github.com/${REPO}/actions/runs/${id}`,
  head_sha: sha('c'),
  head_branch: 'main',
  display_title: title,
  status: options.status ?? 'completed',
  conclusion: options.conclusion === undefined ? 'success' : options.conclusion,
  created_at: options.created ?? '2026-11-13T10:00:00Z',
  updated_at: '2026-11-13T10:25:00Z',
});

test('android state: a skipped run, the manifest, and the app changes since it', async t => {
  const { service } = setup({
    apkRuns: [apkRun(30, `APK from ${sha('c')}`)],
    apkJobs: [
      {
        name: 'Check for app changes',
        status: 'completed',
        conclusion: 'success',
      },
      { name: 'Build APK', status: 'completed', conclusion: 'skipped' },
      { name: 'Publish', status: 'completed', conclusion: 'skipped' },
    ],
    manifest: JSON.stringify({
      sha: sha('a'),
      ref: 'main',
      builtAt: '2026-11-12T09:00:00Z',
      runUrl: `https://github.com/${REPO}/actions/runs/29`,
    }),
    compareFiles: [
      { filename: 'packages/backend/server/src/a.ts' },
      { filename: 'packages/frontend/core/src/b.ts' },
      {
        filename: 'docs/c.md',
        previous_filename: 'blocksuite/c.md',
      },
    ],
  });
  const state = await service.state(WS);
  const android = state.android!;
  t.is(android.error, null);
  t.false(android.building);
  t.is(android.run?.id, 30);
  t.is(android.run?.ref, sha('c'));
  t.true(android.run?.skipped);
  t.deepEqual(android.published, {
    sha: sha('a'),
    ref: 'main',
    builtAt: '2026-11-12T09:00:00Z',
    runUrl: `https://github.com/${REPO}/actions/runs/29`,
    source: 'manifest',
  });
  // the frontend file and the rename out of blocksuite
  t.is(android.pendingChanges, 2);
});

test('android state: a build going, no manifest, no workflow errors', async t => {
  const { service } = setup({
    apkRuns: [
      apkRun(31, 'APK from stage (forced)', {
        status: 'in_progress',
        conclusion: null,
      }),
      apkRun(30, 'APK from main'),
    ],
    manifest: null,
  });
  const android = (await service.state(WS)).android!;
  t.true(android.building);
  t.is(android.run?.id, 31);
  t.true(android.run?.forced);
  t.false(android.run?.skipped);
  t.is(android.published, null);
  t.is(android.pendingChanges, null);
});

test('buildApk dispatches build-apk.yml on the deploy branch with ref and force', async t => {
  const now = new Date().toISOString();
  const { service, dispatches } = setup({
    apkRuns: dispatched =>
      dispatched
        ? [
            apkRun(40, 'APK from personal-9/x (forced)', {
              status: 'queued',
              conclusion: null,
              created: now,
            }),
          ]
        : [],
  });
  const result = await service.buildApk(WS, {
    ref: 'personal-9/x',
    force: true,
  });
  t.deepEqual(dispatches, [
    {
      path: '/actions/workflows/build-apk.yml/dispatches',
      body: { ref: 'main', inputs: { ref: 'personal-9/x', force: 'true' } },
    },
  ]);
  t.is(result.run?.id, 40);
  t.true(result.run?.forced);
});

test('buildApk defaults to the deploy branch, unforced', async t => {
  const now = new Date().toISOString();
  const { service, dispatches } = setup({
    apkRuns: dispatched =>
      dispatched
        ? [
            apkRun(42, 'APK from main', {
              status: 'queued',
              conclusion: null,
              created: now,
            }),
          ]
        : [],
  });
  const result = await service.buildApk(WS, {});
  t.is(result.run?.ref, 'main');
  t.false(result.run?.forced);
  t.deepEqual(dispatches[0].body, {
    ref: 'main',
    inputs: { ref: 'main', force: 'false' },
  });
});

test('buildApk refuses a bad ref, a bad force, and a build already going', async t => {
  const { service, dispatches } = setup({
    apkRuns: [
      apkRun(41, 'APK from main', { status: 'in_progress', conclusion: null }),
    ],
  });
  await t.throwsAsync(service.buildApk(WS, { ref: 'main; reboot' }), {
    message: /ref must be/,
  });
  await t.throwsAsync(service.buildApk(WS, { ref: 'main', force: 'yes' }), {
    message: /force must be/,
  });
  await t.throwsAsync(service.buildApk(WS, { ref: 'main' }), {
    message: /APK build is running/,
  });
  t.deepEqual(dispatches, []);
});
