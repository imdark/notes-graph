import type {
  OnDeviceSpeechModel,
  SpeechToTextError,
  SpeechToTextHandlers,
  SpeechToTextProvider,
  SpeechToTextSession,
} from '@notesgraph/core/modules/voice-tasks';

import { LocalSpeechToText } from './plugins/local-speech-to-text';
import { SpeechToText } from './plugins/speech-to-text';

/** What both native recognizers have in common. */
type NativeRecognizer = Pick<
  typeof SpeechToText,
  'start' | 'stop' | 'addListener'
>;

/**
 * Run one session on a native recognizer. Events are matched to this session
 * by id, so a late `end` from an earlier session can't end this one.
 */
async function listenOn(
  plugin: NativeRecognizer,
  handlers: SpeechToTextHandlers,
  lang: string
): Promise<SpeechToTextSession> {
  let session: number | null = null;
  let ended = false;

  const listeners = await Promise.all([
    plugin.addListener('partial', event => {
      if (event.session === session) handlers.onPartial(event.text);
    }),
    plugin.addListener('segment', event => {
      if (event.session === session) handlers.onSegment(event.text);
    }),
    plugin.addListener('end', event => {
      if (event.session === session) end(event.error);
    }),
  ]);

  const end = (error?: SpeechToTextError) => {
    if (ended) return;
    ended = true;
    listeners.forEach(listener => {
      listener.remove().catch(console.error);
    });
    handlers.onEnd(error);
  };

  try {
    session = (await plugin.start({ lang })).session;
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
  };
}

/** Moonshine, the on-device model, only knows English. */
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

  start: async (handlers, { lang }) => {
    const onDevice = onDeviceLanguage(lang) && (await modelReady());
    return listenOn(
      onDevice ? LocalSpeechToText : SpeechToText,
      handlers,
      lang
    );
  },

  onDeviceModel,
};
