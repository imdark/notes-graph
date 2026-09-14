/**
 * Thin wrapper over the File System Access API.
 *
 * Two things this file exists to hide from the sync engine:
 *
 * 1. **Typing.** `FileSystemObserver` and the picker are ahead of the TS DOM
 *    lib, so the shapes are declared here once rather than cast at every call
 *    site.
 * 2. **Change detection.** `FileSystemObserver` (Chromium 129+) gives real push
 *    notifications; without it the only option is polling `lastModified`.
 *    `observeFolder` picks whichever is available and presents one interface.
 *
 * Availability caveat for callers: this whole API is Chromium-only — no
 * Safari, no Firefox, no mobile web. `isFolderSyncSupported()` is the gate.
 */

import { isMarkdownPath } from './markdown-file';

type PermissionMode = 'read' | 'readwrite';

interface HandleWithPermissions {
  queryPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
}

interface FileSystemObserverRecord {
  type: 'appeared' | 'disappeared' | 'modified' | 'moved' | 'unknown';
  relativePathComponents: string[];
  relativePathMovedFrom?: string[];
}

interface FileSystemObserverLike {
  observe: (
    handle: FileSystemDirectoryHandle,
    options?: { recursive?: boolean }
  ) => Promise<void>;
  disconnect: () => void;
}

// `showDirectoryPicker` is already in the DOM lib; only the observer needs
// declaring (Chromium 129+, still ahead of TypeScript).
declare global {
  interface Window {
    FileSystemObserver?: {
      new (
        callback: (records: FileSystemObserverRecord[]) => void
      ): FileSystemObserverLike;
    };
  }
}

/** Whether this browser can bind a folder at all. */
export function isFolderSyncSupported(): boolean {
  return typeof window !== 'undefined' && !!window.showDirectoryPicker;
}

/** Whether file changes arrive as events rather than by polling. */
export function hasNativeFileObserver(): boolean {
  return typeof window !== 'undefined' && !!window.FileSystemObserver;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({
      mode: 'readwrite',
      id: 'notesgraph-folder-sync',
    });
    // `blocksuite/notesgraph/shared/src/utils/file/filesys.ts` declares
    // `Window.showDirectoryPicker` globally as returning its own minimal
    // handle shape (kind/name/values only), which shadows the real DOM type
    // everywhere. Re-assert the DOM type here rather than refactor that
    // declaration out from under the rest of the codebase.
    return handle as unknown as FileSystemDirectoryHandle;
  } catch {
    // The user dismissing the picker throws AbortError; not an error worth
    // surfacing.
    return null;
  }
}

/**
 * Ensure we still hold `mode` on `handle`, prompting if needed.
 *
 * A stored handle comes back across reloads without its permission, and
 * `requestPermission` only works inside a user gesture — so a `false` here
 * during startup means "ask the user to click", not "binding is broken".
 */
export async function ensurePermission(
  handle: FileSystemDirectoryHandle,
  mode: PermissionMode = 'readwrite'
): Promise<boolean> {
  const h = handle as FileSystemDirectoryHandle & HandleWithPermissions;
  try {
    if ((await h.queryPermission?.({ mode })) === 'granted') return true;
    return (await h.requestPermission?.({ mode })) === 'granted';
  } catch {
    return false;
  }
}

interface DirEntry {
  name: string;
  kind: 'file' | 'directory';
  handle: FileSystemDirectoryHandle | FileSystemFileHandle;
}

async function entriesOf(dir: FileSystemDirectoryHandle): Promise<DirEntry[]> {
  const iterable = dir as unknown as {
    values: () => AsyncIterableIterator<
      FileSystemDirectoryHandle | FileSystemFileHandle
    >;
  };
  const out: DirEntry[] = [];
  for await (const handle of iterable.values()) {
    out.push({ name: handle.name, kind: handle.kind, handle });
  }
  return out;
}

/** Directories that are never notes and would swamp a scan. */
const SKIP_DIRS = new Set([
  '.git',
  '.obsidian',
  'node_modules',
  '.trash',
  '.DS_Store',
  '.notesgraph',
]);

