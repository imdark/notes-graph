import test from 'ava';

import { parseBranchName, parseRepoName } from '../jobs';

test('repo names are owner/name', t => {
  t.is(parseRepoName('imdark/notes-graph'), 'imdark/notes-graph');
  t.is(parseRepoName(' a.b/c_d-e '), 'a.b/c_d-e');
  t.is(parseRepoName('notes-graph'), null);
  t.is(parseRepoName('a/b/c'), null);
  t.is(parseRepoName('a/b; rm -rf /'), null);
  t.is(parseRepoName(undefined), null);
});

test('branch names take what git would, and no shell', t => {
  t.is(parseBranchName('stage'), 'stage');
  t.is(parseBranchName(' release/2026-10 '), 'release/2026-10');
  t.is(parseBranchName(''), null);
  t.is(parseBranchName('-x'), null);
  t.is(parseBranchName('a..b'), null);
  t.is(parseBranchName('a/'), null);
  t.is(parseBranchName('main.lock'), null);
  t.is(parseBranchName('main; echo'), null);
  t.is(parseBranchName('$(id)'), null);
  t.is(parseBranchName(3), null);
});
