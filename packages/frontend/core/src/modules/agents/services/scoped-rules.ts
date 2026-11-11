/**
 * Scoped sections of the "Agent rules" note: a heading such as
 * "## For project: notes-graph", "## For tag: mobile" or
 * "## For agent: Researcher" holds rules that only matter for some runs.
 * Everything else in the note applies to every run.
 *
 * The same code is in the server (plugins/registry/scoped-rules.ts) and,
 * in Python, in the wf CLI; all three follow one spec and pass the same
 * test cases, so a note reads the same wherever a run starts.
 */

/** What a run is about, for matching scoped sections. Any part may be unknown. */
export interface AgentRunContext {
  /** Names of the NotesGraph projects the run is in. */
  projects?: Iterable<string>;
  /** Tags on the item, its note, its project and the agent. */
  tags?: Iterable<string>;
  /** The agent's name, and its id. */
  agents?: Iterable<string>;
}

export interface FilteredAgentRules {
  /** The note with the sections for other runs left out. */
  text: string;
  /** Whether a "For …" section was kept, i.e. matched this run. */
  keptScoped: boolean;
}

type ScopeKind = 'project' | 'tag' | 'agent';

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const SCOPE_RE = /^for\s+(projects?|tags?|agents?)\s*:\s*(.+)$/i;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/** A name as matched: lowercase, no leading `#`, spaces/-/_ as one `-`. */
export function normalizeScopeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/^#/, '')
    .replace(/[\s_-]+/g, '-');
}

/** A heading's scope, or null for an ordinary heading. */
export function parseScopeHeading(
  text: string
): { kind: ScopeKind; values: string[] } | null {
  const match = SCOPE_RE.exec(text);
  if (!match) return null;
  const kind = match[1].toLowerCase().replace(/s$/, '') as ScopeKind;
  const values = match[2]
    .split(',')
    .map(value => value.trim().replace(/^#/, ''))
    .filter(Boolean);
  return { kind, values };
}

const nameSet = (names: Iterable<string> | undefined) =>
  new Set([...(names ?? [])].map(normalizeScopeName).filter(Boolean));

/**
 * The rules note as one run should see it: unscoped text, plus the "For …"
 * sections (heading line included) that match the run. A section runs to
 * the next heading of the same or a higher rank; one nested in another
 * applies only if the outer one does too. Lines in code fences are never
 * headings.
 */
export function filterAgentRules(
  markdown: string,
  ctx: AgentRunContext
): FilteredAgentRules {
  const sets: Record<ScopeKind, Set<string>> = {
    project: nameSet(ctx.projects),
    tag: nameSet(ctx.tags),
    agent: nameSet(ctx.agents),
  };
  const open: { level: number; matches: boolean }[] = [];
  const kept: string[] = [];
  let keptScoped = false;
  let fence: { char: string; length: number } | null = null;

  const all = markdown.split(/\r?\n/);
  const total = all.length;
  for (const line of all) {
    const fenceMatch = FENCE_RE.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.char &&
        fenceMatch[1].length >= fence.length &&
        line.trim() === fenceMatch[1]
      ) {
        fence = null;
      }
    } else if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
    } else {
      const heading = HEADING_RE.exec(line);
      if (heading) {
        const level = heading[1].length;
        while (open.length && open[open.length - 1].level >= level) open.pop();
        const scope = parseScopeHeading(heading[2]);
        if (scope) {
          const set = sets[scope.kind];
          const matches = scope.values.some(value =>
            set.has(normalizeScopeName(value))
          );
          open.push({ level, matches });
          if (open.every(section => section.matches)) keptScoped = true;
        }
      }
    }
    if (open.every(section => section.matches)) kept.push(line);
  }

  // A note with nothing dropped is handed on as written.
  if (kept.length === total) return { text: markdown.trim(), keptScoped };

  // A dropped section can leave blank lines on both sides of it: a run of
  // three or more blank lines becomes two.
  const lines: string[] = [];
  let blanks = 0;
  for (const line of kept) {
    blanks = line.trim() ? 0 : blanks + 1;
    if (blanks <= 2) lines.push(line);
  }
  return { text: lines.join('\n').trim(), keptScoped };
}
