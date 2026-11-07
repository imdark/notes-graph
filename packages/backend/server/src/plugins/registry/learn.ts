import { createHash } from 'node:crypto';

/**
 * Learn from agent runs: the counting half of `wf learn`, run nightly on the
 * server over the runs the registry keeps (see docs/reference/wf-learn.md).
 * Pure, so it is tested on its own (__tests__/learn.spec.ts).
 *
 * Four detectors, no model:
 * - stuck: the same tool failing the same way 3+ times in one run;
 * - recurring_error: the same failure in 3+ runs;
 * - repeated_question: the same question asked of the user in 2+ runs, a
 *   fact that should have been written down after the first answer;
 * - reread: the same file or note read 3+ times in one run with no write to
 *   it in between.
 *
 * The findings become the "Proposed harness changes" note: proposals only,
 * never applied. A finding whose runs read web content is marked "review
 * closely": a hostile page could otherwise steer what gets proposed.
 */

export const LEARN_DAYS = 14;
export const MAX_FINDINGS = 10;
export const STUCK_MIN = 3;
export const RECURRING_MIN_RUNS = 3;
export const QUESTION_MIN_RUNS = 2;
export const REREAD_MIN = 3;
export const PROPOSALS_TITLE = 'Proposed harness changes';
export const PROPOSALS_FOLDER = ['ai', 'proposals'];

/** Tools that bring outside text into a run. Their output is untrusted. */
const UNTRUSTED_TOOL =
  /^(WebFetch|WebSearch|mcp__omniseek__|mcp__claude-in-chrome__|mcp__Claude_Browser__)/;
/** Reads: tool name -> the input field naming what was read. */
const READ_TOOLS: Record<string, string> = {
  Read: 'file_path',
  WebFetch: 'url',
  mcp__notesgraph__read_document: 'docId',
  mcp__notesgraph__read_section: 'docId',
};
/** Fields that pick out part of a target: parts of one file are not re-reads. */
const READ_PART_FIELDS = [
  'offset',
  'limit',
  'pages',
  'section',
  'sectionId',
  'blockId',
  'heading',
];
const WRITE_TOOLS: Record<string, string> = {
  Edit: 'file_path',
  MultiEdit: 'file_path',
  Write: 'file_path',
  NotebookEdit: 'notebook_path',
  mcp__notesgraph__update_document: 'docId',
  mcp__notesgraph__update_block: 'docId',
};

/** A finished run, as the registry keeps it. */
export interface RunRecord {
  id: string;
  title: string | null;
  /** The transcript tail the runner reported (registry_jobs.log). */
  log: string;
  /** Questions the run asked the user (registry_job_questions, kind question). */
  questions: string[];
}

export interface RunError {
  tool: string;
  signature: string;
  example: string;
}

/** What one run shows, for `detectLearnings` to combine across runs. */
export interface RunScan {
  runId: string;
  title: string;
  untrusted: boolean;
  errors: RunError[];
  /** "tool\ttarget" -> most reads between writes. */
  reads: Map<string, number>;
  questions: string[];
}

export type LearnKind =
  | 'stuck'
  | 'recurring_error'
  | 'repeated_question'
  | 'reread';

export interface LearnFinding {
  /** Stable across nights for the same pattern: F- plus a hash of kind and summary. */
  id: string;
  kind: LearnKind;
  summary: string;
  count: number;
  runs: { id: string; title: string }[];
  examples: string[];
  untrusted: boolean;
}

const findingId = (kind: string, summary: string) =>
  'F-' +
  createHash('sha256').update(`${kind}\0${summary}`).digest('hex').slice(0, 6);

const short = (text: string, n = 160) => {
  const flat = text.split(/\s+/).filter(Boolean).join(' ');
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
};

/**
 * The error's first telling line, with the parts that vary taken out, so
 * two runs failing the same way produce the same signature.
 */
