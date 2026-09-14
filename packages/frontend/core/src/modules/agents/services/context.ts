import { Container } from '@blocksuite/notesgraph/global/di';
import {
  docLinkBaseURLMiddleware,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/notesgraph/shared/adapters';
import { parseOrgStatusPrefix } from '@blocksuite/notesgraph/shared/utils';
import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { AgentTarget } from './target';

/**
 * Hard cap on the doc markdown handed to a model, in characters. A long note
 * would otherwise blow the context window of a small on-device model and fail
 * the run outright; truncating loses the tail, which is recoverable, and the
 * agent is told the text was cut so it doesn't claim to have read it all.
 */
const MAX_DOC_CHARS = 12_000;

const HASHTAG_RE = /#([\p{L}\p{N}_-]+)(?::([\p{L}\p{N}._-]+))?/gu;

export interface AgentContext {
  /** The prose handed to the model. */
  text: string;
  /** Human-readable description of what was targeted, for the run record. */
  label: string;
}

/**
 * Turns an {@link AgentTarget} into the text an agent reads.
 *
 * Blocks arrive with the things that make a task legible on its own — its
 * checkbox/org status, its inline tags and properties, and the breadcrumb of
 * headings it sits under — because a bare "hosted vs open source" line means
 * nothing to a model without the heading above it.
 */
export class AgentContextService extends Service {
  constructor(private readonly docsService: DocsService) {
    super();
  }

  async build(target: AgentTarget): Promise<AgentContext> {
    const { doc, release } = this.docsService.open(target.docId);
    try {
      await doc.waitForSyncReady();
      const store = doc.blockSuiteDoc;
      const title = doc.title$.value || 'Untitled';

      if (target.kind === 'doc') {
        const markdown = await this.docMarkdown(store);
        const clipped = markdown.length > MAX_DOC_CHARS;
        return {
          label: `note "${title}"`,
          text: [
            `# Note: ${title}`,
            '',
            clipped ? markdown.slice(0, MAX_DOC_CHARS) : markdown,
            clipped ? '\n\n[note truncated]' : '',
          ]
            .join('\n')
            .trim(),
        };
      }

      const blockIds =
        target.kind === 'block' ? [target.blockId] : target.blockIds;
      const parts = blockIds
        .map(id => this.describeBlock(store, id))
        .filter((part): part is string => !!part);

      const label =
        target.kind === 'block'
          ? `a block in "${title}"`
          : `${blockIds.length} blocks in "${title}"`;

      return {
        label,
        text: [`Note: ${title}`, '', ...parts].join('\n').trim(),
      };
    } finally {
      release();
    }
  }

  /** The block's own text plus what makes it legible out of context. */
  private describeBlock(store: Store, blockId: string): string | null {
    const model = store.getBlock(blockId)?.model;
    if (!model) return null;
    const text = model.text?.toString().trim();
    if (!text) return null;

    const lines: string[] = [];
    const trail = this.ancestorTrail(store, model);
    if (trail) lines.push(`Under: ${trail}`);

    const props = model.props as { type?: string; checked?: boolean };
    const org = parseOrgStatusPrefix(text);
    if (org) {
      lines.push(`Status: ${org.statusText}`);
    } else if (props.type === 'todo') {
      lines.push(`Status: ${props.checked ? 'done' : 'not done'}`);
    }

    const { tags, properties } = this.collectTokens(text);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    if (properties.length) lines.push(`Properties: ${properties.join(', ')}`);

    lines.push('', text);
    return lines.join('\n');
  }

  /** Ancestor block text, outermost first — the headings this sits under. */
  private ancestorTrail(store: Store, model: BlockModel): string | null {
    const parts: string[] = [];
    let current = store.getParent(model);
    while (current && parts.length < 4) {
      const text = current.text?.toString().trim();
      if (text) parts.unshift(text.slice(0, 80));
      current = store.getParent(current);
    }
    return parts.length ? parts.join(' › ') : null;
  }

  /** Inline `#tag` and `#key:value` tokens, matching what the indexer stores. */
  private collectTokens(text: string) {
    const tags = new Set<string>();
    const properties = new Set<string>();
    for (const match of text.matchAll(HASHTAG_RE)) {
      if (match[2] !== undefined) {
        properties.add(`${match[1].toLowerCase()}:${match[2].toLowerCase()}`);
      } else {
        tags.add(match[1].toLowerCase());
      }
    }
    return { tags: [...tags], properties: [...properties] };
  }

  /**
   * Whole-note markdown, via the same adapter path the mobile bridge uses, so
   * an agent sees a note the way an export would render it.
   */
  private async docMarkdown(store: Store): Promise<string> {
    const transformer = store.getTransformer([
      docLinkBaseURLMiddleware(store.workspace.id),
      titleMiddleware(store.workspace.meta.docMetas),
    ]);
    const snapshot = transformer.docToSnapshot(store);
    if (!snapshot) return '';

    const container = new Container();
    getStoreManager()
      .config.init()
      .value.get('store')
      .forEach(ext => ext.setup(container));

    const adapter = new MarkdownAdapter(transformer, container.provider());
    const result = await adapter.fromDocSnapshot({
      snapshot,
      assets: transformer.assetsManager,
    });
    return result.file;
  }
}
