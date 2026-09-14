import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, keyframes, style } from '@vanilla-extract/css';
export const sizeVar = createVar('sizeVar');
const spin = keyframes({
  '0%': { transform: 'rotate(0deg)' },
  '100%': { transform: 'rotate(360deg)' },
});
export const DefaultAvatarContainerStyle = style({
  width: '100%',
  height: '100%',
  position: 'relative',
  overflow: 'hidden',
  borderRadius: '50%',
});
// The circular conic-gradient disc (its `background` is set per-name inline).
export const DefaultAvatarRingStyle = style({
  position: 'absolute',
  // oversize so the rotation on hover never reveals a corner
  inset: '-25%',
  transformOrigin: 'center center',
});
export const DefaultAvatarRingWithAnimationStyle = style({
  animation: `${spin} 6s linear infinite`,
});
// Soft top-left sheen for a bit of depth over the flat gradient.
export const DefaultAvatarSheenStyle = style({
  position: 'absolute',
  inset: 0,
  background:
    'radial-gradient(120% 120% at 30% 25%, rgba(255,255,255,0.45), rgba(255,255,255,0) 55%)',
  pointerEvents: 'none',
});
export const avatarRoot = style({
  position: 'relative',
  display: 'inline-flex',
  flexShrink: 0,
});
export const avatarWrapper = style({
  vars: {
    [sizeVar]: 'unset',
  },
  width: sizeVar,
  height: sizeVar,
  fontSize: `calc(${sizeVar} / 2)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  verticalAlign: 'middle',
  userSelect: 'none',
  position: 'relative',
  overflow: 'hidden',
});
export const avatarImage = style({
  width: '100%',
  height: '100%',
  objectFit: 'cover',
});
export const avatarFallback = style({
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: cssVar('primaryColor'),
  color: cssVar('white'),
  lineHeight: '1',
  fontWeight: '500',
});
export const avatarDefaultFallback = style([
  avatarFallback,
  {
    backgroundColor: cssVarV2('portrait/localPortraitBackground'),
  },
]);
export const hoverWrapper = style({
  width: '100%',
  height: '100%',
  position: 'absolute',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  backgroundColor: 'rgba(60, 61, 63, 0.5)',
  zIndex: '1',
  color: cssVar('pureWhite'),
  opacity: 0,
  transition: 'opacity .15s',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      opacity: 1,
    },
  },
});
export const removeButton = style({
  position: 'absolute',
  right: '-8px',
  top: '-2px',
  visibility: 'hidden',
  zIndex: '1',
  selectors: {
    [`${avatarRoot}:hover &`]: {
      visibility: 'visible',
    },
  },
});
