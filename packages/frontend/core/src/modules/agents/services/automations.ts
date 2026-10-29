import { LiveData, Service } from '@notesgraph/infra';

import { FetchService, type WorkspaceServerService } from '../../cloud';
import type { FetchInit } from '../../cloud/services/fetch';
import type { WorkspaceService } from '../../workspace';

/**
 * Automations: code that runs on a device when a schedule, an event, a
 * webhook, a click or an agent run (its prestart and end hooks) says so.
 * See plugins/automations on the server. This is their client, behind the
 * Automations page.
 */

export const AUTOMATION_EVENTS = [
  'job.finished',
  'run.started',
  'run.failed',
  'monitor.reading',
  'doc.updated',
] as const;
export type AutomationEvent = (typeof AUTOMATION_EVENTS)[number];

export interface AutomationFilter {
  agentId?: string;
  deviceKey?: string;
  monitorId?: string;
  docId?: string;
  status?: string;
}

export type AutomationTrigger =
  | { type: 'cron'; expr: string; tz?: string }
  | { type: 'interval'; minutes: number }
  | { type: 'event'; event: AutomationEvent; filter?: AutomationFilter }
  | {
      type: 'hook';
      hook: 'prestart' | 'end';
      filter?: Pick<AutomationFilter, 'agentId' | 'deviceKey'>;
    }
  | { type: 'webhook' }
  | { type: 'manual' };

export type AutomationTriggerType = AutomationTrigger['type'];

export interface Automation {
  id: string;
  name: string;
  docId: string | null;
  blockId: string | null;
  runtime: AutomationRuntime;
  triggers: AutomationTrigger[];
  secrets: string[];
  timeoutSeconds: number;
  maxRetries: number;
  enabled: boolean;
  hasWebhook: boolean;
  /** Epoch seconds. */
  nextRunAt: number | null;
  lastRunAt: number | null;
  deployments: { target: string; versionId: string; deployedAt: number }[];
}

/**
 * How the code runs: 'node' is JavaScript; 'shell' is JavaScript given `sh`
 * too, to run commands on the device; 'actions' is YAML in wf's own action
 * language. The last two need a device running wf.
 */
export type AutomationRuntime = 'node' | 'shell' | 'actions';

export interface AutomationDraft {
  name: string;
  runtime?: AutomationRuntime;
  triggers: AutomationTrigger[];
  secrets: string[];
  timeoutSeconds: number;
  maxRetries: number;
  enabled: boolean;
}

export interface AutomationDetails {
  automation: Automation;
  versions: { id: string; number: number; createdAt: number }[];
  /** The latest version's code; null before any is saved. */
  code: string | null;
}

export type AutomationRunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface AutomationRun {
  id: string;
  versionId: string;
  target: string;
  trigger: { type: AutomationTriggerType; event?: string; hook?: string };
  status: AutomationRunStatus;
  attempt: number;
  output: unknown;
  error: string | null;
  jobId: string | null;
  /** Single-run reads only. */
  input?: unknown;
  logs?: string;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  triggers: AutomationTrigger[];
  code: string;
}

/** What a new automation starts with, before a template or an edit. */
export const BLANK_AUTOMATION_CODE = `// The body of an async function. \`input\` is what started this run, \`secrets\`
// holds the workspace secrets named below, and \`fetch\` and \`console\` work as
// usual. What you return is the run's output.
console.log('started by', input);
return { ok: true };
`;

/** What a new wf actions automation starts with. */
export const BLANK_ACTIONS_CODE = `# wf actions, run in order on the device by wf. {input.x} is filled from
# what started the run, {steps.<id>.stdout} from an earlier command. Types
# include custom_command, cloud_deploy and notification.
actions:
  - id: hello
    type: custom_command
    command: echo started by {input.type}
`;

/** What each runtime is called in the editor. */
export const AUTOMATION_RUNTIME_LABELS: Record<AutomationRuntime, string> = {
  node: 'JavaScript',
  shell: 'JavaScript with sh (wf devices)',
  actions: 'wf actions YAML (wf devices)',
};

