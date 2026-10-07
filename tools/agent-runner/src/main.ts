/**
 * The cloud agent runner: runs NotesGraph agent jobs on the server the way
 * `wf agent serve` runs them on a Mac. See scripts/prod/agent-runner.md.
 */
import { mkdir } from 'node:fs/promises';
import { hostname } from 'node:os';

import { query } from '@anthropic-ai/claude-agent-sdk';

import { NotesGraphApi } from './api';
import { serve } from './serve';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`agent-runner: ${name} is required`);
    process.exit(2);
  }
  return value;
}

const api = new NotesGraphApi(required('RUNNER_NG_URL'), required('RUNNER_NG_TOKEN'));
const workspaces = required('RUNNER_WORKSPACES').split(',').map(w => w.trim()).filter(Boolean);
const deviceKey = process.env.RUNNER_DEVICE_KEY?.trim() || 'cloud';
const log = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

// HOME may be on the work volume (the image puts it there), fresh on first start.
if (process.env.HOME) await mkdir(process.env.HOME, { recursive: true });

// The device agents pick to run here. Registering is idempotent; it also
// keeps the name and the agent-target opt-in as they should be.
for (const workspaceId of workspaces) {
  await api.register(workspaceId, {
    key: deviceKey,
    name: process.env.RUNNER_DEVICE_NAME?.trim() || 'Cloud (server)',
    kind: 'machine',
    agentTarget: true,
    labels: { runner: 'cloud' },
  });
}

const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log(`${signal}: finishing running jobs`);
    stop.abort();
  });
}

log(`serving ${deviceKey} for ${workspaces.length} workspace(s)`);
await serve({
  api,
  workspaces,
  deviceKey,
  runnerId: `cloud-${hostname()}-${Math.floor(Date.now() / 1000)}`,
  query,
  maxJobs: Number(process.env.RUNNER_MAX_JOBS ?? 2),
  settings: {
    workRoot: process.env.RUNNER_WORK_ROOT?.trim() || '/work',
    repo: process.env.RUNNER_REPO?.trim() || undefined,
    repoBranch: process.env.RUNNER_REPO_BRANCH?.trim() || 'main',
    omniseekUrl: process.env.OMNISEEK_URL?.trim() || undefined,
    omniseekToken: process.env.OMNISEEK_TOKEN?.trim() || undefined,
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    ghToken: process.env.GH_TOKEN?.trim() || undefined,
  },
  log,
  signal: stop.signal,
});
log('stopped');
