import { html, nothing, svg, type TemplateResult } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';

import {
  createUniComponentFromWebComponent,
  renderUniLit,
} from '../../../core/index.js';
import {
  DataViewUIBase,
  DataViewUILogicBase,
} from '../../../core/view/data-view-base.js';
import {
  type ChartBucket,
  foldDonutSlices,
  formatChartValue,
  niceAxisMax,
} from '../chart-data.js';
import {
  CHART_GROUPABLE_TYPES,
  CHART_NUMERIC_TYPES,
  type ChartSingleView,
} from '../chart-view-manager.js';
import type { ChartDateBucket, ChartKind, ChartMetricOp } from '../types.js';
import { chartViewStyles } from './styles.js';

const KIND_OPTIONS: { value: ChartKind; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'column', label: 'Column' },
  { value: 'line', label: 'Line' },
  { value: 'donut', label: 'Donut' },
  { value: 'number', label: 'Number' },
];

const OP_LABELS: Record<Exclude<ChartMetricOp, 'count'>, string> = {
  sum: 'Sum',
  avg: 'Average',
  min: 'Min',
  max: 'Max',
};

const BUCKET_OPTIONS: { value: ChartDateBucket; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
];

/** Gridlines on the value axis (besides the baseline). */
const TICKS = 4;

const seriesColor = (slot: number) =>
  `var(--dv-chart-series-${(slot % 8) + 1})`;

export class ChartViewUILogic extends DataViewUILogicBase<ChartSingleView> {
  clearSelection = () => {
    this.setSelection(undefined);
  };

  // A chart has no rows of its own to add to.
  addRow = () => undefined;

  focusFirstCell = () => {};

  showIndicator = () => false;

  hideIndicator = () => {};

  moveTo = () => {};

  renderer = createUniComponentFromWebComponent(ChartViewUI);
}

export class ChartViewUI extends DataViewUIBase<ChartViewUILogic> {
  static override styles = chartViewStyles;

  override connectedCallback(): void {
    super.connectedCallback();
    this.dataset['testid'] = 'dv-chart-view';
  }

  private get view() {
    return this.logic.view;
  }

  private onSelect(handler: (value: string) => void) {
    return (event: Event) =>
      handler((event.target as HTMLSelectElement).value);
  }

  private renderControls() {
    const view = this.view;
    const settings = view.settings$.value;
    const readonly = view.readonly$.value;
    const properties = view.propertiesRaw$.value;
    const groupable = properties.filter(p =>
      CHART_GROUPABLE_TYPES.has(p.type$.value)
    );
    const numeric = properties.filter(p =>
      CHART_NUMERIC_TYPES.has(p.type$.value)
    );
    const groupBy = view.groupByProperty$.value;
    const isNumber = settings.kind === 'number';
    const metricValue =
      view.metricOp$.value === 'count'
        ? 'count'
        : `${view.metricOp$.value}:${view.metricProperty$.value?.id}`;

    return html`<div class="dv-chart-controls">
      <label class="dv-chart-control">
        <span>Chart</span>
        <select
          data-testid="dv-chart-kind"
          ?disabled=${readonly}
          @change=${this.onSelect(kind =>
            view.settingsUpdate({ kind: kind as ChartKind })
          )}
        >
          ${KIND_OPTIONS.map(
            option =>
              html`<option
                value=${option.value}
                ?selected=${option.value === settings.kind}
              >
                ${option.label}
              </option>`
          )}
        </select>
      </label>
      <label class="dv-chart-control">
        <span>Show</span>
        <select
          data-testid="dv-chart-metric"
          ?disabled=${readonly}
          @change=${this.onSelect(value => {
            if (value === 'count') {
              view.settingsUpdate({ metric: { op: 'count' } });
              return;
            }
            const [op, propertyId] = value.split(':');
            view.settingsUpdate({
              metric: { op: op as ChartMetricOp, propertyId },
            });
          })}
        >
          <option value="count" ?selected=${metricValue === 'count'}>
            Count of rows
          </option>
          ${numeric.flatMap(property =>
            (Object.keys(OP_LABELS) as (keyof typeof OP_LABELS)[]).map(op => {
              const value = `${op}:${property.id}`;
              return html`<option
                value=${value}
                ?selected=${value === metricValue}
              >
                ${OP_LABELS[op]} of ${property.name$.value || 'Untitled'}
              </option>`;
            })
          )}
        </select>
      </label>
      ${isNumber
        ? nothing
        : html`<label class="dv-chart-control">
            <span>By</span>
            <select
              data-testid="dv-chart-group-by"
              ?disabled=${readonly}
              @change=${this.onSelect(id =>
                view.settingsUpdate({ groupBy: id || undefined })
              )}
            >
              <option value="" ?selected=${!groupBy}>Nothing</option>
              ${groupable.map(
                property =>
                  html`<option
                    value=${property.id}
                    ?selected=${property.id === groupBy?.id}
                  >
                    ${property.name$.value || 'Untitled'}
                  </option>`
              )}
            </select>
          </label>`}
      ${!isNumber && groupBy?.type$.value === 'date'
        ? html`<label class="dv-chart-control">
            <span>Per</span>
            <select
              data-testid="dv-chart-date-bucket"
              ?disabled=${readonly}
              @change=${this.onSelect(bucket =>
                view.settingsUpdate({
                  dateBucket: bucket as ChartDateBucket,
                })
              )}
            >
              ${BUCKET_OPTIONS.map(
                option =>
                  html`<option
                    value=${option.value}
                    ?selected=${option.value ===
                    (settings.dateBucket ?? 'day')}
                  >
                    ${option.label}
                  </option>`
              )}
            </select>
          </label>`
        : nothing}
      ${!isNumber && groupBy
        ? html`<label class="dv-chart-control">
            <input
              type="checkbox"
              data-testid="dv-chart-hide-empty"
              ?disabled=${readonly}
              .checked=${!!settings.hideEmpty}
              @change=${(event: Event) =>
                view.settingsUpdate({
                  hideEmpty: (event.target as HTMLInputElement).checked,
                })}
            />
            <span>Hide empty</span>
          </label>`
        : nothing}
    </div>`;
  }

