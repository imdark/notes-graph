import { recordMicrophone } from '../utils/record-microphone';
import type {
  SpeechToTextHandlers,
  SpeechToTextProvider,
  SpeechToTextSession,
} from './speech-to-text';

interface RecognitionResult {
  readonly isFinal: boolean;
  [index: number]: { transcript: string };
}

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<RecognitionResult>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => RecognitionLike;

const getRecognitionCtor = (): RecognitionCtor | undefined => {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
};

/**
 * The browser's Web Speech recognizer (Chromium, Safari) behind the same
 * interface as the native one. Browsers end a "continuous" session on their
 * own after a stretch of silence, so it is restarted until stopped.
 */
export const webSpeechToText: SpeechToTextProvider | null = getRecognitionCtor()
  ? {
      isAvailable: async () => true,
      start: async (handlers: SpeechToTextHandlers, { lang, record }) => {
        const Ctor = getRecognitionCtor();
        if (!Ctor) {
          handlers.onEnd('unavailable');
          return { stop: async () => {} };
        }
        let stopped = false;
        let error: 'permission-denied' | 'failed' | undefined;
        let recognition: RecognitionLike;
        let ended = () => {};
        const listeningEnded = new Promise<void>(resolve => (ended = resolve));
        // The recognizer keeps its audio to itself, so the mic is recorded
        // separately, from now until listening ends.
        const mic = record ? recordMicrophone() : null;

        const listen = () => {
          recognition = new Ctor();
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.lang = lang;
          recognition.onresult = event => {
            let partial = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              const text = result[0]?.transcript ?? '';
              if (result.isFinal) handlers.onSegment(text);
              else partial += text;
            }
            handlers.onPartial(partial);
          };
          recognition.onerror = event => {
            // Silence and a lost utterance are routine; the restart covers them.
            if (event.error === 'no-speech' || event.error === 'aborted')
              return;
            error =
              event.error === 'not-allowed' ||
              event.error === 'service-not-allowed'
                ? 'permission-denied'
                : 'failed';
          };
          recognition.onend = () => {
            if (!stopped && !error) return listen();
            handlers.onEnd(error);
            ended();
          };
          recognition.start();
        };
        listen();

        const session: SpeechToTextSession = {
          stop: async () => {
            stopped = true;
            recognition.stop();
          },
          recording: mic
            ? listeningEnded.then(async () => (await mic)?.stop() ?? null)
            : undefined,
        };
        return session;
      },
    }
  : null;
