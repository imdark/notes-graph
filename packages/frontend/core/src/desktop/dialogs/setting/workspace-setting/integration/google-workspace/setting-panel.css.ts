import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const list = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

export const group = style({
  padding: '12px 16px',
  borderRadius: 8,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});

export const groupHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});

export const groupTitle = style({
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '22px',
  color: cssVarV2.text.primary,
});

export const groupCaption = style({
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.text.secondary,
});

export const groupMeta = style({
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
  whiteSpace: 'nowrap',
});

export const errorText = style({
  fontSize: 12,
  lineHeight: '18px',
  color: cssVarV2.status.error,
});

export const scopeRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '8px 0',
  borderTop: `1px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const scopeInfo = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const scopeActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const empty = style({
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2.text.secondary,
  padding: '8px 0',
});

export const actions = style({
  marginTop: 12,
  display: 'flex',
  justifyContent: 'flex-end',
});

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginTop: 12,
});

export const formRow = style({
  display: 'flex',
  gap: 8,
});

export const select = style({
  flex: 1,
  padding: '6px 8px',
  borderRadius: 6,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  color: cssVarV2.text.primary,
  fontSize: 13,
});
