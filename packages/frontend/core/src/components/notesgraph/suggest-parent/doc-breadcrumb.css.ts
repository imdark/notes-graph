import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const breadcrumb = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
});

export const item = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
});

export const crumb = style({
  maxWidth: 180,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: 'none',
  background: 'transparent',
  padding: '1px 4px',
  borderRadius: 4,
  cursor: 'pointer',
  color: cssVarV2('text/secondary'),
  fontSize: 'inherit',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('text/primary'),
    },
  },
});

export const sep = style({
  color: cssVarV2('text/disable'),
  flexShrink: 0,
  userSelect: 'none',
});
