#!/usr/bin/env node
// Thin launcher: run the TS entry through tsx. Primary path is the workspace
// script `yarn workspace @notesgraph/ngraph ngraph`.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, '..', 'src', 'index.ts');
const res = spawnSync('node', ['--import', 'tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
process.exit(res.status ?? 1);
