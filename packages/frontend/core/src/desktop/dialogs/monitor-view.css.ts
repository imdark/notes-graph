import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

/** The chart and the plot area the hover tooltip is placed in. */
export const chart = style({
  position: 'relative',
  width: '100%',
  touchAction: 'pan-y',
});

export const chartSvg = style({
  display: 'block',
  width: '100%',
  overflow: 'visible',
});

/** Axis text in muted ink, never the series color. */
export const axisText = style({
  fill: cssVarV2('text/secondary'),
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
});

export const gridLine = style({
  stroke: cssVarV2('layer/insideBorder/border'),
  strokeWidth: 1,
});

export const line = style({
  fill: 'none',
  stroke: cssVar('primaryColor'),
  strokeWidth: 2,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
});

/** A reading that sent an alert: a marker with a ring of the surface. */
export const alertDot = style({
  fill: cssVar('primaryColor'),
  stroke: cssVarV2('layer/background/primary'),
  strokeWidth: 2,
});

export const crosshair = style({
  stroke: cssVarV2('text/tertiary'),
  strokeWidth: 1,
  strokeDasharray: '3 3',
});

export const tooltip = style({
  position: 'absolute',
  top: 0,
  pointerEvents: 'none',
  padding: '4px 8px',
  borderRadius: 4,
  fontSize: cssVar('fontXs'),
  whiteSpace: 'nowrap',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/overlayPanel'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  boxShadow: cssVar('shadow1'),
  fontVariantNumeric: 'tabular-nums',
});

export const tooltipWhen = style({
  color: cssVarV2('text/secondary'),
});

/** The readings as a table, under the chart: its accessible view too. */
export const readings = style({
  maxHeight: 260,
  overflowY: 'auto',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
});

export const readingsTable = style({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: cssVar('fontXs'),
  fontVariantNumeric: 'tabular-nums',
  userSelect: 'text',
});

export const readingCell = style({
  padding: '6px 10px',
  textAlign: 'left',
  verticalAlign: 'top',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/primary'),
  wordBreak: 'break-word',
  selectors: {
    'tr:last-child > &': { borderBottom: 'none' },
    '&[data-muted]': {
      color: cssVarV2('text/secondary'),
      whiteSpace: 'nowrap',
    },
    '&[data-error]': { color: cssVarV2('status/error') },
  },
});

export const readingHead = style([
  readingCell,
  {
    position: 'sticky',
    top: 0,
    fontWeight: 500,
    color: cssVarV2('text/secondary'),
    background: cssVarV2('layer/background/primary'),
  },
]);

export const actions = style({
  display: 'flex',
  gap: 8,
  flexWrap: 'wrap',
});

/** The run picker over a run's log. */
export const runPicker = style({
  maxWidth: '100%',
  padding: '4px 8px',
  borderRadius: 4,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  ':focus-visible': {
    outline: `2px solid ${cssVar('primaryColor')}`,
    outlineOffset: 1,
  },
});
