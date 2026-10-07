import {
  BLOCK_ID_ATTR,
  WidgetComponent,
  WidgetViewExtension,
} from '@blocksuite/notesgraph/std';
import type { BlockModel, ExtensionType } from '@blocksuite/notesgraph/store';
import type { FrameworkProvider } from '@notesgraph/infra';
import { css, html, nothing, svg } from 'lit';
import { state } from 'lit/decorators.js';
import { literal, unsafeStatic } from 'lit/static-html.js';

import {
  type AgentRun,
  AgentRunsStore,
  formatTrendValue,
  hasAgentClaim,
  type Monitor,
  MonitorsService,
  runsForBlock,
  sparklinePath,
  type Trend,
} from '../../../modules/agents';
import { WorkspaceDialogService } from '../../../modules/dialogs';
import { AgentsFrameworkIdentifier } from './framework';

const WIDGET_TAG = 'notesgraph-block-agent-runs-widget';

/** Gap kept between the end of the line's text and the chips. */
const GAP_PX = 8;

/** Size of the readings sparkline on a monitor's chip. */
const TREND_WIDTH = 36;
const TREND_HEIGHT = 12;

/**
 * A small chip at the end of a block an agent was put on — run on it directly,
 * or claimed by one working down the list it sits in — that opens the runs
 * that worked on it.
 */
export class BlockAgentRunsWidget extends WidgetComponent {
  static override styles = css`
    /* float at the trailing edge of the block, on the last line of its text;
       _place drops it onto a line of its own when the text runs under it */
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
    .ng-agent-runs-chip[data-single] {
      padding: 0 4px;
      border-radius: 999px;
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
    .ng-agent-runs-chips {
      display: inline-flex;
      gap: 4px;
    }
    .ng-monitor-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--notesgraph-success-color, #10b981);
    }
    .ng-monitor-dot[data-state='error'] {
      background: var(--notesgraph-error-color, #eb4335);
    }
    .ng-monitor-dot[data-state='paused'] {
      background: var(--notesgraph-text-disable-color, #a9a9ad);
    }
    .ng-monitor-trend path {
      fill: none;
      stroke: currentColor;
      stroke-width: 1.25;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .ng-monitor-trend-value {
      font-variant-numeric: tabular-nums;
    }
  `;

  private _framework: FrameworkProvider | null = null;

  /** Every run on this note; which ones are this block's is worked out in render. */
  @state()
  private accessor docRuns: AgentRun[] = [];

  /** Monitors writing into this block. */
  @state()
  private accessor monitors: Monitor[] = [];

  /** Each monitor's numeric readings over time, once fetched. */
  @state()
  private accessor trends = new Map<string, Trend | null>();

  override firstUpdated() {
    const framework = this.std.getOptional(AgentsFrameworkIdentifier);
    if (!framework) return;
    this._framework = framework;
    let runsStore: AgentRunsStore;
    let monitorsService: MonitorsService;
    try {
      runsStore = framework.get(AgentRunsStore);
      monitorsService = framework.get(MonitorsService);
    } catch {
      // No workspace scope (e.g. a detached editor).
      return;
    }
    const sub = runsStore
      .watchRunsForDoc(this.std.store.id)
      .subscribe(runs => (this.docRuns = runs));
    this._disposables.add(() => sub.unsubscribe());

    const docId = this.std.store.id;
    const monitorsSub = monitorsService.monitors$.subscribe(all => {
      const mine = all.filter(
        m => m.docId === docId && m.blockId === this.model.id
      );
      // Most blocks have none: don't re-render them on every refresh.
      if (mine.length || this.monitors.length) this.monitors = mine;
      for (const monitor of mine) {
        monitorsService
          .trend(monitor)
          .then(trend => {
            if (this.trends.get(monitor.id) === trend) return;
            this.trends = new Map(this.trends).set(monitor.id, trend);
          })
          .catch(() => {});
      }
    });
    this._disposables.add(() => monitorsSub.unsubscribe());
    this._disposables.add(monitorsService.watch());

    // Where the text ends moves with edits and with the editor's width.
    const editor = this._lineEditor();
    if (editor) {
      const observer = new ResizeObserver(this._schedulePlace);
      observer.observe(editor);
      this._disposables.add(() => observer.disconnect());
    }
    const yText = this.model.text?.yText;
    if (yText) {
      yText.observe(this._schedulePlace);
      this._disposables.add(() => yText.unobserve(this._schedulePlace));
    }
    this._disposables.add(() => this._reserveLine(0));
  }

  override updated() {
    this._schedulePlace();
  }

  private _placeFrame = 0;

  /** Whether the last placement moved the chips or reserved room for them. */
  private _placed = false;

  private readonly _schedulePlace = () => {
    // Most blocks show no chips: nothing to measure, and nothing to undo
    // unless an earlier placement did something.
    if (!this.offsetWidth && !this._placed) return;
    // The line's text re-renders on its own schedule after an edit; measure
    // once it has, not against the text as it was.
    cancelAnimationFrame(this._placeFrame);
    this._placeFrame = requestAnimationFrame(() => this._place());
  };

  /** The inline editor of this block's own line (it comes before its children). */
  private _lineEditor(): HTMLElement | null {
    return (
      this.parentElement
        ?.closest(`[${BLOCK_ID_ATTR}]`)
        ?.querySelector<HTMLElement>('rich-text .inline-editor') ?? null
    );
  }

