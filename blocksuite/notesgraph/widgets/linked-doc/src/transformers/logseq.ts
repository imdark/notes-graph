import type { ExtensionType, Schema, Workspace } from '@blocksuite/store';

import {
  buildMarkdownZipFolderHierarchy,
  type FolderHierarchy,
} from './markdown.js';
import { importObsidianVault } from './obsidian.js';

/**
 * Logseq stores each block as an outline bullet and annotates blocks/pages with
 * `key:: value` properties. Strip those property lines (they would otherwise be
 * imported as literal text) and normalize `#[[Tag]]` hashtags to plain
 * `[[Tag]]` wiki-links so they resolve like any other page link.
 */
function preprocessLogseqMarkdown(markdown: string): string {
  return (
    markdown
      // `key:: value` block/page properties (optionally on a `- ` bullet line).
      .replace(/^[ \t]*(?:[-*][ \t]+)?[A-Za-z0-9_-]+::.*$/gm, '')
      // `#[[Tag Name]]` -> `[[Tag Name]]`
      .replace(/#(\[\[[^\]]+\]\])/g, '$1')
  );
}

/**
 * True for Logseq paths that shouldn't be imported as content: backups
 * (`bak/`), deleted pages (`.recycle/`), version history (`version-files/`),
 * and whiteboards (`whiteboards/`, not importable). Matching by path *segment*
 * works whether or not the folder picker prefixes paths with the graph folder
 * name. (The `logseq/` config dir's own `config.edn`/`custom.css` are harmless
 * non-markdown files and simply import as unused assets.)
 */
function isLogseqSystemPath(path: string): boolean {
  return path
    .split('/')
    .some(
      segment =>
        segment === 'bak' ||
        segment === '.recycle' ||
        segment === 'version-files' ||
        segment === 'whiteboards'
    );
}

export type ImportLogseqGraphOptions = {
  collection: Workspace;
  schema: Schema;
  importedFiles: File[];
  extensions: ExtensionType[];
};

export type ImportLogseqGraphResult = {
  docIds: string[];
  folderHierarchy?: FolderHierarchy;
};

/**
 * Imports a Logseq graph folder. Logseq is markdown-on-disk much like Obsidian
 * (`[[page]]` links plus an `assets/` folder), so this reuses the Obsidian vault
 * importer for files/links/attachments, applies Logseq-specific preprocessing,
 * and rebuilds the folder structure (`pages/`, `journals/`, namespaces) from the
 * file paths.
 */
export async function importLogseqGraph({
  collection,
  schema,
  importedFiles,
  extensions,
}: ImportLogseqGraphOptions): Promise<ImportLogseqGraphResult> {
  // Drop Logseq's config dir, backups, recycle bin, and whiteboards so only
  // real pages/journals/assets import (no duplicate or deleted docs).
  const files = importedFiles.filter(
    file => !isLogseqSystemPath(file.webkitRelativePath || file.name)
  );

  const { docIds, docPaths } = await importObsidianVault({
    collection,
    schema,
    importedFiles: files,
    extensions,
    preprocess: preprocessLogseqMarkdown,
  });

  return {
    docIds,
    folderHierarchy: buildMarkdownZipFolderHierarchy(docPaths),
  };
}

export const LogseqTransformer = {
  importLogseqGraph,
};
