import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  backupCaption,
  backupVideoBlock,
  hasVideoBackup,
  videosWithoutBackup,
  youtubeVideoId,
} from '../video-backup';

vi.mock('../../link-card', () => ({
  getLinkCardBaseUrl: () => 'https://sidecar.test',
}));
vi.mock('../../quota', () => ({ WorkspaceQuotaService: class {} }));

interface FakeModel {
  id: string;
  flavour: string;
  props: Record<string, unknown>;
  children: FakeModel[];
}

function fakeStore(blocks: FakeModel[]) {
  const note: FakeModel = {
    id: 'note',
    flavour: 'notesgraph:note',
    props: {},
    children: [...blocks],
  };
  const added: {
    flavour: string;
    props: Record<string, unknown>;
    index: number;
  }[] = [];
  const store = {
    getModelsByFlavour: (flavours: string | string[]) => {
      const list = Array.isArray(flavours) ? flavours : [flavours];
      return note.children.filter(child => list.includes(child.flavour));
    },
    getParent: (model: FakeModel) =>
      note.children.includes(model) ? note : null,
    addBlock: (
      flavour: string,
      props: Record<string, unknown>,
      _parent: FakeModel,
      index: number
    ) => {
      added.push({ flavour, props, index });
      note.children.splice(index, 0, {
        id: `added-${added.length}`,
        flavour,
        props,
        children: [],
      });
    },
    blobSync: { set: vi.fn(async () => 'blob-1') },
  };
  return {
    store: store as unknown as Store,
    note,
    added,
    blobSync: store.blobSync,
  };
}

const youtube = (id: string, url: string): FakeModel => ({
  id,
  flavour: 'notesgraph:embed-youtube',
  props: { url },
  children: [],
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('youtubeVideoId', () => {
  test.each([
    ['https://www.youtube.com/watch?v=jNQXAC9IVRw', 'jNQXAC9IVRw'],
    ['https://youtu.be/jNQXAC9IVRw?t=3', 'jNQXAC9IVRw'],
    ['https://m.youtube.com/shorts/jNQXAC9IVRw', 'jNQXAC9IVRw'],
    ['https://www.youtube-nocookie.com/embed/jNQXAC9IVRw', 'jNQXAC9IVRw'],
    ['https://www.youtube.com/channel/UC123', null],
    ['https://vimeo.com/123', null],
    ['not a url', null],
  ])('%s → %s', (url, id) => {
    expect(youtubeVideoId(url)).toBe(id);
  });
});

describe('finding videos to back up', () => {
  test('skips videos already backed up and repeats of the same video', () => {
    const { store } = fakeStore([
      youtube('a', 'https://www.youtube.com/watch?v=aaaaaaaaaaa'),
      youtube('a2', 'https://youtu.be/aaaaaaaaaaa'),
      youtube('b', 'https://www.youtube.com/watch?v=bbbbbbbbbbb'),
      {
        id: 'bookmark',
        flavour: 'notesgraph:bookmark',
        props: { url: 'https://example.com/' },
        children: [],
      },
      {
        id: 'backup-b',
        flavour: 'notesgraph:attachment',
        props: { caption: backupCaption('bbbbbbbbbbb') },
        children: [],
      },
    ]);
    expect(hasVideoBackup(store, 'bbbbbbbbbbb')).toBe(true);
    expect(hasVideoBackup(store, 'aaaaaaaaaaa')).toBe(false);
    expect(videosWithoutBackup(store).map(model => model.id)).toEqual(['a']);
  });
});

describe('backupVideoBlock', () => {
  test('downloads the video and adds a playable attachment below the link', async () => {
    const video = youtube('a', 'https://youtu.be/aaaaaaaaaaa');
    const { store, added } = fakeStore([
      video,
      youtube('b', 'https://youtu.be/bbbbbbbbbbb'),
    ]);
    const fetchMock = vi.fn(
      async (_input: string) =>
        new Response(new Blob(['mp4 bytes'], { type: 'video/mp4' }), {
          headers: {
            'x-video-title': encodeURIComponent('Me at the zoo: 1/2'),
          },
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await backupVideoBlock(
      store,
      video as unknown as BlockModel,
      100 * 1024 * 1024
    );

    expect(result).toBe('saved');
    const requested = new URL(fetchMock.mock.calls[0][0]);
    expect(requested.origin + requested.pathname).toBe(
      'https://sidecar.test/clip/video'
    );
    expect(requested.searchParams.get('url')).toBe(
      'https://youtu.be/aaaaaaaaaaa'
    );
    expect(requested.searchParams.get('maxBytes')).toBe(
      String(100 * 1024 * 1024)
    );
    expect(added).toEqual([
      {
        flavour: 'notesgraph:attachment',
        index: 1,
        props: {
          name: 'Me at the zoo 1 2.mp4',
          size: 9,
          type: 'video/mp4',
          sourceId: 'blob-1',
          embed: true,
          caption: backupCaption('aaaaaaaaaaa'),
        },
      },
    ]);

    // A second backup of the same video does nothing.
    expect(await backupVideoBlock(store, video as unknown as BlockModel)).toBe(
      'already-backed-up'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('passes on the sidecar error and adds nothing', async () => {
    const video = youtube('a', 'https://youtu.be/aaaaaaaaaaa');
    const { store, added, blobSync } = fakeStore([video]);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'Video unavailable' }), {
            status: 422,
          })
      )
    );
    await expect(
      backupVideoBlock(store, video as unknown as BlockModel)
    ).rejects.toThrow('Video unavailable');
    expect(added).toEqual([]);
    expect(blobSync.set).not.toHaveBeenCalled();
  });
});
