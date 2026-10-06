import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '12px 16px 24px',
});

export const title = style({
  fontSize: 17,
  fontWeight: 600,
});

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  fontWeight: 600,
  color: cssVarV2.text.secondary,
});

export const empty = style({
  fontSize: 14,
  color: cssVarV2.text.secondary,
  lineHeight: 1.5,
});

export const waitingCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});