  /** Room under the line's text for the chips, so they don't sit on the next block. */
  private _reserveLine(height: number) {
    const wrapper = this._lineEditor()?.closest('rich-text')?.parentElement;
    if (wrapper) wrapper.style.paddingBottom = height ? `${height}px` : '';
  }

  /**
   * Sit at the trailing edge of the text's last line when there is room after
   * it; otherwise break onto a line of its own under the text.
   */
  private _place() {
    const parent = this.offsetParent;
    const editor = this._lineEditor();
    const width = this.offsetWidth;
    if (!parent || !editor || !width) {
      this.style.transform = '';
      this._reserveLine(0);
      this._placed = false;
      return;
    }
    this._placed = true;

    const range = document.createRange();
    range.selectNodeContents(editor);
    const rects = range.getClientRects();
    const end = rects[rects.length - 1];
    const box = parent.getBoundingClientRect();
    const height = this.offsetHeight;
    if (!end || end.right + GAP_PX + width <= box.right) {
      this._reserveLine(0);
      // On a one-line block the first-line placement from the styles is right.
      this.style.transform =
        !end || end.top === rects[0].top
          ? ''
          : `translateY(${end.top - box.top + (end.height - height) / 2}px)`;
      return;
    }
    this._reserveLine(height);
    this.style.transform = `translateY(${end.bottom - box.top}px)`;
  }

  /**
   * Keep a tap on a chip out of the editor: on a phone it would otherwise put
   * the caret in the line and raise the keyboard, and the click is lost.
   */
  private readonly _holdFocus = (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  private readonly _openMonitor =(e: Event, monitor: Monitor) => {
    e.preventDefault();
    e.stopPropagation();
    this._framework?.get(WorkspaceDialogService).open('monitor-editor', {
      docId: monitor.docId,
      blockId: monitor.blockId,
      monitorId: monitor.id,
    });
  };

  private renderMonitor(monitor: Monitor) {
    const state = !monitor.enabled ? 'paused' : monitor.lastError ? 'error' : 'ok';
    const title = !monitor.enabled
      ? `${monitor.name}: paused${monitor.lastError ? ` (${monitor.lastError})` : ''}`
      : monitor.lastError
        ? `${monitor.name}: last check failed: ${monitor.lastError}`
        : `${monitor.name}: monitored, next check ${new Date(monitor.nextRunAt * 1000).toLocaleTimeString()}`;
    return html`<span
      class="ng-agent-runs-chip"
      title=${title}
      data-testid="block-monitor"
      @click=${(e: Event) => this._openMonitor(e, monitor)}
      @pointerdown=${this._holdFocus}
      @mousedown=${(e: Event) => e.stopPropagation()}
      ><span class="ng-monitor-dot" data-state=${state}></span>📡${this.renderTrend(
        monitor
      )}</span
    >`;
  }

  /** A sparkline of its numeric readings and the latest one. */
  private renderTrend(monitor: Monitor) {
    const trend = this.trends.get(monitor.id);
    if (!trend) return nothing;
    return html`<svg
        class="ng-monitor-trend"
        data-testid="block-monitor-trend"
        width=${TREND_WIDTH}
        height=${TREND_HEIGHT}
        viewBox="0 0 ${TREND_WIDTH} ${TREND_HEIGHT}"
        aria-hidden="true"
      >
        ${svg`<path d=${sparklinePath(trend, TREND_WIDTH, TREND_HEIGHT)} />`}
      </svg>
      <span class="ng-monitor-trend-value"
        >${formatTrendValue(trend.latest)}</span
      >`;
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
    const monitors = this.monitors;
    if (runs.length === 0 && monitors.length === 0) return nothing;
    const running = runs.some(run => run.status === 'running');
    // One run needs no words: the robot in a round bullet, named on hover.
    const single = runs.length === 1;
    const title = single
      ? `Show the run by ${runs[0].agentName} on this block`
      : 'Show the agent runs on this block';
    // One widget for both chips, so they sit side by side at the line's end
    // rather than two floating widgets landing on top of each other.
    return html`<span class="ng-agent-runs-chips"
      >${monitors.map(monitor => this.renderMonitor(monitor))}${runs.length
        ? html`<span
            class="ng-agent-runs-chip"
            title=${title}
            aria-label=${title}
            data-testid="block-agent-runs"
            ?data-single=${single}
            @click=${(e: Event) => this._open(e, runs)}
            @pointerdown=${this._holdFocus}
            @mousedown=${(e: Event) => e.stopPropagation()}
            >${running
              ? html`<span class="ng-agent-runs-dot"></span>`
              : nothing}🤖${single ? nothing : ` ${runs.length} agent runs`}</span
          >`
        : nothing}</span
    >`;
  }
}

if (!customElements.get(WIDGET_TAG)) {
  customElements.define(WIDGET_TAG, BlockAgentRunsWidget);
}

/**
 * Editor extensions for the runs chip: the widget on paragraph and list
 * blocks. It reaches the framework through AgentsFrameworkIdentifier, which
 * AgentsViewExtension binds.
 */
export function agentRunsWidgetExtensions(): ExtensionType[] {
  return [
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
