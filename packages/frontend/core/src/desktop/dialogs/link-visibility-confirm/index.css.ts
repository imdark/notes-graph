import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const description = style({
  fontSize: 14,
  lineHeight: '22px',
  color: cssVarV2.text.primary,
});

export const actions = style({
  marginTop: 16,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
});
