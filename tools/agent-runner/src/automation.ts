/**
 * Automations: shell steps run around the agent (setup before the model
 * starts, teardown after) and commands handed to it as tools. Steps follow
 * wf's recipe shape (workflow/deploy/recipes.py): `{placeholder}`s are filled
 * from the job, unknown braces are left for the shell, and a failing step
 * stops the run unless it is optional. See agent-profiles.ts on the server.
 */
import { spawn } from 'node:child_process';

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { Automation, AutomationStep, AutomationTool } from './api';

const DEFAULT_TIMEOUT_SECONDS = 600;
/** What of a command's output goes back to the agent or into the log. */
const OUTPUT_CHARS = 20_000;
const LOG_TAIL_CHARS = 2_000;

export type Placeholders = Record<string, string>;

/** Fill in `{key}`s; leave any other braces for the shell (recipes.py Step.render). */
export function render(command: string, values: Placeholders): string {
  let rendered = command;
  for (const [key, value] of Object.entries(values)) {
    rendered = rendered.split(`{${key}}`).join(value);
  }
  return rendered;
}

export interface CommandResult {
  code: number | null;
  output: string;
  timedOut: boolean;
}

export interface ShellEnv {
  cwd: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}

/** Run one command with `sh -c`, stdout and stderr together, up to a timeout. */
export function runCommand(
  command: string,
  timeoutSeconds: number,
  shell: ShellEnv
): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn('sh', ['-c', command], {
      cwd: shell.cwd,
      env: shell.env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    let output = '';
    const keep = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      // Keep the tail: the end of a failing build says why.
      if (output.length > OUTPUT_CHARS * 2) output = output.slice(-OUTPUT_CHARS);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    // The whole process group, so a step's own children stop too.
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutSeconds * 1000);
    shell.signal?.addEventListener('abort', kill);
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ code: null, output: `${output}${err.message}`, timedOut });
    });
    child.on('close', code => {
      clearTimeout(timer);
      shell.signal?.removeEventListener('abort', kill);
      resolve({ code, output: output.slice(-OUTPUT_CHARS), timedOut });
    });
  });
}

const tail = (text: string, chars: number) => {
  const trimmed = text.trimEnd();
  return trimmed.length <= chars ? trimmed : `…${trimmed.slice(-chars)}`;
};

const indent = (text: string) =>
  text
    .split('\n')
    .map(line => `    ${line}`)
    .join('\n');

/**
 * Run a list of steps in order, saying each in the transcript. A step that
 * fails stops the list (and throws) unless it is optional.
 */
export async function runSteps(
  phase: 'setup' | 'teardown',
  steps: AutomationStep[],
  values: Placeholders,
  shell: ShellEnv,
  say: (line: string) => void
): Promise<void> {
  for (const step of steps) {
    if (shell.signal?.aborted) throw new Error('the run was stopped');
    const started = Date.now();
    const result = await runCommand(
      render(step.run, values),
      step.timeout ?? DEFAULT_TIMEOUT_SECONDS,
      shell
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (result.code === 0) {
      say(`⚙ ${phase} · ${step.name} ✓ (${seconds}s)`);
      continue;
    }
    const why = result.timedOut
      ? `timed out after ${step.timeout ?? DEFAULT_TIMEOUT_SECONDS}s`
      : `exit ${result.code}`;
    say(`⚙ ${phase} · ${step.name} ✗ ${why} (${seconds}s)`);
    if (result.output.trim()) say(indent(tail(result.output, LOG_TAIL_CHARS)));
    if (!step.optional) {
      throw new Error(`${phase} step '${step.name}' failed (${why}): ${tail(result.output, 300)}`);
    }
  }
}

/** `path` → `ARG_PATH`, `max-results` → `ARG_MAX_RESULTS`. */
export const argVar = (name: string) => `ARG_${name.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;

/**
 * Run one tool call: its command with each param as $ARG_<NAME>. Returns
 * what goes back to the agent: the exit status, then the output.
 */
export async function runTool(
  spec: AutomationTool,
  args: Record<string, string | undefined>,
  values: Placeholders,
  shell: ShellEnv,
  say: (line: string) => void
): Promise<{ text: string; ok: boolean }> {
  const env = { ...shell.env };
  for (const name of Object.keys(spec.params ?? {})) {
    const value = args[name];
    if (value !== undefined) env[argVar(name)] = String(value);
  }
  const timeout = spec.timeout ?? DEFAULT_TIMEOUT_SECONDS;
  const started = Date.now();
  const result = await runCommand(render(spec.run, values), timeout, { ...shell, env });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.code === 0;
  say(`⚙ tool · ${spec.name} ${ok ? '✓' : '✗'} (${seconds}s)`);
  const status = result.timedOut ? `timed out after ${timeout}s` : `exit code ${result.code}`;
  return { text: `${status}\n${result.output.trimEnd()}`, ok };
}

/** The automation's tools as an MCP server, `mcp__automation__<name>`. */
export function automationServer(
  tools: AutomationTool[],
  values: Placeholders,
  shell: ShellEnv,
  say: (line: string) => void
) {
  return createSdkMcpServer({
    name: 'automation',
    version: '1',
    tools: tools.map(spec => {
      const shape: Record<string, z.ZodType<string | undefined>> = {};
      for (const [name, param] of Object.entries(spec.params ?? {})) {
        const field = z.string().describe(param.description);
        shape[name] = param.required ? field : field.optional();
      }
      return tool(spec.name, spec.description, shape, async args => {
        const { text, ok } = await runTool(
          spec, args as Record<string, string | undefined>, values, shell, say
        );
        return { content: [{ type: 'text' as const, text }], isError: !ok };
      });
    }),
  });
}

/** Placeholders a job's steps and tools may use. */
export function jobPlaceholders(
  jobId: string,
  jobDir: string,
  cache: string,
  repo: string | undefined,
  baseBranch: string
): Placeholders {
  const short = jobId.slice(0, 8);
  return {
    job_id: jobId,
    job_short: short,
    job_dir: jobDir,
    branch: `cloud/${short}`,
    repo: repo ?? '',
    base_branch: baseBranch,
    cache,
  };
}

export const emptyAutomation: Automation = { setup: [], tools: [], teardown: [] };
