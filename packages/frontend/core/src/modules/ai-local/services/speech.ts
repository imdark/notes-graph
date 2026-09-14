import { LiveData, Service } from '@notesgraph/infra';

interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): { transcript: string };
  [index: number]: { transcript: string };
}

interface SpeechRecognitionEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<SpeechRecognitionResult>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Zero-download voice via the browser: text-to-speech (SpeechSynthesis) and
 * speech-to-text (Web Speech Recognition). No model + works offline; STT
 * availability varies by browser (Chromium-based works).
 */
export class SpeechService extends Service {
  readonly speaking$ = new LiveData(false);
  readonly listening$ = new LiveData(false);
  private recognition: SpeechRecognitionLike | null = null;

  get ttsSupported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  get sttSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
    );
  }

  speak(text: string): void {
    if (!this.ttsSupported || !text.trim()) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => this.speaking$.next(true);
    utterance.onend = () => this.speaking$.next(false);
    utterance.onerror = () => this.speaking$.next(false);
    window.speechSynthesis.speak(utterance);
  }

  stopSpeaking(): void {
    if (this.ttsSupported) window.speechSynthesis.cancel();
    this.speaking$.next(false);
  }

  /** Start dictation; `onResult` gets the growing transcript. Returns a stopper. */
  startListening(handlers: {
    onResult: (text: string) => void;
    onEnd?: (finalText: string) => void;
  }): () => void {
    if (!this.sttSupported) return () => {};
    const ctor = (
      window as unknown as {
        SpeechRecognition?: RecognitionCtor;
        webkitSpeechRecognition?: RecognitionCtor;
      }
    ).SpeechRecognition;
    const webkitCtor = (
      window as unknown as { webkitSpeechRecognition?: RecognitionCtor }
    ).webkitSpeechRecognition;
    const Ctor = ctor ?? webkitCtor;
    if (!Ctor) return () => {};

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';
    let finalText = '';
    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += transcript;
        else interim += transcript;
      }
      handlers.onResult((finalText + interim).trim());
    };
    recognition.onend = () => {
      this.listening$.next(false);
      handlers.onEnd?.(finalText.trim());
    };
    recognition.onerror = () => {
      this.listening$.next(false);
    };
    recognition.start();
    this.recognition = recognition;
    this.listening$.next(true);
    return () => this.stopListening();
  }

  stopListening(): void {
    try {
      this.recognition?.stop();
    } catch {
      /* already stopped */
    }
    this.listening$.next(false);
  }
}

/** Strip common Markdown syntax so TTS reads clean prose. */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_>#-]+/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
}
