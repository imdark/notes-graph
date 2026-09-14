import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const canvasContainer = style({
  position: 'relative',
  flex: 1,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
});

export const canvas = style({
  display: 'block',
  width: '100%',
  height: '100%',
  touchAction: 'none',
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
});

export const searchInput = style({
  width: '240px',
});

export const count = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});

export const emptyState = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  padding: '24px',
  textAlign: 'center',
  fontSize: cssVar('fontBase'),
  color: cssVarV2('text/secondary'),
});

export const notice = style({
  position: 'absolute',
  left: '16px',
  bottom: '16px',
  padding: '6px 10px',
  borderRadius: '8px',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  pointerEvents: 'none',
});

export const selectionHint = style({
  position: 'absolute',
  left: '50%',
  bottom: '16px',
  transform: 'translateX(-50%)',
  padding: '6px 12px',
  borderRadius: '8px',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/secondary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  boxShadow: cssVar('shadow1'),
  pointerEvents: 'none',
  whiteSpace: 'nowrap',
});

export const createButton = style({
  position: 'absolute',
  right: '24px',
  bottom: '72px',
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '28px',
  lineHeight: 1,
  color: cssVarV2('button/pureWhiteText'),
  background: cssVarV2('button/primary'),
  boxShadow: cssVar('shadow2'),
  touchAction: 'none',
  userSelect: 'none',
  transition: 'transform 0.1s ease',
  selectors: {
    '&:hover': { transform: 'scale(1.06)' },
    '&:active': { transform: 'scale(0.96)' },
  },
});

export const legend = style({
  position: 'absolute',
  top: '16px',
  right: '16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '8px 11px',
  borderRadius: '8px',
  fontSize: '11px',
  lineHeight: '16px',
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  opacity: 0.8,
  pointerEvents: 'none',
  userSelect: 'none',
  maxWidth: '240px',
});

export const legendTitle = style({
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  marginBottom: '2px',
});

export const legendKey = style({
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const recommendations = style({
  position: 'absolute',
  top: '16px',
  left: '16px',
  width: '280px',
  maxHeight: '60%',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '12px',
  borderRadius: '12px',
  fontSize: '13px',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/secondary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  boxShadow: cssVar('shadow2'),
  zIndex: 10,
});

export const recommendationsHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontWeight: 600,
});

export const recommendationsEmpty = style({
  fontSize: '12px',
  color: cssVarV2('text/secondary'),
});

export const recommendationItem = style({
  padding: '8px',
  borderRadius: '8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const recommendationScore = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontSize: '11px',
  color: cssVarV2('text/secondary'),
  marginBottom: '4px',
});

export const recommendationPair = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px',
});

export const recommendationDoc = style({
  cursor: 'pointer',
  fontWeight: 500,
  color: cssVarV2('text/primary'),
  selectors: { '&:hover': { textDecoration: 'underline' } },
});
