import {
  AttachmentBlockSchema,
  EmbedYoutubeBlockSchema,
} from '@blocksuite/notesgraph/model';
import type { BlockModel, Store } from '@blocksuite/notesgraph/store';

/** YouTube embeds kept per clip; a page with more is a playlist or a feed. */
const MAX_YOUTUBE_EMBEDS = 4;

const YOUTUBE_HOST =
  /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/;
const VIDEO_ID = /^[\w-]{11}$/;

/**
 * The video id of a YouTube watch, short, live, embed or youtu.be link; null
 * for anything else (a channel, a playlist, another site).
 */
export function youtubeVideoId(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  let id: string | null = null;
  if (u.hostname === 'youtu.be') {
    id = u.pathname.split('/')[1] ?? null;
  } else if (YOUTUBE_HOST.test(u.hostname)) {
    const [, first, second] = u.pathname.split('/');
    if (first === 'watch') id = u.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(first)) id = second;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

/** Video and audio files play in the note; they are not markdown images. */
export function isPlayableMedia(blob: Blob) {
  return /^(video|audio)\//.test(blob.type || '');
}

export interface PlayableVideos {
  /** The page the clip came from. A YouTube video page gets its player. */
  sourceUrl?: string;
  /** Title for the source page's own player. */
  title?: string;
  /** YouTube players found on the page (iframe src or link). */
  videoEmbeds?: string[];
  /** Downloaded or recorded video and audio files, by file name. */
  media?: Record<string, Blob>;
}

/**
 * The block the players go after: the clip's "Original" link to the source,
 * else the title heading. -1 puts them first.
 */
function anchorIndex(children: BlockModel[], sourceUrl?: string) {
  if (sourceUrl) {
    const i = children.findIndex(child =>
      child.text?.toDelta().some(op => op.attributes?.link === sourceUrl)
    );
    if (i >= 0) return i;
  }
  const first = children[0];
  return first?.flavour === 'notesgraph:paragraph' &&
    /^h\d$/.test((first.props as { type?: string }).type ?? '')
    ? 0
    : -1;
}

/**
 * Puts a clip's video into the note as something that plays there: each
 * video or audio file as an inline player (an embedded attachment, the bytes
 * kept as a workspace blob), and each YouTube video as YouTube's own player,
 * since its file can't be downloaded. They go right below the link to the
 * original page. Returns the ids of the blocks added.
 */
export async function addPlayableVideos(
  store: Store,
  noteId: string,
  { sourceUrl, title, videoEmbeds = [], media = {} }: PlayableVideos
): Promise<string[]> {
  const note = store.getModelById(noteId);
  if (!note) return [];

  const files: { name: string; blob: Blob; sourceId: string }[] = [];
  for (const [path, blob] of Object.entries(media)) {
    if (!isPlayableMedia(blob)) continue;
    const name = path.split('/').pop() || path;
    const file =
      blob instanceof File ? blob : new File([blob], name, { type: blob.type });
    files.push({ name, blob, sourceId: await store.blobSync.set(file) });
  }

  const youtube: { url: string; videoId: string; title?: string }[] = [];
  const seen = new Set<string>();
  const sourceVideoId = sourceUrl ? youtubeVideoId(sourceUrl) : null;
  if (sourceUrl && sourceVideoId) {
    seen.add(sourceVideoId);
    youtube.push({ url: sourceUrl, videoId: sourceVideoId, title });
  }
  for (const url of videoEmbeds) {
    if (youtube.length >= MAX_YOUTUBE_EMBEDS) break;
    const videoId = youtubeVideoId(url);
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    youtube.push({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      videoId,
    });
  }

  if (!files.length && !youtube.length) return [];

  let index = anchorIndex(note.children, sourceUrl) + 1;
  const ids: string[] = [];
  store.transact(() => {
    for (const { name, blob, sourceId } of files) {
      ids.push(
        store.addBlock(
          AttachmentBlockSchema.model.flavour,
          {
            name,
            size: blob.size,
            type: blob.type,
            sourceId,
            embed: true,
          },
          noteId,
          index++
        )
      );
    }
    for (const video of youtube) {
      ids.push(
        store.addBlock(
          EmbedYoutubeBlockSchema.model.flavour,
          {
            url: video.url,
            videoId: video.videoId,
            title: video.title ?? null,
          },
          noteId,
          index++
        )
      );
    }
  });
  return ids;
}
