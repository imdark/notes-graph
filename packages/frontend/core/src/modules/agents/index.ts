export { Agents } from './entities/agents';
export { AgentIcon, agentIconData } from './views/agent-icon';
export { AgentsService, DEFAULT_AGENT_TOOLS } from './services/agents';
export {
  CLAUDE_CODE_MODEL,
  type EnqueueRemoteJob,
  isDeviceClaudeModel,
  openQuestions,
  type RemoteJob,
  type RemoteJobUpdate,
  type RemoteQuestion,
  RemoteAgentRunnerService,
  WORKFLOW_MODEL,
} from './services/remote-runner';
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
export {
  type AgentRun,
  type AgentRunStatus,
  AgentRunsStore,
} from './stores/agent-runs';
export { AgentRunLogsStore } from './stores/agent-run-logs';
export {
  type AgentRunSession,
  AgentRunSessionService,
  type QueuedAgentRun,
} from './services/run-session';
export {
  hasAgentClaim,
  runsForBlock,
  runTargetsBlock,
} from './services/block-runs';
export { type AgentBlockRef, lastBlockTouched } from './services/focus-block';
export {
  AgentTaskClaimService,
  markTasksQueued,
  QUEUED_STATUS,
  releaseQueuedTasks,
} from './services/task-claim';
export {
  groupLogLines,
  type LogLine,
  type LogSegment,
  parseLogLines,
} from './services/log-lines';
export {
  type AgentTarget,
  agentTargetBlockIds,
  agentTargetKey,
} from './services/target';
export {
  type Agent,
  type AgentDraft,
  type AgentHarness,
  type AgentKind,
  agentKind,
  type AgentOutput,
  type AgentScope,
  type AgentTargetKind,
  DEFAULT_MAX_STEPS,
} from './stores/agents';

import { type Framework } from '@notesgraph/infra';

import { LocalLLMService } from '../ai-local';
import { WorkspaceServerService } from '../cloud';
import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { FolderSyncService } from '../folder-sync';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Agents } from './entities/agents';
import { AgentsService } from './services/agents';
import { CloudAgentRunnerService } from './services/cloud-runner';
import { AgentContextService } from './services/context';
import { AgentFileToolsService } from './services/file-tools';
import { AgentExecutorService } from './services/executor';
import { RemoteAgentRunnerService } from './services/remote-runner';
import { AgentRunSessionService } from './services/run-session';
import { AgentTaskClaimService } from './services/task-claim';
import { AgentRunLogsStore } from './stores/agent-run-logs';
import { AgentRunsStore } from './stores/agent-runs';
import { AgentsStore } from './stores/agents';

export function configureAgentsModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(AgentsService, [AgentsStore, Agents])
    .service(AgentContextService, [DocsService])
    .service(AgentFileToolsService, [FolderSyncService])
    .service(RemoteAgentRunnerService, [WorkspaceServerService])
    .service(CloudAgentRunnerService, [WorkspaceServerService])
    .service(AgentExecutorService, [
      AgentContextService,
      AgentRunsStore,
      AgentRunLogsStore,
      LocalLLMService,
      AgentFileToolsService,
      RemoteAgentRunnerService,
      CloudAgentRunnerService,
      WorkspaceService,
    ])
    .service(AgentTaskClaimService, [DocsService])
    .service(AgentRunSessionService, [
      AgentExecutorService,
      AgentTaskClaimService,
    ])
    .store(AgentsStore, [WorkspaceDBService])
    .store(AgentRunLogsStore)
    .store(AgentRunsStore, [WorkspaceDBService, AgentRunLogsStore])
    .entity(Agents, [AgentsStore]);
}
