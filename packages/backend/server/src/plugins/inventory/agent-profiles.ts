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

Work in three passes:
1. Sweep: search broadly with omniseek_search, in more than one language when
   the topic has non-English sources. Use omniseek_gather to run several
   searches or reads at once rather than one after another.
2. Zoom: read the most promising sources in full with omniseek_read (pages,
   PDFs, arXiv) and, for papers, omniseek_paper_enrich or the graph tools to
   follow citations, authors and related work.
3. Structure: answer with what you found, grouped by finding. Back every
   claim with its source URL; say plainly where sources disagree or where you
   could not find support.

Write the findings into the note you were started from, or a new note linked
from it, with mcp__notesgraph, so they outlast the run.
`;

/** A question waits for a person, who may be at dinner. */
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const CLAUDE_CODE: AgentProfile = {
  systemPrompt: CLAUDE_CODE_SYSTEM_PROMPT,
  allowedTools: CLAUDE_CODE_ALLOWED_TOOLS,
  mcpServers: ['notesgraph', 'run'],
  workdir: 'repo',
  toolTimeoutMs: TOOL_TIMEOUT_MS,
};

const PROFILES: Record<string, AgentProfile> = {
  'claude-code': CLAUDE_CODE,
  // Claude Code started as a wf task (ticket, branch, skills): the same agent.
  workflow: CLAUDE_CODE,
  research: {
    systemPrompt: `${CLAUDE_CODE_SYSTEM_PROMPT}\n${RESEARCH_SYSTEM_PROMPT}`,
    // OmniSeek's tools read and search; none of them act on the user's behalf.
    allowedTools: [...CLAUDE_CODE_ALLOWED_TOOLS, 'mcp__omniseek'],
    mcpServers: ['notesgraph', 'run', 'omniseek'],
    // Research reads the world, not a repo.
    workdir: 'job',
    toolTimeoutMs: TOOL_TIMEOUT_MS,
  },
};

/** The profile for a job's model; null for one that isn't a Claude agent. */
export function profileFor(model: string | null | undefined): AgentProfile | null {
  return (model && PROFILES[model]) || null;
}
