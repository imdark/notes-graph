import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Downloads a YouTube video with yt-dlp so a note can keep its own copy (the
 * "Back up video" action). The file is written to a temp dir; the caller
 * streams it back and then calls `cleanup`.
 *
 * Only YouTube video URLs are accepted, one download runs at a time, and the
 * result is capped at `maxBytes`: the sidecar is reachable without auth, so
 * it must not become a general-purpose downloader.
 */

export const DEFAULT_MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const TIMEOUT_MS = Number(process.env.CLIP_VIDEO_TIMEOUT ?? 15 * 60) * 1000;
const YT_DLP = process.env.YT_DLP_BIN ?? 'yt-dlp';

export class VideoDownloadError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

export interface DownloadedVideo {
  path: string;
  title: string;
  size: number;
  cleanup: () => Promise<void>;
}

/** The 11-char id of a YouTube video URL (watch/shorts/live/embed/youtu.be). */
export function youtubeVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const valid = (id: string | null | undefined) =>
    id && /^[\w-]{11}$/.test(id) ? id : null;
  if (host === 'youtu.be') return valid(u.pathname.slice(1).split('/')[0]);
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (u.pathname === '/watch') return valid(u.searchParams.get('v'));
    return valid(
      u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1]
    );
  }
  return null;
}

/**
 * yt-dlp arguments: at most 720p mp4 (video + m4a audio merged by ffmpeg),
 * falling back to a single progressive mp4. The id is passed as a canonical
 * watch URL so nothing from the caller's URL reaches yt-dlp.
 */
export function ytDlpArgs(videoId: string, dir: string, maxBytes: number) {
  return [
    '--no-playlist',
    '--no-progress',
    '--no-update',
    '--js-runtimes',
    'node',
    '-f',
    'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/b[ext=mp4]/b',
    '--merge-output-format',
    'mp4',
    '--max-filesize',
    String(maxBytes),
    '--no-simulate',
    '--print',
    'title',
    '-o',
    join(dir, 'video.%(ext)s'),
    '--',
    `https://www.youtube.com/watch?v=${videoId}`,
  ];
}

// One download at a time: each is CPU/bandwidth heavy on a small box.
let queue: Promise<unknown> = Promise.resolve();

export function downloadYoutubeVideo(
  url: string,
  maxBytes = DEFAULT_MAX_VIDEO_BYTES
): Promise<DownloadedVideo> {
  const videoId = youtubeVideoId(url);
  if (!videoId) {
    return Promise.reject(
      new VideoDownloadError('Not a YouTube video link', 400)
    );
  }
  const run = queue.then(() => download(videoId, maxBytes));
  queue = run.catch(() => undefined);
  return run;
}

async function download(
  videoId: string,
  maxBytes: number
): Promise<DownloadedVideo> {
  const dir = await mkdtemp(join(tmpdir(), 'ng-video-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  try {
    const { stdout, stderr, code } = await exec(
      YT_DLP,
      ytDlpArgs(videoId, dir, maxBytes)
    );
    const file = (await readdir(dir)).find(name => name.endsWith('.mp4'));
    if (code === 0 && !file) {
      // `--print` makes yt-dlp quiet, so a download skipped by
      // --max-filesize shows only as a clean exit that left no file.
      throw new VideoDownloadError(
        'Video is larger than the workspace file limit',
        413
      );
    }
    if (code !== 0 || !file) {
      const reason =
        stderr
          .split('\n')
          .map(line => line.trim())
          .findLast(line => line.startsWith('ERROR')) ??
        `yt-dlp exited with ${code}`;
      throw new VideoDownloadError(
        reason.replace(/^ERROR:\s*/, '').replace(/^\[youtube\] [\w-]+:\s*/, ''),
        422
      );
    }
    const path = join(dir, file);
    const { size } = await stat(path);
    if (size > maxBytes) {
      throw new VideoDownloadError(
        'Video is larger than the workspace file limit',
        413
      );
    }
    const title = stdout.split('\n')[0]?.trim() || videoId;
    return { path, title, size, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

function exec(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => (stdout += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.on('error', err => {
      clearTimeout(timer);
      reject(
        new VideoDownloadError(`Could not run yt-dlp: ${err.message}`, 500)
      );
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}