  /** Hover text for a mark: its label, value and how many rows made it. */
  private tooltip(bucket: ChartBucket): string {
    const metric = this.view.metricLabel$.value;
    const rows =
      metric === 'Count'
        ? ''
        : ` (${bucket.rows} row${bucket.rows === 1 ? '' : 's'})`;
    return `${bucket.label}: ${formatChartValue(bucket.value)} ${metric.toLowerCase()}${rows}`;
  }

  private renderBars(buckets: ChartBucket[]) {
    const max = Math.max(0, ...buckets.map(b => b.value));
    return html`<div class="dv-chart-bars" data-testid="dv-chart-bars">
      ${repeat(
        buckets,
        bucket => bucket.key,
        bucket =>
          html`<span class="dv-chart-bar-label" title=${bucket.label}
              >${bucket.label}</span
            ><span class="dv-chart-bar-track" title=${this.tooltip(bucket)}
              ><span
                class="dv-chart-bar-fill"
                style=${styleMap({
                  width: `${max > 0 ? (Math.max(bucket.value, 0) / max) * 85 : 0}%`,
                })}
              ></span
              ><span class="dv-chart-value"
                >${formatChartValue(bucket.value)}</span
              ></span
            >`
      )}
    </div>`;
  }

  /** Gridlines + tick labels for the vertical plots, 0…axisMax. */
  private renderGrid(axisMax: number) {
    return Array.from({ length: TICKS + 1 }, (_, i) => {
      const value = (axisMax / TICKS) * i;
      const top = `${100 - (i / TICKS) * 100}%`;
      return html`${i > 0
          ? html`<div class="dv-chart-gridline" style="top:${top}"></div>`
          : nothing}<span class="dv-chart-tick" style="top:${top}"
          >${formatChartValue(value)}</span
        >`;
    });
  }

  private renderXLabels(buckets: ChartBucket[]) {
    // Thin labels out on a crowded axis rather than letting them collide.
    const every = Math.max(1, Math.ceil(buckets.length / 12));
    return html`<div class="dv-chart-x-labels">
      ${buckets.map(
        (bucket, i) =>
          html`<span class="dv-chart-x-label" title=${bucket.label}
            >${i % every === 0 ? bucket.label : ''}</span
          >`
      )}
    </div>`;
  }

  private renderColumns(buckets: ChartBucket[]) {
    const axisMax = niceAxisMax(Math.max(0, ...buckets.map(b => b.value)));
    return html`<div class="dv-chart-plot" data-testid="dv-chart-columns">
        ${this.renderGrid(axisMax)}
        <div class="dv-chart-columns">
          ${repeat(
            buckets,
            bucket => bucket.key,
            bucket =>
              html`<div
                class="dv-chart-column"
                title=${this.tooltip(bucket)}
              >
                <div
                  class="dv-chart-column-fill"
                  style=${styleMap({
                    height: `${(Math.max(bucket.value, 0) / axisMax) * 100}%`,
                  })}
                ></div>
              </div>`
          )}
        </div>
      </div>
      ${this.renderXLabels(buckets)}`;
  }

