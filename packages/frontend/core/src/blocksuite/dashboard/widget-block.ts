import { BlockComponent } from '@blocksuite/notesgraph/std';
import type { FrameworkProvider } from '@notesgraph/infra';
import {
  css,
  html,
  nothing,
  type PropertyValues,
  svg,
  type TemplateResult,
} from 'lit';
import { state } from 'lit/decorators.js';
import { styleMap } from 'lit/directives/style-map.js';

import type { Monitor, MonitorReading } from '../../modules/agents';
import { MonitorsService } from '../../modules/agents/services/monitors';
import { readTaskStatus } from '../../modules/agents/services/task-claim';
import {
  type ChartPoint,
  chartSeries,
  countTaskStatuses,
  formatValue,
  parseReadingValue,
  type StatusCount,
  valueDomain,
} from './chart-data';
import { stopEditorEvents } from './dashboard-block';
import { DashboardFrameworkIdentifier } from './framework';
import {
  DashboardBlockFlavour,
  MAX_DASHBOARD_COLUMNS,
  type WidgetBlockModel,
  type WidgetBlockProps,
  type WidgetKind,
} from './model';

export const WIDGET_BLOCK_TAG = 'notesgraph-widget-block';

const KIND_LABELS: Record<WidgetKind, string> = {
  stat: 'Latest value',
  line: 'Line chart',
  bar: 'Bar chart',
  tasks: 'Tasks by status',
};

const POINT_OPTIONS = [10, 30, 100];

/** The plot's drawing box; it stretches to the tile, the stroke doesn't. */
const PLOT_W = 300;
const PLOT_H = 100;

