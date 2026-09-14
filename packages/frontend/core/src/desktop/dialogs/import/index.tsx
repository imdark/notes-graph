import {
  CloudWorkspaceIcon,
  ExportToHtmlIcon,
  ExportToMarkdownIcon,
  FileIcon,
  FolderIcon,
  HelpIcon,
  NotionIcon,
  PageIcon,
  SaveIcon,
  ZipIcon,
} from '@blocksuite/icons/rc';
import {
  openDirectory,
  openFilesWith,
} from '@blocksuite/notesgraph/shared/utils';
import type { Workspace } from '@blocksuite/notesgraph/store';
import {
  BearTransformer,
  DocxTransformer,
  HtmlTransformer,
  LogseqTransformer,
  MarkdownTransformer,
  NotionHtmlTransformer,
  ObsidianTransformer,
  ZipTransformer,
} from '@blocksuite/notesgraph/widgets/linked-doc';
import {
  Button,
  IconButton,
  type IconData,
  IconType,
  Modal,
} from '@notesgraph/component';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { useAsyncCallback } from '@notesgraph/core/components/hooks/notesgraph-async-hooks';
import { useNavigateHelper } from '@notesgraph/core/components/hooks/use-navigate-helper';
import { ServerService } from '@notesgraph/core/modules/cloud';
import {
  type DialogComponentProps,
  GlobalDialogService,
  type WORKSPACE_DIALOG_SCHEMA,
} from '@notesgraph/core/modules/dialogs';
import { ExplorerIconService } from '@notesgraph/core/modules/explorer-icon/services/explorer-icon';
import {
  type ImporterSpec,
  ImportRegistryService,
  type RegisteredImporter,
} from '@notesgraph/core/modules/import';
import { OrganizeService } from '@notesgraph/core/modules/organize';
import { TagService } from '@notesgraph/core/modules/tag';
import { UrlService } from '@notesgraph/core/modules/url';
import {
  getNotesGraphWorkspaceSchema,
  type WorkspaceMetadata,
  WorkspaceService,
} from '@notesgraph/core/modules/workspace';
import { DebugLogger } from '@notesgraph/debug';
import { useI18n } from '@notesgraph/i18n';
import {
  useLiveData,
  useService,
  useServiceOptional,
} from '@notesgraph/infra';
import track from '@notesgraph/track';
import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import {
  type ReactElement,
  type SVGAttributes,
  useCallback,
  useMemo,
  useState,
} from 'react';

import { importBookmarks } from './bookmark-import';
import { isKeepNote, keepNoteToMarkdown } from './google-keep-import';
import { orgToMarkdown } from './org-import';
import * as style from './styles.css';

const logger = new DebugLogger('import');

type NotionPageIcon = {
  type: 'emoji' | 'image';
  content: string; // emoji unicode or image URL/data
};

type FolderHierarchy = {
  name: string;
  path: string;
  children: Map<string, FolderHierarchy>;
  pageId?: string;
  parentPath?: string;
  icon?: NotionPageIcon;
};

// Helper function to create folder structure using OrganizeService
function createFolderStructure(
  organizeService: OrganizeService,
  hierarchy: FolderHierarchy,
  parentFolderId: string | null = null,
  explorerIconService?: ExplorerIconService
): {
  folderId: string | null;
  docLinks: Array<{ folderId: string; docId: string }>;
} {
  const docLinks: Array<{ folderId: string; docId: string }> = [];
  const rootFolder = organizeService.folderTree.rootFolder;

  function processHierarchyNode(
    node: FolderHierarchy,
    currentParentId: string | null
  ): string | null {
    let currentFolderId = currentParentId;

    // If this node represents a folder (has children but no pageId), create it
    if (node.children.size > 0 && !node.pageId && node.name) {
      const parent = currentParentId
        ? organizeService.folderTree.folderNode$(currentParentId).value
        : rootFolder;

      if (parent) {
        const index = parent.indexAt('after');
        currentFolderId = parent.createFolder(node.name, index);
      }
    }

    // Process all children
    for (const child of node.children.values()) {
      if (child.pageId) {
        // This is a document, link it to the current folder
        if (currentFolderId) {
          docLinks.push({ folderId: currentFolderId, docId: child.pageId });
        }

        // Set icon for the document if available
        if (child.icon && explorerIconService) {
          logger.debug('=== Setting icon for document ===');
          logger.debug('Document ID:', child.pageId);
          logger.debug('Icon data:', child.icon);

          try {
            let iconData: IconData | undefined;
            if (child.icon.type === 'emoji') {
              iconData = {
                type: IconType.Emoji,
                unicode: child.icon.content,
              };
              logger.debug('Created emoji icon data:', iconData);
            } else if (child.icon.type === 'image') {
              // For image icons, we'd need to handle blob conversion
              // For now, let's skip image icons or convert them to default
              // This could be enhanced later to download and convert images to blobs
              logger.debug(
                'Skipping image icon (not implemented):',
                child.icon.content
              );
              iconData = undefined;
            }

            if (iconData) {
              logger.debug('Calling explorerIconService.setIcon with:', {
                where: 'doc',
                id: child.pageId,
                icon: iconData,
              });
              explorerIconService.setIcon({
                where: 'doc',
                id: child.pageId,
                icon: iconData,
              });
              logger.debug('Icon set successfully for document:', child.pageId);
            } else {
              logger.debug('No valid icon data to set');
            }
          } catch (error) {
            logger.error(
              'Error setting icon for document:',
              child.pageId,
              error
            );
            logger.warn(
              'Failed to set icon for document:',
              child.pageId,
              error
            );
          }
        } else {
          if (!child.icon) {
            logger.debug('No icon found for document:', child.pageId);
          }
          if (!explorerIconService) {
            logger.debug(
              'ExplorerIconService not available for document:',
              child.pageId
            );
          }
        }
      } else if (child.children.size > 0) {
        // This is a subfolder, process it recursively
        processHierarchyNode(child, currentFolderId);
      }
    }

    return currentFolderId;
  }

  const rootFolderId = processHierarchyNode(hierarchy, parentFolderId);
  return { folderId: rootFolderId, docLinks };
}

