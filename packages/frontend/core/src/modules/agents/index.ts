export { Agents } from './entities/agents';
export { AGENT_RULES_TITLE, AgentRulesService } from './services/agent-rules';
export { AgentsService, DEFAULT_AGENT_TOOLS } from './services/agents';
export {
  type Automation,
  AUTOMATION_EVENTS,
  AUTOMATION_RUNTIME_LABELS,
  type AutomationDetails,
  type AutomationDraft,
  type AutomationEvent,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationRuntime,
  AutomationsService,
  type AutomationTemplate,
  type AutomationTrigger,
  type AutomationTriggerType,
  BLANK_ACTIONS_CODE,
  BLANK_AUTOMATION_CODE,
  webhookUrl,
} from './services/automations';
export {
  hasAgentClaim,
  runsForBlock,
  runTargetsBlock,
} from './services/block-runs';
export {
  type ChatMessage,
  type ChatModel,
  CloudAgentRunnerService,
} from './services/cloud-runner';
export { AgentContextService } from './services/context';
export {
  type BranchCheck,
  canFixToMerge,
  deployableTasks,
  DeploymentsService,
  deployRunsFor,
  flagStage,
  type FlagStage,
  type LiveCheck,
  type MergeReadiness,
  mergeReadiness,
  mergesDirectly,
  needsHelpToMerge,
  type PullRequest,
  pullRequestNumber,
  type PullRequestsState,
  type PullRequestStage,
  pullRequestStage,
  repoOf,
  type RunTask,
  SHIP_STAGES,
  type ShipAction,
  shipAgents,
  type ShipReport,
  shipReportText,
  shipsWithAutomations,
  type ShipStage,
  shipTargets,
  type ShipTask,
  type ShipTaskDetails,
  shownStage,
  stuckReason,
} from './services/deployments';
export {
  AgentAlreadyRunningError,
  type AgentEvent,
  type AgentExecutor,
  AgentExecutorService,
} from './services/executor';
export {
  AgentFileToolError,
  AgentFileToolsService,
  FILE_TOOL_NAMES,
  FILE_TOOLS,
} from './services/file-tools';
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
  type LogCatalog,
  type LogPattern,
  type MonitoringAgent,
  type MonitoringDecision,
  openDecisions,
  type RegistryDevice,
  STALE_AFTER_SECONDS,
} from './services/fleet';
export { type AgentBlockRef, lastBlockTouched } from './services/focus-block';
export {
  groupLogLines,
  type LogLine,
  type LogSegment,
  parseLogLines,
} from './services/log-lines';
export {
  formatTrendValue,
  monitorTrend,
  readingNumber,
  sparklinePath,
  type Trend,
  type TrendPoint,
} from './services/monitor-trend';
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
  type MonitorSource,
  type MonitorSpec,
  MonitorsService,
} from './services/monitors';
export {
  isNotesHealthMonitor,
  NOTES_HEALTH_DOC_TITLE,
  NOTES_HEALTH_INSTRUCTIONS,
  NOTES_HEALTH_NAME,
  NOTES_HEALTH_TEMPLATE,
  notesHealthDevice,
  notesHealthMonitorDraft,
  WEEK_MINUTES,
} from './services/notes-health';
export {
  forkMessages,
  forkTranscript,
  splitSuggestion,
} from './services/question-fork';
export {
  AGENT_SKILLS,
  type AgentBudget,
  CLAUDE_CODE_MODEL,
  CLOUD_DEVICE_KEY,
  defaultSkillsFor,
  type DeployInfo,
  deviceHarnessName,
  editorHarness,
  type EnqueueRemoteJob,
  isDeviceClaudeModel,
  isSkillNoteTitle,
  openQuestions,
  RemoteAgentRunnerService,
  type RemoteJob,
  type RemoteJobUpdate,
  type RemoteQuestion,
  type RemoteSteer,
  RESEARCH_MODEL,
  type RunShare,
  savedPlacement,
  type SharedRun,
  type SkillNote,
  type SpentRun,
  waitingSteers,
  WORKFLOW_MODEL,
} from './services/remote-runner';
export {
  changesAreEmpty,
  parsePatch,
  type PatchFile,
  type PatchHunk,
  type PatchLine,
  type RunChanges,
} from './services/run-changes';
export { runChatMessages } from './services/run-chat';
export { askTranscript } from './services/run-chat';
export {
  type AgentRunSession,
  AgentRunSessionService,
  type QueuedAgentRun,
} from './services/run-session';
export {
  projectFromProps,
  type ProjectSpend,
  spendByProject,
  weekStarts,
} from './services/run-spend';
export {
  type AgentTarget,
  agentTargetBlockIds,
  agentTargetKey,
} from './services/target';
export {
  AgentTaskClaimService,
  isOpenTask,
  isPlainBlock,
  markTasksQueued,
  QUEUED_STATUS,
  releaseQueuedTasks,
} from './services/task-claim';
export { AgentRunLogsStore, type SavedAskChat } from './stores/agent-run-logs';
export {
  type AgentRun,
  AgentRunsStore,
  type AgentRunStatus,
  formatRunCost,
  isAskRun,
} from './stores/agent-runs';
export {
  type Agent,
  AGENT_ACCESS_LEVELS,
  type AgentAccess,
  type AgentDraft,
  type AgentHarness,
  type AgentKind,
  agentKind,
  type AgentOutput,
  type AgentScope,
  type AgentTargetKind,
  DEFAULT_MAX_STEPS,
} from './stores/agents';
export { AgentIcon, agentIconData } from './views/agent-icon';