export function errorSignature(text: string): string {
  const lines = text
    .replace(/<\/?tool_use_error>/g, '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^Exit code \d+$/.test(line));
  if (lines.length === 0) return '';
  let line = lines[0].startsWith('Traceback')
    ? lines[lines.length - 1]
    : lines[0];
  line = line.replace(/(['"`]).*?\1/g, '<q>');
  line = line.replace(/(?:~|\.{0,2})?\/[\w.\-/@]+/g, '<path>');
  line = line.replace(/\b[0-9a-f]{7,}\b/g, '<id>');
  // The runner flattens a result onto one line, so the exit code that says
  // nothing on its own is a prefix of the telling text, not a line of its own.
  line = line.replace(/^Exit code \d+\s*/i, '');
  line = line.replace(/\d+/g, '<n>');
  return line.slice(0, 140);
}

/** A JSON string field out of the runner's shortened (maybe truncated) input. */
function inputField(input: string, field: string): string | null {
  const match = new RegExp(`"${field}":"((?:[^"\\\\]|\\\\.)*)"`).exec(input);
  return match ? match[1] : null;
}

const questionWords = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(w => w.length > 2)
  );

function similar(a: Set<string>, b: Set<string>, atLeast = 0.7) {
  if (a.size === 0 || b.size === 0) return false;
  let both = 0;
  for (const word of a) if (b.has(word)) both++;
  return both / (a.size + b.size - both) >= atLeast;
}

// Transcript lines, as tools/agent-runner/src/narrate.ts writes them and the
// server stamps them: `[iso] → Tool  {"json":…}`, `[iso]   ✗ error text`,
// `[iso]   ← result`, `[iso] ? asking you: … (answer in NotesGraph)`.
// A subagent's lines carry a `    ↳ ` prefix after the stamp.
const STAMP = /^\[[^\]]*\]\s?/;
const SUB = /^\s*↳\s?/;
const CALL = /^→\s+(\S+)\s*(.*)$/;
const RESULT = /^\s*(✗|←)\s?(.*)$/;
const QUESTION = /^\?\s+asking you:\s*(.*?)\s*\(answer in NotesGraph\)\s*$/;

export function scanRun(run: RunRecord): RunScan {
  // Results follow their calls in order, so each pairs with the oldest
  // unanswered call. A subagent's calls and results are kept apart from the
  // parent's: its lines interleave with the parent's own.
  const queues = {
    main: [] as { tool: string; input: string }[],
    sub: [] as { tool: string; input: string }[],
  };
  const errors: RunError[] = [];
  const questions = [...run.questions];
  const current = new Map<string, number>();
  const peak = new Map<string, number>();
  let untrusted = false;

  for (const raw of run.log.split('\n')) {
    const unstamped = raw.replace(STAMP, '');
    const sub = SUB.test(unstamped);
    const line = unstamped.replace(SUB, '');
    const pending = sub ? queues.sub : queues.main;
    const call = CALL.exec(line);
    if (call) {
      const [, tool, input] = call;
      pending.push({ tool, input });
      if (UNTRUSTED_TOOL.test(tool)) untrusted = true;
      const readField = READ_TOOLS[tool];
      const target = readField ? inputField(input, readField) : null;
      if (target) {
        const part = READ_PART_FIELDS.map(f => inputField(input, f) ?? '').join(
          '\0'
        );
        const key = `${tool}\t${target}\t${part}`;
        const n = (current.get(key) ?? 0) + 1;
        current.set(key, n);
        peak.set(key, Math.max(peak.get(key) ?? 0, n));
        continue;
      }
      const writeField = WRITE_TOOLS[tool];
      const written = writeField ? inputField(input, writeField) : null;
      if (written) {
        for (const key of current.keys()) {
          if (key.split('\t')[1] === written) current.set(key, 0);
        }
      } else if (tool === 'Bash') {
        // A command may change any file it names (sed -i, a formatter):
        // reading that file again after it is not a re-read.
        const command = inputField(input, 'command') ?? '';
        for (const key of current.keys()) {
          const target = key.split('\t')[1];
          const base = target.split('/').pop() ?? target;
          if (command.includes(target) || command.split(/\s+/).includes(base)) {
            current.set(key, 0);
          }
        }
      }
      continue;
    }
    const result = RESULT.exec(line);
    if (result) {
      const call = pending.shift();
      if (result[1] === '✗' && call) {
        const signature = errorSignature(result[2]);
        if (signature) {
          const command = inputField(call.input, 'command');
          errors.push({
            tool: call.tool,
            signature,
            example: short(command ?? call.input, 120),
          });
        }
      }
      continue;
    }
    const question = QUESTION.exec(line);
    if (question?.[1]) questions.push(question[1]);
  }

  // Parts of one target are counted apart but reported as the target.
  const reads = new Map<string, number>();
  for (const [key, n] of peak) {
    const [tool, target] = key.split('\t');
    const k = `${tool}\t${target}`;
    reads.set(k, Math.max(reads.get(k) ?? 0, n));
  }
  return {
    runId: run.id,
    title: run.title?.trim() || run.id.slice(0, 8),
    untrusted,
    errors,
    reads,
    questions,
  };
}

/** Combine per-run scans into findings, most widespread first. */
export function detectLearnings(
  scans: RunScan[],
  limit = MAX_FINDINGS
): LearnFinding[] {
  const findings: LearnFinding[] = [];
  const runOf = new Map(
    scans.map(s => [s.runId, { id: s.runId, title: s.title }])
  );
  const untrusted = new Set(scans.filter(s => s.untrusted).map(s => s.runId));
  const anyUntrusted = (ids: string[]) => ids.some(id => untrusted.has(id));
  const runs = (ids: Iterable<string>) =>
    [...ids].sort().map(id => runOf.get(id) ?? { id, title: id.slice(0, 8) });

  type Entry = { runs: Set<string>; count: number; examples: string[] };
  const entry = (): Entry => ({ runs: new Set(), count: 0, examples: [] });
  const addExample = (e: Entry, example: string) => {
    if (e.examples.length < 3 && !e.examples.includes(example))
      e.examples.push(example);
  };
  const bySignature = new Map<string, Entry>();
  // Runs stuck on the same error are one finding, not one per run.
  const stuck = new Map<string, Entry & { peak: number }>();

  for (const scan of scans) {
    const perRun = new Map<string, string[]>();
    for (const { tool, signature, example } of scan.errors) {
      const key = `${tool}\t${signature}`;
      perRun.set(key, [...(perRun.get(key) ?? []), example]);
      const e = bySignature.get(key) ?? entry();
      e.runs.add(scan.runId);
      e.count++;
      addExample(e, example);
      bySignature.set(key, e);
    }
    for (const [key, examples] of perRun) {
      if (examples.length < STUCK_MIN) continue;
      const e = stuck.get(key) ?? { ...entry(), peak: 0 };
      e.runs.add(scan.runId);
      e.peak = Math.max(e.peak, examples.length);
      for (const example of examples) addExample(e, example);
      stuck.set(key, e);
    }
    for (const [key, n] of scan.reads) {
      if (n < REREAD_MIN) continue;
      const [tool, target] = key.split('\t');
      const summary = `${short(target, 100)} read ${n} times in one run (${tool}), no write in between`;
      findings.push({
        id: findingId('reread', summary),
        kind: 'reread',
        summary,
        count: n,
        runs: runs([scan.runId]),
        examples: [],
        untrusted: untrusted.has(scan.runId),
      });
    }
  }

  for (const [key, e] of stuck) {
    const [tool, signature] = key.split('\t');
    const where = e.runs.size === 1 ? 'one run' : `${e.runs.size} runs`;
    const summary = `${tool} failed ${STUCK_MIN}+ times (up to ${e.peak}) in ${where} with: ${signature}`;
    findings.push({
      id: findingId('stuck', summary),
      kind: 'stuck',
      summary,
      count: e.peak,
      runs: runs(e.runs),
      examples: e.examples,
      untrusted: anyUntrusted([...e.runs]),
    });
  }

  for (const [key, e] of bySignature) {
    // Already a stuck finding: the same evidence twice would crowd out others.
    if (stuck.has(key) || e.runs.size < RECURRING_MIN_RUNS) continue;
    const [tool, signature] = key.split('\t');
    const summary = `${tool} failed in ${e.runs.size} runs with: ${signature}`;
    findings.push({
      id: findingId('recurring_error', summary),
      kind: 'recurring_error',
      summary,
      count: e.count,
      runs: runs(e.runs),
      examples: e.examples,
      untrusted: anyUntrusted([...e.runs]),
    });
  }

  const groups: { words: Set<string>; question: string; runs: Set<string> }[] =
    [];
  for (const scan of scans) {
    for (const question of scan.questions) {
      const words = questionWords(question);
      const group = groups.find(g => similar(g.words, words));
      if (group) group.runs.add(scan.runId);
      else groups.push({ words, question, runs: new Set([scan.runId]) });
    }
  }
  for (const group of groups) {
    if (group.runs.size < QUESTION_MIN_RUNS) continue;
    const summary = `Asked the user in ${group.runs.size} runs: ${short(group.question)}`;
    findings.push({
      id: findingId('repeated_question', summary),
      kind: 'repeated_question',
      summary,
      count: group.runs.size,
      runs: runs(group.runs),
      examples: [],
      untrusted: anyUntrusted([...group.runs]),
    });
  }

  findings.sort((a, b) => b.runs.length - a.runs.length || b.count - a.count);
  return findings.slice(0, limit);
}

const CHECKED = /^- \[x\] `(F-[0-9a-f]{6})`/gim;

/** Finding ids ticked in an earlier version of the note. */
export function checkedIds(markdown: string): Set<string> {
  return new Set([...markdown.matchAll(CHECKED)].map(m => m[1]));
}

const md = (text: string) => text.replace(/[\\`*_[\]<>]/g, c => `\\${c}`);

/**
 * The note's body. A finding the user ticked before stays ticked, so acting
 * on one is remembered across nights; one no longer seen is dropped.
 */
export function renderProposals(
  findings: LearnFinding[],
  context: { runsScanned: number; at: Date; previous?: string | null }
): string {
  const kept = checkedIds(context.previous ?? '');
  const date = context.at.toISOString().slice(0, 10);
  const lines = [
    `Patterns counted over the agent runs of the last ${LEARN_DAYS} days ` +
      `(${context.runsScanned} runs scanned on ${date}), no model. ` +
      'Nothing here is applied: each is a proposal for the "Agent rules" ' +
      'note, a skill or Agent memory. Tick one once you have acted on it; ' +
      'it stays ticked on later nights.',
    '',
    '## Findings',
  ];
  if (findings.length === 0) {
    lines.push('', 'No repeated mistakes found.');
    return lines.join('\n');
  }
  for (const f of findings) {
    const box = kept.has(f.id) ? '[x]' : '[ ]';
    lines.push(
      '',
      `- ${box} \`${f.id}\` **${f.kind.replace('_', ' ')}**: ${md(f.summary)}`,
      `  - runs: ${f.runs.map(r => md(r.title)).join(', ')}`
    );
    for (const example of f.examples) lines.push(`  - e.g. \`${example}\``);
    if (f.untrusted)
      lines.push('  - review closely: a run behind this read web content');
  }
  return lines.join('\n');
}