/**
 * Creates the folder tree described by {@link folderHierarchy} via
 * {@link OrganizeService} and links every document into its folder.
 * Returns the root folder ID on success, or `undefined` if the
 * hierarchy is empty or an error occurs.
 *
 * When {@link explorerIconService} is provided, document icons from the
 * hierarchy (e.g. Notion page emojis) are applied. Callers that do not
 * need icon support can omit it safely.
 */
function applyFolderHierarchy(
  organizeService: OrganizeService,
  folderHierarchy: FolderHierarchy,
  explorerIconService?: ExplorerIconService
): string | undefined {
  if (folderHierarchy.children.size === 0) return undefined;
  try {
    const { folderId, docLinks } = createFolderStructure(
      organizeService,
      folderHierarchy,
      null,
      explorerIconService
    );
    for (const { folderId, docId } of docLinks) {
      const folder = organizeService.folderTree.folderNode$(folderId).value;
      if (folder) {
        const index = folder.indexAt('after');
        folder.createLink('doc', docId, index);
      }
    }
    return folderId || undefined;
  } catch (error) {
    logger.warn('Failed to create folder structure:', error);
    return undefined;
  }
}

type ImportType =
  | 'markdown'
  | 'markdownZip'
  | 'localFolder'
  | 'googleKeep'
  | 'orgzly'
  | 'notion'
  | 'obsidian'
  | 'logseq'
  | 'bear'
  | 'snapshot'
  | 'html'
  | 'bookmarks'
  | 'docx'
  | 'dotnotesgraphfile';
type AcceptType = 'Markdown' | 'Zip' | 'Html' | 'Docx' | 'Directory' | 'Skip'; // Skip is used for dotnotesgraphfile
type Status = 'idle' | 'importing' | 'success' | 'error';
type ImportResult = {
  docIds: string[];
  entryId?: string;
  isWorkspaceFile?: boolean;
  rootFolderId?: string;
  importedWorkspace?: WorkspaceMetadata;
};

type ImportedWorkspacePayload = {
  workspace: WorkspaceMetadata;
};

type ImportConfig = {
  fileOptions: { acceptType: AcceptType; multiple: boolean };
  importFunction: (
    docCollection: Workspace,
    files: File[],
    handleImportNotesGraphFile: () => Promise<WorkspaceMetadata | undefined>,
    organizeService?: OrganizeService,
    explorerIconService?: ExplorerIconService,
    tagService?: TagService
  ) => Promise<ImportResult>;
};

