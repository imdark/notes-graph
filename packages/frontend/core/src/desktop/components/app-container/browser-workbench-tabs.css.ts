import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const tabBar = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  height: 40,
  flexShrink: 0,
  padding: '0 8px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  overflowX: 'auto',
});

export const tabs = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 4,
  flex: 1,
  minWidth: 0,
});

export const tab = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  minWidth: 96,
  maxWidth: 220,
  padding: '0 8px',
  borderRadius: 6,
  cursor: 'pointer',
  color: cssVarV2('text/secondary'),
  background: 'transparent',
  border: '1px solid transparent',
  transition: 'background .15s, color .15s',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const tabActive = style({
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  borderColor: cssVarV2('layer/insideBorder/border'),
});

export const tabIcon = style({
  fontSize: 16,
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
});

export const tabTitle = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: cssVar('fontSm'),
});

export const tabClose = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 18,
  height: 18,
  borderRadius: 4,
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('icon/primary'),
    },
  },
});

export const tabCaret = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 18,
  borderRadius: 4,
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('icon/primary'),
    },
  },
});

export const addTab = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  flexShrink: 0,
  border: 'none',
  background: 'transparent',
  borderRadius: 6,
  cursor: 'pointer',
  color: cssVarV2('icon/primary'),
  fontSize: 20,
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

// Column wrapper so the tab bar stacks above the workbench inside the
// (row-flex) main container without disturbing other layouts.
export const workbenchColumn = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minWidth: 0,
});

export const workbenchBody = style({
  position: 'relative',
  display: 'flex',
  flex: 1,
  minHeight: 0,
  width: '100%',
});
