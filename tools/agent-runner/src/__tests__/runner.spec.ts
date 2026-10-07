import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { type AgentProfile, type Job, NotesGraphApi } from '../api';
import { argVar, jobPlaceholders, render, runSteps, runTool } from '../automation';
import { Narrator } from '../narrate';
import { runJob } from '../run-job';
import { ask, JobCancelled, permissionPrompt } from '../run-tools';
import { runClaimed } from '../serve';
import { FakeNotesGraph, until } from './fake-notesgraph';

let ng: FakeNotesGraph;
let root: string;

beforeEach(async () => {
  ng = await new FakeNotesGraph().start();
  root = await mkdtemp(join(tmpdir(), 'agent-runner-'));
});

afterEach(async () => {
  await ng.stop();
  await rm(root, { recursive: true, force: true });
});

const api = () => new NotesGraphApi(ng.url, 'pat');

const profile = (over: Partial<AgentProfile> = {}): AgentProfile => ({
  systemPrompt: 'Be the agent.',
  allowedTools: ['mcp__notesgraph', 'mcp__run__ask_user'],
  mcpServers: ['notesgraph', 'run'],
  workdir: 'job',
  toolTimeoutMs: 60_000,
  automation: { setup: [], tools: [], teardown: [] },
  ...over,
});

const job = (over: Partial<Job> = {}): Job => ({
  id: 'job-1234abcd-ffff',
  agentName: 'shows',
  instructions: 'Find a show to watch with Cosmo',
  context: 'note text',
  model: 'claude-code',
  status: 'running',
  title: null,
  profile: profile(),
  ...over,
});

/** A stand-in for the SDK's query: says what it was given, then these messages. */
function fakeQuery(messages: SDKMessage[], seen: { options?: Options; prompt?: string } = {}) {
  return ((params: { prompt: string; options?: Options }) => {
    seen.options = params.options;
    seen.prompt = params.prompt;
    return (async function* () {
      for (const message of messages) yield message;
    })();
  }) as any;
}

