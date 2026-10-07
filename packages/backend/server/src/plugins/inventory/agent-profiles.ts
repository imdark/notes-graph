/**
 * How a device runs a job of each model: the system prompt added to Claude
 * Code's own, the tools it may use without asking, and which MCP servers it
 * gets. Sent with every claimed job, so the Mac's runner (`wf agent serve`)
 * and the cloud runner (`tools/agent-runner`) run the same agent; change it
 * here and both follow.
 *
 * Only the servers are named: where each one listens is the runner's own
 * business (NotesGraph's URL and the runner's token, OmniSeek on localhost
 * on a Mac and on the compose network in the cloud).
 */

export type AgentMcpServer = 'notesgraph' | 'run' | 'omniseek';

/**
 * One shell step, in wf's recipe shape (workflow/deploy/recipes.py Step):
 * `{placeholder}`s in `run` are filled in by the runner, unknown ones are left
 * for the shell, and a failing step stops the automation unless `optional`.
 *
 * Placeholders: {job_id}, {job_short} (its first 8 characters), {job_dir}
 * (the job's own directory), {prompt_file} (what the job asks), {branch}
 * (cloud/{job_short}), {repo} and {base_branch} (the runner's repo), {cache}
 * (kept between jobs). Tools and teardown also get $AGENT_CWD, where the
 * agent works.
 */
export interface AutomationStep {
  name: string;
  run: string;
  /** Seconds; default 600. */
  timeout?: number;
  optional?: boolean;
}

/**
 * A command the agent may call as a tool, `mcp__automation__<name>`. Its
 * params reach the command as environment variables ($ARG_<NAME>), never
 * spliced into it, so what the agent passes can't change what runs.
 */
export interface AutomationTool extends AutomationStep {
  description: string;
  params?: Record<string, { description: string; required?: boolean }>;
}

/**
 * What a runner does around the agent: prepares the ground before the model
 * starts (clone, install, fetch sources), gives it tools of its own beyond
 * Claude Code's, and cleans up after. Runs where the job runs; a Mac runner
 * that does its own preparation (wf's worktree) may skip `setup`.
 */
export interface Automation {
  setup: AutomationStep[];
  tools: AutomationTool[];
  teardown: AutomationStep[];
  /** Where the agent starts, e.g. "{job_dir}/repo"; default {job_dir}. */
  cwd?: string;
}

export interface AgentProfile {
  /** Appended to Claude Code's own system prompt. */
  systemPrompt: string;
  /** Tools the run may use without asking; anything else is put to the user. */
  allowedTools: string[];
  mcpServers: AgentMcpServer[];
  /** A checkout of the repo to work in, or an empty directory. */
  workdir: 'repo' | 'job';
  /** How long (ms) a tool call may wait: a question waits for a person. */
  toolTimeoutMs: number;
  automation: Automation;
  /**
   * Claude Code skills the agent gets, each a SKILL.md fetched from its URL
   * when the run starts, so a skill's own repo stays the source. A runner
   * loads them as one Claude plugin.
   */
  skills: AgentSkill[];
}

export interface AgentSkill {
  name: string;
  url: string;
}

// The point is that the agent asks rather than guesses, and that each answer
// is written into NotesGraph so the next run finds it instead of asking again.
const CLAUDE_CODE_SYSTEM_PROMPT = `\
You are running as an agent inside NotesGraph, the user's notes app, started
by them from a note. You have NotesGraph tools (mcp__notesgraph__*) to search,
read and write their notes, and mcp__run__ask_user to ask them a question.
They are not watching a terminal; they see your questions in NotesGraph.

Your run is listed in NotesGraph under the text of the block it started
from. Once you know what you are doing, name it with mcp__run__set_title:
a few words a person would recognise, e.g. "Pick a show to watch with
Cosmo". Rename it if the work turns out to be something else.

Do not guess facts about the user's life: the people in it, their ages,
relationships, preferences, plans, constraints. For each one you need:
1. Look in NotesGraph first (keyword_search and semantic_search; read the
   notes you find). A fact already written down must not be asked again.
2. If it is not there, ask with mcp__run__ask_user. One short, specific
   question; group closely related unknowns into it. For a task like "find a
   show to watch with Cosmo", ask "Who is Cosmo, and how old are they?"
   rather than assuming.
3. As soon as you have the answer, save it to NotesGraph before continuing:
   update the existing note about that person or topic, or create one titled
   with the subject (e.g. "Cosmo") and link it under a note titled
   "Agent memory" (create that note if it does not exist). Write the fact
   plainly and date it, e.g. "Cosmo: the user's son, 7 years old (as of
   2026-10-02)."

Ask before anything irreversible or outside NotesGraph that you were not
plainly asked to do. When a question has a few likely answers (yes/no,
which of these, go on or stop), pass them as \`options\` to
mcp__run__ask_user so the user can pick one with a click.
Tools that need permission are put to the user for
you; if they deny one, find another way or explain what you could not do.

Finish with your answer to the task itself.
`;

