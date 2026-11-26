import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import test from 'ava';

import { keepUnpushed } from '../agent-profiles';

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

/** A bare origin and a clone of it on branch `task`, as a run leaves them. */
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'keep-unpushed-'));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin]);
  execFileSync('git', ['clone', '-q', origin, work]);
  git(work, 'config', 'user.email', 'run@example.com');
  git(work, 'config', 'user.name', 'run');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'base');
  git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(work, 'checkout', '-q', '-b', 'task');
  return { root, origin, work };
}

/** Run the step as the runner does: `sh -c` with {cache} filled in. */
function runStep(dir: string, cache: string) {
  const step = keepUnpushed(dir);
  return execFileSync('sh', ['-c', step.run.replaceAll('{cache}', cache)], {
    encoding: 'utf8',
  });
}

test('pushes a branch whose commits no origin branch has', t => {
  const { root, origin, work } = setup();
  t.teardown(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(work, 'fix.txt'), 'the fix\n');
  git(work, 'add', 'fix.txt');
  git(work, 'commit', '-q', '-m', 'fix: the fix');

  const out = runStep(work, root);

  t.regex(out, /pushed 1 unpushed commit\(s\) to task/);
  t.is(git(origin, 'rev-parse', 'task'), git(work, 'rev-parse', 'HEAD'));
});

test('does nothing when the run pushed, or committed nothing', t => {
  const { root, origin, work } = setup();
  t.teardown(() => rmSync(root, { recursive: true, force: true }));

  // Nothing beyond the base.
  t.is(runStep(work, root), '');
  t.throws(() => git(origin, 'rev-parse', '--verify', '-q', 'task'));

  // Committed and pushed already.
  git(work, 'commit', '-q', '--allow-empty', '-m', 'done');
  git(work, 'push', '-q', 'origin', 'HEAD:refs/heads/task');
  git(work, 'fetch', '-q', 'origin');
  t.is(runStep(work, root), '');
});

test('a checkout that is already gone is not an error', t => {
  const root = mkdtempSync(join(tmpdir(), 'keep-unpushed-'));
  t.teardown(() => rmSync(root, { recursive: true, force: true }));
  t.throws(() => runStep(join(root, 'missing'), root));
  // It fails quietly; the step is optional, so the teardown carries on.
  t.true(keepUnpushed('x').optional);
});

test('commits what the run left uncommitted, then pushes it (CLOUD-148)', t => {
  const { root, origin, work } = setup();
  t.teardown(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(work, 'shared-deps.sh'), 'echo install\n');

  const out = runStep(work, root);

  t.regex(out, /committed the changes the run left uncommitted/);
  t.regex(out, /pushed 1 unpushed commit\(s\) to task/);
  t.is(
    git(origin, 'log', '-1', '--format=%s', 'task'),
    'wip: work the run left uncommitted'
  );
  t.is(git(origin, 'show', 'task:shared-deps.sh'), 'echo install');
});
