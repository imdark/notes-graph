import { createIdentifier } from '@notesgraph/infra';

export type SpeechToTextError =
  /** The user said no to the microphone. */
  | 'permission-denied'
  /** No recognizer on this device. */
  | 'unavailable'
  | 'failed';

export interface SpeechToTextHandlers {
  /** The utterance in progress, replaced as the recognizer revises it. */
  onPartial(text: string): void;
  /** A finished utterance; the speaker paused. */
  onSegment(text: string): void;
  /** Listening stopped, on request or because of `error`. */
  onEnd(error?: SpeechToTextError): void;
}

export interface SpeechToTextSession {
  /** Stop listening; the utterance in progress still arrives as a segment. */
  stop(): Promise<void>;
}

/**
 * Continuous dictation from a native recognizer. The Android WebView has no
 * Web Speech recognition, so the app provides this; elsewhere the browser's
 * own recognizer is used when it has one (see web-speech-to-text.ts).
 */
export interface SpeechToTextProvider {
  isAvailable(): Promise<boolean>;
  start(
    handlers: SpeechToTextHandlers,
    options: { lang: string }
  ): Promise<SpeechToTextSession>;
}

export const SpeechToTextProvider = createIdentifier<SpeechToTextProvider>(
  'SpeechToTextProvider'
);