const importOptions = [
  {
    key: 'markdown',
    label: 'com.notesgraph.import.markdown-files',
    prefixIcon: (
      <ExportToMarkdownIcon
        color={cssVarV2('icon/primary')}
        width={20}
        height={20}
      />
    ),
    testId: 'editor-option-menu-import-markdown-files',
    type: 'markdown' as ImportType,
  },
  {
    key: 'markdownZip',
    label: 'com.notesgraph.import.markdown-with-media-files',
    prefixIcon: (
      <ZipIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.markdown-with-media-files.tooltip',
    testId: 'editor-option-menu-import-markdown-with-media',
    type: 'markdownZip' as ImportType,
  },
  {
    key: 'localFolder',
    label: 'com.notesgraph.import.local-folder',
    prefixIcon: (
      <FolderIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    testId: 'editor-option-menu-import-local-folder',
    type: 'localFolder' as ImportType,
  },
  {
    key: 'googleKeep',
    label: 'com.notesgraph.import.google-keep',
    prefixIcon: (
      <FileIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.google-keep.tooltip',
    testId: 'editor-option-menu-import-google-keep',
    type: 'googleKeep' as ImportType,
  },
  {
    key: 'orgzly',
    label: 'com.notesgraph.import.orgzly',
    prefixIcon: (
      <FileIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.orgzly.tooltip',
    testId: 'editor-option-menu-import-orgzly',
    type: 'orgzly' as ImportType,
  },
  {
    key: 'html',
    label: 'com.notesgraph.import.html-files',
    prefixIcon: (
      <ExportToHtmlIcon
        color={cssVarV2('icon/primary')}
        width={20}
        height={20}
      />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.html-files.tooltip',
    testId: 'editor-option-menu-import-html',
    type: 'html' as ImportType,
  },
  {
    key: 'bookmarks',
    label: 'com.notesgraph.import.bookmarks',
    prefixIcon: (
      <FileIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.bookmarks.tooltip',
    testId: 'editor-option-menu-import-bookmarks',
    type: 'bookmarks' as ImportType,
  },
  {
    key: 'notion',
    label: 'com.notesgraph.import.notion',
    prefixIcon: <NotionIcon color={cssVar('black')} width={20} height={20} />,
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.notion.tooltip',
    testId: 'editor-option-menu-import-notion',
    type: 'notion' as ImportType,
  },
  {
    key: 'obsidian',
    label: 'com.notesgraph.import.obsidian',
    prefixIcon: (
      <ExportToMarkdownIcon color={cssVar('black')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.obsidian.tooltip',
    testId: 'editor-option-menu-import-obsidian',
    type: 'obsidian' as ImportType,
  },
  {
    key: 'logseq',
    label: 'com.notesgraph.import.logseq',
    prefixIcon: (
      <ExportToMarkdownIcon color={cssVar('black')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.logseq.tooltip',
    testId: 'editor-option-menu-import-logseq',
    type: 'logseq' as ImportType,
  },
  {
    key: 'bear',
    label: 'com.notesgraph.import.bear',
    prefixIcon: (
      <FileIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.bear.tooltip',
    testId: 'editor-option-menu-import-bear',
    type: 'bear' as ImportType,
  },
  {
    key: 'docx',
    label: 'com.notesgraph.import.docx',
    prefixIcon: <FileIcon color={cssVar('black')} width={20} height={20} />,
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.docx.tooltip',
    testId: 'editor-option-menu-import-docx',
    type: 'docx' as ImportType,
  },
  {
    key: 'snapshot',
    label: 'com.notesgraph.import.snapshot',
    prefixIcon: (
      <PageIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixIcon: (
      <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
    ),
    suffixTooltip: 'com.notesgraph.import.snapshot.tooltip',
    testId: 'editor-option-menu-import-snapshot',
    type: 'snapshot' as ImportType,
  },
  BUILD_CONFIG.isElectron
    ? {
        key: 'dotnotesgraphfile',
        label: 'com.notesgraph.import.dotnotesgraphfile',
        prefixIcon: (
          <SaveIcon color={cssVarV2('icon/primary')} width={20} height={20} />
        ),
        suffixIcon: (
          <HelpIcon color={cssVarV2('icon/primary')} width={20} height={20} />
        ),
        suffixTooltip: 'com.notesgraph.import.dotnotesgraphfile.tooltip',
        testId: 'editor-option-menu-import-dotnotesgraphfile',
        type: 'dotnotesgraphfile' as ImportType,
      }
    : null,
].filter(v => v !== null);

/**
 * Import types with an unambiguous single file extension, safe to offer a
 * "pick from cloud" alternative for. Zip-based types (markdownZip, notion,
 * bear, snapshot) are deliberately excluded — a cloud-picked `.zip` can't be
 * disambiguated between those formats the way a local picker's caller-chosen
 * option already can.
 */
const CLOUD_IMPORT_ACCEPT: Partial<Record<ImportType, string>> = {
  markdown: '.md,.markdown',
  html: '.html,.htm',
  docx: '.docx',
};

// Build an Organize folder tree from picked local files' relative paths. Unlike
// the zip importer, we KEEP the picked root directory so it becomes a real
// folder containing the imported notes (that's the point of "add a local
// folder"). Each `__doc__<id>` leaf carries its pageId for applyFolderHierarchy.
function buildLocalFolderHierarchy(
  entries: Array<{ fullPath: string; docId: string }>
): FolderHierarchy | undefined {
  const root: FolderHierarchy = { name: '', path: '', children: new Map() };
  for (const { fullPath, docId } of entries) {
    const parts = fullPath.split('/').filter(Boolean);
    parts.pop(); // drop the file name
    if (parts.length === 0) continue; // no folder info (fallback name only)
    let current = root;
    let currentPath = '';
    for (const folderName of parts) {
      const parentPath = currentPath;
      currentPath = currentPath ? `${currentPath}/${folderName}` : folderName;
      let next = current.children.get(folderName);
      if (!next) {
        next = {
          name: folderName,
          path: currentPath,
          parentPath: parentPath || undefined,
          children: new Map(),
        };
        current.children.set(folderName, next);
      }
      current = next;
    }
    const key = `__doc__${docId}`;
    current.children.set(key, {
      name: key,
      path: `${current.path}/${key}`,
      parentPath: current.path,
      children: new Map(),
      pageId: docId,
    });
  }
  return root.children.size > 0 ? root : undefined;
}

/**
 * Create (or reuse) a NotesGraph tag per Keep label and assign it to every doc
 * that carried that label. Case-insensitive dedup against existing tags; the
 * first occurrence's casing is kept for a newly created tag.
 */
function assignLabelsAsTags(
  tagService: TagService | undefined,
  docCollection: Workspace,
  labelToDocs: Map<string, Set<string>>
): void {
  if (!tagService || labelToDocs.size === 0) return;
  try {
    const existing = new Map<string, string>(); // lowercase name → tag id
    for (const tag of tagService.tagList.tags$.value) {
      existing.set(tag.value$.value.toLowerCase(), tag.id);
    }
    for (const [label, docIdSet] of labelToDocs) {
      const key = label.toLowerCase();
      let tagId = existing.get(key);
      if (!tagId) {
        const newTag = tagService.tagList.createTag(
          label,
          tagService.randomTagColor()
        );
        tagId = newTag.id;
        existing.set(key, tagId);
      }
      for (const docId of docIdSet) {
        const doc = docCollection.getDoc(docId);
        const currentTags = doc?.meta?.tags ?? [];
        if (!currentTags.includes(tagId)) {
          docCollection.meta.setDocMeta(docId, {
            tags: [...currentTags, tagId],
          });
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to assign Keep labels as tags:', error);
  }
}

const importConfigs: Record<ImportType, ImportConfig> = {
  markdown: {
    fileOptions: { acceptType: 'Markdown', multiple: true },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      _organizeService,
      _explorerIconService
    ) => {
      const docIds: string[] = [];
      for (const file of files) {
        const text = await file.text();
        const fileName = file.name.split('.').slice(0, -1).join('.');
        const docId = await MarkdownTransformer.importMarkdownToDoc({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          markdown: text,
          fileName,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        if (docId) docIds.push(docId);
      }
      return {
        docIds,
      };
    },
  },
  markdownZip: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      _explorerIconService
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for markdownZip import');
      }
      const { docIds, folderHierarchy } =
        await MarkdownTransformer.importMarkdownZip({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          imported: file,
          extensions: getStoreManager().config.init().value.get('store'),
        });

      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(organizeService, folderHierarchy)
          : undefined;

      return {
        docIds,
        rootFolderId,
      };
    },
  },
  localFolder: {
    fileOptions: { acceptType: 'Directory', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      _explorerIconService
    ) => {
      // Import every markdown file in the picked folder as a note, preserving
      // the folder structure under a matching Organize folder. (Web + Electron
      // via showDirectoryPicker; assets/wikilinks are a follow-up.)
      const docIds: string[] = [];
      const entries: Array<{ fullPath: string; docId: string }> = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.md')) continue;
        const text = await file.text();
        const fileName = file.name.replace(/\.[^/.]+$/, '');
        const docId = await MarkdownTransformer.importMarkdownToDoc({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          markdown: text,
          fileName,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        if (docId) {
          docIds.push(docId);
          const fullPath =
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || file.name;
          entries.push({ fullPath, docId });
        }
      }

      const folderHierarchy = buildLocalFolderHierarchy(entries);
      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(organizeService, folderHierarchy)
          : undefined;

      return { docIds, rootFolderId };
    },
  },
  orgzly: {
    fileOptions: { acceptType: 'Directory', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      _explorerIconService
    ) => {
      // Orgzly syncs a folder of .org notebooks. Import each as a note (its
      // org outline → markdown headings/checkboxes), preserving folder layout.
      const docIds: string[] = [];
      const entries: Array<{ fullPath: string; docId: string }> = [];
      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.org')) continue;
        const fileName = file.name.replace(/\.[^/.]+$/, '');
        const { title, markdown } = orgToMarkdown(await file.text(), fileName);
        const docId = await MarkdownTransformer.importMarkdownToDoc({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          markdown,
          fileName: title,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        if (docId) {
          docIds.push(docId);
          const fullPath =
            (file as File & { webkitRelativePath?: string })
              .webkitRelativePath || file.name;
          entries.push({ fullPath, docId });
        }
      }

      const folderHierarchy = buildLocalFolderHierarchy(entries);
      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(organizeService, folderHierarchy)
          : undefined;

      return { docIds, rootFolderId };
    },
  },
  googleKeep: {
    fileOptions: { acceptType: 'Directory', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      _organizeService,
      _explorerIconService,
      tagService
    ) => {
      // A Google Keep Takeout export is a folder of one .json per note (plus
      // .html renders + attachment blobs). Import each note's json as a doc;
      // map Keep labels → NotesGraph tags. Trashed notes are skipped.
      const docIds: string[] = [];
      const labelToDocs = new Map<string, Set<string>>();

      for (const file of files) {
        if (!file.name.toLowerCase().endsWith('.json')) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(await file.text());
        } catch {
          continue; // not valid json — skip
        }
        if (!isKeepNote(parsed)) continue;

        const note = keepNoteToMarkdown(parsed);
        if (note.isTrashed) continue;

        const docId = await MarkdownTransformer.importMarkdownToDoc({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          markdown: note.markdown || note.title,
          fileName: note.title,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        if (!docId) continue;
        docIds.push(docId);
        for (const label of note.labels) {
          const set = labelToDocs.get(label) ?? new Set<string>();
          set.add(docId);
          labelToDocs.set(label, set);
        }
      }

      assignLabelsAsTags(tagService, docCollection, labelToDocs);
      return { docIds };
    },
  },
  bookmarks: {
    fileOptions: { acceptType: 'Html', multiple: false },
    importFunction: async (docCollection, files) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single bookmarks .html file');
      }
      const { docIds, entryId } = await importBookmarks(
        docCollection,
        await file.text()
      );
      return { docIds, entryId };
    },
  },
  html: {
    fileOptions: { acceptType: 'Html', multiple: true },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      _organizeService,
      _explorerIconService
    ) => {
      const docIds: string[] = [];
      for (const file of files) {
        const text = await file.text();
        const fileName = file.name.split('.').slice(0, -1).join('.');
        const docId = await HtmlTransformer.importHTMLToDoc({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          extensions: getStoreManager().config.init().value.get('store'),
          html: text,
          fileName,
        });
        if (docId) docIds.push(docId);
      }
      return {
        docIds,
      };
    },
  },
  notion: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      explorerIconService
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for notion import');
      }
      const { entryId, pageIds, isWorkspaceFile, folderHierarchy } =
        await NotionHtmlTransformer.importNotionZip({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          imported: file,
          extensions: getStoreManager().config.init().value.get('store'),
        });

      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(
              organizeService,
              folderHierarchy,
              explorerIconService
            )
          : undefined;

      return {
        docIds: pageIds,
        entryId,
        isWorkspaceFile,
        rootFolderId,
      };
    },
  },
  obsidian: {
    fileOptions: { acceptType: 'Directory', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      _organizeService,
      explorerIconService
    ) => {
      const { docIds, docEmojis } =
        await ObsidianTransformer.importObsidianVault({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          importedFiles: files,
          extensions: getStoreManager().config.init().value.get('store'),
        });

      if (explorerIconService) {
        for (const [id, emoji] of docEmojis.entries()) {
          explorerIconService.setIcon({
            where: 'doc',
            id,
            icon: { type: IconType.Emoji, unicode: emoji },
          });
        }
      }

      return { docIds };
    },
  },
  logseq: {
    fileOptions: { acceptType: 'Directory', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      _explorerIconService
    ) => {
      const { docIds, folderHierarchy } =
        await LogseqTransformer.importLogseqGraph({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          importedFiles: files,
          extensions: getStoreManager().config.init().value.get('store'),
        });

      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(organizeService, folderHierarchy)
          : undefined;

      return { docIds, rootFolderId };
    },
  },
  bear: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      organizeService,
      _explorerIconService,
      tagService
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single .bear2bk file for Bear import');
      }
      let docIds: string[];
      let tags: Map<string, string[]>;
      let folderHierarchy: FolderHierarchy;
      try {
        const result = await BearTransformer.importBearBackup({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          imported: file,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        docIds = result.docIds;
        tags = result.tags;
        folderHierarchy = result.folderHierarchy;
      } catch (err) {
        logger.error('Bear import failed:', err);
        throw err instanceof Error
          ? err
          : new Error(String(err) || 'Bear import failed');
      }

      // Create NotesGraph tags from Bear tags
      if (tagService && tags.size > 0) {
        try {
          // Get existing tags for deduplication
          const existingTags = tagService.tagList.tags$.value;
          const existingTagMap = new Map<string, string>(); // lowercase name → tag id
          for (const tag of existingTags) {
            const name = tag.value$.value.toLowerCase();
            existingTagMap.set(name, tag.id);
          }

          // Consolidate tags by root segment (e.g., "privat/bike" → "privat").
          // Keyed by lowercase root for case-insensitive dedup, but the
          // original capitalization of the first occurrence is preserved
          // so new NotesGraph tags are created with the user's casing.
          const rootTagDocMap = new Map<
            string,
            { displayName: string; docs: Set<string> }
          >();
          for (const [tagName, tagDocIds] of tags) {
            const originalRoot = tagName.split('/')[0];
            const key = originalRoot.toLowerCase();
            let entry = rootTagDocMap.get(key);
            if (!entry) {
              entry = { displayName: originalRoot, docs: new Set<string>() };
              rootTagDocMap.set(key, entry);
            }
            for (const docId of tagDocIds) {
              entry.docs.add(docId);
            }
          }

          for (const [
            rootTagKey,
            { displayName, docs: docIdSet },
          ] of rootTagDocMap) {
            // Check if tag already exists (case-insensitive)
            let tagId = existingTagMap.get(rootTagKey);
            if (!tagId) {
              const newTag = tagService.tagList.createTag(
                displayName,
                tagService.randomTagColor()
              );
              tagId = newTag.id;
              existingTagMap.set(rootTagKey, tagId);
            }

            // Assign tag to each doc
            for (const docId of docIdSet) {
              const doc = docCollection.getDoc(docId);
              const currentTags = doc?.meta?.tags ?? [];
              if (!currentTags.includes(tagId)) {
                docCollection.meta.setDocMeta(docId, {
                  tags: [...currentTags, tagId],
                });
              }
            }
          }
        } catch (error) {
          logger.warn('Failed to create Bear tags:', error);
        }
      }

      const rootFolderId =
        folderHierarchy && organizeService
          ? applyFolderHierarchy(organizeService, folderHierarchy)
          : undefined;

      return {
        docIds,
        rootFolderId,
      };
    },
  },
  docx: {
    fileOptions: { acceptType: 'Docx', multiple: false },
    importFunction: async (docCollection, file) => {
      const files = Array.isArray(file) ? file : [file];
      const docIds: string[] = [];
      for (const file of files) {
        const docId = await DocxTransformer.importDocx({
          collection: docCollection,
          schema: getNotesGraphWorkspaceSchema(),
          imported: file,
          extensions: getStoreManager().config.init().value.get('store'),
        });
        if (docId) docIds.push(docId);
      }
      return { docIds };
    },
  },
  snapshot: {
    fileOptions: { acceptType: 'Zip', multiple: false },
    importFunction: async (
      docCollection,
      files,
      _handleImportNotesGraphFile,
      _organizeService,
      _explorerIconService
    ) => {
      const file = files.length === 1 ? files[0] : null;
      if (!file) {
        throw new Error('Expected a single zip file for snapshot import');
      }
      const docIds = (
        await ZipTransformer.importDocs(
          docCollection,
          getNotesGraphWorkspaceSchema(),
          file
        )
      )
        .filter((doc): doc is NonNullable<typeof doc> => doc !== undefined)
        .map(doc => doc.id);

      return {
        docIds,
      };
    },
  },
  dotnotesgraphfile: {
    fileOptions: { acceptType: 'Skip', multiple: false },
    importFunction: async (
      _,
      __,
      handleImportNotesGraphFile,
      _organizeService,
      _explorerIconService
    ) => {
      const workspace = await handleImportNotesGraphFile();
      return {
        docIds: [],
        entryId: undefined,
        isWorkspaceFile: true,
        importedWorkspace: workspace,
      };
    },
  },
};

/** Open a file picker honoring a registered importer's `accept`/`multiple`. */
function pickFiles(accept?: string, multiple = false): Promise<File[]> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      input.remove();
      resolve(files);
    });
    document.body.append(input);
    input.click();
  });
}

const ImportOptionItem = ({
  label,
  prefixIcon,
  suffixIcon,
  suffixTooltip,
  type,
  onImport,
  onImportFromCloud,
  ...props
}: {
  label: string;
  prefixIcon: ReactElement<SVGAttributes<SVGElement>>;
  suffixIcon?: ReactElement<SVGAttributes<SVGElement>>;
  suffixTooltip?: string;
  type: ImportType;
  onImport: (type: ImportType) => void;
  onImportFromCloud?: (type: ImportType) => void;
}) => {
  const t = useI18n();
  return (
    <div className={style.importItem} onClick={() => onImport(type)} {...props}>
      {prefixIcon}
      <div className={style.importItemLabel}>{t[label]()}</div>
      {onImportFromCloud && (
        <IconButton
          className={style.importItemSuffix}
          icon={<CloudWorkspaceIcon />}
          tooltip={t['com.notesgraph.import.from-cloud']()}
          onClick={event => {
            event.stopPropagation();
            onImportFromCloud(type);
          }}
        />
      )}
      {suffixIcon && (
        <IconButton
          className={style.importItemSuffix}
          icon={suffixIcon}
          tooltip={suffixTooltip ? t[suffixTooltip]() : undefined}
        />
      )}
    </div>
  );
};

const ImportOptions = ({
  onImport,
  onImportFromCloud,
  importers,
  onRegisteredImport,
}: {
  onImport: (type: ImportType) => void;
  onImportFromCloud?: (type: ImportType) => void;
  importers: RegisteredImporter[];
  onRegisteredImport: (spec: ImporterSpec) => void;
}) => {
  const t = useI18n();

  return (
    <>
      <div className={style.importModalTitle}>{t['Import']()}</div>
      <div className={style.importModalContent}>
        {importOptions.map(
          ({
            key,
            label,
            prefixIcon,
            suffixIcon,
            suffixTooltip,
            testId,
            type,
          }) => (
            <ImportOptionItem
              key={key}
              prefixIcon={prefixIcon}
              suffixIcon={suffixIcon}
              suffixTooltip={suffixTooltip}
              label={label}
              type={type}
              onImport={onImport}
              onImportFromCloud={
                onImportFromCloud && CLOUD_IMPORT_ACCEPT[type]
                  ? onImportFromCloud
                  : undefined
              }
              data-testid={testId}
            />
          )
        )}
        {importers.map(({ owner, spec }) => (
          <div
            key={`${owner}:${spec.id}`}
            className={style.importItem}
            onClick={() => onRegisteredImport(spec)}
            data-testid={`import-${spec.id}`}
          >
            {spec.icon ?? (
              <PageIcon
                color={cssVarV2('icon/primary')}
                width={20}
                height={20}
              />
            )}
            <div className={style.importItemLabel}>{spec.label}</div>
          </div>
        ))}
      </div>
      <div className={style.importModalTip}>
        {t['com.notesgraph.import.modal.tip']()}{' '}
        <a
          className={style.link}
          href={BUILD_CONFIG.discordUrl}
          target="_blank"
          rel="noreferrer"
        >
          Discord
        </a>
        .
      </div>
    </>
  );
};

const ImportingStatus = () => {
  const t = useI18n();
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.notesgraph.import.status.importing.title']()}
      </div>
      <p className={style.importStatusContent}>
        {t['com.notesgraph.import.status.importing.message']()}
      </p>
    </>
  );
};

const SuccessStatus = ({ onComplete }: { onComplete: () => void }) => {
  const t = useI18n();
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.notesgraph.import.status.success.title']()}
      </div>
      <p className={style.importStatusContent}>
        {t['com.notesgraph.import.status.success.message']()}{' '}
        <a
          className={style.link}
          href={BUILD_CONFIG.discordUrl}
          target="_blank"
          rel="noreferrer"
        >
          Discord
        </a>
        .
      </p>
      <div className={style.importModalButtonContainer}>
        <Button onClick={onComplete} variant="primary">
          {t['Complete']()}
        </Button>
      </div>
    </>
  );
};

const ErrorStatus = ({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) => {
  const t = useI18n();
  const urlService = useService(UrlService);
  return (
    <>
      <div className={style.importModalTitle}>
        {t['com.notesgraph.import.status.failed.title']()}
      </div>
      <p className={style.importStatusContent}>
        {error || 'Unknown error occurred'}
      </p>
      <div className={style.importModalButtonContainer}>
        <Button
          onClick={() => {
            urlService.openPopupWindow(BUILD_CONFIG.discordUrl);
          }}
          variant="secondary"
        >
          {t['Feedback']()}
        </Button>
        <Button onClick={onRetry} variant="primary">
          {t['Retry']()}
        </Button>
      </div>
    </>
  );
};

/**
 * Shown before a directory-based import (Logseq / Obsidian) opens the native
 * folder picker, so the user knows which folder to choose. Reuses the import
 * option's label + tooltip as the title and instructions.
 */
const DirectoryImportGuide = ({
  option,
  onBack,
  onSelect,
}: {
  option: { label?: string; suffixTooltip?: string };
  onBack: () => void;
  onSelect: () => void;
}) => {
  const t = useI18n();
  return (
    <>
      <div className={style.importModalTitle}>
        {option.label ? t[option.label]() : t['Import']()}
      </div>
      <p className={style.importStatusContent}>
        {option.suffixTooltip ? t[option.suffixTooltip]() : ''}
      </p>
      <div className={style.importModalButtonContainer}>
        <Button onClick={onBack} variant="secondary">
          Back
        </Button>
        <Button
          onClick={onSelect}
          variant="primary"
          data-testid="select-folder"
        >
          Select folder
        </Button>
      </div>
    </>
  );
};

export const ImportDialog = ({
  close,
}: DialogComponentProps<WORKSPACE_DIALOG_SCHEMA['import']>) => {
  const t = useI18n();
  const [status, setStatus] = useState<Status>('idle');
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [directoryPromptType, setDirectoryPromptType] =
    useState<ImportType | null>(null);
  const workspace = useService(WorkspaceService).workspace;
  const docCollection = workspace.docCollection;
  const importRegistry = useService(ImportRegistryService);
  const importers = useLiveData(importRegistry.importers$);
  const organizeService = useService(OrganizeService);
  const explorerIconService = useService(ExplorerIconService);
  const tagService = useService(TagService);

  const globalDialogService = useService(GlobalDialogService);
  const serverService = useServiceOptional(ServerService);
  const companionUrl = useLiveData(
    useMemo(
      () =>
        serverService?.server.config$.map(config => config?.companionUrl) ??
        null,
      [serverService]
    )
  );

  const { jumpToPage } = useNavigateHelper();
  const handleCreatedWorkspace = useCallback(
    (payload: { metadata: WorkspaceMetadata; defaultDocId?: string }) => {
      if (document.startViewTransition) {
        document.startViewTransition(() => {
          if (payload.defaultDocId) {
            jumpToPage(payload.metadata.id, payload.defaultDocId);
          } else {
            jumpToPage(payload.metadata.id, 'all');
          }
          return new Promise(resolve =>
            setTimeout(resolve, 150)
          ); /* start transition after 150ms */
        });
      } else {
        if (payload.defaultDocId) {
          jumpToPage(payload.metadata.id, payload.defaultDocId);
        } else {
          jumpToPage(payload.metadata.id, 'all');
        }
      }
    },
    [jumpToPage]
  );

  const handleImportNotesGraphFile = useMemo(() => {
    return async () => {
      track.$.navigationPanel.workspaceList.createWorkspace({
        control: 'import',
      });

      return new Promise<WorkspaceMetadata | undefined>((resolve, reject) => {
        globalDialogService.open(
          'import-workspace',
          undefined,
          (payload?: ImportedWorkspacePayload) => {
            if (payload) {
              resolve(payload.workspace);
            } else {
              reject(new Error('No workspace imported'));
            }
          }
        );
      });
    };
  }, [globalDialogService]);

  const handleImport = useAsyncCallback(
    async (type: ImportType, filesOverride?: File[]) => {
      setImportError(null);
      try {
        const importConfig = importConfigs[type];
        const { acceptType, multiple } = importConfig.fileOptions;

        const files = filesOverride
          ? filesOverride
          : acceptType === 'Skip'
            ? []
            : acceptType === 'Directory'
              ? await openDirectory()
              : await openFilesWith(acceptType, multiple);

        if (!files || (files.length === 0 && acceptType !== 'Skip')) {
          throw new Error(
            t['com.notesgraph.import.status.failed.message.no-file-selected']()
          );
        }

        if (acceptType !== 'Skip') {
          setStatus('importing');
          track.$.importModal.$.import({
            type,
            status: 'importing',
          });
        }

        const {
          docIds,
          entryId,
          isWorkspaceFile,
          rootFolderId,
          importedWorkspace,
        } = await importConfig.importFunction(
          docCollection,
          files,
          handleImportNotesGraphFile,
          organizeService,
          explorerIconService,
          tagService
        );

        setImportResult({
          docIds,
          entryId,
          isWorkspaceFile,
          rootFolderId,
          importedWorkspace,
        });
        setStatus('success');
        track.$.importModal.$.import({
          type,
          status: 'success',
          result: {
            docCount: docIds.length,
          },
        });
        track.$.importModal.$.createDoc({
          control: 'import',
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        setImportError(errorMessage);
        setStatus('error');
        track.$.importModal.$.import({
          type,
          status: 'failed',
          error: errorMessage || undefined,
        });
        logger.error('Failed to import', error);
      }
    },
    [
      docCollection,
      explorerIconService,
      handleImportNotesGraphFile,
      organizeService,
      tagService,
      t,
    ]
  );

  const handleImportClick = useCallback(
    (type: ImportType) => {
      // Directory imports (Logseq/Obsidian) need a specific folder, so show an
      // instruction screen before opening the native folder picker.
      if (importConfigs[type].fileOptions.acceptType === 'Directory') {
        setDirectoryPromptType(type);
      } else {
        handleImport(type);
      }
    },
    [handleImport]
  );

  const handleImportFromCloud = useCallback(
    (type: ImportType) => {
      const accept = CLOUD_IMPORT_ACCEPT[type];
      if (!serverService || !accept) {
        return;
      }
      const { multiple } = importConfigs[type].fileOptions;
      globalDialogService.open(
        'uppy-upload',
        {
          serverBaseUrl: serverService.server.baseUrl,
          companionUrl,
          accept,
          multiple,
        },
        files => {
          if (files?.length) {
            handleImport(type, files);
          }
        }
      );
    },
    [companionUrl, globalDialogService, handleImport, serverService]
  );

  const handleRegisteredImport = useAsyncCallback(
    async (spec: ImporterSpec) => {
      setImportError(null);
      try {
        const files = await pickFiles(spec.accept, spec.multiple);
        if (files.length === 0) {
          throw new Error(
            t['com.notesgraph.import.status.failed.message.no-file-selected']()
          );
        }
        setStatus('importing');
        const result = await spec.run(files);
        const docIds = result?.docIds ?? [];
        setImportResult({ docIds, entryId: docIds[0] });
        setStatus('success');
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        setImportError(errorMessage);
        setStatus('error');
        logger.error('Failed to import', error);
      }
    },
    [t]
  );

  const finishImport = useCallback(() => {
    if (importResult?.importedWorkspace) {
      handleCreatedWorkspace({ metadata: importResult.importedWorkspace });
    }
    if (!importResult) {
      close();
      return;
    }
    const { importedWorkspace: _workspace, ...result } = importResult;
    close(result);
  }, [close, handleCreatedWorkspace, importResult]);

  const handleComplete = useCallback(() => {
    finishImport();
  }, [finishImport]);

  const handleRetry = () => {
    setStatus('idle');
  };

  const statusComponents = {
    idle: (
      <ImportOptions
        onImport={handleImportClick}
        onImportFromCloud={companionUrl ? handleImportFromCloud : undefined}
        importers={importers}
        onRegisteredImport={handleRegisteredImport}
      />
    ),
    importing: <ImportingStatus />,
    success: <SuccessStatus onComplete={handleComplete} />,
    error: <ErrorStatus error={importError} onRetry={handleRetry} />,
  };

  return (
    <Modal
      open
      onOpenChange={(open: boolean) => {
        if (!open) {
          finishImport();
        }
      }}
      width={480}
      contentOptions={{
        ['data-testid' as string]: 'import-modal',
        style: {
          maxHeight: '85vh',
          maxWidth: '70vw',
          minHeight: '126px',
          padding: 0,
          overflow: 'hidden',
          display: 'flex',
          background: cssVarV2('layer/background/primary'),
        },
      }}
      closeButtonOptions={{
        className: style.closeButton,
      }}
      withoutCloseButton={status === 'importing'}
      persistent={status === 'importing'}
    >
      <div className={style.importModalContainer} data-testid="import-dialog">
        {status === 'idle' && directoryPromptType ? (
          <DirectoryImportGuide
            option={
              importOptions.find(o => o.type === directoryPromptType) ?? {}
            }
            onBack={() => setDirectoryPromptType(null)}
            onSelect={() => {
              setDirectoryPromptType(null);
              handleImport(directoryPromptType);
            }}
          />
        ) : (
          statusComponents[status]
        )}
      </div>
    </Modal>
  );
};
