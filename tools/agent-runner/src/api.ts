/**
 * NotesGraph's agent-jobs API, as a device's runner sees it: the same calls
 * `wf agent serve` makes (workflow/deploy/jobs.py JobClient, agent_mcp.py).
 */

/** A shell step, in wf's recipe shape; see plugins/registry/agent-profiles.ts. */
export interface AutomationStep {
  name: string;
  run: string;
  timeout?: number;
  optional?: boolean;
}

/** A command handed to the agent as `mcp__automation__<name>`. */
export interface AutomationTool extends AutomationStep {
  description: string;
  params?: Record<string, { description: string; required?: boolean }>;
}

export interface Automation {
  setup: AutomationStep[];
  tools: AutomationTool[];
  teardown: AutomationStep[];
  cwd?: string;
}

/** How the server says to run a job; see plugins/registry/agent-profiles.ts. */
export interface AgentProfile {
  systemPrompt: string;
  allowedTools: string[];
  mcpServers: Array<'notesgraph' | 'run' | 'omniseek'>;
  workdir: 'repo' | 'job';
  toolTimeoutMs: number;
  /** Absent from a server that predates automations. */
  automation?: Automation;
  /** Claude Code skills to load, each a SKILL.md at a URL. */
  skills?: Array<{ name: string; url: string }>;
}

export interface Job {
  id: string;
  /** The agent that asked; `health:<device>` for a health check. */
  agentId?: string;
  agentName: string;
  instructions: string;
  context: string;
  model: string | null;
  status: string;
  title: string | null;
  /** The agent's step limit; see turnLimit in run-job.ts for how it caps a run. */
  maxSteps?: number;
  /** Stop the run once it has spent this much (USD). */
  maxCostUsd?: number | null;
  profile?: AgentProfile | null;
}

export interface Question {
  id: string;
  kind: 'question' | 'permission';
  answer: string | null;
  allowed: boolean | null;
  answeredAt: number | null;
}

/** An instruction the person sent the job while it ran. */
export interface Steer {
  id: string;
  text: string;
  createdAt: number;
}

export class NotesGraphError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

/**
 * A device's "jobs at once" as the server sends it: null (or absent, from an
 * older server) leaves it to the runner's own setting.
 */
const asMaxJobs = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1
    ? value
    : null;

export class NotesGraphApi {
  constructor(
    readonly url: string,
    readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.url = url.replace(/\/$/, '');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.url}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new NotesGraphError(
        `NotesGraph unreachable at ${this.url}: ${err}`
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new NotesGraphError(
        `${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`,
        response.status
      );
    }
    if (!text.trim()) return {} as T;
    if (text.trimStart().startsWith('<')) {
      // An API path the server doesn't have falls through to the web app.
      throw new NotesGraphError(
        `${path} returned a web page: the agent jobs API is not on this server`
      );
    }
    return JSON.parse(text) as T;
  }

  private base(workspaceId: string) {
    return `/api/registry/workspaces/${workspaceId}`;
  }

  /** Create or update this runner's device, as one agents may run on. */
  async register(workspaceId: string, device: Record<string, unknown>) {
    return await this.request(
      'POST',
      `${this.base(workspaceId)}/devices`,
      device
    );
  }

  async claim(
    workspaceId: string,
    deviceKey: string,
    runnerId: string,
    leaseSeconds: number
  ): Promise<{ job: Job | null; maxJobs: number | null }> {
    const { job, maxJobs } = await this.request<{
      job: Job | null;
      maxJobs?: number | null;
    }>('POST', `${this.base(workspaceId)}/devices/${deviceKey}/jobs/claim`, {
      runnerId,
      leaseSeconds,
    });
    return { job: job ?? null, maxJobs: asMaxJobs(maxJobs) };
  }

  /**
   * What the device is set to run at once in the app, without claiming: for
   * a runner whose slots are full to notice that it may take more.
   */
  async maxJobs(
    workspaceId: string,
    deviceKey: string
  ): Promise<number | null> {
    const { device } = await this.request<{
      device: { maxJobs?: number | null };
    }>('GET', `${this.base(workspaceId)}/devices/${deviceKey}`);
    return asMaxJobs(device?.maxJobs);
  }

  /** Report on a job (renewing its lease); returns the job as the server has it. */
  async report(
    workspaceId: string,
    jobId: string,
    fields: Record<string, unknown>
  ): Promise<Job | null> {
    const { job } = await this.request<{ job: Job | null }>(
      'POST',
      `${this.base(workspaceId)}/jobs/${jobId}/report`,
      fields
    );
    return job ?? null;
  }

  async setTitle(
    workspaceId: string,
    jobId: string,
    title: string
  ): Promise<string> {
    const { job } = await this.request<{ job: Job }>(
      'POST',
      `${this.base(workspaceId)}/jobs/${jobId}/title`,
      { title }
    );
    return job.title ?? title;
  }

  async ask(
    workspaceId: string,
    jobId: string,
    question: {
      kind: string;
      text: string;
      detail?: string | null;
      options?: string[];
    }
  ): Promise<Question> {
    const { question: asked } = await this.request<{ question: Question }>(
      'POST',
      `${this.base(workspaceId)}/jobs/${jobId}/questions`,
      question
    );
    return asked;
  }

  /** Take the instructions sent to the job since the last take; each comes once. */
  async takeSteers(workspaceId: string, jobId: string): Promise<Steer[]> {
    const { steers } = await this.request<{ steers?: Steer[] }>(
      'POST',
      `${this.base(workspaceId)}/jobs/${jobId}/steer/take`
    );
    return steers ?? [];
  }

  async getQuestion(
    workspaceId: string,
    jobId: string,
    questionId: string
  ): Promise<{ question: Question; jobStatus: string }> {
    return await this.request(
      'GET',
      `${this.base(workspaceId)}/jobs/${jobId}/questions/${questionId}`
    );
  }
}
