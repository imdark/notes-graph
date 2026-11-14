import test from 'ava';

import {
  apkRunSkipped,
  appChanges,
  isAppPath,
  labelApkRun,
  parseApkManifest,
  publishedFromReleases,
  toApkRun,
} from '../android';
import type { GhRelease, GhRun } from '../github';
import { parseApkRef } from '../service';

const sha = (c: string) => c.repeat(40);

test('app paths: the frontend, blocksuite, common, the bundler and the lockfile', t => {
  for (const path of [
    'packages/frontend/core/src/index.ts',
    'packages/frontend/apps/android/App/app/build.gradle',
    'packages/frontend/mobile-native/src/lib.rs',
    'blocksuite/framework/store/src/index.ts',
    'packages/common/infra/src/index.ts',
    'tools/cli/src/rspack/index.ts',
    'yarn.lock',
    'package.json',
    './yarn.lock',
  ]) {
    t.true(isAppPath(path), path);
  }
});

test('not app paths: admin, the server, workflows, docs, nested package.json', t => {
  for (const path of [
    'packages/frontend/admin/src/index.tsx',
    'packages/backend/server/src/index.ts',
    '.github/workflows/build-apk.yml',
    'scripts/build-android.sh',
    'tools/agent-runner/src/index.ts',
    'tools/clipper/index.ts',
    'docs/readme.md',
    'packages/backend/server/package.json',
    '',
    '   ',
  ]) {
    t.false(isAppPath(path), path);
  }
});

test('appChanges keeps the app-affecting files once, in order', t => {
  t.deepEqual(
    appChanges([
      'packages/backend/server/a.ts',
      'yarn.lock',
      'blocksuite/x.ts',
      'yarn.lock',
      'packages/frontend/admin/b.ts',
      '',
    ]),
    ['yarn.lock', 'blocksuite/x.ts']
  );
  t.deepEqual(appChanges([]), []);
});

test('parseApkRef: branches and 7-40 hex commits, nothing else', t => {
  t.is(parseApkRef('main'), 'main');
  t.is(parseApkRef(' personal-12/fix-thing '), 'personal-12/fix-thing');
  t.is(parseApkRef('abc1234'), 'abc1234');
  t.is(parseApkRef(sha('a')), sha('a'));
  t.is(parseApkRef('main; rm -rf /'), null);
  t.is(parseApkRef('$(id)'), null);
  t.is(parseApkRef('a..b'), null);
  t.is(parseApkRef('-f'), null);
  t.is(parseApkRef(''), null);
  t.is(parseApkRef(42), null);
});

const run = (over: Partial<GhRun> = {}): GhRun => ({
  id: 7,
  html_url: 'https://github.com/o/r/actions/runs/7',
  head_sha: sha('c'),
  head_branch: 'main',
  display_title: 'APK from main',
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-11-13T10:00:00Z',
  updated_at: '2026-11-13T10:25:00Z',
  run_started_at: '2026-11-13T10:01:00Z',
  ...over,
});

test('labelApkRun reads the ref and whether it was forced from the title', t => {
  t.deepEqual(labelApkRun(run()), { ref: 'main', forced: false });
  t.deepEqual(labelApkRun(run({ display_title: 'APK from stage (forced)' })), {
    ref: 'stage',
    forced: true,
  });
  t.deepEqual(labelApkRun(run({ display_title: `APK from ${sha('d')}` })), {
    ref: sha('d'),
    forced: false,
  });
  t.deepEqual(labelApkRun(run({ display_title: 'Build APK' })), {
    ref: null,
    forced: false,
  });
});

test('a run is skipped when it succeeded with its Build APK job skipped', t => {
  const jobs = (build: string | null) => [
    { name: 'Check for app changes', conclusion: 'success' },
    { name: 'Build APK', conclusion: build },
    { name: 'Publish', conclusion: build },
  ];
  t.true(apkRunSkipped(run(), jobs('skipped')));
  t.false(apkRunSkipped(run(), jobs('success')));
  t.false(apkRunSkipped(run({ conclusion: 'failure' }), jobs('skipped')));
  t.false(
    apkRunSkipped(run({ status: 'in_progress', conclusion: null }), jobs(null))
  );
  t.false(apkRunSkipped(run(), []));
});

test('toApkRun: times, ref and skip', t => {
  t.deepEqual(toApkRun(run({ display_title: 'APK from x (forced)' }), true), {
    id: 7,
    url: 'https://github.com/o/r/actions/runs/7',
    ref: 'x',
    forced: true,
    status: 'completed',
    conclusion: 'success',
    startedAt: '2026-11-13T10:01:00Z',
    durationMs: 24 * 60_000,
    skipped: true,
  });
  t.is(
    toApkRun(run({ status: 'in_progress', conclusion: null })).durationMs,
    null
  );
});

test('parseApkManifest reads the manifest and refuses anything else', t => {
  t.deepEqual(
    parseApkManifest(
      JSON.stringify({
        sha: sha('a'),
        ref: 'main',
        builtAt: '2026-11-13T10:25:00Z',
        runUrl: 'https://github.com/o/r/actions/runs/7',
        size: 176673927,
      })
    ),
    {
      sha: sha('a'),
      ref: 'main',
      builtAt: '2026-11-13T10:25:00Z',
      runUrl: 'https://github.com/o/r/actions/runs/7',
      source: 'manifest',
    }
  );
  t.deepEqual(parseApkManifest(JSON.stringify({ sha: sha('b') })), {
    sha: sha('b'),
    ref: null,
    builtAt: null,
    runUrl: null,
    source: 'manifest',
  });
  t.is(parseApkManifest('<!doctype html><title>404</title>'), null);
  t.is(parseApkManifest('null'), null);
  t.is(parseApkManifest(JSON.stringify({ sha: 'abc1234' })), null);
  t.is(parseApkManifest(JSON.stringify([sha('a')])), null);
});

const release = (over: Partial<GhRelease>): GhRelease => ({
  tag_name: 'android-aaaaaaa',
  target_commitish: sha('a'),
  draft: false,
  prerelease: true,
  created_at: '2026-11-10T00:00:00Z',
  published_at: '2026-11-10T00:00:00Z',
  html_url: 'https://github.com/o/r/releases/tag/android-aaaaaaa',
  ...over,
});

test('publishedFromReleases takes the newest android-* release on a full sha', t => {
  t.deepEqual(
    publishedFromReleases([
      release({ tag_name: 'v0.26.3', published_at: '2026-11-12T00:00:00Z' }),
      release({}),
      release({
        tag_name: 'android-bbbbbbb',
        target_commitish: sha('b'),
        published_at: '2026-11-11T00:00:00Z',
      }),
      release({
        tag_name: 'android-ccccccc',
        target_commitish: 'main',
        published_at: '2026-11-12T00:00:00Z',
      }),
      release({
        tag_name: 'android-ddddddd',
        target_commitish: sha('d'),
        draft: true,
        published_at: null,
        created_at: '2026-11-13T00:00:00Z',
      }),
    ]),
    {
      sha: sha('b'),
      ref: null,
      builtAt: '2026-11-11T00:00:00Z',
      runUrl: null,
      source: 'release',
    }
  );
  t.is(publishedFromReleases([]), null);
});
