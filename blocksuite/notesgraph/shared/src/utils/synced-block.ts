/**
 * Clipboard contract for Notion-style synced blocks: "Copy as synced
 * block" packs this payload into the clipboard (inside the blocksuite
 * html snapshot, so it round-trips through the system clipboard), and the
 * page paste handler turns it into a `notesgraph:embed-synced-block` — a
 * live, editable reference to the original block.
 */
export const SYNCED_BLOCK_CLIPBOARD_TYPE = 'notesgraph/synced-block';

/**
 * text/html carrier attribute. Custom clipboard MIME types are dropped by
 * the OS clipboard (only text/plain, text/html and a few others survive a
 * real copy→paste round-trip), so the payload also rides inside text/html
 * on a data attribute.
 */
export const SYNCED_BLOCK_HTML_ATTR = 'data-notesgraph-synced-block';

export const SYNCED_BLOCK_FLAVOUR = 'notesgraph:embed-synced-block';

export interface SyncedBlockClipboardPayload {
  pageId: string;
  blockId: string;
}

export function syncedBlockToHtml(
  payload: SyncedBlockClipboardPayload,
  text: string
): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<span ${SYNCED_BLOCK_HTML_ATTR}="${encodeURIComponent(
    JSON.stringify(payload)
  )}">${escaped}</span>`;
}

export function parseSyncedBlockHtml(
  html: string | null | undefined
): SyncedBlockClipboardPayload | null {
  if (!html || !html.includes(SYNCED_BLOCK_HTML_ATTR)) return null;
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = doc.querySelector(`[${SYNCED_BLOCK_HTML_ATTR}]`);
    const raw = el?.getAttribute(SYNCED_BLOCK_HTML_ATTR);
    return raw ? parseSyncedBlockPayload(decodeURIComponent(raw)) : null;
  } catch {
    return null;
  }
}

export function parseSyncedBlockPayload(
  raw: unknown
): SyncedBlockClipboardPayload | null {
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.pageId === 'string' &&
      parsed.pageId &&
      typeof parsed.blockId === 'string' &&
      parsed.blockId
    ) {
      return { pageId: parsed.pageId, blockId: parsed.blockId };
    }
  } catch {
    // not ours
  }
  return null;
}
