import { LiveData, Service } from '@notesgraph/infra';

import type {
  SpeechToTextHandlers,
  SpeechToTextProvider,
  SpeechToTextSession,
} from '../providers/speech-to-text';
import { webSpeechToText } from '../providers/web-speech-to-text';

export interface VoiceTasksRequest {
  docId: string;
  /** The line the caret was on; tasks go after it. Null appends to the doc. */
  anchorBlockId: string | null;
}

/**
 * Dictating a batch of tasks into a doc: which doc the dictation sheet is open
 * for, and the recognizer that fills it.
 */
export class VoiceTasksService extends Service {
  constructor(private readonly nativeProvider?: SpeechToTextProvider) {
    super();
  }

  readonly request$ = new LiveData<VoiceTasksRequest | null>(null);

  private get provider() {
    return this.nativeProvider ?? webSpeechToText;
  }

  get supported() {
    return !!this.provider;
  }

  open(request: VoiceTasksRequest) {
    this.request$.next(request);
  }

  close() {
    this.request$.next(null);
  }

  async listen(handlers: SpeechToTextHandlers): Promise<SpeechToTextSession> {
    const provider = this.provider;
    if (!provider || !(await provider.isAvailable())) {
      handlers.onEnd('unavailable');
      return { stop: async () => {} };
    }
    return provider.start(handlers, {
      lang: typeof navigator === 'undefined' ? 'en-US' : navigator.language,
    });
  }
}
