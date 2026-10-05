import { type Container, createIdentifier } from '@blocksuite/global/di';
import {
  WidgetComponent,
  WidgetViewExtension,
} from '@blocksuite/notesgraph/std';
import type { BlockModel, ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';
import { css, html, nothing } from 'lit';
import { state } from 'lit/decorators.js';
import { literal, unsafeStatic } from 'lit/static-html.js';

import {
  type AgentRun,
  AgentRunsStore,
  hasAgentClaim,
  runsForBlock,
} from '../../../modules/agents';
import { WorkspaceDialogService } from '../../../modules/dialogs';

/** Bridges the core framework into the editor so the widget can reach runs. */
export const AgentsFrameworkIdentifier = createIdentifier<FrameworkProvider>(
  'NotesGraphAgentsFramework'
);

const WIDGET_TAG = 'notesgraph-block-agent-runs-widget';

/**
 * A small chip at the end of a block an agent was put on — run on it directly,
 * or claimed by one working down the list it sits in — that opens the runs
 * that worked on it.
 */
export class BlockAgentRunsWidget extends WidgetComponent {
  static override styles = css`
    /* float at the trailing edge of the block, on its first line, like the
       schedule chip */
    :host {
      position: absolute;
      top: 0;
      right: 0;
      display: flex;
      align-items: center;
      height: 1.6em;
      z-index: 1;
      pointer-events: none;
    }
    .ng-agent-runs-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      font-size: 12px;
      line-height: 1.6;
      color: var(--notesgraph-text-secondary-color);
      background: var(--notesgraph-hover-color, rgba(0, 0, 0, 0.04));
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
      pointer-events: auto;
    }
    .ng-agent-runs-chip:hover {
      color: var(--notesgraph-primary-color);
    }
    .ng-agent-runs-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--notesgraph-primary-color, #1e96eb);
    }
  `;

  private _framework: FrameworkProvider | null = null;

  /** Every run on this note; which ones are this block's is worked out in render. */
  @state()
  private accessor docRuns: AgentRun[] = [];

  override firstUpdated() {
    const framework = this.std.getOptional(AgentsFrameworkIdentifier);
    if (!framework) return;
    this._framework = framework;
    let runsStore: AgentRunsStore;
    try {
      runsStore = framework.get(AgentRunsStore);
    } catch {
      // No workspace scope (e.g. a detached editor).
      return;
    }
    const sub = runsStore
      .watchRunsForDoc(this.std.store.id)
      .subscribe(runs => (this.docRuns = runs));
    this._disposables.add(() => sub.unsubscribe());
  }

  private get blockRuns(): AgentRun[] {
    if (this.docRuns.length === 0) return [];
    const ancestorIds: string[] = [];
    let parent: BlockModel | null = this.std.store.getParent(this.model);
    while (parent) {
      ancestorIds.push(parent.id);
      parent = this.std.store.getParent(parent);
    }
    // Read through the signal so a claim typed or synced in re-renders this.
    const delta = this.model.text?.deltas$.value ?? [];
    return runsForBlock(
      this.docRuns,
      this.model.id,
      ancestorIds,
      hasAgentClaim(delta)
    );
  }

  private readonly _open = (e: Event, runs: AgentRun[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (!this._framework) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this._framework.get(WorkspaceDialogService).open('agent-block-runs', {
      runIds: runs.map(run => run.id),
      position: [rect.left, rect.top, rect.width, rect.height],
    });
  };

  override render() {
    const runs = this.blockRuns;
    if (runs.length === 0) return nothing;
    const running = runs.some(run => run.status === 'running');
    const label =
      runs.length === 1 ? runs[0].agentName : `${runs.length} agent runs`;
    return html`<span
      class="ng-agent-runs-chip"
      title="Show the agent runs on this block"
      data-testid="block-agent-runs"
      @click=${(e: Event) => this._open(e, runs)}
      @mousedown=${(e: Event) => e.stopPropagation()}
      >${running ? html`<span class="ng-agent-runs-dot"></span>` : nothing}🤖
      ${label}</span
    >`;
  }
}

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, BlockAgentRunsWidget);
}

/**
 * Editor extensions for the runs chip: a DI binding that exposes the
 * framework, plus the widget on paragraph and list blocks.
 */
export function agentRunsWidgetExtensions(
  framework: FrameworkProvider
): ExtensionType[] {
  return [
    {
      setup: (di: Container) => {
        di.addImpl(AgentsFrameworkIdentifier, () => framework);
      },
    },
    WidgetViewExtension(
      'notesgraph:paragraph',
      WIDGET_TAG,
      literal`${unsafeStatic(WIDGET_TAG)}`
    ),
    WidgetViewExtension(
      'notesgraph:list',
      WIDGET_TAG,
      literal`${unsafeStatic(WIDGET_TAG)}`
    ),
  ];
}
