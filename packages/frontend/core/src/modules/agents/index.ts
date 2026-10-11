export { Agents } from './entities/agents';
export { AgentIcon, agentIconData } from './views/agent-icon';
export { AgentsService, DEFAULT_AGENT_TOOLS } from './services/agents';
export {
  CLAUDE_CODE_MODEL,
  deviceHarnessName,
  type EnqueueRemoteJob,
  CLOUD_DEVICE_KEY,
  editorHarness,
  isDeviceClaudeModel,
  openQuestions,
  RESEARCH_MODEL,
  type RemoteJob,
  type RemoteJobUpdate,
  type RemoteQuestion,
  RemoteAgentRunnerService,
  savedPlacement,
  WORKFLOW_MODEL,
} from './services/remote-runner';
export {
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
} from './services/cloud-runner';
export {
  forkMessages,
  forkTranscript,
  splitSuggestion,
} from './services/question-fork';
export { runChatMessages } from './services/run-chat';
export { AgentContextService } from './services/context';
export {
  canFixToMerge,
  DeploymentsService,
  type MergeReadiness,
  mergeReadiness,
  mergesDirectly,
  needsHelpToMerge,
  type PullRequest,
  type PullRequestsState,
  repoOf,
  SHIP_STAGES,
  type ShipAction,
  shipAgents,
  type ShipStage,
  type ShipTask,
  type ShipTaskDetails,
  shipTargets,
} from './services/deployments';
export {
  type ConditionType,
  type ExtractType,
  MIN_INTERVAL_MINUTES,
  type Monitor,
  type MonitorAlerts,
  type MonitorCondition,
  type MonitorDraft,
  type MonitorKind,
  type MonitorReading,
  MonitorsService,
  type MonitorSource,
  type MonitorSpec,
} from './services/monitors';
export {
  AGENT_MODES,
  AGENT_WARMUP,
  type AgentMode,
  agentReadiness,
  type AgentSettings,
  type CheckStatus,
  DEVICE_STATES,
  type DeviceCheck,
  deviceChecks,
  type DeviceState,
  deviceState,
  FleetService,
  fleetSummary,
  type InventoryDevice,
  type MonitoringAgent,
  type MonitoringDecision,
  openDecisions,
  STALE_AFTER_SECONDS,
} from './services/fleet';
export {
  formatTrendValue,
  monitorTrend,
  readingNumber,
  sparklinePath,
  type Trend,
  type TrendPoint,
} from './services/monitor-trend';
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
  isOpenTask,
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
import { DocsSearchService } from '../docs-search';
import { FolderSyncService } from '../folder-sync';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Agents } from './entities/agents';
import { AgentsService } from './services/agents';
import { CloudAgentRunnerService } from './services/cloud-runner';
import { AgentContextService } from './services/context';
import { DeploymentsService } from './services/deployments';
import { AgentFileToolsService } from './services/file-tools';
import { AgentExecutorService } from './services/executor';
import { FleetService } from './services/fleet';
import { RemoteAgentRunnerService } from './services/remote-runner';
import { MonitorsService } from './services/monitors';
import { ResearchToolsService } from './services/research-tools';
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
    .service(ResearchToolsService, [WorkspaceServerService])
    .service(MonitorsService, [WorkspaceServerService, WorkspaceService])
    .service(FleetService, [WorkspaceServerService, WorkspaceService])
    .service(AgentExecutorService, [
      AgentContextService,
      AgentRunsStore,
      AgentRunLogsStore,
      LocalLLMService,
      AgentFileToolsService,
      RemoteAgentRunnerService,
      CloudAgentRunnerService,
      ResearchToolsService,
      WorkspaceService,
    ])
    .service(AgentTaskClaimService, [DocsService])
    .service(AgentRunSessionService, [
      AgentExecutorService,
      AgentTaskClaimService,
    ])
    .service(DeploymentsService, [
      DocsSearchService,
      DocsService,
      AgentRunSessionService,
      RemoteAgentRunnerService,
      WorkspaceService,
    ])
    .store(AgentsStore, [WorkspaceDBService])
    .store(AgentRunLogsStore)
    .store(AgentRunsStore, [WorkspaceDBService, AgentRunLogsStore])
    .entity(Agents, [AgentsStore]);
}
