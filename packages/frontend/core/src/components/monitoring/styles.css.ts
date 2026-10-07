import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 1000,
  margin: '0 auto',
  width: '100%',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});

export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: cssVarV2('text/secondary'),
});

export const sectionCount = style({
  fontWeight: 500,
  color: cssVarV2('text/tertiary'),
});

export const empty = style({
  padding: '20px 16px',
  borderRadius: 12,
  border: `1px dashed ${cssVarV2('layer/insideBorder/border')}`,
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

export const toolbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
});

export const toolbarHint = style({
  flex: 1,
  minWidth: 160,
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
});

export const tiles = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
  gap: 10,
});

export const tile = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '12px 14px',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&[data-active]': {
      borderColor: cssVarV2('button/primary'),
      boxShadow: `0 0 0 1px ${cssVarV2('button/primary')}`,
    },
  },
});

export const tileValue = style({
  fontSize: 24,
  fontWeight: 600,
  lineHeight: 1.2,
  color: cssVarV2('text/primary'),
  fontVariantNumeric: 'tabular-nums',
});

export const tileLabel = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 12,
});

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  minWidth: 0,
});

export const cardHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});

export const cardName = style({
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const meta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const problem = style({
  fontSize: cssVar('fontXs'),
  lineHeight: 1.4,
  color: cssVar('warningColor'),
  wordBreak: 'break-word',
});

/** A status dot; its colour comes from data-state. */
export const dot = style({
  flexShrink: 0,
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: cssVarV2('text/disable'),
  selectors: {
    '&[data-state="online"], &[data-state="ok"]': {
      background: cssVarV2('status/success'),
    },
    '&[data-state="degraded"], &[data-state="warn"]': {
      background: cssVar('warningColor'),
    },
    '&[data-state="offline"], &[data-state="fail"]': {
      background: cssVarV2('status/error'),
    },
  },
});

export const pill = style({
  flexShrink: 0,
  padding: '0 7px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
});

export const checks = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const check = style({
  display: 'grid',
  gridTemplateColumns: '8px 64px 1fr',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const checkName = style({
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const checkDetail = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const meter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});

export const meterTrack = style({
  flex: 1,
  height: 6,
  borderRadius: 3,
  background: cssVarV2('layer/background/secondary'),
  overflow: 'hidden',
});

export const meterFill = style({
  height: '100%',
  borderRadius: 3,
  background: cssVarV2('status/success'),
  selectors: {
    '&[data-state="warn"]': { background: cssVar('warningColor') },
    '&[data-state="fail"]': { background: cssVarV2('status/error') },
  },
});

export const meterValue = style({
  width: 36,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
});

export const monitors = style({
  display: 'flex',
  flexDirection: 'column',
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  paddingTop: 8,
  gap: 4,
});

export const monitorRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '3px 4px',
  margin: '0 -4px',
  borderRadius: 6,
  border: 'none',
  background: 'none',
  font: 'inherit',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  textAlign: 'left',
  cursor: 'pointer',
  minWidth: 0,
  ':hover': { background: cssVarV2('layer/background/hoverOverlay') },
});

export const monitorName = style({
  flexShrink: 0,
  maxWidth: '45%',
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const monitorValue = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 'auto',
});
