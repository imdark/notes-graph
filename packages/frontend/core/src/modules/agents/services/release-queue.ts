import { LiveData } from '@notesgraph/infra';

/**
 * Where a job on the release screen's queue stands: waiting its turn,
 * holding for a running deploy to end, or under way.
 */
export type ReleaseJobStatus = 'queued' | 'waiting' | 'running';

export type ReleaseJobKind =
  | 'merge'
  | 'close'
  | 'release'
  | 'redeploy'
  | 'rollback'
  | 'retry'
  | 'apk';

/** A job on the queue, as the screen shows it. */
export interface ReleaseJob {
  id: number;
  kind: ReleaseJobKind;
  /** What the queue lists, e.g. "Merge #12 Fix the sidebar". */
  label: string;
  /** Names a one-of-a-kind job: while one with the key is queued, another isn't added. */
  key: string | null;
  /** The pull requests it acts on, so their rows can say so. */
  prs: number[];
  /** Holds while a deploy runs (a release: the server refuses one then). */
  afterDeploy: boolean;
  status: ReleaseJobStatus;
}

export interface ReleaseJobSpec {
  kind: ReleaseJobKind;
  label: string;
  key?: string;
  prs?: number[];
  afterDeploy?: boolean;
  /** Does the job and says how it went; a throw is dropped, not retried. */
  run: () => Promise<void>;
}

/** How many jobs are on the queue, and how many of them merge. */
export const queueAhead = (jobs: readonly ReleaseJob[]) => ({
  jobs: jobs.length,
  merges: jobs.filter(job => job.kind === 'merge').length,
});

/** The pull requests queued jobs act on, by number. */
export const queuedPulls = (jobs: readonly ReleaseJob[]) =>
  new Map(jobs.flatMap(job => job.prs.map(pr => [pr, job] as const)));

/** How often a job held for a deploy reads the state again. */
export const RELEASE_QUEUE_WAIT_MS = 15_000;

/**
 * The release screen's actions, run one at a time in the order they were
 * asked for, so a merge or release can be queued while another is under
 * way. A job held for a deploy lets the ones after it that don't need to
 * wait go first; once the deploy ends it is next, before newer jobs.
 */
export class ReleaseActionQueue {
  readonly jobs$ = new LiveData<ReleaseJob[]>([]);

  private nextId = 1;
  private readonly runs = new Map<number, () => Promise<void>>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private readonly deps: {
      /** Whether a deploy runs, as last read. */
      deployRunning: () => boolean;
      /** Read the state again from GitHub. */
      refresh: () => Promise<void>;
      waitMs?: number;
    }
  ) {}

  /** Whether a job with `key` is queued or under way. */
  has(key: string): boolean {
    return this.jobs$.value.some(job => job.key === key);
  }

  /** Queue a job; false when one with its key already is. */
  add(spec: ReleaseJobSpec): boolean {
    if (this.disposed || (spec.key && this.has(spec.key))) return false;
    const id = this.nextId++;
    this.runs.set(id, spec.run);
    this.jobs$.setValue([
      ...this.jobs$.value,
      {
        id,
        kind: spec.kind,
        label: spec.label,
        key: spec.key ?? null,
        prs: spec.prs ?? [],
        afterDeploy: !!spec.afterDeploy,
        status: 'queued',
      },
    ]);
    this.pump();
    return true;
  }

  /** Take a job off the queue before it starts; one under way runs on. */
  cancel(id: number) {
    const job = this.jobs$.value.find(candidate => candidate.id === id);
    if (!job || job.status === 'running') return;
    this.remove(id);
    this.pump();
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.runs.clear();
    this.jobs$.setValue([]);
  }

  private remove(id: number) {
    this.runs.delete(id);
    this.jobs$.setValue(this.jobs$.value.filter(job => job.id !== id));
  }

  private setStatus(id: number, status: ReleaseJobStatus) {
    this.jobs$.setValue(
      this.jobs$.value.map(job => (job.id === id ? { ...job, status } : job))
    );
  }

  /** Start the first job that may go, or wait for the deploy to end. */
  private pump() {
    if (this.running || this.disposed) return;
    const deploying = this.deps.deployRunning();
    const jobs = this.jobs$.value.map(job => {
      const status: ReleaseJobStatus =
        job.afterDeploy && deploying ? 'waiting' : 'queued';
      return job.status === status ? job : { ...job, status };
    });
    if (jobs.some((job, i) => job !== this.jobs$.value[i])) {
      this.jobs$.setValue(jobs);
    }
    const next = jobs.find(job => job.status === 'queued');
    if (next) {
      this.start(next).catch(() => {});
    } else if (jobs.length > 0) {
      this.waitForDeploy();
    }
  }

  private waitForDeploy() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.deps
        .refresh()
        .catch(() => {})
        .finally(() => this.pump());
    }, this.deps.waitMs ?? RELEASE_QUEUE_WAIT_MS);
  }

  private async start(job: ReleaseJob) {
    this.running = true;
    this.setStatus(job.id, 'running');
    try {
      if (job.afterDeploy) {
        // What was read may be a minute old; a deploy may have started.
        await this.deps.refresh().catch(() => {});
        if (this.deps.deployRunning()) {
          this.setStatus(job.id, 'waiting');
          return;
        }
      }
      await this.runs.get(job.id)?.();
      this.remove(job.id);
    } catch {
      this.remove(job.id);
    } finally {
      this.running = false;
      this.pump();
    }
  }
}
