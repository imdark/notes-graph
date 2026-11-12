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

import type { AgentHeadroom } from '../headroom';

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
  /** Set by the Headroom plugin (plugins/headroom) when it is turned on. */
  headroom?: AgentHeadroom;
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
   Run searches that don't depend on each other together, in one turn. Don't
   repeat a search you already ran; refine it instead.
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

When the user tells you how they want a kind of task done, or corrects how
you did one ("when we plan a trip, pack games for the kids"), save it as a
lesson: add it to the note titled with that kind of task (e.g. "Trip
planning"), linked under a note titled "Agent lessons" (create that note if
it does not exist). Write it as one short instruction, dated. Begin a new
lesson note with an "Applies to:" line of words that mark such tasks, e.g.
"Applies to: trip, travel, vacation". Later runs of that kind are given
every lesson in the note.

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
  'mcp__run__upload_artifact',
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
a new note linked from it, with mcp__notesgraph, so they outlast the run. If
the agent's own instructions say when or where to save (for example, only
after the user accepts the report), follow those instead.
`;

/** OmniSeek's deep-investigation method (Apache-2.0), from its own repo. */
const OMNISEEK_INVESTIGATE: AgentSkill = {
  name: 'omniseek-investigate',
  url: 'https://raw.githubusercontent.com/Battam1111/omniseek/main/skills/omniseek-investigate/SKILL.md',
};

// antislop's own install wizard and mode question assume a person at a
// terminal: here it is installed already, and a mode is settled up front so a
// run doesn't stop to ask before it has started.
const ANTISLOP_SYSTEM_PROMPT = `\
antislop is installed for this run as skills (/antislop, the core filter,
and /antislop-ui, /antislop-copywriting, /antislop-human,
/antislop-layoutmobile, /antislop-code). For UI, copy, accessibility,
responsive layout or code-comment work, read /antislop and the skill for the
task, and follow them. Skip its First-Run Install Wizard: nothing needs
installing and no entry file needs a pointer block. Its usage mode is set
for this session: "during", unless the task asks you to review or audit
existing work, which is "after". Its questions (direction, assets, which
audit findings to fix) go through mcp__run__ask_user like any other.
`;

/**
 * antislop (MIT), rules that keep agent-built UI, copy and code comments
 * from reading as generated, from its own repo. Pinned to a release: a
 * SKILL.md is instructions the agent obeys, so a new one is taken on purpose.
 */
const ANTISLOP_RELEASE = '91f12ec67e9de6043cfd93b846404986ba73c3f4'; // v3.2.20
const ANTISLOP: AgentSkill[] = [
  'antislop',
  'antislop-ui',
  'antislop-copywriting',
  'antislop-human',
  'antislop-layoutmobile',
  'antislop-code',
].map(name => ({
  name,
  url: `https://raw.githubusercontent.com/miqdadbadjuber/anti-slop/${ANTISLOP_RELEASE}/skills/${name}/SKILL.md`,
}));

/**
 * video-use (MIT), browser-use's conversation-driven video editor: a skill
 * plus ffmpeg/PIL helpers. Pinned: a SKILL.md is instructions the agent
 * obeys. The helpers come from the same commit, cloned by the video-editor
 * profile's setup step (VIDEO_USE_REPO / VIDEO_USE_REF below).
 */
const VIDEO_USE_REPO = 'https://github.com/browser-use/video-use';
const VIDEO_USE_REF = '43cfc566833548093455c9d4a46bd69913b7e552';
const VIDEO_USE: AgentSkill = {
  name: 'video-use',
  url: `https://raw.githubusercontent.com/browser-use/video-use/${VIDEO_USE_REF}/SKILL.md`,
};

/**
 * Ponytail (MIT), "the laziest senior dev in the room": the smallest change
 * that fully solves a task, plus review, audit and shortcut-ledger reports.
 * Pinned to v5.3.3 like antislop. Only the skills: its hooks, status band and
 * webhook are for an interactive Claude Code, and ponytail-gain / -help only
 * print reference cards. Opt-in per agent, not a Claude Code default.
 */
const PONYTAIL_RELEASE = '7801d061243d7b753bad0e0b3c057cd250b11755'; // v5.3.3
const PONYTAIL: AgentSkill[] = [
  'ponytail',
  'ponytail-review',
  'ponytail-audit',
  'ponytail-debt',
].map(name => ({
  name,
  url: `https://raw.githubusercontent.com/DietrichGebert/ponytail/${PONYTAIL_RELEASE}/skills/${name}/SKILL.md`,
}));

