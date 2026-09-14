import { Service } from '@notesgraph/infra';

import type { FolderSyncService } from '../../folder-sync';

/**
 * File tools an agent may be given, scoped to the workspace's bound folder.
 *
 * Every path an agent supplies is resolved *inside* the bound directory handle
 * and nowhere else. That containment is not merely a convention here: the
 * browser cannot reach outside the handle the user picked, so the worst a
 * traversal attempt can do is fail. `normalizePath` still rejects them so a
 * confused model gets a clear error instead of a silent miss.
 */

export interface AgentToolSpec {
  name: string;
  desc: string;
  /** JSON shape shown to the model. */
  args: Record<string, string>;
  /** Whether invoking it changes the user's files. */
  mutates: boolean;
}

export const FILE_TOOLS: AgentToolSpec[] = [
  {
    name: 'list_files',
    desc: 'List every markdown file in the bound folder',
    args: {},
    mutates: false,
  },
  {
    name: 'read_file',
    desc: 'Read one file in the bound folder',
    args: { path: 'relative path, e.g. notes/idea.md' },
    mutates: false,
  },
  {
    name: 'write_file',
    desc: 'Create or overwrite a file in the bound folder',
    args: { path: 'relative path', contents: 'full new file contents' },
    mutates: true,
  },
  {
    name: 'delete_file',
    desc: 'Delete a file from the bound folder',
    args: { path: 'relative path' },
    mutates: true,
  },
];

export const FILE_TOOL_NAMES = FILE_TOOLS.map(t => t.name);

/** Where overwritten/deleted contents are kept so a bad run is recoverable. */
const BACKUP_DIR = '.notesgraph/backups';

export class AgentFileToolError extends Error {}

function normalizePath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new AgentFileToolError('A "path" string is required.');
  }
  const path = raw.trim().replace(/^\.\//, '').replace(/^\/+/, '');
  if (path.split('/').some(seg => seg === '..')) {
    throw new AgentFileToolError(
      `Path "${raw}" escapes the bound folder. Use a path inside it.`
    );
  }
  if (path.startsWith('.notesgraph/')) {
    throw new AgentFileToolError(
      'That path is reserved for sync bookkeeping and backups.'
    );
  }
  return path;
}

/**
 * Executes the file tools against the bound folder.
 *
 * Mutating calls take a backup of the previous contents first, under
 * `.notesgraph/backups/`. An agent rewriting a file it misread is the expected
 * failure here, not an exotic one, so the previous bytes are always kept
 * rather than trusting the run to be correct.
 */
export class AgentFileToolsService extends Service {
  constructor(private readonly folderSync: FolderSyncService) {
    super();
  }

  /** Whether file tools can run at all right now. */
  get available(): boolean {
    return this.folderSync.rootHandle !== null;
  }

  private assertAvailable() {
    if (!this.available) {
      throw new AgentFileToolError(
        'No folder is bound to this workspace, so file tools are unavailable. Bind one in Settings → Folder sync.'
      );
    }
  }

  private async backup(path: string): Promise<void> {
    const existing = await this.folderSync.readFile(path);
    if (existing === null) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await this.folderSync.writeFileFromAgent(
      `${BACKUP_DIR}/${path.replace(/\//g, '__')}.${stamp}.md`,
      existing
    );
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    this.assertAvailable();

    switch (name) {
      case 'list_files': {
        const files = await this.folderSync.listFiles();
        return files.length
          ? files.join('\n')
          : 'The bound folder contains no markdown files.';
      }

      case 'read_file': {
        const path = normalizePath(args.path);
        const text = await this.folderSync.readFile(path);
        if (text === null) {
          throw new AgentFileToolError(`No file at "${path}".`);
        }
        return text;
      }

      case 'write_file': {
        const path = normalizePath(args.path);
        const contents = args.contents;
        if (typeof contents !== 'string') {
          throw new AgentFileToolError('A "contents" string is required.');
        }
        await this.backup(path);
        const ok = await this.folderSync.writeFileFromAgent(path, contents);
        if (!ok) throw new AgentFileToolError(`Could not write "${path}".`);
        return `Wrote ${contents.length} characters to ${path}.`;
      }

      case 'delete_file': {
        const path = normalizePath(args.path);
        await this.backup(path);
        const ok = await this.folderSync.deleteFile(path);
        if (!ok) throw new AgentFileToolError(`Could not delete "${path}".`);
        return `Deleted ${path} (a copy is in ${BACKUP_DIR}).`;
      }

      default:
        throw new AgentFileToolError(`Unknown tool "${name}".`);
    }
  }
}