// Shell and file edits are left out: they go through the permission prompt.
const CLAUDE_CODE_ALLOWED_TOOLS = [
  'mcp__notesgraph',
  'mcp__run__ask_user',
  'mcp__run__set_title',
  'WebSearch',
  'WebFetch',
  'Read',
  'Glob',
  'Grep',
];

// The method follows OmniSeek's own investigate skill: sweep wide, zoom in,
// then structure.
const RESEARCH_SYSTEM_PROMPT = `\
This is a research run. Besides your usual tools you have OmniSeek
(mcp__omniseek__*), a research toolkit that reaches what ordinary web search
misses: sources in other languages, PDFs and papers, audio and video, forums
and comment threads, and a scholarly citation graph.

Investigate the way OmniSeek's own method says: use the /omniseek-investigate
skill. Sweep in parallel with omniseek_gather, judge the signals, zoom
(including walled sources worth chasing), triangulate by independent voices
rather than counting sources, flag conflicts instead of averaging them, build
the evidence graph, and close with the gap ledger: what you did not find and
why. Back every claim with its source URL.

Write the findings and the gap ledger into the note you were started from, or
a new note linked from it, with mcp__notesgraph, so they outlast the run.
`;

/** OmniSeek's deep-investigation method (Apache-2.0), from its own repo. */
const OMNISEEK_INVESTIGATE: AgentSkill = {
  name: 'omniseek-investigate',
  url: 'https://raw.githubusercontent.com/Battam1111/omniseek/main/skills/omniseek-investigate/SKILL.md',
};

/** A question waits for a person, who may be at dinner. */
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const MIRROR = '{cache}/repo.git';

/**
 * A code task works in its own worktree of the repo on a fresh branch, the
 * way wf gives a claude-code job a worktree of the runner's checkout. One
 * blobless mirror is kept in {cache} and fetched first, so a job costs a
 * worktree rather than a clone. Installing and testing are tools the agent
 * calls when it needs them: a full install is minutes and gigabytes.
 */
const CODE_AUTOMATION: Automation = {
  setup: [
    {
      name: 'mirror',
      run:
        `git --git-dir ${MIRROR} fetch --prune origin 2>/dev/null || ` +
        `(rm -rf ${MIRROR} && git clone --bare --filter=blob:none {repo} ${MIRROR} && ` +
        `git --git-dir ${MIRROR} config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && ` +
        `git --git-dir ${MIRROR} fetch origin)`,
      timeout: 1800,
    },
    {
      name: 'worktree',
      run:
        `git --git-dir ${MIRROR} worktree prune && ` +
        `git --git-dir ${MIRROR} worktree add -B {branch} {job_dir}/repo origin/{base_branch}`,
    },
  ],
  tools: [
    {
      name: 'install_deps',
      description:
        'Install the repo\'s dependencies (corepack + yarn install). Needed once ' +
        'before run_tests or typecheck; takes several minutes.',
      run: 'cd "$AGENT_CWD" && corepack enable && yarn install --mode=skip-build',
      timeout: 2400,
    },
    {
      name: 'run_tests',
      description:
        'Run the vitest tests at a path in the repo (e.g. packages/frontend/core/src/modules/agents) ' +
        'and return the output. Run install_deps first.',
      run: 'cd "$AGENT_CWD" && yarn vitest run "$ARG_PATH"',
      params: { path: { description: 'File or directory to test, relative to the repo root.', required: true } },
      timeout: 1200,
    },
    {
      name: 'typecheck',
      description:
        'Typecheck a package of the repo (e.g. packages/frontend/core) with scripts/typecheck.sh. ' +
        'Run install_deps first.',
      run: 'cd "$AGENT_CWD" && scripts/typecheck.sh "$ARG_PACKAGE"',
      params: { package: { description: 'Package directory, relative to the repo root.', required: true } },
      timeout: 1200,
    },
  ],
  teardown: [
    {
      name: 'worktree',
      run: `git --git-dir ${MIRROR} worktree remove --force {job_dir}/repo`,
      optional: true,
    },
  ],
  cwd: '{job_dir}/repo',
};

const CHECKOUT = '{cache}/checkout';

