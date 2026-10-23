import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

const border = `1px solid ${cssVarV2('layer/insideBorder/border')}`;

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 860,
  margin: '0 auto',
  width: '100%',
});

export const intro = style({
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
});

export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
});

export const sectionTitle = style({
  flex: 1,
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: cssVarV2('text/secondary'),
});

export const sectionCount = style({
  marginLeft: 6,
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

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border,
  background: cssVarV2('layer/background/primary'),
  overflow: 'hidden',
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  minWidth: 0,
  flexWrap: 'wrap',
});

export const rowText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 200,
});

export const name = style({
  fontSize: 14,
  fontWeight: 500,
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

export const actions = style({
  display: 'flex',
  flexShrink: 0,
  alignItems: 'center',
  gap: 4,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px',
  borderTop: border,
  background: cssVarV2('layer/background/secondary'),
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '14px',
  borderRadius: 12,
  border,
  background: cssVarV2('layer/background/primary'),
});

export const fieldRow = style({
  display: 'flex',
  gap: 12,
  flexWrap: 'wrap',
});

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  flex: 1,
  minWidth: 160,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const hint = style({
  fontSize: cssVar('fontXs'),
  lineHeight: 1.5,
  color: cssVarV2('text/tertiary'),
});

export const fieldError = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('status/error'),
});

export const select = style({
  height: 28,
  padding: '0 8px',
  borderRadius: 8,
  border,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: 13,
});

export const code = style({
  width: '100%',
  minHeight: 220,
  padding: 10,
  borderRadius: 8,
  border,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: 12,
  lineHeight: 1.5,
  resize: 'vertical',
  tabSize: 2,
});

export const trigger = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  padding: 8,
  borderRadius: 8,
  border,
});

export const chips = style({
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
});

export const chip = style({
  padding: '2px 8px',
  borderRadius: 10,
  border,
  fontSize: 12,
  fontFamily: cssVar('fontMonoFamily'),
  cursor: 'pointer',
  color: cssVarV2('text/secondary'),
  background: 'transparent',
  selectors: {
    '&[data-on="true"]': {
      color: cssVarV2('text/primary'),
      background: cssVarV2('layer/background/hoverOverlay'),
      borderColor: cssVarV2('button/primary'),
    },
  },
});

export const formActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});

export const status = style({
  fontSize: 11,
  fontWeight: 600,
  padding: '1px 6px',
  borderRadius: 6,
  flexShrink: 0,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/hoverOverlay'),
  selectors: {
    '&[data-status="succeeded"]': { color: cssVarV2('status/success') },
    '&[data-status="failed"], &[data-status="timed_out"]': {
      color: cssVarV2('status/error'),
    },
    '&[data-status="running"]': { color: cssVarV2('button/primary') },
  },
});

export const runRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  cursor: 'pointer',
  padding: '4px 0',
});

export const pre = style({
  margin: 0,
  padding: 8,
  maxHeight: 280,
  overflow: 'auto',
  borderRadius: 8,
  border,
  background: cssVarV2('layer/background/primary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const banner = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('button/primary')}`,
  fontSize: 13,
  color: cssVarV2('text/primary'),
});

export const url = style({
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: 12,
  wordBreak: 'break-all',
});