/** Every skill an agent can be given, by name; what the agent editor offers. */
export const SKILL_CATALOG: AgentSkill[] = [
  ...ANTISLOP,
  ...PONYTAIL,
  OMNISEEK_INVESTIGATE,
  VIDEO_USE,
];

/** A question waits for a person, who may be at dinner. */
const TOOL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const MIRROR = '{cache}/repo.git';

/**
 * `command` with {cache}'s git lock held, waiting up to `waitSeconds` for it.
 * Jobs share the mirror and the workflow checkout, and git writing to one
 * from two jobs at once fails: a job's worktree step on 2026-11-02 hit
 * "fatal: Could not write new index file" as two others tore theirs down.
 * Without flock (macOS has none) the command runs unlocked, as before.
 */
const withGitLock = (command: string, waitSeconds: number) =>
  'if command -v flock >/dev/null 2>&1; then ' +
  `(flock -w ${waitSeconds} 9 || exit 1; ${command}) 9>{cache}/git.lock; ` +
  `else ${command}; fi`;

/**
 * Where install_deps puts corepack's yarn shim, and the PATH every tool runs
 * with so `yarn` finds it. A plain `corepack enable` symlinks into node's own
 * bin directory, which the runner's user may not own: three runs on
 * 2026-11-07 failed with "EACCES: permission denied, symlink".
 */
const SHIMS = '{cache}/bin';
const WITH_SHIMS = `export PATH="${SHIMS}:$PATH" && cd "$AGENT_CWD"`;

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
      run: withGitLock(
        `git --git-dir ${MIRROR} fetch --prune origin 2>/dev/null || ` +
          `(rm -rf ${MIRROR} && git clone --bare --filter=blob:none {repo} ${MIRROR} && ` +
          `git --git-dir ${MIRROR} config remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*' && ` +
          `git --git-dir ${MIRROR} fetch origin)`,
        900
      ),
      timeout: 1800,
    },
    {
      name: 'worktree',
      run: withGitLock(
        `git --git-dir ${MIRROR} worktree prune && ` +
          `git --git-dir ${MIRROR} worktree add -B {branch} {job_dir}/repo origin/{base_branch}`,
        480
      ),
    },
  ],
  tools: [
    {
      name: 'install_deps',
      description:
        "Install the repo's dependencies (corepack + yarn install). Needed once " +
        'before run_tests or typecheck; takes several minutes.',
      run:
        `mkdir -p ${SHIMS} && corepack enable --install-directory ${SHIMS} && ` +
        `${WITH_SHIMS} && yarn install --mode=skip-build`,
      timeout: 2400,
    },
    {
      name: 'run_tests',
      description:
        'Run the vitest tests at a path in the repo (e.g. packages/frontend/core/src/modules/agents) ' +
        'and return the output. Run install_deps first.',
      run: `${WITH_SHIMS} && yarn vitest run "$ARG_PATH"`,
      params: {
        path: {
          description: 'File or directory to test, relative to the repo root.',
          required: true,
        },
      },
      timeout: 1200,
    },
    {
      name: 'typecheck',
      description:
        'Typecheck a package of the repo (e.g. packages/frontend/core) with scripts/typecheck.sh. ' +
        'Run install_deps first.',
      run: `${WITH_SHIMS} && scripts/typecheck.sh "$ARG_PACKAGE"`,
      params: {
        package: {
          description: 'Package directory, relative to the repo root.',
          required: true,
        },
      },
      timeout: 1200,
    },
  ],
  teardown: [
    {
      name: 'worktree',
      run: withGitLock(
        `git --git-dir ${MIRROR} worktree remove --force {job_dir}/repo`,
        480
      ),
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
      run: withGitLock(
        `(test -d ${CHECKOUT}/.git || git clone --filter=blob:none {repo} ${CHECKOUT}) && ` +
          `git -C ${CHECKOUT} fetch --prune origin && ` +
          `git -C ${CHECKOUT} checkout -q --detach origin/{base_branch} && ` +
          `git -C ${CHECKOUT} branch -f {base_branch} origin/{base_branch}`,
        900
      ),
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
      // It adds the task's worktree to the shared checkout.
      run: withGitLock(
        `wf agent prepare-task --job-dir {job_dir} --repo ${CHECKOUT} ` +
          '--prompt-file {prompt_file} --out {job_dir}/automation.json',
        240
      ),
      timeout: 300,
    },
  ],
  tools: CODE_AUTOMATION.tools,
  teardown: [
    {
      name: 'worktree',
      run: withGitLock(
        `git -C ${CHECKOUT} worktree remove --force "$AGENT_CWD"`,
        480
      ),
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
        "Download a URL (a PDF, a dataset, a page) into this run's sources folder and " +
        'return where it was saved, so you can Read it.',
      run:
        'cd {job_dir}/sources && name="$(basename "${ARG_URL%%\\?*}")" && ' +
        'curl -fsSL --max-time 120 --max-filesize 52428800 -o "${name:-source}" "$ARG_URL" && ' +
        'echo "saved {job_dir}/sources/${name:-source} ($(wc -c < "${name:-source}") bytes)"',
      params: {
        url: { description: 'The http(s) URL to download.', required: true },
      },
      timeout: 180,
    },
  ],
  teardown: [],
};

