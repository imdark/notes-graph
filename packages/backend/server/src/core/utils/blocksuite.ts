import {
  parsePageDocFromBinary,
  parseWorkspaceDocFromBinary,
  parseYDocFromBinary,
  parseYDocToMarkdown,
  readAllDocIdsFromRootDoc,
} from '../../native';

export interface PageDocContent {
  title: string;
  summary: string;
}

export interface WorkspaceDocContent {
  name: string;
  avatarKey: string;
}

export interface DocMarkdownContent {
  title: string;
  markdown: string;
  knownUnsupportedBlocks: string[];
  unknownBlocks: string[];
}

export interface ParsePageOptions {
  maxSummaryLength?: number;
}

export function parseWorkspaceDoc(
  snapshot: Uint8Array
): WorkspaceDocContent | null {
  return parseWorkspaceDocFromBinary(Buffer.from(snapshot)) ?? null;
}

export function parsePageDoc(
  docSnapshot: Uint8Array,
  opts: ParsePageOptions = { maxSummaryLength: 150 }
): PageDocContent | null {
  return (
    parsePageDocFromBinary(
      Buffer.from(docSnapshot),
      opts?.maxSummaryLength ?? 150
    ) ?? null
  );
}

/**
 * Block flavours whose text contributes to a doc summary — the same set the
 * local indexer's reader uses (packages/common/reader's readAllBlocksFromDoc),
 * so a cloud workspace's previews read identically to a local one's.
 *
 * Notably this excludes `notesgraph:page`, whose content *is* the doc title:
 * every block comes back from parseYDocFromBinary, so without this filter the
 * summary is prefixed with the title, which the clients already render on its
 * own line right above the preview (DocType exposes `title` and `summary`
 * separately). It also skips `notesgraph:table`, whose content is one entry
 * per cell in no meaningful order.
 */
const SUMMARY_BLOCK_FLAVOURS = new Set([
  'notesgraph:paragraph',
  'notesgraph:list',
  'notesgraph:code',
]);

/**
 * Builds a doc summary the same way parsePageDoc does, except joining each
 * block's content with a space instead of concatenating directly — the
 * upstream native summary (parsePageDocFromBinary, and the `summary` field
 * on parseYDocFromBinary's own result) glues adjacent blocks together with
 * no separator at all, so e.g. a "word1" paragraph followed by a "word2"
 * paragraph reads as "word1word2" in doc-card/recent previews. This can't be
 * fixed by trimming/collapsing whitespace client-side after the fact — by
 * the time a single flattened summary string comes back, the block boundary
 * is already gone. Uses parseYDocFromBinary instead of parsePageDocFromBinary
 * because it exposes each block's content separately (NativeBlockInfo.content)
 * rather than a single pre-joined string.
 */
export function buildDocSummary(
  docId: string,
  docSnapshot: Uint8Array,
  maxSummaryLength: number
): PageDocContent | null {
  const result = parseYDocFromBinary(Buffer.from(docSnapshot), docId);
  if (!result) return null;

  let summary = '';
  for (const block of result.blocks) {
    if (!SUMMARY_BLOCK_FLAVOURS.has(block.flavour)) continue;
    const content = Array.isArray(block.content) ? block.content[0] : undefined;
    if (!content) continue;
    if (summary.length > 0) {
      summary += ' ';
    }
    summary += content;
    if (maxSummaryLength >= 0 && summary.length >= maxSummaryLength) {
      break;
    }
  }
  if (maxSummaryLength >= 0) {
    summary = summary.slice(0, maxSummaryLength);
  }

  return { title: result.title, summary };
}

export function readAllDocIdsFromWorkspaceSnapshot(snapshot: Uint8Array) {
  return readAllDocIdsFromRootDoc(Buffer.from(snapshot), false);
}

function safeParseJson<T>(str: string): T | undefined {
  try {
    return JSON.parse(str) as T;
  } catch {
    return undefined;
  }
}

export async function readAllBlocksFromDocSnapshot(
  docId: string,
  docSnapshot: Uint8Array
) {
  const result = parseYDocFromBinary(Buffer.from(docSnapshot), docId);

  return {
    ...result,
    blocks: result.blocks.map(block => ({
      ...block,
      docId,
      ref: block.refInfo,
      additional: block.additional
        ? safeParseJson(block.additional)
        : undefined,
    })),
  };
}

export function parseDocToMarkdownFromDocSnapshot(
  workspaceId: string,
  docId: string,
  docSnapshot: Uint8Array,
  aiEditable = false
): DocMarkdownContent {
  const docUrlPrefix = workspaceId ? `/workspace/${workspaceId}` : undefined;
  const parsed = parseYDocToMarkdown(
    Buffer.from(docSnapshot),
    docId,
    aiEditable,
    docUrlPrefix
  );

  return {
    title: parsed.title,
    markdown: parsed.markdown,
    knownUnsupportedBlocks: parsed.knownUnsupportedBlocks ?? [],
    unknownBlocks: parsed.unknownBlocks ?? [],
  };
}
