#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

spawnSync('yarn', ['r', 'notesgraph.ts', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