// The skill is read from SKILL.md; this is what differs when it runs as a
// NotesGraph agent instead of in a terminal: where things are, how the
// conversation happens (questions with a preview attached), and what to
// leave in the note. The hard rules are restated because they are the ones
// whose breach is silent in the output.
const VIDEO_EDITOR_SYSTEM_PROMPT = `\
This is a video editing run. Follow the /video-use skill; its helpers are at
$VIDEO_USE/helpers (python at $VIDEO_USE/.venv/bin/python), but call them
through the run's own tools (mcp__automation__*) rather than the shell:
link_footage, inventory, transcribe, timeline_view, save_edl, render, grade,
media_info. Everything you make goes under this run's directory in edit/
(transcripts/, takes_packed.md, edl.json, verify/, preview.mp4, final.mp4).

The note you were started from is the project: its Footage section names a
folder on this machine (pass it to link_footage), its Brief says what the
video is for, and its Edit log and Cuts sections hold earlier sessions.
Read them first and continue from them; never re-transcribe (transcripts
are cached per source).

How the conversation works here: the person is on their phone, not at a
terminal. Ask with mcp__run__ask_user, one short question at a time, with
options when the answer is one of a few. Show, don't describe: upload every
preview and filmstrip with mcp__run__upload_artifact and pass its key in the
question's attachments, with options like ["Approve", "Revise", "Try another
take"]. Transcription needs no API key on this machine (transcribe uses the
local models).

Hard rules, non-negotiable:
- Propose the strategy in plain English and WAIT for confirmation before
  any cut. Do not write to the note before that either.
- Never cut inside a word; snap to transcript word boundaries and pad each
  edge 30-200 ms. Prefer silences of 400 ms or more.
- Per-segment extract then lossless concat; 30 ms audio fades at every
  boundary; overlays PTS-shifted; subtitles applied last. render does this
  when given a correct EDL: sources must be absolute paths under the footage
  folder, times in seconds.
- Before showing a preview, check it yourself: timeline_view on the rendered
  file at each cut (plus or minus 1.5 s), media_info for duration and
  loudness. Fix and re-render up to three times, then say what is left.
- Previews at 720p (render with preview=1) and under 100 MB. Only the final
  render is full resolution; if it is over 100 MB, leave it on the machine
  and give its path.
- Everything you write stays in this run's directory and the project note.

When the person approves: render the final, upload it, and link it under
the project note with mcp__notesgraph (update_document). Then append to the
note's Edit log a "## Session N — <date>" section with the strategy, the
take choices and why, and what is left, and replace the Cuts section with
the EDL as a table (source, start, end, beat, reason) followed by the
edl.json in a code block. Finish with one line: what was delivered and where.
`;

const VIDEO_USE_DIR = '{cache}/video-use';
// The helpers run with the skill's own venv; every tool starts from here.
const V = `V="${VIDEO_USE_DIR}"; P="$V/.venv/bin/python"; export VIDEO_USE="$V";`;

/**
 * Footage comes from a folder on the device; outputs go under the job
 * directory. The skill repo and its Python environment are kept in {cache}
 * between jobs: cloning and the models are minutes, so they happen once. A
 * checkout the device already has (~/code/video-use) is used in place of a
 * clone, so a branch under test there is what runs.
 */
