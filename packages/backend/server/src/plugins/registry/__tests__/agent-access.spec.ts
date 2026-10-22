import test from 'ava';

import { alwaysAsks, parseAccess, profileFor } from '../agent-profiles';
import { monthStart } from '../jobs';

const bash = (command: string) => JSON.stringify({ command });

test('a level narrows or widens the profile it starts from', t => {
  const base = profileFor('claude-code')!;
  t.true(base.allowedTools.includes('mcp__notesgraph'));

  const read = profileFor('claude-code', undefined, 'read')!;
  t.false(read.allowedTools.includes('mcp__notesgraph'));
  t.true(read.allowedTools.includes('mcp__notesgraph__read_document'));
  t.false(read.allowedTools.includes('mcp__notesgraph__update_document'));
  t.true(read.allowedTools.includes('WebSearch'));

  t.deepEqual(
    profileFor('claude-code', undefined, 'write')!.allowedTools,
    base.allowedTools
  );

  const manage = profileFor('claude-code', undefined, 'manage')!;
  t.true(manage.allowedTools.includes('Edit'));
  t.false(manage.allowedTools.includes('Bash'));

  // Research keeps OmniSeek, which only reads, at every level.
  t.true(
    profileFor('research', undefined, 'read')!.allowedTools.includes(
      'mcp__omniseek'
    )
  );
});

test('an unknown level leaves the profile as it is', t => {
  t.is(parseAccess('root'), null);
  t.deepEqual(
    profileFor('claude-code', undefined, 'root'),
    profileFor('claude-code')
  );
  t.is(profileFor('command', undefined, 'full'), null);
});

test('deploying, spending and deleting always ask', t => {
  for (const command of [
    'scripts/deploy-bg.sh prod',
    'gh pr merge 12 --squash',
    'npm publish',
    'rm -rf build',
    'git push --force origin main',
    'git push origin --delete old-branch',
    'git reset --hard origin/main',
    'kubectl delete pod web-1',
    'terraform apply',
    'curl -X DELETE https://api.example.com/things/1',
  ]) {
    t.true(alwaysAsks('Allow Bash?', bash(command)), command);
  }
  t.true(alwaysAsks('Allow mcp__stripe__create_payment?', '{}'));
  t.true(alwaysAsks('Allow mcp__github__delete_file?', '{}'));
});

test('pushing a branch and everyday work are covered by "Allow all"', t => {
  for (const command of [
    'git push -u origin feat/x',
    'wf done --task PERSONAL-114',
    'yarn vitest --run',
    'rm notes.tmp',
    'curl https://example.com',
  ]) {
    t.false(alwaysAsks('Allow Bash?', bash(command)), command);
  }
  t.false(
    alwaysAsks('Allow Edit?', JSON.stringify({ file_path: 'deploy.md' }))
  );
  t.false(alwaysAsks('Allow mcp__notesgraph__update_document?', '{}'));
  t.false(alwaysAsks('What should I name it?', null));
});

test('the budget month starts on the 1st, UTC', t => {
  t.is(
    monthStart(new Date('2026-10-14T23:30:00-07:00')).toISOString(),
    '2026-10-01T00:00:00.000Z'
  );
});
