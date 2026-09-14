import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const headerBar = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  width: '100%',
});

export const body = style({
  width: '100%',
  height: '100%',
  overflowY: 'auto',
  padding: '8px 24px 48px',
});

export const status = style({
  color: cssVarV2('text/secondary'),
  fontSize: 14,
  padding: '64px 0',
  textAlign: 'center',
});

export const groups = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  maxWidth: 820,
  margin: '0 auto',
});

export const group = style({
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 12,
  background: cssVarV2('layer/background/primary'),
  overflow: 'hidden',
});

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '12px 16px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const groupTitle = style({
  fontSize: 15,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const groupCount = style({
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  padding: '1px 8px',
  borderRadius: 999,
  background: cssVarV2('layer/background/secondary'),
  whiteSpace: 'nowrap',
});

export const groupActions = style({
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  cursor: 'pointer',
  selectors: {
    '&:not(:last-child)': {
      borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const checkbox = style({
  flexShrink: 0,
});

export const rowText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  flex: 1,
});

export const rowTitle = style({
  fontSize: 14,
  color: cssVarV2('text/primary'),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});

export const rowMeta = style({
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const openLink = style({
  fontSize: 12,
  color: cssVarV2('text/link'),
  flexShrink: 0,
});

export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  maxWidth: 820,
  margin: '28px auto 12px',
  fontSize: 13,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: cssVarV2('text/secondary'),
});

export const sectionActions = style({
  marginLeft: 'auto',
});

export const contentHint = style({
  maxWidth: 820,
  margin: '0 auto',
  padding: '16px 0',
  fontSize: 13,
  lineHeight: 1.5,
  color: cssVarV2('text/secondary'),
});

export const pairTitles = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
});

export const pairTitle = style({
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 14,
  color: cssVarV2('text/primary'),
  maxWidth: 300,
});

export const pairArrow = style({
  flexShrink: 0,
  color: cssVarV2('text/tertiary'),
});

export const pairScore = style({
  flexShrink: 0,
  fontSize: 12,
  padding: '1px 8px',
  borderRadius: 999,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
});
