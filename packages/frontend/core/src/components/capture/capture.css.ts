import { cssVarV2 } from '@toeverything/theme/v2';
import { keyframes, style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 20,
  width: '100%',
  maxWidth: 560,
  height: '100%',
  margin: '0 auto',
  padding: '24px 16px',
});

// Recording is a live state, so the ring keeps going for as long as it lasts.
const listeningRing = keyframes({
  '0%': { boxShadow: `0 0 0 0 ${cssVarV2('status/error')}` },
  '100%': { boxShadow: '0 0 0 22px transparent' },
});

export const mic = style({
  flexShrink: 0,
  width: 128,
  height: 128,
  marginTop: 16,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 56,
  border: 'none',
  cursor: 'pointer',
  color: cssVarV2('button/pureWhiteText'),
  background: cssVarV2('button/primary'),
  selectors: {
    '&[data-listening="true"]': {
      background: cssVarV2('status/error'),
      animation: `${listeningRing} 1.2s ease-out infinite`,
    },
    '&:focus-visible': {
      outline: `3px solid ${cssVarV2('layer/insideBorder/primaryBorder')}`,
      outlineOffset: 4,
    },
  },
});

export const micLabel = style({
  fontSize: 14,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

export const error = style({
  fontSize: 14,
  color: cssVarV2('status/error'),
  textAlign: 'center',
});

export const textarea = style({
  flex: 1,
  width: '100%',
  minHeight: 160,
  padding: 14,
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: 16,
  lineHeight: '24px',
  resize: 'none',
  outline: 'none',
  selectors: {
    '&:focus-visible': {
      borderColor: cssVarV2('layer/insideBorder/primaryBorder'),
    },
  },
});

export const partial = style({
  minHeight: 20,
  width: '100%',
  fontSize: 14,
  color: cssVarV2('text/placeholder'),
  fontStyle: 'italic',
});

export const footer = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  flexWrap: 'wrap',
});

export const status = style({
  flex: 1,
  minWidth: 160,
  fontSize: 13,
  color: cssVarV2('text/secondary'),
});