const VIDEO_AUTOMATION: Automation = {
  setup: [
    {
      name: 'ffmpeg',
      run:
        'command -v ffmpeg >/dev/null && command -v ffprobe >/dev/null && ffmpeg -version | head -1 || ' +
        '{ echo "ffmpeg is not installed on this device (brew install ffmpeg / apt-get install ffmpeg)"; exit 1; }',
      timeout: 30,
    },
    {
      name: 'video-use',
      run:
        `d="${VIDEO_USE_DIR}"; if [ ! -e "$d" ]; then mkdir -p "$(dirname "$d")"; ` +
        'if [ -f "$HOME/code/video-use/helpers/render.py" ]; then ln -s "$HOME/code/video-use" "$d"; ' +
        `else git clone -q ${VIDEO_USE_REPO} "$d" && git -C "$d" checkout -q ${VIDEO_USE_REF}; fi; fi && ` +
        'cd "$d" && if [ ! -x .venv/bin/python ]; then ' +
        '(command -v uv >/dev/null && uv venv -q --python 3.12 .venv) || python3 -m venv .venv; fi && ' +
        "(.venv/bin/python -c 'import librosa, PIL, numpy, requests' 2>/dev/null || " +
        '(command -v uv >/dev/null && uv pip install -q --python .venv/bin/python -e . || .venv/bin/pip install -q -e .)) && ' +
        // The key-free transcriber's models; an upstream checkout without the
        // `local` extra falls back to transcribe.py (ElevenLabs key).
        "(.venv/bin/python -c 'import crisperwhisper, pyannote.audio' 2>/dev/null || " +
        "(command -v uv >/dev/null && uv pip install -q --python .venv/bin/python -e '.[local]' 'transformers<5' || " +
        ".venv/bin/pip install -q -e '.[local]' 'transformers<5') || echo \"note: local transcription models not installed; transcribe needs ELEVENLABS_API_KEY\") && " +
        'mkdir -p {job_dir}/edit && echo "video-use ready at $d"',
      timeout: 1800,
    },
  ],
  tools: [
    {
      name: 'link_footage',
      description:
        "Point this run at the footage: the folder on this machine named in the note's Footage " +
        'section. Links it as footage/ in the run directory and lists each clip with duration, ' +
        'resolution, frame rate and audio tracks. Call it first.',
      run:
        '[ -d "$ARG_PATH" ] || { echo "not a folder on this machine: $ARG_PATH"; exit 1; }; ' +
        'rm -f {job_dir}/footage && ln -s "$ARG_PATH" {job_dir}/footage && mkdir -p {job_dir}/edit && ' +
        'n=0; for f in {job_dir}/footage/*; do case "$f" in *.mp4|*.MP4|*.mov|*.MOV|*.mkv|*.MKV|*.m4v|*.webm) ' +
        'n=$((n+1)); echo "== $(basename "$f") ($(readlink -f "$f"))"; ' +
        'ffprobe -v error -show_entries format=duration:stream=codec_type,width,height,r_frame_rate,channels -of default=nw=1 "$f" | tr "\\n" " "; echo;; esac; done; ' +
        '[ "$n" -gt 0 ] || { echo "no video files (.mp4/.mov/.mkv/.m4v/.webm) in $ARG_PATH"; exit 1; }; echo "$n clips"',
      params: {
        path: {
          description: 'Absolute path of the folder holding the source clips.',
          required: true,
        },
      },
      timeout: 120,
    },
    {
      name: 'inventory',
      description:
        'ffprobe every clip in footage/: duration, streams, resolution, frame rate.',
      run:
        'for f in {job_dir}/footage/*; do case "$f" in *.mp4|*.MP4|*.mov|*.MOV|*.mkv|*.MKV|*.m4v|*.webm) ' +
        'echo "== $(basename "$f")"; ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,channels,sample_rate -of default=nw=1 "$f";; esac; done',
      timeout: 120,
    },
    {
      name: 'transcribe',
      description:
        'Transcribe every clip in footage/ (verbatim, word timestamps, fillers kept, speakers) ' +
        'into edit/transcripts/ and pack them into edit/takes_packed.md, which is printed. ' +
        'Cached per clip: calling it again is free. Minutes for the first run (models load).',
      run:
        `${V} "$P" "$V/helpers/transcribe_local.py" {job_dir}/footage --edit-dir {job_dir}/edit ` +
        '${ARG_NUM_SPEAKERS:+--num-speakers "$ARG_NUM_SPEAKERS"} ${ARG_LANGUAGE:+--language "$ARG_LANGUAGE"} 2>&1 | ' +
        "grep -v -E 'it/s|%\\||\\[transformers\\]|UNEXPECTED|deprecated|generation|attention mask|logits processor|^Key|^---|^Notes|^- UNEX|^$' ; " +
        '"$P" "$V/helpers/pack_transcripts.py" --edit-dir {job_dir}/edit && echo && cat {job_dir}/edit/takes_packed.md',
      params: {
        num_speakers: {
          description: 'How many people speak, if known (helps diarization).',
        },
        language: { description: 'ISO language code, default en.' },
      },
      timeout: 3600,
    },
    {
      name: 'timeline_view',
      description:
        'Filmstrip plus waveform PNG of a time range: of a source clip (name in footage/) or of ' +
        'a rendered file (absolute path), with words and silences from the transcript. Returns ' +
        'the PNG path; Read it to look. Use at decision points and on the rendered preview at ' +
        'each cut, not in a loop over everything.',
      run:
        `${V} case "$ARG_SOURCE" in /*) src="$ARG_SOURCE";; *) src="{job_dir}/footage/$ARG_SOURCE";; esac; ` +
        'stem="$(basename "${src%.*}")"; t="{job_dir}/edit/transcripts/$stem.json"; mkdir -p {job_dir}/edit/verify; ' +
        'out="{job_dir}/edit/verify/${stem}_${ARG_START}_${ARG_END}.png"; ' +
        '"$P" "$V/helpers/timeline_view.py" "$src" "$ARG_START" "$ARG_END" -o "$out" $([ -f "$t" ] && echo --transcript "$t") && echo "$out"',
      params: {
        source: {
          description:
            'Clip file name in footage/, or an absolute path to a rendered file.',
          required: true,
        },
        start: { description: 'Start, seconds.', required: true },
        end: { description: 'End, seconds.', required: true },
      },
      timeout: 300,
    },
    {
      name: 'save_edl',
      description:
        'Save the cut list as edit/edl.json (see the EDL format in the skill: version, sources ' +
        'as absolute paths, ranges with source/start/end/beat/quote/reason, grade, overlays, ' +
        'subtitles, total_duration_s). Validates the JSON and reports the ranges and total.',
      run: `${V} "$P" -c 'import json, os, sys
d = json.loads(os.environ["ARG_JSON"])
ranges = d.get("ranges", [])
assert isinstance(ranges, list) and ranges, "ranges must be a non-empty list"
for r in ranges:
    assert float(r["end"]) > float(r["start"]), f"range ends before it starts: {r}"
    assert r["source"] in d.get("sources", {}), f"range names a source not in sources: {r['source']}"
for name, path in d.get("sources", {}).items():
    assert os.path.isabs(path) and os.path.exists(path), f"source {name} is not an existing absolute path: {path}"
open(sys.argv[1], "w").write(json.dumps(d, indent=2))
total = sum(float(r["end"]) - float(r["start"]) for r in ranges)
print(f"saved {sys.argv[1]}: {len(ranges)} ranges, {total:.1f}s of picture")' {job_dir}/edit/edl.json`,
      params: {
        json: { description: 'The EDL as a JSON string.', required: true },
      },
      timeout: 60,
    },
    {
      name: 'render',
      description:
        "Render edit/edl.json with the skill's render.py: per-segment extract with grade and " +
        'fades, lossless concat, overlays, subtitles last. preview=1 renders 720p fast (always ' +
        'for anything shown to the person); subtitles=1 builds master.srt from the transcripts ' +
        'and burns it. Output defaults to edit/preview.mp4 (preview) or edit/final.mp4.',
      run:
        `${V} cd {job_dir}/edit && if [ "$ARG_PREVIEW" = 1 ]; then out="\${ARG_OUTPUT:-{job_dir}/edit/preview.mp4}"; else out="\${ARG_OUTPUT:-{job_dir}/edit/final.mp4}"; fi; ` +
        '"$P" "$V/helpers/render.py" "${ARG_EDL:-{job_dir}/edit/edl.json}" -o "$out" ' +
        '$([ "$ARG_PREVIEW" = 1 ] && echo --preview) $([ "$ARG_SUBTITLES" = 1 ] && echo --build-subtitles) && ' +
        // render.py keeps 1080p even for a preview; a long one would pass
        // the 100 MB upload cap, so a big preview is sent on at 720p.
        'if [ "$ARG_PREVIEW" = 1 ] && [ "$(stat -f %z "$out" 2>/dev/null || stat -c %s "$out")" -gt 41943040 ]; then ' +
        'small="${out%.*}.720p.mp4"; ffmpeg -y -v error -i "$out" -vf scale=-2:720 -c:v libx264 -preset veryfast -crf 27 -c:a copy -movflags +faststart "$small" && ' +
        'echo "preview over 40 MB; upload the 720p copy:" && out="$small"; fi && ' +
        'echo && echo "rendered $out" && ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$out"',
      params: {
        preview: { description: '1 for a fast 720p preview.' },
        subtitles: { description: '1 to build and burn subtitles.' },
        edl: { description: 'EDL path; default edit/edl.json.' },
        output: {
          description:
            'Output path; default edit/preview.mp4 or edit/final.mp4.',
        },
      },
      timeout: 3600,
    },
    {
      name: 'grade',
      description:
        "Color-grade one file with the skill's grade.py: a preset (warm_cinematic, neutral_punch, " +
        "none), auto analysis when no preset, or a raw ffmpeg filter. Normally the EDL's grade " +
        'field does this per segment; use this to try a look on one clip first.',
      run: `${V} "$P" "$V/helpers/grade.py" "$ARG_INPUT" -o "$ARG_OUTPUT" \${ARG_PRESET:+--preset "$ARG_PRESET"} \${ARG_FILTER:+--filter "$ARG_FILTER"}`,
      params: {
        input: { description: 'Absolute input path.', required: true },
        output: { description: 'Absolute output path.', required: true },
        preset: { description: 'Preset name.' },
        filter: { description: 'Raw ffmpeg filter string.' },
      },
      timeout: 1800,
    },
    {
      name: 'media_info',
      description:
        'Duration, size, streams and measured loudness (EBU R128 integrated, true peak) of a ' +
        'rendered file. Use it on every preview before showing it: you cannot listen, so report ' +
        'the numbers.',
      run:
        'ffprobe -v error -show_entries format=duration,size:stream=codec_type,codec_name,width,height,r_frame_rate,channels -of default=nw=1 "$ARG_PATH" && ' +
        'ffmpeg -hide_banner -nostats -i "$ARG_PATH" -af ebur128=peak=true -f null - 2>&1 | tail -12',
      params: {
        path: { description: 'Absolute path of the file.', required: true },
      },
      timeout: 600,
    },
  ],
  teardown: [],
};

