/**
 * A job's own directory under the work root. What goes in it (a worktree of
 * the repo, downloaded sources) is the job's automation; see automation.ts.
 */
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface Workdir {
  path: string;
  /** Remove it once the job is over. */
  dispose(): Promise<void>;
}

export async function jobDir(root: string, jobId: string): Promise<Workdir> {
  const path = join(root, 'jobs', jobId);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
  return { path, dispose: () => rm(path, { recursive: true, force: true }) };
}