export interface WalkedFile {
  /** POSIX-relative to the bound root, e.g. `notes/ideas/thing.md`. */
  path: string;
  handle: FileSystemFileHandle;
}

/** Every markdown file under `root`, depth-first. */
export async function walkMarkdownFiles(
  root: FileSystemDirectoryHandle,
  maxDepth = 12
): Promise<WalkedFile[]> {
  const found: WalkedFile[] = [];

  const walk = async (
    dir: FileSystemDirectoryHandle,
    prefix: string,
    depth: number
  ): Promise<void> => {
    if (depth > maxDepth) return;
    for (const entry of await entriesOf(dir)) {
      if (entry.name.startsWith('.') && entry.kind === 'directory') continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') {
        await walk(entry.handle as FileSystemDirectoryHandle, path, depth + 1);
      } else if (isMarkdownPath(entry.name)) {
        found.push({ path, handle: entry.handle as FileSystemFileHandle });
      }
    }
  };

  await walk(root, '', 0);
  return found;
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  create: boolean
): Promise<FileSystemDirectoryHandle | null> {
  let dir = root;
  for (const segment of segments) {
    try {
      dir = await dir.getDirectoryHandle(segment, { create });
    } catch {
      return null;
    }
  }
  return dir;
}

export async function readFileAt(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<string | null> {
  const segments = path.split('/');
  const name = segments.pop();
  if (!name) return null;
  const dir = await resolveDir(root, segments, false);
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(name);
    return await (await handle.getFile()).text();
  } catch {
    return null;
  }
}

export async function writeFileAt(
  root: FileSystemDirectoryHandle,
  path: string,
  contents: string
): Promise<boolean> {
  const segments = path.split('/');
  const name = segments.pop();
  if (!name) return false;
  const dir = await resolveDir(root, segments, true);
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export async function deleteFileAt(
  root: FileSystemDirectoryHandle,
  path: string
): Promise<boolean> {
  const segments = path.split('/');
  const name = segments.pop();
  if (!name) return false;
  const dir = await resolveDir(root, segments, false);
  if (!dir) return false;
  try {
    await dir.removeEntry(name);
    return true;
  } catch {
    return false;
  }
}

export interface FolderWatch {
  stop: () => void;
  /** True when backed by real events rather than a polling timer. */
  live: boolean;
}

/**
 * Call `onChange` with the relative paths that changed.
 *
 * Prefers `FileSystemObserver`. The polling fallback re-walks the tree and
 * diffs `lastModified` + size, which is why its interval is measured in
 * seconds rather than milliseconds — it is a fallback, not the design.
 */
export function observeFolder(
  root: FileSystemDirectoryHandle,
  onChange: (paths: string[]) => void,
  pollMs = 4000
): FolderWatch {
  if (window.FileSystemObserver) {
    const observer = new window.FileSystemObserver(records => {
      const paths = records
        .map(r => r.relativePathComponents.join('/'))
        .filter(p => isMarkdownPath(p));
      // A move shows up under its new path; the old one needs reconciling too.
      for (const record of records) {
        if (record.relativePathMovedFrom) {
          const from = record.relativePathMovedFrom.join('/');
          if (isMarkdownPath(from)) paths.push(from);
        }
      }
      if (paths.length) onChange([...new Set(paths)]);
    });
    void observer.observe(root, { recursive: true });
    return { stop: () => observer.disconnect(), live: true };
  }

  let stopped = false;
  let previous = new Map<string, string>();
  let primed = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const files = await walkMarkdownFiles(root);
      const next = new Map<string, string>();
      for (const file of files) {
        const f = await file.handle.getFile();
        next.set(file.path, `${f.lastModified}:${f.size}`);
      }
      if (primed) {
        const changed: string[] = [];
        for (const [path, stamp] of next) {
          if (previous.get(path) !== stamp) changed.push(path);
        }
        for (const path of previous.keys()) {
          if (!next.has(path)) changed.push(path);
        }
        if (changed.length) onChange(changed);
      }
      previous = next;
      primed = true;
    } catch {
      // A transient read failure (permission revoked mid-poll) shouldn't kill
      // the watch; the next tick retries.
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), pollMs);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
    live: false,
  };
}
