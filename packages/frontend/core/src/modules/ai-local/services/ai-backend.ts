import { LiveData, Service } from '@notesgraph/infra';

import type { GlobalState } from '../../storage';

/** Which backend NotesGraph's AI features run against. */
export type AiBackend = 'cloud' | 'local';

const AI_BACKEND_KEY = 'ai-local:backend';

/**
 * Holds the user's choice of AI backend (cloud copilot vs. on-device local
 * models). Persisted in {@link GlobalState}; read by the AI provider wiring to
 * decide which {@link AIRequestService} to install.
 */
export class AiBackendService extends Service {
  constructor(private readonly globalState: GlobalState) {
    super();
  }

  readonly backend$ = LiveData.from(
    this.globalState.watch<AiBackend>(AI_BACKEND_KEY),
    null
  ).map((v): AiBackend => v ?? 'cloud');

  get backend(): AiBackend {
    return this.globalState.get<AiBackend>(AI_BACKEND_KEY) ?? 'cloud';
  }

  setBackend(backend: AiBackend) {
    this.globalState.set(AI_BACKEND_KEY, backend);
  }
}
