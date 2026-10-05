import {
  bodyEmphasized,
  footnoteRegular,
} from '@toeverything/theme/typography';
import { cssVarV2 } from '@toeverything/theme/v2';
import { keyframes, style } from '@vanilla-extract/css';

export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
});

export const title = style([
  bodyEmphasized,
  {
    color: cssVarV2('text/primary'),
  },
]);

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: '0 16px 8px',
});

export const hint = style([
  footnoteRegular,
  {
    color: cssVarV2('text/secondary'),
  },
]);

export const error = style([
  footnoteRegular,
  {
    color: cssVarV2('status/error'),
  },
]);

export const textarea = style({
  width: '100%',
  minHeight: 140,
  maxHeight: '40vh',
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: 16,
  lineHeight: '24px',
  resize: 'none',
  outline: 'none',
});

export const partial = style([
  footnoteRegular,
  {
    minHeight: 20,
    color: cssVarV2('text/placeholder'),
    fontStyle: 'italic',
  },
]);

const pulse = keyframes({
  '0%': { boxShadow: `0 0 0 0 ${cssVarV2('button/primary')}` },
  '100%': { boxShadow: '0 0 0 14px transparent' },
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
});

export const mic = style({
  flexShrink: 0,
  width: 52,
  height: 52,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 26,
  border: 'none',
  color: cssVarV2('button/pureWhiteText'),
  background: cssVarV2('button/primary'),
  selectors: {
    '&[data-listening="true"]': {
      background: cssVarV2('status/error'),
      animation: `${pulse} 1.2s ease-out infinite`,
    },
  },
});

export const add = style({
  flex: 1,
});
