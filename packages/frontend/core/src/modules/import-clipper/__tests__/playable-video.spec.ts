import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { addPlayableVideos, youtubeVideoId } from '../utils/playable-video';

const extensions = getStoreManager().config.init().value.get('store');
const SOURCE = 'https://www.linkedin.com/posts/someone_activity-1';

let store: Store;
let noteId: string;

beforeEach(() => {
  const workspace = new TestWorkspace({ id: 'test' });
  workspace.meta.initialize();
  store = workspace.createDoc('doc').getStore({ extensions });
  store.load();
  const pageId = store.addBlock('notesgraph:page', { title: new Text('') });
  noteId = store.addBlock('notesgraph:note', {}, pageId);
});

/** The note as the clip's markdown import leaves it: title, link, text. */
function clippedNote(sourceUrl: string) {
  store.addBlock(
    'notesgraph:paragraph',
    { type: 'h1', text: new Text('A post') },
    noteId
  );
  store.addBlock(
    'notesgraph:paragraph',
    {
      text: new Text([{ insert: 'Original', attributes: { link: sourceUrl } }]),
    },
    noteId
  );
  store.addBlock('notesgraph:paragraph', { text: new Text('Body') }, noteId);
}

const flavours = () =>
  store.getModelById(noteId)!.children.map(child => child.flavour);

describe('youtubeVideoId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0', 'dQw4w9WgXcQ'],
  ])('%s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id);
  });

  test.each([
    'https://www.youtube.com/@channel',
    'https://www.youtube.com/playlist?list=PL123',
    'https://notyoutube.com/watch?v=dQw4w9WgXcQ',
    'https://www.linkedin.com/feed/',
    'not a url',
  ])('%s is not a video', url => {
    expect(youtubeVideoId(url)).toBeNull();
  });
});

describe('addPlayableVideos', () => {
  test('a video file becomes an inline player below the Original link', async () => {
    clippedNote(SOURCE);
    const video = new Blob([new Uint8Array(2048)], { type: 'video/mp4' });

    const [id] = await addPlayableVideos(store, noteId, {
      sourceUrl: SOURCE,
      media: { 'video-0.mp4': video },
    });

    expect(flavours()).toEqual([
      'notesgraph:paragraph',
      'notesgraph:paragraph',
      'notesgraph:attachment',
      'notesgraph:paragraph',
    ]);
    const block = store.getModelById(id)!;
    expect(block.props).toMatchObject({
      name: 'video-0.mp4',
      type: 'video/mp4',
      size: 2048,
      embed: true,
    });
    const sourceId = (block.props as { sourceId: string }).sourceId;
    expect(await store.blobSync.get(sourceId)).toBeTruthy();
  });

  test('a YouTube video page gets its player, titled with the clip', async () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    clippedNote(url);

    const [id] = await addPlayableVideos(store, noteId, {
      sourceUrl: url,
      title: 'Never Gonna Give You Up',
    });

    expect(flavours()[2]).toBe('notesgraph:embed-youtube');
    expect(store.getModelById(id)!.props).toMatchObject({
      url,
      videoId: 'dQw4w9WgXcQ',
      title: 'Never Gonna Give You Up',
    });
  });

  test('YouTube players embedded in a page are kept, once each', async () => {
    clippedNote(SOURCE);

    const ids = await addPlayableVideos(store, noteId, {
      sourceUrl: SOURCE,
      videoEmbeds: [
        'https://www.youtube.com/embed/dQw4w9WgXcQ',
        'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        'https://player.vimeo.com/video/1',
        'https://www.youtube.com/embed/9bZkp7q19f0',
      ],
    });

    expect(ids.map(id => store.getModelById(id)!.props)).toMatchObject([
      { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { url: 'https://www.youtube.com/watch?v=9bZkp7q19f0' },
    ]);
  });

  test('images and pages with no video add nothing', async () => {
    clippedNote(SOURCE);
    const image = new Blob([new Uint8Array(4)], { type: 'image/png' });

    const ids = await addPlayableVideos(store, noteId, {
      sourceUrl: SOURCE,
      media: { 'image-0.png': image },
    });

    expect(ids).toEqual([]);
    expect(flavours()).toHaveLength(3);
  });
});
