import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const wrapper = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
});

export const badge = style({
  position: 'absolute',
  top: 0,
  right: 0,
  transform: 'translate(35%, -35%)',
  backgroundColor: cssVarV2('button/primary'),
  color: cssVarV2('text/pureWhite'),
  minWidth: '14px',
  height: '14px',
  padding: '0 3px',
  borderRadius: '7px',
  fontSize: '10px',
  lineHeight: '14px',
  textAlign: 'center',
  fontWeight: 500,
  pointerEvents: 'none',
});