const CLAUDE_CODE: AgentProfile = {
  systemPrompt: `${CLAUDE_CODE_SYSTEM_PROMPT}\n${ANTISLOP_SYSTEM_PROMPT}`,
  allowedTools: CLAUDE_CODE_ALLOWED_TOOLS,
  mcpServers: ['notesgraph', 'run'],
  workdir: 'repo',
  toolTimeoutMs: TOOL_TIMEOUT_MS,
  automation: CODE_AUTOMATION,
  skills: ANTISLOP,
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
  // Claude Code with the video-use skill and its helpers as tools, on a
  // device with ffmpeg; previews come back as question attachments.
  'video-editor': {
    systemPrompt: `${CLAUDE_CODE_SYSTEM_PROMPT}\n${VIDEO_EDITOR_SYSTEM_PROMPT}`,
    allowedTools: CLAUDE_CODE_ALLOWED_TOOLS,
    mcpServers: ['notesgraph', 'run'],
    // Footage and renders live under the job, never in a repo.
    workdir: 'job',
    toolTimeoutMs: TOOL_TIMEOUT_MS,
    automation: VIDEO_AUTOMATION,
    skills: [VIDEO_USE],
  },
};

/**
 * How much an agent may do without asking, coarsest first:
 *
 *   read    reads notes, files and the web; anything else is refused without
 *           asking (jobs.ts)
 *   write   also writes notes; shell and file edits ask (the profiles' default)
 *   manage  also edits files; shell asks
 *   full    everything, as if "Allow all" were pressed when it started
 *
 * Whatever the level, a tool call that deploys, spends or deletes still asks
 * (alwaysAsks).
 */
