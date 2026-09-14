import { Container } from '@blocksuite/notesgraph/global/di';
import type {
  AttachmentBlockModel,
  BookmarkBlockModel,
  EmbedBlockModel,
  ImageBlockModel,
  TableBlockModel,
} from '@blocksuite/notesgraph/model';
import { NotesGraphSchemas } from '@blocksuite/notesgraph/schemas';
import { MarkdownAdapter } from '@blocksuite/notesgraph/shared/adapters';
import type { NotesGraphTextAttributes } from '@blocksuite/notesgraph/shared/types';
import {
  findOrgTimestamps,
  orgStatusLabel,
  type OrgPlanningKeyword,
  parseOrgStatusPrefix,
  parseOrgTimestamp,
} from '@blocksuite/notesgraph/shared/utils';
import {
  createYProxy,
  type DeltaInsert,
  type DraftModel,
  Schema,
  Transformer,
  type TransformerMiddleware,
  type YBlock,
} from '@blocksuite/notesgraph/store';
import { uniqBy } from 'lodash-es';
import {
  Array as YArray,
  type Doc as YDoc,
  Map as YMap,
  Text as YText,
} from 'yjs';

import { getStoreManager } from './bs-store';

const blocksuiteSchema = new Schema();
blocksuiteSchema.register([...NotesGraphSchemas]);

export interface BlockDocumentInfo {
  docId: string;
  blockId: string;
  content?: string | string[];
  flavour: string;
  blob?: string[];
  refDocId?: string[];
  ref?: string[];
  parentFlavour?: string;
  parentBlockId?: string;
  /** for `notesgraph:list` todo items: 'todo' (unchecked) | 'done' (checked) */
  todoStatus?: string;
  /** breadcrumb of ancestor block text for a nested todo */
  todoTrail?: string;
  /** inline #hashtags extracted from the block's text, lowercase-normalized */
  tags?: string[];
  /**
   * arbitrary inline properties as encoded `key:value` tokens (from
   * `#key:value` in the text), exact-match filterable like tags
   */
  props?: string[];
  /**
   * full org-mode status for list items, kebab-cased: 'todo' | 'in-progress'
   * | 'done' | a custom keyword. Richer than todoStatus (which stays binary
   * checkbox semantics for existing consumers): parsed from the org
   * annotation in the item's text/chip, falling back to native checkbox
   * state.
   */
  orgStatus?: string;
  /** block creation time (meta:createdAt), ISO-8601 */
  createdAt?: string;
  /** org SCHEDULED: planned start, ISO-8601 */
  scheduledAt?: string;
  /** org DEADLINE: planned end, ISO-8601 */
  deadlineAt?: string;
  /** org STARTED: actual start, ISO-8601 */
  startedAt?: string;
  /** org CLOSED: completion, ISO-8601 */
  closedAt?: string;
  additional?: {
    databaseName?: string;
    displayMode?: string;
    noteBlockId?: string;
  };
  yblock: YMap<any>;
  markdownPreview?: string;
}

const bookmarkFlavours = new Set([
  'notesgraph:bookmark',
  'notesgraph:embed-youtube',
  'notesgraph:embed-figma',
  'notesgraph:embed-github',
  'notesgraph:embed-loom',
]);

const collectInlineReferences = (
  deltas: DeltaInsert<NotesGraphTextAttributes>[]
): { refDocId: string; ref: string }[] =>
  uniqBy(
    deltas
      .flatMap(delta => {
        if (
          delta.attributes &&
          delta.attributes.reference &&
          delta.attributes.reference.pageId
        ) {
          const { pageId: refDocId, params = {} } = delta.attributes.reference;
          return {
            refDocId,
            ref: JSON.stringify({ docId: refDocId, ...params }),
          };
        }
        return null;
      })
      .filter((ref): ref is { refDocId: string; ref: string } => ref !== null),
    item => item.ref
  );

const toIso = (epochMs: number): string => new Date(epochMs).toISOString();

/**
 * Org timestamps are wall-clock local times with no timezone; render them
 * as naive ISO (`YYYY-MM-DDTHH:MM`, no zone suffix) built from the same
 * local components the parser read, so TS and Rust extraction agree
 * byte-for-byte. Still lexicographically sortable.
 */
