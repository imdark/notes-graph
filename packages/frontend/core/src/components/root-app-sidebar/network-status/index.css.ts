import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '2px 8px',
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
  userSelect: 'none',
  selectors: {
    // offline: give the whole pill the error tint so it reads as a warning
    '&[data-online="false"]': {
      color: cssVarV2('status/error'),
    },
  },
});

export const dot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
  backgroundColor: cssVarV2.button.success,
  selectors: {
    '[data-online="false"] &': {
      backgroundColor: cssVarV2('status/error'),
    },
  },
});

export const label = style({
  fontWeight: 500,
});
