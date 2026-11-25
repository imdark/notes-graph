import type { PluginListenerHandle } from '@capacitor/core';

export interface SpeechToTextTextEvent {
  session: number;
  text: string;
}

export interface SpeechToTextEndEvent {
  session: number;
  error?: 'permission-denied' | 'failed';
  /** The session's audio, from a recognizer started with `record`. */
  recording?: { path: string; mimeType: string };
}

export interface SpeechToTextPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  /** Rejects with code `permission-denied` or `unavailable`. */
  start(options: { lang: string }): Promise<{ session: number }>;
  stop(): Promise<void>;
  addListener(
    eventName: 'partial' | 'segment',
    listener: (event: SpeechToTextTextEvent) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'end',
    listener: (event: SpeechToTextEndEvent) => void
  ): Promise<PluginListenerHandle>;
}
