/**
 * Run one claimed job, as its profile describes:
 *
 *   1. automation setup: shell steps that prepare the ground (a worktree of
 *      the repo, a sources folder), before any model runs;
 *   2. Claude Code (through the Agent SDK) with NotesGraph's tools, the run's
 *      own tools, the automation's tools and, for research, OmniSeek;
 *   3. automation teardown, however the run ended.
 *
 * The cloud twin of wf's run_job for claude-code and research jobs. Every
 * line of the transcript goes through `say`, rendered as a Mac's runner
 * renders it (narrate.ts).
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  McpServerConfig,
  Options,
  query as sdkQuery,
} from '@anthropic-ai/claude-agent-sdk';

import type { Job, NotesGraphApi } from './api';
import {
  automationServer,
  emptyAutomation,
  jobPlaceholders,
  render,
  runSteps,
  type ShellEnv,
} from './automation';
import {
  ChangeRecorder,
  collectChanges,
  gitBase,
  type RunChanges,
} from './changes';
import {
  answerGitHubRequest,
  type Gh,
  ghCli,
  isGitHubRequest,
  parseGitHubRequest,
  repoFromUrl,
} from './github';
import { healthReading, isHealthCheck } from './health';
import { Narrator } from './narrate';
import { permissionPrompt, runServer, steerHooks } from './run-tools';
import { skillsPlugin } from './skills';
import { jobDir } from './workdir';

export interface RunnerSettings {
  workRoot: string;
  /** The repo a code task works in, e.g. https://github.com/imdark/notes-graph. */
  repo?: string;
  repoBranch?: string;
  omniseekUrl?: string;
  omniseekToken?: string;
  /**
   * How Claude Code signs in, passed to it and nothing else: a Claude
   * subscription token (`claude setup-token`, CLAUDE_CODE_OAUTH_TOKEN) or
   * an Anthropic API key. One of them is set.
   */
  claudeOauthToken?: string;
  anthropicApiKey?: string;
  ghToken?: string;
}

export interface RunDeps {
  api: NotesGraphApi;
  workspaceId: string;
  settings: RunnerSettings;
  /** The SDK's query; a stand-in in tests. */
  query: typeof sdkQuery;
  /** One transcript line (or a few), as it happens. */
  say: (line: string) => void;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  /** `gh`; a stand-in in tests. */
  gh?: Gh;
}

/** What a run spent, reported with its end whichever way it ended. */
export interface RunUsage {
  costUsd?: number;
  tokens?: number;
}

export interface RunOutcome extends RunUsage {
  result: string;
  steps: number;
  /** What the run changed, when it changed anything. */
  changes?: RunChanges;
}

/** A run that ended in an error, with what it spent getting there. */
export class RunFailed extends Error {
  constructor(
    message: string,
    readonly usage: RunUsage,
    readonly changes?: RunChanges
  ) {
    super(message);
  }
}

const usageOf = (narrator: Narrator): RunUsage => ({
  ...(narrator.cost === null ? {} : { costUsd: narrator.cost }),
  ...(narrator.tokens === null ? {} : { tokens: narrator.tokens }),
});

/**
 * What a job asks, as wf words it (jobs.py _prompt). The note item the run
 * was started on leads as the task; the agent's instructions follow as how to
 * work on it. Led by the instructions, runs took standing ones ("work through
 * the checkboxes until all are done") for a feature to build.
 */
export const jobPrompt = (job: Job) => {
  const context = job.context.trim();
  const instructions = job.instructions.trim();
  if (!context) return job.instructions;
  if (!instructions) return job.context;
  return (
    `THE TASK - the note item this run was started on:\n${context}\n\n` +
    `HOW TO WORK ON IT - standing instructions from the agent "${job.agentName}". ` +
    'They say how to approach the task above; they are not a separate ' +
    `feature or change to make:\n${instructions}`
  );
};

/**
 * The most turns a run may take. The agent editor hides the step limit for
 * Claude agents, so most jobs carry its default (8): far too few for Claude
 * Code, where each round of tool calls is a turn. The limit is kept as a
 * floor-raised cap, a guard against a run that loops, not a budget: a code
 * task gets at least 200 turns, anything else (research) at least 40.
 */
export const turnLimit = (job: Job): number | undefined => {
  const steps = job.maxSteps;
  if (typeof steps !== 'number' || !Number.isFinite(steps) || steps <= 0)
    return undefined;
  const floor = job.profile?.workdir === 'repo' ? 200 : 40;
  return Math.max(Math.floor(steps), floor);
};

