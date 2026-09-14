import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const label = style({
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
  marginTop: 10,
});

export const alertRow = style({
  display: 'flex',
  gap: 8,
  alignItems: 'center',
});

export const opToggle = style({
  display: 'inline-flex',
  borderRadius: 8,
  overflow: 'hidden',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  flexShrink: 0,
});

export const opButton = style({
  padding: '6px 12px',
  fontSize: 13,
  background: 'transparent',
  color: cssVarV2.text.secondary,
  border: 'none',
  cursor: 'pointer',
  selectors: {
    '&[data-active="true"]': {
      background: cssVarV2.layer.background.hoverOverlay,
      color: cssVarV2.text.primary,
      fontWeight: 600,
    },
  },
});

export const actions = style({
  marginTop: 16,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});
