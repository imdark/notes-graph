import { LiveData, Service } from '@notesgraph/infra';

import type { GlobalState } from '../../storage';

/** Which backend NotesGraph's AI features run against. */
export type AiBackend = 'cloud' | 'local';

const AI_BACKEND_KEY = 'ai-local:backend';

/** The device whose Claude Code answers a workspace's page chat. */
const chatDeviceKey = (workspaceId: string) => `ai-chat:device:${workspaceId}`;

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

  /**
   * The device whose Claude Code answers the page chat in a workspace, so the
   * chat can run commands and change notes; null for the backend above.
   */
  chatDevice$(workspaceId: string) {
    return LiveData.from(
      this.globalState.watch<string>(chatDeviceKey(workspaceId)),
      null
    ).map(v => v ?? null);
  }

  setChatDevice(workspaceId: string, deviceKey: string | null) {
    if (deviceKey) this.globalState.set(chatDeviceKey(workspaceId), deviceKey);
    else this.globalState.del(chatDeviceKey(workspaceId));
  }
}