  private renderLine(buckets: ChartBucket[]) {
    const axisMax = niceAxisMax(Math.max(0, ...buckets.map(b => b.value)));
    const n = buckets.length;
    // Points sit in the middle of equal slots, matching the x labels below.
    const x = (i: number) => ((i + 0.5) / n) * 100;
    const y = (value: number) => 100 - (Math.max(value, 0) / axisMax) * 100;
    const points = buckets.map((b, i) => `${x(i)},${y(b.value)}`).join(' ');
    const area = `${x(0)},100 ${points} ${x(n - 1)},100`;
    return html`<div class="dv-chart-plot" data-testid="dv-chart-line">
        ${this.renderGrid(axisMax)}
        <svg
          class="dv-chart-line-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          ${n > 1
            ? svg`<polygon class="dv-chart-line-area" points=${area}></polygon>
                <polyline class="dv-chart-line-path" points=${points}></polyline>`
            : nothing}
        </svg>
        ${buckets.map(
          (bucket, i) =>
            html`<span
                class="dv-chart-point-hit"
                style="left:${x(i)}%;width:${100 / n}%"
                title=${this.tooltip(bucket)}
              ></span
              ><span
                class="dv-chart-point"
                style="left:${x(i)}%;bottom:${100 - y(bucket.value)}%"
              ></span>`
        )}
      </div>
      ${this.renderXLabels(buckets)}`;
  }

  private renderDonut(buckets: ChartBucket[]) {
    const slices = foldDonutSlices(buckets);
    const total = slices.reduce((sum, b) => sum + b.value, 0);
    if (total <= 0) return this.renderEmpty('Nothing to show yet.');
    const radius = 60;
    const circumference = 2 * Math.PI * radius;
    // Fixed colours for select options (their column position), otherwise
    // the slice's place in the list; "Other" is always neutral grey.
    const color = (bucket: ChartBucket, i: number) =>
      bucket.key === '__other__'
        ? 'var(--dv-chart-other)'
        : seriesColor(
            bucket.colorIndex !== undefined && bucket.colorIndex < 8
              ? bucket.colorIndex
              : i
          );
    // A 2px surface gap between slices, when there is more than one.
    const gap = slices.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = slices.map((bucket, i) => {
      const length = (bucket.value / total) * circumference;
      const arc = svg`<circle
        class="dv-chart-donut-slice"
        cx="80" cy="80" r=${radius}
        stroke=${color(bucket, i)}
        stroke-dasharray="${Math.max(length - gap, 0.5)} ${circumference}"
        stroke-dashoffset=${-offset}
        transform="rotate(-90 80 80)"
      ><title>${this.tooltip(bucket)}</title></circle>`;
      offset += length;
      return arc;
    });
    return html`<div class="dv-chart-donut" data-testid="dv-chart-donut">
      <svg viewBox="0 0 160 160" role="img" aria-label="Donut chart">
        ${arcs}
        <text
          class="dv-chart-donut-total"
          x="80"
          y="80"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          ${formatChartValue(total)}
        </text>
        <text
          class="dv-chart-donut-caption"
          x="80"
          y="102"
          text-anchor="middle"
        >
          ${this.view.metricLabel$.value}
        </text>
      </svg>
      <div class="dv-chart-legend">
        ${slices.map(
          (bucket, i) =>
            html`<div class="dv-chart-legend-item" title=${this.tooltip(bucket)}>
              <span
                class="dv-chart-swatch"
                style="background:${color(bucket, i)}"
              ></span>
              <span>${bucket.label}</span>
              <span class="dv-chart-legend-value"
                >${formatChartValue(bucket.value)} ·
                ${Math.round((bucket.value / total) * 100)}%</span
              >
            </div>`
        )}
      </div>
    </div>`;
  }

  private renderNumber() {
    const view = this.view;
    const rows = view.rows$.value.length;
    return html`<div class="dv-chart-stat" data-testid="dv-chart-number">
      <span class="dv-chart-stat-value">${formatChartValue(view.total$.value)}</span>
      <span class="dv-chart-stat-caption"
        >${view.metricLabel$.value}${view.metricOp$.value === 'count'
          ? ''
          : ` · ${rows} row${rows === 1 ? '' : 's'}`}</span
      >
    </div>`;
  }

  private renderEmpty(text: string) {
    return html`<div class="dv-chart-empty">${text}</div>`;
  }

  private renderChart(): TemplateResult {
    const view = this.view;
    const kind = view.settings$.value.kind;
    if (view.rows$.value.length === 0) {
      return view.rowsLoading$.value
        ? this.renderEmpty('Loading…')
        : this.renderEmpty('No rows to chart.');
    }
    if (kind === 'number') return this.renderNumber();
    const buckets = view.buckets$.value;
    if (buckets.length === 0) return this.renderEmpty('Nothing to show yet.');
    switch (kind) {
      case 'column':
        return this.renderColumns(buckets);
      case 'line':
        return this.renderLine(buckets);
      case 'donut':
        return this.renderDonut(buckets);
      default:
        return this.renderBars(buckets);
    }
  }

  override render(): TemplateResult {
    return html`
      ${this.logic.headerWidget
        ? renderUniLit(this.logic.headerWidget, {
            dataViewLogic: this.logic,
          })
        : ''}
      <div class="dv-chart">${this.renderControls()} ${this.renderChart()}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'notesgraph-data-view-chart': ChartViewUI;
  }
}
