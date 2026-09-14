import * as Y from 'yjs';

type YBlock = Y.Map<unknown>;

/** A page doc's blocks live in `getMap('blocks')`, keyed by block id. */
function blocksMap(doc: Y.Doc): Y.Map<YBlock> {
  return doc.getMap('blocks') as Y.Map<YBlock>;
}

function flavourOf(block: YBlock): string {
  return String(block.get('sys:flavour') ?? '');
}

function childrenOf(block: YBlock): string[] {
  const c = block.get('sys:children');
  return c instanceof Y.Array ? (c.toArray() as string[]) : [];
}

/** Render a `prop:text` Y.Text to markdown, turning references into [[id]]. */
function renderText(value: unknown): string {
  if (!(value instanceof Y.Text)) {
    return typeof value === 'string' ? value : '';
  }
  let out = '';
  for (const op of value.toDelta() as Array<{
    insert?: unknown;
    attributes?: { reference?: { pageId?: string } };
  }>) {
    const ref = op.attributes?.reference?.pageId;
    if (ref) {
      out += `[[${ref}]]`;
    } else if (typeof op.insert === 'string') {
      out += op.insert;
    }
  }
  return out;
}

const CONTAINER = /:(page|note|surface|frame)$/;

function findRoot(blocks: Y.Map<YBlock>): string | undefined {
  for (const [id, block] of blocks.entries()) {
    if (flavourOf(block).endsWith(':page')) return id;
  }
  return undefined;
}

function renderBlock(
  blocks: Y.Map<YBlock>,
  id: string,
  depth: number,
  lines: string[]
) {
  const block = blocks.get(id);
  if (!block) return;
  const flavour = flavourOf(block);

  // Surface (edgeless canvas) has no linear markdown representation.
  if (flavour.endsWith(':surface')) return;

  const bare = flavour.replace(/^[^:]+:/, '');
  const text = renderText(block.get('prop:text'));
  const indent = '  '.repeat(Math.max(0, depth));

  if (CONTAINER.test(flavour)) {
    // Containers contribute no line of their own; render their children.
    for (const child of childrenOf(block)) {
      renderBlock(blocks, child, flavour.endsWith(':note') ? 0 : depth, lines);
    }
    return;
  }

  switch (bare) {
    case 'paragraph': {
      const type = String(block.get('prop:type') ?? 'text');
      if (/^h[1-6]$/.test(type)) {
        lines.push(`${'#'.repeat(Number(type[1]))} ${text}`);
      } else if (type === 'quote') {
        lines.push(`> ${text}`);
      } else {
        lines.push(text);
      }
      break;
    }
    case 'list': {
      const type = String(block.get('prop:type') ?? 'bulleted');
      let marker = '-';
      if (type === 'numbered') marker = '1.';
      else if (type === 'todo') {
        marker = block.get('prop:checked') ? '- [x]' : '- [ ]';
      }
      lines.push(`${indent}${marker === '-' ? '- ' : marker + ' '}${text}`);
      break;
    }
    case 'code': {
      const lang = String(block.get('prop:language') ?? '');
      lines.push('```' + lang, text, '```');
      break;
    }
    case 'divider':
      lines.push('---');
      break;
    case 'image':
    case 'attachment':
    case 'bookmark':
      lines.push(`_[${bare}]_`);
      break;
    default:
      if (text) lines.push(text);
      break;
  }

  // Nested children (e.g. indented list items) render one level deeper.
  const nextDepth = bare === 'list' ? depth + 1 : depth;
  for (const child of childrenOf(block)) {
    renderBlock(blocks, child, nextDepth, lines);
  }
}

/** The doc's title (root block's `prop:title`). */
export function docTitle(doc: Y.Doc): string {
  const blocks = blocksMap(doc);
  const rootId = findRoot(blocks);
  const root = rootId ? blocks.get(rootId) : undefined;
  return root ? renderText(root.get('prop:title')) : '';
}

/** Render a page doc's block tree to markdown. */
export function docToMarkdown(doc: Y.Doc): string {
  const blocks = blocksMap(doc);
  const rootId = findRoot(blocks);
  if (!rootId) return '';
  const lines: string[] = [];
  renderBlock(blocks, rootId, 0, lines);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
