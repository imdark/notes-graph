import { randomUUID } from 'node:crypto';

/** The marker BlockSuite puts on a serialised Y.Text. */
const TEXT_MARKER = '$blocksuite:internal:text$';

type SnapshotBlock = {
  flavour?: string;
  props?: Record<string, unknown>;
  children?: SnapshotBlock[];
};

function deltaText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const delta = (value as { delta?: unknown }).delta;
  if (!Array.isArray(delta)) return '';
  return delta
    .map(op => {
      const insert = (op as { insert?: unknown })?.insert;
      return typeof insert === 'string' ? insert : '';
    })
    .join('');
}

/**
 * A comment's or reply's text, one line per paragraph. The body is a
 * BlockSuite doc snapshot (what the comment editor saves), so its text is
 * spread over the paragraph blocks under the page's note.
 */
export function commentText(content: unknown): string {
  const snapshot = (content as { snapshot?: { blocks?: SnapshotBlock } })
    ?.snapshot;
  const lines: string[] = [];
  const walk = (block: SnapshotBlock | undefined) => {
    if (!block) return;
    // The page block's title is always empty in a comment.
    if (!block.flavour?.endsWith(':page')) {
      const text = deltaText(block.props?.text);
      if (text) lines.push(text);
    }
    for (const child of block.children ?? []) walk(child);
  };
  walk(snapshot?.blocks);
  return lines.join('\n').trim();
}

function textProp(text: string) {
  return { [TEXT_MARKER]: true, delta: text ? [{ insert: text }] : [] };
}

/**
 * The content of a reply an agent writes: the same shape the comment editor
 * saves (page → note → one paragraph per line), so the app renders it as if
 * typed.
 */
export function replyContent(text: string) {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => ({
      type: 'block',
      id: randomUUID(),
      flavour: 'notesgraph:paragraph',
      props: { type: 'text', text: textProp(line) },
      children: [],
    }));
  const pageId = randomUUID();
  return {
    snapshot: {
      type: 'page',
      meta: { id: pageId, title: '', tags: [], createDate: Date.now() },
      blocks: {
        type: 'block',
        id: pageId,
        flavour: 'notesgraph:page',
        props: { title: textProp('') },
        children: [
          {
            type: 'block',
            id: randomUUID(),
            flavour: 'notesgraph:note',
            props: {},
            children: paragraphs,
          },
        ],
      },
    },
    attachments: [],
  };
}
