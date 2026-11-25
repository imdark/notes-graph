import type { Store } from '@blocksuite/notesgraph/store';

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
};

/** "Voice capture 2026-11-25 14.03.webm", in local time. */
export function recordingName(type: string, at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  const time = `${pad(at.getHours())}.${pad(at.getMinutes())}`;
  return `Voice capture ${date} ${time}.${EXTENSIONS[type] ?? 'audio'}`;
}

const isAttachment = (flavour: string) => flavour === 'notesgraph:attachment';

/**
 * Add a capture's recording to the first note of `store`, as a playable
 * attachment. Recordings sit above the captured text, in the order they were
 * made.
 */
export async function addCaptureRecording(
  store: Store,
  audio: Blob,
  at = new Date()
) {
  // "audio/webm;codecs=opus" plays as audio/webm; the parameter only gets in
  // the way of matching the type.
  const type = audio.type.split(';')[0].trim() || 'audio/webm';
  const sourceId = await store.blobSync.set(audio);
  const [note] = store.getModelsByFlavour('notesgraph:note');
  if (!note) throw new Error('The capture note has no note block');
  const after = note.children.findIndex(block => !isAttachment(block.flavour));
  store.addBlock(
    'notesgraph:attachment',
    {
      name: recordingName(type, at),
      size: audio.size,
      type,
      sourceId,
      embed: true,
    },
    note,
    after === -1 ? note.children.length : after
  );
}
