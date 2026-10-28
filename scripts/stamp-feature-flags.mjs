// Stamps each feature flag with the commit that added it, so the Deployments
// screen and the Feature flags page can tell whether prod's build has it.
//
//   node scripts/stamp-feature-flags.mjs          stamp flags that have none
//   node scripts/stamp-feature-flags.mjs --check  list them, exit 1 if any
//
// Commit the new flag first, then run this and commit the stamp. Pull
// requests here are merged with a merge commit, so the commit keeps its hash
// on main and in every deploy after.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { FLAGS_FILE, readFlags } from './lib/feature-flags.mjs';

const check = process.argv.includes('--check');
const text = readFileSync(FLAGS_FILE, 'utf8');
const missing = readFlags(text).filter(flag => !flag.commit);

if (missing.length === 0) {
  console.log('Every feature flag has its commit.');
  process.exit(0);
}
if (check) {
  console.error(
    `No commit on: ${missing.map(flag => flag.key).join(', ')}. ` +
      'Commit the flag, then run node scripts/stamp-feature-flags.mjs.'
  );
  process.exit(1);
}

/** The oldest commit whose diff adds or removes the flag's entry. */
const addedIn = key =>
  execFileSync(
    'git',
    ['log', '--format=%H', '--reverse', '-S', `  ${key}: {`, '--', FLAGS_FILE],
    { encoding: 'utf8' }
  )
    .split('\n')[0]
    .trim();

const lines = text.split('\n');
const unstamped = [];
// Bottom up, so inserting a line leaves the earlier entries' lines as read.
for (const flag of [...missing].reverse()) {
  const commit = addedIn(flag.key);
  if (!commit) {
    unstamped.push(flag.key);
    continue;
  }
  // An empty `commit: ''` placeholder is replaced; otherwise one is added.
  const placeholder = lines.findIndex(
    (line, i) => i > flag.line && line === "    commit: '',"
  );
  const next = lines.findIndex(
    (line, i) => i > flag.line && /^ {2}\},?$/.test(line)
  );
  if (placeholder !== -1 && placeholder < next) {
    lines[placeholder] = `    commit: '${commit}',`;
  } else {
    lines.splice(flag.line + 1, 0, `    commit: '${commit}',`);
  }
  console.log(`${flag.key}: ${commit.slice(0, 7)}`);
}
writeFileSync(FLAGS_FILE, lines.join('\n'));

if (unstamped.length > 0) {
  console.error(
    `Not in any commit yet: ${unstamped.join(', ')}. Commit them, then run this again.`
  );
  process.exit(1);
}
