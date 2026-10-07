import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  maxWidth: 900,
  margin: '0 auto',
  width: '100%',
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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

export const sectionHint = style({
  fontSize: 12,
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

export const rows = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
});

export const row = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  selectors: {
    '& + &': {
      borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const rowBody = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  flex: 1,
});

export const rowTitle = style({
  fontSize: 14,
  lineHeight: 1.4,
  color: cssVarV2('text/primary'),
  wordBreak: 'break-word',
});

export const rowMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px 12px',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const link = style({
  color: cssVarV2('text/link'),
  background: 'none',
  border: 'none',
  padding: 0,
  font: 'inherit',
  cursor: 'pointer',
  textDecoration: 'none',
  ':hover': { textDecoration: 'underline' },
});

export const shipBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  background: cssVarV2('layer/background/secondary'),
});

export const agentSelect = style({
  flex: '1 1 160px',
  minWidth: 0,
  height: 32,
  padding: '0 8px',
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: 14,
});

export const runStatus = style({
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
});

export const runError = style({
  color: cssVarV2('status/error'),
});

export const rowActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  flexShrink: 0,
});

export const badge = style({
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 500,
  background: cssVarV2('layer/background/tertiary'),
  color: cssVarV2('text/secondary'),
});

export const badgeGood = style([badge, { color: cssVarV2('status/success') }]);

export const badgeBad = style([badge, { color: cssVarV2('status/error') }]);

export const githubBar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
});
