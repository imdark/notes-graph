import { AiOutlineIcon, AiThinkingIcon } from '@blocksuite/icons/rc';
import { ServerFeature } from '@notesgraph/graphql';
import { effect, Entity, LiveData, onStart } from '@notesgraph/infra';
import { truncate } from 'lodash-es';
import {
  catchError,
  combineLatest,
  map,
  of,
  startWith,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';

import { askAgent } from '../../../utils/ask-agent';
import type { WorkspaceServerService } from '../../cloud';
import type { DocsService } from '../../doc';
import type { DocDisplayMetaService } from '../../doc-display-meta';
import type { DocsSearchService } from '../../docs-search';
import { parseSearchQuery } from '../../docs-search/utils/search-query';
import type { FeatureFlagService } from '../../feature-flag';
import type { WorkbenchService } from '../../workbench';
import type { WorkspaceService } from '../../workspace';
import type { QuickSearchSession } from '../providers/quick-search-provider';
import type { QuickSearchItem } from '../types/item';

interface AskGraphDocPayload {
  docId: string;
  blockId?: string | undefined;
  blockContent?: string | undefined;
}

/** The "Ask the agent" row runs like a command, so cmdk.ts needs no case for it. */
interface AskGraphAgentPayload {
  run: () => void;
}

type AskGraphItem =
  | QuickSearchItem<'docs', AskGraphDocPayload>
  | QuickSearchItem<'commands', AskGraphAgentPayload>;

/** Prefix that switches Ctrl-K into "ask the graph" mode: `? how do I deploy`. */
export const ASK_GRAPH_PREFIX = '?';

/** Docs carrying any of these inline tags are treated as learnings. */
export const LEARNING_TAGS = ['learning', 'learnings', 'lesson', 'til'];

const MAX_PER_GROUP = 8;

/**
 * Ask-the-graph mode for Ctrl-K. A query starting with `?` retrieves, across
 * the whole workspace, the learnings (docs tagged #learning, #lesson, #til)
 * that match the question, followed by any other notes that match, so earlier
 * knowledge surfaces before the user rewrites it. Without the prefix it stays
 * silent and the normal docs search handles the query.
 *
 * Above those results sits an "Ask the agent" row: it opens AI chat with the
 * question, and the chat model searches the graph itself (keyword and
 * semantic search tools) for learnings before it answers.
 */
export class AskGraphQuickSearchSession
  extends Entity
  implements QuickSearchSession<'docs' | 'commands', any>
{
  constructor(
    private readonly workspaceServerService: WorkspaceServerService,
    private readonly docsSearchService: DocsSearchService,
    private readonly docsService: DocsService,
    private readonly docDisplayMetaService: DocDisplayMetaService,
    private readonly workspaceService: WorkspaceService,
    private readonly workbenchService: WorkbenchService,
    private readonly featureFlagService: FeatureFlagService
  ) {
    super();
  }

  private readonly isQueryLoading$ = new LiveData(false);

  isLoading$ = this.isQueryLoading$;

  error$ = new LiveData<any>(null);

  items$ = new LiveData<QuickSearchItem<'docs' | 'commands', any>[]>([]);

  private prefer(): 'remote' | 'local' {
    return this.workspaceServerService.server?.config$.value.features.includes(
      ServerFeature.Indexer
    )
      ? 'remote'
      : 'local';
  }

  private canAskAgent() {
    const flags = this.featureFlagService.flags;
    return (
      flags.enable_ai.value &&
      flags.enable_cmdk_ask_agent.value &&
      !!this.workspaceServerService.server?.features$.value.copilot
    );
  }

  private agentItem(question: string): AskGraphItem {
    return {
      id: 'ask-graph:agent',
      source: 'commands',
      group: {
        id: 'ask-graph-agent',
        label: { i18nKey: 'com.notesgraph.quicksearch.group.ask-graph-agent' },
        score: 11,
      },
      label: {
        title: {
          i18nKey: 'com.notesgraph.quicksearch.ask-graph-agent',
          options: { query: truncate(question) },
        },
        subTitle: {
          i18nKey: 'com.notesgraph.quicksearch.ask-graph-agent.hint',
        },
      },
      score: 1,
      icon: AiOutlineIcon,
      payload: {
        run: () => {
          askAgent(this.workspaceService.workspace.id, question);
          this.workbenchService.workbench.open('/chat');
        },
      },
    };
  }

  query = effect(
    throttleTime<string>(500, undefined, { leading: false, trailing: true }),
    switchMap((query: string) => {
      const trimmed = query.trim();
      if (!trimmed.startsWith(ASK_GRAPH_PREFIX)) {
        return of({ items: [] as AskGraphItem[] });
      }
      const text = parseSearchQuery(
        trimmed.slice(ASK_GRAPH_PREFIX.length)
      ).text.trim();
      if (text.length < 2) {
        return of({ items: [] as AskGraphItem[] });
      }
      const agent = this.canAskAgent() ? [this.agentItem(text)] : [];
      const prefer = this.prefer();
      const learnings$ = this.docsSearchService.search$(text, prefer, {
        text,
        tags: LEARNING_TAGS,
        props: [],
        docs: [],
        dates: [],
        include: [],
        exclude: [],
        kinds: [],
        notKinds: [],
      });
      const related$ = this.docsSearchService.search$(text, prefer);
      return combineLatest([learnings$, related$]).pipe(
        onStart(() => {
          this.error$.next(null);
          this.isQueryLoading$.next(true);
        }),
        map(([learnings, related]) => {
          const seen = new Set<string>();
          const build = (
            docs: typeof learnings,
            groupId: string,
            i18nKey: string,
            groupScore: number
          ) =>
            docs
              .filter(doc => {
                if (seen.has(doc.docId)) return false;
                return !!this.docsService.list.doc$(doc.docId).value;
              })
              .slice(0, MAX_PER_GROUP)
              .map(doc => {
                seen.add(doc.docId);
                const record = this.docsService.list.doc$(doc.docId).value!;
                const { title, updatedDate } =
                  this.docDisplayMetaService.getDocDisplayMeta(record);
                return {
                  id: `ask-graph:${groupId}:${doc.docId}`,
                  source: 'docs',
                  group: {
                    id: groupId,
                    label: { i18nKey, options: { query: truncate(text) } },
                    score: groupScore,
                  },
                  label: { title, subTitle: doc.blockContent },
                  score: doc.score,
                  icon: AiThinkingIcon,
                  timestamp: updatedDate,
                  payload: doc,
                } as AskGraphItem;
              });
          return {
            items: [
              ...agent,
              ...build(
                learnings,
                'ask-graph-learnings',
                'com.notesgraph.quicksearch.group.ask-graph-learnings',
                10
              ),
              ...build(
                related,
                'ask-graph-related',
                'com.notesgraph.quicksearch.group.ask-graph-related',
                9
              ),
            ],
          };
        }),
        // show the agent row while the searches run
        startWith({ items: agent }),
        catchError(err => {
          this.error$.next(err instanceof Error ? err.message : err);
          return of({ items: agent });
        })
      );
    }),
    tap(({ items }) => {
      this.items$.next(items);
      this.isQueryLoading$.next(false);
    })
  );

  override dispose(): void {
    this.query.unsubscribe();
  }
}
