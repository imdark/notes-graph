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
  // The hand-off picker adds height, so the page scrolls instead of cutting
  // its buttons off.
  overflowY: 'auto',
  selectors: {
    // While the keyboard is up there is little height left, so the mic
    // shrinks and the text box keeps most of it.
    '&[data-compact="true"]': {
      gap: 12,
      padding: '12px 16px',
    },
  },
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
    [`${root}[data-compact="true"] &`]: {
      width: 56,
      height: 56,
      marginTop: 0,
      fontSize: 28,
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
    [`${root}[data-compact="true"] &`]: {
      minHeight: 72,
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

// Secondary to capturing: a quiet row below it, not a banner over the mic.
export const model = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  width: '100%',
  flexWrap: 'wrap',
  paddingTop: 12,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const modelText = style({
  flex: 1,
  minWidth: 200,
  fontSize: 13,
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
});

export const modelProgress = style({
  width: '100%',
  height: 6,
  accentColor: cssVarV2('button/primary'),
});

export const handOff = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  width: '100%',
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
});

export const handOffLabel = style({
  fontSize: 14,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const handOffHint = style({
  fontSize: 14,
  color: cssVarV2('text/secondary'),
});

// Scrolls rather than pushing the buttons off a phone screen.
export const handOffList = style({
  display: 'flex',
  flexDirection: 'column',
  maxHeight: 220,
  overflowY: 'auto',
});

// A whole row is the tap target, at least 44px tall on a phone.
export const handOffAgent = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 44,
  padding: '0 4px',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 15,
  color: cssVarV2('text/primary'),
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const handOffIcon = style({
  display: 'flex',
  fontSize: 18,
  flexShrink: 0,
});

export const handOffName = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const handOffActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});
