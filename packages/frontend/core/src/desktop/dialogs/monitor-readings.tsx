import {
  formatTrendValue,
  monitorTrend,
} from '@notesgraph/core/modules/agents/services/monitor-trend';
import type { MonitorReading } from '@notesgraph/core/modules/agents/services/monitors';
import {
  Fragment,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import * as runStyles from '../pages/workspace/detail-page/tabs/agents.css';
import * as styles from './monitor-view.css';

const CHART_HEIGHT = 180;
/** Room for the y labels on the left and the x labels underneath. */
const PAD = { top: 10, right: 12, bottom: 22, left: 44 };

const shortTime = (seconds: number) =>
  new Date(seconds * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * A monitor's numeric readings over time: one line, spaced by when each was
 * taken, with a marker on the readings that sent an alert. Hovering (or
 * dragging a finger along it) shows the reading under the pointer.
 */
export const ReadingsChart = ({ readings }: { readings: MonitorReading[] }) => {
  const trend = useMemo(() => monitorTrend(readings), [readings]);
  const alertedAt = useMemo(
    () => new Set(readings.filter(r => r.alerted).map(r => r.at)),
    [readings]
  );
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const hasTrend = !!trend;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 640);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
    // The box only renders once there is something to chart.
  }, [hasTrend]);

  const geometry = useMemo(() => {
    if (!trend) return null;
    const { points } = trend;
    const t0 = points[0].at;
    const t1 = points[points.length - 1].at;
    // A flat series gets a band around it, so the line sits mid-plot.
    const span = trend.max - trend.min;
    const pad = span === 0 ? Math.abs(trend.max) * 0.1 || 1 : span * 0.08;
    const lo = trend.min - pad;
    const hi = trend.max + pad;
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = CHART_HEIGHT - PAD.top - PAD.bottom;
    const x = (at: number) =>
      PAD.left + (t1 === t0 ? plotW / 2 : ((at - t0) / (t1 - t0)) * plotW);
    const y = (value: number) =>
      PAD.top + (1 - (value - lo) / (hi - lo)) * plotH;
    const xy = points.map(p => ({ ...p, x: x(p.at), y: y(p.value) }));
    const path = xy
      .map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    const ticks = [trend.max, (trend.max + trend.min) / 2, trend.min].map(
      value => ({ value, y: y(value) })
    );
    return { xy, path, ticks, plotH };
  }, [trend, width]);

  const onPointerMove = useCallback(
    (e: PointerEvent<SVGSVGElement>) => {
      if (!geometry) return;
      const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
      let nearest = 0;
      geometry.xy.forEach((p, i) => {
        if (Math.abs(p.x - px) < Math.abs(geometry.xy[nearest].x - px))
          nearest = i;
      });
      setHover(nearest);
    },
    [geometry]
  );

  if (!trend || !geometry) {
    return (
      <p className={runStyles.empty} data-testid="monitor-view-no-chart">
        {readings.some(r => !r.error)
          ? "Its readings aren't numbers, so there is nothing to chart. Each one is listed below."
          : 'No readings to chart yet.'}
      </p>
    );
  }

  const point = hover !== null ? geometry.xy[hover] : null;
  const first = geometry.xy[0];
  const last = geometry.xy[geometry.xy.length - 1];
  const alerts = geometry.xy.filter(p => alertedAt.has(p.at));

  return (
    <div ref={box} className={styles.chart} data-testid="monitor-view-chart">
      <svg
        className={styles.chartSvg}
        width={width}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        role="img"
        aria-label={`${trend.points.length} readings from ${formatTrendValue(trend.min)} to ${formatTrendValue(trend.max)}, latest ${formatTrendValue(trend.latest)}`}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        {geometry.ticks.map(tick => (
          <Fragment key={tick.y}>
            <line
              className={styles.gridLine}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={tick.y}
              y2={tick.y}
            />
            <text
              className={styles.axisText}
              x={PAD.left - 6}
              y={tick.y}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {formatTrendValue(tick.value)}
            </text>
          </Fragment>
        ))}
        <text
          className={styles.axisText}
          x={first.x}
          y={CHART_HEIGHT - 4}
          textAnchor="start"
        >
          {shortTime(first.at)}
        </text>
        {last.x - first.x > 160 ? (
          <text
            className={styles.axisText}
            x={last.x}
            y={CHART_HEIGHT - 4}
            textAnchor="end"
          >
            {shortTime(last.at)}
          </text>
        ) : null}
        <path
          className={styles.line}
          d={geometry.path}
          data-testid="monitor-view-chart-line"
        />
        {alerts.map(p => (
          <circle
            key={p.at}
            className={styles.alertDot}
            cx={p.x}
            cy={p.y}
            r={4}
            data-testid="monitor-view-chart-alert"
          />
        ))}
        {point ? (
          <>
            <line
              className={styles.crosshair}
              x1={point.x}
              x2={point.x}
              y1={PAD.top}
              y2={PAD.top + geometry.plotH}
            />
            <circle
              className={styles.alertDot}
              cx={point.x}
              cy={point.y}
              r={5}
            />
          </>
        ) : null}
      </svg>
      {point ? (
        <div
          className={styles.tooltip}
          style={
            point.x > width / 2
              ? { right: width - point.x + 8 }
              : { left: point.x + 8 }
          }
          data-testid="monitor-view-chart-tooltip"
        >
          <strong>{formatTrendValue(point.value)}</strong>
          {alertedAt.has(point.at) ? ' · alerted' : ''}
          <div className={styles.tooltipWhen}>
            {new Date(point.at * 1000).toLocaleString()}
          </div>
        </div>
      ) : null}
      {alerts.length ? (
        <span className={runStyles.hint}>
          Dots mark the readings that sent an alert.
        </span>
      ) : null}
    </div>
  );
};

/** Every reading, newest first: the chart's numbers, and text ones too. */
export const ReadingsTable = ({ readings }: { readings: MonitorReading[] }) => (
  <div className={styles.readings}>
    <table className={styles.readingsTable} data-testid="monitor-view-readings">
      <thead>
        <tr>
          <th className={styles.readingHead}>When</th>
          <th className={styles.readingHead}>Reading</th>
        </tr>
      </thead>
      <tbody>
        {readings.map((reading, i) => (
          <tr key={`${reading.at}-${i}`}>
            <td className={styles.readingCell} data-muted>
              {new Date(reading.at * 1000).toLocaleString()}
            </td>
            {reading.error ? (
              <td className={styles.readingCell} data-error>
                Failed: {reading.error}
              </td>
            ) : (
              <td className={styles.readingCell}>
                {reading.value ?? '(empty)'}
                {reading.alerted ? ' · alerted' : ''}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
