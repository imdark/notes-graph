/**
 * What a run changed, as its runner recorded it when it ended: the notes it
 * created, edited and linked through NotesGraph's tools, the file edits it
 * made, and (when it worked in a git checkout) the commits and the diff.
 *
 * The runners (tools/agent-runner, and `wf agent serve` in the workflow repo)
 * cap each part before sending it, and the server caps the whole; a `git`
 * with `truncated` lost the end of its patch, and `filesDropped` means the
 * file edits went too.
 */
export interface RunChanges {
  notes?: {
    created?: { docId: string; title: string }[];
    edited?: { docId: string; title?: string }[];
    linked?: { parentDocId: string; childDocId: string }[];
  };
  files?: { path: string; before: string | null; after: string | null }[];
  filesDropped?: boolean;
  git?: {
    base: string;
    head: string;
    branch?: string;
    commits: { sha: string; subject: string }[];
    stat: { path: string; added: number; removed: number }[];
    patch: string;
    truncated: boolean;
  };
}

/** Nothing worth showing: no notes, no file edits, no commits or diff. */
export function changesAreEmpty(
  changes: RunChanges | null | undefined
): boolean {
  if (!changes) return true;
  const notes = changes.notes;
  return (
    !notes?.created?.length &&
    !notes?.edited?.length &&
    !notes?.linked?.length &&
    !changes.files?.length &&
    !changes.git?.commits.length &&
    !changes.git?.stat.length &&
    !changes.git?.patch
  );
}

export type PatchLine = {
  kind: 'context' | 'added' | 'removed' | 'note';
  text: string;
  /** Line numbers in the old and new file; null where the line isn't there. */
  oldNo: number | null;
  newNo: number | null;
};

export interface PatchHunk {
  header: string;
  lines: PatchLine[];
}

export interface PatchFile {
  path: string;
  /** Set when the file was renamed from another path. */
  oldPath?: string;
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'binary';
  hunks: PatchHunk[];
}

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;

const unquote = (path: string) =>
  path.startsWith('"') && path.endsWith('"') ? path.slice(1, -1) : path;

/** `a/foo` or `b/foo` without its side prefix; `/dev/null` stays as is. */
const sidePath = (path: string) =>
  path === '/dev/null' ? path : unquote(path).replace(/^[ab]\//, '');

/**
 * Split a unified diff (`git diff`, including `--no-index` diffs of new
 * files) into files and their hunks, numbering each line on both sides.
 */
export function parsePatch(patch: string): PatchFile[] {
  const files: PatchFile[] = [];
  let file: PatchFile | null = null;
  let hunk: PatchHunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git (\S+|"[^"]+") (\S+|"[^"]+")$/.exec(line);
      file = {
        path: match ? sidePath(match[2]) : line.slice('diff --git '.length),
        status: 'modified',
        hunks: [],
      };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith('new file mode')) file.status = 'added';
      else if (line.startsWith('deleted file mode')) file.status = 'deleted';
      else if (line.startsWith('rename from ')) {
        file.status = 'renamed';
        file.oldPath = line.slice('rename from '.length);
      } else if (line.startsWith('Binary files')) file.status = 'binary';
      else if (line.startsWith('+++ ')) {
        const to = sidePath(line.slice(4).trim());
        if (to !== '/dev/null') file.path = to;
      }
    }
    const header = HUNK.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[2]);
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith('+')) {
      hunk.lines.push({
        kind: 'added',
        text: line.slice(1),
        oldNo: null,
        newNo: newNo++,
      });
    } else if (line.startsWith('-')) {
      hunk.lines.push({
        kind: 'removed',
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: null,
      });
    } else if (line.startsWith(' ')) {
      hunk.lines.push({
        kind: 'context',
        text: line.slice(1),
        oldNo: oldNo++,
        newNo: newNo++,
      });
    } else if (line.startsWith('\\')) {
      hunk.lines.push({ kind: 'note', text: line, oldNo: null, newNo: null });
    }
  }
  return files;
}
