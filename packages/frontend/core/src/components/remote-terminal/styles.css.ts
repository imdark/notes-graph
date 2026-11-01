import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const bar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: cssVarV2('text/secondary'),
});

export const select = style({
  height: 28,
  padding: '0 8px',
  borderRadius: 6,
  fontSize: 13,
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const spacer = style({ flex: 1 });

export const sessions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
});

export const chip = style({
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 12,
  cursor: 'pointer',
  color: cssVarV2('text/secondary'),
  background: 'transparent',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&[data-active]': {
      color: cssVarV2('text/primary'),
      borderColor: cssVarV2('button/primary'),
    },
    '&[data-exited]': { opacity: 0.6 },
  },
});

export const screen = style({
  position: 'relative',
  height: 480,
  overflow: 'auto',
  padding: 10,
  borderRadius: 10,
  background: '#16181d',
  color: '#d6dbe3',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: 13,
  lineHeight: '17px',
  whiteSpace: 'pre',
  outline: 'none',
  selectors: {
    '&:focus': { boxShadow: `0 0 0 2px ${cssVarV2('button/primary')}` },
  },
});

export const measure = style({
  position: 'absolute',
  visibility: 'hidden',
  pointerEvents: 'none',
});

export const note = style({
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
});

export const error = style({
  fontSize: 12,
  color: cssVarV2('button/error'),
});
