import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const shell = style({
  display: 'flex',
  flexDirection: 'row',
  width: '100%',
  height: '100%',
  overflow: 'hidden',
});

export const sidebar = style({
  flexShrink: 0,
  width: '260px',
  height: '100%',
  overflowY: 'auto',
  padding: '16px 8px',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  '@media': {
    'screen and (max-width: 768px)': {
      display: 'none',
    },
  },
});

export const siteTitle = style({
  fontSize: cssVar('fontH6'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
  padding: '4px 12px 12px',
});

export const nav = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
});

export const navItem = style({
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '6px 12px',
  border: 'none',
  background: 'transparent',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('text/primary'),
    },
  },
});

export const navItemActive = style({
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVar('primaryColor'),
  fontWeight: 500,
});

export const content = style({
  flex: 1,
  height: '100%',
  minWidth: 0,
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
});
