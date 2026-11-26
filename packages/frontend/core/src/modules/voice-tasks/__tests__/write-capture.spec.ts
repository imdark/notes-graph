import { type Store, Text } from '@blocksuite/notesgraph/store';
import { TestWorkspace } from '@blocksuite/notesgraph/store/test';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { beforeEach, describe, expect, test } from 'vitest';

import { addCaptureRecording } from '../utils/capture-recording';
import { writeCapture } from '../utils/write-capture';

const extensions = getStoreManager().config.init().value.get('store');

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

const lines = () =>
  store.getModelById(noteId)!.children.map(model => model.text?.toString());

describe('writeCapture', () => {
  test('writes one bullet per non-blank line', () => {
    writeCapture(store, 'Call the plumber\n\n  buy milk  \n');

    expect(lines()).toEqual(['Call the plumber', 'buy milk']);
    for (const child of store.getModelById(noteId)!.children) {
      expect(child.flavour).toBe('notesgraph:list');
      expect((child.props as { type: string }).type).toBe('bulleted');
    }
  });

  test("replaces the new note's empty paragraph with bullets", () => {
    store.addBlock('notesgraph:paragraph', {}, noteId);

    writeCapture(store, 'one');

    expect(lines()).toEqual(['one']);
    expect(store.getModelById(noteId)!.children[0].flavour).toBe(
      'notesgraph:list'
    );
  });

  test('edits lines in place and keeps their blocks', () => {
    writeCapture(store, 'one\ntwo');
    const [first, second] = store.getModelById(noteId)!.children;

    writeCapture(store, 'one\ntwo more\nthree');

    const children = store.getModelById(noteId)!.children;
    expect(lines()).toEqual(['one', 'two more', 'three']);
    expect(children[0]).toBe(first);
    expect(children[1]).toBe(second);
  });

  test('removes lines that were deleted', () => {
    writeCapture(store, 'one\ntwo\nthree');

    writeCapture(store, 'one');

    expect(lines()).toEqual(['one']);
  });

  test('keeps attachments, the recordings', () => {
    store.addBlock(
      'notesgraph:attachment',
      { name: 'a.webm', type: 'audio/webm' },
      noteId
    );

    writeCapture(store, 'one\ntwo');
    writeCapture(store, 'one');

    expect(
      store.getModelById(noteId)!.children.map(model => model.flavour)
    ).toEqual(['notesgraph:attachment', 'notesgraph:list']);
  });
});

describe('addCaptureRecording', () => {
  const at = new Date(2026, 10, 25, 9, 5);
  const audio = (type = 'audio/webm;codecs=opus') =>
    new Blob([new Uint8Array([1, 2, 3])], { type });
  const children = () => store.getModelById(noteId)!.children;

  test('adds a playable attachment above the captured text', async () => {
    writeCapture(store, 'one');

    await addCaptureRecording(store, audio(), at);

    const [recording, line] = children();
    expect(recording.flavour).toBe('notesgraph:attachment');
    expect(recording.props).toMatchObject({
      name: 'Voice capture 2026-11-25 09.05.webm',
      type: 'audio/webm',
      size: 3,
      embed: true,
    });
    expect((recording.props as { sourceId: string }).sourceId).toBeTruthy();
    expect(line.text?.toString()).toBe('one');
  });

  test('puts recordings in the order they were made', async () => {
    writeCapture(store, 'one');

    await addCaptureRecording(store, audio(), at);
    await addCaptureRecording(store, audio('audio/mp4'), at);

    expect(
      children().map(model => (model.props as { name?: string }).name ?? '')
    ).toEqual([
      'Voice capture 2026-11-25 09.05.webm',
      'Voice capture 2026-11-25 09.05.m4a',
      '',
    ]);
  });
});
