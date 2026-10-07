import { Container } from '@blocksuite/notesgraph/global/di';
import {
  docLinkBaseURLMiddleware,
  MarkdownAdapter,
  titleMiddleware,
} from '@blocksuite/notesgraph/shared/adapters';
import type { BlockModel, Store } from '@blocksuite/notesgraph/store';
import { getStoreManager } from '@notesgraph/core/blocksuite/manager/store';
import { Service } from '@notesgraph/infra';

import type { DocsService } from '../../doc';
import type { AgentTarget } from './target';
import {
  QUEUED_STATUS,
  readTaskStatus,
  targetTaskIds,
  taskTitle,
  unfinishedTaskIds,
} from './task-claim';

/**
 * Hard cap on the doc markdown handed to a model, in characters. A long note
 * would otherwise blow the context window of a small on-device model and fail
 * the run outright; truncating loses the tail, which is recoverable, and the
 * agent is told the text was cut so it doesn't claim to have read it all.
 */
const MAX_DOC_CHARS = 12_000;

const HASHTAG_RE = /#([\p{L}\p{N}_-]+)(?::([\p{L}\p{N}._-]+))?/gu;

/** Org planning stamps and `@agent` claims: bookkeeping, not what a task says. */
const PLANNING_RE =
  /\b(?:SCHEDULED|DEADLINE|STARTED|CLOSED):\s*[<[][^>\]]*[>\]]|(?:^|\s)@[\w.-]+/g;

/** Longest run title taken from a block; the agent may name it better later. */
const TITLE_CHARS = 80;

export interface AgentContext {
  /** The prose handed to the model. */
  text: string;
  /** Human-readable description of what was targeted, for the run record. */
  label: string;
  /** What the run starts out called in run lists: the gist of its target. */
  title: string;
}

const clipTitle = (text: string) =>
  text.length > TITLE_CHARS ? `${text.slice(0, TITLE_CHARS - 1)}…` : text;

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

      const taskList = this.taskList(store, target);

      if (target.kind === 'doc') {
        const markdown = await this.docMarkdown(store);
        const clipped = markdown.length > MAX_DOC_CHARS;
        return {
          label: `note "${title}"`,
          title: clipTitle(title),
          text: [
            `# Note: ${title}`,
            '',
            clipped ? markdown.slice(0, MAX_DOC_CHARS) : markdown,
            clipped ? '\n\n[note truncated]' : '',
            taskList ? `\n${taskList}` : '',
          ]
            .join('\n')
            .trim(),
        };
      }

      const blockIds =
        target.kind === 'block' ? [target.blockId] : target.blockIds;
      const parts = blockIds
        .map(id => this.describeBlock(store, target.docId, id))
        .filter((part): part is string => !!part);

      const label =
        target.kind === 'block'
          ? `a block in "${title}"`
          : `${blockIds.length} blocks in "${title}"`;

      const first = blockIds
        .map(id => this.blockTitle(store, id))
        .find((text): text is string => !!text);
      const more = blockIds.length > 1 ? ` (+${blockIds.length - 1})` : '';

      return {
        label,
        title: first ? `${clipTitle(first)}${more}` : clipTitle(title),
        text: [
          `Note: ${title}`,
          '',
          ...parts,
          ...(taskList ? ['', taskList] : []),
        ]
          .join('\n')
          .trim(),
      };
    } finally {
      release();
    }
  }

  /**
   * A run on a list of tasks is asked to work the whole list, not just read
   * it: every task with its id and status, and what to do until all are done.
   * Null when the run is on one task or none. A pass that leaves some open is
   * followed by another (see AgentRunSessionService), which reads this afresh.
   */
  private taskList(store: Store, target: AgentTarget): string | null {
    const ids = targetTaskIds(store, target);
    if (ids.length < 2) return null;
    const open = unfinishedTaskIds(store, target).length;
    const lines = ids.map(id => {
      const model = store.getBlock(id)?.model;
      const status = model ? readTaskStatus(model)?.text : null;
      return `- ${status ?? '[ ]'} ${model ? taskTitle(model) : ''} (blockId: ${id})`;
    });
    return [
      `## Task list: ${open} of ${ids.length} not done yet (docId: ${target.docId})`,
      '',
      ...lines,
      '',
      'Work through every task above that is not done, one after another,',
      'until all of them are. For each: do it, then move it on in the note',
      '(update_task with its docId and blockId: committed once it is on a',
      'branch with a PR, done if there is nothing to ship) before moving on.',
      "If one can't be done, give it a status that says why (e.g. BLOCKED)",
      'with a note, and go on to the next rather than stopping.',
    ].join('\n');
  }

  /** A block's words without its status, tags or planning stamps. */
  private blockTitle(store: Store, blockId: string): string | null {
    const model = store.getBlock(blockId)?.model;
    const text = model?.text?.toString();
    if (!model || !text) return null;
    const status = readTaskStatus(model);
    const words = text
      .slice(status?.length ?? 0)
      .replace(PLANNING_RE, ' ')
      .replace(HASHTAG_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return words || null;
  }

  /** The block's own text plus what makes it legible out of context. */
  private describeBlock(
    store: Store,
    docId: string,
    blockId: string
  ): string | null {
    const model = store.getBlock(blockId)?.model;
    if (!model) return null;
    const text = model.text?.toString().trim();
    if (!text) return null;

    const lines: string[] = [];
    const trail = this.ancestorTrail(store, model);
    if (trail) lines.push(`Under: ${trail}`);

    // The chip, a typed annotation, or the native checkbox.
    const status = readTaskStatus(model);
    if (status?.text === QUEUED_STATUS) {
      // Marked queued when this run was asked for; it is this run's to do.
      lines.push(`Status: ${QUEUED_STATUS} (queued for you; not done yet)`);
    } else if (status) {
      lines.push(`Status: ${status.text}`);
    }
    if (status) {
      // The page that asked for the run may be closed by the time it ends,
      // so only the agent can be counted on to move the task off queued.
      lines.push(
        `Task: docId ${docId}, blockId ${blockId}. Keep its status current`,
        'with update_task: in-progress as you start, then where your work',
        'ended (committed once it is on a branch with a PR, done if there is',
        'nothing to ship, BLOCKED with a note if it cannot be done). Left as',
        'it is, it reads as never picked up.'
      );
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