const formatTime = (at: number) =>
  new Date(at * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * A chart tile: a monitor's latest value, its readings as a line or bars, or
 * this note's tasks counted by status. Configured from the gear in its
 * corner; it reads monitors through the framework, so outside the app (an
 * export, a preview) it shows only its frame.
 */
export class WidgetBlockComponent extends BlockComponent<WidgetBlockModel> {
  static override styles = css`
    notesgraph-widget-block {
      display: block;
      margin: 8px 0;
    }
    .ng-widget {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-height: 96px;
      user-select: none;
      font-size: 13px;
      color: var(--notesgraph-text-primary-color);
    }
    .ng-widget[data-standalone='true'] {
      border: 1px solid var(--notesgraph-border-color);
      border-radius: 8px;
      padding: 8px 12px;
    }
    .ng-widget-header {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .ng-widget-title {
      flex: 1;
      min-width: 0;
      font-weight: 600;
      font-size: 13px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ng-widget-sub {
      font-size: 11px;
      color: var(--notesgraph-text-secondary-color);
      white-space: nowrap;
    }
    .ng-widget-gear {
      border: none;
      background: transparent;
      color: var(--notesgraph-text-secondary-color);
      cursor: pointer;
      padding: 0 2px;
      font-size: 13px;
      opacity: 0;
    }
    .ng-widget:hover .ng-widget-gear,
    .ng-widget-gear[data-open='true'] {
      opacity: 1;
    }
    @media (hover: none) {
      .ng-widget-gear {
        opacity: 1;
      }
    }
    .ng-widget-gear:hover {
      color: var(--notesgraph-primary-color);
    }
    .ng-widget-message {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-size: 12px;
      color: var(--notesgraph-text-secondary-color);
    }
    .ng-widget-settings {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 6px 8px;
      align-items: center;
      font-size: 12px;
      padding: 6px 0;
      border-top: 1px solid var(--notesgraph-border-color);
      border-bottom: 1px solid var(--notesgraph-border-color);
    }
    .ng-widget-settings label {
      color: var(--notesgraph-text-secondary-color);
    }
    .ng-widget-settings select,
    .ng-widget-settings input {
      min-width: 0;
      font-size: 12px;
      padding: 2px 4px;
      border: 1px solid var(--notesgraph-border-color);
      border-radius: 4px;
      background: var(--notesgraph-background-primary-color);
      color: var(--notesgraph-text-primary-color);
    }
    .ng-widget-settings .ng-widget-hint {
      grid-column: 1 / -1;
      color: var(--notesgraph-text-secondary-color);
    }
    .ng-widget-settings button {
      justify-self: start;
      font-size: 12px;
      border: 1px solid var(--notesgraph-border-color);
      background: transparent;
      color: var(--notesgraph-text-secondary-color);
      border-radius: 4px;
      padding: 1px 8px;
      cursor: pointer;
    }
    /* stat */
    .ng-widget-stat-value {
      font-size: 28px;
      font-weight: 600;
      line-height: 1.2;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ng-widget-stat-delta {
      font-size: 12px;
      color: var(--notesgraph-text-secondary-color);
      font-variant-numeric: tabular-nums;
    }
    /* plots */
    .ng-widget-plot {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      grid-template-rows: minmax(0, 1fr) auto;
      gap: 2px 6px;
      flex: 1;
      min-height: 90px;
    }
    .ng-widget-plot[data-sparkline='true'] {
      min-height: 32px;
      grid-template-columns: minmax(0, 1fr);
    }
    .ng-widget-axis-y {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      font-size: 10px;
      color: var(--notesgraph-text-secondary-color);
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
    .ng-widget-axis-x {
      grid-column: 2;
      display: flex;
      justify-content: space-between;
      font-size: 10px;
      color: var(--notesgraph-text-secondary-color);
    }
    .ng-widget-canvas {
      position: relative;
      min-height: 0;
      border-bottom: 1px solid var(--notesgraph-border-color);
    }
    .ng-widget-canvas svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
    }
    .ng-widget-hits {
      position: absolute;
      inset: 0;
      display: flex;
    }
    .ng-widget-hits > div {
      flex: 1;
      position: relative;
    }
    /* the crosshair: a hairline at the hovered reading */
    .ng-widget-hits > div:hover::after {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      border-left: 1px solid var(--notesgraph-text-secondary-color);
      opacity: 0.6;
    }
    .ng-widget-end-dot {
      position: absolute;
      width: 8px;
      height: 8px;
      margin: -6px 0 0 -6px;
      border-radius: 50%;
      background: var(--notesgraph-primary-color);
      border: 2px solid var(--notesgraph-background-primary-color);
      pointer-events: none;
    }
    .ng-widget-bars {
      position: absolute;
      inset: 0;
      display: flex;
      gap: 2px;
    }
    .ng-widget-bars > div {
      flex: 1;
      position: relative;
      min-width: 0;
    }
    .ng-widget-bars > div > span {
      position: absolute;
      left: 50%;
      width: 100%;
      max-width: 24px;
      transform: translateX(-50%);
      background: var(--notesgraph-primary-color);
      border-radius: 4px 4px 0 0;
    }
    .ng-widget-bars > div > span[data-negative='true'] {
      border-radius: 0 0 4px 4px;
    }
    .ng-widget-bars > div:hover > span {
      opacity: 0.75;
    }
    /* tasks */
    .ng-widget-tasks {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      gap: 4px 8px;
      align-items: center;
      font-size: 12px;
    }
    .ng-widget-tasks .ng-label {
      color: var(--notesgraph-text-secondary-color);
      white-space: nowrap;
    }
    .ng-widget-tasks .ng-track {
      height: 10px;
    }
    .ng-widget-tasks .ng-fill {
      height: 100%;
      min-width: 2px;
      background: var(--notesgraph-primary-color);
      border-radius: 0 4px 4px 0;
    }
    .ng-widget-tasks .ng-count {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `;

  private _framework: FrameworkProvider | null = null;
  private _monitors: MonitorsService | null = null;

  @state()
  private accessor monitors: Monitor[] = [];

  @state()
  private accessor monitorsError: string | null = null;

  @state()
  private accessor readings: MonitorReading[] = [];

  @state()
  private accessor readingsError: string | null = null;

  @state()
  private accessor loading = false;

  @state()
  private accessor taskCounts: StatusCount[] = [];

  @state()
  private accessor settingsOpen = false;

  /** Which monitor run `readings` came from, so a new reading refetches. */
  private _readingsKey = '';

  override connectedCallback() {
    super.connectedCallback();
    // A new, unconfigured chart opens its settings.
    if (
      !this.store.readonly &&
      this.model.props.kind !== 'tasks' &&
      !this.model.props.monitorId
    ) {
      this.settingsOpen = true;
    }
  }

  override firstUpdated() {
    this._framework = this.std.getOptional(DashboardFrameworkIdentifier);
    if (this._framework) {
      try {
        this._monitors = this._framework.get(MonitorsService);
      } catch {
        // No workspace scope (e.g. a detached editor).
      }
    }
    if (this._monitors) {
      const monitors = this._monitors;
      const sub = monitors.monitors$.subscribe(all => {
        this.monitors = all;
        this._syncReadings();
      });
      this._disposables.add(() => sub.unsubscribe());
      const errorSub = monitors.error$.subscribe(
        error => (this.monitorsError = error)
      );
      this._disposables.add(() => errorSub.unsubscribe());
      this._disposables.add(monitors.watch());
    }

    // Tasks change as the note is typed in; recount a moment after edits.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onUpdate = () => {
      if (this.model.props.kind !== 'tasks' || timer) return;
      timer = setTimeout(() => {
        timer = null;
        this._countTasks();
      }, 300);
    };
    const doc = this.store.spaceDoc;
    doc.on('update', onUpdate);
    this._disposables.add(() => {
      doc.off('update', onUpdate);
      if (timer) clearTimeout(timer);
    });
    const propsSub = this.model.propsUpdated.subscribe(() => {
      this._syncReadings();
      if (this.model.props.kind === 'tasks') this._countTasks();
    });
    this._disposables.add(() => propsSub.unsubscribe());
    this._countTasks();
  }

  private get monitor(): Monitor | null {
    const id = this.model.props.monitorId;
    return (id && this.monitors.find(m => m.id === id)) || null;
  }

  private _countTasks() {
    if (this.model.props.kind !== 'tasks') return;
    const statuses: string[] = [];
    for (const model of this.store.getModelsByFlavour('notesgraph:list')) {
      const status = readTaskStatus(model);
      if (status) statuses.push(status.text);
    }
    this.taskCounts = countTaskStatuses(statuses);
  }

  /** Fetch the monitor's readings when it changes or takes a new one. */
  private _syncReadings() {
    const monitor = this.monitor;
    if (!this._monitors || !monitor || this.model.props.kind === 'tasks') {
      this._readingsKey = '';
      return;
    }
    const key = `${monitor.id}:${monitor.lastRunAt ?? 0}`;
    if (key === this._readingsKey) return;
    // Another monitor: don't chart the last one's readings while loading.
    if (!this._readingsKey.startsWith(`${monitor.id}:`)) this.readings = [];
    this._readingsKey = key;
    this.loading = true;
    this._monitors
      .readings(monitor.id)
      .then(readings => {
        if (this._readingsKey !== key) return;
        this.readings = readings;
        this.readingsError = null;
      })
      .catch(err => {
        if (this._readingsKey !== key) return;
        this.readingsError = err instanceof Error ? err.message : String(err);
      })
      .finally(() => {
        if (this._readingsKey === key) this.loading = false;
      });
  }

  private _update(props: Partial<WidgetBlockProps>) {
    if (this.store.readonly) return;
    this.store.updateBlock(this.model, props);
  }

  private get inDashboard(): boolean {
    return this.model.parent?.flavour === DashboardBlockFlavour;
  }

  override updated(changed: PropertyValues) {
    super.updated(changed);
    // Grid placement is the host's: it's the grid item in a dashboard.
    const span = Math.min(
      Math.max(Math.round(this.model.props.span$.value || 1), 1),
      MAX_DASHBOARD_COLUMNS
    );
    this.style.gridColumn = this.inDashboard ? `span ${span}` : '';
  }

  private renderSettings() {
    const props = this.model.props;
    const kind = props.kind$.value;
    const monitors = [...this.monitors].sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const onSelect =
      <K extends keyof WidgetBlockProps>(
        key: K,
        parse: (value: string) => WidgetBlockProps[K]
      ) =>
      (e: Event) =>
        this._update({
          [key]: parse((e.target as HTMLSelectElement).value),
        } as Partial<WidgetBlockProps>);

    return html`<div
      class="ng-widget-settings"
      contenteditable="false"
      @keydown=${stopEditorEvents}
      @beforeinput=${stopEditorEvents}
      @input=${stopEditorEvents}
      @paste=${stopEditorEvents}
      @pointerdown=${stopEditorEvents}
      @mousedown=${stopEditorEvents}
    >
      <label>Show</label>
      <select @change=${onSelect('kind', v => v as WidgetKind)}>
        ${(Object.keys(KIND_LABELS) as WidgetKind[]).map(
          k =>
            html`<option value=${k} ?selected=${k === kind}>
              ${KIND_LABELS[k]}
            </option>`
        )}
      </select>
      ${kind === 'tasks'
        ? nothing
        : html`<label>Monitor</label>
            <select
              @change=${onSelect('monitorId', v => v || null)}
              ?disabled=${monitors.length === 0}
            >
              <option value="" ?selected=${!props.monitorId$.value}>
                ${monitors.length ? 'Pick a monitor…' : 'No monitors yet'}
              </option>
              ${monitors.map(
                m =>
                  html`<option
                    value=${m.id}
                    ?selected=${m.id === props.monitorId$.value}
                  >
                    ${m.name}
                  </option>`
              )}
            </select>
            ${monitors.length === 0
              ? html`<div class="ng-widget-hint">
                  ${this.monitorsError ??
                  'Monitors chart the values a website or command reports. Type /Monitor on any line to create one, then pick it here.'}
                </div>`
              : nothing}
            ${kind === 'stat'
              ? nothing
              : html`<label>Readings</label>
                  <select @change=${onSelect('points', v => Number(v) || 30)}>
                    ${POINT_OPTIONS.map(
                      n =>
                        html`<option
                          value=${n}
                          ?selected=${n === props.points$.value}
                        >
                          Last ${n}
                        </option>`
                    )}
                  </select>`}`}
      <label>Title</label>
      <input
        .value=${props.title$.value ?? ''}
        placeholder=${kind === 'tasks'
          ? 'Tasks'
          : (this.monitor?.name ?? 'Untitled')}
        @change=${(e: Event) =>
          this._update({ title: (e.target as HTMLInputElement).value })}
      />
      ${this.inDashboard
        ? html`<label>Width</label>
            <select @change=${onSelect('span', v => Number(v) || 1)}>
              ${Array.from(
                { length: MAX_DASHBOARD_COLUMNS },
                (_, i) => i + 1
              ).map(
                n =>
                  html`<option value=${n} ?selected=${n === props.span$.value}>
                    ${n} column${n === 1 ? '' : 's'}
                  </option>`
              )}
            </select>`
        : nothing}
      <span></span>
      <button @click=${() => (this.settingsOpen = false)}>Done</button>
    </div>`;
  }

  private renderMessage(text: string) {
    return html`<div class="ng-widget-message">${text}</div>`;
  }

  /** Readings as a line; `sparkline` drops the axes for the stat tile. */
  private renderLine(series: ChartPoint[], sparkline = false) {
    const [lo, hi] = valueDomain(series);
    const x = (i: number) =>
      series.length === 1 ? PLOT_W / 2 : (i / (series.length - 1)) * PLOT_W;
    const y = (v: number) => PLOT_H - ((v - lo) / (hi - lo)) * PLOT_H;
    const points = series.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
    const area = `${x(0)},${PLOT_H} ${points} ${x(series.length - 1)},${PLOT_H}`;
    const last = series[series.length - 1];
    const plot = svg`<svg viewBox="0 0 ${PLOT_W} ${PLOT_H}" preserveAspectRatio="none" aria-hidden="true">
      <polygon points=${area} fill="var(--notesgraph-primary-color)" fill-opacity="0.1"></polygon>
      <polyline points=${points} fill="none" stroke="var(--notesgraph-primary-color)"
        stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
        vector-effect="non-scaling-stroke"></polyline>
    </svg>`;
    // One hover column per reading, centred on its point: the outer two hang
    // half a step past the plot's edges.
    const overhang = series.length > 1 ? `${-50 / (series.length - 1)}%` : '0';
    // The latest reading's dot, in HTML so the stretched plot doesn't squash it.
    const endDot = html`<span
      class="ng-widget-end-dot"
      style=${styleMap({
        left: `${(x(series.length - 1) / PLOT_W) * 100}%`,
        top: `${(y(last.value) / PLOT_H) * 100}%`,
      })}
    ></span>`;
    return this.renderPlot(
      series,
      html`${plot}${endDot}`,
      sparkline,
      lo,
      hi,
      html`<div
        class="ng-widget-hits"
        style=${styleMap({ left: overhang, right: overhang })}
      >
        ${series.map(
          p =>
            html`<div
              title=${`${formatValue(p.value)} · ${formatTime(p.at)}`}
            ></div>`
        )}
      </div>`
    );
  }

  /** Readings as bars from zero. */
  private renderBars(series: ChartPoint[]) {
    const [min, max] = valueDomain(series);
    const lo = Math.min(0, min);
    const hi = Math.max(0, max);
    const pct = (v: number) => `${(v / (hi - lo)) * 100}%`;
    const bars = html`<div class="ng-widget-bars">
      ${series.map(
        p =>
          html`<div title=${`${formatValue(p.value)} · ${formatTime(p.at)}`}>
            <span
              data-negative=${p.value < 0}
              style=${styleMap({
                bottom: pct(Math.min(p.value, 0) - lo),
                height: pct(Math.abs(p.value)),
              })}
            ></span>
          </div>`
      )}
    </div>`;
    return this.renderPlot(series, bars, false, lo, hi, nothing);
  }

  private renderPlot(
    series: ChartPoint[],
    marks: TemplateResult,
    sparkline: boolean,
    lo: number,
    hi: number,
    hits: TemplateResult | typeof nothing
  ) {
    const first = series[0];
    const last = series[series.length - 1];
    return html`<div
      class="ng-widget-plot"
      data-sparkline=${sparkline}
      role="img"
      aria-label=${`${series.length} readings from ${formatValue(lo)} to ${formatValue(hi)}`}
    >
      ${sparkline
        ? nothing
        : html`<div class="ng-widget-axis-y">
            <span>${formatValue(hi)}</span><span>${formatValue(lo)}</span>
          </div>`}
      <div class="ng-widget-canvas">${marks}${hits}</div>
      ${sparkline
        ? nothing
        : html`<div class="ng-widget-axis-x">
            <span>${formatTime(first.at)}</span>
            ${series.length > 1
              ? html`<span>${formatTime(last.at)}</span>`
              : nothing}
          </div>`}
    </div>`;
  }

  private renderStat(series: ChartPoint[]) {
    const monitor = this.monitor;
    const latest = series[series.length - 1];
    const previous = series[series.length - 2];
    // A value with no number in it (e.g. "in stock") still shows as text.
    const text =
      latest && parseReadingValue(monitor?.lastValue) !== null
        ? formatValue(latest.value)
        : (monitor?.lastValue ?? (latest ? formatValue(latest.value) : '—'));
    let delta: TemplateResult | typeof nothing = nothing;
    if (latest && previous) {
      const change = latest.value - previous.value;
      const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '■';
      const percent =
        previous.value !== 0
          ? ` (${change >= 0 ? '+' : ''}${formatValue((change / Math.abs(previous.value)) * 100)}%)`
          : '';
      delta = html`<div class="ng-widget-stat-delta">
        ${arrow} ${change >= 0 ? '+' : ''}${formatValue(change)}${percent} since
        ${formatTime(previous.at)}
      </div>`;
    }
    return html`<div
        class="ng-widget-stat-value"
        title=${monitor?.lastValue ?? ''}
      >
        ${text}
      </div>
      ${delta} ${series.length > 1 ? this.renderLine(series, true) : nothing}`;
  }

  private renderTasks() {
    const counts = this.taskCounts;
    if (counts.length === 0) {
      return this.renderMessage('No tasks in this note yet.');
    }
    const max = Math.max(...counts.map(c => c.count));
    return html`<div class="ng-widget-tasks" role="table">
      ${counts.map(
        c =>
          html`<span class="ng-label" role="rowheader">${c.label}</span>
            <div class="ng-track" title=${`${c.label}: ${c.count}`}>
              <div
                class="ng-fill"
                style=${styleMap({ width: `${(c.count / max) * 100}%` })}
              ></div>
            </div>
            <span class="ng-count" role="cell">${c.count}</span>`
      )}
    </div>`;
  }

  private renderBody() {
    const kind = this.model.props.kind$.value;
    if (kind === 'tasks') return this.renderTasks();
    if (!this._monitors) {
      return this.renderMessage('Charts show in the NotesGraph app.');
    }
    const monitor = this.monitor;
    if (!this.model.props.monitorId$.value) {
      return this.renderMessage('Pick a monitor in ⚙ to chart its values.');
    }
    if (!monitor) {
      return this.renderMessage(
        this.monitorsError ?? 'That monitor is gone or not loaded yet.'
      );
    }
    if (this.readingsError) return this.renderMessage(this.readingsError);
    const series = chartSeries(this.readings, this.model.props.points$.value);
    if (kind === 'stat') return this.renderStat(series);
    if (series.length === 0) {
      return this.renderMessage(
        this.loading
          ? 'Loading…'
          : this.readings.length
            ? 'Its values have no numbers to chart.'
            : 'No readings yet.'
      );
    }
    return kind === 'bar' ? this.renderBars(series) : this.renderLine(series);
  }

  override renderBlock() {
    const props = this.model.props;
    const kind = props.kind$.value;
    const monitor = kind === 'tasks' ? null : this.monitor;
    const title =
      props.title$.value ||
      (kind === 'tasks' ? 'Tasks' : monitor?.name) ||
      KIND_LABELS[kind];
    // Line and bar charts name their latest value; the stat tile is that value.
    const latest =
      (kind === 'line' || kind === 'bar') && monitor?.lastValue
        ? `${monitor.lastValue} · `
        : '';
    const sub =
      monitor?.lastRunAt != null
        ? `${latest}checked ${formatTime(monitor.lastRunAt)}`
        : kind === 'tasks'
          ? 'in this note'
          : '';
    return html`<div
      class="ng-widget"
      contenteditable="false"
      data-kind=${kind}
      data-standalone=${!this.inDashboard}
      data-testid="widget-block"
    >
      <div class="ng-widget-header">
        <span class="ng-widget-title" title=${title}>${title}</span>
        ${sub ? html`<span class="ng-widget-sub">${sub}</span>` : nothing}
        ${this.store.readonly
          ? nothing
          : html`<button
              class="ng-widget-gear"
              title="Chart settings"
              data-open=${this.settingsOpen}
              @pointerdown=${stopEditorEvents}
              @mousedown=${stopEditorEvents}
              @click=${() => (this.settingsOpen = !this.settingsOpen)}
            >
              ⚙
            </button>`}
      </div>
      ${this.settingsOpen ? this.renderSettings() : nothing}
      ${this.renderBody()}
    </div>`;
  }
}

if (!customElements.get(WIDGET_BLOCK_TAG)) {
  customElements.define(WIDGET_BLOCK_TAG, WidgetBlockComponent);
}
