import type { GhJob, GhRelease, GhRun } from './github';

/**
 * The Android APK the download page serves, as the Deployments screen shows
 * it: what .github/workflows/build-apk.yml is doing, and which commit the
 * published APK was built from. The rules here are pure; the service reads
 * GitHub and the download manifest and hands them in.
 *
 * Which files make the app: scripts/android/app-changed.mjs imports this
 * file (Node strips its types), so the workflow's skip and the screen's "N
 * app changes since" apply the same list. Keep it free of runtime imports.
 */

export const APK_WORKFLOW_FILE = 'build-apk.yml';
/** The manifest build-apk.yml writes next to the APK on the box. */
export const APK_MANIFEST_URL =
  'https://notesgraph.com/download/notesgraph-android.json';
/** The GitHub releases that carry the APKs: android-<sha7>. */
export const APK_RELEASE_PREFIX = 'android-';
/** The build-apk.yml job a skipped run skips. */
export const APK_BUILD_JOB = 'Build APK';

// ── which changes make a new APK ───────────────────────────────────────────

/** Paths (prefixes, or exact files) that go into the APK. */
export const APP_PATH_PREFIXES = [
  'packages/frontend/',
  'blocksuite/',
  'packages/common/',
  'tools/cli/',
];
export const APP_PATH_FILES = ['yarn.lock', 'package.json'];
/** Under an app prefix, but not in the APK. */
export const NON_APP_PATH_PREFIXES = ['packages/frontend/admin/'];

/** Whether a changed file (a repo-relative path) affects the APK. */
export function isAppPath(path: string): boolean {
  const file = path.trim().replace(/^\.\//, '');
  if (!file) return false;
  if (APP_PATH_FILES.includes(file)) return true;
  if (NON_APP_PATH_PREFIXES.some(prefix => file.startsWith(prefix))) {
    return false;
  }
  return APP_PATH_PREFIXES.some(prefix => file.startsWith(prefix));
}

/** The changed files that affect the APK, each once, in order. */
export function appChanges(files: Iterable<string>): string[] {
  const seen = new Set<string>();
  for (const file of files) {
    const path = file.trim();
    if (isAppPath(path)) seen.add(path);
  }
  return [...seen];
}

// ── runs ───────────────────────────────────────────────────────────────────

const TITLE_RE = /^APK from (\S+)( \(forced\))?$/;

/** A run's ref and whether it was forced, from its title (the run-name). */
export function labelApkRun(run: Pick<GhRun, 'display_title'>): {
  ref: string | null;
  forced: boolean;
} {
  const match = TITLE_RE.exec(run.display_title ?? '');
  return { ref: match?.[1] ?? null, forced: !!match?.[2] };
}

/**
 * Whether a finished run decided there was nothing to build: it succeeded
 * with its Build APK job skipped (the change check found no app changes).
 */
export function apkRunSkipped(
  run: Pick<GhRun, 'status' | 'conclusion'>,
  jobs: Pick<GhJob, 'name' | 'conclusion'>[]
): boolean {
  if (run.status !== 'completed' || run.conclusion !== 'success') return false;
  const build = jobs.find(job => job.name === APK_BUILD_JOB);
  return build?.conclusion === 'skipped';
}

export interface ApkRun {
  id: number;
  url: string;
  /** What it was asked to build (a branch or a commit); null if untitled. */
  ref: string | null;
  forced: boolean;
  status: string;
  conclusion: string | null;
  startedAt: string;
  durationMs: number | null;
  /** It ended without building: no app changes since the published APK. */
  skipped: boolean;
}

export function toApkRun(run: GhRun, skipped = false): ApkRun {
  const startedAt = run.run_started_at ?? run.created_at;
  const durationMs =
    run.status === 'completed'
      ? Math.max(0, Date.parse(run.updated_at) - Date.parse(startedAt))
      : null;
  const { ref, forced } = labelApkRun(run);
  return {
    id: run.id,
    url: run.html_url,
    ref,
    forced,
    status: run.status ?? 'unknown',
    conclusion: run.conclusion,
    startedAt,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    skipped,
  };
}

// ── the published APK ──────────────────────────────────────────────────────

export interface ApkPublished {
  /** The commit the APK was built from. */
  sha: string;
  /** What the build was asked for (a branch or commit), when known. */
  ref: string | null;
  builtAt: string | null;
  runUrl: string | null;
  /** Where this was read: the download manifest, or the GitHub release. */
  source: 'manifest' | 'release';
}

const FULL_SHA_RE = /^[0-9a-f]{40}$/;
const str = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

/**
 * The download manifest (notesgraph-android.json) build-apk.yml writes:
 * `{sha, ref, builtAt, runUrl, ...}`. Null for anything else, such as the
 * site's HTML 404 page.
 */
export function parseApkManifest(text: string): ApkPublished | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const sha = str(record.sha);
  if (!sha || !FULL_SHA_RE.test(sha)) return null;
  return {
    sha,
    ref: str(record.ref),
    builtAt: str(record.builtAt),
    runUrl: str(record.runUrl),
    source: 'manifest',
  };
}

/**
 * The newest android-* GitHub release as the published APK: build-apk.yml
 * creates it on the commit it built, so its target is that commit.
 */
export function publishedFromReleases(
  releases: GhRelease[]
): ApkPublished | null {
  const ours = releases
    .filter(
      release =>
        release.tag_name.startsWith(APK_RELEASE_PREFIX) &&
        !release.draft &&
        FULL_SHA_RE.test(release.target_commitish)
    )
    .sort(
      (a, b) =>
        Date.parse(b.published_at ?? b.created_at) -
        Date.parse(a.published_at ?? a.created_at)
    );
  const newest = ours[0];
  if (!newest) return null;
  return {
    sha: newest.target_commitish,
    ref: null,
    builtAt: newest.published_at ?? newest.created_at,
    runUrl: null,
    source: 'release',
  };
}

// ── the screen's view ──────────────────────────────────────────────────────

export interface AndroidState {
  workflowFile: string;
  /** The newest build-apk.yml run; null when it has none. */
  run: ApkRun | null;
  /** A run is queued or going. */
  building: boolean;
  /** The APK the download page serves, when it is known. */
  published: ApkPublished | null;
  /**
   * App-affecting files the deploy branch changed since the published APK's
   * commit; null when that can't be told.
   */
  pendingChanges: number | null;
  /** Why it couldn't be read (the workflow isn't on GitHub yet, say). */
  error: string | null;
}

export const emptyAndroidState = (): AndroidState => ({
  workflowFile: APK_WORKFLOW_FILE,
  run: null,
  building: false,
  published: null,
  pendingChanges: null,
  error: null,
});
