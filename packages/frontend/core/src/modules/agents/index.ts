export { Agents } from './entities/agents';
export { AgentIcon, agentIconData } from './views/agent-icon';
export { AgentsService, DEFAULT_AGENT_TOOLS } from './services/agents';
export { AgentContextService } from './services/context';
export {
  AgentFileToolError,
  AgentFileToolsService,
  FILE_TOOL_NAMES,
  FILE_TOOLS,
} from './services/file-tools';
export {
  AgentAlreadyRunningError,
  type AgentEvent,
  type AgentExecutor,
  AgentExecutorService,
} from './services/executor';
export { type AgentRun, type AgentRunStatus, AgentRunsStore } from './stores/agent-runs';
export {
  type AgentRunSession,
  AgentRunSessionService,
} from './services/run-session';
export { type AgentTarget, agentTargetKey } from './services/target';
export {
  type Agent,
  type AgentDraft,
  type AgentHarness,
  type AgentOutput,
  type AgentScope,
  type AgentTargetKind,
  DEFAULT_MAX_STEPS,
} from './stores/agents';

import { type Framework } from '@notesgraph/infra';

import { AiBackendService, LocalLLMService } from '../ai-local';
import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { FolderSyncService } from '../folder-sync';
import { WorkspaceScope } from '../workspace';
import { Agents } from './entities/agents';
import { AgentsService } from './services/agents';
import { AgentContextService } from './services/context';
import { AgentFileToolsService } from './services/file-tools';
import { AgentExecutorService } from './services/executor';
import { AgentRunSessionService } from './services/run-session';
import { AgentRunsStore } from './stores/agent-runs';
import { AgentsStore } from './stores/agents';

export function configureAgentsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(AgentsService, [AgentsStore, Agents])
    .service(AgentContextService, [DocsService])
    .service(AgentFileToolsService, [FolderSyncService])
    .service(AgentExecutorService, [
      AgentContextService,
      AgentRunsStore,
      LocalLLMService,
      AiBackendService,
      AgentFileToolsService,
    ])
    .service(AgentRunSessionService, [AgentExecutorService])
    .store(AgentsStore, [WorkspaceDBService])
    .store(AgentRunsStore, [WorkspaceDBService])
    .entity(Agents, [AgentsStore]);
}
