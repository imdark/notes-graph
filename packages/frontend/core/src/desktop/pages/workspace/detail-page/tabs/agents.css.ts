import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  height: '100%',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '12px 16px 24px',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'flex-start',
});

export const sectionLabel = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: cssVarV2('text/secondary'),
});

export const empty = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  margin: 0,
});

export const hint = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
});

export const agentList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  width: '100%',
});

export const agentButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontSm'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:disabled': { cursor: 'default', opacity: 0.6 },
  },
});

export const agentEmoji = style({
  fontSize: 16,
  flexShrink: 0,
});

export const agentName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const agentRunning = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  flexShrink: 0,
});

export const output = style({
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('text/primary'),
  whiteSpace: 'pre-wrap',
  margin: 0,
});

export const error = style({
  fontSize: cssVar('fontSm'),
  lineHeight: 1.6,
  color: cssVarV2('status/error'),
  margin: 0,
});

export const runList = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  overflow: 'hidden',
});

export const runRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: { '&:last-child': { borderBottom: 'none' } },
});

export const runDot = style({
  width: 6,
  height: 6,
  borderRadius: '50%',
  flexShrink: 0,
  background: cssVarV2('text/tertiary'),
  selectors: {
    '&[data-status="done"]': { background: cssVarV2('status/success') },
    '&[data-status="error"]': { background: cssVarV2('status/error') },
    '&[data-status="running"]': { background: cssVarV2('icon/activated') },
  },
});

export const runText = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  flex: 1,
});

export const runName = style({
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  color: cssVarV2('text/primary'),
});

export const runMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const runWhen = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
  flexShrink: 0,
});

export const sessionActions = style({
  display: 'flex',
  gap: 8,
});