/**
 * A Workflow job is a wf task, as on a Mac (`wf agent prepare-task`, which is
 * jobs.py start_job_task): a ticket in the runner's own wf project, CLOUD,
 * on the markdown backend, so its tickets and branches (cloud-1-…) never
 * collide with a Mac's; its branch in a worktree beside a real checkout of
 * the repo (wf branches from one, which a bare mirror isn't); `wf ai`'s
 * prompt and the task's skills, handed to the agent. wf's home is on the
 * runner's volume, so the tickets last.
 */
const WORKFLOW_AUTOMATION: Automation = {
  setup: [
    {
      name: 'checkout',
      run:
        `(test -d ${CHECKOUT}/.git || git clone --filter=blob:none {repo} ${CHECKOUT}) && ` +
        `git -C ${CHECKOUT} fetch --prune origin && ` +
        `git -C ${CHECKOUT} checkout -q --detach origin/{base_branch} && ` +
        `git -C ${CHECKOUT} branch -f {base_branch} origin/{base_branch}`,
      timeout: 1800,
    },
    {
      name: 'wf project',
      run:
        'mkdir -p "$HOME/.wf" && ' +
        '(test -f "$HOME/.wf/config.yaml" || printf \'%s\\n\' ' +
        "'backend: markdown' 'git_enabled: true' 'github_enabled: true' 'projects:' " +
        "'  cloud:' '    name: CLOUD' '    task_backend: markdown' " +
        "'    git_enabled: true' '    github_enabled: true' '    repositories:' " +
        `'      ${CHECKOUT}:' '        base_branch: {base_branch}' ` +
        '> "$HOME/.wf/config.yaml") && ' +
        '(test -f "$HOME/.wf/state.yaml" || echo \'current_project: cloud\' > "$HOME/.wf/state.yaml")',
    },
    {
      name: 'task',
      run:
        `wf agent prepare-task --job-dir {job_dir} --repo ${CHECKOUT} ` +
        '--prompt-file {prompt_file} --out {job_dir}/automation.json',
      timeout: 300,
    },
  ],
  tools: CODE_AUTOMATION.tools,
  teardown: [
    {
      name: 'worktree',
      run: `git -C ${CHECKOUT} worktree remove --force "$AGENT_CWD"`,
      optional: true,
    },
  ],
};

/** Research keeps what it reads in the job directory, like OmniSeek's own downloads. */
const RESEARCH_AUTOMATION: Automation = {
  setup: [{ name: 'sources', run: 'mkdir -p {job_dir}/sources' }],
  tools: [
    {
      name: 'fetch_source',
      description:
        'Download a URL (a PDF, a dataset, a page) into this run\'s sources folder and ' +
        'return where it was saved, so you can Read it.',
      run:
        'cd {job_dir}/sources && name="$(basename "${ARG_URL%%\\?*}")" && ' +
        'curl -fsSL --max-time 120 --max-filesize 52428800 -o "${name:-source}" "$ARG_URL" && ' +
        'echo "saved {job_dir}/sources/${name:-source} ($(wc -c < "${name:-source}") bytes)"',
      params: { url: { description: 'The http(s) URL to download.', required: true } },
      timeout: 180,
    },
  ],
  teardown: [],
};

const CLAUDE_CODE: AgentProfile = {
  systemPrompt: CLAUDE_CODE_SYSTEM_PROMPT,
  allowedTools: CLAUDE_CODE_ALLOWED_TOOLS,
  mcpServers: ['notesgraph', 'run'],
  workdir: 'repo',
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  automation: CODE_AUTOMATION,
  skills: [],
};

const PROFILES: Record<string, AgentProfile> = {
  'claude-code': CLAUDE_CODE,
  // Claude Code started as a wf task (ticket, branch, skills): the same agent.
  workflow: { ...CLAUDE_CODE, automation: WORKFLOW_AUTOMATION },
  research: {
    systemPrompt: `${CLAUDE_CODE_SYSTEM_PROMPT}\n${RESEARCH_SYSTEM_PROMPT}`,
    // OmniSeek's tools read and search; none of them act on the user's behalf.
    allowedTools: [...CLAUDE_CODE_ALLOWED_TOOLS, 'mcp__omniseek'],
    mcpServers: ['notesgraph', 'run', 'omniseek'],
    // Research reads the world, not a repo.
    workdir: 'job',
    toolTimeoutMs: TOOL_TIMEOUT_MS,
    automation: RESEARCH_AUTOMATION,
    skills: [OMNISEEK_INVESTIGATE],
  },
};

/** The profile for a job's model; null for one that isn't a Claude agent. */
export function profileFor(model: string | null | undefined): AgentProfile | null {
  return (model && PROFILES[model]) || null;
}
