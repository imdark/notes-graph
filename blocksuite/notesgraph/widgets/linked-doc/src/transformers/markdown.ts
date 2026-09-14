import { Container } from '@blocksuite/global/di';
import { BlockSuiteError, ErrorCode } from '@blocksuite/global/exceptions';
import { sha } from '@blocksuite/global/utils';
import {
  defaultImageProxyMiddleware,
  docLinkBaseURLMiddleware,
  fileNameMiddleware,
  filePathMiddleware,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/notesgraph-shared/adapters';
import type {
  DocMeta,
  ExtensionType,
  Schema,
  Store,
  Workspace,
} from '@blocksuite/store';
import { extMimeMap, Transformer } from '@blocksuite/store';

import type { AssetMap, ImportedFileEntry, PathBlobIdMap } from './type.js';
import { createAssetsArchive, download, parseMatter, Unzip } from './utils.js';

export type ParsedFrontmatterMeta = Partial<
  Pick<
    DocMeta,
    'title' | 'createDate' | 'updatedDate' | 'tags' | 'favorite' | 'trash'
  >
>;

const FRONTMATTER_KEYS = {
  title: ['title', 'name'],
  created: [
    'created',
    'createdat',
    'created_at',
    'createddate',
    'created_date',
    'creationdate',
    'date',
    'time',
  ],
  updated: [
    'updated',
    'updatedat',
    'updated_at',
    'updateddate',
    'updated_date',
    'modified',
    'modifiedat',
    'modified_at',
    'lastmodified',
    'last_modified',
    'lastedited',
    'last_edited',
    'lasteditedtime',
    'last_edited_time',
  ],
  tags: ['tags', 'tag', 'categories', 'category', 'labels', 'keywords'],
  favorite: ['favorite', 'favourite', 'star', 'starred', 'pinned'],
  trash: ['trash', 'trashed', 'deleted', 'archived'],
};

const truthyStrings = new Set(['true', 'yes', 'y', '1', 'on']);
const falsyStrings = new Set(['false', 'no', 'n', '0', 'off']);

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (truthyStrings.has(normalized)) return true;
    if (falsyStrings.has(normalized)) return false;
  }
  return undefined;
}

