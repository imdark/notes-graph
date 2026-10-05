import type {
  SpeechToTextError,
  SpeechToTextProvider,
} from '@notesgraph/core/modules/voice-tasks';

import { SpeechToText } from './plugins/speech-to-text';

/**
 * The native recognizer behind core's SpeechToTextProvider: the Android
 * WebView has no Web Speech recognition. Events are matched to this session
 * by id, so a late `end` from an earlier session can't end this one.
 */
export const nativeSpeechToText: SpeechToTextProvider = {
  isAvailable: async () => (await SpeechToText.isAvailable()).available,

  start: async (handlers, { lang }) => {
    let session: number | null = null;
    let ended = false;

    const listeners = await Promise.all([
      SpeechToText.addListener('partial', event => {
        if (event.session === session) handlers.onPartial(event.text);
      }),
      SpeechToText.addListener('segment', event => {
        if (event.session === session) handlers.onSegment(event.text);
      }),
      SpeechToText.addListener('end', event => {
        if (event.session === session) end(event.error);
      }),
    ]);

    const end = (error?: SpeechToTextError) => {
      if (ended) return;
      ended = true;
      listeners.forEach(listener => listener.remove().catch(console.error));
      handlers.onEnd(error);
    };

    try {
      session = (await SpeechToText.start({ lang })).session;
    } catch (err) {
      const code = (err as { code?: string }).code;
      end(
        code === 'permission-denied' || code === 'unavailable' ? code : 'failed'
      );
    }

    return {
      stop: async () => {
        if (!ended) await SpeechToText.stop();
      },
    };
  },
};
