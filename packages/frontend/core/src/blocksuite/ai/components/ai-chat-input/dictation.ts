import type {
  SpeechToTextError,
  SpeechToTextHandlers,
  SpeechToTextSession,
} from '@notesgraph/core/modules/voice-tasks';

/** The app's recognizer, as the chat input needs it (see ./speech). */
export interface ChatSpeechToText {
  listen(handlers: SpeechToTextHandlers): Promise<SpeechToTextSession>;
}

const joined = (...parts: string[]) =>
  parts
    .map(part => part.trim())
    .filter(Boolean)
    .join(' ');

/**
 * Dictating into the chat's message box: what was said goes after what is
 * already there, the utterance in progress showing as the recognizer revises
 * it. The box stays editable while listening; an edit becomes the text that
 * later words follow.
 */
export class ChatDictation {
  private session: SpeechToTextSession | null = null;
  /** Bumped by every start and stop, so a stale recognizer is ignored. */
  private run = 0;
  /** What the box held before the words now being added. */
  private before = '';
  /** Finished utterances since `before`. */
  private said = '';
  /** What this last put in the box; anything else there is the user's edit. */
  private written: string | null = null;

  listening = false;

  constructor(
    private readonly box: {
      read(): string;
      write(text: string): void;
    },
    private readonly onChange: (
      listening: boolean,
      error?: SpeechToTextError
    ) => void
  ) {}

  async toggle(speech: ChatSpeechToText) {
    if (this.listening) {
      await this.stop();
      return;
    }
    const run = ++this.run;
    this.before = this.box.read();
    this.said = '';
    this.written = null;
    this.setListening(true);

    const live = () => run === this.run;
    const session = await speech.listen({
      onPartial: text => {
        if (live()) this.show(text);
      },
      onSegment: text => {
        if (!live()) return;
        this.adoptEdit();
        this.said = joined(this.said, text);
        this.show('');
      },
      onEnd: error => {
        if (!live()) return;
        this.session = null;
        this.setListening(false, error);
      },
    });
    // Stopped, or ended on its own, while the recognizer was starting.
    if (!live() || !this.listening) {
      session.stop().catch(console.error);
      return;
    }
    this.session = session;
  }

  /** Stop listening; the words already heard stay in the box. */
  async stop() {
    if (!this.listening) return;
    const session = this.session;
    this.session = null;
    this.run++;
    this.setListening(false);
    await session?.stop().catch(console.error);
  }

  private show(partial: string) {
    this.adoptEdit();
    const text = joined(this.before, this.said, partial);
    this.written = text;
    this.box.write(text);
  }

  /** The user typed in the box since the last write: carry on from that. */
  private adoptEdit() {
    const current = this.box.read();
    if (this.written !== null && current !== this.written) {
      this.before = current;
      this.said = '';
      this.written = null;
    }
  }

  private setListening(listening: boolean, error?: SpeechToTextError) {
    this.listening = listening;
    this.onChange(listening, error);
  }
}

export const dictationErrorMessage: Record<SpeechToTextError, string> = {
  'permission-denied':
    'The microphone is blocked. Allow it for NotesGraph to dictate.',
  unavailable: "This device can't turn speech into text.",
  failed: 'Dictation stopped unexpectedly. Try again.',
};
