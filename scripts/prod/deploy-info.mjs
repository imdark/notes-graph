// What this deploy is, for the Deployments screen to check pull requests
// against: the commit, whether the tree had uncommitted changes on top of it,
// and the pull requests merged into it ("Merge pull request #N" on the
// first-parent line), and the feature flags in it by the commit that added
// each. Written to packages/backend/server/deploy-info.json,
// which the server image copies to /app (core/config/deploy-info.ts).
//
// Run from the repo root, before the server is built: by redeploy.sh on the
// box, and by the deploy workflow before it builds the image.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

import { FLAGS_FILE, readFlags } from '../lib/feature-flags.mjs';

const git = args => execSync(`git ${args}`, { encoding: 'utf8' }).trim();

const isAncestor = commit => {
  try {
    execSync(`git merge-base --is-ancestor ${commit} HEAD`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

// The feature flags this build has, by the commit stamped on each (see
// scripts/stamp-feature-flags.mjs); a stamp that isn't in HEAD's history is
// wrong and left out.
const featureFlags = {};
try {
  for (const flag of readFlags(readFileSync(FLAGS_FILE, 'utf8'))) {
    if (flag.commit && isAncestor(flag.commit)) {
      featureFlags[flag.key] = flag.commit;
    }
  }
} catch {}

const prs = git('log --first-parent --merges -n 500 --format=%s HEAD')
  .split('\n')
  .map(line => /^Merge pull request #(\d+)/.exec(line)?.[1])
  .filter(Boolean)
  .map(Number);
let repo = '';
try {
  // owner/name, as in a pull request URL, from git@ or https remotes.
  repo = git('config --get remote.origin.url')
    .replace(/\.git$/, '')
    .replace(/^.*github\.com[:/]/, '');
} catch {}
// A CI checkout is a detached HEAD; GITHUB_REF_NAME says which branch it is.
const branch =
  process.env.GITHUB_REF_NAME || git('rev-parse --abbrev-ref HEAD');
const record = {
  repo,
  commit: git('rev-parse HEAD'),
  branch,
  subject: git('log -1 --format=%s HEAD'),
  dirty: git('status --porcelain --untracked-files=no') !== '',
  deployedAt: new Date().toISOString(),
  pullRequests: prs,
  featureFlags,
};
writeFileSync(
  'packages/backend/server/deploy-info.json',
  JSON.stringify(record, null, 2)
);