const toNaiveIso = (epochMs: number): string => {
  const d = new Date(epochMs);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Org-mode task properties of a list item, for indexing: the full status
 * label (kebab-cased) and the planning timestamps, read from both chip
 * annotations (delta attributes `orgStatus`/`orgTimestamp`) and raw typed
 * text, with native checkbox state as the status fallback. Keep in sync
 * with the Rust extractor in `packages/common/native/src/doc_parser/read`
 * (server-side indexing).
 */
const collectOrgTaskProps = (
  block: YMap<any>,
  text: YText,
  deltas: DeltaInsert<NotesGraphTextAttributes>[]
): {
  orgStatus?: string;
  scheduledAt?: string;
  deadlineAt?: string;
  startedAt?: string;
  closedAt?: string;
} => {
  const raw = text.toString();

  // status: chip attribute on the first delta wins, then raw text prefix,
  // then the item's native checkbox state
  const chipStatus = deltas[0]?.attributes?.orgStatus;
  const statusText =
    typeof chipStatus === 'string'
      ? chipStatus
      : parseOrgStatusPrefix(raw)?.statusText;
  let orgStatus: string | undefined;
  if (statusText) {
    orgStatus = orgStatusLabel(statusText).toLowerCase().replace(/\s+/g, '-');
  } else if (block.get('prop:type') === 'todo') {
    orgStatus = block.get('prop:checked') ? 'done' : 'todo';
  }

  // planning timestamps: chip annotations across deltas + raw text scans
  const stamps = new Map<OrgPlanningKeyword, number>();
  for (const found of findOrgTimestamps(raw)) {
    stamps.set(found.keyword, found.epochMs);
  }
  for (const delta of deltas) {
    const annotation = delta.attributes?.orgTimestamp;
    if (typeof annotation !== 'string') continue;
    const parsed = parseOrgTimestamp(annotation);
    if (parsed) stamps.set(parsed.keyword, parsed.epochMs);
  }

  const iso = (keyword: OrgPlanningKeyword) => {
    const epoch = stamps.get(keyword);
    return epoch === undefined ? undefined : toNaiveIso(epoch);
  };

  return {
    orgStatus,
    scheduledAt: iso('SCHEDULED'),
    deadlineAt: iso('DEADLINE'),
    startedAt: iso('STARTED'),
    closedAt: iso('CLOSED'),
  };
};

/**
 * Inline `#hashtag` tokens in block text, lowercase-normalized and deduped.
 * A tag starts with `#` at the start of text or after whitespace, followed
 * by unicode word characters plus `-`/`_` (so `#personal`, `#my-project`,
 * `#côté` all match — but a `#` glued to a word, like `c#`, does not).
 * `#key:value` is an arbitrary PROPERTY rather than a tag: it lands in
 * `props` as an encoded `key:value` token, exact-match filterable with the
 * same inverted-index efficiency as tags (range/sort stays reserved for
 * the dedicated timestamp columns). This is the plain-text convention for
 * block entities, mirroring how org statuses/timestamps live in the item's
 * own text: the text is the source of truth, the index makes it queryable.
 * Keep in sync with the Rust extractor in
 * `packages/common/native/src/doc_parser/read/org_task.rs` (server-side
 * indexing).
 */
const HASHTAG_RE = /(?:^|\s)#([\p{L}\p{N}_-]+)(?::([\p{L}\p{N}_.-]+))?/gu;
export const collectHashtags = (
  text: string
): { tags: string[]; props: string[] } => {
  const tags = new Set<string>();
  const props = new Set<string>();
  for (const match of text.matchAll(HASHTAG_RE)) {
    if (match[2] !== undefined) {
      props.add(`${match[1].toLowerCase()}:${match[2].toLowerCase()}`);
    } else {
      tags.add(match[1].toLowerCase());
    }
  }
  return { tags: [...tags], props: [...props] };
};

const getTextDeltasFromCellValue = (
  value: unknown
): DeltaInsert<NotesGraphTextAttributes>[] | null => {
  if (!value) {
    return null;
  }

  if (value instanceof YText) {
    return value.toDelta() as DeltaInsert<NotesGraphTextAttributes>[];
  }

  if (typeof value === 'object' && value !== null) {
    const maybeText = value as { yText?: unknown };
    if (maybeText.yText instanceof YText) {
      return maybeText.yText.toDelta() as DeltaInsert<NotesGraphTextAttributes>[];
    }
  }

  if (value instanceof YMap) {
    const marker = value.get('$blocksuite:internal:text$');
    const delta = value.get('delta');
    if (marker) {
      if (delta instanceof YArray) {
        return delta
          .toArray()
          .map(entry => (entry instanceof YMap ? entry.toJSON() : entry)) as
          | DeltaInsert<NotesGraphTextAttributes>[]
          | null;
      }
      if (Array.isArray(delta)) {
        return delta as DeltaInsert<NotesGraphTextAttributes>[];
      }
    }
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    '$blocksuite:internal:text$' in value
  ) {
    const delta = (value as { delta?: unknown }).delta;
    if (delta instanceof YArray) {
      return delta.toArray() as DeltaInsert<NotesGraphTextAttributes>[];
    }
    if (Array.isArray(delta)) {
      return delta as DeltaInsert<NotesGraphTextAttributes>[];
    }
  }

  return null;
};

function generateMarkdownPreviewBuilder(
  workspaceId: string,
  blocks: BlockDocumentInfo[],
  yRootDoc?: YDoc
) {
  function yblockToDraftModal(yblock: YBlock): DraftModel | null {
    const flavour = yblock.get('sys:flavour') as string;
    const blockSchema = blocksuiteSchema.flavourSchemaMap.get(flavour);
    if (!blockSchema) {
      return null;
    }
    const keys = Array.from(yblock.keys())
      .filter(key => key.startsWith('prop:'))
      .map(key => key.substring(5));

    const props = Object.fromEntries(
      keys.map(key => [key, createYProxy(yblock.get(`prop:${key}`))])
    );

    return {
      props,
      id: yblock.get('sys:id') as string,
      flavour,
      children: [],
      role: blockSchema.model.role,
      version: (yblock.get('sys:version') as number) ?? blockSchema.version,
      keys: Array.from(yblock.keys())
        .filter(key => key.startsWith('prop:'))
        .map(key => key.substring(5)),
    } as unknown as DraftModel;
  }

  const titleMiddleware: TransformerMiddleware = ({ adapterConfigs }) => {
    const pages = yRootDoc?.getMap('meta').get('pages');
    if (!(pages instanceof YArray)) {
      return;
    }
    for (const meta of pages.toArray()) {
      adapterConfigs.set(
        'title:' + meta.get('id'),
        meta.get('title')?.toString() ?? 'Untitled'
      );
    }
  };

  const baseUrl = `/workspace/${workspaceId}`;

  function getDocLink(docId: string, blockId: string) {
    const searchParams = new URLSearchParams();
    searchParams.set('blockIds', blockId);
    return `${baseUrl}/${docId}?${searchParams.toString()}`;
  }

  const docLinkBaseURLMiddleware: TransformerMiddleware = ({
    adapterConfigs,
  }) => {
    adapterConfigs.set('docLinkBaseUrl', baseUrl);
  };

  const container = new Container();
  getStoreManager()
    .get('store')
    .forEach(ext => {
      ext.setup(container);
    });

  const provider = container.provider();
  const markdownAdapter = new MarkdownAdapter(
    new Transformer({
      schema: blocksuiteSchema,
      blobCRUD: {
        delete: () => Promise.resolve(),
        get: () => Promise.resolve(null),
        list: () => Promise.resolve([]),
        set: () => Promise.resolve(''),
      },
      docCRUD: {
        create: () => {
          throw new Error('Not implemented');
        },
        get: () => null,
        delete: () => {},
      },
      middlewares: [docLinkBaseURLMiddleware, titleMiddleware],
    }),
    provider
  );

  const markdownPreviewCache = new WeakMap<BlockDocumentInfo, string | null>();

  function trimCodeBlock(markdown: string) {
    const lines = markdown.split('\n').filter(line => line.trim() !== '');
    if (lines.length > 5) {
      return [...lines.slice(0, 4), '...', lines.at(-1), ''].join('\n');
    }
    return [...lines, ''].join('\n');
  }

  function trimParagraph(markdown: string) {
    const lines = markdown.split('\n').filter(line => line.trim() !== '');

    if (lines.length > 3) {
      return [...lines.slice(0, 3), '...', lines.at(-1), ''].join('\n');
    }

    return [...lines, ''].join('\n');
  }

  function getListDepth(block: BlockDocumentInfo) {
    let parentBlockCount = 0;
    let currentBlock: BlockDocumentInfo | undefined = block;
    do {
      currentBlock = blocks.find(
        b => b.blockId === currentBlock?.parentBlockId
      );

      // reach the root block. do not count it.
      if (!currentBlock || currentBlock.flavour !== 'notesgraph:list') {
        break;
      }
      parentBlockCount++;
    } while (currentBlock);
    return parentBlockCount;
  }

  // only works for list block
  function indentMarkdown(markdown: string, depth: number) {
    if (depth <= 0) {
      return markdown;
    }

    return (
      markdown
        .split('\n')
        .map(line => '    '.repeat(depth) + line)
        .join('\n') + '\n'
    );
  }

  const generateDatabaseMarkdownPreview = (block: BlockDocumentInfo) => {
    const isDatabaseBlock = (block: BlockDocumentInfo) => {
      return block.flavour === 'notesgraph:database';
    };

    const model = yblockToDraftModal(block.yblock);

    if (!model) {
      return null;
    }

    let dbBlock: BlockDocumentInfo | null = null;

    if (isDatabaseBlock(block)) {
      dbBlock = block;
    } else {
      const parentBlock = blocks.find(b => b.blockId === block.parentBlockId);

      if (parentBlock && isDatabaseBlock(parentBlock)) {
        dbBlock = parentBlock;
      }
    }

    if (!dbBlock) {
      return null;
    }

    const url = getDocLink(block.docId, dbBlock.blockId);
    const title = dbBlock.additional?.databaseName;

    return `[database · ${title || 'Untitled'}][](${url})\n`;
  };

  const generateImageMarkdownPreview = (block: BlockDocumentInfo) => {
    const isImageModel = (
      model: DraftModel | null
    ): model is DraftModel<ImageBlockModel> => {
      return model?.flavour === 'notesgraph:image';
    };

    const model = yblockToDraftModal(block.yblock);

    if (!isImageModel(model)) {
      return null;
    }

    const info = ['an image block'];

    if (model.props.sourceId) {
      info.push(`file id ${model.props.sourceId}`);
    }

    if (model.props.caption) {
      info.push(`with caption ${model.props.caption}`);
    }

    return info.join(', ') + '\n';
  };

  const generateEmbedMarkdownPreview = (block: BlockDocumentInfo) => {
    const isEmbedModel = (
      model: DraftModel | null
    ): model is DraftModel<EmbedBlockModel> => {
      return (
        model?.flavour === 'notesgraph:embed-linked-doc' ||
        model?.flavour === 'notesgraph:embed-synced-doc'
      );
    };

    const draftModel = yblockToDraftModal(block.yblock);
    if (!isEmbedModel(draftModel)) {
      return null;
    }

    const url = getDocLink(block.docId, draftModel.id);

    return `[](${url})\n`;
  };

  const generateLatexMarkdownPreview = (block: BlockDocumentInfo) => {
    let content =
      typeof block.content === 'string'
        ? block.content.trim()
        : block.content?.join('').trim();

    content = content?.split('\n').join(' ') ?? '';

    return `LaTeX, with value ${content}\n`;
  };

  const generateBookmarkMarkdownPreview = (block: BlockDocumentInfo) => {
    const isBookmarkModel = (
      model: DraftModel | null
    ): model is DraftModel<BookmarkBlockModel> => {
      return bookmarkFlavours.has(model?.flavour ?? '');
    };

    const draftModel = yblockToDraftModal(block.yblock);
    if (!isBookmarkModel(draftModel)) {
      return null;
    }
    const title = draftModel.props.title;
    const url = draftModel.props.url;
    return `[${title}](${url})\n`;
  };

  const generateAttachmentMarkdownPreview = (block: BlockDocumentInfo) => {
    const isAttachmentModel = (
      model: DraftModel | null
    ): model is DraftModel<AttachmentBlockModel> => {
      return model?.flavour === 'notesgraph:attachment';
    };

    const draftModel = yblockToDraftModal(block.yblock);
    if (!isAttachmentModel(draftModel)) {
      return null;
    }

    return `[${draftModel.props.name}](${draftModel.props.sourceId})\n`;
  };

  const generateTableMarkdownPreview = (block: BlockDocumentInfo) => {
    const isTableModel = (
      model: DraftModel | null
    ): model is DraftModel<TableBlockModel> => {
      return model?.flavour === 'notesgraph:table';
    };

    const draftModel = yblockToDraftModal(block.yblock);
    if (!isTableModel(draftModel)) {
      return null;
    }

    const url = getDocLink(block.docId, draftModel.id);

    return `[table][](${url})\n`;
  };

  const generateMarkdownPreview = async (block: BlockDocumentInfo) => {
    if (markdownPreviewCache.has(block)) {
      return markdownPreviewCache.get(block);
    }
    const flavour = block.flavour;
    let markdown: string | null = null;

    if (
      flavour === 'notesgraph:paragraph' ||
      flavour === 'notesgraph:list' ||
      flavour === 'notesgraph:code'
    ) {
      const draftModel = yblockToDraftModal(block.yblock);
      markdown =
        block.parentFlavour === 'notesgraph:database'
          ? generateDatabaseMarkdownPreview(block)
          : ((draftModel ? await markdownAdapter.fromBlock(draftModel) : null)
              ?.file ?? null);

      if (markdown) {
        if (flavour === 'notesgraph:code') {
          markdown = trimCodeBlock(markdown);
        } else if (flavour === 'notesgraph:paragraph') {
          markdown = trimParagraph(markdown);
        }
      }
    } else if (flavour === 'notesgraph:database') {
      markdown = generateDatabaseMarkdownPreview(block);
    } else if (
      flavour === 'notesgraph:embed-linked-doc' ||
      flavour === 'notesgraph:embed-synced-doc'
    ) {
      markdown = generateEmbedMarkdownPreview(block);
    } else if (flavour === 'notesgraph:attachment') {
      markdown = generateAttachmentMarkdownPreview(block);
    } else if (flavour === 'notesgraph:image') {
      markdown = generateImageMarkdownPreview(block);
    } else if (
      flavour === 'notesgraph:surface' ||
      flavour === 'notesgraph:page'
    ) {
      // skip
    } else if (flavour === 'notesgraph:latex') {
      markdown = generateLatexMarkdownPreview(block);
    } else if (bookmarkFlavours.has(flavour)) {
      markdown = generateBookmarkMarkdownPreview(block);
    } else if (flavour === 'notesgraph:table') {
      markdown = generateTableMarkdownPreview(block);
    } else {
      console.warn(`unknown flavour: ${flavour}`);
    }

    if (markdown && flavour === 'notesgraph:list') {
      const blockDepth = getListDepth(block);
      markdown = indentMarkdown(markdown, Math.max(0, blockDepth));
    }

    markdownPreviewCache.set(block, markdown);
    return markdown;
  };

  return generateMarkdownPreview;
}

// remove the indent of the first line of list
// e.g.,
// ```
//     - list item 1
//       - list item 2
// ```
// becomes
// ```
// - list item 1
//   - list item 2
// ```
function unindentMarkdown(markdown: string) {
  const lines = markdown.split('\n');
  const res: string[] = [];
  let firstListFound = false;
  let baseIndent = 0;

  for (let current of lines) {
    const indent = current.match(/^\s*/)?.[0]?.length ?? 0;

    if (indent > 0) {
      if (!firstListFound) {
        // For the first list item, remove all indentation
        firstListFound = true;
        baseIndent = indent;
        current = current.trimStart();
      } else {
        // For subsequent list items, maintain relative indentation
        current =
          ' '.repeat(Math.max(0, indent - baseIndent)) + current.trimStart();
      }
    }

    res.push(current);
  }

  return res.join('\n');
}

export async function readAllBlocksFromDoc({
  ydoc,
  rootYDoc,
  spaceId,
  maxSummaryLength,
}: {
  ydoc: YDoc;
  rootYDoc?: YDoc;
  spaceId: string;
  maxSummaryLength?: number;
}): Promise<
  | {
      blocks: BlockDocumentInfo[];
      title: string;
      summary: string;
    }
  | undefined
> {
  let docTitle = '';
  let summary = '';
  maxSummaryLength ??= 1000;
  const blockDocuments: BlockDocumentInfo[] = [];

  const generateMarkdownPreview = generateMarkdownPreviewBuilder(
    spaceId,
    blockDocuments,
    rootYDoc
  );

  const blocks = ydoc.getMap<any>('blocks');
  if (blocks.size === 0) {
    return undefined;
  }

  // build a parent map for quick lookup
  // for each block, record its parent id
  const parentMap: Record<string, string | null> = {};
  for (const [id, block] of blocks.entries()) {
    const children = block.get('sys:children') as YArray<string> | undefined;
    if (children instanceof YArray && children.length) {
      for (const child of children) {
        parentMap[child] = id;
      }
    }
  }

  // find the nearest block that satisfies the predicate
  const nearest = (
    blockId: string,
    predicate: (block: YMap<any>) => boolean
  ) => {
    let current: string | null = blockId;
    while (current) {
      const block = blocks.get(current);
      if (block && predicate(block)) {
        return block;
      }
      current = parentMap[current] ?? null;
    }
    return null;
  };

  const nearestByFlavour = (blockId: string, flavour: string) =>
    nearest(blockId, block => block.get('sys:flavour') === flavour);

  let rootBlockId: string | null = null;
  for (const block of blocks.values()) {
    const flavour = block.get('sys:flavour')?.toString();
    const blockId = block.get('sys:id')?.toString();
    if (flavour === 'notesgraph:page' && blockId) {
      rootBlockId = blockId;
    }
  }

  if (!rootBlockId) {
    return undefined;
  }

  const queue: { parent?: string; id: string }[] = [{ id: rootBlockId }];
  const visited = new Set<string>(); // avoid loop

  const pushChildren = (id: string, block: YMap<any>) => {
    const children = block.get('sys:children');
    if (children instanceof YArray && children.length) {
      for (let i = children.length - 1; i >= 0; i--) {
        const childId = children.get(i);
        if (childId && !visited.has(childId)) {
          queue.push({ parent: id, id: childId });
          visited.add(childId);
        }
      }
    }
  };

  // #region first loop - generate block base info
  while (queue.length) {
    const next = queue.pop();
    if (!next) {
      break;
    }

    const { parent: parentBlockId, id: blockId } = next;
    const block = blockId ? blocks.get(blockId) : null;
    const parentBlock = parentBlockId ? blocks.get(parentBlockId) : null;
    if (!block) {
      break;
    }

    const flavour = block.get('sys:flavour')?.toString();
    const parentFlavour = parentBlock?.get('sys:flavour')?.toString();
    const noteBlock = nearestByFlavour(blockId, 'notesgraph:note');

    // display mode:
    // - both: page and edgeless -> fallback to page
    // - page: only page -> page
    // - edgeless: only edgeless -> edgeless
    // - undefined: edgeless (assuming it is a normal element on the edgeless)
    let displayMode = noteBlock?.get('prop:displayMode') ?? 'edgeless';

    if (displayMode === 'both') {
      displayMode = 'page';
    }

    const noteBlockId: string | undefined = noteBlock
      ?.get('sys:id')
      ?.toString();

    pushChildren(blockId, block);

    const commonBlockProps = {
      docId: ydoc.guid,
      flavour,
      blockId,
      yblock: block,
      additional: { displayMode, noteBlockId },
    };

    if (flavour === 'notesgraph:page') {
      docTitle = block.get('prop:title').toString();
      blockDocuments.push({ ...commonBlockProps, content: docTitle });
    } else if (
      flavour === 'notesgraph:paragraph' ||
      flavour === 'notesgraph:list' ||
      flavour === 'notesgraph:code'
    ) {
      const text = block.get('prop:text') as YText;

      if (!text) {
        continue;
      }

      const deltas: DeltaInsert<NotesGraphTextAttributes>[] = text.toDelta();
      const refs = collectInlineReferences(deltas);

      const databaseName =
        flavour === 'notesgraph:paragraph' &&
        parentFlavour === 'notesgraph:database' // if block is a database row
          ? parentBlock?.get('prop:title')?.toString()
          : undefined;

      // mark todo checkbox state so incomplete tasks can be aggregated
      const todoStatus =
        flavour === 'notesgraph:list' && block.get('prop:type') === 'todo'
          ? block.get('prop:checked')
            ? 'done'
            : 'todo'
          : undefined;

      // for a nested todo, capture a breadcrumb of ancestor block text so the
      // To-Do list can show where it lives
      let todoTrail: string | undefined;
      if (todoStatus) {
        const parts: string[] = [];
        let ancestorId: string | null | undefined = parentBlockId;
        let guard = 0;
        while (ancestorId && guard++ < 6) {
          const ancestor = blocks.get(ancestorId);
          if (!ancestor) break;
          const ancestorFlavour = ancestor.get('sys:flavour')?.toString();
          if (
            ancestorFlavour === 'notesgraph:note' ||
            ancestorFlavour === 'notesgraph:page' ||
            ancestorFlavour === 'notesgraph:surface'
          ) {
            break;
          }
          const ancestorText = (ancestor.get('prop:text') as YText | undefined)
            ?.toString()
            .trim();
          if (ancestorText) parts.unshift(ancestorText);
          ancestorId = parentMap[ancestorId] ?? null;
        }
        if (parts.length) {
          todoTrail = parts.join(' › ');
          if (todoTrail.length > 80) {
            todoTrail = '…' + todoTrail.slice(-79);
          }
        }
      }

      const { tags, props } = collectHashtags(text.toString());
      const orgTask =
        flavour === 'notesgraph:list'
          ? collectOrgTaskProps(block, text, deltas)
          : undefined;
      const createdAtMs = block.get('prop:meta:createdAt');

      blockDocuments.push({
        ...commonBlockProps,
        content: text.toString(),
        todoStatus,
        todoTrail,
        tags: tags.length ? tags : undefined,
        props: props.length ? props : undefined,
        orgStatus: orgTask?.orgStatus,
        createdAt:
          typeof createdAtMs === 'number' ? toIso(createdAtMs) : undefined,
        scheduledAt: orgTask?.scheduledAt,
        deadlineAt: orgTask?.deadlineAt,
        startedAt: orgTask?.startedAt,
        closedAt: orgTask?.closedAt,
        ...refs.reduce<{ refDocId: string[]; ref: string[] }>(
          (prev, curr) => {
            prev.refDocId.push(curr.refDocId);
            prev.ref.push(curr.ref);
            return prev;
          },
          { refDocId: [], ref: [] }
        ),
        parentFlavour,
        parentBlockId,
        additional: { ...commonBlockProps.additional, databaseName },
      });

      if (maxSummaryLength > 0) {
        // A separator between blocks — without it, e.g. two adjacent
        // paragraphs "word1" and "word2" concatenate into "word1word2" in
        // the doc-card/recent preview, since nothing else inserts a space
        // between them (the client-side preview only collapses whitespace
        // that's already there, it can't invent a missing boundary).
        if (summary.length > 0) {
          summary += ' ';
        }
        summary += text.toString();
        maxSummaryLength -= text.length;
      }
    } else if (
      flavour === 'notesgraph:embed-linked-doc' ||
      flavour === 'notesgraph:embed-synced-doc'
    ) {
      const pageId = block.get('prop:pageId');
      if (typeof pageId === 'string') {
        // reference info
        const params = block.get('prop:params') ?? {};
        blockDocuments.push({
          ...commonBlockProps,
          refDocId: [pageId],
          ref: [JSON.stringify({ docId: pageId, ...params })],
          parentFlavour,
          parentBlockId,
        });
      }
    } else if (flavour === 'notesgraph:attachment') {
      const blobId = block.get('prop:sourceId');
      if (typeof blobId === 'string') {
        blockDocuments.push({
          ...commonBlockProps,
          blob: [blobId],
          content: block.get('prop:name')?.toString() ?? '',
          parentFlavour,
          parentBlockId,
        });
      }
    } else if (flavour === 'notesgraph:image') {
      const blobId = block.get('prop:sourceId');
      if (typeof blobId === 'string') {
        blockDocuments.push({
          ...commonBlockProps,
          blob: [blobId],
          content: block.get('prop:caption')?.toString() ?? '',
          parentFlavour,
          parentBlockId,
        });
      }
    } else if (flavour === 'notesgraph:surface') {
      const texts = [];

      const elementsObj = block.get('prop:elements');
      if (
        !(
          elementsObj instanceof YMap &&
          elementsObj.get('type') === '$blocksuite:internal:native$'
        )
      ) {
        continue;
      }
      const elements = elementsObj.get('value') as YMap<any>;
      if (!(elements instanceof YMap)) {
        continue;
      }

      for (const element of elements.values()) {
        if (!(element instanceof YMap)) {
          continue;
        }
        const text = element.get('text') as YText;
        if (!text) {
          continue;
        }

        texts.push(text.toString());
      }

      blockDocuments.push({
        ...commonBlockProps,
        content: texts,
        parentFlavour,
        parentBlockId,
      });
    } else if (flavour === 'notesgraph:database') {
      const texts = [];
      const columnsObj = block.get('prop:columns');
      const databaseTitle = block.get('prop:title');
      if (databaseTitle instanceof YText) {
        texts.push(databaseTitle.toString());
      }
      if (columnsObj instanceof YArray) {
        for (const column of columnsObj) {
          if (!(column instanceof YMap)) {
            continue;
          }
          if (typeof column.get('name') === 'string') {
            texts.push(column.get('name'));
          }

          const data = column.get('data');
          if (!(data instanceof YMap)) {
            continue;
          }
          const options = data.get('options');
          if (!(options instanceof YArray)) {
            continue;
          }
          for (const option of options) {
            if (!(option instanceof YMap)) {
              continue;
            }
            const value = option.get('value');
            if (typeof value === 'string') {
              texts.push(value);
            }
          }
        }
      }

      const databaseRefs: { refDocId: string; ref: string }[] = [];
      const cellsObj = block.get('prop:cells');
      if (cellsObj instanceof YMap) {
        for (const row of cellsObj.values()) {
          if (!(row instanceof YMap)) {
            continue;
          }
          for (const cell of row.values()) {
            if (!(cell instanceof YMap)) {
              continue;
            }
            const deltas = getTextDeltasFromCellValue(cell.get('value'));
            if (!deltas?.length) {
              continue;
            }
            const refs = collectInlineReferences(deltas);
            if (refs.length) {
              databaseRefs.push(...refs);
            }
          }
        }
      }

      blockDocuments.push({
        ...commonBlockProps,
        content: texts,
        additional: {
          ...commonBlockProps.additional,
          databaseName: databaseTitle?.toString(),
        },
        ...(databaseRefs.length
          ? databaseRefs.reduce<{ refDocId: string[]; ref: string[] }>(
              (prev, curr) => {
                prev.refDocId.push(curr.refDocId);
                prev.ref.push(curr.ref);
                return prev;
              },
              { refDocId: [], ref: [] }
            )
          : {}),
      });
    } else if (flavour === 'notesgraph:latex') {
      blockDocuments.push({
        ...commonBlockProps,
        content: block.get('prop:latex')?.toString() ?? '',
      });
    } else if (flavour === 'notesgraph:table') {
      const contents = Array.from<string>(block.keys())
        .map(key => {
          if (key.startsWith('prop:cells.') && key.endsWith('.text')) {
            return block.get(key)?.toString() ?? '';
          }
          return '';
        })
        .filter(Boolean);
      blockDocuments.push({
        ...commonBlockProps,
        content: contents,
      });
    } else if (bookmarkFlavours.has(flavour)) {
      // Index the link's URL plus its fetched metadata so the content of
      // bookmark/embed links is searchable.
      const content = [
        block.get('prop:url'),
        block.get('prop:title'),
        block.get('prop:description'),
        block.get('prop:caption'),
      ]
        .map(value => value?.toString().trim())
        .filter((value): value is string => !!value);
      blockDocuments.push({
        ...commonBlockProps,
        content,
        parentFlavour,
        parentBlockId,
      });
    }
  }
  // #endregion

  // #region second loop - generate markdown preview
  const TARGET_PREVIEW_CHARACTER = 500;
  const TARGET_PREVIOUS_BLOCK = 1;
  const TARGET_FOLLOW_BLOCK = 4;
  for (const block of blockDocuments) {
    if (block.ref?.length) {
      const target = block;

      // should only generate the markdown preview belong to the same notesgraph:note
      const noteBlock = nearestByFlavour(block.blockId, 'notesgraph:note');

      const sameNoteBlocks = noteBlock
        ? blockDocuments.filter(
            candidate =>
              nearestByFlavour(candidate.blockId, 'notesgraph:note') ===
              noteBlock
          )
        : [];

      // only generate markdown preview for reference blocks
      let previewText = (await generateMarkdownPreview(target)) ?? '';
      let previousBlock = 0;
      let followBlock = 0;
      let previousIndex = sameNoteBlocks.findIndex(
        block => block.blockId === target.blockId
      );
      let followIndex = previousIndex;

      while (
        !(
          (
            previewText.length > TARGET_PREVIEW_CHARACTER || // stop if preview text reaches the limit
            ((previousBlock >= TARGET_PREVIOUS_BLOCK || previousIndex < 0) &&
              (followBlock >= TARGET_FOLLOW_BLOCK ||
                followIndex >= sameNoteBlocks.length))
          ) // stop if no more blocks, or preview block reaches the limit
        )
      ) {
        if (previousBlock < TARGET_PREVIOUS_BLOCK) {
          previousIndex--;
          const block =
            previousIndex >= 0 ? sameNoteBlocks.at(previousIndex) : null;
          const markdown = block ? await generateMarkdownPreview(block) : null;
          if (
            markdown &&
            !previewText.startsWith(
              markdown
            ) /* A small hack to skip blocks with the same content */
          ) {
            previewText = markdown + '\n' + previewText;
            previousBlock++;
          }
        }

        if (followBlock < TARGET_FOLLOW_BLOCK) {
          followIndex++;
          const block = sameNoteBlocks.at(followIndex);
          const markdown = block ? await generateMarkdownPreview(block) : null;
          if (
            markdown &&
            !previewText.endsWith(
              markdown
            ) /* A small hack to skip blocks with the same content */
          ) {
            previewText = previewText + '\n' + markdown;
            followBlock++;
          }
        }
      }

      block.markdownPreview = unindentMarkdown(previewText);
    }
  }
  // #endregion

  return {
    blocks: blockDocuments,
    title: docTitle,
    summary,
  };
}

/**
 * Get all docs from the root doc
 */
export function readAllDocsFromRootDoc(
  rootDoc: YDoc,
  options?: {
    includeTrash?: boolean;
  }
) {
  const docs = rootDoc.getMap('meta').get('pages') as
    | YArray<YMap<any>>
    | undefined;
  const availableDocs = new Map<string, { title: string | undefined }>();

  if (docs) {
    for (const page of docs) {
      const docId = page.get('id');

      if (typeof docId !== 'string') {
        continue;
      }

      const inTrash = page.get('trash') ?? false;
      const title = page.get('title');

      if (!options?.includeTrash && inTrash) {
        continue;
      }

      availableDocs.set(docId, { title });
    }
  }

  return availableDocs;
}

export function readAllDocIdsFromRootDoc(
  rootDoc: YDoc,
  options?: {
    includeTrash?: boolean;
  }
) {
  const docs = rootDoc.getMap('meta').get('pages') as
    | YArray<YMap<any>>
    | undefined;
  const docIds = new Set<string>();
  if (docs) {
    for (const page of docs) {
      const docId = page.get('id');
      if (typeof docId !== 'string') {
        continue;
      }
      const inTrash = page.get('trash') ?? false;
      if (!options?.includeTrash && inTrash) {
        continue;
      }
      docIds.add(docId);
    }
  }
  return Array.from(docIds);
}

export { parseBlock, parseBlockToMd, parsePageDoc } from './doc-parser/parser';