/** The webhook URL for a token, on this server. */
export const webhookUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/$/, '')}/api/automations/hooks/${token}`;

const REFRESH_MS = 30_000;
/** How often a run being waited on is read again. */
const RUN_POLL_MS = 2_000;
const ACTIVE_RUN_STATUSES = new Set<AutomationRunStatus>(['queued', 'running']);

export class AutomationsService extends Service {
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly workspaceService: WorkspaceService
  ) {
    super();
  }

  readonly automations$ = new LiveData<Automation[]>([]);
  readonly loaded$ = new LiveData<boolean>(false);
  /** Why the list couldn't be loaded (a local workspace, an older server). */
  readonly error$ = new LiveData<string | null>(null);

  private timer: ReturnType<typeof setInterval> | null = null;
  private watchers = 0;

  /** Keep the list fresh while something shows it; returns the stop. */
  watch(): () => void {
    this.watchers += 1;
    if (this.watchers === 1) {
      this.revalidate().catch(() => {});
      this.timer = setInterval(() => {
        this.revalidate().catch(() => {});
      }, REFRESH_MS);
    }
    return () => {
      this.watchers -= 1;
      if (this.watchers === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  }

  /** The server's own address, for webhook URLs. */
  get baseUrl(): string {
    return this.workspaceServerService.server?.baseUrl ?? location.origin;
  }

  private get workspaceId(): string {
    const id = this.workspaceService.workspace?.id;
    if (!id) throw new Error('No workspace is open');
    return id;
  }

  private fetchService(): FetchService {
    const server = this.workspaceServerService.server;
    if (!server) {
      throw new Error(
        'Automations run on a server, and this workspace is local.'
      );
    }
    return server.scope.get(FetchService);
  }

  private async json<T>(path: string, init: FetchInit = {}): Promise<T> {
    const response = await this.fetchService().fetchRaw(
      `/api/workspaces/${this.workspaceId}/automations${path}`,
      {
        ...init,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      }
    );
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 200);
      try {
        message = JSON.parse(text).message ?? message;
      } catch {
        // Not JSON: an older server without automations answers with its app page.
        if (response.status === 404)
          message = 'This server has no automations yet.';
      }
      throw new Error(message);
    }
    return JSON.parse(text) as T;
  }

  async revalidate(): Promise<Automation[]> {
    try {
      const { automations } = await this.json<{ automations: Automation[] }>(
        '/'
      );
      this.automations$.setValue(automations);
      this.error$.setValue(null);
      return automations;
    } catch (err) {
      this.error$.setValue(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      this.loaded$.setValue(true);
    }
  }

  private replace(automation: Automation) {
    const list = this.automations$.value;
    const at = list.findIndex(a => a.id === automation.id);
    this.automations$.setValue(
      at < 0
        ? [...list, automation]
        : list.map(a => (a.id === automation.id ? automation : a))
    );
  }

  async templates(): Promise<AutomationTemplate[]> {
    const { templates } = await this.json<{ templates: AutomationTemplate[] }>(
      '/templates'
    );
    return templates;
  }

  async get(id: string): Promise<AutomationDetails> {
    return this.json<AutomationDetails>(`/${id}`);
  }

  /** Create one with its first version; returns a webhook token if it has one. */
  async create(
    draft: AutomationDraft,
    code: string
  ): Promise<{ automation: Automation; webhookToken?: string }> {
    const result = await this.json<{
      automation: Automation;
      webhookToken?: string;
    }>('/', { method: 'POST', body: JSON.stringify({ ...draft, code }) });
    this.replace(result.automation);
    return result;
  }

  async update(
    id: string,
    changes: Partial<AutomationDraft>
  ): Promise<{ automation: Automation; webhookToken?: string }> {
    const result = await this.json<{
      automation: Automation;
      webhookToken?: string;
    }>(`/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
    this.replace(result.automation);
    return result;
  }

  async remove(id: string): Promise<void> {
    await this.json(`/${id}`, { method: 'DELETE' });
    this.automations$.setValue(
      this.automations$.value.filter(a => a.id !== id)
    );
  }

  /** Save code as a new version (the same code twice keeps one). */
  async saveCode(
    id: string,
    code: string
  ): Promise<{ id: string; number: number }> {
    const { version } = await this.json<{
      version: { id: string; number: number };
    }>(`/${id}/versions`, { method: 'POST', body: JSON.stringify({ code }) });
    return version;
  }

  /** Run its latest version on a device. */
  async deploy(id: string, target: string): Promise<void> {
    await this.json(`/${id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
    await this.revalidate().catch(() => {});
  }

  async undeploy(id: string, target: string): Promise<void> {
    await this.json(`/${id}/deployments/${encodeURIComponent(target)}`, {
      method: 'DELETE',
    });
    await this.revalidate().catch(() => {});
  }

  /** Run it now, on `target` or the first device it is deployed to. */
  async runNow(
    id: string,
    input?: unknown,
    target?: string
  ): Promise<AutomationRun> {
    const { run } = await this.json<{ run: AutomationRun }>(`/${id}/run`, {
      method: 'POST',
      body: JSON.stringify({ input: input ?? null, target }),
    });
    return run;
  }

  /**
   * Follow a run until it ends, calling `onUpdate` with each read of it
   * (logs included). Resolves with the ended run; rejects when `signal`
   * aborts first.
   */
  async waitForRun(
    id: string,
    runId: string,
    {
      signal,
      onUpdate,
      intervalMs = RUN_POLL_MS,
    }: {
      signal?: AbortSignal;
      onUpdate?: (run: AutomationRun) => void;
      intervalMs?: number;
    } = {}
  ): Promise<AutomationRun> {
    for (;;) {
      signal?.throwIfAborted();
      const run = await this.run(id, runId);
      onUpdate?.(run);
      if (!ACTIVE_RUN_STATUSES.has(run.status)) return run;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, intervalMs);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(signal.reason);
          },
          { once: true }
        );
      });
    }
  }

  async runs(id: string): Promise<AutomationRun[]> {
    const { runs } = await this.json<{ runs: AutomationRun[] }>(`/${id}/runs`);
    return runs;
  }

  async run(id: string, runId: string): Promise<AutomationRun> {
    const { run } = await this.json<{ run: AutomationRun }>(
      `/${id}/runs/${runId}`
    );
    return run;
  }

  async rotateToken(id: string): Promise<string> {
    const { webhookToken } = await this.json<{ webhookToken: string }>(
      `/${id}/rotate-token`,
      { method: 'POST' }
    );
    return webhookToken;
  }
}
