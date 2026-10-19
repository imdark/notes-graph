/**
 * What a run changed, reported with its end so NotesGraph can show it: the
 * notes it created, edited and linked (from NotesGraph's tools), the files
 * it edited (from Claude Code's), and for a run in a git checkout, what it
 * committed and left changed there.
 */
import { execFile } from 'node:child_process';
import { isAbsolute, relative } from 'node:path';

export interface RunChanges {
  notes: {
    created: { docId: string; title: string }[];
    edited: { docId: string; title?: string }[];
    linked: { parentDocId: string; childDocId: string }[];
  };
  files: { path: string; before: string | null; after: string | null }[];
  git?: GitChanges;
}

export interface GitChanges {
  base: string;
  head: string;
  branch?: string;
  commits: { sha: string; subject: string }[];
  stat: { path: string; added: number; removed: number }[];
  patch: string;
  truncated: boolean;
}

const TEXT_CHARS = 8000;
const MAX_FILES = 50;
const MAX_NOTES = 100;
const PATCH_CHARS = 60_000;
const MAX_JSON = 200_000;
const MAX_UNTRACKED = 200;
const GIT_TIMEOUT_MS = 20_000;

const NG = 'mcp__notesgraph__';
const EDIT_TOOLS = new Set(['update_document', 'update_document_meta', 'update_block', 'update_task']);
const FILE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

const cut = (text: string | null): string | null =>
  text === null || text.length <= TEXT_CHARS ? text : `${text.slice(0, TEXT_CHARS)}\n… (cut)`;

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined;

const cleanTitle = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const title = value.trim().replace(/\s+/g, ' ');
  return title || undefined;
};

/** A tool result's text, whether one string or a list of text parts. */
export function toolResultText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map(part => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('\n');
  }
  return String(content ?? '');
}

