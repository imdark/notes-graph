import { Capacitor } from '@capacitor/core';
import type {
  OnDeviceSpeechModel,
  SpeechToTextError,
  SpeechToTextHandlers,
  SpeechToTextOptions,
  SpeechToTextProvider,
  SpeechToTextSession,
} from '@notesgraph/core/modules/voice-tasks';

import { LocalSpeechToText } from './plugins/local-speech-to-text';
import {
  SpeechToText,
  type SpeechToTextEndEvent,
} from './plugins/speech-to-text';

/** What both native recognizers have in common. */
type NativeRecognizer = Pick<typeof SpeechToText, 'stop' | 'addListener'> & {
  start(options: {
    lang: string;
    record?: boolean;
  }): Promise<{ session: number }>;
};

type RecordingFile = NonNullable<SpeechToTextEndEvent['recording']>;

/** Read a recording out of the app's cache, and have the file deleted. */
async function readRecording({ path, mimeType }: RecordingFile) {
  try {
    const response = await fetch(Capacitor.convertFileSrc(path));
    if (!response.ok) {
      throw new Error(`Couldn't read the recording (${response.status})`);
    }
    return new Blob([await response.arrayBuffer()], { type: mimeType });
  } finally {
    // Only the on-device recognizer records.
    LocalSpeechToText.deleteRecording({ path }).catch(console.error);
  }
}

/**
 * Run one session on a native recognizer. Events are matched to this session
 * by id, so a late `end` from an earlier session can't end this one.
 */
async function listenOn(
  plugin: NativeRecognizer,
  handlers: SpeechToTextHandlers,
  { lang, record }: SpeechToTextOptions
): Promise<SpeechToTextSession> {
  let session: number | null = null;
  let ended = false;
  let recorded: (audio: Blob | null) => void = () => {};
  const recording = new Promise<Blob | null>(resolve => (recorded = resolve));

  const listeners = await Promise.all([
    plugin.addListener('partial', event => {
      if (event.session === session) handlers.onPartial(event.text);
    }),
    plugin.addListener('segment', event => {
      if (event.session === session) handlers.onSegment(event.text);
    }),
    plugin.addListener('end', event => {
      if (event.session === session) end(event.error, event.recording);
    }),
  ]);

  const end = (error?: SpeechToTextError, file?: RecordingFile) => {
    if (ended) return;
    ended = true;
    listeners.forEach(listener => {
      listener.remove().catch(console.error);
    });
    handlers.onEnd(error);
    if (!file) return recorded(null);
    readRecording(file).then(recorded, err => {
      console.error('speech: lost the recording', err);
      recorded(null);
    });
  };

  try {
    session = (await plugin.start({ lang, record })).session;
  } catch (err) {
    const code = (err as { code?: string }).code;
    end(
      code === 'permission-denied' || code === 'unavailable' ? code : 'failed'
    );
  }

  return {
    stop: async () => {
      if (!ended) await plugin.stop();
    },
    recording: record ? recording : undefined,
  };
}

/** Whisper small.en, the on-device model, only knows English. */
const onDeviceLanguage = (lang: string) => /^en\b/i.test(lang);

async function modelReady() {
  try {
    return (await LocalSpeechToText.status()).state === 'ready';
  } catch (err) {
    console.error('speech: on-device model status', err);
    return false;
  }
}

const onDeviceModel: OnDeviceSpeechModel = {
  status: () => LocalSpeechToText.status(),
  supportsLanguage: onDeviceLanguage,
  download: async onProgress => {
    const listener = await LocalSpeechToText.addListener('progress', event =>
      onProgress(event)
    );
    try {
      await LocalSpeechToText.download();
    } finally {
      listener.remove().catch(console.error);
    }
  },
};

/**
 * Speech recognition for the web layer, which has none of its own in the
 * Android WebView. Once the on-device model is downloaded it does the
 * listening (noise filtered out, sharper than the system's); before that, or
 * in a language it doesn't know, Android's own recognizer does.
 */
export const nativeSpeechToText: SpeechToTextProvider = {
  isAvailable: async () =>
    (await SpeechToText.isAvailable()).available || (await modelReady()),

  start: async (handlers, options) => {
    const onDevice = onDeviceLanguage(options.lang) && (await modelReady());
    return listenOn(
      onDevice ? LocalSpeechToText : SpeechToText,
      handlers,
      options
    );
  },

  onDeviceModel,
};
