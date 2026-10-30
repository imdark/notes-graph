import { UserFriendlyError } from '@notesgraph/error';
import { Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { AgentAccess } from '../stores/agents';
import type { RunChanges } from './run-changes';

/**
 * Runs an agent on a registered device instead of in this browser.
 *
 * The job is queued against the device registry and the device claims it;
 * nothing here connects to the machine. That direction matters: a device in
 * the field sits behind NAT, and having it initiate every connection means
 * the server never needs a route in, and no credential for it lives here.
 */

/**
 * The skills the editor offers a Claude agent, by the names the server's
 * catalog knows (agent-profiles.ts SKILL_CATALOG); it drops any other.
 */
export const AGENT_SKILLS: { name: string; desc: string }[] = [
  { name: 'antislop', desc: 'Core filter against generic AI output' },
  { name: 'antislop-ui', desc: 'Color, layout, components, motion' },
  { name: 'antislop-copywriting', desc: 'Headlines, tone, prose' },
  { name: 'antislop-human', desc: 'Contrast, keyboard, focus, states' },
  {
    name: 'antislop-layoutmobile',
    desc: 'Layouts that reflow phone to desktop',
  },
  { name: 'antislop-code', desc: 'Code comment hygiene' },
  { name: 'omniseek-investigate', desc: 'Deep multi-source research method' },
];

/**
 * A note titled "Skill: <name>", offered as a skill beside the catalog's
 * (the server's plugins/registry/skill-notes.ts). An agent names it by
 * `ref` ("note:<docId>"); the server only hands a run the ones in its own
 * workspace.
 */
export interface SkillNote {
  ref: string;
  name: string;
  title: string;
  docId: string;
}

/** Whether a note's title makes it a skill note. */
export const isSkillNoteTitle = (title: string | undefined | null) =>
  /^\s*skill\s*:\s*\S/i.test(title ?? '');

/** The skills a Claude model gets when the agent doesn't choose. */
export const defaultSkillsFor = (model: string | undefined): string[] =>
  model === RESEARCH_MODEL
    ? ['omniseek-investigate']
    : AGENT_SKILLS.map(s => s.name).filter(n => n.startsWith('antislop'));

/**
 * The model a remote agent names to run as Claude Code on the device, with
 * NotesGraph's tools and a way to ask the reader things (`wf agent serve`
 * keys on this exact string).
 */
export const CLAUDE_CODE_MODEL = 'claude-code';

/**
 * The same Claude Code, started on the device the way `wf start` + `wf ai`
 * start a task: a ticket in the device's task backend, wf's branch and
 * worktree, the project's Claude account, skills and task memory.
 */
export const WORKFLOW_MODEL = 'workflow';

/**
 * Claude Code with the device's OmniSeek attached (github.com/Battam1111/omniseek):
 * cross-lingual search, reading papers and PDFs, transcription, and a
 * citation graph, for runs that research rather than edit.
 */
export const RESEARCH_MODEL = 'research';

/**
 * The device key of the server's own runner (tools/agent-runner): Claude
 * Code, Workflow and Research agents run there with no Mac on.
 */
export const CLOUD_DEVICE_KEY = 'cloud';

/**
 * No model at all: the device runs `instructions` as a shell command and its
 * output is the result. Only on devices whose owner turned it on
 * (`agent.allow_commands` in the wf config); monitors and the Deployments
 * screen use it to read things only that machine can.
 */
export const COMMAND_MODEL = 'command';

/** Models that run Claude Code on the device; they exist only remotely. */
export const isDeviceClaudeModel = (model: string | undefined) =>
  model === CLAUDE_CODE_MODEL ||
  model === WORKFLOW_MODEL ||
  model === RESEARCH_MODEL;

/**
 * Where an agent set up in the editor is saved. Claude Code (or Workflow,
 * Research) picked under "Cloud (server copilot)" runs on the server's own
 * runner, so it is saved as that device: every run, monitor and deployment
 * path then treats it like any other device run. Anything else is kept as
 * picked, with a device only on a remote agent and no device-only model
 * carried to a runtime that would read it as an unknown model name.
 */
export const savedPlacement = <H extends string>(
  harness: H | undefined,
  model: string | undefined,
  deviceKey: string | undefined
): { harness: H | 'remote' | undefined; model?: string; deviceKey?: string } =>
  harness === 'cloud' && isDeviceClaudeModel(model)
    ? { harness: 'remote', model, deviceKey: CLOUD_DEVICE_KEY }
    : {
        harness,
        model:
          isDeviceClaudeModel(model) && harness !== 'remote'
            ? undefined
            : model,
        deviceKey: harness === 'remote' ? deviceKey : undefined,
      };

/**
 * The editor's view of a saved agent: Claude Code on the server's runner
 * reads back as "Cloud", where it was picked.
 */
export const editorHarness = <H extends string>(
  harness: H | undefined,
  model: string | undefined,
  deviceKey: string | undefined
): H | 'cloud' | undefined =>
  harness === 'remote' &&
  deviceKey === CLOUD_DEVICE_KEY &&
  isDeviceClaudeModel(model)
    ? 'cloud'
    : harness;

/** What a device Claude model is called in lists; null for any other model. */
export const deviceHarnessName = (model: string | undefined) =>
  model === RESEARCH_MODEL
    ? 'Research'
    : model === WORKFLOW_MODEL
      ? 'Workflow'
      : model === CLAUDE_CODE_MODEL
        ? 'Claude Code'
        : null;

/** Something a running job asked the person who started it. */
export interface RemoteQuestion {
  id: string;
  /** 'question' wants text back; 'permission' wants allow or deny. */
  kind: 'question' | 'permission';
  text: string;
  /** For a permission: the tool input being approved. */
  detail: string | null;
  /** For a question: choices to pick from. Absent from older servers. */
  options?: string[];
  answer: string | null;
  allowed: boolean | null;
  createdAt: number;
  answeredAt: number | null;
}

/** A run's public read-only link (see the server's registry/share.ts). */
export interface RunShare {
  token: string;
  url: string;
  /** When the snapshot it shows was taken, epoch seconds. */
  sharedAt: number;
}

/** What a share link shows: a snapshot, not the live run. */
export interface SharedRun {
  title: string | null;
  status: string;
  log: string;
  result: string | null;
  error: string | null;
  questions: {
    kind: string;
    text: string;
    answer: string | null;
    allowed: boolean | null;
  }[];
  sharedAt: number;
}

export interface RemoteJob {
  id: string;
  deviceKey: string;
  /** The agent it runs as, and its model; null for a shell command. */
  agentId: string;
  agentName: string;
  model: string | null;
  /** 'held' while the workspace's prestart automations check it. */
  status: 'held' | 'queued' | 'running' | 'done' | 'error' | 'cancelled';
  /** What the run is called; the agent may rename it. Absent from older servers. */
  title?: string | null;
  result: string | null;
  error: string | null;
  steps: number;
  /** tmux session on the device; `tmux attach -t` it there to watch. */
  tmuxSession: string | null;
  /**
   * Epoch seconds a queued job waits until: the device hit its Claude
   * session limit and the job runs again once it resets.
   */
  runAfter?: number | null;
  /**
   * Epoch seconds the runner holding a running job must next report by;
   * past it the runner has gone quiet. Absent from older servers.
   */
  leaseExpiresAt?: number | null;
  /**
   * "Allow all": every tool the run asks for is allowed without asking.
   * Absent from older servers.
   */
  allowAllTools?: boolean;
  /** What the run cost in USD, once its runner reports it. Absent from older servers. */
  costUsd?: number | null;
  /** Tokens the run used, once its runner reports them. Absent from older servers. */
  tokens?: number | null;
  /** The cost cap the run was queued with, in USD. */
  maxCostUsd?: number | null;
  /** The permission level the run was queued with; unset is `write`. */
  access?: AgentAccess | null;
  /** Transcript from absolute offset `logFrom` to `logEnd`. */
  log?: string;
  logFrom?: number;
  logEnd?: number;
  startedAt: number | null;
  finishedAt: number | null;
  /** Present on single-job reads. */
  questions?: RemoteQuestion[];
  /** What the starter sent the run while it worked. Single-job reads only. */
  steers?: RemoteSteer[];
  /**
   * What the run changed, recorded by its runner as it ended; null when it
   * recorded nothing (an older runner). Single-job reads only.
   */
  changes?: RunChanges | null;
}

/**
 * An instruction sent to a running job. Its runner takes it on its next
 * step, and the server writes it into the transcript then.
 */
export interface RemoteSteer {
  id: string;
  text: string;
  createdAt: number;
  /** When the runner took it; null while it waits. */
  deliveredAt: number | null;
}

/** A workspace's agent spend this month, against its budget if it has one. */
export interface AgentBudget {
  /** Unset when there is no budget. */
  monthlyUsd: number | null;
  spentUsd: number;
  /** 'YYYY-MM' */
  month: string;
}

/** What one ended device or cloud run used; null parts went unreported. */
export interface SpentRun {
  docId: string | null;
  status: string;
  /** ISO time the run was queued. */
  createdAt: string;
  durationMs: number | null;
  costUsd: number | null;
  tokens: number | null;
}

export const openQuestions = (job: RemoteJob): RemoteQuestion[] =>
  (job.questions ?? []).filter(q => !q.answeredAt);

/** Messages sent to the job that its runner hasn't taken yet. */
export const waitingSteers = (job: RemoteJob): RemoteSteer[] =>
  (job.steers ?? []).filter(s => !s.deliveredAt);

/** One step of {@link RemoteAgentRunnerService.watch}. */
export interface RemoteJobUpdate {
  job: RemoteJob;
  /** Transcript text that is new since the previous update. */
  logDelta: string;
}

/**
 * What the server's running build was deployed from (`deploy-info.json`,
 * written by scripts/prod/redeploy.sh). Null where a build has no record.
 */
/**
 * A repo's branches as the Deployments screen ships it: set per repo on the
 * screen, never guessed, since they differ (stage and main for a repo that
 * releases from stage).
 */
export interface DeployRepo {
  /** owner/name, as in its pull request URLs. */
  repo: string;
  /** Where its pull requests merge. */
  baseBranch: string;
  /** What prod deploys from. */
  deployBranch: string;
}

export interface DeployInfo {
  /** owner/name, as in its pull request URLs. */
  repo: string;
  commit: string;
  branch: string;
  subject: string;
  /** The synced tree had uncommitted changes on top of `commit`. */
  dirty: boolean;
  deployedAt: string;
  /** Pull requests merged into `commit`, newest first (bounded). */
  pullRequests: number[];
  /**
   * The app's feature flags in the build, by the commit that added each.
   * Missing on records from before flags were stamped.
   */
  featureFlags?: Record<string, string>;
}

export interface EnqueueRemoteJob {
  deviceKey: string;
  agentId: string;
  agentName: string;
  instructions: string;
  context: string;
  model?: string;
  tools?: string[];
  /** Skills the run gets, by name; unset for the model's default set. */
  skills?: string[];
  maxSteps?: number;
  /** The most the run may spend, in USD; unset is no cap. */
  maxCostUsd?: number;
  /** What the run may do without asking; unset is `write`. */
  access?: AgentAccess;
  /** What the run starts out called; the agent may rename it. */
  title?: string;
  targetKind?: string;
  docId?: string;
  blockId?: string;
  /**
   * Task blocks in `docId` the run is on. The server marks them queued, in
   * progress once a device claims the job, and hands them back when it ends.
   */
  taskIds?: string[];
}

/** How often to ask the server whether a remote run has moved on. */
const POLL_MS = 1500;
/**
 * How long following a run rides out the server being unreachable before
 * giving up on it. A deploy restarts the server for about half a minute; the
 * run carries on on its device meanwhile and must not be recorded as failed.
 */
const WATCH_OUTAGE_MS = 3 * 60_000;

/**
 * Whether a failed read is the server being briefly away (a restart's 502,
 * no network) rather than an answer: a 4xx says the job is gone or not ours,
 * and asking again won't change that.
 */
const isTransient = (err: unknown) =>
  !(err instanceof UserFriendlyError) ||
  err.status === 429 ||
  err.status < 400 ||
  err.status >= 500;

export class RemoteAgentRunnerService extends Service {
  constructor(private readonly workspaceServerService: WorkspaceServerService) {
    super();
  }

  /**
   * FetchService lives in the server scope, not the workspace scope this
   * service is registered in, so it has to be reached through the
   * workspace's server rather than injected. Taking it as a constructor
   * dependency compiles fine and then throws
   * "Missing dependency [FetchService]" the first time anything resolves
   * this service - which is at render, so the settings pane crashes.
   *
   * Null for a local workspace: there is no server to run anything on.
   */
  private get fetchService(): FetchService | undefined {
    return this.workspaceServerService.server?.scope.get(FetchService);
  }

  /** False for a local workspace, which has no server to run jobs on. */
  get hasServer(): boolean {
    return !!this.fetchService;
  }

  private base(workspaceId: string) {
    return `/api/registry/workspaces/${encodeURIComponent(workspaceId)}`;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    const fetchService = this.fetchService;
    if (!fetchService) {
      throw new Error(
        'This workspace is local, so there is no server to run an agent on.'
      );
    }
    const response = await fetchService.fetch(url, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
    if (!response.ok) {
      // The server's message is the useful part -- "not an agent target",
      // "no such device" -- so surface it rather than a bare status code.
      let detail = `${response.status}`;
      try {
        const body = (await response.json()) as { message?: string };
        if (body?.message) detail = body.message;
      } catch {
        // non-JSON error body; the status is all we have
      }
      throw new Error(detail);
    }
    // An API path the server doesn't have falls through to the SPA, which
    // answers 200 with index.html. Catch that here so it reads as "not
    // deployed" rather than as a JSON parse error.
    const text = await response.text();
    if (text.trimStart().startsWith('<')) {
      throw new Error(
        'The agent jobs API is not available on this server yet.'
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Unexpected response from ${url}`);
    }
  }

  /** The run's public link, if it has one. */
  async getShare(workspaceId: string, jobId: string): Promise<RunShare | null> {
    const data = await this.json<{ share: RunShare | null }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/share`
    );
    return data.share;
  }

  /** Make the run's public link, or refresh what it shows. */
  async share(workspaceId: string, jobId: string): Promise<RunShare> {
    const data = await this.json<{ share: RunShare }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/share`,
      { method: 'POST' }
    );
    return data.share;
  }

  async unshare(workspaceId: string, jobId: string): Promise<void> {
    await this.json(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/share`,
      { method: 'DELETE' }
    );
  }

  /** Each repo's branches, as the Deployments screen ships it. */
  async deployRepos(workspaceId: string): Promise<DeployRepo[]> {
    const data = await this.json<{ repos: DeployRepo[] }>(
      `${this.base(workspaceId)}/deploy-repos`
    );
    return data.repos;
  }

  async setDeployRepo(
    workspaceId: string,
    repo: DeployRepo
  ): Promise<DeployRepo[]> {
    const data = await this.json<{ repos: DeployRepo[] }>(
      `${this.base(workspaceId)}/deploy-repos`,
      { method: 'POST', body: JSON.stringify(repo) }
    );
    return data.repos;
  }

  async removeDeployRepo(
    workspaceId: string,
    repo: string
  ): Promise<DeployRepo[]> {
    const data = await this.json<{ repos: DeployRepo[] }>(
      `${this.base(workspaceId)}/deploy-repos/remove`,
      { method: 'POST', body: JSON.stringify({ repo }) }
    );
    return data.repos;
  }

  /** List the devices in this workspace that accept agent work. */
  /** What the server is running, for checking pull requests against. */
  async deployInfo(): Promise<DeployInfo | null> {
    const data = await this.json<{ deployInfo?: DeployInfo | null }>(
      '/api/server/deploy-info'
    );
    return data.deployInfo ?? null;
  }

  async agentTargets(workspaceId: string) {
    const data = await this.json<{
      devices: {
        key: string;
        name: string;
        state: string;
        kind: string;
        /** The folder the device works in, when it was registered with one. */
        path?: string | null;
      }[];
    }>(`${this.base(workspaceId)}/devices?agentTarget=true`);
    return data.devices;
  }

  /** This month's agent spend in the workspace, and its budget if one is set. */
  async budget(workspaceId: string): Promise<AgentBudget> {
    const data = await this.json<{ budget: AgentBudget }>(
      `${this.base(workspaceId)}/agent-budget`
    );
    return data.budget;
  }

  /** Set the monthly budget in USD, or clear it with null. */
  async setBudget(
    workspaceId: string,
    monthlyUsd: number | null
  ): Promise<AgentBudget> {
    const data = await this.json<{ budget: AgentBudget }>(
      `${this.base(workspaceId)}/agent-budget`,
      { method: 'POST', body: JSON.stringify({ monthlyUsd }) }
    );
    return data.budget;
  }

  /** Device and cloud runs that ended in the last `days` days, newest first. */
  async spend(workspaceId: string, days: number): Promise<SpentRun[]> {
    const data = await this.json<{ runs: SpentRun[] }>(
      `${this.base(workspaceId)}/agent-spend?days=${days}`
    );
    return data.runs;
  }

  /**
   * The workspace's skill notes ("Skill: <name>"), which an agent can be
   * given beside the catalog's skills by their `ref`. Empty on a server
   * that predates them.
   */
  async skillNotes(workspaceId: string): Promise<SkillNote[]> {
    try {
      const data = await this.json<{ skills?: SkillNote[] }>(
        `${this.base(workspaceId)}/skills`
      );
      return data.skills ?? [];
    } catch {
      return [];
    }
  }

  /** A skill note rendered as a Claude Code SKILL.md, as a runner gets it. */
  async skillNoteMd(workspaceId: string, docId: string): Promise<string> {
    const fetchService = this.fetchService;
    if (!fetchService) {
      throw new Error('This workspace is local, so there is no server to ask.');
    }
    const response = await fetchService.fetch(
      `${this.base(workspaceId)}/skills/${encodeURIComponent(docId)}/SKILL.md`
    );
    const text = await response.text();
    if (!response.ok || text.trimStart().startsWith('<')) {
      throw new Error(
        response.status === 404
          ? 'Only a note titled “Skill: <name>” can be exported as a skill.'
          : `Could not export the skill (${response.status}).`
      );
    }
    return text;
  }

  async enqueue(
    workspaceId: string,
    input: EnqueueRemoteJob
  ): Promise<RemoteJob> {
    const { deviceKey, ...body } = input;
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/devices/${encodeURIComponent(deviceKey)}/jobs`,
      { method: 'POST', body: JSON.stringify(body) }
    );
    return data.job;
  }

  async get(
    workspaceId: string,
    jobId: string,
    logFrom = 0
  ): Promise<RemoteJob> {
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}?logFrom=${logFrom}`
    );
    return data.job;
  }

  /** Answer a question a job asked; only its starter is allowed to. */
  async answer(
    workspaceId: string,
    jobId: string,
    questionId: string,
    /** `allowAll` (with `allowed: true`): allow every later tool in the run. */
    answer: { answer?: string; allowed?: boolean; allowAll?: boolean }
  ): Promise<RemoteQuestion> {
    const data = await this.json<{ question: RemoteQuestion }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/questions/${encodeURIComponent(questionId)}/answer`,
      { method: 'POST', body: JSON.stringify(answer) }
    );
    return data.question;
  }

  /**
   * "Allow all" before the run has asked anything — even while it is still
   * queued; only its starter is allowed to.
   */
  async allowAll(workspaceId: string, jobId: string): Promise<RemoteJob> {
    const data = await this.json<{ job: RemoteJob }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/allow-all`,
      { method: 'POST' }
    );
    return data.job;
  }

  /**
   * Send a running job a new instruction; its runner takes it on its next
   * step. Only its starter is allowed to, and only before it ends.
   */
  async steer(
    workspaceId: string,
    jobId: string,
    text: string
  ): Promise<RemoteSteer> {
    const data = await this.json<{ steer: RemoteSteer }>(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/steer`,
      { method: 'POST', body: JSON.stringify({ text }) }
    );
    return data.steer;
  }

  async cancel(workspaceId: string, jobId: string): Promise<void> {
    await this.json(
      `${this.base(workspaceId)}/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
      }
    );
  }

  /**
   * Poll a job to completion, yielding whenever its status or title changes,
   * its transcript grows, or what it is waiting to be answered changes. Only
   * the new part of the transcript is fetched each time.
   *
   * With `cancelOnAbort` (the default — the tab that started the run), an
   * abort cancels the job server-side before returning: leaving a device
   * working on a run whose tab has closed is the one failure mode that costs
   * someone else's hardware. Someone merely viewing a run's log passes
   * false, so closing the log does not stop the run.
   */
  async *watch(
    workspaceId: string,
    jobId: string,
    signal: AbortSignal,
    { cancelOnAbort = true }: { cancelOnAbort?: boolean } = {}
  ): AsyncIterable<RemoteJobUpdate> {
    let lastStatus = '';
    let lastOpen = '';
    let lastWaiting = '';
    let lastTitle: string | null | undefined;
    let lastAllowAll: boolean | undefined;
    let logFrom = 0;
    try {
      let failingSince: number | null = null;
      while (!signal.aborted) {
        let job: RemoteJob;
        try {
          job = await this.get(workspaceId, jobId, logFrom);
          failingSince = null;
        } catch (err) {
          if (signal.aborted) return;
          if (!isTransient(err)) throw err;
          failingSince ??= Date.now();
          if (Date.now() - failingSince > WATCH_OUTAGE_MS) {
            const detail =
              err instanceof Error && err.message ? err.message : 'no answer';
            throw new Error(
              `Lost touch with the server while following this run (${detail}). ` +
                'It may still be going on its device; reopen its log to check.'
            );
          }
          await new Promise(resolve => setTimeout(resolve, POLL_MS * 2));
          continue;
        }
        const logDelta = job.log ?? '';
        logFrom = job.logEnd ?? logFrom;
        const open = openQuestions(job)
          .map(q => q.id)
          .join(',');
        const waiting = waitingSteers(job)
          .map(s => s.id)
          .join(',');
        if (
          job.status !== lastStatus ||
          logDelta ||
          open !== lastOpen ||
          waiting !== lastWaiting ||
          job.title !== lastTitle ||
          job.allowAllTools !== lastAllowAll
        ) {
          lastStatus = job.status;
          lastOpen = open;
          lastWaiting = waiting;
          lastTitle = job.title;
          lastAllowAll = job.allowAllTools;
          yield { job, logDelta };
        }
        if (['done', 'error', 'cancelled'].includes(job.status)) {
          return;
        }
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
      }
    } finally {
      if (signal.aborted && cancelOnAbort) {
        await this.cancel(workspaceId, jobId).catch(() => {
          // Best effort: the lease expires on its own if this never lands.
        });
      }
    }
  }
}
