import { cssVar } from '@toeverything/theme';
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
  '@media': {
    'screen and (max-width: 640px)': { padding: '8px 16px 48px' },
  },
});

export const content = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
  maxWidth: 900,
  margin: '0 auto',
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

export const sectionActions = style({
  marginLeft: 'auto',
  display: 'flex',
  gap: 8,
  textTransform: 'none',
  letterSpacing: 0,
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

export const agentGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 10,
});

export const agentCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
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
    '&[data-disabled]': { opacity: 0.55 },
  },
});

export const agentCardHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});

export const agentCardIcon = style({
  fontSize: 18,
  flexShrink: 0,
});

export const agentCardName = style({
  flex: 1,
  minWidth: 0,
  fontSize: 14,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const agentCardMeta = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const agentCardFoot = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/tertiary'),
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

export const filters = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
});

export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 10px',
  borderRadius: 999,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: 'transparent',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&[data-active]': {
      color: cssVarV2('button/pureWhiteText'),
      background: cssVarV2('button/primary'),
      borderColor: cssVarV2('button/primary'),
    },
  },
});

export const chipCount = style({
  opacity: 0.75,
});

export const runs = style({
  display: 'flex',
  flexDirection: 'column',
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  overflow: 'hidden',
});

export const waitingCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${cssVarV2('button/primary')}`,
  background: cssVarV2('layer/background/primary'),
});

export const showMore = style({
  alignSelf: 'center',
});
