import type { PluginListenerHandle } from '@capacitor/core';

import type {
  SpeechToTextEndEvent,
  SpeechToTextTextEvent,
} from '../speech-to-text';

export interface LocalSpeechToTextProgressEvent {
  downloaded: number;
  total: number;
}

/** Dictation on the phone itself (Silero VAD + Moonshine, English). */
export interface LocalSpeechToTextPlugin {
  status(): Promise<{
    state: 'missing' | 'downloading' | 'ready';
    downloaded: number;
    total: number;
  }>;
  /** Resolves once the model is in place; a second call joins the first. Rejects with code `failed`. */
  download(): Promise<void>;
  remove(): Promise<void>;
  /**
   * With `record`, `end` carries the session's audio as a WAV file. Rejects
   * with code `permission-denied`, `unavailable` or `failed`.
   */
  start(options: {
    lang: string;
    record?: boolean;
  }): Promise<{ session: number }>;
  stop(): Promise<void>;
  /** Delete a recording from `end` once it has been read. */
  deleteRecording(options: { path: string }): Promise<void>;
  addListener(
    eventName: 'partial' | 'segment',
    listener: (event: SpeechToTextTextEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'end',
    listener: (event: SpeechToTextEndEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'progress',
    listener: (event: LocalSpeechToTextProgressEvent) => void
  ): Promise<PluginListenerHandle>;
}