async function omniseek(settings: RunnerSettings, fetchImpl: typeof fetch) {
  const url = settings.omniseekUrl?.replace(/\/$/, '');
  if (!url || !settings.omniseekToken) {
    throw new Error(
      "OmniSeek isn't set up on the cloud runner (OMNISEEK_URL and OMNISEEK_TOKEN)."
    );
  }
  try {
    const health = await fetchImpl(`${url}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (err) {
    throw new Error(
      `OmniSeek isn't running for the cloud runner (${url}: ${err}).`
    );
  }
  // /healthz can pass while /mcp refuses the runner (token, Host header), and
  // the run would then start with OmniSeek silently disconnected.
  try {
    const mcp = await fetchImpl(`${url}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${settings.omniseekToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'agent-runner', version: '1' },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!mcp.ok) throw new Error(`HTTP ${mcp.status}`);
  } catch (err) {
    throw new Error(
      `OmniSeek is up but its MCP endpoint refused the cloud runner (${url}/mcp: ${err}). Check OMNISEEK_TOKEN.`
    );
  }
  return { url, token: settings.omniseekToken };
}

export async function runJob(job: Job, deps: RunDeps): Promise<RunOutcome> {
  const { api, workspaceId, settings, say } = deps;
  // A health check is answered from here; its script is never run.
  if (isHealthCheck(job)) {
    say('$ health check (read by the cloud runner)');
    return { result: await healthReading(settings.workRoot), steps: 0 };
  }
  // So is a Deployments request: gh runs with arguments built here.
  if (isGitHubRequest(job)) {
    const request = parseGitHubRequest(job);
    say(`$ gh: ${request.op} (run by the cloud runner)`);
    const gh = deps.gh ?? ghCli(settings.ghToken);
    return {
      result: await answerGitHubRequest(
        request,
        gh,
        repoFromUrl(settings.repo)
      ),
      steps: 0,
    };
  }
  const profile = job.profile;
  if (!profile) {
    throw new Error(
      `A ${job.model ?? 'plain'} job runs on a Mac device only; the cloud runner runs ` +
        'Claude Code, Workflow and Research agents.'
    );
  }
  const automation = profile.automation ?? emptyAutomation;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const seek = profile.mcpServers.includes('omniseek')
    ? await omniseek(settings, fetchImpl)
    : null;
  if (
    automation.setup.some(step => step.run.includes('{repo}')) &&
    !settings.repo
  ) {
    throw new Error('The cloud runner has no repo to work in (RUNNER_REPO).');
  }

  say(`$ claude … (${job.model}, job ${job.id}, cloud)`);
  say(
    '  Claude can read and write your notes, and will ask you in NotesGraph when it needs something.'
  );

  const workdir = await jobDir(settings.workRoot, job.id);
  const cache = join(settings.workRoot, 'cache');
  await mkdir(cache, { recursive: true });
  const values = {
    ...jobPlaceholders(
      job.id,
      workdir.path,
      cache,
      settings.repo,
      settings.repoBranch ?? 'main'
    ),
    // What the job asks, for a step that turns it into something (a ticket).
    prompt_file: join(workdir.path, 'prompt.md'),
  };
  await writeFile(values.prompt_file, jobPrompt(job));
  // What the job is about, for the ticket's title (`wf agent prepare-task`
  // reads it from the job directory): the note item, not the instructions.
  if (job.title?.trim()) {
    await writeFile(join(workdir.path, 'title.txt'), job.title.trim());
  }
  // Steps and tools see the runner's credentials for git and the network,
  // never the API key the model runs on.
  const shell: ShellEnv = {
    cwd: workdir.path,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: 'C.UTF-8',
      JOB_ID: job.id,
      JOB_DIR: workdir.path,
      ...(settings.ghToken ? { GH_TOKEN: settings.ghToken } : {}),
    },
    signal: deps.signal,
  };

  const ctx = { api, workspaceId, jobId: job.id, signal: deps.signal };
  try {
    await runSteps('setup', automation.setup, values, shell, say);
    const handed = await handedOver(workdir.path);
    const skills = await skillsPlugin(
      profile.skills ?? [],
      workdir.path,
      fetchImpl,
      say,
      api
    );
    const plugins = [...(handed.plugins ?? []), ...(skills ? [skills] : [])];
    const cwd = handed.cwd ?? render(automation.cwd ?? '{job_dir}', values);
    // Tools and teardown work where the agent does.
    shell.env.AGENT_CWD = cwd;
    // Where the run starts from, to say later what it committed and changed.
    const base = await gitBase(cwd);

    const mcpServers: Record<string, McpServerConfig> = {};
    if (profile.mcpServers.includes('notesgraph')) {
      mcpServers.notesgraph = {
        type: 'http',
        url: `${api.url}/api/workspaces/${workspaceId}/mcp`,
        headers: { Authorization: `Bearer ${api.token}` },
        timeout: profile.toolTimeoutMs,
      };
    }
    if (profile.mcpServers.includes('run')) {
      mcpServers.run = runServer(ctx);
    }
    if (seek) {
      mcpServers.omniseek = {
        type: 'http',
        url: `${seek.url}/mcp`,
        headers: { Authorization: `Bearer ${seek.token}` },
        timeout: profile.toolTimeoutMs,
      };
    }
    // The automation's tools are the profile owner's own commands: allowed
    // without asking, like NotesGraph's.
    const allowedTools = [...profile.allowedTools];
    if (automation.tools.length) {
      mcpServers.automation = automationServer(
        automation.tools,
        values,
        shell,
        say
      );
      allowedTools.push('mcp__automation');
    }

    const abortController = new AbortController();
    deps.signal.addEventListener('abort', () => abortController.abort());
    const maxTurns = turnLimit(job);
    const options: Options = {
      cwd,
      ...(maxTurns ? { maxTurns } : {}),
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: profile.systemPrompt,
      },
      allowedTools,
      canUseTool: permissionPrompt(ctx),
      // What the person sends the run from NotesGraph while it works.
      hooks: steerHooks(ctx),
      mcpServers,
      strictMcpConfig: true,
      // Nothing from the runner's own settings or CLAUDE.md files; the profile is the agent.
      settingSources: [],
      abortController,
      ...(job.maxCostUsd ? { maxBudgetUsd: job.maxCostUsd } : {}),
      ...(plugins.length
        ? { plugins: plugins.map(path => ({ type: 'local' as const, path })) }
        : {}),
      env: {
        ...shell.env,
        ...(settings.claudeOauthToken
          ? { CLAUDE_CODE_OAUTH_TOKEN: settings.claudeOauthToken }
          : { ANTHROPIC_API_KEY: settings.anthropicApiKey }),
        MCP_TOOL_TIMEOUT: String(profile.toolTimeoutMs),
      },
    };

    const recorder = new ChangeRecorder(cwd);
    const narrator = new Narrator(say, maxTurns, recorder);
    const prompt = handed.prompt ?? jobPrompt(job);
    for await (const message of deps.query({ prompt, options })) {
      narrator.feed(message);
    }
    narrator.finish();
    // Before teardown, which may remove the checkout.
    const changes = await collectChanges(recorder, cwd, base);
    if (narrator.result !== null) {
      return {
        result: narrator.result,
        steps: narrator.steps,
        ...usageOf(narrator),
        ...(changes ? { changes } : {}),
      };
    }
    throw new RunFailed(
      narrator.error ?? 'the run ended without a result',
      usageOf(narrator),
      changes
    );
  } finally {
    await runSteps(
      'teardown',
      automation.teardown,
      values,
      { ...shell, signal: undefined },
      say
    ).catch(() => {});
    await workdir.dispose().catch(() => {});
  }
}

/**
 * What setup handed over for the agent, if a step wrote it: where to start,
 * the prompt to give (`wf ai`'s, for a task), plugins to load (its skills).
 * See `wf agent prepare-task`.
 */
interface HandOver {
  cwd?: string;
  prompt?: string;
  plugins?: string[];
}

async function handedOver(jobDir: string): Promise<HandOver> {
  let raw: string;
  try {
    raw = await readFile(join(jobDir, 'automation.json'), 'utf8');
  } catch {
    return {};
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  return {
    cwd: typeof data.cwd === 'string' && data.cwd ? data.cwd : undefined,
    prompt:
      typeof data.prompt === 'string' && data.prompt.trim()
        ? data.prompt
        : undefined,
    plugins: Array.isArray(data.plugins)
      ? data.plugins.filter((p): p is string => typeof p === 'string')
      : undefined,
  };
}