const init = { type: 'system', subtype: 'init', model: 'claude-x', cwd: '/w' } as unknown as SDKMessage;
const said = (text: string) =>
  ({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) as unknown as SDKMessage;
const success = (result: string) =>
  ({ type: 'result', subtype: 'success', is_error: false, result, num_turns: 3, total_cost_usd: 0.01 }) as unknown as SDKMessage;

const settings = () => ({ workRoot: root, anthropicApiKey: 'sk-test', repo: undefined });

describe('automation', () => {
  test('fills in known placeholders and leaves the shell its own braces', () => {
    expect(render('cd {job_dir} && echo ${HOME} {other}', { job_dir: '/w/j' })).toBe(
      'cd /w/j && echo ${HOME} {other}'
    );
    expect(jobPlaceholders('abcdef123456', '/w/j', '/c', 'r', 'main')).toMatchObject({
      job_short: 'abcdef12',
      branch: 'cloud/abcdef12',
      cache: '/c',
    });
    expect(argVar('max-results')).toBe('ARG_MAX_RESULTS');
  });

  test('runs setup steps in order and stops at one that fails', async () => {
    const lines: string[] = [];
    const shell = { cwd: root, env: { PATH: process.env.PATH } };
    await expect(
      runSteps(
        'setup',
        [
          { name: 'make', run: 'echo one > {job_dir}/a.txt' },
          { name: 'probe', run: 'exit 3', optional: true },
          { name: 'broken', run: 'echo boom >&2; exit 2' },
          { name: 'never', run: 'touch {job_dir}/never' },
        ],
        { job_dir: root },
        shell,
        line => lines.push(line)
      )
    ).rejects.toThrow(/setup step 'broken' failed \(exit 2\): boom/);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('one\n');
    await expect(stat(join(root, 'never'))).rejects.toThrow();
    expect(lines[0]).toMatch(/^⚙ setup · make ✓/);
    expect(lines.some(l => /probe ✗ exit 3/.test(l))).toBe(true);
  });

  test('a step that runs too long is stopped', async () => {
    const shell = { cwd: root, env: { PATH: process.env.PATH } };
    await expect(
      runSteps('setup', [{ name: 'slow', run: 'sleep 5', timeout: 0.2 }], {}, shell, () => {})
    ).rejects.toThrow(/timed out after 0.2s/);
  });

  test("a tool's params reach the command as environment, never as code", async () => {
    const shell = { cwd: root, env: { PATH: process.env.PATH } };
    const spec = {
      name: 'echo_path',
      description: 'echo',
      run: 'printf "%s" "$ARG_PATH" > {job_dir}/out.txt && echo done',
      params: { path: { description: 'p', required: true } },
    };
    const sneaky = 'x"; touch hacked; echo "';
    const { text, ok } = await runTool(spec, { path: sneaky }, { job_dir: root }, shell, () => {});
    expect(ok).toBe(true);
    expect(text).toBe('exit code 0\ndone');
    expect(await readFile(join(root, 'out.txt'), 'utf8')).toBe(sneaky);
    await expect(stat(join(root, 'hacked'))).rejects.toThrow();
  });
});

describe('narrating', () => {
  test("reads like a Mac runner's transcript", () => {
    const lines: string[] = [];
    const narrator = new Narrator(line => lines.push(line));
    narrator.feed(init);
    narrator.feed({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Looking for Cosmo' },
          { type: 'tool_use', name: 'mcp__run__ask_user', input: { question: 'Who is Cosmo?' } },
          { type: 'tool_use', name: 'mcp__notesgraph__keyword_search', input: { query: 'Cosmo' } },
        ],
      },
    } as unknown as SDKMessage);
    narrator.feed({
      type: 'user',
      message: { content: [{ type: 'tool_result', content: [{ type: 'text', text: 'none' }] }] },
    } as unknown as SDKMessage);
    narrator.feed(success('Bluey'));
    narrator.finish();
    expect(lines).toEqual([
      '▶ started · model claude-x · /w',
      'Looking for Cosmo',
      '? asking you: Who is Cosmo?  (answer in NotesGraph)',
      '→ mcp__notesgraph__keyword_search  {"query":"Cosmo"}',
      '  ← none',
      '✓ finished in 3 turns · $0.0100',
    ]);
    expect(narrator.result).toBe('Bluey');
  });
});

describe('asking the person', () => {
  test('a question waits for its answer', async () => {
    const ctx = { api: api(), workspaceId: 'ws-1', jobId: 'j1', pollMs: 5 };
    const answer = ask(ctx, 'question', 'Who is Cosmo?', { options: ['My son'] });
    await until(() => ng.questions.length === 1);
    expect(ng.questions[0]).toMatchObject({ kind: 'question', options: ['My son'] });
    ng.answer(0, { answer: 'My son, 7' });
    expect((await answer).answer).toBe('My son, 7');
  });

  test('a stopped run ends the wait', async () => {
    const ctx = { api: api(), workspaceId: 'ws-1', jobId: 'j1', pollMs: 5 };
    const answer = ask(ctx, 'question', 'Who?');
    await until(() => ng.questions.length === 1);
    ng.status = 'cancelled';
    await expect(answer).rejects.toBeInstanceOf(JobCancelled);
  });

  test('a tool not pre-approved is put to the person, with its input', async () => {
    const prompt = permissionPrompt({ api: api(), workspaceId: 'ws-1', jobId: 'j1', pollMs: 5 });
    const denied = prompt('Bash', { command: 'rm -rf /' }, { signal: new AbortController().signal } as any);
    await until(() => ng.questions.length === 1);
    expect(ng.questions[0]).toMatchObject({
      kind: 'permission',
      text: 'Allow Bash?',
      detail: '{"command":"rm -rf /"}',
    });
    ng.answer(0, { allowed: false, answer: 'not that' });
    expect(await denied).toEqual({ behavior: 'deny', message: 'The user denied this. They said: not that' });

    const allowed = prompt('Bash', { command: 'ls' }, { signal: new AbortController().signal } as any);
    await until(() => ng.questions.length === 2);
    ng.answer(1, { allowed: true });
    expect(await allowed).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });
});