/** The JSON object a NotesGraph tool answered with, if it did. */
function resultJson(content: unknown): Record<string, unknown> | null {
  const texts = Array.isArray(content)
    ? [toolResultText(content), ...content.map(part => toolResultText([part]))]
    : [toolResultText(content)];
  for (const text of texts) {
    try {
      const parsed = JSON.parse(text.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

/** Gathers what a run's tool calls changed, call by call as results come in. */
export class ChangeRecorder {
  private readonly pending = new Map<string, { name: string; input: Record<string, unknown> }>();
  private readonly created: { docId: string; title: string }[] = [];
  private readonly edited = new Map<string, { docId: string; title?: string }>();
  private readonly linked: { parentDocId: string; childDocId: string }[] = [];
  private readonly files: RunChanges['files'] = [];

  constructor(private readonly cwd?: string) {}

  onToolUse(id: string | undefined, name: string | undefined, input: unknown): void {
    if (!id || !name) return;
    const short = name.startsWith(NG) ? name.slice(NG.length) : null;
    const wanted =
      FILE_TOOLS.has(name) ||
      (short !== null && (short === 'create_document' || short === 'link_document' || EDIT_TOOLS.has(short)));
    if (!wanted) return;
    const fields = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    this.pending.set(id, { name, input: fields });
  }

  onToolResult(id: string | undefined, content: unknown, isError: boolean | undefined): void {
    if (!id) return;
    const call = this.pending.get(id);
    if (!call) return;
    this.pending.delete(id);
    if (isError) return;
    const { name, input } = call;
    if (FILE_TOOLS.has(name)) {
      this.recordFile(name, input);
      return;
    }
    const json = resultJson(content);
    if (json?.success === false) return;
    const tool = name.slice(NG.length);
    if (tool === 'create_document') {
      const docId = str(json?.docId);
      if (!docId || this.created.some(doc => doc.docId === docId)) return;
      this.created.push({ docId, title: cleanTitle(input.title) ?? '' });
      this.edited.delete(docId);
    } else if (tool === 'link_document') {
      const parentDocId = str(json?.parentDocId) ?? str(input.parentDocId);
      const childDocId = str(json?.childDocId) ?? str(input.childDocId);
      if (!parentDocId || !childDocId) return;
      if (this.linked.some(l => l.parentDocId === parentDocId && l.childDocId === childDocId)) return;
      this.linked.push({ parentDocId, childDocId });
    } else {
      const docId = str(input.docId) ?? str(json?.docId);
      if (!docId || this.created.some(doc => doc.docId === docId)) return;
      const title = cleanTitle(input.title);
      const seen = this.edited.get(docId);
      if (seen) {
        if (title) seen.title = title;
      } else {
        this.edited.set(docId, { docId, ...(title ? { title } : {}) });
      }
    }
  }

  private path(raw: unknown): string | undefined {
    const path = str(raw);
    if (!path || !this.cwd || !isAbsolute(path)) return path;
    const rel = relative(this.cwd, path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
  }

  private addFile(path: string | undefined, before: unknown, after: unknown) {
    if (!path) return;
    this.files.push({
      path,
      before: cut(typeof before === 'string' ? before : null),
      after: cut(typeof after === 'string' ? after : null),
    });
  }

  private recordFile(name: string, input: Record<string, unknown>) {
    if (name === 'Edit') {
      this.addFile(this.path(input.file_path), input.old_string, input.new_string);
    } else if (name === 'MultiEdit') {
      const path = this.path(input.file_path);
      const edits = Array.isArray(input.edits) ? input.edits : [];
      for (const edit of edits) {
        const e = edit && typeof edit === 'object' ? (edit as Record<string, unknown>) : {};
        this.addFile(path, e.old_string, e.new_string);
      }
    } else if (name === 'Write') {
      this.addFile(this.path(input.file_path), null, input.content);
    } else if (name === 'NotebookEdit') {
      this.addFile(this.path(input.notebook_path), null, input.new_source);
    }
  }

  /** What was recorded, capped; undefined when nothing was. */
  build(git?: GitChanges): RunChanges | undefined {
    const created = this.created.slice(0, MAX_NOTES);
    const edited = [...this.edited.values()]
      .filter(doc => !this.created.some(c => c.docId === doc.docId))
      .slice(0, MAX_NOTES);
    const linked = this.linked.slice(0, MAX_NOTES);
    const files = this.files.slice(0, MAX_FILES);
    if (!created.length && !edited.length && !linked.length && !files.length && !git) {
      return undefined;
    }
    return fit({ notes: { created, edited, linked }, files, ...(git ? { git } : {}) });
  }
}

/** Keeps the record under MAX_JSON: the patch goes first, then files, then notes. */
function fit(changes: RunChanges): RunChanges {
  const size = () => JSON.stringify(changes).length;
  if (size() < MAX_JSON) return changes;
  if (changes.git?.patch) {
    changes.git = { ...changes.git, patch: '', truncated: true };
  }
  while (size() >= MAX_JSON && changes.files.length) changes.files.pop();
  const { notes } = changes;
  while (size() >= MAX_JSON && (notes.created.length || notes.edited.length || notes.linked.length)) {
    if (notes.edited.length) notes.edited.pop();
    else if (notes.linked.length) notes.linked.pop();
    else notes.created.pop();
  }
  if (size() >= MAX_JSON && changes.git) {
    changes.git = { ...changes.git, stat: changes.git.stat.slice(0, 100), commits: changes.git.commits.slice(-100) };
  }
  return changes;
}

/** Runs git; its output, or null if it failed (exit 1 is allowed when `okExit1`). */
function git(cwd: string, args: string[], okExit1 = false): Promise<string | null> {
  return new Promise(resolve => {
    try {
      execFile(
        'git',
        args,
        { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' },
        (err, stdout) => {
          if (!err) return resolve(stdout);
          const code = (err as { code?: unknown }).code;
          resolve(okExit1 && code === 1 ? stdout : null);
        }
      );
    } catch {
      resolve(null);
    }
  });
}

/** The commit a run starts from in `cwd`, or undefined outside a git checkout. */
export async function gitBase(cwd: string): Promise<string | undefined> {
  const out = await git(cwd, ['rev-parse', '--verify', 'HEAD']);
  return out?.trim() || undefined;
}

/**
 * What changed in `cwd` since `base`: commits made, and the working tree's
 * difference from base (uncommitted and untracked files included).
 * Undefined when nothing changed or git fails.
 */
export async function gitChanges(cwd: string, base: string): Promise<GitChanges | undefined> {
  try {
    const head = (await git(cwd, ['rev-parse', '--verify', 'HEAD']))?.trim();
    if (!head) return undefined;
    const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim();
    const log = await git(cwd, ['log', '--reverse', '--format=%h%x00%s', `${base}..HEAD`]);
    const numstat = await git(cwd, ['diff', '--numstat', base]);
    let patch = await git(cwd, ['diff', base]);
    const others = await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
    if (log === null || numstat === null || patch === null || others === null) return undefined;

    const commits = log
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [sha, ...subject] = line.split('\0');
        return { sha, subject: subject.join('\0') };
      });
    const stat = numstat
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [added, removed, ...path] = line.split('\t');
        return { path: path.join('\t'), added: Number(added) || 0, removed: Number(removed) || 0 };
      });
    const untracked = others.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED);
    for (const file of untracked) {
      const diff = (await git(cwd, ['diff', '--no-index', '--', '/dev/null', file], true)) ?? '';
      const added = diff
        .split('\n')
        .filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
      stat.push({ path: file, added, removed: 0 });
      if (diff) patch += (patch && !patch.endsWith('\n') ? '\n' : '') + diff;
    }

    if (!commits.length && !patch.trim()) return undefined;
    const truncated = patch.length > PATCH_CHARS;
    return {
      base,
      head,
      ...(branch && branch !== 'HEAD' ? { branch } : {}),
      commits,
      stat,
      patch: truncated ? patch.slice(0, PATCH_CHARS) : patch,
      truncated,
    };
  } catch {
    return undefined;
  }
}

/** The run's changes, git included when it started in a checkout. Never throws. */
export async function collectChanges(
  recorder: ChangeRecorder,
  cwd: string,
  base: string | undefined
): Promise<RunChanges | undefined> {
  try {
    const gitPart = base ? await gitChanges(cwd, base) : undefined;
    return recorder.build(gitPart);
  } catch {
    return undefined;
  }
}