function parseTimestamp(value: unknown): number | undefined {
  if (value && value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1e10 ? value : Math.round(value * 1000);
  }
  if (typeof value === 'string') {
    const num = Number(value);
    if (!Number.isNaN(num)) {
      return num > 1e10 ? num : Math.round(num * 1000);
    }
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function parseTags(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const tags = value
      .map(v => (typeof v === 'string' ? v : String(v)))
      .map(v => v.trim())
      .filter(Boolean);
    return tags.length ? [...new Set(tags)] : undefined;
  }
  if (typeof value === 'string') {
    const tags = value
      .split(/[,;]+/)
      .map(v => v.trim())
      .filter(Boolean);
    return tags.length ? [...new Set(tags)] : undefined;
  }
  return undefined;
}

function buildMetaFromFrontmatter(
  data: Record<string, unknown>
): ParsedFrontmatterMeta {
  const meta: ParsedFrontmatterMeta = {};
  for (const [rawKey, value] of Object.entries(data)) {
    const key = rawKey.trim().toLowerCase();
    if (FRONTMATTER_KEYS.title.includes(key) && typeof value === 'string') {
      const title = value.trim();
      if (title) meta.title = title;
      continue;
    }
    if (FRONTMATTER_KEYS.created.includes(key)) {
      const timestamp = parseTimestamp(value);
      if (timestamp !== undefined) {
        meta.createDate = timestamp;
      }
      continue;
    }
    if (FRONTMATTER_KEYS.updated.includes(key)) {
      const timestamp = parseTimestamp(value);
      if (timestamp !== undefined) {
        meta.updatedDate = timestamp;
      }
      continue;
    }
    if (FRONTMATTER_KEYS.tags.includes(key)) {
      const tags = parseTags(value);
      if (tags) meta.tags = tags;
      continue;
    }
    if (FRONTMATTER_KEYS.favorite.includes(key)) {
      const favorite = parseBoolean(value);
      if (favorite !== undefined) {
        meta.favorite = favorite;
      }
      continue;
    }
    if (FRONTMATTER_KEYS.trash.includes(key)) {
      const trash = parseBoolean(value);
      if (trash !== undefined) {
        meta.trash = trash;
      }
      continue;
    }
  }
  return meta;
}

export function parseFrontmatter(markdown: string): {
  content: string;
  meta: ParsedFrontmatterMeta;
} {
  try {
    const parsed = parseMatter(markdown);
    if (!parsed) {
      return { content: markdown, meta: {} };
    }
    const content = parsed.body ?? markdown;

    if (Array.isArray(parsed.metadata)) {
      return { content: String(content), meta: {} };
    }

    const meta = buildMetaFromFrontmatter({ ...parsed.metadata });
    return { content: String(content), meta };
  } catch {
    return { content: markdown, meta: {} };
  }
}

export function applyMetaPatch(
  collection: Workspace,
  docId: string,
  meta: ParsedFrontmatterMeta
) {
  const metaPatch: Partial<DocMeta> = {};
  if (meta.title) metaPatch.title = meta.title;
  if (meta.createDate !== undefined) metaPatch.createDate = meta.createDate;
  if (meta.updatedDate !== undefined) metaPatch.updatedDate = meta.updatedDate;
  if (meta.tags) metaPatch.tags = meta.tags;
  if (meta.favorite !== undefined) metaPatch.favorite = meta.favorite;
  if (meta.trash !== undefined) metaPatch.trash = meta.trash;

  if (Object.keys(metaPatch).length) {
    collection.meta.setDocMeta(docId, metaPatch);
  }
}

export function getProvider(extensions: ExtensionType[]) {
  const container = new Container();
  extensions.forEach(ext => {
    ext.setup(container);
  });
  return container.provider();
}

type ImportMarkdownToBlockOptions = {
  doc: Store;
  markdown: string;
  blockId: string;
  extensions: ExtensionType[];
};

type ImportMarkdownToDocOptions = {
  collection: Workspace;
  schema: Schema;
  markdown: string;
  fileName?: string;
  extensions: ExtensionType[];
};

type ImportMarkdownZipOptions = {
  collection: Workspace;
  schema: Schema;
  imported: Blob;
  extensions: ExtensionType[];
};

type ImportMarkdownWithAssetsOptions = ImportMarkdownToDocOptions & {
  /**
   * Named binary assets the markdown references (e.g. `![](key)`), keyed by the
   * path used in the markdown. Each is stored as a workspace blob and the
   * matching image/attachment refs resolve to it — used by the Web Clipper so
   * clipped images/media are actually saved, not dropped.
   */
  assets: Record<string, Blob>;
};

/**
 * Filters hidden/system entries that should never participate in imports.
 */
export function isSystemImportPath(path: string) {
  return path.includes('__MACOSX') || path.includes('.DS_Store');
}

/**
 * Creates the doc CRUD bridge used by importer transformers.
 */
export function createCollectionDocCRUD(collection: Workspace) {
  return {
    create: (id: string) => collection.createDoc(id).getStore({ id }),
    get: (id: string) => collection.getDoc(id)?.getStore({ id }) ?? null,
    delete: (id: string) => collection.removeDoc(id),
  };
}

type CreateMarkdownImportJobOptions = {
  collection: Workspace;
  schema: Schema;
  preferredTitle?: string;
  fullPath?: string;
};

/**
 * Creates a markdown import job with the standard collection middlewares.
 */
export function createMarkdownImportJob({
  collection,
  schema,
  preferredTitle,
  fullPath,
}: CreateMarkdownImportJobOptions) {
  return new Transformer({
    schema,
    blobCRUD: collection.blobSync,
    docCRUD: createCollectionDocCRUD(collection),
    middlewares: [
      defaultImageProxyMiddleware,
      fileNameMiddleware(preferredTitle),
      docLinkBaseURLMiddleware(collection.id),
      ...(fullPath ? [filePathMiddleware(fullPath)] : []),
    ],
  });
}

type StageImportedAssetOptions = {
  pendingAssets: AssetMap;
  pendingPathBlobIdMap: PathBlobIdMap;
  path: string;
  content: Blob;
  fileName: string;
};

/**
 * Hashes a non-markdown import file and stages it into the shared asset maps.
 */
export async function stageImportedAsset({
  pendingAssets,
  pendingPathBlobIdMap,
  path,
  content,
  fileName,
}: StageImportedAssetOptions) {
  const ext = path.split('.').at(-1) ?? '';
  const mime = extMimeMap.get(ext.toLowerCase()) ?? '';
  const key = await sha(await content.arrayBuffer());
  pendingPathBlobIdMap.set(path, key);
  pendingAssets.set(key, new File([content], fileName, { type: mime }));
}

/**
 * Binds previously staged asset files into a transformer job before import.
 */
export function bindImportedAssetsToJob(
  job: Transformer,
  pendingAssets: AssetMap,
  pendingPathBlobIdMap: PathBlobIdMap
) {
  const pathBlobIdMap = job.assetsManager.getPathBlobIdMap();
  // Iterate over all assets to be imported
  for (const [assetPath, key] of pendingPathBlobIdMap.entries()) {
    // Get the relative path of the asset to the markdown file
    // Store the path to blobId map
    pathBlobIdMap.set(assetPath, key);
    // Store the asset to assets, the key is the blobId, the value is the file object
    // In block adapter, it will use the blobId to get the file object
    const assetFile = pendingAssets.get(key);
    if (assetFile) {
      job.assets.set(key, assetFile);
    }
  }

  return pathBlobIdMap;
}

/**
 * Exports a doc to a Markdown file or a zip archive containing Markdown and assets.
 * @param doc The doc to export
 * @returns A Promise that resolves when the export is complete
 */
async function exportDoc(doc: Store) {
  const provider = doc.provider;
  const job = doc.getTransformer([
    docLinkBaseURLMiddleware(doc.workspace.id),
    titleMiddleware(doc.workspace.meta.docMetas),
  ]);
  const snapshot = job.docToSnapshot(doc);

  const adapter = new MarkdownAdapter(job, provider);
  if (!snapshot) {
    return;
  }

  const markdownResult = await adapter.fromDocSnapshot({
    snapshot,
    assets: job.assetsManager,
  });

  let downloadBlob: Blob;
  const docTitle = doc.meta?.title || 'Untitled';
  let name: string;
  const contentBlob = new Blob([markdownResult.file], { type: 'plain/text' });
  if (markdownResult.assetsIds.length > 0) {
    if (!job.assets) {
      throw new BlockSuiteError(ErrorCode.ValueNotExists, 'No assets found');
    }
    const zip = await createAssetsArchive(job.assets, markdownResult.assetsIds);

    await zip.file('index.md', contentBlob);

    downloadBlob = await zip.generate();
    name = `${docTitle}.zip`;
  } else {
    downloadBlob = contentBlob;
    name = `${docTitle}.md`;
  }
  download(downloadBlob, name);
}

/**
 * The doc's markdown as a string.
 *
 * `exportDoc` hands the result straight to `download()`, which makes it
 * unusable for anything that needs the text itself — folder sync writing a
 * note back to a file, a diff, a preview. Assets are not archived here: a
 * caller wanting images should use `exportDoc`'s zip path.
 *
 * @returns The markdown, or null if the doc yields no snapshot.
 */
async function docToMarkdown(doc: Store): Promise<string | null> {
  const provider = doc.provider;
  const job = doc.getTransformer([
    docLinkBaseURLMiddleware(doc.workspace.id),
    titleMiddleware(doc.workspace.meta.docMetas),
  ]);
  const snapshot = job.docToSnapshot(doc);
  if (!snapshot) {
    return null;
  }

  const adapter = new MarkdownAdapter(job, provider);
  const result = await adapter.fromDocSnapshot({
    snapshot,
    assets: job.assetsManager,
  });
  return result.file;
}

/**
 * Imports Markdown content into a specific block within a doc.
 * @param options Object containing import options
 * @param options.doc The target doc
 * @param options.markdown The Markdown content to import
 * @param options.blockId The ID of the block where the content will be imported
 * @returns A Promise that resolves when the import is complete
 */
async function importMarkdownToBlock({
  doc,
  markdown,
  blockId,
  extensions,
}: ImportMarkdownToBlockOptions) {
  const provider = getProvider(extensions);
  const job = doc.getTransformer([
    defaultImageProxyMiddleware,
    docLinkBaseURLMiddleware(doc.workspace.id),
  ]);
  const adapter = new MarkdownAdapter(job, provider);
  const snapshot = await adapter.toSliceSnapshot({
    file: markdown,
    assets: job.assetsManager,
    workspaceId: doc.workspace.id,
    pageId: doc.id,
  });

  if (!snapshot) {
    throw new BlockSuiteError(
      BlockSuiteError.ErrorCode.ValueNotExists,
      'import markdown failed, expected to get a snapshot'
    );
  }

  const blocks = snapshot.content.flatMap(x => x.children);

  for (const block of blocks) {
    await job.snapshotToBlock(block, doc, blockId);
  }

  return;
}

/**
 * Imports Markdown content into a new doc within a collection.
 * @param options Object containing import options
 * @param options.collection The target doc collection
 * @param options.schema The schema of the target doc collection
 * @param options.markdown The Markdown content to import
 * @param options.fileName Optional filename for the imported doc
 * @returns A Promise that resolves to the ID of the newly created doc, or undefined if import fails
 */
async function importMarkdownToDoc({
  collection,
  schema,
  markdown,
  fileName,
  extensions,
}: ImportMarkdownToDocOptions) {
  const { content, meta } = parseFrontmatter(markdown);
  const preferredTitle = meta.title ?? fileName;
  const provider = getProvider(extensions);
  const job = createMarkdownImportJob({
    collection,
    schema,
    preferredTitle,
  });
  const mdAdapter = new MarkdownAdapter(job, provider);
  const page = await mdAdapter.toDoc({
    file: content,
    assets: job.assetsManager,
  });
  if (!page) {
    return;
  }
  applyMetaPatch(collection, page.id, meta);
  return page.id;
}

/**
 * Like {@link importMarkdownToDoc}, but stages named binary `assets` (a
 * path→Blob map) as workspace blobs first — so markdown media refs resolve to
 * stored blobs instead of being dropped. Mirrors the asset flow of
 * {@link importMarkdownZip} without a zip container.
 */
async function importMarkdownWithAssets({
  collection,
  schema,
  markdown,
  fileName,
  assets,
  extensions,
}: ImportMarkdownWithAssetsOptions) {
  const { content, meta } = parseFrontmatter(markdown);
  const preferredTitle = meta.title ?? fileName;
  const provider = getProvider(extensions);

  const pendingAssets: AssetMap = new Map();
  const pendingPathBlobIdMap: PathBlobIdMap = new Map();
  // Non-image assets (e.g. a captured video) don't render from a markdown image
  // ref — the image adapter always makes an image block. Store them as blobs and
  // surface each as an attachment block via an attachment footnote so it's an
  // openable file, not a broken image.
  const footnoteRefs: string[] = [];
  const footnoteDefs: string[] = [];
  for (const [path, blob] of Object.entries(assets ?? {})) {
    const name = path.split('/').pop() ?? path;
    if ((blob.type || '').startsWith('image/')) {
      await stageImportedAsset({
        pendingAssets,
        pendingPathBlobIdMap,
        path,
        content: blob,
        fileName: name,
      });
    } else {
      const file = blob instanceof File ? blob : new File([blob], name, { type: blob.type });
      const blobId = await collection.blobSync.set(file);
      const id = `ngatt${footnoteRefs.length}`;
      footnoteRefs.push(`[^${id}]`);
      footnoteDefs.push(
        `[^${id}]: ${JSON.stringify({
          type: 'attachment',
          blobId,
          fileName: name,
          fileType: blob.type || 'application/octet-stream',
        })}`
      );
    }
  }

  const finalContent = footnoteDefs.length
    ? `${content}\n\n${footnoteRefs.join(' ')}\n\n${footnoteDefs.join('\n\n')}`
    : content;

  const job = createMarkdownImportJob({ collection, schema, preferredTitle });
  bindImportedAssetsToJob(job, pendingAssets, pendingPathBlobIdMap);

  const mdAdapter = new MarkdownAdapter(job, provider);
  const page = await mdAdapter.toDoc({
    file: finalContent,
    assets: job.assetsManager,
  });
  if (!page) {
    return;
  }
  applyMetaPatch(collection, page.id, meta);
  return page.id;
}

/**
 * Imports a zip file containing Markdown files and assets into a collection.
 * @param options Object containing import options
 * @param options.collection The target doc collection
 * @param options.schema The schema of the target doc collection
 * @param options.imported The zip file as a Blob
 * @returns A Promise that resolves to an array of IDs of the newly created docs
 */
export type FolderHierarchy = {
  name: string;
  path: string;
  children: Map<string, FolderHierarchy>;
  pageId?: string;
  parentPath?: string;
};

async function importMarkdownZip({
  collection,
  schema,
  imported,
  extensions,
}: ImportMarkdownZipOptions): Promise<{
  docIds: string[];
  folderHierarchy?: FolderHierarchy;
}> {
  const provider = getProvider(extensions);
  const unzip = new Unzip();
  await unzip.load(imported);

  const docIds: string[] = [];
  const pendingAssets: AssetMap = new Map();
  const pendingPathBlobIdMap: PathBlobIdMap = new Map();
  const markdownBlobs: ImportedFileEntry[] = [];
  const docPathMap: Array<{ fullPath: string; docId: string }> = [];

  // Iterate over all files in the zip
  for (const { path, content: blob } of unzip) {
    // Skip the files that are not markdown files
    if (isSystemImportPath(path)) {
      continue;
    }

    // Get the file name
    const fileName = path.split('/').pop() ?? '';
    // If the file is a markdown file, store it to markdownBlobs
    if (fileName.endsWith('.md')) {
      markdownBlobs.push({
        filename: fileName,
        contentBlob: blob,
        fullPath: path,
      });
    } else {
      await stageImportedAsset({
        pendingAssets,
        pendingPathBlobIdMap,
        path,
        content: blob,
        fileName,
      });
    }
  }

  await Promise.all(
    markdownBlobs.map(async markdownFile => {
      const { filename, contentBlob, fullPath } = markdownFile;
      const fileNameWithoutExt = filename.replace(/\.[^/.]+$/, '');
      const markdown = await contentBlob.text();
      const { content, meta } = parseFrontmatter(markdown);
      const preferredTitle = meta.title ?? fileNameWithoutExt;
      const job = createMarkdownImportJob({
        collection,
        schema,
        preferredTitle,
        fullPath,
      });
      bindImportedAssetsToJob(job, pendingAssets, pendingPathBlobIdMap);

      const mdAdapter = new MarkdownAdapter(job, provider);
      const doc = await mdAdapter.toDoc({
        file: content,
        assets: job.assetsManager,
      });
      if (doc) {
        applyMetaPatch(collection, doc.id, meta);
        docIds.push(doc.id);
        docPathMap.push({ fullPath, docId: doc.id });
      }
    })
  );

  // Build folder hierarchy from zip paths
  const folderHierarchy = buildMarkdownZipFolderHierarchy(docPathMap);

  return { docIds, folderHierarchy };
}

/**
 * Builds a tree of {@link FolderHierarchy} nodes from the zip paths of
 * imported markdown files. Returns `undefined` when every entry sits at
 * the same level (no real subfolder structure). A common root directory
 * shared by all entries is stripped automatically so that the resulting
 * hierarchy starts one level deeper.
 */
export function buildMarkdownZipFolderHierarchy(
  entries: Array<{ fullPath: string; docId: string }>
): FolderHierarchy | undefined {
  if (entries.length === 0) return undefined;

  // Check if any entries have folder structure
  const hasSubfolders = entries.some(e => {
    const parts = e.fullPath.split('/').filter(Boolean);
    // More than just "root/file.md" -- need at least one real subfolder
    return parts.length > 2;
  });
  if (!hasSubfolders) {
    // All files are at the same level, no folder hierarchy needed
    return undefined;
  }

  const root: FolderHierarchy = {
    name: '',
    path: '',
    children: new Map(),
  };

  // Check once whether all entries share a common root directory
  const candidateRoot = entries[0]?.fullPath.split('/').find(Boolean);
  const skipRoot =
    !!candidateRoot &&
    entries.every(e => e.fullPath.startsWith(candidateRoot + '/'));

  for (const { fullPath, docId } of entries) {
    const parts = fullPath.split('/').filter(Boolean);
    const fileName = parts.pop(); // Remove filename
    if (!fileName) continue;

    let folderParts = skipRoot ? parts.slice(1) : parts;

    if (folderParts.length === 0) {
      // Root-level file, no folder needed
      continue;
    }

    let current = root;
    let currentPath = '';

    for (const folderName of folderParts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;

      if (!current.children.has(folderName)) {
        current.children.set(folderName, {
          name: folderName,
          path: currentPath,
          parentPath: parentPath || undefined,
          children: new Map(),
        });
      }
      current = current.children.get(folderName)!;
    }

    // Add the doc as a leaf
    const docNodeKey = `__doc__${docId}`;
    current.children.set(docNodeKey, {
      name: docNodeKey,
      path: `${current.path}/${docNodeKey}`,
      parentPath: current.path,
      children: new Map(),
      pageId: docId,
    });
  }

  return root.children.size > 0 ? root : undefined;
}

export const MarkdownTransformer = {
  docToMarkdown,
  exportDoc,
  importMarkdownToBlock,
  importMarkdownToDoc,
  importMarkdownWithAssets,
  importMarkdownZip,
};
