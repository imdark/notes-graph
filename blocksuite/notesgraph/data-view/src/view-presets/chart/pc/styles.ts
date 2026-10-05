import { css } from 'lit';

/**
 * Series colours are the data-viz reference palette's categorical slots, in
 * its validated order (adjacent pairs stay apart under colour-blindness), with
 * separately chosen dark steps. Ink stays on the app's text tokens; only marks
 * wear series colours.
 */
export const chartViewStyles = css`
  notesgraph-data-view-chart {
    display: block;
    --dv-chart-series-1: #2a78d6;
    --dv-chart-series-2: #eb6834;
    --dv-chart-series-3: #1baf7a;
    --dv-chart-series-4: #eda100;
    --dv-chart-series-5: #e87ba4;
    --dv-chart-series-6: #008300;
    --dv-chart-series-7: #4a3aa7;
    --dv-chart-series-8: #e34948;
    --dv-chart-other: #898781;
    --dv-chart-grid: var(--notesgraph-border-color);
  }

  [data-theme='dark'] notesgraph-data-view-chart {
    --dv-chart-series-1: #3987e5;
    --dv-chart-series-2: #d95926;
    --dv-chart-series-3: #199e70;
    --dv-chart-series-4: #c98500;
    --dv-chart-series-5: #d55181;
    --dv-chart-series-6: #008300;
    --dv-chart-series-7: #9085e9;
    --dv-chart-series-8: #e66767;
  }

  .dv-chart {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0 4px;
    font-size: var(--notesgraph-font-xs);
    color: var(--notesgraph-text-secondary-color);
  }

  /* Settings: one row above the chart, wrapping on a narrow column. */
  .dv-chart-controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
  }

  .dv-chart-control {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .dv-chart-control select {
    appearance: none;
    background: transparent;
    border: 1px solid var(--notesgraph-border-color);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: var(--notesgraph-font-xs);
    color: var(--notesgraph-text-primary-color);
    cursor: pointer;
    max-width: 180px;
  }

  .dv-chart-control select:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .dv-chart-empty {
    padding: 24px 8px;
    text-align: center;
    color: var(--notesgraph-text-secondary-color);
  }

  .dv-chart-axis-title {
    color: var(--notesgraph-text-secondary-color);
  }

  /* Horizontal bars — HTML, so long labels wrap instead of colliding. */
  .dv-chart-bars {
    display: grid;
    grid-template-columns: minmax(64px, max-content) 1fr;
    align-items: center;
    gap: 2px 8px;
  }

  .dv-chart-bar-label {
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--notesgraph-text-primary-color);
  }

  .dv-chart-bar-track {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    border-radius: 4px;
  }

  .dv-chart-bar-track:hover,
  .dv-chart-column:hover {
    background: var(--notesgraph-hover-color);
  }

  .dv-chart-bar-fill {
    height: 16px;
    /* Square at the baseline, rounded at the data end. */
    border-radius: 0 4px 4px 0;
    background: var(--dv-chart-series-1);
    min-width: 2px;
  }

  .dv-chart-value {
    font-variant-numeric: tabular-nums;
    color: var(--notesgraph-text-primary-color);
    white-space: nowrap;
  }

  /* Vertical columns and the line chart share one plot frame. */
  .dv-chart-plot {
    position: relative;
    height: 180px;
    margin-left: 32px;
    border-bottom: 1px solid var(--dv-chart-grid);
  }

  .dv-chart-gridline {
    position: absolute;
    left: 0;
    right: 0;
    border-top: 1px solid var(--dv-chart-grid);
    opacity: 0.6;
  }

  .dv-chart-tick {
    position: absolute;
    right: calc(100% + 6px);
    transform: translateY(-50%);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .dv-chart-columns {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: flex-end;
    /* The 2px surface gap between touching columns. */
    gap: 2px;
  }

  .dv-chart-column {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    border-radius: 4px 4px 0 0;
  }

  .dv-chart-column-fill {
    width: 100%;
    max-width: 24px;
    border-radius: 4px 4px 0 0;
    background: var(--dv-chart-series-1);
  }

  .dv-chart-x-labels {
    display: flex;
    gap: 2px;
    margin-left: 32px;
  }

  .dv-chart-x-label {
    flex: 1 1 0;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }

  .dv-chart-line-svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .dv-chart-line-path {
    fill: none;
    stroke: var(--dv-chart-series-1);
    stroke-width: 2px;
    stroke-linejoin: round;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }

  .dv-chart-line-area {
    fill: var(--dv-chart-series-1);
    opacity: 0.1;
    stroke: none;
  }

  /* HTML markers over the stretched SVG, so they stay round. */
  .dv-chart-point {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dv-chart-series-1);
    box-shadow: 0 0 0 2px var(--notesgraph-background-primary-color);
    transform: translate(-50%, 50%);
  }

  .dv-chart-point-hit {
    position: absolute;
    top: 0;
    bottom: 0;
    transform: translateX(-50%);
  }

  .dv-chart-point-hit:hover {
    background: var(--notesgraph-hover-color);
  }

  /* Donut + legend: the legend drops under the ring on a narrow column. */
  .dv-chart-donut {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 16px;
  }

  .dv-chart-donut svg {
    width: 160px;
    height: 160px;
    flex-shrink: 0;
  }

  .dv-chart-donut-slice {
    fill: none;
    stroke-width: 28;
  }

  .dv-chart-donut-slice:hover {
    stroke-width: 32;
  }

  .dv-chart-donut-total {
    font-size: 22px;
    font-weight: 600;
    fill: var(--notesgraph-text-primary-color);
  }

  .dv-chart-donut-caption {
    font-size: 11px;
    fill: var(--notesgraph-text-secondary-color);
  }

  .dv-chart-legend {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .dv-chart-legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--notesgraph-text-primary-color);
  }

  .dv-chart-swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .dv-chart-legend-value {
    margin-left: auto;
    padding-left: 12px;
    font-variant-numeric: tabular-nums;
    color: var(--notesgraph-text-secondary-color);
  }

  /* The headline number. */
  .dv-chart-stat {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 4px;
  }

  .dv-chart-stat-value {
    font-size: 40px;
    line-height: 1.1;
    font-weight: 600;
    color: var(--notesgraph-text-primary-color);
  }

  .dv-chart-stat-caption {
    font-size: var(--notesgraph-font-sm);
  }
`;
