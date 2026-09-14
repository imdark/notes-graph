import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const label = style({
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
  marginTop: 8,
});

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 240,
  overflowY: 'auto',
});

export const empty = style({
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
  padding: '8px 0',
});

export const actions = style({
  marginTop: 16,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});