describe('running a job', () => {
  test('prepares with the automation, runs the agent the profile describes, then cleans up', async () => {
    const seen: { options?: Options; prompt?: string } = {};
    const lines: string[] = [];
    const automation = {
      setup: [{ name: 'prepare', run: 'mkdir -p {job_dir}/repo && echo ready > {job_dir}/repo/state' }],
      tools: [{ name: 'run_tests', description: 'tests', run: 'echo ok' }],
      teardown: [{ name: 'note', run: 'echo bye > {cache}/teardown' }],
      cwd: '{job_dir}/repo',
    };
    const outcome = await runJob(job({ profile: profile({ automation }) }), {
      api: api(),
      workspaceId: 'ws-1',
      settings: settings(),
      query: fakeQuery([init, said('Done.'), success('Bluey')], seen),
      say: line => lines.push(line),
      signal: new AbortController().signal,
    });

    expect(outcome).toEqual({ result: 'Bluey', steps: 3 });
    expect(seen.prompt).toBe('Find a show to watch with Cosmo\n\n--- context ---\nnote text');
    const options = seen.options!;
    expect(options.cwd).toBe(join(root, 'jobs', 'job-1234abcd-ffff', 'repo'));
    expect(options.systemPrompt).toEqual({ type: 'preset', preset: 'claude_code', append: 'Be the agent.' });
    expect(options.allowedTools).toEqual(['mcp__notesgraph', 'mcp__run__ask_user', 'mcp__automation']);
    expect(Object.keys(options.mcpServers!).sort()).toEqual(['automation', 'notesgraph', 'run']);
    expect(options.mcpServers!.notesgraph).toMatchObject({
      type: 'http',
      url: `${ng.url}/api/workspaces/ws-1/mcp`,
      headers: { Authorization: 'Bearer pat' },
    });
    expect(options.env!.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(options.settingSources).toEqual([]);
    expect(lines.some(l => /^⚙ setup · prepare ✓/.test(l))).toBe(true);
    expect(lines.at(-2)).toMatch(/^✓ finished in 3 turns/);
    expect(lines.at(-1)).toMatch(/^⚙ teardown · note ✓/);
    expect(await readFile(join(root, 'cache', 'teardown'), 'utf8')).toBe('bye\n');
    await expect(stat(join(root, 'jobs', 'job-1234abcd-ffff'))).rejects.toThrow();
  });

  test('a failed setup stops the run before any model runs', async () => {
    const seen: { options?: Options } = {};
    const automation = { setup: [{ name: 'clone', run: 'exit 1' }], tools: [], teardown: [] };
    await expect(
      runJob(job({ profile: profile({ automation }) }), {
        api: api(),
        workspaceId: 'ws-1',
        settings: settings(),
        query: fakeQuery([success('x')], seen),
        say: () => {},
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/setup step 'clone' failed/);
    expect(seen.options).toBeUndefined();
  });

  test("takes the agent's cwd, prompt and plugins from what setup hands over", async () => {
    const seen: { options?: Options; prompt?: string } = {};
    const automation = {
      setup: [
        {
          name: 'task',
          run:
            'mkdir -p {job_dir}/wt {job_dir}/skills && ' +
            'printf \'{"cwd":"%s","prompt":"TASK: CLOUD-1 %s","plugins":["%s"]}\' ' +
            '"{job_dir}/wt" "$(cat {prompt_file} | head -1)" "{job_dir}/skills" > {job_dir}/automation.json',
        },
      ],
      tools: [{ name: 'where', description: 'pwd', run: 'echo "$AGENT_CWD"' }],
      teardown: [{ name: 'gone', run: 'echo "$AGENT_CWD" > {cache}/last-cwd' }],
    };
    await runJob(job({ model: 'workflow', profile: profile({ automation }) }), {
      api: api(),
      workspaceId: 'ws-1',
      settings: settings(),
      query: fakeQuery([success('done')], seen),
      say: () => {},
      signal: new AbortController().signal,
    });
    const dir = join(root, 'jobs', 'job-1234abcd-ffff');
    expect(seen.options!.cwd).toBe(join(dir, 'wt'));
    expect(seen.prompt).toBe('TASK: CLOUD-1 Find a show to watch with Cosmo');
    expect(seen.options!.plugins).toEqual([{ type: 'local', path: join(dir, 'skills') }]);
    expect(await readFile(join(root, 'cache', 'last-cwd'), 'utf8')).toBe(`${join(dir, 'wt')}\n`);
  });

  test('refuses what only a Mac can run, and research without OmniSeek', async () => {
    const deps = {
      api: api(),
      workspaceId: 'ws-1',
      settings: settings(),
      query: fakeQuery([success('x')]),
      say: () => {},
      signal: new AbortController().signal,
    };
    await expect(runJob(job({ model: 'workflow', profile: null }), deps)).rejects.toThrow(/Mac device only/);
    await expect(runJob(job({ model: 'command', profile: null }), deps)).rejects.toThrow(/Mac device only/);
    await expect(
      runJob(job({ model: 'research', profile: profile({ mcpServers: ['notesgraph', 'run', 'omniseek'] }) }), deps)
    ).rejects.toThrow(/OmniSeek isn't set up/);
  });
});

describe('serving', () => {
  test('a claimed job ends reported done, with its transcript', async () => {
    const end = await runClaimed(
      {
        api: api(),
        workspaces: ['ws-1'],
        deviceKey: 'cloud',
        runnerId: 'r1',
        settings: settings(),
        query: fakeQuery([init, said('Thinking'), success('Bluey')]),
        tickMs: 5,
      },
      'ws-1',
      job()
    );
    expect(end).toBe('done');
    const final = ng.reports.at(-1)!.fields;
    expect(final).toMatchObject({ status: 'done', result: 'Bluey', steps: 3 });
    expect(ng.log).toContain('▶ started · model claude-x');
    expect(ng.log).toContain('Thinking\n');
    expect(ng.log).toContain('✓ finished in 3 turns');
  });

  test('a job that fails is reported as an error, with why', async () => {
    const end = await runClaimed(
      {
        api: api(),
        workspaces: ['ws-1'],
        deviceKey: 'cloud',
        runnerId: 'r1',
        settings: settings(),
        query: fakeQuery([]),
        tickMs: 5,
      },
      'ws-1',
      job({ model: 'command', profile: null })
    );
    expect(end).toBe('error');
    expect(ng.reports.at(-1)!.fields).toMatchObject({ status: 'error' });
    expect(ng.reports.at(-1)!.fields.error).toMatch(/Mac device only/);
  });
});

describe('skills', () => {
  test("the profile's skills are fetched and loaded as one plugin; a missing one is skipped", async () => {
    const seen: { options?: Options } = {};
    const lines: string[] = [];
    const fetchImpl = (async (url: string) =>
      url.endsWith('/good/SKILL.md')
        ? new Response('---\nname: good\n---\nDo it well.')
        : new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const skills = [
      { name: 'good', url: 'https://example.com/good/SKILL.md' },
      { name: 'gone', url: 'https://example.com/gone/SKILL.md' },
    ];
    await runJob(job({ profile: profile({ skills }) }), {
      api: api(),
      workspaceId: 'ws-1',
      settings: settings(),
      query: fakeQuery([success('done')], seen),
      say: line => lines.push(line),
      signal: new AbortController().signal,
      fetchImpl,
    });
    const plugin = join(root, 'jobs', 'job-1234abcd-ffff', '.skills-plugin');
    expect(seen.options!.plugins).toEqual([{ type: 'local', path: plugin }]);
    expect(lines).toContain('⚙ skill · good ✓');
    expect(lines.some(l => /skill · gone ✗ couldn't fetch it/.test(l))).toBe(true);
  });
});
