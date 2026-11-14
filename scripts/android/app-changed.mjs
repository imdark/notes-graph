#!/usr/bin/env node
// Which changed files affect the Android APK. Reads `git diff --name-only`
// output on stdin, prints the app-affecting ones, and exits 0 when there are
// any, 1 when there are none (2 on a usage error):
//
//   git diff --name-only <published-sha> <sha> | node scripts/android/app-changed.mjs
//
// The list lives in the server's releases module (android.ts) so the
// Deployments screen counts the same changes; Node 22 strips its types.
import { readFileSync } from 'node:fs';

const { appChanges } =
  await import('../../packages/backend/server/src/plugins/registry/releases/android.ts');

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch (err) {
  console.error(`app-changed: can't read stdin: ${err.message}`);
  process.exit(2);
}

const changed = appChanges(input.split('\n'));
for (const file of changed) console.log(file);
process.exit(changed.length > 0 ? 0 : 1);