export const ACCESS_LEVELS = ['read', 'write', 'manage', 'full'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export const parseAccess = (value: unknown): AccessLevel | null =>
  (ACCESS_LEVELS as readonly unknown[]).includes(value)
    ? (value as AccessLevel)
    : null;

const NOTESGRAPH_READ_TOOLS = [
  'keyword_search',
  'semantic_search',
  'search_blocks',
  'list_documents',
  'list_blocks',
  'read_document',
  'get_links',
  'get_backlinks',
  'get_board',
  'doc_outline',
  'read_section',
].map(name => `mcp__notesgraph__${name}`);

const FILE_EDIT_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

/** A profile's tools narrowed or widened to a level. */
function withAccess(profile: AgentProfile, access: AccessLevel): AgentProfile {
  // The profile's own extras (OmniSeek for research) only read, so they stay.
  const extras = profile.allowedTools.filter(
    tool => !CLAUDE_CODE_ALLOWED_TOOLS.includes(tool)
  );
  const read = [
    ...NOTESGRAPH_READ_TOOLS,
    ...CLAUDE_CODE_ALLOWED_TOOLS.filter(tool => tool !== 'mcp__notesgraph'),
    ...extras,
  ];
  const allowedTools =
    access === 'read'
      ? read
      : access === 'write'
        ? profile.allowedTools
        : [...profile.allowedTools, ...FILE_EDIT_TOOLS];
  return { ...profile, allowedTools };
}

/**
 * The profile for a job's model; null for one that isn't a Claude agent. A
 * list of skill names replaces the model's default skills; names outside the
 * catalog are dropped, so a job can't point a runner at an arbitrary URL.
 * The one other kind it may name is a skill note (`note:<docId>`), and only
 * those in `noteSkills`: the job's own workspace's, looked up by the server
 * (skill-notes.ts).
 */
export function profileFor(
  model: string | null | undefined,
  skills?: unknown,
  access?: string | null,
  noteSkills: ReadonlyArray<{ ref: string; skill: AgentSkill }> = []
): AgentProfile | null {
  let profile = (model && PROFILES[model]) || null;
  if (!profile) return null;
  const level = parseAccess(access);
  if (level) profile = withAccess(profile, level);
  if (!Array.isArray(skills)) return profile;
  return {
    ...profile,
    skills: [
      ...SKILL_CATALOG.filter(skill => skills.includes(skill.name)),
      ...noteSkills
        .filter(note => skills.includes(note.ref))
        .map(note => note.skill),
    ],
  };
}

// Shell commands that deploy, spend money or delete. Pushing a branch is not
// among them: a run that ships its work ends with `wf done`, and the person
// chose (2026-10-14) to let that through once they press "Allow all".
const ALWAYS_ASK_COMMANDS: RegExp[] = [
  /\bdeploy/i,
  /\bwf\s+(release|ship)\b/,
  /\bgh\s+(pr\s+merge|release\s+create|repo\s+delete)\b/,
  /\b(npm|yarn|pnpm)\s+publish\b/,
  /\bdocker\s+push\b/,
  /\bkubectl\s+(apply|delete|rollout)\b/,
  /\bterraform\s+(apply|destroy)\b/,
  /\bfly\s+deploy\b/,
  /\brm\s+(-\w*[rf]\w*\s+)+/,
  /\bgit\s+push\b[^\n]*(--force\b|-f\b|--delete\b|\s:)/,
  /\bgit\s+(reset\s+--hard|clean\s+-\w*f|branch\s+-D)\b/,
  /\b(drop\s+(table|database)|truncate\s+table)\b/i,
  /\bcurl\b[^\n]*(-X\s*(DELETE|POST|PUT|PATCH)\b|--data\b|-d\s)/,
];

// Tools whose every call deletes or spends, whatever their input.
const ALWAYS_ASK_TOOL =
  /(delete|remove|destroy|purchase|checkout|payment|transfer|deploy)/i;

/**
 * Whether a permission (its "Allow <tool>?" text and the tool input as JSON)
 * deploys, spends or deletes, so "Allow all" and the full level don't cover it.
 */
export function alwaysAsks(
  text: string,
  detail: string | null | undefined
): boolean {
  const tool = /^Allow (\S+)\?$/.exec(text.trim())?.[1] ?? '';
  if (!tool) return false;
  if (tool === 'Bash') {
    let command = detail ?? '';
    try {
      command = String(
        (JSON.parse(command) as { command?: unknown }).command ?? ''
      );
    } catch {
      // Not JSON: look at it as it came.
    }
    return ALWAYS_ASK_COMMANDS.some(pattern => pattern.test(command));
  }
  return (
    tool.startsWith('mcp__') &&
    ALWAYS_ASK_TOOL.test(tool.split('__').pop() ?? '')
  );
}
