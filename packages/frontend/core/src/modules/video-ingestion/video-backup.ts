import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';

import { getLinkCardBaseUrl } from '../link-card';
import { WorkspaceQuotaService } from '../quota';

/**
 * "Back up video": the link-card sidecar downloads a YouTube video with
 * yt-dlp (up to 720p mp4), and the file is saved into the workspace as a
 * playable attachment right below the video's block. The note then keeps the
 * video even if YouTube takes it down.
 *
 * The attachment's caption names the video ("Backup of <watch url>"), which
 * is also how an existing backup is recognized, so backing up twice is a
 * no-op.
 */

const YOUTUBE_FLAVOURS = ['notesgraph:embed-youtube', 'notesgraph:bookmark'];

/** The 11-char video id of a YouTube video URL, or null. */
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

export const backupCaption = (videoId: string) =>
  `Backup of https://www.youtube.com/watch?v=${videoId}`;

const urlOf = (model: BlockModel): string | undefined => {
  const url = (model.props as { url?: unknown }).url;
  return typeof url === 'string' ? url : undefined;
};

/** The YouTube video blocks (embeds and bookmarks) in a doc. */
export function youtubeVideoBlocks(store: Store): BlockModel[] {
  return store.getModelsByFlavour(YOUTUBE_FLAVOURS).filter(model => {
    const url = urlOf(model);
    return !!url && !!youtubeVideoId(url);
  });
}

/** Whether the doc already holds a backup of this video. */
export function hasVideoBackup(store: Store, videoId: string): boolean {
  const caption = backupCaption(videoId);
  return store
    .getModelsByFlavour('notesgraph:attachment')
    .some(model => (model.props as { caption?: string }).caption === caption);
}

/** YouTube blocks in the doc that have no backup yet. */
export function videosWithoutBackup(store: Store): BlockModel[] {
  const seen = new Set<string>();
  return youtubeVideoBlocks(store).filter(model => {
    const id = youtubeVideoId(urlOf(model) ?? '');
    if (!id || seen.has(id) || hasVideoBackup(store, id)) return false;
    seen.add(id);
    return true;
  });
}

export interface DownloadedVideo {
  blob: Blob;
  title: string;
}

/** Download the video through the sidecar. `maxBytes` is the file limit. */
export async function downloadYoutubeVideo(
  url: string,
  maxBytes?: number
): Promise<DownloadedVideo> {
  const params = new URLSearchParams({ url });
  if (maxBytes && maxBytes > 0) params.set('maxBytes', String(maxBytes));
  const res = await fetch(`${getLinkCardBaseUrl()}/clip/video?${params}`);
  if (!res.ok) {
    let message = `Video download failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body: keep the status message
    }
    throw new Error(message);
  }
  const header = res.headers.get('x-video-title');
  let title = 'YouTube video';
  if (header) {
    try {
      title = decodeURIComponent(header);
    } catch {
      title = header;
    }
  }
  return { blob: await res.blob(), title };
}

const fileName = (title: string) =>
  `${
    title
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'YouTube video'
  }.mp4`;

/**
 * The workspace's per-file limit, so the sidecar refuses a video the server
 * would reject on upload anyway. Unknown (a local workspace, or the quota not
 * loaded yet) leaves it to the sidecar's own cap.
 */
export function workspaceFileLimit(
  framework: FrameworkProvider
): number | undefined {
  return (
    framework.getOptional(WorkspaceQuotaService)?.quota.quota$.value
      ?.blobLimit ?? undefined
  );
}

export type BackupResult = 'saved' | 'already-backed-up';

/**
 * Back up the video of one YouTube block: download it, store the blob, and
 * add a playable attachment right below the block.
 */
export async function backupVideoBlock(
  store: Store,
  model: BlockModel,
  maxBytes?: number
): Promise<BackupResult> {
  const url = urlOf(model);
  const videoId = url ? youtubeVideoId(url) : null;
  if (!url || !videoId) throw new Error('Not a YouTube video');
  if (hasVideoBackup(store, videoId)) return 'already-backed-up';

  const { blob, title } = await downloadYoutubeVideo(url, maxBytes);
  const sourceId = await store.blobSync.set(blob);
  // Another backup may have landed while this one downloaded.
  if (hasVideoBackup(store, videoId)) return 'already-backed-up';

  const parent = store.getParent(model);
  if (!parent) throw new Error('The video block was removed');
  store.addBlock(
    'notesgraph:attachment',
    {
      name: fileName(title),
      size: blob.size,
      type: 'video/mp4',
      sourceId,
      embed: true,
      caption: backupCaption(videoId),
    },
    parent,
    parent.children.indexOf(model) + 1
  );
  return 'saved';
}