import { type Framework } from '@notesgraph/infra';

import { LocalLLMService } from '../ai-local';
import { WorkspaceServerService } from '../cloud';
import { WorkspaceDBService } from '../db';
import { DocsService } from '../doc';
import { DocsSearchService } from '../docs-search';
import { FolderSyncService } from '../folder-sync';
import { ProjectsService } from '../projects';
import { WorkspaceScope, WorkspaceService } from '../workspace';
import { Agents } from './entities/agents';
import { AgentRulesService } from './services/agent-rules';
import { AgentsService } from './services/agents';
import { AutomationsService } from './services/automations';
import { CloudAgentRunnerService } from './services/cloud-runner';
import { AgentContextService } from './services/context';
import { DeploymentsService } from './services/deployments';
import { AgentExecutorService } from './services/executor';
import { AgentFileToolsService } from './services/file-tools';
import { FixTaskService } from './services/fix-task';
import { FleetService } from './services/fleet';
import { MonitorsService } from './services/monitors';
import { RemoteAgentRunnerService } from './services/remote-runner';
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
    .service(AgentContextService, [DocsService, ProjectsService])
    .service(AgentRulesService, [DocsService])
    .service(AgentFileToolsService, [FolderSyncService])
    .service(RemoteAgentRunnerService, [WorkspaceServerService])
    .service(CloudAgentRunnerService, [WorkspaceServerService])
    .service(ResearchToolsService, [WorkspaceServerService])
    .service(MonitorsService, [WorkspaceServerService, WorkspaceService])
    .service(AutomationsService, [WorkspaceServerService, WorkspaceService])
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
      AgentRulesService,
    ])
    .service(AgentTaskClaimService, [DocsService])
    .service(AgentRunSessionService, [
      AgentExecutorService,
      AgentTaskClaimService,
    ])
    .service(FixTaskService, [
      DocsService,
      AgentsService,
      AgentRunSessionService,
    ])
    .service(DeploymentsService, [
      DocsSearchService,
      DocsService,
      AgentRunSessionService,
      RemoteAgentRunnerService,
      WorkspaceService,
      AutomationsService,
    ])
    .store(AgentsStore, [WorkspaceDBService])
    .store(AgentRunLogsStore)
    .store(AgentRunsStore, [WorkspaceDBService, AgentRunLogsStore])
    .entity(Agents, [AgentsStore]);
}
export {
  AGENT_TEMPLATES,
  type AgentTemplate,
  COMPILE_SOURCE_TEMPLATE,
  DEAL_MONITOR_TEMPLATE,
} from './services/agent-templates';
export {
  COMPILE_AGENT_NAME,
  compileBrief,
  type CompileSource,
  compileSourceOf,
  findCompileAgent,
} from './services/compile-source';
export {
  FIX_AGENT_TEMPLATE,
  FIX_UPS_DOC_TITLE,
  fixKey,
  FixTaskService,
  type HealthFailure,
  type StartedFix,
} from './services/fix-task';
